package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

//go:embed ui
var uiFS embed.FS

const tokenPlaceholder = "__LCLITE_TOKEN__"

type Launcher struct {
	store      *Store
	dataDir    string
	version    string
	binarySize int64
	jobs       *JobManager
	engine     *EngineServer
	proxy      *Proxy
	token      string
	httpClient *http.Client
	// localOverlay = the lclite checkout this exe lives in, when there is one
	// (mods are edited there, so it wins over an install's cloned copy).
	localOverlay string
}

// ownSize reports the size of the running executable — the UI shows it because
// "one small binary, no runtime" is the whole point of this thing.
func ownSize() int64 {
	path, err := os.Executable()
	if err != nil {
		return 0
	}
	st, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return st.Size()
}

func newLauncher(dataDir, version string) (*Launcher, error) {
	store, err := openStore(dataDir)
	if err != nil {
		return nil, err
	}
	localOverlay := findLocalOverlay()
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	return &Launcher{
		store:        store,
		dataDir:      store.snapshot().DataDir,
		version:      version,
		binarySize:   ownSize(),
		jobs:         newJobManager(),
		engine:       &EngineServer{},
		proxy:        &Proxy{},
		token:        hex.EncodeToString(buf),
		localOverlay: localOverlay,
		httpClient:   &http.Client{Timeout: 25 * time.Second},
	}, nil
}

func main() {
	dataDir := flag.String("data", "", "data folder (default: per-user app data)")
	uiPort := flag.Int("port", 0, "UI port (0 = pick a free one)")
	noBrowser := flag.Bool("no-browser", false, "don't open the browser window")
	play := flag.String("play", "", "install/launch a revision straight away, e.g. -play 289")
	showVersion := flag.Bool("version", false, "print the launcher version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("LCLite launcher %s (%s/%s)\n", launcherVersion, runtime.GOOS, runtime.GOARCH)
		return
	}

	l, err := newLauncher(*dataDir, launcherVersion)
	if err != nil {
		fatal("could not open the launcher data folder: %v", err)
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *uiPort))
	if err != nil {
		fatal("could not listen on port %d: %v", *uiPort, err)
	}
	uiPortActual := ln.Addr().(*net.TCPAddr).Port
	url := fmt.Sprintf("http://127.0.0.1:%d/", uiPortActual)

	fmt.Printf("LCLite launcher %s\n  data: %s\n  ui:   %s\n", l.version, l.dataDir, url)
	if !*noBrowser {
		time.Sleep(250 * time.Millisecond)
		if err := openBrowser(url); err != nil {
			fmt.Printf("  (could not open a browser automatically: %v)\n", err)
		}
	}

	srv := &http.Server{Handler: l.routes()}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			fatal("ui server stopped: %v", err)
		}
	}()

	if *play != "" {
		go func() {
			if err := l.playRev(*play, 0); err != nil {
				fmt.Printf("!! %v\n", err)
			}
		}()
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	fmt.Println("\nshutting down…")
	_ = l.StopServer()
	_ = l.StopProxy()
}

func fatal(format string, a ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(1)
}

// ---- routing ---------------------------------------------------------------

func (l *Launcher) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		page, err := fs.ReadFile(uiFS, "ui/index.html")
		if err != nil {
			http.Error(w, "ui missing", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte(strings.ReplaceAll(string(page), tokenPlaceholder, l.token)))
	})

	api := func(path string, fn http.HandlerFunc) {
		mux.HandleFunc("/api/"+path, l.guard(fn))
	}

	api("state", l.handleState)
	api("revs", l.handleRevs)
	api("config", l.handleConfig)
	api("install", l.handleInstall)
	api("import", l.handleImport)
	api("apply", l.handleApply)
	api("build", l.handleBuild)
	api("update", l.handleUpdate)
	api("reset", l.handleReset)
	api("strip", l.handleStrip)
	api("remove", l.handleRemove)
	api("run", l.handleRun)
	api("stop", l.handleStop)
	api("browse", l.handleBrowse)
	api("bun", l.handleBun)
	api("proxy/start", l.handleProxyStart)
	api("proxy/stop", l.handleProxyStop)
	api("worlds", l.handleWorlds)
	api("worlds/add", l.handleWorldAdd)
	api("worlds/remove", l.handleWorldRemove)
	api("worlds/favorite", l.handleWorldFavorite)
	api("worlds/note", l.handleWorldNote)
	api("worlds/refresh", l.handleWorldRefresh)
	api("worlds/check", l.handleWorldCheck)
	api("world/publish", l.handleWorldPublish)
	api("world/unpublish", l.handleWorldUnpublish)
	api("saves", l.handleSaves)
	api("saves/import", l.handleSaveImport)
	api("saves/export", l.handleSaveExport)
	api("saves/browse", l.handleSaveBrowse)
	api("vault", l.handleVault)
	api("job", l.handleJob)
	api("log", l.handleLog)
	api("quit", l.handleQuit)

	return mux
}

// guard requires the per-run token, so only this launcher's own page can drive it.
func (l *Launcher) guard(fn http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := r.Header.Get("X-LCLite-Token")
		if tok == "" {
			tok = r.URL.Query().Get("t")
		}
		if tok != l.token {
			http.Error(w, "bad token", http.StatusForbidden)
			return
		}
		fn(w, r)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func ok(w http.ResponseWriter, extra map[string]any) {
	out := map[string]any{"ok": true}
	for k, v := range extra {
		out[k] = v
	}
	writeJSON(w, out)
}

func fail(w http.ResponseWriter, err error) {
	writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
}

func decode(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	return dec.Decode(v)
}

// ---- views -----------------------------------------------------------------

type installView struct {
	*Install
	RevLabel      string    `json:"rev_label"`
	OverlayDir    string    `json:"overlay_dir"`
	OverlayPath   string    `json:"overlay_path"`
	OverlaySource string    `json:"overlay_source"`
	ModsAllowed   bool      `json:"mods_allowed"`
	HasOverlay    bool      `json:"has_overlay"`
	HasClient     bool      `json:"has_client"`
	HasEngine     bool      `json:"has_engine"`
	EngineDeps    bool      `json:"engine_deps"`
	ClientBundle  bool      `json:"client_bundle"`
	Mods          []ModInfo `json:"mods_available"`
	// ModsApplied is what the TREE really has, read from the install's own
	// installed.json — the same source the join gate reads. Install.Mods is the
	// record's memory of the last apply, which a hand-imported folder never had,
	// so the two can disagree and only this one is safe to show as fact.
	ModsApplied []string `json:"mods_applied"`
	Missing     bool     `json:"missing"`
}

func (l *Launcher) viewInstall(in *Install) installView {
	hasClient, hasEngine, hasOverlay := validateRoot(in.Path)
	v := installView{
		Install:     in,
		RevLabel:    revLabel(in),
		OverlayDir:  in.overlayDir(),
		HasClient:   hasClient,
		HasEngine:   hasEngine,
		HasOverlay:  hasOverlay,
		ModsAllowed: l.overlayModsAllowed(in),
	}
	// A folder that isn't there any more (moved, deleted, or an old layout we
	// outgrew) must read as missing rather than as a broken install.
	if st, err := os.Stat(in.Path); err != nil || !st.IsDir() {
		v.Missing = true
		v.Mods = []ModInfo{}
		v.ModsApplied = []string{}
		v.ModsAllowed = false
		v.OverlayPath = ""
		v.OverlaySource = ""
		return v
	}
	if deps, err := os.Stat(filepath.Join(in.engineDir(), "node_modules")); err == nil && deps.IsDir() {
		v.EngineDeps = true
	}
	if b, err := os.Stat(filepath.Join(in.publicDir(), "client", "client.js")); err == nil && !b.IsDir() {
		v.ClientBundle = true
	}
	v.OverlayPath = l.overlayFor(in)
	v.OverlaySource = l.overlaySource(in)
	v.ModsAllowed = v.ModsAllowed && v.OverlayPath != ""
	if v.OverlayPath != "" {
		v.Mods = listModsFromOverlay(v.OverlayPath, in.Rev)
	}
	if v.Mods == nil {
		v.Mods = []ModInfo{}
	}
	v.ModsApplied = appliedMods(in)
	if v.ModsApplied == nil {
		v.ModsApplied = []string{}
	}
	return v
}

func (l *Launcher) handleState(w http.ResponseWriter, r *http.Request) {
	cfg := l.store.snapshot()
	revs := visibleRevs(cfg.Revs)
	if len(revs) == 0 {
		revs = visibleRevs(fallbackRevs)
	}
	recommended := pickRecommended(revs, cfg.RecommendedRev)
	for i := range revs {
		revs[i].Recommended = revs[i].Name == recommended
	}
	views := make([]installView, 0, len(cfg.Installs))
	for _, in := range cfg.Installs {
		views = append(views, l.viewInstall(in))
	}
	out := map[string]any{
		"version":             l.version,
		"binary_size":         l.binarySize,
		"data_dir":            l.dataDir,
		"platform":            runtime.GOOS + "/" + runtime.GOARCH,
		"installs":            views,
		"revs":                revs,
		"revs_at":             cfg.RevsAt,
		"remotes":             cfg.Remotes,
		"last_rev":            cfg.LastRev,
		"overlay_path":        l.localOverlay,
		"recommended":         recommended,
		"recommended_updated": cfg.RecommendedUpdated,
		"recommended_pinned":  cfg.RecommendedRev != "",
		"overlay_rev":         overlayRev,
		"overlay_revs":        l.overlayRevsFor(),
		"skip_wizard":         cfg.SkipWizard,
		"collapsed":           cfg.Collapsed,
		"tools":               l.detectTools(),
		"engine":              l.engine.Status(),
		"proxy":               l.proxy.Status(),
		"job":                 l.currentJobView(),
		"busy":                l.jobs.active() != nil,
		"proxy_port":          cfg.ProxyPort,
	}
	writeJSON(w, out)
}

func (l *Launcher) currentJobView() any {
	j := l.jobs.find("")
	if j == nil {
		return nil
	}
	return j.view(0)
}

func (l *Launcher) handleRevs(w http.ResponseWriter, r *http.Request) {
	revs, note, err := l.listRevs()
	if err != nil {
		fail(w, err)
		return
	}
	cfg := l.store.snapshot()
	recommended := pickRecommended(revs, cfg.RecommendedRev)
	for i := range revs {
		revs[i].Recommended = revs[i].Name == recommended
	}

	// One extra call: when the recommended revision's content branch last moved.
	// Informational only ("actively developed"), so a failure is silent.
	updated := time.Time{}
	if recommended != "" {
		if d, err := branchCommitDate(l.httpClient, contentRepoURL, recommended); err == nil {
			updated = d
		}
	}
	l.store.setRevs(revs)
	l.store.setRecommended(recommended, updated)

	writeJSON(w, map[string]any{
		"ok": true, "revs": revs, "note": note, "at": time.Now(),
		"recommended": recommended, "recommended_updated": updated,
	})
}

// handleConfig flips first-run/advanced mode, remembers which sections are
// collapsed, and can pin the recommended revision (empty string = back to
// automatic).
func (l *Launcher) handleConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SkipWizard     *bool     `json:"skip_wizard"`
		RecommendedRev *string   `json:"recommended_rev"`
		Collapsed      *[]string `json:"collapsed"`
	}
	if err := decode(r, &req); err != nil {
		fail(w, err)
		return
	}
	if req.SkipWizard != nil {
		l.store.setSkipWizard(*req.SkipWizard)
	}
	if req.Collapsed != nil {
		l.store.setCollapsed(*req.Collapsed)
	}
	if req.RecommendedRev != nil {
		rev := strings.TrimSpace(*req.RecommendedRev)
		updated := time.Time{}
		if rev != "" {
			if d, err := branchCommitDate(l.httpClient, contentRepoURL, rev); err == nil {
				updated = d
			}
		}
		l.store.setRecommended(rev, updated)
	}
	ok(w, nil)
}

func (l *Launcher) handleJob(w http.ResponseWriter, r *http.Request) {
	j := l.jobs.find(r.URL.Query().Get("id"))
	if j == nil {
		writeJSON(w, map[string]any{"ok": true, "job": nil})
		return
	}
	since := atoiDefault(r.URL.Query().Get("since"), 0)
	writeJSON(w, map[string]any{"ok": true, "job": j.view(since)})
}

func (l *Launcher) handleLog(w http.ResponseWriter, r *http.Request) {
	since := atoiDefault(r.URL.Query().Get("since"), 0)
	switch r.URL.Query().Get("which") {
	case "server":
		lines, next := l.engine.log.view(since)
		writeJSON(w, map[string]any{"ok": true, "lines": lines, "next": next})
	case "proxy":
		lines, next := l.proxy.log.view(since)
		writeJSON(w, map[string]any{"ok": true, "lines": lines, "next": next})
	default:
		j := l.jobs.find(r.URL.Query().Get("id"))
		if j == nil {
			writeJSON(w, map[string]any{"ok": true, "lines": []LogLine{}, "next": 0})
			return
		}
		v := j.view(since)
		writeJSON(w, map[string]any{"ok": true, "lines": v.Lines, "next": v.Next, "status": v.Status, "step": v.Step, "err": v.Err})
	}
}

func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	var n int
	if _, err := fmt.Sscanf(s, "%d", &n); err != nil {
		return def
	}
	return n
}
