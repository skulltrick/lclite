package main

import (
	"os"
	"path/filepath"
	"testing"
)

// writeCorpus makes a fake overlay corpus: mods/<mod>/patches/<rev>/<file>.json
func writeCorpus(t *testing.T, overlay, mod, rev, file string) {
	t.Helper()
	dir := filepath.Join(overlay, "mods", mod, "patches", rev)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, file), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func fakeOverlay(t *testing.T) string {
	t.Helper()
	overlay := t.TempDir()
	manifest := `{
  "primary": "289",
  "supported": {
    "289": { "note": "primary" },
    "274": { "inherits": "289" },
    "254": { "note": "own corpus" }
  }
}`
	if err := os.WriteFile(filepath.Join(overlay, "revs.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, mod := range []string{"camera", "tcg"} {
		writeCorpus(t, overlay, mod, "289", "Client_ts.json")
	}
	writeCorpus(t, overlay, "tcg", "254", "Client_ts.json")
	return overlay
}

// The launcher's gate used to be "revision == 289", hardcoded. It now reads the
// overlay's own revs.json, so a revision the corpus supports must be accepted and one
// it does not must be refused — getting this wrong installs a vanilla client while
// claiming mods, or worse, applies a corpus meant for another revision.
func TestOverlayRevsFromManifest(t *testing.T) {
	overlay := fakeOverlay(t)
	got := overlayRevs(overlay)
	if len(got) != 3 || got[0] != "289" {
		t.Fatalf("overlayRevs = %v, want primary 289 first plus 254 and 274", got)
	}
	for _, rev := range []string{"289", "254", "274"} {
		if !revSupported(overlay, rev) {
			t.Errorf("revSupported(%q) = false, want true", rev)
		}
	}
	for _, rev := range []string{"245.2", "", "jaged"} {
		if revSupported(overlay, rev) {
			t.Errorf("revSupported(%q) = true, want false", rev)
		}
	}
}

// An overlay without revs.json (an older checkout, or a hand-copied lclite/ folder)
// must fall back to the single authored revision rather than offering mods everywhere.
func TestOverlayRevsFallback(t *testing.T) {
	dir := t.TempDir()
	if got := overlayRevs(dir); len(got) != 1 || got[0] != overlayRev {
		t.Fatalf("overlayRevs(no manifest) = %v, want [%s]", got, overlayRev)
	}
	if revSupported(dir, "254") {
		t.Error("revSupported(254) = true without a manifest, want false")
	}
}

// modCorpusRev mirrors the node rule: own corpus, else the inherited one, else the mod
// is not available. The launcher's mod rows depend on this being exact.
func TestModCorpusRev(t *testing.T) {
	overlay := fakeOverlay(t)
	m := readRevManifest(overlay)
	if got := modCorpusRev(overlay, "camera", "289", m); got != "289" {
		t.Errorf("camera@289 = %q, want 289", got)
	}
	if got := modCorpusRev(overlay, "camera", "274", m); got != "289" {
		t.Errorf("camera@274 = %q, want 289 (inherited)", got)
	}
	if got := modCorpusRev(overlay, "tcg", "254", m); got != "254" {
		t.Errorf("tcg@254 = %q, want 254 (own corpus wins)", got)
	}
	if got := modCorpusRev(overlay, "camera", "254", m); got != "" {
		t.Errorf("camera@254 = %q, want \"\" (no corpus, nothing to inherit)", got)
	}
}
