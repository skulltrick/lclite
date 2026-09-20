package main

import (
	"strings"
	"sync"
	"time"
)

// Console is the launcher's ONE terminal. Every producer — install/apply/build
// jobs, the local world's own output, the join bridge — mirrors its lines here as
// well as into its own ring, so the page has a single ordered stream behind a
// single cursor. There is no per-producer view any more: the page tags each line
// with where it came from instead, so "which log am I looking at" cannot be wrong.
//
// Mirroring at the producer is what makes the order real. Three rings polled
// separately would arrive in poll order, and merging them in the page by timestamp
// would be a guess (a line written during the poll window would sort ahead of one
// written after it). Here the order is the order things happened.
//
// The per-producer rings stay: they answer their own questions. LogRing.tail()
// explains a process exit, and /api/job replays one job for the wizard.
type Console struct {
	mu    sync.Mutex
	lines []ConsoleLine
	next  int
}

// ConsoleLine is one line of that stream. Src names the producer ("task", "world",
// "bridge") so the page can label a merged feed instead of guessing from the text.
type ConsoleLine struct {
	N    int       `json:"n"`
	Src  string    `json:"src"`
	Text string    `json:"text"`
	At   time.Time `json:"at"`
}

const (
	consoleKeep = 5000
	consoleTrim = 2500
)

// write adds text to the console, split into lines. A nil Console is a no-op, so a
// producer whose launcher never wired one up still works (that is what keeps the
// per-producer rings testable on their own).
func (c *Console) write(src, text string) {
	if c == nil {
		return
	}
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if line == "" {
			continue
		}
		c.lines = append(c.lines, ConsoleLine{N: c.next, Src: src, Text: line, At: now})
		c.next++
	}
	if len(c.lines) > consoleKeep {
		c.lines = append([]ConsoleLine(nil), c.lines[len(c.lines)-consoleTrim:]...)
	}
}

// view returns every line from `since` on, plus the cursor to ask with next time.
// N is monotonic for the life of the process, across every producer and across
// jobs, which is what lets one cursor poll the whole feed.
func (c *Console) view(since int) ([]ConsoleLine, int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]ConsoleLine, 0, 64)
	for _, ln := range c.lines {
		if ln.N >= since {
			out = append(out, ln)
		}
	}
	return out, c.next
}
