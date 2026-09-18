package main

import (
	"os"
	"path/filepath"
	"testing"
)

// The collapsed-section list comes from the page, so it is filtered against the
// keys the UI actually has: junk can't accumulate in launcher.json, and the
// stored order is stable so the file doesn't churn on every toggle.
func TestSetCollapsedFiltersAndSorts(t *testing.T) {
	dir := t.TempDir()
	s, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	s.setCollapsed([]string{"mods", "nonsense", "revs", "mods", "../../etc"})

	if got := s.snapshot().Collapsed; len(got) != 2 || got[0] != "mods" || got[1] != "revs" {
		t.Fatalf("Collapsed = %v, want [mods revs]", got)
	}
	// it has to survive a restart, or the preference is a lie
	raw, err := os.ReadFile(filepath.Join(dir, "launcher.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !contains(string(raw), `"collapsed"`) {
		t.Fatalf("collapsed not persisted to launcher.json: %s", raw)
	}
	again, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := again.snapshot().Collapsed; len(got) != 2 {
		t.Fatalf("after reopen Collapsed = %v", got)
	}
}

// A fresh store must serialize the field as [] (not null), so the page can read
// it without a guard.
func TestCollapsedDefaultsToEmpty(t *testing.T) {
	s, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if s.snapshot().Collapsed == nil {
		t.Fatal("Collapsed is nil on a fresh store")
	}
}

func contains(hay, needle string) bool {
	for i := 0; i+len(needle) <= len(hay); i++ {
		if hay[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
