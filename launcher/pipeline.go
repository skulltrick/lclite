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

// installRev clones the revision's repos and gets it ready to play.
func (l *Launcher) installRev(j *Job, rev string, opts installOpts) (*Install, error) {
	root := l.store.installDir(rev)
	in := &Install{ID: rev, Path: root, Rev: rev, AddedAt: time.Now()}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}

	j.setStep("fetching Lost City " + rev)
	if err := l.syncRepo(j, in.engineDir(), engineRepoURL, rev); err != nil {
		return nil, err
	}
	if err := l.syncRepo(j, filepath.Join(root, "content"), contentRepoURL, rev); err != nil {
		return nil, err
	}
	if opts.WithClient {
		if err := l.syncRepo(j, in.clientDir(), clientRepoURL, rev); err != nil {
			return nil, err
		}
	}

	if opts.Overlay {
		if !overlayModsAllowed(rev) {
			j.logf("!! LCLite mods are anchored to revision 289 only — installing %s without the overlay", rev)
		} else {
			j.setStep("fetching the LCLite overlay")
			if err := l.syncRepo(j, in.overlayDir(), overlayRepoURL, "main"); err != nil {
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
	if !in.Overlay {
		return fmt.Errorf("no LCLite overlay in %s — copy the lclite/ folder there first", in.Path)
	}
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
	mods = normalizeMods(in.Path, mods)
	if len(mods) == 0 {
		// an empty selection means "the default set" — exactly what a bare
		// `node tools/lclite.mjs` applies. Stripping is its own action.
		mods = allModNames(in.Path)
		j.logf("no mods ticked — applying the full default set (%d mods)", len(mods))
	}
	// "desired set": these get applied, everything else is stripped back
	args := []string{"tools/lclite.mjs", "--mods", strings.Join(mods, ",")}
	if err := j.proc(in.overlayDir(), l.overlayEnv(in), "node", args...); err != nil {
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
	if !in.Overlay {
		return fmt.Errorf("no LCLite overlay in %s", in.Path)
	}
	if err := j.proc(in.overlayDir(), l.overlayEnv(in), "node", "tools/lclite.mjs", "uninstall"); err != nil {
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
