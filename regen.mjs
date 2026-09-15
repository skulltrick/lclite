#!/usr/bin/env node
// lclite regen — convert working-tree `git diff` in upstream repos into anchor hunks.
// Run from repo root:  node lclite/regen.mjs
// Regenerates lclite/mods/<mod>/patches/*.json from the current diff.
//
// hunk = { find:[lines], replace:[lines] } — unique in the pristine old file, expanded
// symmetrically with pure context lines (git diff -U30) so no hunk's context can ever
// overlap another hunk's changes (git merges hunks closer than 2*30 lines into one).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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
        // ObjType.ts save/restore hunks belong to this mod too via MODS below
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
    'control-panel': [
        'engine/view/client.ejs'
    ]
};

// Client.ts/ObjType.ts are shared by several engine mods — route each hunk to
// its owning mod so overlays stay independent. Ownership = argmax of
// distinctive-token hits over the hunk's ADDED lines, evaluated across ALL mod
// rules including camera (default when nothing matches). Rule ORDER breaks
// ties: xp-drops > stat-orbs > anti-cheat > rendering > camera. This keeps the
// applyCameraSettings settings-bus hunk with camera (camera hits drown the
// one-line reads other mods add to it). The CYCLELOGIC7-wrap + camera
// one-shot-clearPick hunk is genuinely merged (10 lines apart upstream) and
// lands with camera by score. Pix3D farPlane/vis work STAYS in camera: those
// constants exist to scale with zoom (World.visFar).
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

const IGNORE = [/^engine\/public\/client\/client\.js$/, /^webclient\/out\//];
const git = (repo, cmd) => execSync(`git -C ${path.join(ROOT, repo)} ${cmd}`, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
const toLF = s => s.replace(/\r\n/g, '\n');
const countOcc = (hay, needle) => { if (!needle) return 0; let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; } return n; };

function parseHunks(diffText) {
    const out = [];
    let cur = null, curH = null;
    for (const line of toLF(diffText).split('\n')) {
        if (line.startsWith('diff --git')) {
            if (curH && cur) cur.hunks.push(curH);
            if (cur) out.push(cur);
            cur = { file: line.match(/ b\/(.+)$/)[1], hunks: [] };
            curH = null; continue;
        }
        if (!cur) continue;
        if (line.startsWith('@@')) {
            if (curH) cur.hunks.push(curH);
            const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
            curH = { oldStart: +m[1], newStart: +m[2], ctx: [] }; continue;
        }
        if (curH && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) curH.ctx.push(line);
    }
    if (curH && cur) cur.hunks.push(curH);
    if (cur) out.push(cur);
    return out;
}

let total = 0, ambiguous = 0;
const processed = new Set();          // shared files are diffed once; hunks route to owners
const out = new Map();                // mod -> [ {file, hunks, repo, head} ]
for (const [mod, filesOf] of Object.entries(MODS)) {
    for (const f of filesOf) {
        if (IGNORE.some(rx => rx.test(f))) continue;
        const repo = f.split('/')[0];
        const rel = f.slice(repo.length + 1);
        if (processed.has(f)) continue;   // routed per-hunk via HUNK_OWNER below
        processed.add(f);
        let diff;
        try { diff = git(repo, `diff -U30 -- "${rel}"`); } catch (e) { console.error('git diff failed', f, e.message); continue; }
        if (!diff.trim()) { console.log('unchanged:', f); continue; }
        const oldText = git(repo, `show HEAD:"${rel}"`);
        const newText = fs.readFileSync(path.join(ROOT, f), 'utf-8');
        const oldLF = toLF(oldText);
        const fd = parseHunks(diff).find(p => p.file === rel);
        if (!fd) { console.log('not in diff:', f); continue; }
        const byMod = new Map();          // owner mod -> hunks
        for (const h of fd.hunks) {
            let oldRegion = [], newRegion = [];
            for (const l of h.ctx) {
                const t = l[0], body = l.slice(1);
                if (t === ' ') { oldRegion.push(body); newRegion.push(body); }
                else if (t === '-') oldRegion.push(body);
                else if (t === '+') newRegion.push(body);
            }
            // common prefix / suffix of the two regions
            let P = 0;
            while (P < oldRegion.length && P < newRegion.length && oldRegion[P] === newRegion[P]) P++;
            let S = 0;
            while (S < oldRegion.length - P && S < newRegion.length - P &&
                   oldRegion[oldRegion.length - 1 - S] === newRegion[newRegion.length - 1 - S]) S++;
            const lead = Math.max(0, P - 1), trail = Math.max(0, S - 1);
            let find = oldRegion.slice(lead, oldRegion.length - trail);
            let rep = newRegion.slice(lead, newRegion.length - trail);
            // symmetric expansion using pure context (identical in old & new regions)
            let occ = countOcc(oldLF, find.join('\n'));
            let k = 1;
            while (occ !== 1 && (lead - k >= 0 || oldRegion.length - trail + k - 1 < oldRegion.length)) {
                if (lead - k >= 0) {
                    const ctxLine = oldRegion[lead - k]; // context: equals newRegion at same offset
                    find = [ctxLine, ...find];
                    rep = [ctxLine, ...rep];
                }
                const di = oldRegion.length - trail + k - 1;
                if (di < oldRegion.length) {
                    const ctxLine = oldRegion[di];
                    find = [...find, ctxLine];
                    rep = [...rep, ctxLine];
                }
                occ = countOcc(oldLF, find.join('\n'));
                k++;
            }
            if (occ !== 1) { ambiguous++; console.log(`  !! AMBIGUOUS (${occ}x) ${rel} @${h.oldStart}: ${JSON.stringify(find[0].slice(0, 70))}`); }
            // route: argmax of token hits across all mod rules (camera included,
            // so the settings-bus hunk stays with camera by score, not by floor);
            // no rule matches -> stays with the declaring mod
            const added = rep.filter(l => !find.includes(l));
            let owner = mod, best = 0;
            for (const [name, rx] of HUNK_OWNER[f] || []) {
                const hits = added.filter(l => rx.test(l)).length;
                if (hits > best) { best = hits; owner = name; }
            }
            if (!byMod.has(owner)) byMod.set(owner, []);
            byMod.get(owner).push({ find, replace: rep, note: `${rel} @ old line ${h.oldStart}`, occ });
        }
        for (const [owner, hunks] of byMod) {
            if (!out.has(owner)) out.set(owner, []);
            out.get(owner).push({ f, hunks, repo, head: git(repo, 'rev-parse HEAD').trim() });
        }
    }
}
for (const [owner, entries] of out) {
    const dir = path.join(__dirname, 'mods', owner, 'patches');
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
    const dir = path.join(__dirname, 'mods', owner, 'patches');
    if (!fs.existsSync(dir)) continue;
    const wanted = new Set((out.get(owner) || []).map(e => path.basename(e.f).replace(/\W+/, '_') + '.json'));
    for (const j of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
        if (!wanted.has(j)) { fs.rmSync(path.join(dir, j)); console.log(`[${owner}] removed stale ${j}`); }
    }
}
console.log('TOTAL hunks:', total, ambiguous ? `  WARNING ${ambiguous} ambiguous` : '');
