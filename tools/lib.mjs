// lclite shared helpers — used by tools/lclite.mjs et al. Zero deps, node >= 18.
// Paths are POSIX-style relative to the LOST CITY root (the folder that
// contains webclient/ + engine/).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
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
        desc: 'This panel and the page around it: canvas size, fullscreen, screenshots.',
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
        desc: 'HP/Prayer/Run data orbs on the minimap panel, plus a special attack orb. Click the run orb to toggle run, the prayer orb for the prayer book, the special orb to arm your special attack. Alt+drag to move them.',
    },
    'tcg': {
        label: 'TCG',
        desc: 'Left click opens pack, right click opens album. 1k exp = 100 credits, level ups = 1k-25k credits, kills = 1 credit per cb lvl.',
    },
    'true-tile': {
        label: 'True tile',
        desc: "Marks the tile the server has you on, the tile your mouse is over, and the tile you're walking to. Customizable.",
    },
    'no-censor': {
        label: 'Disable profanity filter',
        // exactly the F1 panel's own MOD_REGISTRY wording (doctor checks this)
        desc: "Chat is not censored: your own messages, other players' and private messages alike.",
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
        desc: 'F-key sidebar tabs, Esc closes interfaces, Space and 1-5 drive dialogues, WASD camera with press-enter-to-chat.',
    },
    'wiki-lookup': {
        label: 'Wiki lookup',
        // exactly the F1 panel's own MOD_REGISTRY wording (doctor checks this)
        desc: 'A wiki button on the minimap: click it, then click any NPC, object or item to open its OSRS wiki page. Optionally also a Wiki row in every right-click menu.',
    },
    'ground-items': {
        label: 'Ground item labels',
        // exactly the F1 panel's own MOD_REGISTRY wording (doctor checks this)
        desc: 'Labels on the items lying on the ground. Hold Alt to see every item and click the - / + boxes to hide or show one.',
    },
    'true-tile-plus': {
        label: 'True tile+',
        // exactly the F1 panel's own MOD_REGISTRY wording (doctor checks this)
        desc: 'Ground effects on your true tile: flat flames licking off its border, or a ripple wave sweeping out of it.',
    },
};

export const meta = name => MOD_META[name] || { label: name, desc: '', required: false };

// readmeSummary is the fallback blurb for a mod that has no MOD_META entry yet:
// the first non-heading line of its README. The launcher does exactly this in Go
// (modReadmeSummary), so a dropped-in mod reads the same in both places — the CLI
// list is not allowed to be the one view that shows an empty description.
export function readmeSummary(modDir) {
    let raw;
    try { raw = fs.readFileSync(path.join(modDir, 'README.md'), 'utf-8'); } catch { return ''; }
    for (let line of raw.replace(/\r\n/g, '\n').split('\n')) {
        line = line.trim();
        if (!line || line.startsWith('#') || line.startsWith('>') || line.startsWith('---')) continue;
        return line.length > 160 ? line.slice(0, 160) + '…' : line;
    }
    return '';
}

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

// ---- revision targets -------------------------------------------------------
// LCLite is no longer a 289-only overlay: a mod ships ONE CORPUS PER REVISION it
// supports, under mods/<mod>/patches/<rev>/. revs.json (this file's neighbour)
// declares which revisions those are, and `primary` says which one mods are
// AUTHORED on — the one you edit the live tree in and run regen against.
//
// Why a declaration at all: the corpus directories are the fact (which revs have
// hunks), but "we intend to support 254" is an intent that has to be written
// somewhere a human and the launcher can both read. `doctor` fails when the two
// disagree, so the declaration can never rot silently.
export const DEFAULT_REVS = { primary: '289', supported: { 289: { note: 'authored here' } } };

export function loadRevManifest(lcliteDir) {
    const f = path.join(lcliteDir, 'revs.json');
    if (!fs.existsSync(f)) return { ...DEFAULT_REVS, source: 'builtin' };
    try {
        const j = JSON.parse(fs.readFileSync(f, 'utf-8'));
        if (typeof j.primary !== 'string' || !j.primary) throw new Error('primary (string) required');
        if (!j.supported || typeof j.supported !== 'object') throw new Error('supported (object) required');
        const supported = {};
        for (const [rev, info] of Object.entries(j.supported)) {
            supported[String(rev)] = info && typeof info === 'object' ? info : {};
        }
        if (!supported[j.primary]) supported[j.primary] = { note: 'authored here' };
        return { primary: String(j.primary), supported, source: 'revs.json' };
    } catch (e) {
        console.error(`!! revs.json invalid (${e.message}) — falling back to the 289-only default`);
        return { ...DEFAULT_REVS, source: 'builtin' };
    }
}

// supportedRevs = the declared revision names, primary first (the picker and the
// launcher show them in that order: the one mods are authored on leads).
export function supportedRevs(manifest) {
    const names = Object.keys(manifest.supported);
    return [manifest.primary, ...names.filter(n => n !== manifest.primary)];
}

// corpusRevFor resolves WHICH corpus a mod uses on a revision — the single rule the
// whole rev system hangs on:
//
//   1. mods/<mod>/patches/<rev>/ exists          → that (a rev-specific corpus)
//   2. revs.json says <rev> inherits from X      → X's corpus
//   3. otherwise                                 → null: the mod is not available on
//                                                  this revision
//
// Inheritance is what keeps the maintenance bill flat: a revision whose code still
// matches every anchor costs ZERO extra corpus to maintain and automatically follows
// improvements to the primary one. `tools/matrix.mjs` re-verifies that claim against
// real clones, so an inheritance that quietly stops being true goes red instead of
// silently shipping a mod that no longer applies. A revision that needs even one
// reseat gets its own corpus and stops inheriting (per mod, so the rest can stay
// inherited).
export function corpusRevFor(manifest, modDir, rev) {
    const has = r => r && fs.existsSync(path.join(modDir, 'patches', r))
        && fs.readdirSync(path.join(modDir, 'patches', r)).some(f => f.endsWith('.json'));
    if (has(rev)) return rev;
    const inherits = manifest?.supported?.[rev]?.inherits;
    if (inherits && has(inherits)) return inherits;
    return null;
}

// hostRev reads the revision a HOST tree is checked out at, from the branch of
// its client repo (the repo whose sources every TYPE B hunk edits). Null when
// there is no tree or no git — callers say so instead of guessing.
export function hostRev(root, repos = ['webclient', 'engine']) {
    for (const dir of repos) {
        try {
            const out = execSync(`git -C "${path.join(root, dir)}" branch --show-current`, {
                encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
            if (out) return out;
        } catch { /* not a repo / no git: try the next */ }
    }
    return null;
}

// corpusDir = where a mod's hunks for one revision live. Legacy flat
// mods/<mod>/patches/*.json (the pre-rev layout) is NOT a corpus directory and is
// deliberately not read: doctor flags it as structural so the migration can't be
// half-done behind everyone's back.
export function corpusDir(modDir, rev) {
    return path.join(modDir, 'patches', rev);
}

// corporaOnDisk lists the revisions a mod actually ships hunks for.
export function corporaOnDisk(modDir) {
    const pdir = path.join(modDir, 'patches');
    if (!fs.existsSync(pdir)) return [];
    return fs.readdirSync(pdir, { withFileTypes: true })
        .filter(e => e.isDirectory() && fs.readdirSync(path.join(pdir, e.name)).some(f => f.endsWith('.json')))
        .map(e => e.name)
        .sort();
}

// patchJsonName is the one place that maps a patched source path to its corpus
// filename — regen writes with it, doctor/matrix read with it. Keep it single.
export function patchJsonName(relPath) {
    return path.basename(relPath).replace(/\W+/, '_') + '.json';
}

// ---- what counts as a mod folder --------------------------------------------
// ONE rule, read by every tool AND mirrored in Go (launcher/mods.go): a directory
// under mods/ is a mod unless its name starts with `.` or `_`. The underscore is
// the escape hatch for something that LOOKS like a mod and must never ship —
// `mods/_template/` is the layout example `lclite.mjs new` copies, and it must not
// be listed, applied, stripped, audited, counted, or byte-compared by anything.
// Keeping the rule here (and in the launcher) is what stops a template from being
// "a mod with a corpus" the moment someone adds one.
export function isModDir(name) {
    return !name.startsWith('.') && !name.startsWith('_');
}

// payloadFiles lists a mod's files/ payload as HOST-ROOT-relative paths
// (mods/<mod>/files/engine/public/x.js -> engine/public/x.js). `apply` copies each
// verbatim into the tree, so this list is also the mod's installed test and its
// strip list. Empty = the mod ships no payload.
export function payloadFiles(modDir) {
    const fdir = path.join(modDir, 'files');
    const out = [];
    if (!fs.existsSync(fdir)) return out;
    const walk = d => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else out.push(path.relative(fdir, p).replace(/\\/g, '/'));
        }
    };
    walk(fdir);
    return out;
}

// ---- mod discovery (the contract lclite.mjs has always used) --------------
// rev = which corpus to load. Every mod is returned; one with no corpus for this
// rev (and no inherited one) comes back with patches:[] and `missingCorpus: true`,
// which is how "this mod has no hunks for this revision" is reported instead of
// exploding — a partial rev is a fact to display, not a crash.
//
// A mod delivers through two independent lanes: its hunks (per revision) and its
// files/ payload (every revision). `hasPayload` is therefore the second half of
// "can this mod be installed here at all" — a files/-only mod is available on
// every revision, and treating it as "unavailable" would hide an installable mod.
export function findMods(lcliteDir, rev) {
    const manifest = loadRevManifest(lcliteDir);
    const modsDir = path.join(lcliteDir, 'mods');
    const mods = [];
    if (!fs.existsSync(modsDir)) return mods;
    for (const name of fs.readdirSync(modsDir)) {
        if (!isModDir(name)) continue;
        const dir = path.join(modsDir, name);
        if (!fs.statSync(dir).isDirectory()) continue;
        const corpora = corporaOnDisk(dir);
        const patches = [];
        const from = rev ? corpusRevFor(manifest, dir, rev) : null;
        if (from) {
            const pdir = corpusDir(dir, from);
            for (const f of fs.readdirSync(pdir).filter(f => f.endsWith('.json'))) {
                patches.push(JSON.parse(fs.readFileSync(path.join(pdir, f), 'utf-8')));
            }
        }
        mods.push({
            name, dir, rev: rev || null, patches, corpora,
            hasPayload: payloadFiles(dir).length > 0,
            corpusRev: from, inherited: !!from && from !== rev,
            missingCorpus: !!rev && patches.length === 0,
        });
    }
    return sortMods(mods);
}

// flatPatchFiles lists legacy mods/*/patches/*.json files (no rev directory).
export function flatPatchFiles(lcliteDir) {
    const out = [];
    const modsDir = path.join(lcliteDir, 'mods');
    if (!fs.existsSync(modsDir)) return out;
    for (const name of fs.readdirSync(modsDir)) {
        const pdir = path.join(modsDir, name, 'patches');
        if (!fs.existsSync(pdir)) continue;
        for (const f of fs.readdirSync(pdir)) {
            if (f.endsWith('.json')) out.push(`${name}/patches/${f}`);
        }
    }
    return out;
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

// ---- cross-revision anchor reseating (tools/port.mjs) -----------------------
// A hunk is `find` (pristine context) plus `replace` = that context with the mod's
// own delta applied — lines added, lines replaced, lines deleted. When upstream
// edits a line INSIDE an anchor block the block stops matching byte-for-byte, even
// though the code the mod inserts still belongs exactly there. That is the whole
// reason a mod needs a corpus per revision.
//
// hunkOps() reads a hunk's SHAPE (which lines are context, which are the mod's
// additions, which pristine lines it deletes or rewrites). reseatFind() then finds
// the block again in ANOTHER revision's file and rebuilds both sides from that
// shape, so the invariant `replace = find with the delta applied` still holds.
//
// It never guesses. A rebuild is only accepted when the new anchor is unique in the
// target file, the new replacement is not already present, the rebuilt hunk still
// satisfies the invariant, and the alignment is a clear winner over every other
// candidate site. Anything else returns null and the hunk stays a human's problem.

// alignLines: best line alignment of block[] onto win[], allowing substitutions and
// gaps. Returns { score, gaps, map } where map[i] = index in win for block line i
// (undefined = that line is absent there).
//
// Asymmetry matters here: skipping a WINDOW line is free and unbounded (that is just
// the mod's payload — a hunk can add fifty lines), while skipping a BLOCK line is
// bounded (a context line missing upstream is real drift, and four of those means the
// block no longer describes this rev). Score = 100 per substantial match, 60/15 for
// short ones, -1 per block-line gap: more matched anchors always beats fewer, and a
// substitution always beats a gap.
function alignLines(blockN, winN) {
    const n = blockN.length, m = winN.length;
    const XGAP = 4;
    const w = (l) => { const t = l.trim(); return t.length >= 12 ? 100 : t.length >= 6 ? 60 : 15; };
    const dp = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => new Array(XGAP + 1).fill(null)));
    dp[0][0][0] = { score: 0, from: null };
    for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= m; j++) {
            for (let g = 0; g <= XGAP; g++) {
                const cur = dp[i][j][g];
                if (!cur) continue;
                const put = (ni, nj, ng, dir, add) => {
                    const cell = dp[ni][nj][ng];
                    const score = cur.score + add;
                    if (!cell || score > cell.score) dp[ni][nj][ng] = { score, from: [i, j, g, dir] };
                };
                if (i < n && j < m) put(i + 1, j + 1, g, 'd', blockN[i] === winN[j] ? w(blockN[i]) : 0);
                if (i < n && g < XGAP) put(i + 1, j, g + 1, 'x', -1);   // block line absent in the window
                if (j < m) put(i, j + 1, g, 'y', 0);                     // window line not in the block
            }
        }
    }
    let best = null, bestG = 0;
    for (let g = 0; g <= XGAP; g++) {
        const cell = dp[n][m][g];
        if (cell && (!best || cell.score > best.score)) { best = cell; bestG = g; }
    }
    if (!best) return null;
    const map = new Array(n).fill(undefined);
    let i = n, j = m, g = bestG;
    while (i > 0 || j > 0) {
        const cur = dp[i][j][g];
        if (!cur || !cur.from) break;
        const [pi, pj, pg, dir] = cur.from;
        if (dir === 'd') map[pi] = pj;
        i = pi; j = pj; g = pg;
    }
    return { score: best.score, gaps: bestG, map };
}

const normLine = l => l.trim().replace(/\s+/g, ' ');

// hunkOps: the hunk's shape as an ordered op list — ctx (context line, unchanged),
// sub (pristine line rewritten by the mod), del (pristine line removed), add (a line
// the mod introduces). Returns null when the op list does not reconstruct the hunk
// exactly, which is the guard against a mis-alignment silently changing a mod.
export function hunkOps(find, replace) {
    if (!find.length && !replace.length) return null;
    const al = alignLines(find.map(normLine), replace.map(normLine));
    if (!al) return null;
    const mapped = new Set(al.map.filter(v => v !== undefined));
    const ops = [];
    let j = 0;                                  // next unused replace index
    for (let k = 0; k < find.length; k++) {
        const t = al.map[k];
        if (t === undefined) { ops.push({ kind: 'del', i: k }); continue; }
        while (j < t) { ops.push({ kind: 'add', line: replace[j] }); j++; }   // lines the mod introduces before this one
        ops.push(find[k] === replace[t] ? { kind: 'ctx', i: k } : { kind: 'sub', i: k, line: replace[t] });
        j = t + 1;
    }
    while (j < replace.length) { ops.push({ kind: 'add', line: replace[j] }); j++; }
    // the shape must reproduce both sides exactly, or the alignment was wrong
    const f = [], r = [];
    for (const op of ops) {
        if (op.kind === 'ctx') { f.push(find[op.i]); r.push(find[op.i]); }
        else if (op.kind === 'sub') { f.push(find[op.i]); r.push(op.line); }
        else if (op.kind === 'del') f.push(find[op.i]);
        else r.push(op.line);
    }
    if (f.length !== find.length || r.length !== replace.length) return null;
    for (let k = 0; k < find.length; k++) if (f[k] !== find[k]) return null;
    for (let k = 0; k < replace.length; k++) if (r[k] !== replace[k]) return null;
    return ops;
}

// applyOps: render a reseated op list against the target window. map[i] = the target
// line index for pristine line i. Returns { find, replace } — `find` is the target's
// own text for the same span, so a later strip restores THIS rev's code, not 289's.
function applyOps(ops, lines, map) {
    const idx = ops.filter(o => o.kind !== 'add').map(o => map[o.i]).filter(v => v !== undefined);
    if (!idx.length) return null;
    const lo = Math.min(...idx), hi = Math.max(...idx);
    const out = [];
    for (const op of ops) {
        if (op.kind === 'add') { out.push(op.line); continue; }
        const t = map[op.i];
        if (t === undefined) continue;                  // this pristine line is gone upstream
        if (op.kind === 'del') continue;                // the mod removes it
        out.push(op.kind === 'sub' ? op.line : lines[t]);
    }
    return { find: lines.slice(lo, hi + 1), replace: out, lo, hi };
}

// reseatFind(text, find, replace) -> { find, replace, at, score } | null
export function reseatFind(text, find, replace, opts = {}) {
    const SLACK = opts.slack ?? 3;
    const MIN_RATIO = opts.minRatio ?? 0.45;
    const ops = hunkOps(find, replace);
    if (!ops) return null;
    const lines = text.split('\n');
    const findN = find.map(normLine);
    const lineN = lines.map(normLine);
    const totalWeight = findN.reduce((s, l) => s + (l.trim().length >= 12 ? 100 : l.trim().length >= 6 ? 60 : 15), 0);
    if (!totalWeight) return null;

    // candidate sites: anywhere one of the block's substantial lines occurs
    const anchors = findN.map((l, i) => ({ l, i })).filter(a => a.l.trim().length >= 6);
    const seeds = new Set();
    for (const a of (anchors.length ? anchors : findN.map((l, i) => ({ l, i })))) {
        for (let p = 0; p < lineN.length; p++) if (lineN[p] === a.l) seeds.add(Math.max(0, p - a.i));
    }
    if (!seeds.size) return null;

    const cands = [];
    for (const s of seeds) {
        for (let len = Math.max(1, find.length - SLACK); len <= find.length + SLACK; len++) {
            if (s + len > lines.length) continue;
            const al = alignLines(findN, lineN.slice(s, s + len));
            if (!al) continue;
            if (al.score < totalWeight * MIN_RATIO) continue;
            // target indices are window-relative: shift into file space
            cands.push({ s, len, score: al.score, gaps: al.gaps, map: al.map.map(v => (v === undefined ? undefined : v + s)) });
        }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.score - a.score || a.gaps - b.gaps || a.s - b.s);
    const top = cands[0];
    // a clear winner or nothing: a rival site scoring as well means we cannot tell
    // where the code belongs, and guessing corrupts a file silently.
    if (cands.some(c => c !== top && c.s !== top.s && c.score >= top.score)) return null;

    const rebuilt = applyOps(ops, lines, top.map);
    if (!rebuilt) return null;
    let { find: newFind, replace: newReplace, lo, hi } = rebuilt;

    // Verify before trusting, then widen with untouched context if the anchor is not
    // yet unique in the target file (the same trick regen uses).
    const ok = (nf, nr) => countOccurrences(text, nf.join('\n')) === 1
        && countOccurrences(text, nr.join('\n')) === 0
        && hunkOps(nf, nr) !== null;
    if (!ok(newFind, newReplace)) {
        let done = false;
        for (let step = 0; step < 60 && !done; step++) {
            const growLo = lo > 0, growHi = hi < lines.length - 1;
            if (!growLo && !growHi) break;
            if (growLo) lo--;
            if (growHi) hi++;
            const nf = lines.slice(lo, hi + 1);
            const nr = [...lines.slice(lo, rebuilt.lo), ...newReplace, ...lines.slice(rebuilt.hi + 1, hi + 1)];
            if (ok(nf, nr)) { newFind = nf; newReplace = nr; done = true; }
        }
        if (!done) return null;
    }
    // The mod's own lines must all still be in the file after this hunk applies. A
    // reseat that quietly drops the payload is the one failure mode worse than not
    // reseating at all, so it is checked here rather than trusted.
    const after = text.replace(newFind.join('\n'), () => newReplace.join('\n'));
    const must = ops.filter(o => o.kind === 'add' || o.kind === 'sub').map(o => o.line).filter(l => l.trim());
    if (must.some(l => countOccurrences(after, l) === 0)) return null;
    return { find: newFind, replace: newReplace, at: rebuilt.lo + 1, score: top.score, gaps: top.gaps };
}

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
