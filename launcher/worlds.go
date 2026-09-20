package main

// Worlds — the user-hosted world list.
//
// A "world" is somebody's Lost City server plus a small signed description of it:
// what it is called, what it asks of your client, and where it lives. There is no
// directory service; a world travels as an invite code (or a file), so a world list
// is something you build by pasting codes and keeping the ones you like.
//
// Two things are worth being straight about, because the UI must not imply
// otherwise:
//
//  1. MOD RULES ARE ADVISORY, NOT ENFORCEMENT. The client is JavaScript served over
//     HTTP by the host, so a determined player can always lie about what they are
//     running. What this file can do is check what YOUR launcher actually applied
//     and refuse/warn honestly — which stops accidents (the wrong mod set, the
//     wrong revision), not adversaries.
//  2. A PLAYER'S SAVE NEVER TOUCHES THE CLIENT. It lives on the host's disk
//     (engine/data/players/<profile>/<username>.sav, written by the login server).
//     So "bring your save" is a FILE operation the launcher performs against an
//     install it owns — never a game-protocol feature. See saveVault.go.
//
// The one thing that IS provable is the paperwork: a manifest is Ed25519-signed by
// the host, so a pasted invite code cannot be edited in transit, and a save file can
// be checked for integrity with the engine's own CRC rule without understanding a
// byte of its layout.

import (
	"bytes"
	"compress/gzip"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	// worldManifestVersion is the signing-payload generation. Bump it only when the
	// canonical field set changes, because it is inside the signed bytes — a bump
	// invalidates every code already shared.
	worldManifestVersion = 1
	// worldCodePrefix marks a pasted invite code, so the UI can tell "that's a code"
	// from "that's an address" without guessing.
	worldCodePrefix = "lclw1:"
	// worldPayloadTag namespaces the signed bytes.
	worldPayloadTag = "lclite-world"

	maxWorldName = 48
	maxWorldDesc = 240
	maxWorldMods = 64
	maxWorldCode = 64 * 1024
)

// WorldManifest is the shareable description of a world. Every field here except
// Sig is covered by the signature.
type WorldManifest struct {
	Version     int    `json:"v"`
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"desc,omitempty"`
	// Address is host:port of the world's WEB port — the one that serves the page
	// and carries the game socket. The game/management ports are not advertised.
	Address string `json:"addr,omitempty"`
	Rev     string `json:"rev,omitempty"`
	// ModsRequired is a WARNING list: a player missing these is told so and may
	// still log in. ModsForbidden is a REFUSAL list: a player running one of these
	// is asked to turn it off first.
	ModsRequired  []string `json:"req,omitempty"`
	ModsForbidden []string `json:"ban,omitempty"`
	// AllowSaveImport lets a player bring their own character file into this world.
	AllowSaveImport bool   `json:"save,omitempty"`
	Host            string `json:"host,omitempty"`
	// PubKey is the host's Ed25519 public key (base64) — the world's identity. The
	// ID is derived from it, so a re-listed world keeps its name on your list.
	PubKey string `json:"key,omitempty"`
	Sig    string `json:"sig,omitempty"`
	// CreatedAt is advisory (display only); it is inside the signature so a host
	// cannot backdate a world they later change.
	CreatedAt time.Time `json:"at,omitempty"`
}

// normWorldAddr is the comparable form of an advertised address: a person typing
// "https://Play.Example.com:443/" and a host advertising "play.example.com:443"
// mean the same machine.
func normWorldAddr(a string) string {
	a = strings.ToLower(strings.TrimSpace(a))
	a = strings.TrimPrefix(a, "http://")
	a = strings.TrimPrefix(a, "https://")
	return strings.TrimSuffix(a, "/")
}

// sameWorldAddr answers "is this the same server?" for a typed address and an
// advertised one. Two blanks are never the same address.
func sameWorldAddr(a, b string) bool {
	na, nb := normWorldAddr(a), normWorldAddr(b)
	return na != "" && na == nb
}

// normMods trims, drops empties, dedupes and sorts — the canonical form used both
// for signing and for display, so two launchers always agree on the bytes.
func normMods(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, m := range in {
		m = strings.TrimSpace(m)
		if m == "" || seen[m] {
			continue
		}
		seen[m] = true
		out = append(out, m)
	}
	sort.Strings(out)
	return out
}

// Clean normalizes a manifest in place before it is shown, stored or signed.
func (m *WorldManifest) Clean() {
	m.Version = worldManifestVersion
	m.Name = strings.TrimSpace(m.Name)
	m.Description = strings.TrimSpace(m.Description)
	m.Address = strings.TrimSpace(m.Address)
	m.Rev = strings.TrimSpace(m.Rev)
	m.Host = strings.TrimSpace(m.Host)
	m.ModsRequired = normMods(m.ModsRequired)
	m.ModsForbidden = normMods(m.ModsForbidden)
	if m.CreatedAt.IsZero() {
		m.CreatedAt = time.Now()
	}
}

// signingPayload is the canonical byte string the signature covers.
//
// It is deliberately NOT json.Marshal of the struct: that would make the signature
// depend on field order and on how a future version of Go escapes things. Instead
// every signed field is written as `key=<json-quoted value>`, sorted by key, one per
// line. json.Marshal of a string never emits a raw newline, so the line structure is
// unambiguous — a value containing a newline cannot forge an extra field.
func (m WorldManifest) signingPayload() []byte {
	fields := [][2]string{
		{"addr", m.Address},
		{"at", m.CreatedAt.UTC().Format(time.RFC3339Nano)},
		{"ban", strings.Join(normMods(m.ModsForbidden), ",")},
		{"desc", m.Description},
		{"host", m.Host},
		{"id", m.ID},
		{"key", m.PubKey},
		{"name", m.Name},
		{"req", strings.Join(normMods(m.ModsRequired), ",")},
		{"rev", m.Rev},
		{"save", strconv.FormatBool(m.AllowSaveImport)},
		{"v", strconv.Itoa(m.Version)},
	}
	sort.Slice(fields, func(i, j int) bool { return fields[i][0] < fields[j][0] })

	var b strings.Builder
	b.WriteString(worldPayloadTag + "\n")
	for _, f := range fields {
		q, err := json.Marshal(f[1])
		if err != nil {
			// A string always marshals; this cannot happen, and silently signing
			// something else would be worse than refusing.
			q = []byte(strconv.Quote(f[1]))
		}
		b.WriteString(f[0])
		b.WriteByte('=')
		b.Write(q)
		b.WriteByte('\n')
	}
	return []byte(b.String())
}

// worldIDFor derives the stable world id from the host's public key: two listings
// from the same host are the same world, however they were shared.
func worldIDFor(pubB64 string) string {
	sum := sha256.Sum256([]byte("lclite-world-id:" + pubB64))
	return "w" + hex.EncodeToString(sum[:8])
}

// KeyFingerprint is the short human-checkable form of the host key ("ab12 cd34 …").
func (m WorldManifest) KeyFingerprint() string {
	raw, err := base64.StdEncoding.DecodeString(m.PubKey)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(raw)
	h := hex.EncodeToString(sum[:])[:16]
	parts := make([]string, 0, 4)
	for i := 0; i+4 <= len(h); i += 4 {
		parts = append(parts, h[i:i+4])
	}
	return strings.Join(parts, " ")
}

// Sign fills PubKey/ID/Sig from the host's private key.
func (m *WorldManifest) Sign(priv ed25519.PrivateKey) error {
	if len(priv) != ed25519.PrivateKeySize {
		return fmt.Errorf("bad signing key")
	}
	pub, ok := priv.Public().(ed25519.PublicKey)
	if !ok {
		return fmt.Errorf("bad signing key")
	}
	m.Clean()
	m.PubKey = base64.StdEncoding.EncodeToString(pub)
	m.ID = worldIDFor(m.PubKey)
	m.Sig = base64.StdEncoding.EncodeToString(ed25519.Sign(priv, m.signingPayload()))
	return nil
}

// Signed reports whether the manifest carries a signature at all.
func (m WorldManifest) Signed() bool { return m.PubKey != "" && m.Sig != "" }

// Verify checks the signature against the manifest's own public key.
//
// This proves the manifest was not edited after the host signed it, and that
// whoever re-listed it did not hold the key. It does NOT prove the host is
// trustworthy — a world can describe itself however it likes.
func (m WorldManifest) Verify() error {
	if !m.Signed() {
		return fmt.Errorf("unsigned")
	}
	pub, err := base64.StdEncoding.DecodeString(m.PubKey)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return fmt.Errorf("bad public key")
	}
	sig, err := base64.StdEncoding.DecodeString(m.Sig)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return fmt.Errorf("bad signature")
	}
	if !ed25519.Verify(ed25519.PublicKey(pub), m.signingPayload(), sig) {
		return fmt.Errorf("signature does not match this manifest")
	}
	if m.ID != "" && m.ID != worldIDFor(m.PubKey) {
		return fmt.Errorf("world id does not match the host key")
	}
	return nil
}

// Validate is the host-side sanity gate: refuse to publish something a player
// cannot act on (an empty name, a contradiction, a wall of mods).
func (m WorldManifest) Validate() error {
	if strings.TrimSpace(m.Name) == "" {
		return fmt.Errorf("a world needs a name")
	}
	if len([]rune(m.Name)) > maxWorldName {
		return fmt.Errorf("the name is longer than %d characters", maxWorldName)
	}
	if len([]rune(m.Description)) > maxWorldDesc {
		return fmt.Errorf("the description is longer than %d characters", maxWorldDesc)
	}
	if len(m.ModsRequired) > maxWorldMods || len(m.ModsForbidden) > maxWorldMods {
		return fmt.Errorf("too many mods declared (limit %d per list)", maxWorldMods)
	}
	if c := m.Contradictions(); len(c) > 0 {
		return fmt.Errorf("these mods are both required and forbidden: %s", strings.Join(c, ", "))
	}
	return nil
}

// Contradictions are mods a player could never satisfy: required and forbidden at
// once. This is a host typo, so it is caught at publish time rather than being
// turned into an impossible gate for the player.
func (m WorldManifest) Contradictions() []string {
	banned := map[string]bool{}
	for _, b := range m.ModsForbidden {
		banned[b] = true
	}
	out := []string{}
	for _, r := range m.ModsRequired {
		if banned[r] {
			out = append(out, r)
		}
	}
	sort.Strings(out)
	return out
}

// ---- invite codes ----------------------------------------------------------

// EncodeWorldCode turns a manifest into a pasteable code. gzip keeps it short
// enough to send in chat (a plain manifest is mostly repeated JSON scaffolding).
func EncodeWorldCode(m WorldManifest) (string, error) {
	raw, err := json.Marshal(m)
	if err != nil {
		return "", err
	}
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

// DecodeWorldCode parses a pasted code. The input is untrusted, so the inflate is
// bounded (maxWorldCode) — a gzip bomb costs a rejection, not the launcher.
func DecodeWorldCode(code string) (WorldManifest, error) {
	var m WorldManifest
	s := strings.TrimSpace(code)
	// Accept the code with or without its prefix: people paste what they copied,
	// and stripping whitespace is friendlier than a format lecture.
	s = strings.TrimPrefix(s, worldCodePrefix)
	if s == "" {
		return m, fmt.Errorf("that is empty")
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		raw, err = base64.StdEncoding.DecodeString(s)
		if err != nil {
			return m, fmt.Errorf("that does not look like a world code")
		}
	}
	zr, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return m, fmt.Errorf("that does not look like a world code")
	}
	defer zr.Close()
	body, err := io.ReadAll(io.LimitReader(zr, maxWorldCode))
	if err != nil {
		return m, fmt.Errorf("that world code is damaged")
	}
	if err := json.Unmarshal(body, &m); err != nil {
		return m, fmt.Errorf("that world code is damaged")
	}
	m.Clean()
	if err := m.Validate(); err != nil {
		return m, err
	}
	return m, nil
}

// ---- mod rules -------------------------------------------------------------

// ModRuleReport is the answer to "can I join this world with what I have?".
//
// Blocked is the hard gate (a forbidden mod is applied). Missing is the soft one (a
// required mod is absent) — the player is told and may continue, because a required
// mod is a recommendation the host wants visible, not a lock.
type ModRuleReport struct {
	OK      bool     `json:"ok"`
	Blocked bool     `json:"blocked"`
	Refused []string `json:"refused"`
	Missing []string `json:"missing"`
	// Unknown are declared mods this overlay does not have at all (a typo, or a mod
	// the host built themselves). Reported so the player is not left guessing.
	Unknown []string `json:"unknown"`
	Applied []string `json:"applied"`
	// Digest identifies the exact client build the player would serve.
	Digest string `json:"digest,omitempty"`
}

// EvaluateModRules compares what an install actually has applied against what a
// world declares. applied is read from the tree's own installed.json, not from what
// the UI had ticked, so the answer describes the build that would really be served.
func EvaluateModRules(applied, required, forbidden, known []string) ModRuleReport {
	has := map[string]bool{}
	for _, a := range applied {
		has[a] = true
	}
	knownSet := map[string]bool{}
	for _, k := range known {
		knownSet[k] = true
	}

	rep := ModRuleReport{
		Refused: []string{},
		Missing: []string{},
		Unknown: []string{},
		Applied: normMods(applied),
	}
	for _, f := range normMods(forbidden) {
		if has[f] {
			rep.Refused = append(rep.Refused, f)
		}
	}
	for _, r := range normMods(required) {
		if !has[r] {
			rep.Missing = append(rep.Missing, r)
		}
	}
	// A declared mod nobody has is worth saying out loud, but only when the caller
	// knows the full mod list (known empty = "don't check").
	if len(knownSet) > 0 {
		for _, d := range append(normMods(required), normMods(forbidden)...) {
			if !knownSet[d] {
				rep.Unknown = append(rep.Unknown, d)
			}
		}
		rep.Unknown = normMods(rep.Unknown)
	}
	rep.Blocked = len(rep.Refused) > 0
	rep.OK = !rep.Blocked
	return rep
}

// ---- the host's own world --------------------------------------------------

// LocalWorld is the host's editable description of the world this machine runs.
// It is the draft that gets signed into a WorldManifest when the host lists it.
type LocalWorld struct {
	Name            string   `json:"name,omitempty"`
	Description     string   `json:"description,omitempty"`
	HostName        string   `json:"host_name,omitempty"`
	ModsRequired    []string `json:"mods_required,omitempty"`
	ModsForbidden   []string `json:"mods_forbidden,omitempty"`
	AllowSaveImport bool     `json:"allow_save_import,omitempty"`
	// Address is what to advertise. Blank = derive it from the machine's LAN
	// address and the running world's web port.
	Address string `json:"address,omitempty"`
	// Listed is the host's own "publish me" switch. It is local state only: there
	// is no directory, so listing means "keep a signed card ready to hand out".
	Listed bool `json:"listed,omitempty"`
}

// HostKey is the launcher's signing identity. One key per launcher (not per world)
// so a host's worlds all verify under one fingerprint a player can learn.
type HostKey struct {
	Public  string `json:"public,omitempty"`
	Private string `json:"private,omitempty"`
}

// EnsureHostKey loads the launcher's signing key, creating it on first use.
func (k *HostKey) EnsureHostKey() (ed25519.PrivateKey, error) {
	if k.Private != "" {
		raw, err := base64.StdEncoding.DecodeString(k.Private)
		if err == nil && len(raw) == ed25519.PrivateKeySize {
			return ed25519.PrivateKey(raw), nil
		}
		// A corrupt key would silently re-identify every world, so say so instead.
		return nil, fmt.Errorf("the saved world signing key is damaged")
	}
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	k.Public = base64.StdEncoding.EncodeToString(pub)
	k.Private = base64.StdEncoding.EncodeToString(priv)
	return priv, nil
}
