package main

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fullInstall builds an install that looks real enough for the world API: an engine
// tree with a world config, the overlay's own installed.json (the applied mod set),
// and a shipped client bundle (so a digest exists).
func fullInstall(t *testing.T, rev, profile string, mods []string) *Install {
	t.Helper()
	root := t.TempDir()
	engine := filepath.Join(root, "engine")
	for _, d := range []string{
		filepath.Join(engine, "data", "config"),
		filepath.Join(engine, "data", "players", profile),
		filepath.Join(engine, "public", "lclite"),
		filepath.Join(engine, "public", "client"),
	} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := writeJSONFile(filepath.Join(engine, "data", "config", "world.json"),
		map[string]any{"node": map[string]any{"port": 43594, "profile": profile}}); err != nil {
		t.Fatal(err)
	}
	manifest, err := marshalIndent(map[string]any{"mods": mods, "page": true})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(engine, "public", "lclite", "installed.json"), manifest, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(engine, "public", "client", "client.js"), []byte("// a bundle\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return &Install{ID: rev, Path: root, Rev: rev}
}

func TestAddWorldUpdatesRatherThanDuplicating(t *testing.T) {
	l, err := newLauncher(t.TempDir(), "test")
	if err != nil {
		t.Fatal(err)
	}
	m, _ := testManifest(t)

	if updated := l.store.addWorld(World{Manifest: m, AddedAt: time.Now()}); updated {
		t.Fatal("the first add is not an update")
	}
	l.store.updateWorld(m.ID, func(w *World) { w.Favorite = true; w.Note = "bob's test world" })

	// A fresh code for the same world (same host key) must UPDATE, not duplicate.
	m2 := m
	m2.Description = "now with 2x xp"
	if updated := l.store.addWorld(World{Manifest: m2, AddedAt: time.Now()}); !updated {
		t.Fatal("re-adding a world the player already has must update it")
	}

	cfg := l.store.snapshot()
	if len(cfg.Worlds) != 1 {
		t.Fatalf("expected 1 world after two adds, got %d", len(cfg.Worlds))
	}
	got := cfg.Worlds[0]
	if got.Manifest.Description != "now with 2x xp" {
		t.Fatalf("the host's new description should win, got %q", got.Manifest.Description)
	}
	if !got.Favorite {
		t.Fatal("updating a world must not lose the player's favorite")
	}
	if got.Note != "bob's test world" {
		t.Fatalf("updating a world must not lose the player's note, got %q", got.Note)
	}
}

func TestWorldLookupIsCaseInsensitiveAndRemovalWorks(t *testing.T) {
	l, _ := newLauncher(t.TempDir(), "test")
	m, _ := testManifest(t)
	l.store.addWorld(World{Manifest: m, AddedAt: time.Now()})

	if l.store.snapshot().worldByID(strings.ToUpper(m.ID)) == nil {
		t.Fatal("world lookup should be case-insensitive")
	}
	l.store.removeWorld(strings.ToUpper(m.ID))
	if got := len(l.store.snapshot().Worlds); got != 0 {
		t.Fatalf("expected the world removed, %d left", got)
	}
	if !l.store.updateWorld("nope", func(w *World) {}) {
		// updateWorld on a missing world reports false — asserted the other way below
		t.Log("updateWorld correctly reports a missing world")
	} else {
		t.Fatal("updateWorld must report a missing world")
	}
}

func TestHandleWorldsLeadsWithThisMachineAndSortsFavoritesUp(t *testing.T) {
	l, _ := newLauncher(t.TempDir(), "test")
	l.store.setMyWorld(LocalWorld{Name: "My World"})

	online, _ := testManifest(t)
	offline, _ := testManifest(t)
	fav, _ := testManifest(t)
	offline.Name, fav.Name, online.Name = "Zzz Offline", "Aaa Favorite", "Mmm Online"

	l.store.addWorld(World{Manifest: offline, AddedAt: time.Now(), LastStatus: "offline"})
	l.store.addWorld(World{Manifest: online, AddedAt: time.Now(), LastStatus: "online"})
	l.store.addWorld(World{Manifest: fav, AddedAt: time.Now(), LastStatus: "offline"})
	l.store.updateWorld(fav.ID, func(w *World) { w.Favorite = true })

	rec := httptest.NewRecorder()
	l.handleWorlds(rec, httptest.NewRequest("GET", "/api/worlds", nil))

	var out struct {
		OK     bool        `json:"ok"`
		Worlds []worldView `json:"worlds"`
		My     struct {
			Draft LocalWorld `json:"draft"`
		} `json:"my_world"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if len(out.Worlds) != 4 {
		t.Fatalf("expected this machine + 3 worlds, got %d", len(out.Worlds))
	}
	if !out.Worlds[0].Self {
		t.Fatalf("this machine must lead the list, got %q first", out.Worlds[0].Manifest.Name)
	}
	// An offline favorite outranks an online non-favorite: favorites are pinned.
	if out.Worlds[1].Manifest.Name != "Aaa Favorite" {
		t.Fatalf("a favorite must come next, got %q", out.Worlds[1].Manifest.Name)
	}
	if out.Worlds[2].Manifest.Name != "Mmm Online" {
		t.Fatalf("an online world outranks an offline one, got %q", out.Worlds[2].Manifest.Name)
	}
	if out.My.Draft.Name != "My World" {
		t.Fatalf("expected the host's own draft reported, got %q", out.My.Draft.Name)
	}
}

func TestHandleWorldAddRejectsATamperedCode(t *testing.T) {
	l, _ := newLauncher(t.TempDir(), "test")
	m, _ := testManifest(t)

	// Re-encode the manifest with a changed address but the ORIGINAL signature: this
	// is exactly what editing a forwarded code looks like.
	m.Address = "attacker.example.com:80"
	code, err := EncodeWorldCode(m)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	l.handleWorldAdd(rec, jsonReq(t, map[string]any{"code": code}))
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out["ok"] == true {
		t.Fatal("a code whose manifest was edited after signing must be refused")
	}
	if got := len(l.store.snapshot().Worlds); got != 0 {
		t.Fatalf("a refused code must not be added, %d worlds present", got)
	}
}

func TestHandleWorldAddAcceptsAGoodCodeAndWarnsOnUnsigned(t *testing.T) {
	l, _ := newLauncher(t.TempDir(), "test")

	signed, _ := testManifest(t)
	code, err := EncodeWorldCode(signed)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	l.handleWorldAdd(rec, jsonReq(t, map[string]any{"code": code}))
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out["ok"] != true {
		t.Fatalf("a properly signed code must be accepted: %s", rec.Body.String())
	}
	if out["warning"] != nil && out["warning"] != "" {
		t.Fatalf("a signed world should not warn, got %v", out["warning"])
	}

	// An unsigned world is accepted (a friend testing their own server is not
	// blocked) but must be reported as unverifiable.
	unsigned := WorldManifest{Name: "Homemade", Address: "127.0.0.1:8080"}
	unsigned.Clean()
	ucode, err := EncodeWorldCode(unsigned)
	if err != nil {
		t.Fatal(err)
	}
	rec2 := httptest.NewRecorder()
	l.handleWorldAdd(rec2, jsonReq(t, map[string]any{"code": ucode}))
	var out2 map[string]any
	_ = json.Unmarshal(rec2.Body.Bytes(), &out2)
	if out2["ok"] != true {
		t.Fatalf("an unsigned world should still be addable: %s", rec2.Body.String())
	}
	if s, _ := out2["warning"].(string); s == "" {
		t.Fatal("an unsigned world must come with a warning — the UI has to be able to say it is unverified")
	}
}

func TestHandleWorldCheckGatesOnTheTreeNotTheTickedBoxes(t *testing.T) {
	l, _ := newLauncher(t.TempDir(), "test")
	// The tree says anti-cheat is applied, even if the UI would claim otherwise.
	in := fullInstall(t, "289", "main", []string{"control-panel", "gpu", "anti-cheat"})
	l.store.upsertInstall(in)

	world, _ := testManifest(t) // requires true-tile+gpu, forbids anti-cheat
	l.store.addWorld(World{Manifest: world, AddedAt: time.Now()})

	rec := httptest.NewRecorder()
	l.handleWorldCheck(rec, jsonReq(t, map[string]any{"id": world.ID, "install": "289"}))
	var out struct {
		OK     bool          `json:"ok"`
		Report ModRuleReport `json:"report"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if !out.Report.Blocked {
		t.Fatalf("anti-cheat is applied and forbidden, so this must block: %+v", out.Report)
	}
	if len(out.Report.Refused) != 1 || out.Report.Refused[0] != "anti-cheat" {
		t.Fatalf("expected anti-cheat refused, got %v", out.Report.Refused)
	}
	if len(out.Report.Missing) != 1 || out.Report.Missing[0] != "true-tile" {
		t.Fatalf("expected true-tile missing, got %v", out.Report.Missing)
	}
	if out.Report.Digest == "" {
		t.Fatal("the report should carry a digest of the build that would be served")
	}
	if strings.Contains(strings.Join(out.Report.Applied, ","), "anti-cheat") == false {
		t.Fatal("the report should say what is actually applied")
	}
}

func TestHandleWorldCheckPassesACleanSet(t *testing.T) {
	l, _ := newLauncher(t.TempDir(), "test")
	in := fullInstall(t, "289", "main", []string{"control-panel", "gpu", "true-tile"})
	l.store.upsertInstall(in)
	world, _ := testManifest(t)
	l.store.addWorld(World{Manifest: world, AddedAt: time.Now()})

	rec := httptest.NewRecorder()
	l.handleWorldCheck(rec, jsonReq(t, map[string]any{"id": world.ID, "install": "289"}))
	var out struct {
		Report ModRuleReport `json:"report"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !out.Report.OK || out.Report.Blocked {
		t.Fatalf("a clean set must be allowed through: %+v", out.Report)
	}
	if len(out.Report.Missing) != 0 || len(out.Report.Refused) != 0 {
		t.Fatalf("expected no findings, got %+v", out.Report)
	}
}

// A player can name the target by typing its address instead of pasting a code.
// An address nobody has described carries no rules — but the gate must still
// answer the question it can answer: which build would this install serve?
func TestHandleWorldCheckAcceptsATypedAddress(t *testing.T) {
	l, _ := newLauncher(t.TempDir(), "test")
	in := fullInstall(t, "289", "main", []string{"control-panel", "gpu", "anti-cheat"})
	l.store.upsertInstall(in)
	world, _ := testManifest(t) // requires true-tile+gpu, forbids anti-cheat
	l.store.addWorld(World{Manifest: world, AddedAt: time.Now()})

	type checkOut struct {
		OK     bool          `json:"ok"`
		Report ModRuleReport `json:"report"`
		World  WorldManifest `json:"world"`
	}

	// (a) an address nobody described: nothing to block on, but the applied set
	// and the build digest still come back.
	rec := httptest.NewRecorder()
	l.handleWorldCheck(rec, jsonReq(t, map[string]any{"addr": "play.example.com:443", "install": "289"}))
	var a checkOut
	if err := json.Unmarshal(rec.Body.Bytes(), &a); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if !a.OK {
		t.Fatalf("a typed address must be answerable: %s", rec.Body.String())
	}
	if a.Report.Blocked || len(a.Report.Refused) != 0 || len(a.Report.Missing) != 0 {
		t.Fatalf("an address with no description has no rules to apply: %+v", a.Report)
	}
	if len(a.Report.Applied) == 0 || a.Report.Digest == "" {
		t.Fatalf("the gate must still report the build this install would serve: %+v", a.Report)
	}
	if a.World.Address != "play.example.com:443" {
		t.Fatalf("expected the typed address back, got %q", a.World.Address)
	}

	// (b) the same address written the way a person writes it — scheme, caps, a
	// trailing slash — is the saved world, so its rules DO apply.
	rec2 := httptest.NewRecorder()
	l.handleWorldCheck(rec2, jsonReq(t, map[string]any{"addr": "https://192.168.1.20:8080/", "install": "289"}))
	var b checkOut
	if err := json.Unmarshal(rec2.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec2.Body.String())
	}
	if !b.Report.Blocked || len(b.Report.Refused) != 1 || b.Report.Refused[0] != "anti-cheat" {
		t.Fatalf("a typed address must still meet that world's rules: %+v", b.Report)
	}
	if b.World.ID != world.ID {
		t.Fatalf("expected the saved world to be the one gated, got %q", b.World.ID)
	}
}

func TestSameWorldAddrIgnoresSchemeCaseAndTrailingSlash(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"play.example.com:443", "play.example.com:443", true},
		{"https://Play.Example.com:443/", "play.example.com:443", true},
		{"http://play.example.com", "play.example.com", true},
		{"192.168.1.20:8080", "http://192.168.1.20:8080", true},
		{"play.example.com:443", "play.example.com:8080", false},
		// Two blanks are never "the same server" — that is how a missing address
		// would otherwise silently match the first world in the list.
		{"", "", false},
		{"  ", "", false},
	}
	for _, c := range cases {
		if got := sameWorldAddr(c.a, c.b); got != c.want {
			t.Errorf("sameWorldAddr(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

// Your own invite code is not a world to import: the list already leads with that
// world, so storing it again would show one server twice — and the join gate would
// then check you against your own rules as if you were a guest.
func TestHandleWorldAddRecognisesYourOwnCode(t *testing.T) {
	l, _ := newLauncher(t.TempDir(), "test")
	priv, err := l.store.hostKey()
	if err != nil {
		t.Fatalf("host key: %v", err)
	}
	m := l.localWorldManifest()
	m.Name = "My own 289"
	m.Address = "192.168.1.5:80"
	if err := m.Sign(priv); err != nil {
		t.Fatalf("sign: %v", err)
	}
	code, err := EncodeWorldCode(m)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	rec := httptest.NewRecorder()
	l.handleWorldAdd(rec, jsonReq(t, map[string]any{"code": code}))
	var out struct {
		OK   bool   `json:"ok"`
		Self bool   `json:"self"`
		ID   string `json:"id"`
		W    struct {
			ID string `json:"id"`
		} `json:"world"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if !out.OK || !out.Self {
		t.Fatalf("a code for this launcher's own world must come back as self: %s", rec.Body.String())
	}
	if out.W.ID != m.ID {
		t.Fatalf("expected the manifest to be handed back, got %q", out.W.ID)
	}
	if n := len(l.store.snapshot().Worlds); n != 0 {
		t.Fatalf("your own world must not be stored as somebody else's: %d saved", n)
	}
}

func TestHandleWorldPublishSignsAndRefusesContradictions(t *testing.T) {
	l, _ := newLauncher(t.TempDir(), "test")

	rec := httptest.NewRecorder()
	l.handleWorldPublish(rec, jsonReq(t, map[string]any{
		"name": "Bob's 289", "description": "slow xp",
		"mods_required": []string{"gpu"}, "mods_forbidden": []string{"anti-cheat"},
		"allow_save_import": true,
	}))
	var out struct {
		OK         bool          `json:"ok"`
		Manifest   WorldManifest `json:"manifest"`
		Code       string        `json:"code"`
		Fingerprint string       `json:"fingerprint"`
		Error      string        `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if !out.OK {
		t.Fatalf("publish failed: %s", out.Error)
	}
	if err := out.Manifest.Verify(); err != nil {
		t.Fatalf("a published manifest must verify: %v", err)
	}
	if out.Fingerprint == "" {
		t.Fatal("publish should report the key fingerprint so a host can read it out")
	}
	if out.Manifest.Rev != "" {
		t.Fatalf("no world is running, so no revision should be claimed, got %q", out.Manifest.Rev)
	}
	if !out.Manifest.AllowSaveImport {
		t.Fatal("the save-import flag should survive publishing")
	}

	// The code round-trips through the real import path.
	rec2 := httptest.NewRecorder()
	l.handleWorldAdd(rec2, jsonReq(t, map[string]any{"code": out.Code}))
	var added map[string]any
	_ = json.Unmarshal(rec2.Body.Bytes(), &added)
	if added["ok"] != true {
		t.Fatalf("a world's own published code must import: %s", rec2.Body.String())
	}

	// A contradiction is a host typo and must be refused at publish time.
	rec3 := httptest.NewRecorder()
	l.handleWorldPublish(rec3, jsonReq(t, map[string]any{
		"name": "Impossible", "mods_required": []string{"gpu"}, "mods_forbidden": []string{"gpu"},
	}))
	var bad map[string]any
	_ = json.Unmarshal(rec3.Body.Bytes(), &bad)
	if bad["ok"] == true {
		t.Fatal("a world requiring and forbidding the same mod must be refused")
	}

	// A nameless world too.
	rec4 := httptest.NewRecorder()
	l.handleWorldPublish(rec4, jsonReq(t, map[string]any{"name": "   "}))
	var blank map[string]any
	_ = json.Unmarshal(rec4.Body.Bytes(), &blank)
	if blank["ok"] == true {
		t.Fatal("a nameless world must be refused")
	}
}

// The management port is the one real security finding here, so its detector gets a
// test against a real listener rather than a mocked one.
func TestManagementExposedFindsAListenerOnALanAddress(t *testing.T) {
	ips := lanAddrs()
	if len(ips) == 0 {
		t.Skip("no non-loopback address on this machine")
	}
	ln, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		t.Skipf("could not bind a test listener: %v", err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	exposed, where := managementExposed(port)
	if !exposed {
		t.Fatalf("a listener on 0.0.0.0:%d must be detected as exposed (addresses: %v)", port, ips)
	}
	if !strings.Contains(where, ":") {
		t.Fatalf("expected the offending address reported, got %q", where)
	}

	// And a port nothing is on must read as closed.
	ln.Close()
	if exposed, _ := managementExposed(port); exposed {
		t.Fatal("a closed port must not read as exposed")
	}
}

func TestHandleSavesListsCharactersAndVaultState(t *testing.T) {
	l, _ := newLauncher(t.TempDir(), "test")
	in := fullInstall(t, "289", "main", []string{"control-panel"})
	l.store.upsertInstall(in)
	if err := os.WriteFile(filepath.Join(saveDir(in.engineDir()), "alice.sav"), makeSave([]byte("alice")), 0o644); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	l.handleSaves(rec, httptest.NewRequest("GET", "/api/saves?install=289", nil))
	var out struct {
		OK      bool       `json:"ok"`
		Install string     `json:"install"`
		Saves   []SaveFile `json:"saves"`
		Profile string     `json:"profile"`
		Running bool       `json:"running"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if !out.OK || out.Install != "289" {
		t.Fatalf("unexpected response: %s", rec.Body.String())
	}
	if len(out.Saves) != 1 || out.Saves[0].Username != "alice" || !out.Saves[0].Intact {
		t.Fatalf("expected alice intact, got %+v", out.Saves)
	}
	if out.Profile != "main" {
		t.Fatalf("expected the profile reported, got %q", out.Profile)
	}

	// Vault the character, then the listing should say so.
	if _, err := l.VaultStore(in, "local", "This machine", "alice", nil); err != nil {
		t.Fatalf("vault: %v", err)
	}
	rec2 := httptest.NewRecorder()
	l.handleSaves(rec2, httptest.NewRequest("GET", "/api/saves?install=289", nil))
	var out2 struct {
		Saves []SaveFile `json:"saves"`
	}
	_ = json.Unmarshal(rec2.Body.Bytes(), &out2)
	if !out2.Saves[0].InVault {
		t.Fatal("a character that has been vaulted should say so")
	}
}

func TestHandleSaveImportHonoursTheWorldsPolicy(t *testing.T) {
	l, _ := newLauncher(t.TempDir(), "test")
	in := fullInstall(t, "289", "main", nil)
	l.store.upsertInstall(in)

	src := filepath.Join(t.TempDir(), "alice.sav")
	if err := os.WriteFile(src, makeSave([]byte("alice")), 0o644); err != nil {
		t.Fatal(err)
	}

	// A world that does not allow imports must be respected.
	rec := httptest.NewRecorder()
	l.handleSaveImport(rec, jsonReq(t, map[string]any{
		"install": "289", "path": src, "username": "alice", "world_allows": false,
	}))
	var refused map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &refused)
	if refused["ok"] == true {
		t.Fatal("importing into a world that does not accept characters must be refused")
	}

	// And allowed when the world says so.
	rec2 := httptest.NewRecorder()
	l.handleSaveImport(rec2, jsonReq(t, map[string]any{
		"install": "289", "path": src, "username": "alice", "world_allows": true,
	}))
	var allowed map[string]any
	_ = json.Unmarshal(rec2.Body.Bytes(), &allowed)
	if allowed["ok"] != true {
		t.Fatalf("an allowed import should succeed: %s", rec2.Body.String())
	}
	if _, err := os.Stat(filepath.Join(saveDir(in.engineDir()), "alice.sav")); err != nil {
		t.Fatalf("the character should be on disk: %v", err)
	}
}

// The UI reads specific keys straight out of these JSON payloads. A rename here does
// not fail loudly — the card still renders (it reads other keys) and only one action
// silently does nothing. That is exactly how `bridgeToWorld` came to read `address`
// while the manifest shipped `addr`: the world showed its address on the card and
// then refused to join it. So the contract is pinned here.
func TestJSONKeysTheUIActuallyReads(t *testing.T) {
	t.Run("world manifest", func(t *testing.T) {
		m := WorldManifest{
			Version: 1, ID: "w1", Name: "n", Description: "d", Address: "a:1", Rev: "289",
			ModsRequired: []string{"x"}, ModsForbidden: []string{"y"}, AllowSaveImport: true,
			Host: "h", PubKey: "k", Sig: "s", CreatedAt: time.Now(),
		}
		raw, err := json.Marshal(m)
		if err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		// The page reads: m.name, m.desc, m.addr, m.rev, m.req, m.ban, m.save, m.host,
		// m.id, and v.fingerprint off the view.
		for _, k := range []string{"id", "name", "desc", "addr", "rev", "req", "ban", "save", "host", "key", "sig"} {
			if _, ok := got[k]; !ok {
				t.Errorf("a world manifest must ship %q — the UI reads it", k)
			}
		}
	})

	t.Run("world view", func(t *testing.T) {
		raw, err := json.Marshal(worldView{
			World: &World{Manifest: WorldManifest{Name: "n"}, Favorite: true},
			Self:  true, Online: true, Status: "online", Signed: true, Fingerprint: "fp", Code: "c",
		})
		if err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		for _, k := range []string{"self", "online", "status", "signed", "fingerprint", "code", "favorite", "manifest"} {
			if _, ok := got[k]; !ok {
				t.Errorf("a world view must ship %q — the UI reads it", k)
			}
		}
	})

	t.Run("install view", func(t *testing.T) {
		// The Join panel says which client it would serve and how many mods that
		// tree really has applied, so the key has to be there (and the count has
		// to come from the tree, not from the record's last apply).
		in := fullInstall(t, "289", "main", []string{"control-panel", "gpu"})
		raw, err := json.Marshal(installView{Install: in})
		if err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		for _, k := range []string{"id", "rev_label", "mods_available", "mods_applied", "client_bundle", "has_engine", "missing"} {
			if _, ok := got[k]; !ok {
				t.Errorf("an install view must ship %q — the UI reads it", k)
			}
		}
	})

	t.Run("host draft", func(t *testing.T) {
		// The host form posts these names to /api/world/publish.
		raw, err := json.Marshal(LocalWorld{
			Name: "n", Description: "d", HostName: "h", Address: "a:1",
			ModsRequired: []string{"x"}, ModsForbidden: []string{"y"}, AllowSaveImport: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		for _, k := range []string{"name", "description", "host_name", "address", "mods_required", "mods_forbidden", "allow_save_import"} {
			if _, ok := got[k]; !ok {
				t.Errorf("the host draft must ship %q — the form posts it", k)
			}
		}
	})

	t.Run("mod rule report", func(t *testing.T) {
		raw, err := json.Marshal(ModRuleReport{OK: true, Blocked: false, Refused: []string{}, Missing: []string{},
			Unknown: []string{}, Applied: []string{}, Digest: "d"})
		if err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		for _, k := range []string{"ok", "blocked", "refused", "missing", "unknown", "applied", "digest"} {
			if _, ok := got[k]; !ok {
				t.Errorf("a mod rule report must ship %q — the UI reads it", k)
			}
		}
	})

	t.Run("save file", func(t *testing.T) {
		raw, err := json.Marshal(SaveFile{Username: "u", Profile: "p", Path: "x", Size: 1,
			Modified: time.Now(), Intact: true, InVault: true})
		if err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		for _, k := range []string{"username", "profile", "path", "size", "modified", "intact", "in_vault"} {
			if _, ok := got[k]; !ok {
				t.Errorf("a save file must ship %q — the UI reads it", k)
			}
		}
	})
}

// jsonReq builds a POST request carrying a JSON body, for calling a handler directly
// (bypassing the token guard, which is not what these tests are about).
func jsonReq(t *testing.T, body any) *http.Request {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return httptest.NewRequest("POST", "/api/x", strings.NewReader(string(raw)))
}
