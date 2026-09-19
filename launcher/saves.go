package main

// The save vault — "bring your character" as a file operation.
//
// A player's progress lives on the HOST's disk, written by the host's login server
// at engine/data/players/<profile>/<username>.sav. The client never holds it, so
// nothing about a save can be negotiated over the game protocol. What the launcher
// can honestly offer is the file-level version: keep a copy of your character in a
// vault on your own machine, and write one back into a world you run (or are allowed
// to import into).
//
// Three things this file is careful about:
//
//  1. INTEGRITY. The engine's saves carry magic 0x2004, a version, and a CRC-32
//     trailer over everything before it. The launcher checks all three before
//     accepting a file, so a corrupt or foreign file is refused here instead of
//     being handed to a world to choke on. The rule was verified against every save
//     in a live install (17/17) — see save_test.go.
//  2. NOT WIPING PROGRESS. The engine refuses a save whose playtime went backwards
//     (LoginServer.wouldResetSaveFile). Reading playtime in Go would mean
//     reimplementing a revision-specific binary layout that upstream is free to
//     change, so the launcher compares FILE TIMESTAMPS instead — and says so in the
//     UI, because "newer file wins" is a weaker rule than the engine's own.
//  3. A STOPPED WORLD. A running login server rewrites the save on logout/autosave,
//     so an import into a live world would be silently overwritten. Import therefore
//     requires that world stopped.
//
// What this does NOT do: prove a character was earned. The CRC is an integrity
// check, not a signature — anyone can craft a save that passes it. Importing is a
// trust decision between people who already chose to play together.

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	saveMagic   = 0x2004
	saveVersion = 7
	// saveExt is the engine's own extension; anything else in the folder is left alone.
	saveExt = ".sav"
)

// saveProfile reads the world's save namespace. Upstream default is 'main'; the
// 274+ JSON config calls it node.profile, the older dotenv style calls it
// NODE_PROFILE.
func saveProfile(engineDir string) string {
	if m, err := readJSONFile(filepath.Join(engineDir, "data", "config", "world.json")); err == nil {
		if n, ok := m["node"].(map[string]any); ok {
			if p, ok := n["profile"].(string); ok && strings.TrimSpace(p) != "" {
				return strings.TrimSpace(p)
			}
		}
	}
	if p := strings.TrimSpace(readEnvFile(engineDir)["NODE_PROFILE"]); p != "" {
		return p
	}
	return "main"
}

// saveDir is where a world's characters live.
func saveDir(engineDir string) string {
	return filepath.Join(engineDir, "data", "players", saveProfile(engineDir))
}

// VerifySave applies the engine's own integrity rule to a save file.
//
// Layout: magic(2) version(2) …payload… crc32(4, signed big-endian), where the CRC
// is CRC-32/IEEE over every byte before the trailer. Verified against real saves
// rather than assumed from the reader's source.
func VerifySave(data []byte) error {
	if len(data) < 8 {
		return fmt.Errorf("that file is too small to be a save")
	}
	if magic := binary.BigEndian.Uint16(data[0:2]); magic != saveMagic {
		return fmt.Errorf("not a Lost City save (magic 0x%04x, expected 0x%04x)", magic, saveMagic)
	}
	if ver := binary.BigEndian.Uint16(data[2:4]); ver > saveVersion {
		return fmt.Errorf("that save comes from a newer engine (version %d, this one reads %d)", ver, saveVersion)
	}
	want := int32(binary.BigEndian.Uint32(data[len(data)-4:]))
	got := int32(crc32.ChecksumIEEE(data[:len(data)-4]))
	if want != got {
		return fmt.Errorf("that save is damaged (checksum mismatch — it was edited or truncated)")
	}
	return nil
}

// SaveFile is one character file as the UI sees it.
type SaveFile struct {
	Username string    `json:"username"`
	Profile  string    `json:"profile"`
	Path     string    `json:"path"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
	// Intact is the engine's own integrity rule, checked here so the list can show
	// a broken file before you try to use it.
	Intact  bool   `json:"intact"`
	Problem string `json:"problem,omitempty"`
	// InVault is set when a copy of this character also exists in the local vault.
	InVault bool `json:"in_vault,omitempty"`
}

// ListSaves lists the characters in an install's save folder.
func ListSaves(in *Install) []SaveFile {
	out := []SaveFile{}
	dir := saveDir(in.engineDir())
	entries, err := os.ReadDir(dir)
	if err != nil {
		return out
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), saveExt) {
			continue
		}
		full := filepath.Join(dir, e.Name())
		st, err := e.Info()
		if err != nil {
			continue
		}
		sf := SaveFile{
			Username: strings.TrimSuffix(e.Name(), filepath.Ext(e.Name())),
			Profile:  saveProfile(in.engineDir()),
			Path:     full,
			Size:     st.Size(),
			Modified: st.ModTime(),
			Intact:   true,
		}
		if raw, err := os.ReadFile(full); err != nil {
			sf.Intact = false
			sf.Problem = "could not be read: " + err.Error()
		} else if err := VerifySave(raw); err != nil {
			sf.Intact = false
			sf.Problem = err.Error()
		}
		out = append(out, sf)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Modified.Equal(out[j].Modified) {
			return out[i].Username < out[j].Username
		}
		return out[i].Modified.After(out[j].Modified)
	})
	return out
}

// ---- the vault -------------------------------------------------------------
//
// Layout, under the launcher's own data folder (never in an install, so deleting an
// install never loses the only copy of a character):
//
//	<data>/saves/<worldID>/world.json   the signed manifest it was pulled from
//	<data>/saves/<worldID>/<user>.sav   the character itself

// VaultEntry is one character in the local vault.
type VaultEntry struct {
	WorldID   string    `json:"world_id"`
	WorldName string    `json:"world_name"`
	Username  string    `json:"username"`
	Path      string    `json:"path"`
	Size      int64     `json:"size"`
	Modified  time.Time `json:"modified"`
}

func vaultRoot(dataDir string) string { return filepath.Join(dataDir, "saves") }

func vaultDir(dataDir, worldID string) string {
	if strings.TrimSpace(worldID) == "" {
		worldID = "unclaimed"
	}
	return filepath.Join(vaultRoot(dataDir), safeName(worldID))
}

// VaultList walks the vault, reading each folder's world.json so a character is
// always shown with the world it came from.
func (l *Launcher) VaultList() []VaultEntry {
	out := []VaultEntry{}
	root := vaultRoot(l.dataDir)
	worlds, err := os.ReadDir(root)
	if err != nil {
		return out
	}
	for _, w := range worlds {
		if !w.IsDir() {
			continue
		}
		dir := filepath.Join(root, w.Name())
		name := w.Name()
		if raw, err := os.ReadFile(filepath.Join(dir, "world.json")); err == nil {
			var m WorldManifest
			if json.Unmarshal(raw, &m) == nil && m.Name != "" {
				name = m.Name
			}
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), saveExt) {
				continue
			}
			st, err := e.Info()
			if err != nil {
				continue
			}
			out = append(out, VaultEntry{
				WorldID:   w.Name(),
				WorldName: name,
				Username:  strings.TrimSuffix(e.Name(), filepath.Ext(e.Name())),
				Path:      filepath.Join(dir, e.Name()),
				Size:      st.Size(),
				Modified:  st.ModTime(),
			})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Modified.Equal(out[j].Modified) {
			return out[i].Username < out[j].Username
		}
		return out[i].Modified.After(out[j].Modified)
	})
	return out
}

// VaultStore copies a character out of an install into the vault, next to the
// manifest of the world it came from. Returns the vault path.
//
// The copy is verified first: vaulting a broken file would make the vault a trap
// rather than a backup.
func (l *Launcher) VaultStore(in *Install, worldID, worldName, username string, manifest *WorldManifest) (string, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return "", fmt.Errorf("no character name given")
	}
	src := filepath.Join(saveDir(in.engineDir()), safeName(username)+saveExt)
	raw, err := os.ReadFile(src)
	if err != nil {
		return "", fmt.Errorf("could not read %s: %v", username, err)
	}
	if err := VerifySave(raw); err != nil {
		return "", err
	}
	dir := vaultDir(l.dataDir, worldID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	dst := filepath.Join(dir, safeName(username)+saveExt)
	if err := os.WriteFile(dst, raw, 0o644); err != nil {
		return "", err
	}
	// Provenance: remember which world this came from, so the vault can name it
	// after the install has been deleted.
	if manifest != nil {
		m := *manifest
		if strings.TrimSpace(m.Name) == "" {
			m.Name = strings.TrimSpace(worldName)
		}
		if raw, err := marshalIndent(m); err == nil {
			_ = os.WriteFile(filepath.Join(dir, "world.json"), raw, 0o644)
		}
	}
	return dst, nil
}

// ImportResult reports what an import did, and every reason it hedged.
type ImportResult struct {
	Username string   `json:"username"`
	Path     string   `json:"path"`
	Replaced bool     `json:"replaced"`
	Backup   string   `json:"backup,omitempty"`
	Warnings []string `json:"warnings"`
}

// ImportSave writes a character file into an install's save folder.
//
// Order of checks matters: the world must be stopped (or the login server would
// overwrite this on the next autosave), the file must be a valid save, and it must
// not be older than the character already sitting there unless the caller insists.
func (l *Launcher) ImportSave(in *Install, srcPath, username string, force bool) (ImportResult, error) {
	res := ImportResult{Warnings: []string{}}

	if l.engine.Busy() && strings.EqualFold(l.engine.InstallID(), in.ID) {
		return res, fmt.Errorf("stop this world first — a running server rewrites the save on logout and would discard the import")
	}
	srcPath = strings.TrimSpace(srcPath)
	if srcPath == "" {
		return res, fmt.Errorf("no file given")
	}
	raw, err := os.ReadFile(srcPath)
	if err != nil {
		return res, fmt.Errorf("could not read that file: %v", err)
	}
	if err := VerifySave(raw); err != nil {
		return res, err
	}
	srcInfo, err := os.Stat(srcPath)
	if err != nil {
		return res, err
	}

	username = strings.TrimSpace(username)
	if username == "" {
		username = strings.TrimSuffix(filepath.Base(srcPath), filepath.Ext(srcPath))
	}
	if username == "" {
		return res, fmt.Errorf("no character name given")
	}
	res.Username = username

	dir := saveDir(in.engineDir())
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return res, err
	}
	dst := filepath.Join(dir, safeName(username)+saveExt)

	if st, err := os.Stat(dst); err == nil {
		// A newer file already there is the case worth stopping for: importing a
		// stale backup over live progress is exactly the accident this is meant to
		// prevent. (The engine guards this with playtime; the launcher only has
		// timestamps, so it asks rather than decides.)
		if st.ModTime().After(srcInfo.ModTime()) && !force {
			return res, fmt.Errorf("this world already has a newer save for %s (%s vs %s) — importing would go backwards; say so explicitly to overwrite",
				username, st.ModTime().Format("2006-01-02 15:04"), srcInfo.ModTime().Format("2006-01-02 15:04"))
		}
		// Keep the file being replaced rather than deleting it: an import that
		// turns out to be a mistake must be undoable.
		bak := dst + ".replaced-" + time.Now().Format("20060102-150405")
		if err := copyFile(dst, bak); err == nil {
			res.Backup = bak
			res.Warnings = append(res.Warnings, "the previous character was kept at "+bak)
		}
		res.Replaced = true
	}

	if err := os.WriteFile(dst, raw, 0o644); err != nil {
		return res, err
	}
	res.Path = dst
	return res, nil
}

// ExportSave copies a character out to a path the player chooses (a folder they can
// hand to someone, a USB stick, a backup drive).
func (l *Launcher) ExportSave(in *Install, username, destPath string) (string, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return "", fmt.Errorf("no character name given")
	}
	src := filepath.Join(saveDir(in.engineDir()), safeName(username)+saveExt)
	raw, err := os.ReadFile(src)
	if err != nil {
		return "", fmt.Errorf("could not read %s: %v", username, err)
	}
	if err := VerifySave(raw); err != nil {
		return "", err
	}
	destPath = strings.TrimSpace(destPath)
	if destPath == "" {
		return "", fmt.Errorf("no destination given")
	}
	if st, err := os.Stat(destPath); err == nil && st.IsDir() {
		destPath = filepath.Join(destPath, safeName(username)+saveExt)
	}
	if !strings.HasSuffix(strings.ToLower(destPath), saveExt) {
		destPath += saveExt
	}
	if err := os.WriteFile(destPath, raw, 0o644); err != nil {
		return "", err
	}
	return destPath, nil
}

// copyFile already lives in pipeline.go (identical small-file copy) — reused here.
