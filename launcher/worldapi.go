package main

// World API — the HTTP surface behind the Worlds panel.
//
// Shape of the thing: there is no directory service, so a "world list" is local
// state plus a pasteable invite code. Everything here is either (a) reading what
// this launcher knows, or (b) a file/bytes operation the launcher performs on trees
// it owns. Nothing here talks to the game protocol, and nothing here can enforce a
// rule against a client that lies — see worlds.go for why that is stated up front
// rather than papered over.

import (
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
)

// worldView is one world as the UI sees it.
type worldView struct {
	*World
	// Self marks the world this machine is running.
	Self bool `json:"self,omitempty"`
	// Online/Status come from the last probe, never from the manifest — a host
	// cannot declare itself up.
	Online bool   `json:"online"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
	// Signed/VerifyError describe the host's signature over the manifest.
	Signed      bool   `json:"signed"`
	VerifyError string `json:"verify_error,omitempty"`
	Fingerprint string `json:"fingerprint,omitempty"`
	// Code re-shares this world. A world is only as portable as its code, so the
	// list can always hand one back.
	Code string `json:"code,omitempty"`
}

// ---- probing ---------------------------------------------------------------

// probeWorld asks a world whether it is up.
//
// It dials and then reads the page rather than just checking a port, because "a
// socket answered" is not the same as "this is a Lost City world" — and a player
// deserves to be told which one they are looking at.
func probeWorld(addr string, client *http.Client) (online bool, status, detail string) {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return false, "unknown", "no address"
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		host = addr
	}
	if strings.TrimSpace(host) == "" {
		return false, "unknown", "no address"
	}

	// Cheapest question first: is anything listening at all?
	conn, err := net.DialTimeout("tcp", addr, 2500*time.Millisecond)
	if err != nil {
		return false, "offline", "nothing is listening"
	}
	_ = conn.Close()

	url := "http://" + addr + "/rs2.cgi"
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return false, "unknown", "that address could not be parsed"
	}
	resp, err := client.Do(req)
	if err != nil {
		return false, "not-a-world", "something is listening but it does not serve a game page"
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))

	if resp.StatusCode != http.StatusOK {
		return false, "not-a-world", fmt.Sprintf("the page answered %s", resp.Status)
	}
	if !looksLikeLostCity(string(body)) {
		return false, "not-a-world", "that address serves a page, but not a Lost City world"
	}
	return true, "online", ""
}

// looksLikeLostCity checks for the client entry point the engine's own page template
// ships (upstream's pristine client.ejs has it too, so this is not an LCLite marker).
func looksLikeLostCity(body string) bool {
	return strings.Contains(body, "client/client.js") || strings.Contains(body, "2004Scape")
}

// ---- LAN address -----------------------------------------------------------

// lanAddrs lists this machine's non-loopback IPv4 addresses, best-guess first, so a
// host has something concrete to advertise instead of "0.0.0.0".
func lanAddrs() []string {
	out := []string{}
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := ifc.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipnet.IP.To4()
			if ip4 == nil || ip4.IsLoopback() || ip4.IsLinkLocalUnicast() {
				continue
			}
			out = append(out, ip4.String())
		}
	}
	sort.Strings(out)
	return out
}

// managementExposed reports whether the world's management port answers on a
// non-loopback address.
//
// This is the one finding here that is a genuine security problem rather than a
// caveat: the engine's management server binds 0.0.0.0 with NO authentication, and
// PUT /setup/config rewrites the world's own config (ports, save profile, login
// settings). So "list my world" must not quietly tell somebody to open that port.
//
// A bind probe would lie (Go sets SO_EXCLUSIVEADDRUSE and a wildcard bind still
// succeeds next to a live listener), so this dials the real interface addresses.
func managementExposed(port int) (bool, string) {
	if port <= 0 {
		return false, ""
	}
	for _, ip := range lanAddrs() {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", ip, port), 1200*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return true, fmt.Sprintf("%s:%d", ip, port)
		}
	}
	return false, ""
}

// ---- views -----------------------------------------------------------------

func (l *Launcher) viewWorld(w *World) worldView {
	v := worldView{World: w, Status: "unknown", Online: false}
	if w.LastStatus != "" {
		v.Status = w.LastStatus
		v.Online = w.LastStatus == "online"
	}
	if w.Manifest.Signed() {
		if err := w.Manifest.Verify(); err != nil {
			v.VerifyError = err.Error()
		} else {
			v.Signed = true
			v.Fingerprint = w.Manifest.KeyFingerprint()
		}
	}
	if code, err := EncodeWorldCode(w.Manifest); err == nil {
		v.Code = code
	}
	return v
}

// localWorldManifest builds the manifest for the world THIS machine runs, from the
// host's own description plus the running install's revision.
func (l *Launcher) localWorldManifest() WorldManifest {
	cfg := l.store.snapshot()
	lw := cfg.MyWorld
	m := WorldManifest{
		Name:          lw.Name,
		Description:   lw.Description,
		Host:          lw.HostName,
		ModsRequired:  lw.ModsRequired,
		ModsForbidden: lw.ModsForbidden,
		Address:       lw.Address,
	}
	// The revision is a fact about the running install, not something to type.
	if id := l.engine.InstallID(); id != "" {
		if in := cfg.findInstall(id); in != nil {
			m.Rev = in.Rev
		}
	}
	// Derive an address when the host has not pinned one.
	if strings.TrimSpace(m.Address) == "" {
		if port := l.engineWebPort(); port > 0 {
			if ips := lanAddrs(); len(ips) > 0 {
				m.Address = fmt.Sprintf("%s:%d", ips[0], port)
			}
		}
	}
	m.Clean()
	return m
}

// localWorldView is the "this machine" card, which always leads the list.
func (l *Launcher) localWorldView() worldView {
	m := l.localWorldManifest()
	w := &World{Manifest: m}
	st := l.engine.Status()
	running, _ := st["running"].(bool)
	v := worldView{World: w, Self: true}
	if running {
		v.Online = true
		v.Status = "online"
	} else {
		v.Status = "offline"
		v.Detail = "not running"
	}
	if priv, err := l.store.hostKey(); err == nil {
		if err := m.Sign(priv); err == nil {
			w.Manifest = m
			v.Signed = true
			v.Fingerprint = m.KeyFingerprint()
			if code, err := EncodeWorldCode(m); err == nil {
				v.Code = code
			}
		}
	}
	return v
}

// describeJoin works out which world a bridge is serving, so the panel can say
// something better than an address.
//
// The order is deliberate: an explicit id first (a world card, or "self" for the
// world this machine runs), then the address the player typed — which may well be a
// world already in the list, in which case its name, description and rules apply.
// An address nobody has described leaves the name empty on purpose: the panel says
// "nobody has described this server" rather than inventing one.
func (l *Launcher) describeJoin(worldID, addr string, in *Install) JoinedWorld {
	cfg := l.store.snapshot()
	worldID = strings.TrimSpace(worldID)
	addr = strings.TrimSpace(addr)

	var m WorldManifest
	self := false
	switch {
	case strings.EqualFold(worldID, "self"):
		m, self = l.localWorldManifest(), true
		// This machine's own world is signed like any other, so its card and the
		// joined panel agree about its identity.
		if priv, err := l.store.hostKey(); err == nil {
			_ = m.Sign(priv)
		}
	case worldID != "":
		if x := cfg.worldByID(worldID); x != nil {
			m = x.Manifest
		}
	default:
		if x := cfg.worldByAddr(addr); x != nil {
			m = x.Manifest
		}
	}
	// A world id nobody knows (its card was forgotten between the click and the
	// request) still gets the address, so the panel can at least name the server.
	if m.Address == "" {
		m.Address = addr
	}

	j := JoinedWorld{
		ID: m.ID, Name: m.Name, Description: m.Description, Host: m.Host,
		Address: m.Address, Rev: m.Rev,
		Required: m.ModsRequired, Forbidden: m.ModsForbidden,
		Self: self, Since: time.Now(),
	}
	if m.Signed() && m.Verify() == nil {
		j.Signed = true
		j.Fingerprint = m.KeyFingerprint()
	}
	if in != nil {
		j.Install = in.ID
		j.Mods = appliedMods(in)
	}
	return j
}

// sortWorlds orders the list the way a player reads it: this machine, then the
// favorites they pinned, then whatever is up, then the rest.
func sortWorlds(list []worldView) {
	sort.SliceStable(list, func(i, j int) bool {
		a, b := list[i], list[j]
		if a.Self != b.Self {
			return a.Self
		}
		if a.Favorite != b.Favorite {
			return a.Favorite
		}
		if a.Online != b.Online {
			return a.Online
		}
		return strings.ToLower(a.Manifest.Name) < strings.ToLower(b.Manifest.Name)
	})
}

// ---- handlers --------------------------------------------------------------

// handleWorlds reads the list. It never probes: the UI polls /api/state every 2.5s
// and a network round trip per world per poll is not a thing that should happen.
func (l *Launcher) handleWorlds(w http.ResponseWriter, r *http.Request) {
	cfg := l.store.snapshot()
	views := make([]worldView, 0, len(cfg.Worlds)+1)
	views = append(views, l.localWorldView())
	for _, x := range cfg.Worlds {
		views = append(views, l.viewWorld(x))
	}
	sortWorlds(views)

	mgmtExposed := false
	mgmtWhere := ""
	if p := l.engineManagementPort(); p > 0 {
		mgmtExposed, mgmtWhere = managementExposed(p)
	}

	writeJSON(w, map[string]any{
		"ok":     true,
		"worlds": views,
		"my_world": map[string]any{
			"draft":     cfg.MyWorld,
			"manifest":  l.localWorldManifest(),
			"addresses": lanAddrs(),
			"rev":       l.runningRev(),
		},
		"host_key_fingerprint": l.hostFingerprint(),
		"management": map[string]any{
			"port":    l.engineManagementPort(),
			"exposed": mgmtExposed,
			"where":   mgmtWhere,
		},
	})
}

func (l *Launcher) runningRev() string {
	cfg := l.store.snapshot()
	if id := l.engine.InstallID(); id != "" {
		if in := cfg.findInstall(id); in != nil {
			return in.Rev
		}
	}
	return ""
}

// hostWorldID is the id this launcher's own world carries — derived from the host
// key, exactly as any world's id is, so a code for your own world can be
// recognized instead of stored twice.
func (l *Launcher) hostWorldID() string {
	priv, err := l.store.hostKey()
	if err != nil {
		return ""
	}
	pub, ok := priv.Public().(ed25519.PublicKey)
	if !ok {
		return ""
	}
	return worldIDFor(base64.StdEncoding.EncodeToString(pub))
}

func (l *Launcher) hostFingerprint() string {
	priv, err := l.store.hostKey()
	if err != nil {
		return ""
	}
	var m WorldManifest
	if err := m.Sign(priv); err != nil {
		return ""
	}
	return m.KeyFingerprint()
}

// engineWebPort is the web port of the world this machine is running (0 when
// nothing is up — a world that is not running has no address to advertise).
func (l *Launcher) engineWebPort() int {
	st := l.engine.Status()
	if p, ok := st["port"].(int); ok {
		return p
	}
	return 0
}

// engineManagementPort is the /setup port of the running world (0 when nothing is
// up). It is the one port that must not be exposed — see managementExposed.
func (l *Launcher) engineManagementPort() int {
	return l.engine.MgmtPort()
}

// handleWorldAdd imports a world from a pasted invite code.
func (l *Launcher) handleWorldAdd(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code string `json:"code"`
	}
	if err := decode(r, &req); err != nil {
		fail(w, err)
		return
	}
	m, err := DecodeWorldCode(req.Code)
	if err != nil {
		fail(w, err)
		return
	}
	// A code for the world THIS launcher hosts is not a new world: the list already
	// leads with it. Storing it would show the same server twice, and gate the
	// player against their own rules — so it is recognized instead.
	if own := l.hostWorldID(); own != "" && m.ID == own {
		ok(w, map[string]any{"world": m, "self": true, "updated": false})
		return
	}
	// A code is only worth trusting if the host signed it. An unsigned manifest is
	// still accepted — a friend testing their own world should not be blocked — but
	// it is reported as unsigned rather than silently trusted.
	verifyErr := ""
	if m.Signed() {
		if err := m.Verify(); err != nil {
			fail(w, fmt.Errorf("that world code failed its signature check: %v", err))
			return
		}
	} else {
		verifyErr = "this world is unsigned, so nothing about it can be verified"
	}

	existed := l.store.addWorld(World{Manifest: m, AddedAt: time.Now(), LastStatus: "unknown"})
	ok(w, map[string]any{"world": m, "updated": existed, "warning": verifyErr})
}

func (l *Launcher) handleWorldRemove(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if err := decode(r, &req); err != nil {
		fail(w, err)
		return
	}
	l.store.removeWorld(req.ID)
	ok(w, nil)
}

func (l *Launcher) handleWorldFavorite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID       string `json:"id"`
		Favorite bool   `json:"favorite"`
	}
	if err := decode(r, &req); err != nil {
		fail(w, err)
		return
	}
	if !l.store.updateWorld(req.ID, func(x *World) { x.Favorite = req.Favorite }) {
		fail(w, fmt.Errorf("no world with that id"))
		return
	}
	ok(w, nil)
}

// handleWorldRefresh probes every saved world and remembers what it saw.
func (l *Launcher) handleWorldRefresh(w http.ResponseWriter, r *http.Request) {
	cfg := l.store.snapshot()
	type result struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Detail string `json:"detail,omitempty"`
	}
	results := make([]result, 0, len(cfg.Worlds))
	for _, x := range cfg.Worlds {
		_, status, detail := probeWorld(x.Manifest.Address, l.httpClient)
		l.store.updateWorld(x.Manifest.ID, func(y *World) {
			y.LastStatus = status
			if status == "online" {
				y.LastSeen = time.Now()
			}
		})
		results = append(results, result{ID: x.Manifest.ID, Status: status, Detail: detail})
	}
	ok(w, map[string]any{"results": results, "at": time.Now()})
}

// handleWorldCheck answers "can I join this with what I have?" — the mod-rule gate.
//
// The target is named one of two ways: an id (a saved world, or "self"), or an
// address the player typed. An address that belongs to a saved world is gated by
// that world's rules; an address nobody described has no rules to apply, so the
// answer is just "here is what your build would serve" — the same question, asked
// about a server nobody has handed you a description of.
//
// The answer describes the build the install would REALLY serve (read from the
// tree's own installed.json), not what the UI had ticked.
func (l *Launcher) handleWorldCheck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID      string `json:"id"`
		Addr    string `json:"addr"`
		Install string `json:"install"`
	}
	if err := decode(r, &req); err != nil {
		fail(w, err)
		return
	}

	cfg := l.store.snapshot()
	addr := strings.TrimSpace(req.Addr)
	var m WorldManifest
	switch {
	case req.ID != "" && req.ID != "self":
		x := cfg.worldByID(req.ID)
		if x == nil {
			fail(w, fmt.Errorf("no world with that id"))
			return
		}
		m = x.Manifest
	case addr != "":
		m = WorldManifest{Address: addr}
		if x := cfg.worldByAddr(addr); x != nil {
			m = x.Manifest
		}
	default:
		m = l.localWorldManifest()
	}

	in := cfg.findInstall(req.Install)
	if in == nil {
		if len(cfg.Installs) == 1 {
			in = cfg.Installs[0]
		} else {
			fail(w, fmt.Errorf("choose which install to play with first"))
			return
		}
	}

	applied := appliedMods(in)
	known := []string{}
	for _, mi := range listModsFromOverlay(l.overlayFor(in), in.Rev) {
		known = append(known, mi.Name)
	}
	rep := EvaluateModRules(applied, m.ModsRequired, m.ModsForbidden, known)
	rep.Digest = bundleDigest(in)

	// Which installs could serve this world's revision at all.
	matching := []string{}
	for _, cand := range cfg.Installs {
		if m.Rev == "" || cand.Rev == m.Rev {
			matching = append(matching, cand.ID)
		}
	}

	writeJSON(w, map[string]any{
		"ok": true, "report": rep,
		"world":       m,
		"install":     in.ID,
		"install_rev": in.Rev,
		"rev_match":   matching,
		"rev_ok":      m.Rev == "" || m.Rev == in.Rev,
	})
}

// ---- the host's own world --------------------------------------------------

// handleWorldPublish saves the host's description and hands back a signed invite
// code. Nothing leaves the machine: "listing" a world means keeping a signed card
// ready to paste.
func (l *Launcher) handleWorldPublish(w http.ResponseWriter, r *http.Request) {
	var req struct {
		LocalWorld
		// AllowExposed is the explicit "I know the management port is open" opt-in.
		AllowExposed bool `json:"allow_exposed"`
	}
	if err := decode(r, &req); err != nil {
		fail(w, err)
		return
	}
	lw := req.LocalWorld
	lw.Name = strings.TrimSpace(lw.Name)
	lw.Description = strings.TrimSpace(lw.Description)
	lw.HostName = strings.TrimSpace(lw.HostName)
	lw.Address = strings.TrimSpace(lw.Address)
	lw.ModsRequired = normMods(lw.ModsRequired)
	lw.ModsForbidden = normMods(lw.ModsForbidden)

	// Refuse to publish a description a player could not act on.
	probe := WorldManifest{
		Name: lw.Name, Description: lw.Description,
		ModsRequired: lw.ModsRequired, ModsForbidden: lw.ModsForbidden,
	}
	probe.Clean()
	if err := probe.Validate(); err != nil {
		fail(w, err)
		return
	}

	// The management-port gate. The engine's management server has no auth and
	// rewrites the world's own config, so publishing while it answers on a LAN
	// address is a foot-gun worth stopping.
	if p := l.engineManagementPort(); p > 0 {
		if exposed, where := managementExposed(p); exposed && !req.AllowExposed {
			fail(w, fmt.Errorf("your world's management page is answering on %s — it has no password and can rewrite this world's config, so close that port (or bind it to localhost) before listing the world", where))
			return
		}
	}

	l.store.setMyWorld(lw)

	priv, err := l.store.hostKey()
	if err != nil {
		fail(w, err)
		return
	}
	m := l.localWorldManifest()
	if err := m.Sign(priv); err != nil {
		fail(w, err)
		return
	}
	code, err := EncodeWorldCode(m)
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, map[string]any{
		"manifest": m, "code": code,
		"fingerprint": m.KeyFingerprint(),
		"length":      len(code),
	})
}

// ---- saves -----------------------------------------------------------------

func (l *Launcher) saveInstall(w http.ResponseWriter, r *http.Request, id string) *Install {
	cfg := l.store.snapshot()
	in := cfg.findInstall(id)
	if in == nil {
		if len(cfg.Installs) == 1 {
			return cfg.Installs[0]
		}
		fail(w, fmt.Errorf("choose an install first"))
		return nil
	}
	return in
}

func (l *Launcher) handleSaves(w http.ResponseWriter, r *http.Request) {
	in := l.saveInstall(w, r, r.URL.Query().Get("install"))
	if in == nil {
		return
	}
	writeJSON(w, map[string]any{
		"ok": true, "install": in.ID, "saves": ListSaves(in),
		"profile": saveProfile(in.engineDir()),
		"dir":     saveDir(in.engineDir()),
		// A running world rewrites these files on logout and autosave, so the panel
		// says so rather than letting somebody poke at them mid-session.
		"running": l.engine.Busy() && strings.EqualFold(l.engine.InstallID(), in.ID),
	})
}

// handleSaveReveal opens the world's save folder in the desktop's file manager.
//
// This is the whole of "manage your saves": the launcher shows you the files and
// hands you the folder, because Explorer/Finder is better at copying, deleting and
// restoring than a 8 MB launcher will ever be — and a launcher deleting a player's
// character is a bug waiting to happen.
func (l *Launcher) handleSaveReveal(w http.ResponseWriter, r *http.Request) {
	in := l.saveInstall(w, r, r.URL.Query().Get("install"))
	if in == nil {
		return
	}
	dir, err := ensureSaveDir(in)
	if err != nil {
		fail(w, err)
		return
	}
	if err := openPath(dir); err != nil {
		fail(w, fmt.Errorf("could not open %s: %v", dir, err))
		return
	}
	ok(w, map[string]any{"dir": dir})
}

// ensureSaveDir makes sure a world has a save folder and returns it.
//
// A world nobody has logged into yet has no players/ folder; making it beats
// refusing to open anything, and it is the same path the engine creates on first
// login. Split out from the handler so the "where" is testable without a test run
// launching a file manager window.
func ensureSaveDir(in *Install) (string, error) {
	dir := saveDir(in.engineDir())
	if _, err := os.Stat(dir); err != nil {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", fmt.Errorf("could not create %s: %v", dir, err)
		}
	}
	return dir, nil
}
