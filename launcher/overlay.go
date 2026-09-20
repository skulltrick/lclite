package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// ---- the overlay update button ---------------------------------------------
//
// The one control at the top of the launcher that is about LCLite itself rather
// than about Lost City: is there anything newer in the LCLite repo (mods, tools,
// page assets) to pull into this checkout?
//
// It acts on the overlay the launcher drives — the checkout this exe lives in when
// there is one, else the first install carrying its own copy (overlayTarget). It
// never touches an install's tree: a pulled overlay becomes live in a tree when the
// mods panel applies it, which is what the button's own hint says.
//
// Four answers, one button:
//
//	update    the repo has commits this checkout does not — press to pull them
//	uptodate  nothing to pull (or this checkout is the one that is ahead)
//	offline   the LCLite repo could not be reached
//	none      there is no overlay here to update
//
// A check never writes to the working tree — it fetches, which only writes .git —
// and an update refuses outright when the checkout has uncommitted changes. The
// launcher does not throw away work it did not make.
type overlayStatus struct {
	State  string `json:"state"` // update | uptodate | offline | none
	Behind int    `json:"behind"`
	Ahead  int    `json:"ahead"`
	Dirty  bool   `json:"dirty"`
	// Shallow marks a clone with no history of its own (the launcher's own installs
	// are --depth 1), where git cannot say how far behind you are: the counts are
	// then "at least one", never a number to quote.
	Shallow bool      `json:"shallow"`
	Head    string    `json:"head"`
	Remote  string    `json:"remote"`
	Path    string    `json:"path"`
	Branch  string    `json:"branch"`
	Note    string    `json:"note"`
	At      time.Time `json:"at"`
}

// overlayTarget is the overlay the update button acts on. Your own checkout wins
// (it is what every install is driven by — see overlayFor), and a launcher that
// lives alone falls back to the first install carrying its own copy.
func (l *Launcher) overlayTarget() string {
	if l.localOverlay != "" {
		return l.localOverlay
	}
	for _, in := range l.store.snapshot().Installs {
		if isOverlayDir(in.overlayDir()) {
			return in.overlayDir()
		}
	}
	return ""
}

// checkOverlay answers "is there anything new in the LCLite repo?". The numbers
// behind the answer are kept so the button can explain itself, and the branch is
// the checkout's OWN branch (a fork or a side branch is compared with its own
// upstream, never with a hardcoded main).
func (l *Launcher) checkOverlay() overlayStatus {
	st := overlayStatus{State: "none", At: time.Now()}
	dir := l.overlayTarget()
	if dir == "" {
		st.Note = "no LCLite overlay here — this launcher isn't running from a checkout, and no install has one"
		return st
	}
	st.Path = dir
	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		st.Note = dir + " is not a git checkout"
		return st
	}
	if out, err := runGitIn(dir, "remote", "get-url", "origin"); err != nil || strings.TrimSpace(out) == "" {
		st.Note = "this checkout has no origin remote — update it yourself"
		return st
	}
	st.Branch = l.repoBranch(dir)
	if st.Branch == "" {
		st.Branch = "main"
	}
	st.Shallow = l.isShallow(dir)
	fetch := []string{"fetch", "--quiet"}
	if st.Shallow {
		// --depth on a COMPLETE clone would shallow-ify it, so it is only ever asked
		// for on a clone that is already shallow.
		fetch = append(fetch, "--depth", "1")
	}
	fetch = append(fetch, "origin", st.Branch)
	if out, err := runGitIn(dir, fetch...); err != nil {
		st.State = "offline"
		st.Note = firstLine(out)
		if st.Note == "" {
			st.Note = firstLine(err.Error())
		}
		return st
	}
	head, _ := runGitIn(dir, "rev-parse", "HEAD")
	remote, _ := runGitIn(dir, "rev-parse", "FETCH_HEAD")
	st.Head, st.Remote = strings.TrimSpace(head), strings.TrimSpace(remote)
	if st.Head == "" || st.Remote == "" {
		st.State = "none"
		st.Note = "could not read this checkout's HEAD — update it with git yourself"
		return st
	}
	st.Dirty, _ = l.isDirty(dir)
	if st.Head == st.Remote {
		st.State = "uptodate"
		return st
	}
	// A shallow clone cannot answer either count honestly (both commits are grafted
	// roots there), so it gets "at least one", not a made-up number.
	if st.Shallow {
		st.Behind = 1
		st.State = "update"
		return st
	}
	st.Behind = revCount(dir, "HEAD..FETCH_HEAD")
	st.Ahead = revCount(dir, "FETCH_HEAD..HEAD")
	if st.Behind > 0 {
		st.State = "update"
		return st
	}
	// Same branch, different commits, nothing to pull: this checkout is the one
	// that is ahead of the repo.
	st.State = "uptodate"
	return st
}

// summary is the one console line a check writes: the button's answer, with the
// numbers behind it.
func (s overlayStatus) summary() string {
	where := filepath.Base(s.Path)
	if where == "" || where == "." {
		where = "the LCLite overlay"
	}
	switch s.State {
	case "update":
		if s.Shallow {
			return fmt.Sprintf("LCLite overlay: %s has newer commits on %s — press Update", where, s.Branch)
		}
		return fmt.Sprintf("LCLite overlay: %s is %d commit(s) behind %s — press Update", where, s.Behind, s.Branch)
	case "uptodate":
		if s.Ahead > 0 {
			return fmt.Sprintf("LCLite overlay: %s matches %s and is %d commit(s) ahead of it", where, s.Branch, s.Ahead)
		}
		return fmt.Sprintf("LCLite overlay: %s is up to date with %s @ %s", where, s.Branch, shortSHA(s.Head))
	case "offline":
		return fmt.Sprintf("LCLite overlay: could not reach the repo — %s", s.Note)
	default:
		return fmt.Sprintf("LCLite overlay: nothing to update — %s", s.Note)
	}
}

// updateOverlay pulls the newer LCLite into the overlay checkout. It refuses when
// the checkout has uncommitted changes and never force-moves a branch that carries
// its own commits: a maintainer's checkout is not a player's clone.
func (l *Launcher) updateOverlay(j *Job) error {
	dir := l.overlayTarget()
	if dir == "" {
		return fmt.Errorf("no LCLite overlay to update — this launcher isn't running from a checkout, and no install has one")
	}
	j.setStep("checking the LCLite repo")
	st := l.checkOverlay()
	l.setOverlayState(st)
	switch st.State {
	case "offline":
		return fmt.Errorf("could not reach the LCLite repo — %s", st.Note)
	case "none":
		return fmt.Errorf("%s", st.Note)
	}
	if st.Dirty {
		return fmt.Errorf("%s has uncommitted changes — commit or stash them, then press Update again (the launcher never overwrites work it did not make)", dir)
	}
	if st.State == "uptodate" {
		j.logf("nothing to pull — %s already matches %s @ %s", filepath.Base(dir), st.Branch, shortSHA(st.Head))
		return nil
	}
	j.logf("%s is %s behind %s — pulling", filepath.Base(dir), behindPhrase(st), st.Branch)
	j.setStep("updating the LCLite overlay")
	if st.Shallow {
		// A launcher clone has no history of its own and no fast-forward check can
		// work across the shallow boundary, so the branch is moved onto what was
		// just fetched — exactly what install does (see syncRepo).
		if err := j.runCmd("git", "-C", dir, "checkout", "-B", st.Branch, "FETCH_HEAD"); err != nil {
			return fmt.Errorf("could not update %s: %v", dir, err)
		}
	} else if err := j.runCmd("git", "-C", dir, "merge", "--ff-only", "FETCH_HEAD"); err != nil {
		return fmt.Errorf("could not fast-forward %s — it has commits of its own (merge it with git yourself): %v", dir, err)
	}
	head, _ := runGitIn(dir, "rev-parse", "HEAD")
	st.Head, st.Behind, st.Ahead, st.Dirty, st.State = strings.TrimSpace(head), 0, 0, false, "uptodate"
	st.Note = "updated just now"
	st.At = time.Now()
	l.setOverlayState(st)
	j.logf("%s is now at %s", filepath.Base(dir), shortSHA(st.Head))
	return nil
}

// behindPhrase is "1 commit" / "2 commits" / "at least one commit" (a shallow clone
// cannot count), for the job log.
func behindPhrase(st overlayStatus) string {
	if st.Shallow {
		return "at least one commit"
	}
	if st.Behind == 1 {
		return "1 commit"
	}
	return fmt.Sprintf("%d commits", st.Behind)
}

// ---- the button's two endpoints ---------------------------------------------

// handleOverlayCheck is the press on Check for update. It is a plain request rather
// than a job: a fetch of one branch is quick, and the answer IS the response.
func (l *Launcher) handleOverlayCheck(w http.ResponseWriter, r *http.Request) {
	st := l.checkOverlay()
	l.setOverlayState(st)
	l.console.write("lclite", st.summary())
	ok(w, map[string]any{"overlay": st})
}

// handleOverlayUpdate is the press on Update: a job, because pulling can print and
// can fail, and both belong in the console like every other long task.
func (l *Launcher) handleOverlayUpdate(w http.ResponseWriter, r *http.Request) {
	if l.jobs.active() != nil {
		fail(w, fmt.Errorf("another task is still running — wait for it to finish"))
		return
	}
	j := goJob(l, "overlay", "", func(j *Job) error {
		if err := l.updateOverlay(j); err != nil {
			return err
		}
		j.logf("press Apply changes in the mods panel to build the new files into an install")
		return nil
	})
	ok(w, map[string]any{"job": j.ID})
}

// ---- state kept between polls -----------------------------------------------

// overlayState is the last check's answer, or nil when the button has never been
// pressed. It is kept so a page reload shows the button it was showing: the check
// itself is the user's press, never something a poll does behind their back.
func (l *Launcher) overlayState() *overlayStatus {
	l.overlayMu.Lock()
	defer l.overlayMu.Unlock()
	return l.overlay
}

func (l *Launcher) setOverlayState(st overlayStatus) {
	l.overlayMu.Lock()
	l.overlay = &st
	l.overlayMu.Unlock()
}

// revCount counts commits in a revision range, 0 when git cannot answer.
func revCount(dir, rng string) int {
	out, err := runGitIn(dir, "rev-list", "--count", rng)
	if err != nil {
		return 0
	}
	n, err := strconv.Atoi(strings.TrimSpace(out))
	if err != nil {
		return 0
	}
	return n
}
