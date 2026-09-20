package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// MOD_META is written by hand, so the reader has to cope with both quote styles:
// a description with an apostrophe in it ("Highlights player's true server
// tile.") cannot be single-quoted, and silently dropping it put an empty line
// under a mod in the launcher's list.
func TestParseModMetaQuotes(t *testing.T) {
	dir := t.TempDir()
	lib := filepath.Join(dir, "lib.mjs")
	body := `import x from 'y';
export const MOD_META = {
    'camera': {
        label: 'Camera',
        desc: 'Wheel zoom, middle-drag rotate, chat scroll.',
        required: true,
    },
    'true-tile': {
        label: 'True tile',
        desc: "Highlights player's true server tile. Customizable.",
    },
};
export const meta = name => MOD_META[name] || {};
`
	if err := os.WriteFile(lib, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	got := parseModMeta(lib)
	if len(got) != 2 {
		t.Fatalf("parsed %d entries, want 2 (%v)", len(got), got)
	}
	if c := got["camera"]; c.Label != "Camera" || c.Desc != "Wheel zoom, middle-drag rotate, chat scroll." || !c.Required {
		t.Errorf("camera = %+v", c)
	}
	if tt := got["true-tile"]; tt.Label != "True tile" || tt.Desc != "Highlights player's true server tile. Customizable." {
		t.Errorf("true-tile = %+v (double-quoted desc must survive)", tt)
	}
}

// The mods panel has ONE button now, and the whole reason *Remove mods* could go is
// that applying is convergent: an empty tick list is a request to strip every mod,
// not an omission. An ABSENT list still means "the default set" — what a bare
// `node tools/lclite.mjs` applies — so the two must not collapse into one another.
//
// The overlay is faked with a script that records the arguments it was handed: the
// decision is the launcher's, and that is what this pins.
func TestApplyWithNothingTickedStripsEveryMod(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not installed — the overlay tools need it anyway")
	}
	overlay := t.TempDir()
	writeText(t, filepath.Join(overlay, "revs.json"), `{"primary":"289","supported":{"289":{}}}`+"\n")
	writeText(t, filepath.Join(overlay, "mods", "control-panel", "README.md"), "the panel\n")
	writeText(t, filepath.Join(overlay, "mods", "gpu", "README.md"), "the renderer\n")
	log := filepath.Join(t.TempDir(), "calls.log")
	writeText(t, filepath.Join(overlay, "tools", "lclite.mjs"),
		"import {appendFileSync} from 'node:fs';\n"+
			"appendFileSync(process.env.LCLITE_TEST_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');\n")
	t.Setenv("LCLITE_TEST_LOG", log)

	l := testLauncher(t, overlay)
	if l.findBun() == "" {
		t.Skip("no bun on this machine — the default-set half would start a download")
	}
	in := &Install{ID: "289", Path: t.TempDir(), Rev: "289"}
	l.store.upsertInstall(in)

	if err := l.applyMods(overlayJob(), in, nil, false); err != nil {
		t.Fatalf("an absent list is the default set and must apply: %v", err)
	}
	if err := l.applyMods(overlayJob(), in, []string{}, true); err != nil {
		t.Fatalf("nothing ticked must strip, not fail: %v", err)
	}

	raw, err := os.ReadFile(log)
	if err != nil {
		t.Fatalf("the fake overlay was never run: %v", err)
	}
	calls := strings.Split(strings.TrimSpace(string(raw)), "\n")
	if len(calls) != 2 {
		t.Fatalf("expected two overlay runs, got %v", calls)
	}
	if !strings.Contains(calls[0], `"--mods"`) || !strings.Contains(calls[0], "control-panel") || !strings.Contains(calls[0], "gpu") {
		t.Errorf("an absent list must apply the default set, got %s", calls[0])
	}
	if calls[1] != `["uninstall"]` {
		t.Errorf("an empty explicit list must strip every mod, got %s", calls[1])
	}
	// And the record follows the tree: nothing applied, nothing remembered.
	if in.Mods != nil {
		t.Errorf("a strip must clear the install's mods, got %v", in.Mods)
	}
	if rec := l.store.install("289"); rec == nil || len(rec.Mods) != 0 {
		t.Errorf("a strip must clear the stored mod list, got %+v", rec)
	}
}

// The list is ordered by what players read, not by folder name — the panel's
// list does the same, so "LCLite" sorts under L, not C.
func TestModListSortsByLabel(t *testing.T) {
	overlay := t.TempDir()
	for _, name := range []string{"control-panel", "camera", "xp-drops"} {
		if err := os.MkdirAll(filepath.Join(overlay, "mods", name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	lib := filepath.Join(overlay, "tools", "lib.mjs")
	if err := os.MkdirAll(filepath.Dir(lib), 0o755); err != nil {
		t.Fatal(err)
	}
	body := `export const MOD_META = {
    'control-panel': {
        label: 'LCLite',
        desc: 'the panel',
        required: true,
    },
    'camera': {
        label: 'Camera',
        desc: 'zoom',
        required: true,
    },
    'xp-drops': {
        label: 'XP drops',
        desc: 'xp',
    },
};
`
	if err := os.WriteFile(lib, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	mods := listModsFromOverlay(overlay, "")
	var labels []string
	for _, m := range mods {
		labels = append(labels, m.Label)
	}
	want := []string{"Camera", "LCLite", "XP drops"}
	if len(labels) != len(want) {
		t.Fatalf("got %v, want %v", labels, want)
	}
	for i := range want {
		if labels[i] != want[i] {
			t.Fatalf("got %v, want %v", labels, want)
		}
	}
}
