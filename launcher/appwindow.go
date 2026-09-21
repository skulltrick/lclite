package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

// The app window. The launcher's UI is a web page, so a standalone window is a
// Chromium-family browser started in --app mode instead of the default browser: no
// new dependency, no cgo, no second toolchain, and the page, the /api surface and
// the DOM all stay exactly as they were. What it buys is a window with no tabs and
// no address bar, its own taskbar entry and its own icon — and, because the profile
// is private to the launcher, its own browser process, so it can never disturb the
// player's browsing session.
//
// LCLITE_APP_BROWSER overrides the search (a portable browser, or one installed
// somewhere unusual).

// appWindowSize is the window's opening size: wide enough for the two-column
// dashboard, short enough to fit a 1080p desktop with room to spare.
const appWindowSize = "1180,800"

// appWindowGrace is how long the page may stay quiet before window mode treats the
// window as closed. The page polls /api/state every 2.5s and /api/log every 0.9s,
// so this is around ten missed polls: long enough to survive a stalled render, a
// slow job or a machine that just woke up, short enough that closing the window
// still feels final.
const appWindowGrace = 25 * time.Second

// pageWatch is the app window's heartbeat. The page's own polls are the signal —
// measured on real traffic rather than on a timer the page would have to be taught
// to send, so there is nothing to keep in sync.
type pageWatch struct {
	mu   sync.Mutex
	seen time.Time
}

func (w *pageWatch) hit() {
	w.mu.Lock()
	w.seen = time.Now()
	w.mu.Unlock()
}

func (w *pageWatch) lastHit() time.Time {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.seen
}

// pageQuiet is "the page has stopped talking to us": it talked to us at least once
// and has now been silent for longer than the grace. "Never talked to us" is not
// quiet — it is a page that has not loaded yet, and acting on that would kill the
// launcher before the player ever saw it.
func pageQuiet(last, now time.Time) bool {
	if last.IsZero() {
		return false
	}
	return now.Sub(last) > appWindowGrace
}

// windowGone is the whole rule, kept pure so the guard that protects a running world
// is testable: a window counts as closed only when the page has gone quiet AND there
// is nothing running to throw away. Quiet with something running is a closed window
// over a live world — the launcher stays, and says so (see watchAppWindow).
func windowGone(last, now time.Time, idle bool) bool {
	return idle && pageQuiet(last, now)
}

// appWindowProfile is the browser profile the app window runs in, under the
// launcher's own data folder: a window with its own process and its own taskbar
// entry, and a player's real profile (tabs, logins, extensions) never touched.
func appWindowProfile(dataDir string) string { return filepath.Join(dataDir, "window") }

// appWindowArgs is the whole command line, in one place so a test can assert it.
func appWindowArgs(url, profileDir string) []string {
	return []string{
		"--app=" + url,
		"--user-data-dir=" + profileDir,
		"--no-first-run",
		"--no-default-browser-check",
		"--window-size=" + appWindowSize,
	}
}

// firstExisting returns the first candidate that is a real file, in the order the
// platform listed them (Edge before Chrome on Windows — Edge ships with the OS).
func firstExisting(cands []string) (string, error) {
	for _, c := range cands {
		if c == "" {
			continue
		}
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c, nil
		}
	}
	return "", fmt.Errorf("no Chromium-based browser found (Edge or Chrome)")
}

// appWindowBrowser finds a browser that can open a chromeless app window. A set
// LCLITE_APP_BROWSER that points at nothing is an error rather than a silent
// fallback: someone who set it wants to know it is wrong.
func appWindowBrowser() (string, error) {
	if p := os.Getenv("LCLITE_APP_BROWSER"); p != "" {
		if st, err := os.Stat(p); err != nil || st.IsDir() {
			return "", fmt.Errorf("LCLITE_APP_BROWSER is set to %q, which is not a file", p)
		}
		return p, nil
	}
	return firstExisting(appWindowCandidates())
}

// openAppWindow starts the launcher page in its own window, and reports which
// browser it used. Fire and forget: the browser outlives this call, and its exit
// says nothing about the window (a second launch joins the running process).
func (l *Launcher) openAppWindow(url string) (string, error) {
	bin, err := appWindowBrowser()
	if err != nil {
		return "", err
	}
	profile := appWindowProfile(l.dataDir)
	if err := os.MkdirAll(profile, 0o755); err != nil {
		return "", err
	}
	cmd := exec.Command(bin, appWindowArgs(url, profile)...)
	// Deliberately NOT hideWindow(cmd): that helper exists for the console children
	// (npm, git, taskkill) and on Windows it passes SW_HIDE in the child's
	// STARTUPINFO, which a GUI browser honours — the window is created, titled
	// correctly and INVISIBLE. A GUI app needs no console suppression anyway: it never
	// gets a console to flash.
	if err := cmd.Start(); err != nil {
		return "", err
	}
	go func() { _ = cmd.Wait() }()
	return bin, nil
}

// uiMode is how the UI should be opened. The flags override each other in this order,
// and the order is the point: --no-browser means "open nothing at all" (the headless
// recipe depends on it), --browser asks for a tab, and the app window is the default
// because it is what the launcher is — a tab is the fallback, not the shape.
type uiMode string

const (
	uiNone   uiMode = "none"
	uiTab    uiMode = "tab"
	uiWindow uiMode = "window"
)

// uiModeFor resolves the three flags. Kept pure because this precedence is exactly
// the kind of thing that breaks silently: a flag that stops being honoured looks
// like a launcher that forgot how it opens.
func uiModeFor(noBrowser, browser, window bool) uiMode {
	switch {
	case noBrowser:
		return uiNone
	case browser:
		return uiTab
	case window:
		return uiWindow
	default:
		// -window=false with no other flag: an explicit "not the app window".
		return uiTab
	}
}

// openUI is the whole "give the player a window" step.
func (l *Launcher) openUI(url string, mode uiMode) {
	if mode == uiNone {
		return
	}
	if mode == uiWindow {
		bin, err := l.openAppWindow(url)
		if err == nil {
			fmt.Printf("  app window: %s\n", bin)
			l.watchAppWindow()
			return
		}
		// The app window is the default, not a promise: with no Chromium-family
		// browser installed the page opens in the default browser rather than not at
		// all. (--browser says the same thing on purpose.)
		fmt.Printf("  (no app window: %v — opening your default browser instead)\n", err)
	}
	if err := openBrowser(url); err != nil {
		fmt.Printf("  (could not open a browser automatically: %v)\n", err)
	}
}

// watchAppWindow quits the launcher when its window is closed and nothing is left
// running. A world, a bridge or a job keeps it alive: closing a window must never
// stop a server the player asked for. When that happens the console says so once,
// because a launcher that is still running with no window in sight is otherwise a
// mystery (the console is the way back to it).
func (l *Launcher) watchAppWindow() {
	go func() {
		told := false
		for {
			time.Sleep(5 * time.Second)
			if !pageQuiet(l.page.lastHit(), time.Now()) {
				told = false
				continue
			}
			if l.idle() {
				fmt.Println("the app window is closed and nothing is running — shutting down")
				l.shutdown()
			}
			if !told {
				fmt.Println("the app window is closed, but what you started is still running — this console (Ctrl-C) stops it, and the UI is still on the URL above")
				told = true
			}
		}
	}()
}

// idle is "nothing of the player's is running": no world, no bridge, no job.
func (l *Launcher) idle() bool {
	return !l.engine.Busy() && !l.proxy.Running() && l.jobs.active() == nil
}

// shutdown stops everything the launcher owns and exits — the same exit the UI's
// Quit button and Ctrl-C take.
func (l *Launcher) shutdown() {
	_ = l.StopServer()
	_ = l.StopProxy()
	os.Exit(0)
}
