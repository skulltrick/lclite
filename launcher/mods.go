package main

import (
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
}

var (
	reModEntry = regexp.MustCompile(`(?m)^\s{4}'([^']+)':\s*\{([^}]*)\}`)
	reModLabel = regexp.MustCompile(`label:\s*'([^']*)'`)
	reModDesc  = regexp.MustCompile(`desc:\s*'([^']*)'`)
	reModReq   = regexp.MustCompile(`required:\s*true`)
)

// overlayFiles are the files that MUST exist for the overlay to be usable.
func overlayPresent(root string) bool {
	st, err := os.Stat(filepath.Join(root, "lclite", "tools", "lclite.mjs"))
	return err == nil && !st.IsDir()
}

// overlayRev is the revision the patch hunks are anchored to. When Lost City
// moves on and the hunks are reseated, this is the one line to bump (the UI
// explains itself from /api/state's overlay_rev).
const overlayRev = "289"

// overlayModsAllowed mirrors the project rule: the overlay is only offered on
// the revision its hunks were anchored to (see docs/MODS.md).
func overlayModsAllowed(rev string) bool { return strings.TrimSpace(rev) == overlayRev }

func listMods(root string) []ModInfo {
	overlay := filepath.Join(root, "lclite")
	entries, err := os.ReadDir(filepath.Join(overlay, "mods"))
	if err != nil {
		return nil
	}
	meta := parseModMeta(filepath.Join(overlay, "tools", "lib.mjs"))
	out := []ModInfo{}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") || strings.HasPrefix(e.Name(), "_") {
			continue
		}
		info := ModInfo{Name: e.Name(), Label: e.Name()}
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
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
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
		if lm := reModLabel.FindStringSubmatch(m[2]); lm != nil {
			info.Label = lm[1]
		}
		if dm := reModDesc.FindStringSubmatch(m[2]); dm != nil {
			info.Desc = dm[1]
		}
		info.Required = reModReq.MatchString(m[2])
		out[m[1]] = info
	}
	return out
}

// allModNames is the CLI's default set: every mod folder, which is what a bare
// `node tools/lclite.mjs` applies. An empty selection means this, not "nothing".
func allModNames(root string) []string {
	mods := listMods(root)
	out := make([]string, 0, len(mods))
	for _, m := range mods {
		out = append(out, m.Name)
	}
	return out
}

// normalizeMods keeps only known mods, always includes the required ones, and
// returns a stable, comma-free list for the CLI.
func normalizeMods(root string, wanted []string) []string {
	known := map[string]ModInfo{}
	for _, m := range listMods(root) {
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
