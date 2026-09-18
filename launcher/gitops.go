package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// hiddenBranches are upstream branches the picker must never offer. They are
// real branches on GitHub, but they are not Lost City revisions: either a
// client-only experiment (no engine/content, so no world to run) or a leftover
// side branch nobody plays. Kept as an explicit name list rather than a pattern
// because "which branches are real revisions" is a judgement call that changes
// as upstream adds branches — 500 stays listed: it is the next client the team
// is writing, and players like watching it appear.
var hiddenBranches = map[string]string{
	"225-custom": "client-only experiment branch of 225 — not a Lost City revision",
	"225-gpu":    "client-only experiment branch of 225 — not a Lost City revision",
	"jaged":      "client-only side branch — not a Lost City revision",
}

// isHiddenRev reports whether a branch name is one upstream keeps but the
// picker must not show. Internal work branches (-wip/-node) are hidden by
// suffix; the named ones are hidden explicitly (see hiddenBranches).
func isHiddenRev(name string) bool {
	if _, ok := hiddenBranches[name]; ok {
		return true
	}
	return strings.HasSuffix(name, "-wip") || strings.HasSuffix(name, "-node")
}

// visibleRevs drops hidden branches from a revision list. Applied on read as
// well as on fetch: a cached list (or the built-in fallback) written before a
// branch was hidden must not keep showing it.
func visibleRevs(revs []Rev) []Rev {
	out := make([]Rev, 0, len(revs))
	for _, r := range revs {
		if isHiddenRev(r.Name) {
			continue
		}
		out = append(out, r)
	}
	return out
}

// fallbackRevs is used when GitHub is unreachable (rate limit / offline).
var fallbackRevs = []Rev{
	{Name: "225", Client: true, Engine: true, Content: true},
	{Name: "244", Client: true, Engine: true, Content: true},
	{Name: "245.2", Client: true, Engine: true, Content: true},
	{Name: "254", Client: true, Engine: true, Content: true},
	{Name: "274", Client: true, Engine: true, Content: true},
	{Name: "289", Client: true, Engine: true, Content: true},
	{Name: "500", Client: true},
}

type ghBranch struct {
	Name string `json:"name"`
}

func fetchBranches(client *http.Client, repoURL string) ([]string, error) {
	api := strings.Replace(repoURL, "https://github.com/", "https://api.github.com/repos/", 1) + "/branches?per_page=100"
	req, err := http.NewRequest("GET", api, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "lclite-launcher")
	if tok := os.Getenv("GITHUB_TOKEN"); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	res, err := client.Do(req.WithContext(ctx))
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("github api: %s", res.Status)
	}
	var branches []ghBranch
	if err := json.NewDecoder(res.Body).Decode(&branches); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(branches))
	for _, b := range branches {
		out = append(out, b.Name)
	}
	return out, nil
}

// listRevs merges the client, engine and content branch lists into revisions.
// The engine+content pair is what actually runs a world; the client is only
// needed to build (or mod) the browser client.
func (l *Launcher) listRevs() ([]Rev, string, error) {
	clientBr, cerr := fetchBranches(l.httpClient, clientRepoURL)
	engineBr, eerr := fetchBranches(l.httpClient, engineRepoURL)
	contentBr, xerr := fetchBranches(l.httpClient, contentRepoURL)
	if cerr != nil && eerr != nil && xerr != nil {
		return fallbackRevs, "offline: using the built-in revision list (" + cerr.Error() + ")", nil
	}

	seen := map[string]*Rev{}
	add := func(name string, kind string) {
		r, ok := seen[name]
		if !ok {
			r = &Rev{Name: name}
			seen[name] = r
		}
		switch kind {
		case "client":
			r.Client = true
		case "engine":
			r.Engine = true
		case "content":
			r.Content = true
		}
	}
	for _, b := range clientBr {
		add(b, "client")
	}
	for _, b := range engineBr {
		add(b, "engine")
	}
	for _, b := range contentBr {
		add(b, "content")
	}

	revs := make([]Rev, 0, len(seen))
	for _, r := range seen {
		if isHiddenRev(r.Name) {
			continue
		}
		revs = append(revs, *r)
	}
	sortRevs(revs)

	note := ""
	if cerr != nil || eerr != nil || xerr != nil {
		missing := []string{}
		if cerr != nil {
			missing = append(missing, "client")
		}
		if eerr != nil {
			missing = append(missing, "engine")
		}
		if xerr != nil {
			missing = append(missing, "content")
		}
		note = "partial: could not reach the " + strings.Join(missing, "+") + " branch list"
	}
	return revs, note, nil
}

// revScore extracts the revision number from a branch name (289 -> 289,
// 245.2 -> 245.2). Non-numeric or variant branches score 0, false.
func revScore(name string) (float64, bool) {
	num := strings.Builder{}
	for _, r := range name {
		if (r >= '0' && r <= '9') || r == '.' {
			num.WriteRune(r)
			continue
		}
		break
	}
	if num.Len() == 0 {
		return 0, false
	}
	var f float64
	if _, err := fmt.Sscanf(num.String(), "%f", &f); err != nil {
		return 0, false
	}
	return f, true
}

// sortRevs orders revisions numerically when possible, newest first.
func sortRevs(revs []Rev) {
	sort.SliceStable(revs, func(i, j int) bool {
		a, aok := revScore(revs[i].Name)
		b, bok := revScore(revs[j].Name)
		if aok != bok {
			return aok
		}
		if aok && b != a {
			return a > b
		}
		return revs[i].Name < revs[j].Name
	})
}

// pickRecommended leads with the revision the Lost City team is actually
// developing: the highest-numbered revision that exists in the client, engine
// AND content repos. Variant branches (-custom, -gpu, -wip, -node) and
// client-only branches are never recommended. An explicit pin in config wins.
func pickRecommended(revs []Rev, pinned string) string {
	if pinned != "" {
		for _, r := range revs {
			if r.Name == pinned {
				return pinned
			}
		}
	}
	best, bestScore := "", -1.0
	for _, r := range revs {
		if !r.Client || !r.Engine || !r.Content {
			continue
		}
		if strings.ContainsAny(r.Name, "-_") {
			continue
		}
		score, ok := revScore(r.Name)
		if !ok {
			continue
		}
		if score > bestScore {
			bestScore, best = score, r.Name
		}
	}
	return best
}

// branchCommitDate asks GitHub when a branch last moved (one call, for the
// recommended revision only — the branch list itself carries no dates).
func branchCommitDate(client *http.Client, repoURL, branch string) (time.Time, error) {
	api := strings.Replace(repoURL, "https://github.com/", "https://api.github.com/repos/", 1) + "/commits/" + branch
	req, err := http.NewRequest("GET", api, nil)
	if err != nil {
		return time.Time{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "lclite-launcher")
	if tok := os.Getenv("GITHUB_TOKEN"); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	res, err := client.Do(req.WithContext(ctx))
	if err != nil {
		return time.Time{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return time.Time{}, fmt.Errorf("github api: %s", res.Status)
	}
	var commit struct {
		Commit struct {
			Committer struct {
				Date time.Time `json:"date"`
			} `json:"committer"`
		} `json:"commit"`
	}
	if err := json.NewDecoder(res.Body).Decode(&commit); err != nil {
		return time.Time{}, err
	}
	return commit.Commit.Committer.Date, nil
}

func (l *Launcher) runGit(j *Job, dir string, args ...string) error {
	full := args
	if dir != "" {
		full = append([]string{"-C", dir}, args...)
	}
	return j.runCmd("git", full...)
}

// syncRepo clones or fast-forwards one repo at the requested branch.
func (l *Launcher) syncRepo(j *Job, dir, url, branch string) error {
	gitDir := filepath.Join(dir, ".git")
	if _, err := os.Stat(gitDir); err != nil {
		if entries, derr := os.ReadDir(dir); derr == nil && len(entries) > 0 {
			return fmt.Errorf("%s already exists but is not a git checkout — remove it or pick another folder", dir)
		}
		j.logf("cloning %s @ %s", filepath.Base(dir), branch)
		return l.runGit(j, "", "clone", "--branch", branch, "--depth", "1", url, dir)
	}
	dirty, err := l.isDirty(dir)
	if err != nil {
		return err
	}
	if dirty {
		return fmt.Errorf("%s has local changes (mods applied?) — run \"Reset to pristine\" first", filepath.Base(dir))
	}
	j.logf("updating %s @ %s", filepath.Base(dir), branch)
	if err := l.runGit(j, dir, "fetch", "--depth", "1", "origin", branch); err != nil {
		return err
	}
	return l.runGit(j, dir, "checkout", "-B", branch, "FETCH_HEAD")
}

func (l *Launcher) isDirty(repoDir string) (bool, error) {
	out, err := runCapture("git", "-C", repoDir, "status", "--porcelain")
	if err != nil {
		return false, fmt.Errorf("git status failed in %s: %v", repoDir, err)
	}
	return strings.TrimSpace(out) != "", nil
}

func (l *Launcher) repoBranch(repoDir string) string {
	out, err := runCapture("git", "-C", repoDir, "branch", "--show-current")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

// resetRepo throws away local modifications (the "strip my mods" escape hatch).
func (l *Launcher) resetRepo(j *Job, repoDir string) error {
	if err := l.runGit(j, repoDir, "checkout", "--", "."); err != nil {
		return err
	}
	return l.runGit(j, repoDir, "clean", "-fd", "--", "src", "tools", "view")
}

// validateRoot reports whether a folder looks like a Lost City root.
func validateRoot(root string) (hasClient, hasEngine, hasOverlay bool) {
	if st, err := os.Stat(filepath.Join(root, "webclient", "package.json")); err == nil && !st.IsDir() {
		hasClient = true
	}
	if st, err := os.Stat(filepath.Join(root, "engine", "package.json")); err == nil && !st.IsDir() {
		hasEngine = true
	}
	if st, err := os.Stat(filepath.Join(root, "lclite", "tools", "lclite.mjs")); err == nil && !st.IsDir() {
		hasOverlay = true
	}
	return
}
