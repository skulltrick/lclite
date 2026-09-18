// lclite shared helpers — used by tools/lclite.mjs et al. Zero deps, node >= 18.
// Paths are POSIX-style relative to the LOST CITY root (the folder that
// contains webclient/ + engine/).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// LIB_DIR = the lclite/ overlay root (this file lives in lclite/tools/).
export const LIB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- presentation metadata --------------------------------------------------
// One entry per folder in mods/. The installer discovers mod folders from
// disk; this file only supplies presentation metadata (labels, order,
// defaults) for the interactive selector and the launcher. A mod folder missing
// here still installs — it just shows under its folder name, default-on.
//
// MOD_META is the machine-readable half of the mod list: the launcher (mods.go)
// and the CLI picker read label/desc from here, so a mod's name and one-line
// description are written ONCE and shown everywhere.
//
// The wording is the in-game control panel's (mods/control-panel/…/panel.js,
// MOD_REGISTRY — the F1 panel's Mods tab): that is the list players read, and a
// mod that is called "Low detail" in-game must not be called "Low detail
// option" in the launcher. Rename a mod there and rename it here in the same
// commit; `node tools/doctor.mjs` warns when the two drift apart.
export const MOD_META = {
    'control-panel': {
        label: 'LCLite',
        // exactly the F1 panel's own MOD_REGISTRY wording (doctor checks this): the
        // row lists what a player can DO here. The theme/tab-title work is not a
        // control, so it is documented in mods/control-panel/README.md instead.
        desc: 'This panel and the page around it: canvas size, scaling, legacy bar, fullscreen, screenshots.',
        required: true,
    },
    'camera': {
        label: 'Camera',
        desc: 'Wheel zoom, middle-drag rotate, chat scroll.',
    },
    'xp-drops': {
        label: 'XP drops',
        desc: 'Customizable XP drops.',
    },
    'stat-orbs': {
        label: 'Stat orbs',
        desc: 'HP/Prayer/Run data orbs on the minimap panel. Alt+drag to move them.',
    },
    'tcg': {
        label: 'TCG',
        desc: 'Left click opens pack, right click opens album. 1k exp = 100 credits, level ups = 1k-25k credits, kills = 1 credit per cb lvl.',
    },
    'true-tile': {
        label: 'True tile',
        desc: "Highlights player's true server tile. Customizable.",
    },
    'anti-cheat': {
        label: 'Disable anti-cheat',
        desc: 'Disables the client sending legacy mouse/camera/anticheat packets.',
    },
    'gpu': {
        label: 'GPU',
        desc: 'Uses your GPU; chat, interfaces, orbs and walk-clicks stay pixel-exact on the CPU.',
    },
    'hide-roofs': {
        label: 'Hide roofs',
        desc: 'Removes roofs everywhere, not only while you stand under them. Off: the game hides them itself as you walk in.',
    },
    'low-detail': {
        label: 'Low detail',
        desc: 'Untextured ground applies instantly; ground decorations and half-size textures need a client refresh (F5).',
    },
    'shift-drop': {
        label: 'Shift-click drop',
        desc: 'Hold Shift and left-click an item to drop it straight away, skipping the menu.',
    },
    'hotkeys': {
        label: 'Hotkeys',
        desc: 'F-key sidebar tabs, Esc closes interfaces, WASD camera with press-enter-to-chat.',
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

// ---- mod discovery (the contract lclite.mjs has always used) --------------
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
