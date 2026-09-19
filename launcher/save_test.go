package main

import (
	"encoding/binary"
	"hash/crc32"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// makeSave builds a file in the engine's own format: magic 0x2004, version, payload,
// then the signed big-endian CRC-32 of everything before it.
func makeSave(payload []byte) []byte {
	out := make([]byte, 0, len(payload)+8)
	out = append(out, 0x20, 0x04, 0x00, 0x07)
	out = append(out, payload...)
	var trailer [4]byte
	binary.BigEndian.PutUint32(trailer[:], crc32.ChecksumIEEE(out))
	return append(out, trailer[:]...)
}

// fixtureInstall builds a throwaway install whose engine looks enough like a real one:
// a world.json naming the save profile, and a players/<profile>/ folder.
func fixtureInstall(t *testing.T, profile string, saves map[string][]byte) *Install {
	t.Helper()
	root := t.TempDir()
	engine := filepath.Join(root, "engine")
	if err := os.MkdirAll(filepath.Join(engine, "data", "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	cfg := map[string]any{"node": map[string]any{"port": 43594, "profile": profile}}
	if err := writeJSONFile(filepath.Join(engine, "data", "config", "world.json"), cfg); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(engine, "data", "players", profile)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, raw := range saves {
		if err := os.WriteFile(filepath.Join(dir, name+saveExt), raw, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return &Install{ID: "test", Path: root, Rev: "289"}
}

// The integrity rule was derived from the reader's source; this proves it against
// real files, which is the only claim worth making. Skips when no install exists.
func TestVerifySaveAgainstRealInstall(t *testing.T) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		t.Skip("no LOCALAPPDATA on this platform")
	}
	installs, err := os.ReadDir(filepath.Join(base, "LCLite", "installs"))
	if err != nil {
		t.Skip("no LCLite installs on this machine")
	}
	checked := 0
	for _, in := range installs {
		if !in.IsDir() {
			continue
		}
		players := filepath.Join(base, "LCLite", "installs", in.Name(), "engine", "data", "players")
		profiles, err := os.ReadDir(players)
		if err != nil {
			continue
		}
		for _, p := range profiles {
			entries, err := os.ReadDir(filepath.Join(players, p.Name()))
			if err != nil {
				continue
			}
			for _, e := range entries {
				if e.IsDir() || !strings.HasSuffix(e.Name(), saveExt) {
					continue
				}
				raw, err := os.ReadFile(filepath.Join(players, p.Name(), e.Name()))
				if err != nil {
					continue
				}
				if err := VerifySave(raw); err != nil {
					t.Errorf("real save %s/%s/%s did not verify: %v", in.Name(), p.Name(), e.Name(), err)
				}
				checked++
			}
		}
	}
	if checked == 0 {
		t.Skip("no real saves found to check")
	}
	t.Logf("verified %d real saves from live installs", checked)
}

func TestVerifySaveAcceptsSynthetic(t *testing.T) {
	if err := VerifySave(makeSave([]byte("hello there, a character"))); err != nil {
		t.Fatalf("a well-formed save must verify: %v", err)
	}
	if err := VerifySave(makeSave(nil)); err != nil {
		t.Fatalf("an empty-payload save is still structurally valid: %v", err)
	}
}

func TestVerifySaveRejectsMalformed(t *testing.T) {
	good := makeSave([]byte("some character data here"))

	t.Run("too short", func(t *testing.T) {
		for _, n := range []int{0, 1, 4, 7} {
			if err := VerifySave(good[:n]); err == nil {
				t.Errorf("a %d-byte file must be rejected", n)
			}
		}
	})

	t.Run("wrong magic", func(t *testing.T) {
		bad := append([]byte(nil), good...)
		bad[0], bad[1] = 0xde, 0xad
		bad = reseal(bad)
		if err := VerifySave(bad); err == nil {
			t.Error("a foreign file must be rejected")
		}
	})

	t.Run("newer version", func(t *testing.T) {
		bad := append([]byte(nil), good...)
		bad[2], bad[3] = 0x00, 0x63 // 99
		bad = reseal(bad)
		if err := VerifySave(bad); err == nil {
			t.Error("a save from a newer engine must be rejected")
		}
	})

	t.Run("edited payload", func(t *testing.T) {
		bad := append([]byte(nil), good...)
		bad[10] ^= 0xff // the classic: someone hand-edited the character
		if err := VerifySave(bad); err == nil {
			t.Error("an edited save must be rejected — this is the whole point of the check")
		}
	})

	t.Run("truncated", func(t *testing.T) {
		if err := VerifySave(good[:len(good)-3]); err == nil {
			t.Error("a truncated save must be rejected")
		}
	})

	t.Run("edited trailer", func(t *testing.T) {
		bad := append([]byte(nil), good...)
		bad[len(bad)-1] ^= 0xff
		if err := VerifySave(bad); err == nil {
			t.Error("a corrupted checksum must be rejected")
		}
	})
}

// reseal recomputes the trailer so a test can corrupt a FIELD and still reach the
// magic/version checks rather than tripping the checksum first.
func reseal(b []byte) []byte {
	binary.BigEndian.PutUint32(b[len(b)-4:], crc32.ChecksumIEEE(b[:len(b)-4]))
	return b
}

func TestSaveProfileIsReadFromTheWorldConfig(t *testing.T) {
	in := fixtureInstall(t, "leagues", nil)
	if got := saveProfile(in.engineDir()); got != "leagues" {
		t.Fatalf("expected the profile from world.json, got %q", got)
	}
	// A world with no config falls back to upstream's default.
	bare := t.TempDir()
	if got := saveProfile(bare); got != "main" {
		t.Fatalf("expected the upstream default, got %q", got)
	}
	// The older dotenv style is read too.
	old := t.TempDir()
	if err := os.WriteFile(filepath.Join(old, ".env"), []byte("NODE_PROFILE=oldworld\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := saveProfile(old); got != "oldworld" {
		t.Fatalf("expected the dotenv profile, got %q", got)
	}
}

func TestListSavesReportsIntegrity(t *testing.T) {
	good := makeSave([]byte("a real character"))
	broken := makeSave([]byte("a real character"))
	broken[9] ^= 0xff
	in := fixtureInstall(t, "main", map[string][]byte{"alice": good, "bob": broken})
	// Something that is not a save at all must not appear as a character.
	if err := os.WriteFile(filepath.Join(saveDir(in.engineDir()), "notes.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}

	list := ListSaves(in)
	if len(list) != 2 {
		t.Fatalf("expected 2 characters, got %d (%+v)", len(list), list)
	}
	byName := map[string]SaveFile{}
	for _, s := range list {
		byName[s.Username] = s
	}
	if !byName["alice"].Intact {
		t.Fatalf("alice should read as intact: %+v", byName["alice"])
	}
	if byName["bob"].Intact {
		t.Fatal("bob is corrupt and must be flagged, not silently listed as fine")
	}
	if byName["bob"].Problem == "" {
		t.Fatal("a broken save must explain itself")
	}
	if byName["alice"].Profile != "main" {
		t.Fatalf("expected the profile reported, got %q", byName["alice"].Profile)
	}
}

func TestListSavesOnAMissingFolderIsEmptyNotAnError(t *testing.T) {
	in := &Install{ID: "gone", Path: t.TempDir()}
	if got := ListSaves(in); len(got) != 0 {
		t.Fatalf("expected an empty list, got %+v", got)
	}
}

func TestImportSaveGuards(t *testing.T) {
	in := fixtureInstall(t, "main", nil)
	src := filepath.Join(t.TempDir(), "alice.sav")
	if err := os.WriteFile(src, makeSave([]byte("alice's character")), 0o644); err != nil {
		t.Fatal(err)
	}

	t.Run("imports a valid file", func(t *testing.T) {
		l, err := newLauncher(t.TempDir(), "test")
		if err != nil {
			t.Fatal(err)
		}
		res, err := l.ImportSave(in, src, "", false)
		if err != nil {
			t.Fatalf("import: %v", err)
		}
		if res.Username != "alice" {
			t.Fatalf("the character name should come from the filename, got %q", res.Username)
		}
		if res.Replaced {
			t.Fatal("nothing was there to replace")
		}
		raw, err := os.ReadFile(filepath.Join(saveDir(in.engineDir()), "alice.sav"))
		if err != nil {
			t.Fatalf("the imported save should be on disk: %v", err)
		}
		if err := VerifySave(raw); err != nil {
			t.Fatalf("what landed on disk must be a valid save: %v", err)
		}
	})

	t.Run("refuses a corrupt file", func(t *testing.T) {
		l, _ := newLauncher(t.TempDir(), "test")
		bad := filepath.Join(t.TempDir(), "bob.sav")
		if err := os.WriteFile(bad, []byte("definitely not a save"), 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := l.ImportSave(in, bad, "", false); err == nil {
			t.Fatal("a corrupt file must be refused before it reaches a world")
		}
	})

	t.Run("refuses a missing file", func(t *testing.T) {
		l, _ := newLauncher(t.TempDir(), "test")
		if _, err := l.ImportSave(in, filepath.Join(t.TempDir(), "nope.sav"), "", false); err == nil {
			t.Fatal("a missing file must be refused")
		}
	})

	t.Run("will not go backwards over a newer save, but force does", func(t *testing.T) {
		l, _ := newLauncher(t.TempDir(), "test")
		dst := filepath.Join(saveDir(in.engineDir()), "alice.sav")
		// The world's copy is newer than the file being offered.
		if err := os.WriteFile(dst, makeSave([]byte("newer progress")), 0o644); err != nil {
			t.Fatal(err)
		}
		future := time.Now().Add(2 * time.Hour)
		if err := os.Chtimes(dst, future, future); err != nil {
			t.Fatal(err)
		}
		old := time.Now().Add(-2 * time.Hour)
		if err := os.Chtimes(src, old, old); err != nil {
			t.Fatal(err)
		}

		if _, err := l.ImportSave(in, src, "alice", false); err == nil {
			t.Fatal("importing an older file over newer progress must be refused by default")
		}

		res, err := l.ImportSave(in, src, "alice", true)
		if err != nil {
			t.Fatalf("force should allow it: %v", err)
		}
		if !res.Replaced || res.Backup == "" {
			t.Fatalf("a forced replace must keep the file it displaced: %+v", res)
		}
		if _, err := os.Stat(res.Backup); err != nil {
			t.Fatalf("the backup must exist on disk: %v", err)
		}
		if err := VerifySave(mustRead(t, res.Backup)); err != nil {
			t.Fatalf("the backup must be the old valid save: %v", err)
		}
	})

	t.Run("refuses while that world is running", func(t *testing.T) {
		l, _ := newLauncher(t.TempDir(), "test")
		l.engine.state = "running"
		l.engine.installID = in.ID
		if _, err := l.ImportSave(in, src, "alice", true); err == nil {
			t.Fatal("importing into a running world must be refused — the autosave would discard it")
		}
		// A DIFFERENT world running is fine: it cannot touch this install's saves.
		l.engine.installID = "some-other-install"
		if _, err := l.ImportSave(in, src, "alice", true); err != nil {
			t.Fatalf("another world running must not block this install: %v", err)
		}
	})
}

func TestExportSave(t *testing.T) {
	in := fixtureInstall(t, "main", map[string][]byte{"alice": makeSave([]byte("alice"))})
	l, _ := newLauncher(t.TempDir(), "test")

	dest := filepath.Join(t.TempDir(), "out")
	if err := os.MkdirAll(dest, 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := l.ExportSave(in, "alice", dest)
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if !strings.HasSuffix(got, "alice"+saveExt) {
		t.Fatalf("exporting into a folder should name the file, got %q", got)
	}
	if err := VerifySave(mustRead(t, got)); err != nil {
		t.Fatalf("the exported file must be a valid save: %v", err)
	}

	// A path without the extension gets one.
	plain := filepath.Join(t.TempDir(), "backup")
	got2, err := l.ExportSave(in, "alice", plain)
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if !strings.HasSuffix(got2, saveExt) {
		t.Fatalf("expected the extension appended, got %q", got2)
	}

	if _, err := l.ExportSave(in, "nobody", t.TempDir()); err == nil {
		t.Fatal("exporting a character that does not exist must fail")
	}
}

func TestVaultStoresProvenanceAndSurvivesTheInstall(t *testing.T) {
	in := fixtureInstall(t, "main", map[string][]byte{"alice": makeSave([]byte("alice"))})
	l, _ := newLauncher(t.TempDir(), "test")

	m := WorldManifest{Name: "Bob's 289", Address: "10.0.0.5:8080"}
	path, err := l.VaultStore(in, "w0123456789abcdef", m.Name, "alice", &m)
	if err != nil {
		t.Fatalf("vault store: %v", err)
	}
	if err := VerifySave(mustRead(t, path)); err != nil {
		t.Fatalf("the vaulted copy must be valid: %v", err)
	}

	list := l.VaultList()
	if len(list) != 1 {
		t.Fatalf("expected 1 vault entry, got %d", len(list))
	}
	if list[0].Username != "alice" {
		t.Fatalf("expected alice, got %q", list[0].Username)
	}
	if list[0].WorldName != "Bob's 289" {
		t.Fatalf("the vault must remember which world a character came from, got %q", list[0].WorldName)
	}

	// The install folder is now irrelevant: the vault copy is what survives.
	if err := os.RemoveAll(in.Path); err != nil {
		t.Fatal(err)
	}
	if got := l.VaultList(); len(got) != 1 {
		t.Fatalf("deleting the install must not lose the vault: %+v", got)
	}
}

func TestVaultRefusesToStoreABrokenSave(t *testing.T) {
	broken := makeSave([]byte("alice"))
	broken[9] ^= 0xff
	in := fixtureInstall(t, "main", map[string][]byte{"alice": broken})
	l, _ := newLauncher(t.TempDir(), "test")
	if _, err := l.VaultStore(in, "w1", "Test", "alice", nil); err == nil {
		t.Fatal("vaulting a broken save would make the vault a trap, not a backup")
	}
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return raw
}
