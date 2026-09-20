package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ---- revisions & installs ---------------------------------------------------

func (l *Launcher) handleInstall(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Rev     string   `json:"rev"`
		Client  *bool    `json:"client"`
		Overlay *bool    `json:"overlay"`
		Mods    []string `json:"mods"`
	}
	if err := decode(r, &req); err != nil {
		fail(w, err)
		return
	}
	rev := strings.TrimSpace(req.Rev)
	if rev == "" {
		fail(w, fmt.Errorf("pick a revision first"))
		return
	}
	if l.jobs.active() != nil {
		fail(w, fmt.Errorf("another task is still running — wait for it to finish"))
		return
	}
	opts := installOpts{WithClient: true, Overlay: revSupported(l.localOverlay, rev)}
	if req.Client != nil {
		opts.WithClient = *req.Client
	}
	if req.Overlay != nil {
		opts.Overlay = *req.Overlay
	}
	opts.Mods = req.Mods
	l.store.setLastRev(rev)

	j := goJob(l, "install", rev, func(j *Job) error {
		in, err := l.installRev(j, rev, opts)
		if err != nil {
			return err
		}
		j.logf("")
		j.logf("%s is ready — press Start to launch the world", in.ID)
		return nil
	})
	ok(w, map[string]any{"job": j.ID})
}

func (l *Launcher) handleImport(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
		Rev  string `json:"rev"`
	}
	if err := decode(r, &req); err != nil {
		fail(w, err)
		return
	}
	root := strings.TrimSpace(req.Path)
	if root == "" {
		fail(w, fmt.Errorf("give me a folder path"))
		return
	}
	root = filepath.Clean(root)
	hasClient, hasEngine, hasOverlay := validateRoot(root)
	if !hasClient && !hasEngine {
		fail(w, fmt.Errorf("%s does not look like a Lost City folder (no webclient/ or engine/ with a package.json)", root))
		return
	}
	rev := strings.TrimSpace(req.Rev)
	if rev == "" {
		rev = l.repoBranch(filepath.Join(root, "engine"))
	}
	id := rev
	if id == "" || l.store.install(id) != nil {
		id = filepath.Base(root)
	}
	in := &Install{ID: id, Path: root, Rev: rev, Custom: true, Overlay: hasOverlay, AddedAt: time.Now()}
	l.store.upsertInstall(in)
	ok(w, map[string]any{"install": l.viewInstall(in)})
}

func (l *Launcher) handleApply(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID   string   `json:"id"`
		Mods []string `json:"mods"`
	}
	if err := decode(r, &req); err != nil {
		fail(w, err)
		return
	}
	in := l.requireInstall(w, req.ID)
	if in == nil {
		return
	}
	if l.jobs.active() != nil {
		fail(w, fmt.Errorf("another task is still running — wait for it to finish"))
		return
	}
	j := goJob(l, "mods", in.ID, func(j *Job) error {
		if err := l.applyMods(j, in, req.Mods); err != nil {
			return err
		}
		j.logf("")
		j.logf("mods are live — reload the client page to pick them up")
		return nil
	})
	ok(w, map[string]any{"job": j.ID})
}

func (l *Launcher) handleBuild(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if err := decode(r, &req); err != nil {
		fail(w, err)
		return
	}
	in := l.requireInstall(w, req.ID)
	if in == nil {
		return
	}
	if l.jobs.active() != nil {
		fail(w, fmt.Errorf("another task is still running — wait for it to finish"))
		return
	}
	j := goJob(l, "build", in.ID, func(j *Job) error {
		if in.Overlay && l.overlayModsAllowed(in) {
			return l.applyMods(j, in, in.Mods)
		}
		return l.buildClient(j, in)
	})
	ok(w, map[string]any{"job": j.ID})
}

func (l *Launcher) handleUpdate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if err := decode(r, &req); err != nil {
		fail(w, err)
		return
	}
	in := l.requireInstall(w, req.ID)
	if in == nil {
		return
	}
	if l.jobs.active() != nil {
		fail(w, fmt.Errorf("another task is still running — wait for it to finish"))
		return
	}
	j := goJob(l, "update", in.ID, func(j *Job) error { return l.updateInstall(j, in) })
	ok(w, map[string]any{"job": j.ID})
}

func (l *Launcher) handleReset(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if err := decode(r, &req); err != nil {
		fail(w, err)
		return
	}
	in := l.requireInstall(w, req.ID)
	if in == nil {
		return
	}
	if l.jobs.active() != nil {
		fail(w, fmt.Errorf("another task is still running — wait for it to finish"))
		return
	}
	j := goJob(l, "reset", in.ID, func(j *Job) error { return l.resetInstall(j, in) })
	ok(w, map[string]any{"job": j.ID})
}

func (l *Launcher) handleStrip(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if err := decode(r, &req); err != nil {
		fail(w, err)
		return
	}
	in := l.requireInstall(w, req.ID)
	if in == nil {
		return
	}
	if l.jobs.active() != nil {
		fail(w, fmt.Errorf("another task is still running — wait for it to finish"))
		return
	}
	j := goJob(l, "strip", in.ID, func(j *Job) error {
		if err := l.stripMods(j, in); err != nil {
			return err
		}
		j.logf("every mod is off — the tree is back to upstream 289")
		return nil
	})
	ok(w, map[string]any{"job": j.ID})
}

func (l *Launcher) handleRemove(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID   string `json:"id"`
		Wipe bool   `json:"wipe"`
	}
	if err := decode(r, &req); err != nil {
		fail(w, err)
		return
	}
	in := l.store.install(req.ID)
	if in == nil {
		fail(w, fmt.Errorf("no install called %q", req.ID))
		return
	}
	if l.engine.Running() && strings.EqualFold(l.engine.installID, in.ID) {
		fail(w, fmt.Errorf("stop the server before removing this install"))
		return
	}
	if req.Wipe {
		// Only a folder this launcher created is ever deleted: a hand-added
		// folder, or a record pointing somewhere else, must never turn "delete
		// files" into an os.RemoveAll on somebody's tree.
		if in.Custom {
			fail(w, fmt.Errorf("%s is a folder you added by hand — the launcher won't delete it. Take it out of the list, then delete the folder yourself if you want it gone", in.ID))
			return
		}
		if !l.ownsFolder(in.Path) {
			fail(w, fmt.Errorf("refusing to delete %s — it is outside %s", in.Path, l.installsDir()))
			return
		}
		// Wipe BEFORE forgetting it: a delete that fails (a file still open,
		// permissions) leaves the row in place to retry, instead of the record
		// vanishing while the files stay behind.
		if err := os.RemoveAll(in.Path); err != nil {
			fail(w, fmt.Errorf("could not delete %s: %v", in.Path, err))
			return
		}
	}
	l.store.removeInstall(in.ID)
	ok(w, map[string]any{"removed": in.ID, "wiped": req.Wipe})
}

// ---- running ----------------------------------------------------------------

func (l *Launcher) handleRun(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID   string `json:"id"`
		Port int    `json:"port"`
		Open *bool  `json:"open"`
	}
	if err := decode(r, &req); err != nil {
		fail(w, err)
		return
	}
	in := l.requireInstall(w, req.ID)
	if in == nil {
		return
	}
	if l.jobs.active() != nil {
		fail(w, fmt.Errorf("another task is still running — wait for it to finish"))
		return
	}
	openWhenReady := req.Open == nil || *req.Open
	if err := l.StartServer(in, req.Port, openWhenReady); err != nil {
		fail(w, err)
		return
	}
	// returns while the world is still booting; the browser opens when it is up
	port := l.engine.Status()["port"].(int)
	url := fmt.Sprintf("http://localhost%s/rs2.cgi", portSuffix(port))
	ok(w, map[string]any{"url": url, "port": port, "state": l.engine.State()})
}

func (l *Launcher) handleStop(w http.ResponseWriter, r *http.Request) {
	if err := l.StopServer(); err != nil {
		fail(w, err)
		return
	}
	ok(w, nil)
}

func (l *Launcher) handleBrowse(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Start string `json:"start"`
	}
	_ = decode(r, &req)
	path, err := pickFolder(req.Start)
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, map[string]any{"path": path})
}

func (l *Launcher) handleBun(w http.ResponseWriter, r *http.Request) {
	j := goJob(l, "bun", "", func(j *Job) error {
		path, err := l.ensureBun(j.logf)
		if err != nil {
			return err
		}
		j.logf("bun is ready: %s", path)
		return nil
	})
	ok(w, map[string]any{"job": j.ID})
}

// ---- proxy mode -------------------------------------------------------------

func (l *Launcher) handleProxyStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL         string `json:"url"`
		Port        int    `json:"port"`
		LocalClient bool   `json:"local_client"`
		ID          string `json:"id"`
	}
	if err := decode(r, &req); err != nil {
		fail(w, err)
		return
	}
	var in *Install
	if req.ID != "" {
		if in = l.store.install(req.ID); in == nil {
			fail(w, fmt.Errorf("no install called %q", req.ID))
			return
		}
	}
	if err := l.StartProxy(req.URL, req.Port, req.LocalClient, in); err != nil {
		fail(w, err)
		return
	}
	port := l.proxy.Status()["port"].(int)
	url := fmt.Sprintf("http://localhost%s/rs2.cgi", portSuffix(port))
	_ = openBrowser(url)
	l.store.addRemote(Remote{Name: req.URL, URL: req.URL, LocalClient: req.LocalClient})
	ok(w, map[string]any{"url": url, "port": port})
}

func (l *Launcher) handleProxyStop(w http.ResponseWriter, r *http.Request) {
	if err := l.StopProxy(); err != nil {
		fail(w, err)
		return
	}
	ok(w, nil)
}

// handleQuit shuts the launcher down (it normally runs detached, so the UI
// needs its own way out).
func (l *Launcher) handleQuit(w http.ResponseWriter, r *http.Request) {
	ok(w, map[string]any{"bye": true})
	go func() {
		time.Sleep(250 * time.Millisecond)
		_ = l.StopServer()
		_ = l.StopProxy()
		os.Exit(0)
	}()
}

// ---- helpers ----------------------------------------------------------------

// installsDir is where the launcher's own installs live. Nothing outside it is
// ever deleted by the launcher.
func (l *Launcher) installsDir() string { return filepath.Join(l.dataDir, "installs") }

// ownsFolder reports whether path sits inside the managed installs folder, so
// "delete files" can never be aimed at a folder the launcher didn't create.
func (l *Launcher) ownsFolder(path string) bool {
	root, err := filepath.Abs(l.installsDir())
	if err != nil {
		return false
	}
	p, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(root, p)
	if err != nil {
		return false
	}
	return rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func (l *Launcher) requireInstall(w http.ResponseWriter, id string) *Install {
	in := l.store.install(id)
	if in == nil {
		fail(w, fmt.Errorf("no install called %q", id))
		return nil
	}
	return in
}

// goJob runs fn in the background and hands back the job handle.
func goJob(l *Launcher, kind, installID string, fn func(*Job) error) *Job {
	done := make(chan *Job, 1)
	go func() { done <- l.jobs.run(kind, installID, fn) }()
	select {
	case j := <-done:
		return j
	case <-time.After(50 * time.Millisecond):
		if j := l.jobs.active(); j != nil {
			return j
		}
		return <-done
	}
}

// playRev is the `-play <rev>` shortcut: install if needed, then launch.
func (l *Launcher) playRev(rev string, port int) error {
	in := l.store.install(rev)
	if in == nil {
		j := l.jobs.run("install", rev, func(j *Job) error {
			_, err := l.installRev(j, rev, installOpts{WithClient: true, Overlay: revSupported(l.localOverlay, rev)})
			return err
		})
		if j.Status != "ok" {
			return fmt.Errorf("install of %s failed: %s", rev, j.Err)
		}
		in = l.store.install(rev)
		if in == nil {
			return fmt.Errorf("install of %s finished but is not registered", rev)
		}
	}
	if err := l.StartServer(in, port, true); err != nil {
		return err
	}
	st := l.engine.Status()
	p, _ := st["port"].(int)
	u := fmt.Sprintf("http://localhost%s/rs2.cgi", portSuffix(p))
	fmt.Printf("  %s is booting - the client opens at %s once the world is ready\n", rev, u)
	return nil
}
