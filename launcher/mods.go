package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// ModInfo is one LCLite mod as presented in the launcher UI.
type ModInfo struct {
	Name     string `json:"name"`
	Label    string `json:"label"`
	Desc     string `json:"desc"`
	Required bool   `json:"required"`
	// Available is false when the overlay has no hunks for this mod on the install's
	// revision (nothing to inherit either). The mod still lists — a missing mod is
	// information — but it must not read as a toggle that does something.
	Available bool `json:"available"`
}

var (
	reModEntry = regexp.MustCompile(`(?m)^\s{4}'([^']+)':\s*\{([^}]*)\}`)
	// label/desc may be written with either quote style — the F1 panel's own
	// wording is mirrored here, and an apostrophe in a description ("player's
	// true server tile") forces double quotes.
	reModLabel = regexp.MustCompile(`label:\s*(?:'([^']*)'|"([^"]*)")`)
	reModDesc  = regexp.MustCompile(`desc:\s*(?:'([^']*)'|"([^"]*)")`)
	reModReq   = regexp.MustCompile(`required:\s*true`)
)

// quoted returns whichever capture group the alternation matched.
func quoted(m []string) string {
	if m == nil {
		return ""
	}
	if m[1] != "" {
		return m[1]
	}
	if len(m) > 2 {
		return m[2]
	}
	return ""
}

// overlayPresent reports whether a HOST root has an overlay in it
// (<root>/lclite/tools/lclite.mjs), i.e. the old "lclite/ inside the checkout" shape.
func overlayPresent(root string) bool {
	st, err := os.Stat(filepath.Join(root, "lclite", "tools", "lclite.mjs"))
	return err == nil && !st.IsDir()
}

// isOverlayDir reports whether dir IS an overlay checkout (tools/lclite.mjs plus
// mods/) rather than a host root that contains one. This is the shape of the
// lclite repo on its own — the one holding the launcher and your mod sources.
func isOverlayDir(dir string) bool {
	if dir == "" {
		return false
	}
	if st, err := os.Stat(filepath.Join(dir, "tools", "lclite.mjs")); err != nil || st.IsDir() {
		return false
	}
	st, err := os.Stat(filepath.Join(dir, "mods"))
	return err == nil && st.IsDir()
}

// overlayRev is the revision the patch hunks are AUTHORED on — the fallback when an
// overlay checkout has no revs.json (an older clone, or a hand-copied lclite/ folder).
// The real answer comes from the overlay itself, below.
const overlayRev = "289"

// overlayRevs reads the revisions an overlay checkout supports out of its revs.json —
// the same declaration tools/doctor.mjs and tools/matrix.mjs read, so the launcher
// cannot drift from what the corpus actually ships. A revision the overlay does not
// declare gets a vanilla install (the mods would apply nothing, or worse, apply
// half of themselves).
func overlayRevs(overlay string) []string {
	if overlay == "" {
		return []string{overlayRev}
	}
	raw, err := os.ReadFile(filepath.Join(overlay, "revs.json"))
	if err != nil {
		return []string{overlayRev}
	}
	var manifest struct {
		Primary   string                     `json:"primary"`
		Supported map[string]json.RawMessage `json:"supported"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil || len(manifest.Supported) == 0 {
		return []string{overlayRev}
	}
	out := make([]string, 0, len(manifest.Supported))
	for name := range manifest.Supported {
		out = append(out, name)
	}
	sort.Slice(out, func(i, j int) bool {
		// primary first, then the rest as strings: the picker reads this order
		if out[i] == manifest.Primary {
			return true
		}
		if out[j] == manifest.Primary {
			return false
		}
		return out[i] < out[j]
	})
	return out
}

// revSupported reports whether the overlay can be installed onto a revision.
func revSupported(overlay, rev string) bool {
	rev = strings.TrimSpace(rev)
	for _, r := range overlayRevs(overlay) {
		if r == rev {
			return true
		}
	}
	return false
}

// overlayModsAllowed is the one gate: mods may be applied to an install when the
// overlay driving it declares that revision. It replaces the old hardcoded
// "289 only" rule, which is what kept every other revision vanilla.
func (l *Launcher) overlayModsAllowed(in *Install) bool {
	overlay := l.overlayFor(in)
	return overlay != "" && revSupported(overlay, in.Rev)
}

// overlayRevsFor is overlayRevs for the launcher's own overlay checkout (what /api/state
// reports, so the UI can mark which revisions come with mods).
func (l *Launcher) overlayRevsFor() []string {
	if l.localOverlay != "" {
		return overlayRevs(l.localOverlay)
	}
	return []string{overlayRev}
}

// revManifest is the overlay's revs.json, as much of it as the launcher needs.
type revManifest struct {
	Primary   string                    `json:"primary"`
	Supported map[string]revSupportInfo `json:"supported"`
}
type revSupportInfo struct {
	Inherits string `json:"inherits"`
}

func readRevManifest(overlay string) revManifest {
	m := revManifest{Primary: overlayRev, Supported: map[string]revSupportInfo{}}
	raw, err := os.ReadFile(filepath.Join(overlay, "revs.json"))
	if err != nil {
		return m
	}
	var parsed revManifest
	if err := json.Unmarshal(raw, &parsed); err != nil || len(parsed.Supported) == 0 {
		return m
	}
	if parsed.Primary != "" {
		m.Primary = parsed.Primary
	}
	m.Supported = parsed.Supported
	return m
}

// hasCorpus reports whether mods/<mod>/patches/<rev>/ holds any hunks.
func hasCorpus(overlay, mod, rev string) bool {
	if rev == "" {
		return false
	}
	entries, err := os.ReadDir(filepath.Join(overlay, "mods", mod, "patches", rev))
	if err != nil {
		return false
	}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			return true
		}
	}
	return false
}

// modCorpusRev mirrors lib.mjs corpusRevFor: the mod's own corpus for this revision if
// it has one, else the revision it inherits, else "" (the mod is not available there).
// Duplicating the rule in Go is deliberate — the launcher must be able to answer
// "what does 254 actually get?" without shelling out to node for every page poll.
func modCorpusRev(overlay, mod, rev string, m revManifest) string {
	if hasCorpus(overlay, mod, rev) {
		return rev
	}
	if info, ok := m.Supported[rev]; ok && info.Inherits != "" && hasCorpus(overlay, mod, info.Inherits) {
		return info.Inherits
	}
	return ""
}

// appliedMods reads the mods ACTUALLY applied to an install, out of the manifest the
// overlay writes when it patches the tree (engine/public/lclite/installed.json).
//
// This is the honest source for a mod-rule check. Install.Mods is only what the
// launcher last recorded, which lags a hand-edited or externally-patched tree; the
// file in the built tree is what the world would really be served.
func appliedMods(in *Install) []string {
	raw, err := os.ReadFile(filepath.Join(in.publicDir(), "lclite", "installed.json"))
	if err != nil {
		return nil
	}
	var m struct {
		Mods []string `json:"mods"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	return normMods(m.Mods)
}

// bundleDigest identifies the exact client build an install would serve, so a player
// can read it out and a host can compare it against what they expect. It is a
// fingerprint of the shipped bundle, not a signature — it says "this is the build I
// have", which is only as trustworthy as the launcher reporting it.
func bundleDigest(in *Install) string {
	raw, err := os.ReadFile(filepath.Join(in.publicDir(), "client", "client.js"))
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])[:16]
}

// listMods reads the mods of a HOST root (lclite/ inside it).
func listMods(root string) []ModInfo {
	return listModsFromOverlay(filepath.Join(root, "lclite"), "")
}

// listModsFromOverlay reads mods/ inside an overlay checkout itself — which is
// what the launcher drives, since your checkout is the source of truth. rev (optional)
// marks each mod Available for that revision.
func listModsFromOverlay(overlay, rev string) []ModInfo {
	entries, err := os.ReadDir(filepath.Join(overlay, "mods"))
	if err != nil {
		return nil
	}
	meta := parseModMeta(filepath.Join(overlay, "tools", "lib.mjs"))
	manifest := readRevManifest(overlay)
	out := []ModInfo{}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") || strings.HasPrefix(e.Name(), "_") {
			continue
		}
		info := ModInfo{Name: e.Name(), Label: e.Name(), Available: rev == "" || modCorpusRev(overlay, e.Name(), rev, manifest) != ""}
		if m, ok := meta[e.Name()]; ok {
			if m.Label != "" {
				info.Label = m.Label
			}
			info.Desc = m.Desc
			info.Required = m.Required
		}
		if info.Desc == "" {
			info.Desc = modReadmeSummary(filepath.Join(overlay, "mods", e.Name()))
		}
		out = append(out, info)
	}
	// Sorted by the name players read, like the F1 panel's list does — the
	// folder name is an implementation detail ('control-panel' is "LCLite").
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Label) < strings.ToLower(out[j].Label)
	})
	return out
}

// modReadmeSummary takes the first non-heading line of a mod README as its blurb.
func modReadmeSummary(dir string) string {
	raw, err := os.ReadFile(filepath.Join(dir, "README.md"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ">") || strings.HasPrefix(line, "---") {
			continue
		}
		if len(line) > 160 {
			line = line[:160] + "…"
		}
		return line
	}
	return ""
}

// parseModMeta reads the presentation metadata out of tools/lib.mjs.
func parseModMeta(libPath string) map[string]ModInfo {
	out := map[string]ModInfo{}
	raw, err := os.ReadFile(libPath)
	if err != nil {
		return out
	}
	text := string(raw)
	start := strings.Index(text, "MOD_META")
	if start < 0 {
		return out
	}
	end := strings.Index(text[start:], "\n};")
	if end < 0 {
		end = len(text) - start
	}
	block := text[start : start+end]
	for _, m := range reModEntry.FindAllStringSubmatch(block, -1) {
		info := ModInfo{Name: m[1], Label: m[1]}
		if l := quoted(reModLabel.FindStringSubmatch(m[2])); l != "" {
			info.Label = l
		}
		info.Desc = quoted(reModDesc.FindStringSubmatch(m[2]))
		info.Required = reModReq.MatchString(m[2])
		out[m[1]] = info
	}
	return out
}

// allModNames is the CLI's default set: every mod folder, which is what a bare
// `node tools/lclite.mjs` applies. An empty selection means this, not "nothing".
func allModNames(overlay string) []string {
	mods := listModsFromOverlay(overlay, "")
	out := make([]string, 0, len(mods))
	for _, m := range mods {
		out = append(out, m.Name)
	}
	return out
}

// normalizeMods keeps only known mods, always includes the required ones, and
// returns a stable, comma-free list for the CLI.
func normalizeMods(overlay string, wanted []string) []string {
	known := map[string]ModInfo{}
	for _, m := range listModsFromOverlay(overlay, "") {
		known[m.Name] = m
	}
	picked := map[string]bool{}
	for _, w := range wanted {
		w = strings.TrimSpace(w)
		if w == "" {
			continue
		}
		if _, ok := known[w]; ok {
			picked[w] = true
		}
	}
	out := make([]string, 0, len(picked))
	for name := range picked {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}
