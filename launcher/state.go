package main

import (
	"crypto/ed25519"
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

// World is one entry in the local world list: somebody's signed description of their
// server, plus what this launcher knows about it. There is no directory service, so
// the list is built by pasting invite codes and is kept locally.
type World struct {
	Manifest WorldManifest `json:"manifest"`
	// Favorite pins a world to the top AND keeps it in the list while it is offline.
	// Everything else offline folds away, so a dead world stops taking up room
	// without being forgotten.
	Favorite bool      `json:"favorite,omitempty"`
	AddedAt  time.Time `json:"added_at"`
	// LastSeen/LastStatus are what the last probe saw, so an offline world can say
	// when it was last up instead of just vanishing.
	LastSeen   time.Time `json:"last_seen,omitempty"`
	LastStatus string    `json:"last_status,omitempty"`
}

type Config struct {
	DataDir   string     `json:"data_dir"`
	Installs  []*Install `json:"installs"`
	Worlds    []*World   `json:"worlds"`
	Revs      []Rev      `json:"revs"`
	RevsAt    time.Time  `json:"revs_at"`
	ProxyPort int        `json:"proxy_port"`
	LastRev   string     `json:"last_rev"`

	// HostKey is this launcher's world-signing identity, created on first publish.
	// One key for the whole launcher, so a host's worlds all verify under one
	// fingerprint a player can learn.
	HostKey HostKey `json:"host_key,omitempty"`
	// MyWorld is the host's own editable description of the world this machine runs.
	MyWorld LocalWorld `json:"my_world,omitempty"`

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
	if s.cfg.Worlds == nil {
		s.cfg.Worlds = []*World{}
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
	cp.Worlds = append([]*World(nil), s.cfg.Worlds...)
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
	"worlds": true,
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

// ---- worlds ---------------------------------------------------------------

// addWorld stores a world, keyed by its manifest ID (which is derived from the
// host's key). Re-adding a world the player already has UPDATES it rather than
// duplicating it — that is what makes forwarding a fresh code work as "this world
// changed" instead of "here is a second copy".
func (s *Store) addWorld(w World) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, ex := range s.cfg.Worlds {
		if ex.Manifest.ID != "" && ex.Manifest.ID == w.Manifest.ID {
			// Keep the player's own state; take the host's new description.
			w.AddedAt = ex.AddedAt
			w.Favorite = ex.Favorite
			w.LastSeen = ex.LastSeen
			w.LastStatus = ex.LastStatus
			s.cfg.Worlds[i] = &w
			_ = s.save()
			return true
		}
	}
	s.cfg.Worlds = append(s.cfg.Worlds, &w)
	_ = s.save()
	return false
}

func (s *Store) removeWorld(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.cfg.Worlds[:0]
	for _, w := range s.cfg.Worlds {
		if !strings.EqualFold(w.Manifest.ID, id) {
			out = append(out, w)
		}
	}
	s.cfg.Worlds = out
	_ = s.save()
}

// updateWorld applies fn to one world under the lock. Returns false if it is gone.
func (s *Store) updateWorld(id string, fn func(*World)) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, w := range s.cfg.Worlds {
		if strings.EqualFold(w.Manifest.ID, id) {
			fn(w)
			_ = s.save()
			return true
		}
	}
	return false
}

func (s *Store) setMyWorld(lw LocalWorld) {
	s.mu.Lock()
	s.cfg.MyWorld = lw
	s.mu.Unlock()
	_ = s.save()
}

// hostKey returns this launcher's signing key, creating and persisting it on first
// use. The key is the world's identity, so it must never be silently regenerated.
func (s *Store) hostKey() (ed25519.PrivateKey, error) {
	s.mu.Lock()
	key := s.cfg.HostKey
	s.mu.Unlock()

	priv, err := key.EnsureHostKey()
	if err != nil {
		return nil, err
	}
	// Only a key that did not exist yet needs persisting.
	if key.Private != s.cfg.HostKey.Private {
		s.mu.Lock()
		s.cfg.HostKey = key
		s.mu.Unlock()
		_ = s.save()
	}
	return priv, nil
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

func (c Config) worldByID(id string) *World {
	for _, w := range c.Worlds {
		if strings.EqualFold(w.Manifest.ID, id) {
			return w
		}
	}
	return nil
}

// worldByAddr finds the saved world a typed address belongs to, so a player who
// pastes an address instead of a code still gets that world's mod rules.
func (c Config) worldByAddr(addr string) *World {
	for _, w := range c.Worlds {
		if sameWorldAddr(w.Manifest.Address, addr) {
			return w
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
