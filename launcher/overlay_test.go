package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// ---- fixtures ---------------------------------------------------------------
//
// The overlay update path is git end to end, so the fixture is real git: a bare repo
// to pull from, a working clone to land commits with, and clones of the overlay in the
// two shapes that exist in the wild — a full checkout (a maintainer's, or the one this
// exe lives in) and the launcher's own `--depth 1` install clone. A hand-rolled fake
// would test nothing that matters here.

type overlayFixture struct {
	root   string
	origin string // the bare repo the overlay clones pull from
	work   string // a clone used to land new commits
}

func gitT(t *testing.T, dir string, args ...string) string {
	t.Helper()
	full := args
	if dir != "" {
		full = append([]string{"-C", dir}, args...)
	}
	cmd := exec.Command("git", full...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(full, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

func writeText(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func configureGit(t *testing.T, dir string) {
	t.Helper()
	gitT(t, dir, "config", "user.email", "t@example.com")
	gitT(t, dir, "config", "user.name", "t")
	gitT(t, dir, "config", "commit.gpgsign", "false")
}

// newOverlayFixture seeds a repo that looks like the LCLite overlay (tools/lclite.mjs
// + mods/, the shape isOverlayDir looks for) and gives it a bare origin to pull from.
func newOverlayFixture(t *testing.T) *overlayFixture {
	t.Helper()
	root := t.TempDir()
	seed := filepath.Join(root, "seed")
	if err := os.MkdirAll(seed, 0o755); err != nil {
		t.Fatal(err)
	}
	gitT(t, seed, "init", "-q", "-b", "main")
	writeText(t, filepath.Join(seed, "tools", "lclite.mjs"), "// overlay\n")
	writeText(t, filepath.Join(seed, "mods", "control-panel", "README.md"), "a mod\n")
	writeText(t, filepath.Join(seed, "revs.json"), `{"primary":"289","supported":{"289":{}}}`+"\n")
	writeText(t, filepath.Join(seed, "README.md"), "v1\n")
	configureGit(t, seed)
	gitT(t, seed, "add", "-A")
	gitT(t, seed, "commit", "-qm", "v1")

	origin := filepath.Join(root, "origin.git")
	gitT(t, "", "clone", "-q", "--bare", seed, origin)
	work := filepath.Join(root, "work")
	gitT(t, "", "clone", "-q", origin, work)
	configureGit(t, work)
	return &overlayFixture{root: root, origin: origin, work: work}
}

// clone makes an overlay checkout of the fixture's origin. The origin goes in as a
// file:// URL: `git clone --depth` is silently IGNORED for a plain local path (git
// hardlinks the objects instead), so a path-based "shallow" clone would really be a
// complete one — and the shallow shape is the one the launcher's installs have.
func (f *overlayFixture) clone(t *testing.T, dir string, shallow bool) string {
	t.Helper()
	args := []string{"clone", "-q"}
	if shallow {
		args = append(args, "--depth", "1")
	}
	args = append(args, fileURL(f.origin), dir)
	gitT(t, "", args...)
	return dir
}

// fileURL turns a local path into a URL git will honour --depth for. Note the TWO
// slashes: on git-for-Windows `file:///C:/…` is rejected outright ("'/C:/…' does not
// appear to be a git repository") while `file://C:/…` works.
func fileURL(path string) string {
	return "file://" + strings.ReplaceAll(filepath.ToSlash(path), " ", "%20")
}

// advance lands one more commit on the fixture's origin, i.e. "the LCLite repo moved".
func (f *overlayFixture) advance(t *testing.T, text string) {
	t.Helper()
	writeText(t, filepath.Join(f.work, "README.md"), text+"\n")
	gitT(t, f.work, "commit", "-qam", text)
	gitT(t, f.work, "push", "-q", "origin", "main")
}

func testLauncher(t *testing.T, overlayDir string) *Launcher {
	t.Helper()
	l, err := newLauncher(t.TempDir(), "test", true)
	if err != nil {
		t.Fatal(err)
	}
	l.localOverlay = overlayDir
	return l
}

func overlayJob() *Job { return &Job{Kind: "overlay", Status: "running"} }

// ---- the check --------------------------------------------------------------

func TestOverlayCheckReportsWhatIsNew(t *testing.T) {
	// Both shapes the button meets: the maintainer's full checkout and the shallow
	// clone the launcher makes inside an install.
	for _, tc := range []struct {
		name    string
		shallow bool
	}{
		{"full checkout", false},
		{"install clone (depth 1)", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newOverlayFixture(t)
			dir := f.clone(t, filepath.Join(t.TempDir(), "lclite"), tc.shallow)
			l := testLauncher(t, dir)

			st := l.checkOverlay()
			if st.State != "uptodate" {
				t.Fatalf("a checkout level with its origin must read uptodate, got %+v", st)
			}
			if st.Path != dir || st.Branch != "main" || st.Head == "" {
				t.Errorf("the answer must describe the checkout it read: %+v", st)
			}
			// A check fetches (which writes .git) and nothing else: the working tree
			// must come out exactly as it went in.
			if dirty, err := l.isDirty(dir); err != nil || dirty {
				t.Errorf("checking must leave the working tree alone (dirty=%v err=%v)", dirty, err)
			}
			// And a fetch on a COMPLETE clone must not shallow-ify it — asking for
			// --depth there would quietly throw away the maintainer's history.
			if !tc.shallow && l.isShallow(dir) {
				t.Error("a check must never make a complete clone shallow")
			}

			f.advance(t, "v2")
			st = l.checkOverlay()
			if st.State != "update" {
				t.Fatalf("after the repo moved the answer must be update, got %+v", st)
			}
			if st.Behind < 1 {
				t.Errorf("a checkout behind its origin must say so: %+v", st)
			}
			if st.Shallow != tc.shallow {
				t.Errorf("the answer must say which shape it read: %+v", st)
			}
			if st.Shallow && st.Behind != 1 {
				t.Errorf("a shallow clone cannot count commits — it reports at least one: %+v", st)
			}
			if st.summary() == "" {
				t.Error("every answer needs its one console line")
			}
		})
	}
}

func TestOverlayCheckSaysOfflineWhenTheRepoCannotBeReached(t *testing.T) {
	f := newOverlayFixture(t)
	dir := f.clone(t, filepath.Join(t.TempDir(), "lclite"), false)
	gitT(t, dir, "remote", "set-url", "origin", filepath.Join(f.root, "not-a-repo"))
	l := testLauncher(t, dir)

	st := l.checkOverlay()
	if st.State != "offline" {
		t.Fatalf("an unreachable origin must read offline, got %+v", st)
	}
	if st.Note == "" {
		t.Error("offline must carry git's own words, not just a label")
	}
	// And Update refuses with the same sentence rather than pretending it pulled.
	err := l.updateOverlay(overlayJob())
	if err == nil || !strings.Contains(err.Error(), "could not reach") {
		t.Errorf("an update with no repo to reach must refuse, got %v", err)
	}
}

func TestOverlayCheckWithNothingToUpdate(t *testing.T) {
	// A launcher with no checkout of its own and no install carrying one.
	l, err := newLauncher(t.TempDir(), "test", true)
	if err != nil {
		t.Fatal(err)
	}
	l.localOverlay = ""
	if st := l.checkOverlay(); st.State != "none" || st.Note == "" {
		t.Fatalf("with no overlay anywhere the answer is none, and it says why: %+v", st)
	}
	if err := l.updateOverlay(overlayJob()); err == nil {
		t.Error("there is nothing to update without an overlay")
	}
}

func TestOverlayTargetFallsBackToAnInstallCopy(t *testing.T) {
	// A launcher that lives alone (the portable exe) has no checkout of its own, so
	// the button acts on the copy inside an install — the same one its mods come from.
	f := newOverlayFixture(t)
	root := t.TempDir()
	installRoot := filepath.Join(root, "installs", "289")
	dir := f.clone(t, filepath.Join(installRoot, "lclite"), true)

	l, err := newLauncher(t.TempDir(), "test", true)
	if err != nil {
		t.Fatal(err)
	}
	l.localOverlay = ""
	l.store.upsertInstall(&Install{ID: "289", Path: installRoot, Rev: "289"})

	if got := l.overlayTarget(); got != dir {
		t.Fatalf("the install's own copy is the target, got %q", got)
	}
	if st := l.checkOverlay(); st.State != "uptodate" {
		t.Errorf("the install copy is level with origin: %+v", st)
	}
	f.advance(t, "v2")
	if st := l.checkOverlay(); st.State != "update" {
		t.Errorf("and it moves with the repo: %+v", st)
	}
}

// ---- the update -------------------------------------------------------------

func TestOverlayUpdatePullsTheNewFiles(t *testing.T) {
	for _, tc := range []struct {
		name    string
		shallow bool
	}{
		{"full checkout", false},
		{"install clone (depth 1)", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newOverlayFixture(t)
			dir := f.clone(t, filepath.Join(t.TempDir(), "lclite"), tc.shallow)
			l := testLauncher(t, dir)
			f.advance(t, "v2")

			if err := l.updateOverlay(overlayJob()); err != nil {
				t.Fatalf("the update must land: %v", err)
			}
			raw, err := os.ReadFile(filepath.Join(dir, "README.md"))
			if err != nil {
				t.Fatal(err)
			}
			if strings.TrimSpace(string(raw)) != "v2" {
				t.Errorf("the working tree must really carry the new file, got %q", raw)
			}
			if st := l.checkOverlay(); st.State != "uptodate" {
				t.Errorf("after an update the checkout is level with the repo: %+v", st)
			}
			// The launcher's remembered answer moves with it, so the button (and a
			// reload) shows Up-to-date without asking again.
			if got := l.overlayState(); got == nil || got.State != "uptodate" {
				t.Errorf("the launcher must remember the new answer: %+v", got)
			}
		})
	}
}

func TestOverlayUpdateRefusesToClobberLocalWork(t *testing.T) {
	f := newOverlayFixture(t)
	dir := f.clone(t, filepath.Join(t.TempDir(), "lclite"), false)
	l := testLauncher(t, dir)
	f.advance(t, "v2")
	writeText(t, filepath.Join(dir, "README.md"), "my own edit\n")

	if st := l.checkOverlay(); !st.Dirty {
		t.Fatalf("an edited checkout must read as dirty: %+v", st)
	}
	err := l.updateOverlay(overlayJob())
	if err == nil || !strings.Contains(err.Error(), "uncommitted") {
		t.Fatalf("an update must refuse a checkout with uncommitted changes, got %v", err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "README.md"))
	if strings.TrimSpace(string(raw)) != "my own edit" {
		t.Errorf("the refusal must leave the work in place, got %q", raw)
	}
}

func TestOverlayUpdateWillNotForceAForkedCheckout(t *testing.T) {
	// A checkout with a commit of its own, and a repo that has moved: no
	// fast-forward is possible, and the honest answer is a refusal — never a
	// force-move that would orphan somebody's work.
	f := newOverlayFixture(t)
	dir := f.clone(t, filepath.Join(t.TempDir(), "lclite"), false)
	configureGit(t, dir)
	writeText(t, filepath.Join(dir, "mods", "mine", "README.md"), "local work\n")
	gitT(t, dir, "add", "-A")
	gitT(t, dir, "commit", "-qm", "my own commit")
	f.advance(t, "v2")

	l := testLauncher(t, dir)
	st := l.checkOverlay()
	if st.State != "update" || st.Ahead == 0 || st.Behind == 0 {
		t.Fatalf("a forked checkout must report both directions: %+v", st)
	}
	if err := l.updateOverlay(overlayJob()); err == nil {
		t.Fatal("a forked checkout must not be force-moved")
	}
	if _, err := os.Stat(filepath.Join(dir, "mods", "mine", "README.md")); err != nil {
		t.Error("the refusal must leave the local commit alone")
	}
}

func TestOverlayCheckReportsACheckoutThatIsAhead(t *testing.T) {
	// The maintainer's everyday state: commits of their own that the repo does not
	// have. There is nothing to pull, and the answer says so instead of offering an
	// update that would refuse.
	f := newOverlayFixture(t)
	dir := f.clone(t, filepath.Join(t.TempDir(), "lclite"), false)
	configureGit(t, dir)
	writeText(t, filepath.Join(dir, "mods", "mine", "README.md"), "local work\n")
	gitT(t, dir, "add", "-A")
	gitT(t, dir, "commit", "-qm", "my own commit")

	l := testLauncher(t, dir)
	st := l.checkOverlay()
	if st.State != "uptodate" {
		t.Fatalf("being ahead is not an update to pull: %+v", st)
	}
	if st.Ahead != 1 || st.Behind != 0 {
		t.Errorf("the counts must say which way the difference runs: %+v", st)
	}
	// Pressing Update there is a no-op, not a failure: nothing to pull is not an error.
	if err := l.updateOverlay(overlayJob()); err != nil {
		t.Errorf("updating an already-current checkout must succeed quietly: %v", err)
	}
}

// ---- the endpoints ----------------------------------------------------------

func TestOverlayEndpointsAreRoutedAndReportTheirState(t *testing.T) {
	l := testLauncher(t, "")
	h := l.routes()
	req := httptest.NewRequest("POST", "/api/overlay/check", nil)
	req.Header.Set("X-LCLite-Token", l.token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("overlay/check must answer, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"overlay"`) {
		t.Errorf("overlay/check must ship the status the button renders: %s", rec.Body.String())
	}
	// And a token-less request is refused, not 404'd (i.e. the route really exists).
	plain := httptest.NewRecorder()
	h.ServeHTTP(plain, httptest.NewRequest("POST", "/api/overlay/update", nil))
	if plain.Code == http.StatusNotFound {
		t.Error("/api/overlay/update must be routed")
	}
}
