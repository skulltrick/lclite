package main

import (
	"bytes"
	"compress/gzip"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"
)

func testManifest(t *testing.T) (WorldManifest, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	_ = pub
	m := WorldManifest{
		Name:            "Bob's 289",
		Description:     "slow xp, no teleports",
		Address:         "192.168.1.20:8080",
		Rev:             "289",
		ModsRequired:    []string{"true-tile", "gpu"},
		ModsForbidden:   []string{"no-censor"},
		AllowSaveImport: true,
		Host:            "Bob",
	}
	if err := m.Sign(priv); err != nil {
		t.Fatalf("sign: %v", err)
	}
	return m, priv
}

func TestWorldSignVerifyRoundTrip(t *testing.T) {
	m, _ := testManifest(t)
	if err := m.Verify(); err != nil {
		t.Fatalf("a freshly signed manifest must verify, got %v", err)
	}
	if !m.Signed() {
		t.Fatal("Signed() must be true after Sign")
	}
	if m.ID == "" || !strings.HasPrefix(m.ID, "w") {
		t.Fatalf("expected a derived world id, got %q", m.ID)
	}
	if m.KeyFingerprint() == "" {
		t.Fatal("expected a key fingerprint")
	}
}

// The whole point of signing: every field is covered. If any of these verifies, the
// signature is not actually binding that field.
func TestWorldSignatureCoversEveryField(t *testing.T) {
	cases := map[string]func(*WorldManifest){
		"name":        func(m *WorldManifest) { m.Name = "Not Bob's" },
		"description": func(m *WorldManifest) { m.Description = "1x xp, teleports ok" },
		"address":     func(m *WorldManifest) { m.Address = "evil.example.com:80" },
		"rev":         func(m *WorldManifest) { m.Rev = "254" },
		"host":        func(m *WorldManifest) { m.Host = "Not Bob" },
		"required":    func(m *WorldManifest) { m.ModsRequired = []string{"true-tile"} },
		"forbidden":   func(m *WorldManifest) { m.ModsForbidden = nil },
		"save import": func(m *WorldManifest) { m.AllowSaveImport = false },
		"version":     func(m *WorldManifest) { m.Version = 99 },
		"created":     func(m *WorldManifest) { m.CreatedAt = m.CreatedAt.Add(24 * 3600e9) },
	}
	for label, mutate := range cases {
		m, _ := testManifest(t)
		mutate(&m)
		if err := m.Verify(); err == nil {
			t.Errorf("tampering with %s still verified — that field is not covered by the signature", label)
		}
	}
}

func TestWorldVerifyRejectsUnsignedAndMalformed(t *testing.T) {
	m, _ := testManifest(t)

	unsigned := m
	unsigned.Sig = ""
	if err := unsigned.Verify(); err == nil {
		t.Error("an unsigned manifest must not verify")
	}

	badKey := m
	badKey.PubKey = base64.StdEncoding.EncodeToString([]byte("too short"))
	if err := badKey.Verify(); err == nil {
		t.Error("a malformed public key must not verify")
	}

	badSig := m
	badSig.Sig = base64.StdEncoding.EncodeToString([]byte("nope"))
	if err := badSig.Verify(); err == nil {
		t.Error("a malformed signature must not verify")
	}

	// A manifest re-labelled under someone else's key must not verify either.
	other, _ := testManifest(t)
	swapped := m
	swapped.PubKey = other.PubKey
	if err := swapped.Verify(); err == nil {
		t.Error("a signature must not verify under a different public key")
	}
}

func TestWorldIDIsStablePerKeyAndDiffersAcrossKeys(t *testing.T) {
	m, priv := testManifest(t)
	again := m
	if err := again.Sign(priv); err != nil {
		t.Fatalf("re-sign: %v", err)
	}
	if again.ID != m.ID {
		t.Fatalf("re-listing the same world must keep its id: %q vs %q", again.ID, m.ID)
	}
	other, _ := testManifest(t)
	if other.ID == m.ID {
		t.Fatal("two different hosts must not share a world id")
	}
}

// A value containing a newline must not be able to forge an extra signed field.
func TestSigningPayloadIsUnambiguous(t *testing.T) {
	a := WorldManifest{Name: "ok\nban=\"evil\"", Version: 1}
	b := WorldManifest{Name: "ok", ModsForbidden: []string{"evil"}, Version: 1}
	if string(a.signingPayload()) == string(b.signingPayload()) {
		t.Fatal("a newline in a name forged a forbidden-mods field — the payload is ambiguous")
	}
}

func TestInviteCodeRoundTrip(t *testing.T) {
	m, _ := testManifest(t)
	code, err := EncodeWorldCode(m)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !strings.HasPrefix(code, worldCodePrefix) {
		t.Fatalf("a code must carry its prefix, got %q", code[:min(12, len(code))])
	}
	got, err := DecodeWorldCode(code)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if err := got.Verify(); err != nil {
		t.Fatalf("a decoded code must still verify: %v", err)
	}
	if got.ID != m.ID || got.Name != m.Name || got.Address != m.Address || got.Rev != m.Rev {
		t.Fatalf("round trip lost data:\n got %+v\nwant %+v", got, m)
	}
	if got.AllowSaveImport != m.AllowSaveImport {
		t.Fatal("round trip lost the save-import flag")
	}
	if strings.Join(got.ModsRequired, ",") != strings.Join(m.ModsRequired, ",") {
		t.Fatalf("required mods changed: %v vs %v", got.ModsRequired, m.ModsRequired)
	}
	// The prefix is a convenience, not a requirement: people paste what they copied.
	unprefixed, err := DecodeWorldCode(strings.TrimPrefix(code, worldCodePrefix))
	if err != nil {
		t.Fatalf("a code without its prefix should still decode: %v", err)
	}
	if unprefixed.ID != m.ID {
		t.Fatal("unprefixed decode produced a different world")
	}
}

func TestDecodeWorldCodeRejectsJunk(t *testing.T) {
	cases := map[string]string{
		"empty":          "",
		"not base64":     "hello, this is not a world code",
		"prefix only":    worldCodePrefix,
		"base64 of junk": worldCodePrefix + base64.RawURLEncoding.EncodeToString([]byte("not gzip at all")),
		"truncated gzip": worldCodePrefix + base64.RawURLEncoding.EncodeToString([]byte{0x1f, 0x8b, 0x08}),
	}
	// A well-formed gzip stream that is not a manifest at all.
	if code, err := gzipForTest([]byte(`{"this":"is json but not a world"}`)); err == nil {
		cases["gzip of other json"] = code
	}
	// A real gzip stream holding a valid manifest shape, but no signature: it should
	// decode (the shape is fine) yet fail verification downstream.
	for label, code := range cases {
		if _, err := DecodeWorldCode(code); err == nil {
			t.Errorf("%s decoded without error", label)
		}
	}
}

// A gzip bomb must cost a rejection, not the launcher's memory.
func TestDecodeWorldCodeBoundsInflation(t *testing.T) {
	huge := bytes.Repeat([]byte("a"), 4*1024*1024) // compresses to almost nothing
	code, err := gzipForTest(huge)
	if err != nil {
		t.Fatalf("building the bomb: %v", err)
	}
	if len(code) > 64*1024 {
		t.Fatalf("expected the bomb to be small, got %d bytes", len(code))
	}
	if _, err := DecodeWorldCode(code); err == nil {
		t.Fatal("an oversized payload must be rejected")
	}
}

func TestModRulesMatrix(t *testing.T) {
	known := []string{"true-tile", "gpu", "no-censor", "hotkeys"}

	t.Run("clean set is allowed", func(t *testing.T) {
		rep := EvaluateModRules([]string{"true-tile", "gpu"}, []string{"true-tile"}, []string{"no-censor"}, known)
		if !rep.OK || rep.Blocked {
			t.Fatalf("expected ok, got %+v", rep)
		}
		if len(rep.Refused) != 0 || len(rep.Missing) != 0 {
			t.Fatalf("expected no findings, got %+v", rep)
		}
	})

	t.Run("a forbidden mod blocks", func(t *testing.T) {
		rep := EvaluateModRules([]string{"true-tile", "no-censor"}, nil, []string{"no-censor"}, known)
		if rep.OK || !rep.Blocked {
			t.Fatalf("a forbidden mod that is applied must block, got %+v", rep)
		}
		if len(rep.Refused) != 1 || rep.Refused[0] != "no-censor" {
			t.Fatalf("expected no-censor refused, got %v", rep.Refused)
		}
	})

	t.Run("a missing required mod only warns", func(t *testing.T) {
		rep := EvaluateModRules([]string{"true-tile"}, []string{"true-tile", "gpu"}, nil, known)
		if !rep.OK || rep.Blocked {
			t.Fatalf("a missing recommended mod must NOT block — the world recommends it, it does not demand it: %+v", rep)
		}
		if len(rep.Missing) != 1 || rep.Missing[0] != "gpu" {
			t.Fatalf("expected gpu missing, got %v", rep.Missing)
		}
	})

	t.Run("blocking wins over warning", func(t *testing.T) {
		rep := EvaluateModRules([]string{"no-censor"}, []string{"gpu"}, []string{"no-censor"}, known)
		if !rep.Blocked {
			t.Fatal("a forbidden mod must block even when a required one is also missing")
		}
		if len(rep.Missing) != 1 {
			t.Fatalf("the warning must still be reported, got %v", rep.Missing)
		}
	})

	t.Run("declared mods nobody has are reported", func(t *testing.T) {
		rep := EvaluateModRules([]string{"true-tile"}, []string{"someones-homebrew"}, nil, known)
		if len(rep.Unknown) != 1 || rep.Unknown[0] != "someones-homebrew" {
			t.Fatalf("expected the unknown mod reported, got %v", rep.Unknown)
		}
	})

	t.Run("no known list means don't check", func(t *testing.T) {
		rep := EvaluateModRules([]string{"true-tile"}, []string{"mystery"}, nil, nil)
		if len(rep.Unknown) != 0 {
			t.Fatalf("with no mod list the caller did not ask for this check, got %v", rep.Unknown)
		}
		if len(rep.Missing) != 1 {
			t.Fatalf("the warning should still be produced, got %v", rep.Missing)
		}
	})

	t.Run("an empty world accepts everything", func(t *testing.T) {
		rep := EvaluateModRules([]string{"gpu", "hotkeys"}, nil, nil, known)
		if !rep.OK || rep.Blocked || len(rep.Missing) != 0 || len(rep.Refused) != 0 {
			t.Fatalf("a world with no rules must accept any set, got %+v", rep)
		}
	})

	t.Run("reports what was applied", func(t *testing.T) {
		rep := EvaluateModRules([]string{"hotkeys", "gpu"}, nil, nil, known)
		if strings.Join(rep.Applied, ",") != "gpu,hotkeys" {
			t.Fatalf("applied should be normalized and sorted, got %v", rep.Applied)
		}
	})
}

func TestContradictoryRulesAreCaughtAtPublish(t *testing.T) {
	m := WorldManifest{
		Name:          "Contradiction",
		ModsRequired:  []string{"gpu"},
		ModsForbidden: []string{"gpu"},
	}
	m.Clean()
	if c := m.Contradictions(); len(c) != 1 || c[0] != "gpu" {
		t.Fatalf("expected gpu flagged as contradictory, got %v", c)
	}
	if err := m.Validate(); err == nil {
		t.Fatal("publishing a world nobody could join must be refused")
	}
}

func TestValidateLimits(t *testing.T) {
	ok := WorldManifest{Name: "fine"}
	ok.Clean()
	if err := ok.Validate(); err != nil {
		t.Fatalf("a minimal world should publish: %v", err)
	}

	blank := WorldManifest{Name: "   "}
	if err := blank.Validate(); err == nil {
		t.Error("a nameless world must be refused")
	}

	long := WorldManifest{Name: strings.Repeat("x", maxWorldName+1)}
	if err := long.Validate(); err == nil {
		t.Error("an over-long name must be refused")
	}

	wordy := WorldManifest{Name: "ok", Description: strings.Repeat("y", maxWorldDesc+1)}
	if err := wordy.Validate(); err == nil {
		t.Error("an over-long description must be refused")
	}

	many := WorldManifest{Name: "ok"}
	for i := 0; i < maxWorldMods+1; i++ {
		many.ModsRequired = append(many.ModsRequired, "mod"+string(rune('a'+i%26))+string(rune('a'+i/26)))
	}
	if err := many.Validate(); err == nil {
		t.Error("a wall of declared mods must be refused")
	}
}

func TestCleanNormalizesModLists(t *testing.T) {
	m := WorldManifest{
		Name:          "  Spaced  ",
		ModsRequired:  []string{" gpu ", "true-tile", "gpu", "", "  "},
		ModsForbidden: []string{"no-censor", "no-censor"},
	}
	m.Clean()
	if m.Name != "Spaced" {
		t.Fatalf("expected the name trimmed, got %q", m.Name)
	}
	if strings.Join(m.ModsRequired, ",") != "gpu,true-tile" {
		t.Fatalf("expected deduped+sorted required mods, got %v", m.ModsRequired)
	}
	if len(m.ModsForbidden) != 1 {
		t.Fatalf("expected deduped forbidden mods, got %v", m.ModsForbidden)
	}
	if m.CreatedAt.IsZero() {
		t.Fatal("Clean should stamp a creation time")
	}
}

func TestHostKeyIsStableAndCreatesOnce(t *testing.T) {
	var k HostKey
	first, err := k.EnsureHostKey()
	if err != nil {
		t.Fatalf("first key: %v", err)
	}
	if k.Public == "" || k.Private == "" {
		t.Fatal("EnsureHostKey must fill both halves")
	}
	second, err := k.EnsureHostKey()
	if err != nil {
		t.Fatalf("second key: %v", err)
	}
	if !first.Equal(second) {
		t.Fatal("the host key must not change between calls — every shared world would re-identify")
	}

	broken := HostKey{Private: base64.StdEncoding.EncodeToString([]byte("short"))}
	if _, err := broken.EnsureHostKey(); err == nil {
		t.Fatal("a damaged key must be reported, not silently replaced")
	}
}

// The manifest that goes into a code is the manifest that verifies: a host's own
// round trip must not lose the signature.
func TestCodeCarriesTheSignature(t *testing.T) {
	m, _ := testManifest(t)
	code, err := EncodeWorldCode(m)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	got, err := DecodeWorldCode(code)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Sig != m.Sig || got.PubKey != m.PubKey {
		t.Fatal("the code must carry the host's key and signature")
	}
	// And a re-encode of the decoded manifest is byte-identical, so a code can be
	// forwarded without invalidating it.
	again, err := EncodeWorldCode(got)
	if err != nil {
		t.Fatalf("re-encode: %v", err)
	}
	if again != code {
		t.Fatal("re-encoding a decoded code must be stable, or forwarded codes break")
	}
}

// gzipForTest frames arbitrary bytes exactly the way EncodeWorldCode does, so the
// negative tests above exercise the real decoder path.
func gzipForTest(raw []byte) (string, error) {
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(raw); err != nil {
		return "", err
	}
	if err := zw.Close(); err != nil {
		return "", err
	}
	return worldCodePrefix + base64.RawURLEncoding.EncodeToString(buf.Bytes()), nil
}
