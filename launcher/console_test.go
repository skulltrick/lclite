package main

import (
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// One feed, one cursor: the order lines were written in is the order they come
// back, across producers and across jobs. Three rings polled separately (or merged
// by timestamp in the page) could not promise that.
func TestConsoleIsOneOrderedFeed(t *testing.T) {
	c := &Console{}
	c.write("task", "== fetching 289")
	c.write("world", "world ready on 80")
	c.write("bridge", "bridging http://localhost:8890 -> play.example.com:443")
	c.write("task", "== building the client")

	lines, next := c.view(0)
	if len(lines) != 4 {
		t.Fatalf("got %d lines, want 4 (%+v)", len(lines), lines)
	}
	wantSrc := []string{"task", "world", "bridge", "task"}
	wantText := []string{"== fetching 289", "world ready on 80",
		"bridging http://localhost:8890 -> play.example.com:443", "== building the client"}
	for i, ln := range lines {
		if ln.N != i {
			t.Errorf("line %d has N=%d, want %d (the cursor is the whole feed's)", i, ln.N, i)
		}
		if ln.Src != wantSrc[i] || ln.Text != wantText[i] {
			t.Errorf("line %d = %q from %q, want %q from %q", i, ln.Text, ln.Src, wantText[i], wantSrc[i])
		}
	}
	if next != 4 {
		t.Errorf("next = %d, want 4", next)
	}

	// Incremental: asking from the cursor returns only what is new, and the new
	// line's number continues the same sequence.
	c.write("world", "player joined")
	more, next := c.view(next)
	if len(more) != 1 || more[0].Text != "player joined" || more[0].N != 4 || next != 5 {
		t.Fatalf("incremental view = %+v (next %d), want one line N=4 next 5", more, next)
	}
}

// A long install must not push the world's boot log out of the buffer from the
// wrong end: the newest lines survive and the numbering stays monotonic (the page
// holds one cursor for everything).
func TestConsoleKeepsTheNewestLines(t *testing.T) {
	c := &Console{}
	for i := 0; i < consoleKeep+50; i++ {
		c.write("task", "line")
	}
	lines, next := c.view(0)
	if next != consoleKeep+50 {
		t.Errorf("next = %d, want %d", next, consoleKeep+50)
	}
	if len(lines) >= consoleKeep {
		t.Fatalf("kept %d lines — the buffer must bound itself below %d", len(lines), consoleKeep)
	}
	if lines[len(lines)-1].N != consoleKeep+49 {
		t.Errorf("last kept line is N=%d, want %d — the newest must survive", lines[len(lines)-1].N, consoleKeep+49)
	}
	if lines[0].N == 0 {
		t.Error("the oldest line is still there, so nothing was ever dropped")
	}
	if lines[0].N != lines[len(lines)-1].N-len(lines)+1 {
		t.Errorf("kept lines are not contiguous: %d..%d (%d lines)", lines[0].N, lines[len(lines)-1].N, len(lines))
	}
}

// The mirror is the wiring that can silently come undone (a nil one means the
// producer still works and the console just stays empty), so both halves are
// pinned: the ring keeps its own lines, and the console gets them tagged.
func TestProducersMirrorIntoTheConsole(t *testing.T) {
	c := &Console{}
	ring := LogRing{mirror: c, src: "world"}
	ring.logf("world ready on %d", 80)

	if lines, _ := ring.view(0); len(lines) != 1 {
		t.Fatalf("the ring lost its own line: %+v", lines)
	}
	lines, _ := c.view(0)
	if len(lines) != 1 || lines[0].Src != "world" || lines[0].Text != "world ready on 80" {
		t.Fatalf("console = %+v, want one world line", lines)
	}
	if tail := ring.tail(5); len(tail) != 1 {
		t.Fatalf("tail() must still explain a process exit: %v", tail)
	}

	// A ring with no console (a bare test) is not a crash.
	bare := LogRing{}
	bare.logf("nothing to mirror into")
	if lines, _ := bare.view(0); len(lines) != 1 {
		t.Fatalf("bare ring = %+v", lines)
	}
}

// A job's lines — including the failure line it writes while holding its own lock —
// reach the console as "task".
func TestJobLinesReachTheConsole(t *testing.T) {
	c := &Console{}
	m := newJobManager(c)
	m.run("install", "289", func(j *Job) error {
		j.logf("== fetching Lost City")
		return errors.New("git clone failed")
	})
	lines, _ := c.view(0)
	if len(lines) != 2 {
		t.Fatalf("console = %+v, want the step and the failure", lines)
	}
	for _, ln := range lines {
		if ln.Src != "task" {
			t.Errorf("line %q came from %q, want task", ln.Text, ln.Src)
		}
	}
	if lines[1].Text != "!! git clone failed" {
		t.Errorf("last line = %q, want the error", lines[1].Text)
	}
}

// "Revisions available" counts the ones the overlay mods end to end — a revision
// with only some of the corpus ported is supported but is not one of them, which is
// the difference between the declared list and what a player really gets.
func TestFullyModdedRevsCountsOnlyFullyPorted(t *testing.T) {
	overlay := t.TempDir()
	for _, rev := range []string{"289", "254"} {
		for _, mod := range []string{"camera", "gpu"} {
			if err := os.MkdirAll(filepath.Join(overlay, "mods", mod, "patches", rev), 0o755); err != nil {
				t.Fatal(err)
			}
		}
	}
	// gpu is only ported to 289: 254 gets camera and nothing else.
	if err := os.RemoveAll(filepath.Join(overlay, "mods", "gpu", "patches", "254")); err != nil {
		t.Fatal(err)
	}
	for _, p := range [][2]string{{"camera", "289"}, {"camera", "254"}, {"gpu", "289"}} {
		if err := os.WriteFile(filepath.Join(overlay, "mods", p[0], "patches", p[1], "x.json"), []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// 274 has no corpus of its own but inherits 289, so it is fully modded too.
	manifest := `{"primary":"289","supported":{"289":{},"274":{"inherits":"289"},"254":{}}}`
	if err := os.WriteFile(filepath.Join(overlay, "revs.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	l := &Launcher{localOverlay: overlay}
	got := l.fullyModdedRevs()
	want := []string{"289", "274"}
	if len(got) != len(want) {
		t.Fatalf("fullyModdedRevs = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("fullyModdedRevs = %v, want %v", got, want)
		}
	}

	// No checkout to read = no claim at all (the page then shows no count).
	if empty := (&Launcher{}).fullyModdedRevs(); len(empty) != 0 {
		t.Errorf("with no overlay it claimed %v", empty)
	}
}

// A real join must report on the console. This is the wiring the page cannot see:
// the bridge is rebuilt per join, so a ring constructed by hand there has no mirror
// and the console stays empty while the bridge happily runs.
func TestStartProxyReportsOnTheConsole(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()

	c := &Console{}
	l := &Launcher{console: c, proxy: &Proxy{log: LogRing{}}}
	if err := l.StartProxy("http://play.example.com:443", port, false, nil); err != nil {
		t.Fatalf("StartProxy: %v", err)
	}
	defer func() { _ = l.StopProxy() }()

	lines, _ := c.view(0)
	if len(lines) < 2 {
		t.Fatalf("the console got %+v, want the bridge's own report", lines)
	}
	for _, ln := range lines {
		if ln.Src != "bridge" {
			t.Errorf("line %q came from %q, want bridge", ln.Text, ln.Src)
		}
	}
	if !strings.Contains(lines[0].Text, "bridging http://localhost") {
		t.Errorf("first line = %q, want what it is bridging", lines[0].Text)
	}
	// A stopped bridge says so, on the same feed.
	if err := l.StopProxy(); err != nil {
		t.Fatalf("StopProxy: %v", err)
	}
	lines, _ = c.view(0)
	if last := lines[len(lines)-1]; last.Text != "stopping proxy" {
		t.Errorf("last line = %q, want \"stopping proxy\"", last.Text)
	}
}
