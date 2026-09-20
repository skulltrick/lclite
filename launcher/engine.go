package main

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// LogRing is a bounded, incrementally-readable line buffer (server output).
type LogRing struct {
	mu    sync.Mutex
	lines []LogLine
	next  int
}

func (r *LogRing) logf(format string, a ...any) {
	text := fmt.Sprintf(format, a...)
	now := time.Now()
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if line == "" {
			continue
		}
		r.lines = append(r.lines, LogLine{N: r.next, Text: line, At: now})
		r.next++
	}
	if len(r.lines) > 5000 {
		r.lines = append([]LogLine(nil), r.lines[len(r.lines)-2500:]...)
	}
}

func (r *LogRing) view(since int) ([]LogLine, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]LogLine, 0, 64)
	for _, ln := range r.lines {
		if ln.N >= since {
			out = append(out, ln)
		}
	}
	return out, r.next
}

// tail returns the last n lines (used to explain a process exit).
func (r *LogRing) tail(n int) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	from := 0
	if len(r.lines) > n {
		from = len(r.lines) - n
	}
	out := make([]string, 0, n)
	for _, ln := range r.lines[from:] {
		out = append(out, ln.Text)
	}
	return out
}

func (r *LogRing) reset() {
	r.mu.Lock()
	r.lines = nil
	r.next = 0
	r.mu.Unlock()
}

// EngineServer owns the running Lost City server process.
//
// state: stopped -> starting -> running (or failed). "starting" matters because
// a first boot repacks the cache, which takes minutes; the UI must be able to
// say so instead of looking hung.
type EngineServer struct {
	mu        sync.Mutex
	cmd       *exec.Cmd
	installID string
	port      int
	gamePort  int
	mgmtPort  int
	state     string
	lastErr   string
	started   time.Time
	log       LogRing
}

func defaultWebPort() int {
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		return 80
	}
	return 8888
}

// ---- ports: world.json on 274+, .env on 225-254 -----------------------------
//
// Upstream changed how a world is configured partway through the revision
// series: 274+ read data/config/world.json, older branches read a dotenv file
// (.env, scaffolded from .env.example) with WEB_PORT / NODE_PORT. The launcher
// speaks both, so "Play" works the same on every revision it can install.

func worldConfigStyle(engineDir string) string {
	if _, err := os.Stat(filepath.Join(engineDir, "data", "config", "world.json")); err == nil {
		return "json"
	}
	for _, f := range []string{".env", ".env.example"} {
		if _, err := os.Stat(filepath.Join(engineDir, f)); err == nil {
			return "env"
		}
	}
	return "json"
}

// freePortFrom walks upward until it finds a port nothing answers on.
func freePortFrom(start int) int {
	for p := start; p < start+200 && p < 65535; p++ {
		if portFree(p) {
			return p
		}
	}
	return start
}

// enginePorts returns (web, game, management) as the install currently has them.
// The engine binds all three: web serves the page + game socket, game is the
// raw TCP world port the java client uses, management is the /setup page.
func enginePorts(engineDir string) (int, int, int) {
	web, game, mgmt := defaultWebPort(), 43594, 8898
	if worldConfigStyle(engineDir) == "env" {
		env := readEnvFile(engineDir)
		web = envInt(env, "WEB_PORT", web)
		game = envInt(env, "NODE_PORT", game)
		mgmt = envInt(env, "WEB_MANAGEMENT_PORT", mgmt)
		return web, game, mgmt
	}
	if m, err := readJSONFile(filepath.Join(engineDir, "data", "config", "world.json")); err == nil {
		if w, ok := m["web"].(map[string]any); ok {
			if p, ok := w["port"].(float64); ok && p > 0 {
				web = int(p)
			}
			if p, ok := w["managementPort"].(float64); ok && p > 0 {
				mgmt = int(p)
			}
		}
		if n, ok := m["node"].(map[string]any); ok {
			if p, ok := n["port"].(float64); ok && p > 0 {
				game = int(p)
			}
		}
	}
	return web, game, mgmt
}

func envInt(env map[string]string, key string, def int) int {
	if v, ok := env[key]; ok {
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && n > 0 {
			return n
		}
	}
	return def
}

// readEnvFile prefers .env, falling back to the .env.example upstream ships.
func readEnvFile(engineDir string) map[string]string {
	out := map[string]string{}
	for _, name := range []string{".env", ".env.example"} {
		raw, err := os.ReadFile(filepath.Join(engineDir, name))
		if err != nil {
			continue
		}
		for _, line := range strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			if i := strings.Index(line, "="); i > 0 {
				out[strings.TrimSpace(line[:i])] = strings.TrimSpace(line[i+1:])
			}
		}
		if name == ".env" {
			break
		}
	}
	return out
}

// setWorldPorts writes every port using whichever config style the install uses.
func setWorldPorts(engineDir string, webPort, gamePort, mgmtPort int) error {
	if worldConfigStyle(engineDir) == "env" {
		return writeEnvPorts(engineDir, webPort, gamePort, mgmtPort)
	}
	path := filepath.Join(engineDir, "data", "config", "world.json")
	m, err := readJSONFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			return err
		}
		m = map[string]any{}
	}
	web, _ := m["web"].(map[string]any)
	if web == nil {
		web = map[string]any{}
	}
	web["port"] = webPort
	m["web"] = web

	node, _ := m["node"].(map[string]any)
	if node == nil {
		node = map[string]any{}
	}
	node["port"] = gamePort
	m["node"] = node
	web["managementPort"] = mgmtPort
	m["web"] = web

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return writeJSONFile(path, m)
}

// writeEnvPorts sets WEB_PORT / NODE_PORT in .env, scaffolding it from
// .env.example when the checkout has none yet, and leaving other keys alone.
func writeEnvPorts(engineDir string, webPort, gamePort, mgmtPort int) error {
	envPath := filepath.Join(engineDir, ".env")
	raw, err := os.ReadFile(envPath)
	eol := "\n"
	if err != nil {
		if example, xerr := os.ReadFile(filepath.Join(engineDir, ".env.example")); xerr == nil {
			raw = example
		} else {
			raw = []byte{}
		}
	}
	if strings.Contains(string(raw), "\r\n") {
		eol = "\r\n"
	}
	lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")

	set := func(key, value string) bool {
		done := false
		for i, line := range lines {
			trimmed := strings.TrimSpace(line)
			body := strings.TrimSpace(strings.TrimPrefix(trimmed, "#"))
			if strings.HasPrefix(body, key+"=") {
				lines[i] = key + "=" + value // uncomment and set, whatever it was
				done = true
				break
			}
		}
		return done
	}
	if !set("WEB_PORT", strconv.Itoa(webPort)) {
		lines = append(lines, "WEB_PORT="+strconv.Itoa(webPort))
	}
	if !set("NODE_PORT", strconv.Itoa(gamePort)) {
		lines = append(lines, "NODE_PORT="+strconv.Itoa(gamePort))
	}
	if !set("WEB_MANAGEMENT_PORT", strconv.Itoa(mgmtPort)) {
		lines = append(lines, "WEB_MANAGEMENT_PORT="+strconv.Itoa(mgmtPort))
	}
	return os.WriteFile(envPath, []byte(strings.Join(lines, eol)), 0o644)
}

func writeJSONFile(path string, v any) error {
	raw, err := marshalIndent(v)
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o644)
}

// portFree asks the port a question instead of trying to bind it.
//
// Bind probes lie on Windows: Go's listener sets SO_EXCLUSIVEADDRUSE, and that
// bind still SUCCEEDS next to an existing listener (measured — a listener on
// 0.0.0.0:43595 did not stop `net.Listen("tcp", ":43595")` from succeeding, and
// the engine then died with EADDRINUSE). So connect: if something answers, the
// port is taken.
func portFree(port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 700*time.Millisecond)
	if err == nil {
		conn.Close()
		return false
	}
	return true
}

// logf writes to the server's own ring buffer (shown in the UI's Server tab).
func (s *EngineServer) logf(format string, a ...any) { s.log.logf(format, a...) }

// Running is true once the web port answers; Busy covers "starting" too, which
// is what guards against a second launch on top of a booting world.
func (s *EngineServer) Running() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state == "running"
}

func (s *EngineServer) Busy() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state == "starting" || s.state == "running"
}

func (s *EngineServer) State() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state == "" {
		return "stopped"
	}
	return s.state
}

// InstallID is the install the running world belongs to ("" when nothing runs).
// The save list needs it: a running world rewrites its characters on logout and
// autosave, so the panel says so instead of letting somebody poke at a file mid-session.
func (s *EngineServer) InstallID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.installID
}

func (s *EngineServer) Status() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.state
	if state == "" {
		state = "stopped"
	}
	st := map[string]any{
		"state":     state,
		"running":   state == "running",
		"starting":  state == "starting",
		"port":      s.port,
		"game_port": s.gamePort,
		"mgmt_port": s.mgmtPort,
		"install":   s.installID,
		"error":     s.lastErr,
	}
	if state == "running" || state == "starting" {
		st["url"] = fmt.Sprintf("http://localhost%s/rs2.cgi", portSuffix(s.port))
	}
	if s.cmd != nil && s.cmd.Process != nil {
		st["pid"] = s.cmd.Process.Pid
		st["started"] = s.started
	}
	return st
}

func portSuffix(port int) string {
	if port == 80 {
		return ""
	}
	return fmt.Sprintf(":%d", port)
}

// StartServer launches `npm run quickstart` in the install's engine folder and
// returns as soon as the process is up. Waiting for the web port happens in the
// background: a first boot repacks the cache (minutes), so the UI shows
// "starting" instead of looking hung.
//
// Two ports matter. web.port serves the page and the game socket; node.port is
// the raw TCP game port, and a second world on this machine collides there too —
// so a busy node.port is moved out of the way instead of failing the boot.
func (l *Launcher) StartServer(in *Install, port int, openWhenReady bool) error {
	if l.engine.Busy() {
		return fmt.Errorf("a Lost City server is already running — stop it first")
	}
	engineDir := in.engineDir()
	if st, err := os.Stat(filepath.Join(engineDir, "node_modules")); err != nil || !st.IsDir() {
		return fmt.Errorf("engine dependencies are missing for %s — run Setup on this install first", in.ID)
	}
	curWeb, curGame, curMgmt := enginePorts(engineDir)
	if port <= 0 {
		port = curWeb
	}
	if !portFree(port) {
		return fmt.Errorf("web port %d is already in use (another server?) — choose a different port", port)
	}
	gamePort, mgmtPort := curGame, curMgmt
	if !portFree(gamePort) {
		next := freePortFrom(gamePort + 1)
		l.engine.logf("game port %d is taken by another world — using %d for this one", gamePort, next)
		gamePort = next
	}
	if !portFree(mgmtPort) {
		next := freePortFrom(mgmtPort + 1)
		l.engine.logf("management port %d is taken by another world — using %d for this one", mgmtPort, next)
		mgmtPort = next
	}
	if err := setWorldPorts(engineDir, port, gamePort, mgmtPort); err != nil {
		return fmt.Errorf("could not write the world config: %v", err)
	}

	l.engine.log.reset()
	l.engine.logf("starting Lost City %s server (web %d, game %d, management %d)", revLabel(in), port, gamePort, mgmtPort)

	// Older revisions wire `quickstart` to bun, not tsx, and bun is often not on
	// the system PATH (the launcher may hold a private copy) — so hand it over
	// explicitly instead of letting the world die with "'bun' is not recognized".
	bun := l.findBun()
	if bun == "" {
		if path, err := l.ensureBun(l.engine.logf); err == nil {
			bun = path
		} else {
			l.engine.logf("!! bun is not available (%v) — revisions that run on bun will not boot", err)
		}
	}

	cmd := engineCommand()
	cmd.Dir = engineDir
	if bun != "" {
		cmd.Env = append(os.Environ(),
			"PATH="+filepath.Dir(bun)+string(os.PathListSeparator)+os.Getenv("PATH"),
			"LCLITE_BUN="+bun)
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

	l.engine.mu.Lock()
	l.engine.cmd = cmd
	l.engine.installID = in.ID
	l.engine.port = port
	l.engine.gamePort = gamePort
	l.engine.mgmtPort = mgmtPort
	l.engine.state = "starting"
	l.engine.lastErr = ""
	l.engine.started = time.Now()
	l.engine.mu.Unlock()

	go func() {
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
						l.engine.log.logf("%s", line)
					}
				}
			}
			if rerr != nil {
				break
			}
		}
		werr := cmd.Wait()
		l.engine.mu.Lock()
		l.engine.cmd = nil
		if l.engine.state != "stopped" {
			l.engine.state = "failed"
			if l.engine.lastErr == "" {
				l.engine.lastErr = explainExit(werr, l.engine.log.tail(12))
			}
		}
		l.engine.mu.Unlock()
		if werr != nil {
			l.engine.log.logf("!! server exited: %v", werr)
		}
	}()

	go l.awaitWeb(port, openWhenReady)
	return nil
}

// awaitWeb flips "starting" -> "running" once the web port answers.
func (l *Launcher) awaitWeb(port int, openWhenReady bool) {
	deadline := time.Now().Add(30 * time.Minute)
	lastNote := time.Now()
	for time.Now().Before(deadline) {
		if l.engine.State() != "starting" {
			return // failed or stopped while we waited
		}
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 700*time.Millisecond)
		if err == nil {
			conn.Close()
			l.engine.mu.Lock()
			l.engine.state = "running"
			l.engine.mu.Unlock()
			url := fmt.Sprintf("http://localhost%s/rs2.cgi", portSuffix(port))
			l.engine.logf("world ready: %s", url)
			if openWhenReady {
				_ = openBrowser(url)
			}
			return
		}
		if time.Since(lastNote) > 20*time.Second {
			l.engine.logf("... still booting (a first boot repacks the cache - this can take minutes)")
			lastNote = time.Now()
		}
		time.Sleep(500 * time.Millisecond)
	}
	l.engine.mu.Lock()
	l.engine.state = "failed"
	l.engine.lastErr = fmt.Sprintf("the web port %d never opened (gave up after 30 minutes)", port)
	l.engine.mu.Unlock()
}

// explainExit turns the usual engine startup failures into one useful line.
func explainExit(err error, tail []string) string {
	joined := strings.Join(tail, "\n")
	switch {
	case strings.Contains(joined, "EADDRINUSE"):
		if i := strings.Index(joined, "port:"); i >= 0 {
			line := strings.TrimSpace(strings.SplitN(joined[i:], "\n", 2)[0])
			return "a port was already taken (" + line + ") - is another server running?"
		}
		return "a port was already taken - is another server running?"
	case strings.Contains(joined, "'bun' is not recognized"), strings.Contains(joined, "bun: command not found"):
		return "this revision's engine runs on bun and it is not installed - fetch it from the Tools chip, then press Start again"
	case strings.Contains(joined, "prisma"), strings.Contains(joined, "P1003"):
		return "the database is not set up yet - run the engine's setup once (npm run setup)"
	case err != nil:
		return "the server exited early: " + err.Error()
	default:
		return "the server exited early - see the log"
	}
}

func revLabel(in *Install) string {
	if in.Rev == "" {
		return "custom"
	}
	return in.Rev
}

func (l *Launcher) StopServer() error {
	l.engine.mu.Lock()
	cmd := l.engine.cmd
	l.engine.state = "stopped"
	l.engine.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return fmt.Errorf("no server is running")
	}
	l.engine.logf("stopping server (pid %d)...", cmd.Process.Pid)
	err := killTree(cmd)
	l.engine.mu.Lock()
	l.engine.cmd = nil
	l.engine.mu.Unlock()
	return err
}

// engineCommand builds the platform-appropriate "npm run quickstart".
func engineCommand() *exec.Cmd {
	if runtime.GOOS == "windows" {
		return exec.Command("cmd.exe", "/c", "npm run quickstart")
	}
	return exec.Command("npm", "run", "quickstart")
}

func npmCommand(args ...string) *exec.Cmd {
	if runtime.GOOS == "windows" {
		full := append([]string{"/c", "npm"}, args...)
		return exec.Command("cmd.exe", full...)
	}
	return exec.Command("npm", args...)
}
