package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// fullInstall builds an install that looks real enough for the API: an engine tree
// with a world config, the overlay's own installed.json (the applied mod set), and a
// shipped client bundle.
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

// The UI reads specific keys straight out of these JSON payloads. A rename here does
// not fail loudly — the panel still renders (it reads other keys) and only one action
// silently does nothing. So the contract is pinned here.
func TestJSONKeysTheUIActuallyReads(t *testing.T) {
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

	t.Run("proxy status and the joined world", func(t *testing.T) {
		// The Join panel decides what to show from /api/state's proxy block, and the
		// joined card is rendered straight off these keys: the address the bridge
		// dials, and this end's half of the join (the install being served and the
		// mods that tree really has applied).
		p := &Proxy{srv: &http.Server{}, port: 8890, useLocal: true}
		p.target = &url.URL{Scheme: "http", Host: "play.example.com:443"}
		p.SetJoined(JoinedWorld{
			Address: "http://play.example.com:443", Install: "289",
			Mods: []string{"gpu"}, Since: time.Now(),
		})
		st := p.Status()
		for _, k := range []string{"running", "port", "local_client", "target", "url", "joined"} {
			if _, ok := st[k]; !ok {
				t.Errorf("the proxy status must ship %q — the UI reads it", k)
			}
		}
		raw, err := json.Marshal(st["joined"])
		if err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		for _, k := range []string{"addr", "install", "mods"} {
			if _, ok := got[k]; !ok {
				t.Errorf("the joined world must ship %q — the panel renders it", k)
			}
		}

		// And a stopped bridge must not claim to be joined to anything: the detail
		// describes a live tunnel.
		stopped := &Proxy{port: 8890}
		if _, ok := stopped.Status()["joined"]; ok {
			t.Error("a stopped proxy must not report a joined world")
		}
	})

	t.Run("state the wizard reads", func(t *testing.T) {
		// The Welcome slide counts revisions and names them from revs_full, and the
		// picker marks each one from it. A renamed key would not fail loudly: the
		// chip would just stop appearing.
		l, err := newLauncher(t.TempDir(), "test", true)
		if err != nil {
			t.Fatal(err)
		}
		rec := httptest.NewRecorder()
		l.handleState(rec, httptest.NewRequest("GET", "/api/state", nil))
		var got map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("state is not JSON: %v", err)
		}
		for _, k := range []string{"version", "revs", "revs_full", "overlay_revs", "overlay", "installs", "tools", "engine", "proxy", "job"} {
			if _, ok := got[k]; !ok {
				t.Errorf("/api/state must ship %q — the page reads it", k)
			}
		}
		if _, ok := got["binary_size"]; ok {
			t.Error("binary_size is gone from the UI: stop shipping it rather than leaving a field nothing reads")
		}
	})

	t.Run("the overlay button's status", func(t *testing.T) {
		// The update button renders itself from these keys alone: a rename would not
		// fail loudly — the button would just stop explaining itself, and "Offline"
		// would lose the reason it is offline.
		raw, err := json.Marshal(overlayStatus{State: "update", Behind: 2, Dirty: true, Shallow: true,
			Head: "abc", Remote: "def", Path: "C:/x/lclite", Branch: "main", Note: "n", At: time.Now()})
		if err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		for _, k := range []string{"state", "behind", "ahead", "dirty", "shallow", "head", "remote", "path", "branch", "note"} {
			if _, ok := got[k]; !ok {
				t.Errorf("the overlay status must ship %q — the button reads it", k)
			}
		}
	})

	t.Run("save file", func(t *testing.T) {
		raw, err := json.Marshal(SaveFile{Username: "u", Profile: "p", Path: "x", Size: 1,
			Modified: time.Now(), Intact: true})
		if err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		for _, k := range []string{"username", "profile", "path", "size", "modified", "intact"} {
			if _, ok := got[k]; !ok {
				t.Errorf("a save file must ship %q — the UI reads it", k)
			}
		}
	})
}

// The removed world endpoints must be gone, not hidden behind a handler that still
// answers: the routes are the surface, and a 404 is the honest answer.
func TestWorldEndpointsAreGone(t *testing.T) {
	l, err := newLauncher(t.TempDir(), "test", false)
	if err != nil {
		t.Fatal(err)
	}
	h := l.routes()
	for _, path := range []string{
		"/api/worlds", "/api/worlds/add", "/api/worlds/remove", "/api/worlds/favorite",
		"/api/worlds/refresh", "/api/worlds/check", "/api/world/publish",
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("POST", path, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s must be gone, got %d", path, rec.Code)
		}
	}
	// And the two endpoints that stay must still be routed (a token-less request is
	// refused, not 404'd).
	for _, path := range []string{"/api/proxy/start", "/api/proxy/stop", "/api/saves", "/api/saves/reveal",
		"/api/overlay/check", "/api/overlay/update"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("POST", path, nil))
		if rec.Code == http.StatusNotFound {
			t.Errorf("%s must still be routed", path)
		}
	}
}
