package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	clientRepoURL  = "https://github.com/LostCityRS/Client-TS"
	engineRepoURL  = "https://github.com/LostCityRS/Engine-TS"
	contentRepoURL = "https://github.com/LostCityRS/Content"
	overlayRepoURL = "https://github.com/skulltrick/lclite"
)

// launcherVersion is stamped at build time — the release tag is the source of truth:
//
//	go build -ldflags "-X main.launcherVersion=0.2.0"
//	go run build.go -version v0.2.0      # strips the leading v
//
// A plain `go build` keeps the default, so a dev build is visibly not a release
// rather than quietly claiming a version it isn't. It cannot be a const: -X only
// writes to string vars.
var launcherVersion = "dev"

// Rev is one Lost City revision, derived from the client + engine branch lists.
type Rev struct {
	Name    string `json:"name"`
	Client  bool   `json:"client"`
	Engine  bool   `json:"engine"`
	Content bool   `json:"content"`
	// Recommended is set on the revision the launcher leads with (see
	// pickRecommended); it is computed on read, never stored.
	Recommended bool `json:"recommended,omitempty"`
}

// Local reports whether the pair needed to run a server exists upstream
// (engine + content). The client repo only matters for building/modding it.
func (r Rev) Local() bool { return r.Engine && r.Content }

// Install is one root folder containing webclient/ (+ engine/, + lclite/).
type Install struct {
	ID      string    `json:"id"`
	Path    string    `json:"path"`
	Rev     string    `json:"rev"`
	Custom  bool      `json:"custom"`
	Overlay bool      `json:"overlay"`
	Mods    []string  `json:"mods"`
	BuiltAt time.Time `json:"built_at"`
	AddedAt time.Time `json:"added_at"`
}

type Config struct {
	DataDir   string     `json:"data_dir"`
	Installs  []*Install `json:"installs"`
	Revs      []Rev      `json:"revs"`
	RevsAt    time.Time  `json:"revs_at"`
	ProxyPort int        `json:"proxy_port"`
	LastRev   string     `json:"last_rev"`

	// RecommendedRev pins the revision the UI leads with. Empty = work it out
	// from the branch lists (see pickRecommended).
	RecommendedRev string `json:"recommended_rev,omitempty"`
	// RecommendedUpdated is when the recommended revision's content branch last
	// moved, filled in when the branch list is refreshed.
	RecommendedUpdated time.Time `json:"recommended_updated,omitempty"`
	// SkipWizard keeps the full view even with nothing installed.
	SkipWizard bool `json:"skip_wizard,omitempty"`
	// Collapsed lists the dashboard sections the user folded away. It lives here
	// (not in localStorage) because the UI port is random per run, so a
	// browser-side preference would reset on every launch.
	Collapsed []string `json:"collapsed"`
}

type Store struct {
	mu   sync.Mutex
	path string
	cfg  Config
}

func defaultDataDir() string {
	if v := os.Getenv("LCLITE_LAUNCHER_DATA"); v != "" {
		return v
	}
	if runtime.GOOS == "windows" {
		if v := os.Getenv("LOCALAPPDATA"); v != "" {
			return filepath.Join(v, "LCLite")
		}
	}
	if v := os.Getenv("XDG_DATA_HOME"); v != "" {
		return filepath.Join(v, "lclite")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "lclite-data"
	}
	return filepath.Join(home, ".local", "share", "lclite")
}

func openStore(dataDir string) (*Store, error) {
	if dataDir == "" {
		dataDir = defaultDataDir()
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "installs"), 0o755); err != nil {
		return nil, err
	}
	s := &Store{path: filepath.Join(dataDir, "launcher.json")}
	s.cfg = Config{DataDir: dataDir, ProxyPort: 8890}
	if raw, err := os.ReadFile(s.path); err == nil {
		_ = json.Unmarshal(raw, &s.cfg)
		if s.cfg.ProxyPort == 0 {
			s.cfg.ProxyPort = 8890
		}
	}
	s.cfg.DataDir = dataDir
	// keep the JSON (and the API) to real arrays instead of nulls
	if s.cfg.Installs == nil {
		s.cfg.Installs = []*Install{}
	}
	if s.cfg.Revs == nil {
		s.cfg.Revs = []Rev{}
	}
	if s.cfg.Collapsed == nil {
		s.cfg.Collapsed = []string{}
	}
	return s, nil
}

func (s *Store) save() error {
	raw, err := json.MarshalIndent(s.cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *Store) snapshot() Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := s.cfg
	cp.Installs = append([]*Install(nil), s.cfg.Installs...)
	cp.Revs = append([]Rev(nil), s.cfg.Revs...)
	return cp
}

func (s *Store) setRevs(revs []Rev) {
	s.mu.Lock()
	s.cfg.Revs = revs
	s.cfg.RevsAt = time.Now()
	s.mu.Unlock()
	_ = s.save()
}

func (s *Store) install(id string) *Install {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, in := range s.cfg.Installs {
		if strings.EqualFold(in.ID, id) {
			return in
		}
	}
	return nil
}

func (s *Store) upsertInstall(in *Install) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, ex := range s.cfg.Installs {
		if strings.EqualFold(ex.ID, in.ID) {
			s.cfg.Installs[i] = in
			_ = s.save()
			return
		}
	}
	s.cfg.Installs = append(s.cfg.Installs, in)
	_ = s.save()
}

func (s *Store) removeInstall(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.cfg.Installs[:0]
	for _, in := range s.cfg.Installs {
		if !strings.EqualFold(in.ID, id) {
			out = append(out, in)
		}
	}
	s.cfg.Installs = out
	_ = s.save()
}

func (s *Store) setMods(id string, mods []string, built bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, in := range s.cfg.Installs {
		if strings.EqualFold(in.ID, id) {
			sort.Strings(mods)
			in.Mods = mods
			if built {
				in.BuiltAt = time.Now()
			}
			_ = s.save()
			return
		}
	}
}

func (s *Store) setRecommended(rev string, updated time.Time) {
	s.mu.Lock()
	s.cfg.RecommendedRev = rev
	s.cfg.RecommendedUpdated = updated
	s.mu.Unlock()
	_ = s.save()
}

func (s *Store) setSkipWizard(skip bool) {
	s.mu.Lock()
	s.cfg.SkipWizard = skip
	s.mu.Unlock()
	_ = s.save()
}

// setCollapsed stores which dashboard sections are folded away. Only the keys
// the UI knows are kept (deduped), so a stale or buggy client can't grow the
// list or repeat an entry.
func (s *Store) setCollapsed(keys []string) {
	seen := map[string]bool{}
	out := make([]string, 0, len(keys))
	for _, k := range keys {
		if sectionKeys[k] && !seen[k] {
			seen[k] = true
			out = append(out, k)
		}
	}
	sort.Strings(out)
	s.mu.Lock()
	s.cfg.Collapsed = out
	s.mu.Unlock()
	_ = s.save()
}

// sectionKeys are the dashboard panels the UI can collapse.
var sectionKeys = map[string]bool{
	"revs": true, "installs": true, "mods": true, "server": true, "join": true,
}

func (s *Store) setLastRev(rev string) {
	s.mu.Lock()
	s.cfg.LastRev = rev
	s.mu.Unlock()
	_ = s.save()
}

func (s *Store) installDir(rev string) string {
	return filepath.Join(s.cfg.DataDir, "installs", safeName(rev))
}

func safeName(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '-', r == '_':
			out = append(out, r)
		default:
			out = append(out, '_')
		}
	}
	if len(out) == 0 {
		return "install"
	}
	return string(out)
}

func (c Config) findInstall(id string) *Install {
	for _, in := range c.Installs {
		if strings.EqualFold(in.ID, id) {
			return in
		}
	}
	return nil
}

func (c Config) installIDs() []string {
	out := make([]string, 0, len(c.Installs))
	for _, in := range c.Installs {
		out = append(out, in.ID)
	}
	sort.Strings(out)
	return out
}

func (in *Install) engineDir() string  { return filepath.Join(in.Path, "engine") }
func (in *Install) clientDir() string  { return filepath.Join(in.Path, "webclient") }
func (in *Install) overlayDir() string { return filepath.Join(in.Path, "lclite") }
func (in *Install) publicDir() string  { return filepath.Join(in.Path, "engine", "public") }

func (in *Install) String() string {
	return fmt.Sprintf("%s (%s)", in.ID, in.Path)
}
