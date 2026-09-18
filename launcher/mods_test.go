package main

import (
	"os"
	"path/filepath"
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
