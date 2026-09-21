package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The app window's command line is the whole feature, so it is asserted here rather
// than eyeballed: a flag that silently stops being passed leaves a window that opens
// with tabs and an address bar — i.e. no window at all, just the browser again.
func TestAppWindowArgsAreOneCommandLine(t *testing.T) {
	url := "http://127.0.0.1:51999/"
	profile := filepath.Join(t.TempDir(), "window")
	args := appWindowArgs(url, profile)

	want := map[string]bool{
		"--app=" + url:                   true,
		"--user-data-dir=" + profile:     true,
		"--no-first-run":                 true,
		"--no-default-browser-check":     true,
		"--window-size=" + appWindowSize: true,
	}
	for _, a := range args {
		if !want[a] {
			t.Errorf("unexpected argument %q", a)
		}
		delete(want, a)
	}
	for a := range want {
		t.Errorf("missing argument %q", a)
	}

	// Each argument must be one argv element with no shell quoting or escaping in it:
	// the browser is started directly (exec.Command), never through a shell, so a
	// quoted URL here would be passed through literally and the window would not load.
	for _, a := range args {
		if strings.ContainsAny(a, `"'`) {
			t.Errorf("%q must not be quoted — nothing shells out", a)
		}
	}
}

// firstExisting is what turns the platform's ordered wish list into the browser we
// actually run, so its two rules matter: order is respected, and a candidate that is
// not a real file is skipped rather than reported as found.
func TestFirstExistingTakesTheFirstRealFile(t *testing.T) {
	dir := t.TempDir()
	second := filepath.Join(dir, "second.exe")
	if err := os.WriteFile(second, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A directory is not a browser, however much it looks like a path.
	aDir := filepath.Join(dir, "a-directory.exe")
	if err := os.MkdirAll(aDir, 0o755); err != nil {
		t.Fatal(err)
	}

	got, err := firstExisting([]string{
		"",                                // empty entries are skipped, not errors
		filepath.Join(dir, "missing.exe"), // not there
		aDir,                              // there, but not a file
		second,                            // the one
		filepath.Join(dir, "later.exe"),   // never reached
	})
	if err != nil {
		t.Fatalf("firstExisting: %v", err)
	}
	if got != second {
		t.Errorf("firstExisting picked %q, want %q", got, second)
	}

	if _, err := firstExisting([]string{filepath.Join(dir, "nope.exe")}); err == nil {
		t.Error("no browser found must be an error, not an empty string")
	}
}

// LCLITE_APP_BROWSER is the escape hatch for a portable browser, so a wrong value has
// to be loud: falling back silently would leave the user wondering why their chosen
// browser never opened.
func TestAppWindowBrowserHonoursTheOverride(t *testing.T) {
	dir := t.TempDir()
	fake := filepath.Join(dir, "my-browser.exe")
	if err := os.WriteFile(fake, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	t.Setenv("LCLITE_APP_BROWSER", fake)
	got, err := appWindowBrowser()
	if err != nil {
		t.Fatalf("appWindowBrowser: %v", err)
	}
	if got != fake {
		t.Errorf("appWindowBrowser used %q, want the override %q", got, fake)
	}

	for _, bad := range []string{filepath.Join(dir, "gone.exe"), dir} {
		t.Setenv("LCLITE_APP_BROWSER", bad)
		_, err := appWindowBrowser()
		if err == nil {
			t.Errorf("LCLITE_APP_BROWSER=%q must be an error", bad)
			continue
		}
		// The error quotes the path (%q), so compare against what it names rather than
		// against the raw separators.
		if !strings.Contains(err.Error(), "LCLITE_APP_BROWSER") || !strings.Contains(err.Error(), filepath.Base(bad)) {
			t.Errorf("the error must name the bad path, got %v", err)
		}
	}
}

// A candidate list is only usable if every entry is an absolute path: a relative one
// would be resolved against whatever the working directory happened to be.
func TestAppWindowCandidatesAreAbsolute(t *testing.T) {
	cands := appWindowCandidates()
	if len(cands) == 0 {
		t.Fatal("no candidates at all — the search would never find a browser")
	}
	for _, c := range cands {
		if !filepath.IsAbs(c) {
			t.Errorf("candidate %q is not absolute", c)
		}
	}
}

// The window runs in a profile of the launcher's own, under its data folder. That is
// what keeps the window out of the player's real profile (and out of their session).
func TestAppWindowProfileLivesUnderTheDataDir(t *testing.T) {
	data := filepath.Join(t.TempDir(), "LCLite")
	got := appWindowProfile(data)
	if filepath.Dir(got) != data {
		t.Errorf("profile %q must sit directly under the data folder %q", got, data)
	}
}

// The rule that closes the launcher when its window closes — and the guard that keeps
// it from ever stopping something the player asked for.
func TestWindowGoneRule(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name string
		last time.Time
		idle bool
		want bool
	}{
		{"the page has never loaded", time.Time{}, true, false},
		{"the page is talking to us", now.Add(-2 * time.Second), true, false},
		{"quiet, but a world is running", now.Add(-10 * time.Minute), false, false},
		{"quiet and nothing is running", now.Add(-10 * time.Minute), true, true},
		{"quiet for less than the grace", now.Add(-appWindowGrace + time.Second), true, false},
		{"quiet for exactly the grace", now.Add(-appWindowGrace), true, false},
	}
	for _, tc := range cases {
		if got := windowGone(tc.last, now, tc.idle); got != tc.want {
			t.Errorf("%s: windowGone = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// idle is the guard itself, spelled out: a job in flight counts as busy even when no
// world and no bridge are up, because a closed window must not kill an install.
func TestIdleMeansNothingIsRunning(t *testing.T) {
	l, err := newLauncher(t.TempDir(), "test", true)
	if err != nil {
		t.Fatal(err)
	}
	if !l.idle() {
		t.Error("a fresh launcher is idle")
	}
	// jobs.run runs its function inline, so the caller is the goroutine that keeps the
	// job in flight — the same shape the handlers use.
	release := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		l.jobs.run("test", "", func(j *Job) error {
			<-release
			return nil
		})
	}()
	deadline := time.Now().Add(5 * time.Second)
	for l.jobs.active() == nil && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if l.jobs.active() == nil {
		t.Fatal("the job never started")
	}
	if l.idle() {
		t.Error("a job in flight is not idle")
	}
	close(release)
	<-done
	if !l.idle() {
		t.Error("a finished job is idle again")
	}
}

// The flag precedence, which is the thing that decides whether the launcher looks
// like an app or like a tab — and whether a headless run stays silent.
func TestUIModePrecedence(t *testing.T) {
	cases := []struct {
		name                       string
		noBrowser, browser, window bool
		want                       uiMode
	}{
		{"no flags at all: the app window", false, false, true, uiWindow},
		{"--browser asks for a tab", false, true, true, uiTab},
		{"-window=false asks for a tab too", false, false, false, uiTab},
		{"--no-browser opens nothing", true, false, true, uiNone},
		{"--no-browser beats --browser", true, true, true, uiNone},
		{"--no-browser beats -window=false", true, false, false, uiNone},
	}
	for _, tc := range cases {
		if got := uiModeFor(tc.noBrowser, tc.browser, tc.window); got != tc.want {
			t.Errorf("%s: uiModeFor = %q, want %q", tc.name, got, tc.want)
		}
	}
}

// The two halves of the rule, so that a closed window over a live world stays
// distinguishable from a page that never loaded at all.
func TestPageQuietNeedsTrafficFirst(t *testing.T) {
	now := time.Now()
	if pageQuiet(time.Time{}, now) {
		t.Error("a page that has never loaded is not a closed window")
	}
	if !pageQuiet(now.Add(-appWindowGrace-time.Second), now) {
		t.Error("silence past the grace is a closed window")
	}
}

// The heartbeat has to be wired to real traffic. A route layer that forgot to record
// hits would leave window mode never noticing a closed window, and every other test
// here would still pass.
func TestTheServedPageIsTheHeartbeat(t *testing.T) {
	l, err := newLauncher(t.TempDir(), "test", true)
	if err != nil {
		t.Fatal(err)
	}
	h := l.routes()
	if !l.page.lastHit().IsZero() {
		t.Fatal("nothing has been served yet, so there is no heartbeat")
	}

	// The page itself.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET / = %d", rec.Code)
	}
	first := l.page.lastHit()
	if first.IsZero() {
		t.Fatal("serving the page must count as a heartbeat")
	}

	// And the polls it runs afterwards — including a refused one: a token-less request
	// is still the page's port being talked to, and the guard's answer is unchanged.
	time.Sleep(2 * time.Millisecond)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/state", nil))
	if rec.Code != http.StatusForbidden {
		t.Errorf("a token-less /api/state must still be refused, got %d", rec.Code)
	}
	if !l.page.lastHit().After(first) {
		t.Error("every request through the route layer must count as a heartbeat")
	}
}
