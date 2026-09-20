package main

import (
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
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
	// The list is what "open the save folder" is about, so each row has to carry
	// enough to recognise the file in Explorer.
	if !strings.HasSuffix(byName["alice"].Path, "alice"+saveExt) {
		t.Fatalf("a listed character must report its own path, got %q", byName["alice"].Path)
	}
	if byName["alice"].Size == 0 {
		t.Fatal("expected the file size reported")
	}
}

func TestListSavesOnAMissingFolderIsEmptyNotAnError(t *testing.T) {
	in := &Install{ID: "gone", Path: t.TempDir()}
	if got := ListSaves(in); len(got) != 0 {
		t.Fatalf("expected an empty list, got %+v", got)
	}
}

// ---- the endpoints ---------------------------------------------------------

func TestHandleSavesListsTheWorldsCharacters(t *testing.T) {
	l, _ := newLauncher(t.TempDir(), "test", false)
	in := fullInstall(t, "289", "main", []string{"control-panel"})
	l.store.upsertInstall(in)
	if err := os.WriteFile(filepath.Join(saveDir(in.engineDir()), "alice.sav"), makeSave([]byte("alice")), 0o644); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	l.handleSaves(rec, httptest.NewRequest("GET", "/api/saves?install=289", nil))
	var out struct {
		OK      bool       `json:"ok"`
		Install string     `json:"install"`
		Saves   []SaveFile `json:"saves"`
		Profile string     `json:"profile"`
		Dir     string     `json:"dir"`
		Running bool       `json:"running"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if !out.OK || out.Install != "289" {
		t.Fatalf("unexpected response: %s", rec.Body.String())
	}
	if len(out.Saves) != 1 || out.Saves[0].Username != "alice" || !out.Saves[0].Intact {
		t.Fatalf("expected alice intact, got %+v", out.Saves)
	}
	if out.Profile != "main" {
		t.Fatalf("expected the profile reported, got %q", out.Profile)
	}
	// The folder is what the panel's one button opens, so it has to be the real one.
	if out.Dir != saveDir(in.engineDir()) {
		t.Fatalf("expected the save folder reported, got %q", out.Dir)
	}
}

// "Open save folder" must work on a world nobody has logged into yet — an empty
// folder is the honest thing to show, and refusing to open anything is not.
func TestEnsureSaveDirCreatesTheFolder(t *testing.T) {
	in := fullInstall(t, "289", "main", nil)
	os.RemoveAll(saveDir(in.engineDir()))

	dir, err := ensureSaveDir(in)
	if err != nil {
		t.Fatalf("ensureSaveDir: %v", err)
	}
	if dir != saveDir(in.engineDir()) {
		t.Fatalf("expected the save folder, got %q", dir)
	}
	st, err := os.Stat(dir)
	if err != nil || !st.IsDir() {
		t.Fatalf("the folder must exist after ensureSaveDir: %v", err)
	}
	// Idempotent: a second call on an existing folder is a no-op, not an error.
	if again, err := ensureSaveDir(in); err != nil || again != dir {
		t.Fatalf("second call: %q, %v", again, err)
	}
}
