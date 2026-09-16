package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// proc runs a program in dir with extra env, streaming output into the job log.
func (j *Job) proc(dir string, env []string, name string, args ...string) error {
	j.logf("$ %s %s", name, strings.Join(args, " "))
	cmd := exec.Command(name, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	if len(env) > 0 {
		cmd.Env = append(os.Environ(), env...)
	}
	hideWindow(cmd)
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		return err
	}
	buf := make([]byte, 32*1024)
	carry := ""
	for {
		n, rerr := pipe.Read(buf)
		if n > 0 {
			carry += string(buf[:n])
			for {
				i := strings.IndexAny(carry, "\r\n")
				if i < 0 {
					break
				}
				line := carry[:i]
				carry = carry[i+1:]
				if strings.TrimSpace(line) != "" {
					j.logf("%s", line)
				}
			}
			if len(carry) > 8192 {
				j.logf("%s", carry)
				carry = ""
			}
		}
		if rerr != nil {
			break
		}
	}
	if strings.TrimSpace(carry) != "" {
		j.logf("%s", carry)
	}
	return cmd.Wait()
}

// findLocalOverlay locates the overlay checkout the running exe lives in: the
// binary sits in the repo root (or in launcher/), so tools/lclite.mjs + mods/
// nearby mean "this is your working copy".
func findLocalOverlay() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	dir := filepath.Dir(exe)
	for _, cand := range []string{dir, filepath.Dir(dir)} {
		if isOverlayDir(cand) {
			return cand
		}
	}
	return ""
}

// overlayFor picks the overlay (tools/ + mods/) that drives an install.
//
// Your own checkout wins when there is one — that's where mods are edited, and
// since the launcher moved out of the checkout, silently using a stale clone
// inside each install would mean edits appearing to do nothing. The copy cloned
// into the install stays as the fallback for a launcher that lives alone.
func (l *Launcher) overlayFor(in *Install) string {
	if l.localOverlay != "" {
		return l.localOverlay
	}
	if isOverlayDir(in.overlayDir()) {
		return in.overlayDir()
	}
	return ""
}

// overlaySource labels where an install's mods come from, for the UI.
func (l *Launcher) overlaySource(in *Install) string {
	switch l.overlayFor(in) {
	case "":
		return ""
	case l.localOverlay:
		return "checkout"
	default:
		return "install"
	}
}

func (l *Launcher) overlayEnv(in *Install) []string {
	env := []string{"LCLITE_ROOT=" + in.Path}
	if bun := l.findBun(); bun != "" {
		env = append(env, "LCLITE_BUN="+bun, "PATH="+filepath.Dir(bun)+string(os.PathListSeparator)+os.Getenv("PATH"))
	}
	return env
}

// ---- install ---------------------------------------------------------------

type installOpts struct {
	WithClient bool
	Overlay    bool
	Mods       []string
}

// syncOrClone fetches a repo at a branch, but leaves a tree that already has
// local changes exactly as it is — that's an installed revision with your mods
// on it, and "install" must be repeatable without clobbering (or refusing).
func (l *Launcher) syncOrClone(j *Job, dir, url, branch, label string) error {
	if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
		if dirty, derr := l.isDirty(dir); derr == nil && dirty {
			j.logf("%s already has local changes — leaving it alone, nothing to fetch", label)
			return nil
		}
	}
	return l.syncRepo(j, dir, url, branch)
}

// installRev clones the revision's repos and gets it ready to play.
func (l *Launcher) installRev(j *Job, rev string, opts installOpts) (*Install, error) {
	root := l.store.installDir(rev)
	in := &Install{ID: rev, Path: root, Rev: rev, AddedAt: time.Now()}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}

	j.setStep("fetching Lost City " + rev)
	if err := l.syncOrClone(j, in.engineDir(), engineRepoURL, rev, "engine"); err != nil {
		return nil, err
	}
	if err := l.syncOrClone(j, filepath.Join(root, "content"), contentRepoURL, rev, "content"); err != nil {
		return nil, err
	}
	if opts.WithClient {
		if err := l.syncOrClone(j, in.clientDir(), clientRepoURL, rev, "webclient"); err != nil {
			return nil, err
		}
	}

	if opts.Overlay {
		if !overlayModsAllowed(rev) {
			j.logf("!! LCLite mods are anchored to revision 289 only — installing %s without the overlay", rev)
		} else {
			j.setStep("fetching the LCLite overlay")
			if err := l.syncOrClone(j, in.overlayDir(), overlayRepoURL, "main", "lclite overlay"); err != nil {
				j.logf("!! could not fetch the LCLite overlay (%v)", err)
				j.logf("   the install still works — copy your lclite/ folder into %s to enable mods", root)
			}
		}
	}
	in.Overlay = overlayPresent(root)
	in.Custom = false

	j.setStep("installing engine dependencies")
	if err := j.proc(in.engineDir(), nil, npmExe(), npmArgs("install")...); err != nil {
		return in, fmt.Errorf("npm install failed in engine/: %v", err)
	}

	if in.Overlay && overlayModsAllowed(rev) {
		j.setStep("applying LCLite mods")
		if err := l.applyMods(j, in, opts.Mods); err != nil {
			return in, err
		}
	} else if opts.WithClient {
		j.setStep("building the client bundle")
		if err := l.buildClient(j, in); err != nil {
			return in, err
		}
	}

	l.store.upsertInstall(in)
	return in, nil
}

// ---- per-install actions ----------------------------------------------------

func (l *Launcher) applyMods(j *Job, in *Install, mods []string) error {
	overlay := l.overlayFor(in)
	if overlay == "" {
		return fmt.Errorf("no LCLite overlay to apply — put this exe in your lclite checkout, or copy lclite/ into %s", in.Path)
	}
	j.logf("overlay: %s (%s)", overlay, l.overlaySource(in))
	if !overlayModsAllowed(in.Rev) {
		return fmt.Errorf("LCLite mods are anchored to revision 289; this install is %s", revLabel(in))
	}
	if _, err := exec.LookPath("node"); err != nil {
		return fmt.Errorf("node is not installed — the overlay engine needs it (https://nodejs.org)")
	}
	if bun, err := l.ensureBun(j.logf); err != nil {
		j.logf("!! bun unavailable (%v) — mods will apply but the client bundle will not rebuild", err)
	} else {
		j.logf("using bun: %s", bun)
	}
	mods = normalizeMods(overlay, mods)
	if len(mods) == 0 {
		// an empty selection means "the default set" — exactly what a bare
		// `node tools/lclite.mjs` applies. Stripping is its own action.
		mods = allModNames(overlay)
		j.logf("no mods ticked — applying the full default set (%d mods)", len(mods))
	}
	// "desired set": these get applied, everything else is stripped back
	args := []string{"tools/lclite.mjs", "--mods", strings.Join(mods, ",")}
	if err := j.proc(overlay, l.overlayEnv(in), "node", args...); err != nil {
		return fmt.Errorf("the overlay reported a problem — see the log above (drift means the hunks need reseating)")
	}
	in.Overlay = true
	in.Mods = mods
	l.store.setMods(in.ID, mods, true)
	return nil
}

// stripMods takes every mod back off the tree (the overlay's own uninstall, so
// copied files are removed too — a plain git checkout would leave them behind).
func (l *Launcher) stripMods(j *Job, in *Install) error {
	overlay := l.overlayFor(in)
	if overlay == "" {
		return fmt.Errorf("no LCLite overlay to strip with — put this exe in your lclite checkout, or copy lclite/ into %s", in.Path)
	}
	if err := j.proc(overlay, l.overlayEnv(in), "node", "tools/lclite.mjs", "uninstall"); err != nil {
		return fmt.Errorf("the overlay reported a problem while stripping — see the log above")
	}
	in.Mods = nil
	l.store.setMods(in.ID, nil, false)
	return nil
}

// buildClient bundles webclient/ and deploys client.js into engine/public.
func (l *Launcher) buildClient(j *Job, in *Install) error {
	bun, err := l.ensureBun(j.logf)
	if err != nil {
		return err
	}
	wc := in.clientDir()
	if st, err := os.Stat(filepath.Join(wc, "package.json")); err != nil || st.IsDir() {
		return fmt.Errorf("no webclient/ in %s — install the client half first", in.Path)
	}
	if st, err := os.Stat(filepath.Join(wc, "node_modules")); err != nil || !st.IsDir() {
		j.logf("installing webclient build dependencies (bun install)…")
		if err := j.proc(wc, nil, bun, "install"); err != nil {
			return fmt.Errorf("bun install failed: %v", err)
		}
	}
	if err := j.proc(wc, nil, bun, "run", "bundle.ts"); err != nil {
		return fmt.Errorf("bundling failed: %v", err)
	}
	src := filepath.Join(wc, "out", "client.js")
	if _, err := os.Stat(src); err != nil {
		return fmt.Errorf("the bundle did not produce out/client.js")
	}
	dst := filepath.Join(in.publicDir(), "client", "client.js")
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	if err := copyFile(src, dst); err != nil {
		return err
	}
	j.logf("deployed %s", dst)
	l.store.setMods(in.ID, in.Mods, true)
	return nil
}

func (l *Launcher) updateInstall(j *Job, in *Install) error {
	if in.Custom {
		return fmt.Errorf("%s is an existing folder — update it with git yourself, or install a managed revision instead", in.ID)
	}
	j.setStep("updating Lost City " + revLabel(in))
	branch := in.Rev
	if branch == "" {
		branch = "289"
	}
	if err := l.syncRepo(j, in.engineDir(), engineRepoURL, branch); err != nil {
		return err
	}
	if err := l.syncRepo(j, filepath.Join(in.Path, "content"), contentRepoURL, branch); err != nil {
		return err
	}
	if _, err := os.Stat(in.clientDir()); err == nil {
		if err := l.syncRepo(j, in.clientDir(), clientRepoURL, branch); err != nil {
			return err
		}
	}
	j.setStep("installing engine dependencies")
	if err := j.proc(in.engineDir(), nil, npmExe(), npmArgs("install")...); err != nil {
		return err
	}
	if in.Overlay && overlayModsAllowed(in.Rev) {
		j.setStep("re-applying your mods")
		if err := l.applyMods(j, in, in.Mods); err != nil {
			return err
		}
	}
	return nil
}

// resetInstall strips every local change, i.e. "un-mod my working tree".
func (l *Launcher) resetInstall(j *Job, in *Install) error {
	j.setStep("resetting the working trees to pristine upstream")
	for _, dir := range []string{in.clientDir(), in.engineDir(), filepath.Join(in.Path, "content")} {
		if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
			continue
		}
		if err := l.runGit(j, dir, "checkout", "--", "."); err != nil {
			return err
		}
	}
	l.store.setMods(in.ID, nil, false)
	return nil
}

func copyFile(src, dst string) error {
	raw, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, raw, 0o644)
}
