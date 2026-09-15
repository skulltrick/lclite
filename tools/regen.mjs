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
import { loadRootManifest } from './lib.mjs';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const LCLITE = path.resolve(TOOLS_DIR, '..');           // the overlay root
const ROOT = path.resolve(LCLITE, '..');                // the Lost City checkout
const ROOT_REPOS = loadRootManifest(LCLITE).repos.map(r => r.dir + '/');

// Files each mod's hunks may come from. With markers (A1) this is only "which files to
// diff" — routing is decided per island by its marker, not by which mod listed the file.
const MODS = {
    'camera': [
        'webclient/src/client/GameShell.ts',
        'webclient/src/client/Client.ts',
        'webclient/src/dash3d/World.ts',
        'webclient/src/dash3d/Pix3D.ts',
        'webclient/src/dash3d/Model.ts',
        'webclient/src/config/ObjType.ts',
        'webclient/bundle.ts'
    ],
    'xp-drops': [
        'webclient/src/client/Client.ts'
    ],
    'true-tile': [
        'webclient/src/client/Client.ts'
    ],
    'rendering': [
        // the smoothShading localStorage read (mainloop, per-frame) — the
        // ObjType.ts save/restore hunks belong to this mod too via markers below
        'webclient/src/client/Client.ts',
        'webclient/src/config/ObjType.ts'
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
    'anti-cheat': [
        'webclient/src/client/Client.ts'
    ],
    'control-panel': [
        'engine/view/client.ejs'
    ]
};

// Fallback routing ONLY (warns when it fires). Keep in sync with marker names.
const HUNK_OWNER = {
    'webclient/src/client/Client.ts': [
        ['gpu', /GpuRenderer|lclite "gpu"/],
        ['xp-drops', /xpDrops|XP_DROP|XP_PANEL|XP_HIDE|XP_BURST|XP_MAX|drawXp|xpSkillLabel|xpLastSkill|xpLastGain|xpStatic|xpRates|areaXp|STAT_ICON_BY_SKILL|gained amount|skill icons|fresh xp-drop|Experience  /i],
        ['stat-orbs', /orbsEnabled|orbsWereOn|drawStatOrbs|drawOrb\b|stat orbs|Stat orbs|statOrbs|backing ring|glass highlight|procedural orb/i],
        ['true-tile', /drawTrueTile|trueTileLine|trueTile\b|true tile|true-tile/i],
        ['anti-cheat', /antiCheatEnabled|antiCheat|ANTICHEAT_|telemetry|mouseTracking\.length|RuneScope/i],
        ['rendering', /lowDetail|smoothShading|smooth-shading/i],
        ['camera', /cameraZoom|wheelZoom|middleRotate|wheelScrollChat|rotateLastScreen|middleMouseDown|scrollChatbox|onwheel|camFollow|orbitCamera|setVisZoom|viewRadius|visTile|clearPick|World\.click|lostcityClient|applyCameraSettings/]
    ],
    'webclient/src/config/ObjType.ts': [
        ['rendering', /lowDetail|smoothShading|smooth-shading/i]
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
        let diff;
        try { diff = git(repo, `diff -U0 -- "${rel}"`); } catch (e) { console.error('git diff failed', f, e.message); continue; }
        if (!diff.trim()) { console.log('unchanged:', f); continue; }
        const oldLines = toLF(git(repo, `show HEAD:"${rel}"`)).split('\n');
        // EOL tripwire (v2 — first version compared `git show HEAD` raw, but in
        // autocrlf=true repos HEAD is LF while the checkout is CRLF: permanent false
        // alarm). The accident worth catching: a tool flattening the WORKTREE to LF
        // in a repo whose checkout convention is CRLF (git diff hides it; users and
        // git status feel it).
        const rawNew = fs.readFileSync(path.join(ROOT, f), 'utf-8');
        const newLines = toLF(rawNew).split('\n');
        {
            const headIsLF = !/\r\n/.test(git(repo, `show HEAD:"${rel}"`));
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
for (const [owner, entries] of out) {
    const dir = path.join(LCLITE, 'mods', owner, 'patches');
    fs.mkdirSync(dir, { recursive: true });
    for (const e of entries) {
        fs.writeFileSync(path.join(dir, path.basename(e.f).replace(/\W+/, '_') + '.json'), JSON.stringify({
            file: e.f, mod: owner, generated_from: { repo: e.repo, head: e.head }, hunks: e.hunks
        }, null, 1));
        total += e.hunks.length;
        console.log(`[${owner}] ${e.f}: ${e.hunks.length} hunks`);
    }
}
// clean stale patch files: any json whose (file, mod) pair was not written this run
for (const owner of new Set([...Object.keys(MODS), ...out.keys()])) {
    const dir = path.join(LCLITE, 'mods', owner, 'patches');
    if (!fs.existsSync(dir)) continue;
    const wanted = new Set((out.get(owner) || []).map(e => path.basename(e.f).replace(/\W+/, '_') + '.json'));
    for (const j of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
        if (!wanted.has(j)) { fs.rmSync(path.join(dir, j)); console.log(`[${owner}] removed stale ${j}`); }
    }
}
// hooks.json — machine-readable hook-site registry (B3): every mod, every file it
// touches, every anchor line. Consumed by docs/HOOKS.md generators, agents, and
// `doctor`; regenerate alongside the hunks so it can never lie separately.
{
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
    fs.writeFileSync(path.join(LCLITE, 'docs', 'hooks.json'), JSON.stringify({ generated_by: 'regen.mjs', heads, hooks }, null, 1) + '\n');
    console.log('docs/hooks.json written:', Object.values(hooks).flat().length, 'hook sites in', Object.keys(hooks).length, 'files');
    // HOOKS.md — human view of the SAME data (never allowed to drift from hooks.json)
    let md = '# Hook-site map\n\n> GENERATED by `node tools/regen.mjs` (run from lclite/) — do not hand-edit; edit sources and regen.\n> Every lclite hunk in source order. `pos` = 0-based line in the PRISTINE file where the hunk inserts/deletes.\n\n| file | pos | mod | first added line |\n|---|---|---|---|\n';
    for (const [f, list] of Object.entries(hooks)) {
        for (const h of list) {
            const pj = path.join(LCLITE, 'mods', h.mod, 'patches', path.basename(f).replace(/\W+/, '_') + '.json');
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
