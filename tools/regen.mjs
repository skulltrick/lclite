#!/usr/bin/env node
// lclite regen — convert working-tree `git diff` in upstream repos into anchor hunks.
// Run from repo root:  node lclite/regen.mjs
// Regenerates lclite/mods/<mod>/patches/*.json from the current diff.
//
// hunk = { find:[lines], replace:[lines] } — the MINIMAL unique window in the pristine
// old file. Pipeline (v2, 2026-09-15):
//   1. `git diff -U0` → every change block is its own island (no -U30 fat windows, so
//      two mods' edits can never merge into one hunk by proximity — the ≥61-line
//      isolation rule is retired: islands 2+ pristine lines apart split cleanly).
//   2. Context is then EXPANDED from a floor of 2/side only until the find window is
//      unique in the pristine file, and never past the neighbouring islands (context
//      may only contain untouched lines — otherwise a sibling hunk applied first would
//      eat this hunk's anchor).
//   3. Ownership: a `// lclite:<mod>` marker comment anywhere in the island's ADDED
//      lines wins with 100% precision. HUNK_OWNER regexes are fallback only and warn
//      loudly when used (they were a classifier where a declaration belongs).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRootManifest, loadRevManifest, supportedRevs, hostRev, patchJsonName } from './lib.mjs';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const LCLITE = path.resolve(TOOLS_DIR, '..');           // the overlay root
// The tree to diff. LCLITE_ROOT wins (same rule as lclite.mjs/doctor.mjs): the overlay
// usually stands on its own now and the revisions it patches are installs under the
// launcher's data folder, so "one level above me" is only right in the old layout.
const ROOT = path.resolve(process.env.LCLITE_ROOT || path.join(LCLITE, '..'));
const PRUNE = process.argv.includes('--prune');
const ROOT_REPOS = loadRootManifest(LCLITE).repos.map(r => r.dir + '/');

// WHICH REVISION this run describes. Regen writes mods/<mod>/patches/<rev>/, and the
// rev is the tree's own branch — a corpus is only ever a statement about the revision
// its hunks were generated from, so letting it be ambiguous is how you end up with 289
// anchors filed under 274. --rev overrides for the odd case (CI, a detached tree).
const REVS = loadRevManifest(LCLITE);
const REV = (() => {
    const i = process.argv.indexOf('--rev');
    const explicit = i >= 0 ? process.argv[i + 1] : null;
    const rev = explicit || hostRev(ROOT);
    if (!rev) {
        console.error(`regen — cannot tell which revision ${ROOT} is at (no git branch in webclient/ or engine/).`);
        console.error('  pass --rev <rev> explicitly if the tree is detached.');
        process.exit(3);
    }
    if (!supportedRevs(REVS).includes(rev)) {
        console.error(`regen — "${rev}" is not a revision this overlay supports (${supportedRevs(REVS).join(', ')}).`);
        console.error('  add it to revs.json first: a corpus for an undeclared revision is a corpus nothing reads.');
        process.exit(3);
    }
    return rev;
})();
console.log(`regen — revision ${REV} at ${ROOT}`);

// Files each mod's hunks may come from. With markers (A1) this is only "which files to
// diff" — routing is decided per island by its marker, not by which mod listed the file.
const MODS = {
    'camera': [
        'webclient/src/client/GameShell.ts',
        'webclient/src/client/Client.ts',
        'webclient/src/dash3d/World.ts',
        'webclient/src/dash3d/Pix3D.ts',
        'webclient/src/dash3d/Model.ts',
        'webclient/bundle.ts'
    ],
    'xp-drops': [
        'webclient/src/client/Client.ts'
    ],
    'true-tile': [
        // the decal is drawn by World.fill(), on the true tile's own turn in the
        // back-to-front ground pass, so this mod touches World.ts as well as Client.ts
        // (Client only arms the tile; the draw and its settings live World-side).
        'webclient/src/client/Client.ts',
        'webclient/src/dash3d/World.ts'
    ],
    'true-tile-plus': [
        // the ground effects ride the true tile the same way true-tile's square does:
        // Client.ts arms the tile once per frame, World.fill() draws the effect on that
        // tile's own turn (World.trueTilePlusDraw). The effect geometry + settings ship
        // as the files/ payload dash3d/TrueTilePlus.ts, pulled in by the import hunk.
        'webclient/src/client/Client.ts',
        'webclient/src/dash3d/World.ts'
    ],
    'hover-tile': [
        // the hover pick is resolved by the engine's own ground rasterizer, so this
        // mod is the second one to touch World.ts (camera is the other) — the pick
        // sites are in the pristine renderQuickGround/renderGround bodies.
        'webclient/src/client/Client.ts',
        'webclient/src/dash3d/World.ts'
    ],
    'gpu': [
        // ONLY the import line in Client.ts is a tracked upstream edit: the
        // renderer itself ships as a files/ copy (webclient/src/gpu/), and it
        // wires its patches by monkey-patching Pix3D/Pix2D/PixMap at load time,
        // so Model.ts / World.ts / Pix3D.ts / GameShell.ts stay untouched.
        'webclient/src/client/Client.ts'
    ],
    'stat-orbs': [
        'webclient/src/client/Client.ts'
    ],
    'ground-items': [
        // One file only: the labels are drawn from entityOverlays() (the areaGame
        // buffer, before otherOverlays composites the interfaces) and the label
        // boxes are consumed at the top of mouseLoop(). Everything else — the
        // high-alch value, the label text, the list edits, the box hit test, the
        // Alt state — ships as the files/ payload webclient/src/client/
        // GroundItems.ts, so nothing in World.ts or PixFont.ts is touched.
        'webclient/src/client/Client.ts'
    ],
    'tcg': [
        'webclient/src/client/Client.ts',
        'webclient/bundle.ts',
        'engine/view/client.ejs'
    ],
    'no-censor': [
        // BOTH halves of one policy: the client's WordFilter is the layer that can
        // honour a per-player setting, so it decides what gets masked, and the
        // server stops PRE-censoring chat (WordEnc.filter) because the client
        // re-filters every incoming message itself — display-neutral for vanilla.
        'webclient/src/wordfilter/WordFilter.ts',
        'engine/src/cache/wordenc/WordEnc.ts'
    ],
    'control-panel': [
        // the page chrome: the head (title, favicon, the panel's own tags) plus the
        // `revision` local that the <title> and the script tag's data-rev read
        'engine/view/client.ejs',
        'engine/src/web.ts'
    ],
    // Client.ts is shared; routing is by `// lclite:<mod>` marker (A1), so listing it
    // here only says "diff this file for these mods too".
    'hide-roofs': [
        'webclient/src/client/Client.ts'
    ],
    'low-detail': [
        'webclient/src/client/Client.ts'
    ],
    'shift-drop': [
        'webclient/src/client/Client.ts'
    ],
    'wiki-lookup': [
        // the menu row (buildMinimenu's tail), its dispatch (doAction's head) and the
        // payload import; the parse/URL/plan logic ships as a files/ copy
        // (webclient/src/client/WikiLookup.ts), like hotkeys/hover-tile.
        'webclient/src/client/Client.ts'
    ],
    'hotkeys': [
        // the two key hooks in GameShell.ts (claims + releases) and the keybind
        // block / chatbox prompt in Client.ts; the pure decision core ships as a
        // files/ copy (webclient/src/client/Hotkeys.ts), like gpu's renderer.
        'webclient/src/client/GameShell.ts',
        'webclient/src/client/Client.ts'
    ]
};

// Fallback routing ONLY (warns when it fires). Keep in sync with marker names.
const HUNK_OWNER = {
    'webclient/src/client/Client.ts': [
        ['gpu', /GpuRenderer|lclite "gpu"/],
        ['xp-drops', /xpDrops|XP_DROP|XP_PANEL|XP_HIDE|XP_BURST|XP_MAX|drawXp|xpSkillLabel|xpLastSkill|xpLastGain|xpStatic|xpRates|areaXp|STAT_ICON_BY_SKILL|gained amount|skill icons|fresh xp-drop|Experience  /i],
        ['stat-orbs', /orbsEnabled|orbsWereOn|drawStatOrbs|drawOrb\b|stat orbs|Stat orbs|statOrbs|backing ring|glass highlight|procedural orb/i],
        ['true-tile', /drawTrueTile|trueTileLine|trueTile\b|true tile|true-tile/i],
        ['camera', /cameraZoom|wheelZoom|middleRotate|wheelScrollChat|rotateLastScreen|middleMouseDown|scrollChatbox|onwheel|camFollow|orbitCamera|setVisZoom|viewRadius|visTile|clearPick|World\.click|lostcityClient|applyCameraSettings|EVENT_MOUSE_MOVE|EVENT_CAMERA_POSITION|mouseTracking\.length/],
        ['hotkeys', /hotkeys|Hotkeys|hotkeyKey|Press Enter to Chat/],
        ['wiki-lookup', /wikiLookup|WikiLookup|wiki lookup|Wiki <target>/i]
    ],
    'webclient/bundle.ts': [
        // terser property reserves exist FOR the panel contract (client.ejs/
        // panel.js calling window.lostcityClient.applyCameraSettings)
        ['control-panel', /lostcityClient|applyCameraSettings|page controls|page-facing/]
    ]
};

const MARKER = /lclite:([a-z][a-z0-9-]*)/;          // `// lclite:<mod>` in an added line
const MIN_CTX = 2;                                   // context floor per side (if available)
const IGNORE = [/^engine\/public\/client\/client\.js$/, /^webclient\/out\//];
const git = (repo, cmd) => execSync(`git -C ${path.join(ROOT, repo)} ${cmd}`, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
const toLF = s => s.replace(/\r\n/g, '\n');
const countOcc = (hay, needle) => { if (!needle) return 0; let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; } return n; };

// parse `git diff -U0` output → per file: islands [{a,b,c,d}] (old start/len, new start/len)
function parseIslands(diffText) {
    const out = [];
    let cur = null;
    for (const line of toLF(diffText).split('\n')) {
        if (line.startsWith('diff --git')) {
            if (cur) out.push(cur);
            cur = { file: line.match(/ b\/(.+)$/)[1], hunks: [] };
            continue;
        }
        if (!cur) continue;
        if (line.startsWith('@@')) {
            const m = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
            cur.hunks.push({ a: +m[1], b: m[2] === undefined ? 1 : +m[2], c: +m[3], d: m[4] === undefined ? 1 : +m[4] });
        }
    }
    if (cur) out.push(cur);
    return out;
}

// No host tree at all (the overlay on its own, no LCLITE_ROOT): nothing to extract and
// every per-file git call would just print a fatal. Say it once, like doctor does.
{
    const manifestRepos = loadRootManifest(LCLITE).repos.filter(r => r.required).map(r => r.dir);
    const missing = manifestRepos.filter(d => !fs.existsSync(path.join(ROOT, d)));
    if (missing.length === manifestRepos.length) {
        console.error(`regen — no Lost City checkout at ${ROOT}`);
        console.error('');
        console.error('  This is the overlay on its own, so there is nothing to diff. Point regen');
        console.error('  at an install:');
        console.error('    LCLITE_ROOT=<install folder> node tools/regen.mjs');
        console.error('  (or run LCLite.exe, which installs revisions into its own data folder)');
        process.exit(3);
    }
    for (const d of missing) console.error(`  !! ${d}/ not found at ${ROOT} — skipping its files`);
}

let total = 0, ambiguous = 0;
// manifest check: every patched file must live in a repo root.json declares
for (const [mod, files] of Object.entries(MODS))
    for (const f of files)
        if (!ROOT_REPOS.some(d => f.startsWith(d)))
            console.log(`  !! MODS['${mod}'] lists ${f} — no matching repo dir in root.json (${ROOT_REPOS.join(' ')}); skipping`);
const processed = new Set();
const out = new Map();                // mod -> [ {file, hunks, repo, head} ]
for (const [mod, filesOf] of Object.entries(MODS)) {
    for (const f of filesOf) {
        if (IGNORE.some(rx => rx.test(f))) continue;
        if (!ROOT_REPOS.some(d => f.startsWith(d))) continue;   // warned above; not this host's repo
        if (processed.has(f)) continue;
        processed.add(f);
        const repo = f.split('/')[0];
        const rel = f.slice(repo.length + 1);
        // rule-6 tripwire, deliberately BEFORE the diff: HEAD must be upstream code. If
        // the committed file already carries lclite markers the branch itself is modded
        // and every pin/diff below would describe the wrong thing. It has to fire on a
        // CLEAN worktree too — that is the case where diffs are empty and "nothing to
        // extract" looks benign.
        let headRaw;
        try { headRaw = git(repo, `show HEAD:"${rel}"`); }
        catch { console.log(`not in this rev: ${rel} (${repo}/HEAD has no such file) — skipping`); continue; }
        const oldLines = toLF(headRaw).split('\n');
        const committedMarkers = oldLines.filter(l => MARKER.test(l)).length;
        if (committedMarkers) {
            console.error(`\n!! ${repo}/HEAD:${rel} already contains ${committedMarkers} lclite marker line(s).`);
            console.error(`   regen refuses to run: the tracked branch itself is modded (rule 6).`);
            console.error(`   Recover: git -C ${path.join(ROOT, repo)} reset --mixed HEAD~1 (keeps your tree), then regen.\n`);
            process.exit(3);
        }
        let diff;
        try { diff = git(repo, `diff -U0 -- "${rel}"`); } catch (e) { console.error('git diff failed', f, e.message); continue; }
        if (!diff.trim()) { console.log('unchanged:', f); continue; }
        // EOL tripwire (v2 — first version compared `git show HEAD` raw, but in
        // autocrlf=true repos HEAD is LF while the checkout is CRLF: permanent false
        // alarm). The accident worth catching: a tool flattening the WORKTREE to LF
        // in a repo whose checkout convention is CRLF (git diff hides it; users and
        // git status feel it).
        const rawNew = fs.readFileSync(path.join(ROOT, f), 'utf-8');
        const newLines = toLF(rawNew).split('\n');
        {
            const headIsLF = !/\r\n/.test(headRaw);
            const autocrlf = git(repo, `config --get core.autocrlf`).trim() === 'true';
            const wantsCRLF = (autocrlf && headIsLF) || !headIsLF;   // CRLF checkout convention
            if (wantsCRLF && !/\r\n/.test(rawNew)) {
                console.log(`  !! ${f}: worktree file is LF-only but this checkout uses CRLF — line endings flattened by some tool; fix before regen`);
            }
        }
        const oldLF = oldLines.join('\n');
        const fd = parseIslands(diff).find(p => p.file === rel);
        if (!fd) { console.log('not in diff:', f); continue; }

        const byMod = new Map();      // owner mod -> hunks
        fd.hunks.sort((x, y) => x.a - y.a);
        fd.hunks.forEach((h, i) => {
            // oldRegion/newRegion alignment. -U0 conventions:
            //   b>0  `@@ -L,l +M,n @@`  : old 1-based lines L..L+l-1 replaced; 0-based start L-1
            //   b=0  `@@ -L,0 +M,n @@`  : n new lines inserted AFTER old line L, i.e. at
            //                             0-based index L (a pure insertion has NO old block).
            // Mixing these up (using L-1 for b=0) shifts `replace` one line against `find`
            // and silently eats one context line at pristine-apply time. Discovered by the
            // t/ byte-identity harness, 2026-09-15.
            const oldStart0 = h.b ? h.a - 1 : h.a;
            const newStart0 = h.c - 1;
            const head = oldStart0;          // compat with budget math below
            // safe context budget: untouched lines on each side, in BOTH files
            const prev = fd.hunks[i - 1];
            const next = fd.hunks[i + 1];
            const prevEnd0 = prev ? (prev.b ? prev.a + prev.b : prev.a) : 0;   // 0-based first untouched line after prev
            const nextStart0 = next ? (next.b ? next.a - 1 : next.a) : oldLines.length;
            let leadBudget = head - prevEnd0;
            // trail must stop BEFORE the next island's mutation/insertion line: window hi
            // = oldStart0 + del + trail - 1 <= nextStart0 - 1  ->  trail <= nextStart0 - oldStart0 - del.
            // (Without the `- h.b` a replacement hunk's window swallowed the next island's
            // anchor line -> apply-order breakage, caught by doctor overlap check 2026-09-15.)
            let trailBudget = nextStart0 - oldStart0 - h.b;
            if (leadBudget < 0) leadBudget = 0;
            if (trailBudget < 0) trailBudget = 0;
            const leadMax = Math.min(leadBudget, 30), trailMax = Math.min(trailBudget, 30);

            let lead = Math.min(MIN_CTX, leadMax), trail = Math.min(MIN_CTX, trailMax);
            let find, rep, occ = 0;
            for (;;) {
                find = oldLines.slice(oldStart0 - lead, oldStart0 + h.b + trail);
                rep = newLines.slice(newStart0 - lead, newStart0 + h.d + trail);
                occ = countOcc(oldLF, find.join('\n'));
                if (occ === 1) break;
                if (lead + trail >= leadMax + trailMax) break;   // budget exhausted
                if (lead < leadMax && (lead <= trail || !trail)) lead++;
                else if (trail < trailMax) trail++;
                else lead++;
            }
            if (occ !== 1) { ambiguous++; console.log(`  !! AMBIGUOUS (${occ}x) ${rel} @${h.a}: ${JSON.stringify((find[0] || '').slice(0, 70))}`); }

            // ---- ownership: marker > regex-fallback(warn) > declaring mod
            const added = rep.filter(l => !find.includes(l));
            const markers = new Set(added.map(l => (l.match(MARKER) || [])[1]).filter(Boolean));
            let owner, why;
            if (markers.size === 1) { owner = [...markers][0]; why = 'marker'; }
            else if (markers.size > 1) {
                // genuinely mixed block: the majority marker wins; document loudly
                const best = [...markers][0];
                owner = best; why = `MIXED MARKERS ${[...markers].join(',')} — split the edits or the first marker wins (${best})`;
                console.log(`  !! ${rel} @${h.a}: ${why}`);
            } else {
                owner = mod; let best = 0;
                for (const [name, rx] of HUNK_OWNER[f] || []) {
                    const hits = added.filter(l => rx.test(l)).length;
                    if (hits > best) { best = hits; owner = name; }
                }
                why = 'REGEX-FALLBACK (add a `// lclite:' + owner + '` marker to this block!)';
                if (owner !== mod || best > 0) console.log(`  ~ ${rel} @${h.a}: routed to ${owner} by ${why}`);
            }
            if (owner !== mod && why && !why.startsWith('MIXED')) {
                // sanity: a marker-less hunk re-routed away from the declaring mod is fine,
                // but a marker routing to an unknown mod is a typo — fail loudly
            }
            if (!byMod.has(owner)) byMod.set(owner, []);
            // pos: [insert/delete start (0-based, pristine), deleted-line-count,
            //       find-window low (0-based incl), find-window high (0-based incl)]
            // — machine-readable geometry so doctor can verify apply-safety without
            // re-deriving slices: a hunk breaks a sibling ONLY if its mutation zone
            // [pos0, pos0+del) or insertion point falls STRICTLY INSIDE the sibling's
            // window (winLo < p <= winHi). Shared context lines at the edges are fine.
            byMod.get(owner).push({ find, replace: rep, note: `${rel} @ old line ${h.a}`, occ, pos: [oldStart0, h.b, oldStart0 - lead, oldStart0 + h.b + trail - 1] });
        });
        for (const [owner, hunks] of byMod) {
            if (!out.has(owner)) out.set(owner, []);
            out.get(owner).push({ f, hunks, repo, head: git(repo, 'rev-parse HEAD').trim() });
        }
    }
}
// Nothing extracted at all = wrong tree (pristine, or LCLITE_ROOT pointing somewhere
// that isn't a checkout). Stop before the write/cleanup loops below, which read "no
// patch files are wanted this run" as "delete every patch file". NB: count what the
// extraction loops found — `total` is only filled in while writing.
const extracted = [...out.values()].reduce((n, es) => n + es.reduce((m, e) => m + e.hunks.length, 0), 0);
if (extracted === 0) {
    console.error('\n!! regen found no modded lines to extract under ' + ROOT);
    console.error('   Nothing was written or removed. Check that the overlay is actually');
    console.error('   applied there (apply --check) and that LCLITE_ROOT points at a checkout.');
    process.exit(2);
}
for (const [owner, entries] of out) {
    const dir = path.join(LCLITE, 'mods', owner, 'patches', REV);
    fs.mkdirSync(dir, { recursive: true });
    for (const e of entries) {
        fs.writeFileSync(path.join(dir, patchJsonName(e.f)), JSON.stringify({
            file: e.f, mod: owner, rev: REV, generated_from: { repo: e.repo, head: e.head }, hunks: e.hunks
        }, null, 1));
        total += e.hunks.length;
        console.log(`[${owner}] ${e.f}: ${e.hunks.length} hunks`);
    }
}
// clean stale patch files: any json in THIS revision's corpus whose (file, mod) pair was
// not written this run. Scoped to the rev directory on purpose — another revision's
// corpus is never this run's business. Destructive, so it needs --prune: a convergent
// `apply --mods <one>` STRIPS the other mods, and their reverted files look exactly like
// "stale patches" from in here.
for (const owner of new Set([...Object.keys(MODS), ...out.keys()])) {
    const dir = path.join(LCLITE, 'mods', owner, 'patches', REV);
    if (!fs.existsSync(dir)) continue;
    const wanted = new Set((out.get(owner) || []).map(e => patchJsonName(e.f)));
    for (const j of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
        if (wanted.has(j)) continue;
        if (PRUNE) { fs.rmSync(path.join(dir, j)); console.log(`[${owner}] removed stale ${j}`); }
        else console.log(`  ~ ${owner}/${REV}/${j}: no hunks in this tree — rerun with --prune to delete`);
    }
}
// hooks.json — machine-readable hook-site registry (B3): every mod, every file it
// touches, every anchor line. Consumed by docs/HOOKS.md generators, agents, and
// `doctor`; regenerate alongside the hunks so it can never lie separately.
//
// Only the PRIMARY revision owns this file. It documents where the mods are AUTHORED,
// and every other revision is described as a port of it — letting a 254 regen overwrite
// the 289 hook map would quietly turn the reference doc into a description of a port.
if (REV !== REVS.primary) {
    console.log(`docs/hooks.json + HOOKS.md left alone: they describe the primary revision (${REVS.primary}), and this run is ${REV}`);
} else {
    const hooks = {};
    for (const [owner, entries] of out) {
        for (const e of entries) {
            (hooks[e.f] ||= []).push(...e.hunks.map(h => ({
                mod: owner, note: h.note, line: h.pos[0],
                marker: h.replace.filter(l => !h.find.includes(l)).some(l => /lclite:[a-z]/.test(l)) ? true : false
            })));
        }
    }
    for (const f of Object.keys(hooks)) hooks[f].sort((a, b) => a.line - b.line);
    const heads = {};
    for (const [owner, entries] of out) for (const e of entries) heads[e.repo] = e.head;
    fs.writeFileSync(path.join(LCLITE, 'docs', 'hooks.json'), JSON.stringify({ generated_by: 'regen.mjs', rev: REV, heads, hooks }, null, 1) + '\n');
    console.log('docs/hooks.json written:', Object.values(hooks).flat().length, 'hook sites in', Object.keys(hooks).length, 'files');
    // HOOKS.md — human view of the SAME data (never allowed to drift from hooks.json)
    let md = `# Hook-site map\n\n> GENERATED by \`LCLITE_ROOT=<install> node tools/regen.mjs\` from revision **${REV}** — do not hand-edit; edit sources and regen.\n> Every lclite hunk in source order. \`pos\` = 0-based line in the PRISTINE file where the hunk inserts/deletes.\n\n| file | pos | mod | first added line |\n|---|---|---|---|\n`;
    for (const [f, list] of Object.entries(hooks)) {
        for (const h of list) {
            const pj = path.join(LCLITE, 'mods', h.mod, 'patches', REV, patchJsonName(f));
            let first = '';
            try {
                const hh = JSON.parse(fs.readFileSync(pj, 'utf-8')).hunks.find(x => x.note === h.note);
                first = (hh.replace.filter(l => !hh.find.includes(l))[0] || '').trim().slice(0, 80).replace(/\|/g, '\\|');
            } catch { }
            md += `| ${f} | ${h.line} | ${h.mod} | \`${first}\` |\n`;
        }
    }
    fs.writeFileSync(path.join(LCLITE, 'docs', 'HOOKS.md'), md);
}
console.log('TOTAL hunks:', total, ambiguous ? `  WARNING ${ambiguous} ambiguous` : '');
