package main

import (
	"path/filepath"
	"testing"
)

// The delete-files button must never be able to aim os.RemoveAll at a folder the
// launcher didn't create — a hand-edited launcher.json, or a record left over
// from an older layout, is enough to get there otherwise.
func TestOwnsFolder(t *testing.T) {
	data := filepath.Join(t.TempDir(), "LCLite")
	l := &Launcher{dataDir: data}
	installs := filepath.Join(data, "installs")

	cases := []struct {
		name string
		path string
		want bool
	}{
		{"an install", filepath.Join(installs, "289"), true},
		{"an install, deeper", filepath.Join(installs, "289", "engine"), true},
		{"the installs folder itself", installs, false},
		{"the data folder", data, false},
		{"a sibling with the same prefix", installs + "-old", false},
		{"somewhere else entirely", filepath.Join(t.TempDir(), "installs", "289"), false},
		{"a traversal out of it", filepath.Join(installs, "..", "..", "Documents"), false},
	}
	for _, c := range cases {
		if got := l.ownsFolder(c.path); got != c.want {
			t.Errorf("ownsFolder(%s) [%s] = %v, want %v", c.path, c.name, got, c.want)
		}
	}
}
