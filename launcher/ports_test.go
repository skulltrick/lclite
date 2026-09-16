package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 274+ style: data/config/world.json
func TestPortsJSONStyle(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "data", "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	cfg := `{"easyStartup":false,"web":{"port":80,"managementPort":8898},"node":{"id":10,"port":43594,"production":false}}`
	if err := os.WriteFile(filepath.Join(dir, "data", "config", "world.json"), []byte(cfg), 0o644); err != nil {
		t.Fatal(err)
	}
	web, game, mgmt := enginePorts(dir)
	if web != 80 || game != 43594 || mgmt != 8898 {
		t.Fatalf("read %d/%d/%d, want 80/43594/8898", web, game, mgmt)
	}
	if err := setWorldPorts(dir, 8890, 43596, 8899); err != nil {
		t.Fatal(err)
	}
	if web, game, mgmt = enginePorts(dir); web != 8890 || game != 43596 || mgmt != 8899 {
		t.Fatalf("read back %d/%d/%d, want 8890/43596/8899", web, game, mgmt)
	}
	m, err := readJSONFile(filepath.Join(dir, "data", "config", "world.json"))
	if err != nil {
		t.Fatal(err)
	}
	if web, _ := m["web"].(map[string]any); web["port"].(float64) != 8890 {
		t.Fatal("web.port not updated")
	}
	if node, _ := m["node"].(map[string]any); node["id"].(float64) != 10 || node["production"] != false {
		t.Fatal("clobbered unrelated node config")
	}
}

// 225-254 style: .env scaffolded from .env.example
func TestPortsEnvStyle(t *testing.T) {
	dir := t.TempDir()
	example := "# web server\n# WEB_PORT=80\n# NODE_ID=10\n# NODE_PORT=43594\nNODE_PRODUCTION=false\n"
	if err := os.WriteFile(filepath.Join(dir, ".env.example"), []byte(example), 0o644); err != nil {
		t.Fatal(err)
	}
	if style := worldConfigStyle(dir); style != "env" {
		t.Fatalf("style %q, want env", style)
	}
	web, game, mgmt := enginePorts(dir)
	if web != defaultWebPort() || game != 43594 || mgmt != 8898 {
		t.Fatalf("defaults %d/%d/%d", web, game, mgmt)
	}
	if err := setWorldPorts(dir, 8891, 43597, 8899); err != nil {
		t.Fatal(err)
	}
	if web, game, mgmt = enginePorts(dir); web != 8891 || game != 43597 || mgmt != 8899 {
		t.Fatalf("read back %d/%d/%d, want 8891/43597/8899", web, game, mgmt)
	}
	raw, err := os.ReadFile(filepath.Join(dir, ".env"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if !strings.Contains(text, "WEB_PORT=8891") || !strings.Contains(text, "NODE_PORT=43597") || !strings.Contains(text, "WEB_MANAGEMENT_PORT=8899") {
		t.Fatalf(".env is missing the ports:\n%s", text)
	}
	if !strings.Contains(text, "NODE_PRODUCTION=false") {
		t.Fatal("dropped unrelated keys when scaffolding .env")
	}
	if strings.Contains(text, "# WEB_PORT") {
		t.Fatal("left the commented default behind")
	}
	// writing twice must not append duplicate keys
	if err := setWorldPorts(dir, 80, 43594, 8898); err != nil {
		t.Fatal(err)
	}
	raw2, _ := os.ReadFile(filepath.Join(dir, ".env"))
	if strings.Count(string(raw2), "WEB_PORT=") != 1 || strings.Count(string(raw2), "NODE_PORT=") != 1 {
		t.Fatalf("duplicate keys after a second write:\n%s", string(raw2))
	}
}

// an existing .env always wins over .env.example
func TestEnvPrefersRealDotEnv(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, ".env.example"), []byte("# WEB_PORT=80\n"), 0o644)
	os.WriteFile(filepath.Join(dir, ".env"), []byte("WEB_PORT=9001\n"), 0o644)
	if web, _, _ := enginePorts(dir); web != 9001 {
		t.Fatalf("web port %d, want 9001 from .env", web)
	}
}

func TestAllModNamesIsTheDefaultSet(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"camera", "control-panel", "tcg"} {
		if err := os.MkdirAll(filepath.Join(root, "lclite", "mods", name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	got := allModNames(root)
	if len(got) != 3 {
		t.Fatalf("got %v, want 3 mods", got)
	}
	if len(normalizeMods(root, []string{"camera", "nope"})) != 1 {
		t.Fatal("normalizeMods should keep known mods only")
	}
}
