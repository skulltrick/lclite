#!/usr/bin/env node
// lclite port — re-anchor the primary corpus onto another revision.
//
//   node tools/port.mjs 254                    # find the launcher's 254 install and port onto it
//   node tools/port.mjs 254 --root <host>      # or point at a checkout yourself
//   node tools/port.mjs 254 --dry              # report only, write nothing
//   node tools/port.mjs 254 --mods camera,tcg  # just these mods
//   node tools/port.mjs 254 --partial          # keep half-ported mods too (inspection only)
//
// This is the DEVELOPER half of the revision system (players never run it). Mods are
// authored on the primary revision; every other revision is ported from that corpus.
// For each hunk it tries, in order:
//
//   1. already applied  — the replacement text is in the tree (nothing to do)
//   2. exact anchor     — find[] still matches byte-for-byte (nothing to do)
//   3. reseat           — upstream moved code INSIDE the anchor; lib.mjs reseatFind()
//                         re-anchors the block and rebuilds both sides so the mod's
//                         own lines still land in the same place
//   4. unplaced         — reported, with the anchor text and where its lines went, so
//                         a human can see whether it is a reseat or a missing feature
//
// ALL-OR-NOTHING PER MOD is the rule that keeps this safe. A mod that could not be
// fully re-anchored is REVERTED and left out of the revision's corpus entirely: a mod
// missing half its hooks is not a narrower mod, it is a broken one (camera without its
// visibility-cache hook, control-panel without its terser reserves — the latter mangles
// the page-facing API silently). So a revision gets whole mods or no mod. `--partial`
// exists only to inspect what a half-port looks like; it is never what you ship.
//
// It edits the TREE, never the corpus: `node tools/regen.mjs` (with LCLITE_ROOT on the
// same tree) is what turns the ported tree into mods/<mod>/patches/<rev>/, so the
// corpus still has exactly one author. Then `apply --check` on that rev must be ✗0.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
    LIB_DIR, findMods, toLF, restoreEOL, countOccurrences, loadRevManifest, supportedRevs,
    hostRev, corpusRevFor, reseatFind, loadRootManifest,
} from './lib.mjs';

const args = process.argv.slice(2);
const flag = (name, def = null) => {
    const i = args.indexOf('--' + name);
    if (i < 0) return def;
    const v = args[i + 1];
    return v && !v.startsWith('--') ? v : true;
};
const rev = args.find(a => !a.startsWith('--') && a !== flag('root') && a !== flag('mods'));
const dry = !!flag('dry', false);
const partial = !!flag('partial', false);
const only = typeof flag('mods') === 'string' ? String(flag('mods')).split(/[, ]+/).filter(Boolean) : null;

const REVS = loadRevManifest(LIB_DIR);
const NAMES = supportedRevs(REVS);
if (!rev) {
    console.error('usage: node tools/port.mjs <rev> [--root <host tree>] [--dry] [--partial] [--mods a,b]');
    console.error(`revisions this overlay knows: ${NAMES.join(', ')}`);
    process.exit(1);
}

// The tree to port onto. Prefer --root, then LCLITE_ROOT, then the launcher's own
// install folder — `node tools/port.mjs 254` right after installing 254 is the whole
// intended workflow, so it has to find that install without being told. A candidate is
// only accepted when it is checked out AT this revision: a stale LCLITE_ROOT pointing at
// another install must not win over the right one sitting right there in the launcher.
function candidates() {
    const out = [];
    const explicit = typeof flag('root') === 'string' ? flag('root') : null;
    if (explicit) out.push(path.resolve(explicit));
    if (process.env.LCLITE_ROOT) out.push(path.resolve(process.env.LCLITE_ROOT));
    const base = process.env.LOCALAPPDATA || process.env.HOME;
    if (base) out.push(path.join(base, 'LCLite', 'installs', rev));
    return [...new Set(out)];
}
const seen = [];
let ROOT = null;
for (const cand of candidates()) {
    if (!fs.existsSync(cand)) continue;
    const r = hostRev(cand);
    if (r === rev) { ROOT = cand; break; }
    seen.push(`${cand} is at "${r || 'no branch'}"`);
}
if (!ROOT) {
    if (seen.length) {
        console.error(`no tree checked out at ${rev}.`);
        for (const s of seen) console.error(`  ${s}`);
        console.error(`  Porting the primary corpus onto the wrong tree is exactly the silent breakage this`);
        console.error(`  refuses. Install ${rev} in the launcher (or check it out) first, or pass --root <folder>.`);
    } else {
        console.error(`no host tree to port onto for ${rev}.`);
        console.error('  install that revision in the launcher first, or pass --root <folder with webclient/ + engine/>');
    }
    process.exit(3);
}
for (const r of loadRootManifest(LIB_DIR).repos.filter(x => x.required)) {
    if (!fs.existsSync(path.join(ROOT, r.dir))) {
        console.error(`!! ${ROOT} has no ${r.dir}/ — that is not a Lost City host tree`);
        process.exit(3);
    }
}
// (the tree was already proven to be AT this revision when it was picked above)

// Source corpus per mod: the revision's own corpus when it already has one (so a
// re-run after hand-fixing a hunk is idempotent), else whatever it inherits, else the
// PRIMARY corpus — porting an as-yet-unsupported revision is the normal first run, and
// the primary is by definition what every other revision is ported from.
const primaryMods = findMods(LIB_DIR, REVS.primary);
const targetMods = findMods(LIB_DIR, rev);
const mods = primaryMods
    .map(pm => {
        const tm = targetMods.find(m => m.name === pm.name) || pm;
        const srcRev = corpusRevFor(REVS, pm.dir, rev) || REVS.primary;
        const patches = srcRev === tm.corpusRev && tm.patches.length ? tm.patches : pm.patches;
        return { ...pm, srcRev, patches };
    })
    .filter(m => !only || only.includes(m.name));

console.log(`lclite port — ${LIB_DIR}`);
console.log(`target: ${rev} at ${ROOT}${dry ? '   (dry run: nothing will be written)' : ''}`);
console.log('');

// ---- plan + apply in memory, so a mod can be reverted as a unit --------------
// Every file is read once and kept as a buffer; every hunk application is recorded so
// an incomplete mod can be undone exactly (per hunk, in reverse) without touching what
// the complete mods did to the same file — Client.ts is shared by nine of them.
const files = new Map();
const buf = (rel) => {
    if (files.has(rel)) return files.get(rel);
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { files.set(rel, null); return null; }
    const raw = fs.readFileSync(abs, 'utf-8');
    const e = { abs, text: toLF(raw), hadCRLF: raw.includes('\r\n'), dirty: false };
    files.set(rel, e);
    return e;
};

// Where an unplaced anchor's lines went: the same fuzzy report `apply --check` prints,
// so the human has a line number to open instead of a wall of "anchor not found".
function hintsFor(text, find) {
    const lines = text.split('\n');
    const probe = find.map(l => l.trim()).filter(l => l.length >= 20).sort((a, b) => b.length - a.length).slice(0, 2);
    const out = [];
    for (const p of probe) {
        const hit = lines.findIndex(l => l.trim() === p);
        if (hit >= 0) { out.push(`"${p.slice(0, 56)}…" is at line ${hit + 1}`); continue; }
        const rx = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\s+/g, '\\s*').slice(0, 160));
        const hit2 = lines.findIndex(l => rx.test(l));
        out.push(hit2 >= 0 ? `"${p.slice(0, 56)}…" ~ line ${hit2 + 1} (whitespace changed)` : `"${p.slice(0, 56)}…" is GONE from this revision`);
    }
    return out;
}

const rows = [];
for (const mod of mods) {
    const row = {
        mod: mod.name, srcRev: mod.srcRev, exact: 0, reseated: 0, already: 0,
        unplaced: [], missingFile: [], ops: [],
    };
    for (const patch of mod.patches) {
        const e = buf(patch.file);
        if (!e) {
            row.missingFile.push({ file: patch.file, count: patch.hunks.length });
            continue;
        }
        for (const h of patch.hunks) {
            const find = h.find.join('\n');
            const rep = h.replace.join('\n');
            if (countOccurrences(e.text, rep) >= 1) { row.already++; continue; }        // already applied
            if (countOccurrences(e.text, find) === 1) {                                 // byte-identical anchor
                e.text = e.text.replace(find, () => rep);
                e.dirty = true;
                row.ops.push({ file: patch.file, find: h.find, replace: h.replace });
                row.exact++;
                continue;
            }
            const r = reseatFind(e.text, h.find, h.replace);
            if (r) {
                e.text = e.text.replace(r.find.join('\n'), () => r.replace.join('\n'));
                e.dirty = true;
                row.ops.push({ file: patch.file, find: r.find, replace: r.replace, reseated: true });
                row.reseated++;
                continue;
            }
            row.unplaced.push({ file: patch.file, note: h.note, anchor: h.find[0] || '', why: hintsFor(e.text, h.find) });
        }
    }
    row.complete = !row.unplaced.length && !row.missingFile.length;
    rows.push(row);
}

// Revert every incomplete mod, so what lands on the tree is whole mods only.
const reverted = new Set();
const revert = (row) => {
    for (const op of [...row.ops].reverse()) {
        const e = files.get(op.file);
        const n = countOccurrences(e.text, op.replace.join('\n'));
        if (n === 1) { e.text = e.text.replace(op.replace.join('\n'), () => op.find.join('\n')); reverted.add(row.mod); }
        else console.log(`  !! could not revert [${row.mod}] ${op.file} — apply it by hand or reset the tree`);
    }
    row.ops = [];
    row.exact = 0; row.reseated = 0;
};
if (!partial) for (const row of rows.filter(r => !r.complete)) revert(row);

const writeTree = () => {
    for (const e of files.values()) if (e && e.dirty) fs.writeFileSync(e.abs, restoreEOL(e.text, e.hadCRLF));
};

// ---- the typecheck gate ------------------------------------------------------
// An anchor that RESEATS is not the same as code that COMPILES. `Packet.p1Enc` and
// `Client.loopCycle` both exist at 289 and neither exists at 254, so hunks that
// re-anchored perfectly still referenced symbols that are not there — anchors can never
// see that, and a mod that lands and then fails to typecheck is a broken install, not a
// narrower one. So: after writing the tree, typecheck it, map each error back to the mod
// whose inserted line it is, drop those mods, and typecheck again until it is clean (or
// nothing is left to drop). Only runs when the tree has its own tsc; --no-tsc skips it.
const tscErrors = () => {
    const wc = path.join(ROOT, 'webclient');
    // Run the compiler through node rather than the .bin shim: bun installs `tsc.exe`
    // and `tsc.bunx`, npm installs `tsc.cmd`, git-bash resolves a bare `tsc` to an
    // `.exe` — and execFileSync cannot launch a `.cmd` without a shell. The compiler's
    // own entry point is the one path that is the same everywhere.
    const entry = path.join(wc, 'node_modules', 'typescript', 'bin', 'tsc');
    const bin = path.join(wc, 'node_modules', '.bin');
    const shims = fs.existsSync(bin) ? fs.readdirSync(bin).filter(f => /^tsc\.(exe|cmd)$/i.test(f)) : [];
    const argv = fs.existsSync(entry) ? [entry] : shims.length ? [path.join(bin, shims[0])] : null;
    if (!argv) return null;
    let out = '';
    try {
        out = execFileSync(process.execPath, [...argv, '--noEmit', '-p', 'tsconfig.json'], { cwd: wc, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
        out = String(e.stdout || '') + String(e.stderr || '');
    }
    const errs = [];
    for (const line of toLF(out).split('\n')) {
        const m = /^(.+?)\((\d+),(\d+)\): error TS\d+/.exec(line.trim());
        if (m) errs.push({ file: m[1].replace(/\\/g, '/'), line: +m[2], text: line.trim() });
    }
    return errs;
};

const dropped = [];
if (partial) {
    console.log('  (--partial: typecheck gate skipped — this tree is for inspection, not for shipping)');
} else if (!dry && !process.argv.includes('--no-tsc')) {
    writeTree();
    for (let round = 0; round < 4; round++) {
        const errs = tscErrors();
        if (errs === null) { console.log('  (no tsc in this tree — typecheck gate skipped)'); break; }
        if (!errs.length) { if (round === 0) console.log('  typecheck: clean'); break; }
        // attribute each error to the mod whose own line it is
        const blamed = new Map();
        for (const err of errs) {
            const e = files.get(err.file) || files.get([...files.keys()].find(k => k.endsWith(err.file)));
            if (!e) continue;
            const text = e.text.split('\n')[err.line - 1] || '';
            const owner = rows.find(r => r.ops.some(op => op.replace.some(l => l.trim() && l === text)));
            const key = owner ? owner.mod : `${err.file}:${err.line}`;
            if (!blamed.has(key)) blamed.set(key, []);
            blamed.get(key).push(err);
        }
        const victims = rows.filter(r => r.complete && blamed.has(r.mod));
        if (!victims.length) {
            console.log(`  typecheck: ${errs.length} error(s) that no single mod owns — left on the tree for a human:`);
            for (const err of errs.slice(0, 8)) console.log(`    ${err.text.slice(0, 120)}`);
            break;
        }
        for (const row of victims) {
            row.complete = false;
            row.typecheck = blamed.get(row.mod).map(e => e.text);
            revert(row);
            dropped.push(row.mod);
        }
        console.log(`  typecheck round ${round + 1}: ${errs.length} error(s) → dropped ${victims.map(r => r.mod).join(', ')}`);
        writeTree();
    }
}
if (dry) console.log('  (dry run: no typecheck)');
// The tree must land whatever the gate decided — including when it was skipped
// (--partial, --no-tsc, or a tree with no tsc). Without this a skipped gate silently
// wrote nothing, which reads as "the port found nothing to do".
if (!dry) writeTree();

// ---- report -----------------------------------------------------------------
for (const row of rows) {
    const state = row.complete ? 'ported' : partial ? 'PARTIAL (dev)' : 'skipped (incomplete)';
    console.log(`  ${row.complete ? '✓' : '·'} ${row.mod.padEnd(14)} corpus:${row.srcRev}  `
        + `exact:${String(row.exact).padStart(2)} reseated:${String(row.reseated).padStart(2)} already:${row.already} `
        + `unplaced:${row.unplaced.length + row.missingFile.reduce((n, m) => n + m.count, 0)}   ${state}`);
}
const tot = rows.reduce((a, r) => ({
    exact: a.exact + r.exact, reseated: a.reseated + r.reseated, already: a.already + r.already,
    unplaced: a.unplaced + r.unplaced.length + r.missingFile.reduce((n, m) => n + m.count, 0),
}), { exact: 0, reseated: 0, already: 0, unplaced: 0 });
const complete = rows.filter(r => r.complete), incomplete = rows.filter(r => !r.complete);

console.log('');
console.log(`totals: ${tot.exact} re-anchored exactly, ${tot.reseated} reseated, ${tot.already} already applied, ${tot.unplaced} unplaced`);
console.log(`mods: ${complete.length} ported whole${incomplete.length ? `, ${incomplete.length} not portable yet (${incomplete.map(r => r.mod).join(', ')})` : ''}`);
if (dropped.length) console.log(`dropped by the typecheck gate (they re-anchored, then failed to compile here): ${[...new Set(dropped)].join(', ')}`);
if (reverted.size) console.log(`reverted so nothing half-ported lands on the tree: ${[...reverted].join(', ')}`);

if (incomplete.length) {
    console.log('\nnot portable to this revision yet — each needs a human decision:');
    for (const row of incomplete) {
        for (const m of row.missingFile) console.log(`  ${row.mod}  ${m.file}: the file does not exist in ${rev} (${m.count} hunk(s))`);
        for (const t of (row.typecheck || [])) console.log(`  ${row.mod}  does not compile here: ${t.slice(0, 130)}`);
        for (const u of row.unplaced) {
            console.log(`  ${row.mod}  ${u.file}  ${u.note}`);
            console.log(`      anchor: ${JSON.stringify((u.anchor || '').slice(0, 70))}`);
            for (const h of (u.why || [])) console.log(`      ↳ ${h}`);
        }
    }
    console.log('\n  Three kinds of failure, and they want different answers:');
    console.log('    * the hook site MOVED / was rewritten → fix the anchor in the primary corpus so');
    console.log('      it reseats everywhere (or hand-edit this tree and regen a rev-specific hunk)');
    console.log(`    * the code the mod hooks does NOT EXIST in ${rev} → that feature has no`);
    console.log(`      equivalent there; the mod stays unavailable on ${rev} until someone writes it`);
    console.log(`    * it re-anchored but does not COMPILE (a symbol the mod uses is missing or`);
    console.log(`      renamed in ${rev}) → fix the call in this tree, then regen a ${rev}-specific hunk`);
}

if (!dry) {
    console.log('\nnext:');
    console.log(`  1. LCLITE_ROOT=${ROOT} node tools/regen.mjs     # snapshot the ported tree as ${rev}'s corpus`);
    console.log(`  2. LCLITE_ROOT=${ROOT} node tools/lclite.mjs apply --check   # must be ✗0`);
    console.log(`  3. add "${rev}" to revs.json (without \`inherits\`) so the launcher offers the mods there`);
    console.log('  4. node tools/matrix.mjs   # and then build + boot it: mods are only proven when the world runs');
}
