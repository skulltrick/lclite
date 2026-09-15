// lclite shared helpers — used by install.mjs. Zero dependencies, node >= 18.
// Paths are POSIX-style relative to the LOST CITY root (the folder that
// contains webclient/ and engine/).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));

// ---- mod metadata ----------------------------------------------------------
// One entry per folder in mods/. The installer discovers mod folders from
// disk; this file only supplies presentation metadata (labels, order,
// defaults) for the interactive selector. A mod folder missing here still
// installs — it just shows under its folder name, default-on.
export const MOD_META = {
    'control-panel': {
        label: 'LCLite control panel',
        desc: 'F1 settings panel + terser reserves — required (this is LCLite)',
        required: true,
    },
    'camera': {
        label: 'OSRS-style camera',
        desc: 'wheel zoom, middle-drag rotate, chat scroll + the settings bus — required',
        required: true,
    },
    'xp-drops': {
        label: 'XP drops + tracker',
        desc: 'floating xp rows + top-right level-progress tracker',
    },
    'stat-orbs': {
        label: 'Stat orbs',
        desc: 'HP/Prayer/Energy orbs beside the minimap (off by default in-game)',
    },
    'true-tile': {
        label: 'True tile',
        desc: 'OSRS-style outline on the real server tile (on by default)',
    },
    'anti-cheat': {
        label: 'Anti-cheat telemetry toggle',
        desc: 'lets the panel mute legacy RuneScope packets (private-server friendly)',
    },
    'rendering': {
        label: 'Smooth shading option',
        desc: 'per-pixel Gouraud vs blocky 4px shading (off by default in-game)',
    },
    'gpu': {
        label: 'GPU renderer (WebGL2)',
        desc: 'RuneLite-style hardware rendering of the 3D world; HUD/interfaces stay CPU-exact. Off by default.',
    },
};

export const meta = name => MOD_META[name] || { label: name, desc: '', required: false };

// ---- root manifest (C1) ------------------------------------------------------
// The overlay normally installs into a Lost City checkout (webclient/ + engine/
// one level up). root.json declares what THIS host project looks like so lclite
// can be dropped onto any 2004Scape-lineage server's client with a tiny edit
// instead of a code search. Missing file = the original hardcoded defaults.
export const DEFAULT_ROOT = {
    repos: [
        { dir: 'webclient', remote: 'https://github.com/LostCityRS/Client-TS', required: true },
        { dir: 'engine', remote: 'https://github.com/LostCityRS/Engine-TS', required: true }
    ]
};
export function loadRootManifest(lcliteDir) {
    const f = path.join(lcliteDir, 'root.json');
    if (!fs.existsSync(f)) return { ...DEFAULT_ROOT, source: 'builtin' };
    try {
        const j = JSON.parse(fs.readFileSync(f, 'utf-8'));
        if (!Array.isArray(j.repos) || !j.repos.every(r => typeof r.dir === 'string')) throw new Error('repos[] with dir strings required');
        return { repos: j.repos.map(r => ({ remote: '', required: true, ...r })), source: 'root.json' };
    } catch (e) {
        console.error(`!! root.json invalid (${e.message}) — using built-in Lost City defaults`);
        return { ...DEFAULT_ROOT, source: 'builtin' };
    }
}

export function sortMods(mods) {
    const order = Object.keys(MOD_META);
    return [...mods].sort((a, b) => {
        const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
}

// ---- mod discovery (the contract install.mjs has always used) --------------
export function findMods(lcliteDir) {
    const modsDir = path.join(lcliteDir, 'mods');
    const mods = [];
    if (!fs.existsSync(modsDir)) return mods;
    for (const name of fs.readdirSync(modsDir)) {
        const dir = path.join(modsDir, name);
        if (!fs.statSync(dir).isDirectory()) continue;
        const patches = [];
        const pdir = path.join(dir, 'patches');
        if (fs.existsSync(pdir)) {
            for (const f of fs.readdirSync(pdir).filter(f => f.endsWith('.json'))) {
                patches.push(JSON.parse(fs.readFileSync(path.join(pdir, f), 'utf-8')));
            }
        }
        mods.push({ name, dir, patches });
    }
    return sortMods(mods);
}

// ---- text primitives --------------------------------------------------------
export function countOccurrences(haystack, needle) {
    if (!needle) return 0;
    let n = 0, i = 0;
    while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
    return n;
}
export function toLF(s) { return s.replace(/\r\n/g, '\n'); }
export function restoreEOL(s, hadCRLF) { return hadCRLF ? s.replace(/\n/g, '\r\n') : s; }

// Uninstall: swap hunk find/replace, so `replace` is the anchor and `find` is
// what gets restored. Only strip when the replacement is present; only when
// unique. (Idempotent — hunks already absent are counted as clean.)
export function stripPatchFile(abs, patch, checkOnly) {
    const res = { file: patch.file, removed: 0, clean: 0, stuck: [] };
    if (!fs.existsSync(abs)) return res;               // whole file absent: nothing to do
    const raw = fs.readFileSync(abs, 'utf-8');
    const hadCRLF = raw.includes('\r\n');
    let text = toLF(raw);
    for (const h of patch.hunks) {
        const find = h.find.join('\n');
        const rep = h.replace.join('\n');
        const n = countOccurrences(text, rep);
        if (n === 0) { res.clean++; continue; }
        if (n > 1) { res.stuck.push({ note: h.note || '', reason: `replacement ambiguous (${n}x)` }); continue; }
        if (!checkOnly) text = text.replace(rep, () => find);
        res.removed++;
    }
    if (!checkOnly) fs.writeFileSync(abs, restoreEOL(text, hadCRLF));
    return res;
}
