package main

// Saves — showing a world's characters, and nothing more.
//
// A player's progress lives on the HOST's disk, written by the host's login server
// at engine/data/players/<profile>/<username>.sav. The client never holds it, so
// nothing about a save can be negotiated over the game protocol — and "bring your
// character to somebody else's world" was never really a feature: the file only
// means anything on a world that already has your name on it, and it is a file the
// HOST owns. The launcher used to offer a vault (copy a character out, import one
// in); that was removed on purpose rather than kept as a half-truth. See
// launcher/README.md.
//
// What is left is the honest part, and the part a player actually needs: SEE the
// characters a world has, notice when one is damaged, and open the folder to manage
// the files with tools that are better at it than this launcher is.
//
// The one piece of real machinery kept from that work is the integrity rule, because
// a save that does not verify is worth knowing about before a world chokes on it:
// magic 0x2004, a version, and a CRC-32 trailer over everything before it. It was
// derived from the engine's own reader and checked against every save in the live
// installs (19/19) — see save_test.go.
//
// What this does NOT do: prove a character was earned. The CRC is an integrity
// check, not a signature — anyone can craft a save that passes it.

import (
	"encoding/binary"
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
	// a broken file before a world has to deal with it.
	Intact  bool   `json:"intact"`
	Problem string `json:"problem,omitempty"`
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
