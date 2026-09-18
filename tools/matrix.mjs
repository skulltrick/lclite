#!/usr/bin/env node
// lclite matrix — does every revision this overlay claims to support actually apply?
//
//   node tools/matrix.mjs                       # every revision revs.json declares
//   node tools/matrix.mjs --revs 254,274        # just these
//   node tools/matrix.mjs --json                # machine-readable
//   node tools/matrix.mjs --scratch <dir>       # where the pristine clones live
//   node tools/matrix.mjs --refresh             # re-clone instead of using the cache
//
// This is the answer to "is the corpus still true for every revision?", and it is the
// gate that makes `inherits` in revs.json safe to trust: a revision that inherits the
// primary corpus is only allowed to while EVERY inherited hunk still anchors
// byte-for-byte on that revision's pristine sources. The moment upstream moves code
// inside one of those anchors, this goes red and says which revision needs porting —
// instead of a player finding out by installing it.
//
// It clones each revision's client + engine into a scratch dir (shallow, cached — no
// node_modules, no build), then REPLAYS the whole corpus over the pristine files in
// memory, in the same order `apply` uses, so cross-mod interactions count too. Nothing
// is written outside the scratch cache. Reseating is reported but never counted as a
// pass: a hunk that needs a reseat on its OWN revision means the corpus is stale.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
    LIB_DIR, findMods, loadRevManifest, loadRootManifest, supportedRevs,
    countOccurrences, toLF, reseatFind, corpusRevFor, corporaOnDisk,
} from './lib.mjs';

const args = process.argv.slice(2);
const flag = (name, def = null) => {
    const i = args.indexOf('--' + name);
    if (i < 0) return def;
    const v = args[i + 1];
    return v && !v.startsWith('--') ? v : true;
};
const asJson = !!flag('json', false);
const refresh = !!flag('refresh', false);
const REVS = loadRevManifest(LIB_DIR);
const wanted = typeof flag('revs') === 'string' ? String(flag('revs')).split(/[, ]+/).filter(Boolean) : supportedRevs(REVS);
const SCRATCH = path.resolve(
    (typeof flag('scratch') === 'string' ? flag('scratch') : null)
    || process.env.LCLITE_MATRIX_DIR
    || path.join(process.env.LOCALAPPDATA || process.env.TMPDIR || '/tmp', 'Temp', 'lclite-matrix'),
);

const repos = loadRootManifest(LIB_DIR).repos.filter(r => r.required && r.remote);
// GIT_TERMINAL_PROMPT=0 + GCM_INTERACTIVE=never: a credential helper that decides to
// prompt turns a public clone into a hang or a bogus failure on a machine with Git
// Credential Manager installed, and this runs unattended in CI.
const quiet = (cmd, argv, opts = {}) => execFileSync(cmd, argv, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    ...opts,
});

// ensureTree clones a revision's repos into the scratch cache (shallow). A cached tree
// is reused; --refresh re-clones. A clone failure is reported, never fatal: an offline
// machine should still get the corpora audit below.
function ensureTree(rev) {
    const dir = path.join(SCRATCH, rev);
    const problems = [];
    for (const r of repos) {
        const dst = path.join(dir, r.dir);
        const ok = () => fs.existsSync(path.join(dst, '.git'));
        if (ok() && !refresh) continue;
        try {
            fs.rmSync(dst, { recursive: true, force: true });
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            quiet('git', ['clone', '--quiet', '--depth', '1', '--branch', rev, r.remote, dst]);
        } catch (e) {
            problems.push(`${r.dir}: ${String(e.stderr || e.message).trim().split('\n').pop()}`);
        }
    }
    return { dir, problems, ok: problems.length === 0 };
}

// replay applies a revision's whole corpus to its pristine tree, in memory, in the
// order `apply` does (mod by mod, patch file by patch file) — including the idempotency
// and uniqueness rules. Returns per-mod counts.
function replay(rev, treeDir) {
    const mods = findMods(LIB_DIR, rev);
    const files = new Map();       // rel path -> { text, hadCRLF }
    const read = (rel) => {
        if (files.has(rel)) return files.get(rel);
        const abs = path.join(treeDir, rel);
        if (!fs.existsSync(abs)) { files.set(rel, null); return null; }
        const raw = fs.readFileSync(abs, 'utf-8');
        const e = { text: toLF(raw), hadCRLF: raw.includes('\r\n') };
        files.set(rel, e);
        return e;
    };
    const rows = [];
    for (const mod of mods) {
        const from = corpusRevFor(REVS, mod.dir, rev);
        const row = { mod: mod.name, corpus: from, hunks: 0, exact: 0, already: 0, reseat: 0, unplaced: [], missingFile: [] };
        for (const patch of mod.patches) {
            const e = read(patch.file);
            if (!e) {
                for (const h of patch.hunks) { row.hunks++; row.missingFile.push({ note: h.note, anchor: h.find[0] || '' }); }
                continue;
            }
            for (const h of patch.hunks) {
                row.hunks++;
                const find = h.find.join('\n');
                const rep = h.replace.join('\n');
                if (countOccurrences(e.text, rep) >= 1) { row.already++; continue; }
                if (countOccurrences(e.text, find) === 1) { e.text = e.text.replace(find, () => rep); row.exact++; continue; }
                const r = reseatFind(e.text, h.find, h.replace);
                if (r) { e.text = e.text.replace(r.find.join('\n'), () => r.replace.join('\n')); row.reseat++; continue; }
                row.unplaced.push({ file: patch.file, note: h.note, anchor: h.find[0] || '' });
            }
        }
        rows.push(row);
    }
    return rows;
}

console.log(`lclite matrix — ${LIB_DIR}`);
console.log(`revisions: ${wanted.join(', ')}   scratch: ${SCRATCH}`);
console.log('');
if (!fs.existsSync(SCRATCH)) fs.mkdirSync(SCRATCH, { recursive: true });

const report = { primary: REVS.primary, scratch: SCRATCH, revs: {}, issues: [], ok: true };
let anyRed = false;

for (const rev of wanted) {
    const declared = supportedRevs(REVS).includes(rev);
    const inherits = REVS.supported[rev]?.inherits || null;
    const tree = ensureTree(rev);
    if (!tree.ok) {
        report.revs[rev] = { cloneError: tree.problems.join('; ') };
        console.log(`  ${rev.padEnd(6)} !! could not get pristine sources: ${tree.problems.join('; ')}`);
        continue;
    }
    const rows = replay(rev, tree.dir);
    const tot = rows.reduce((a, r) => ({
        hunks: a.hunks + r.hunks, exact: a.exact + r.exact, already: a.already + r.already,
        reseat: a.reseat + r.reseat, unplaced: a.unplaced + r.unplaced.length, missingFile: a.missingFile + r.missingFile.length,
    }), { hunks: 0, exact: 0, already: 0, reseat: 0, unplaced: 0, missingFile: 0 });

    // What "green" means depends on where the corpus came from, and that difference is
    // the whole point of the matrix:
    //   inherited corpus → EVERY hunk must still anchor byte-for-byte (a reseat here
    //                      means the inheritance claim has expired)
    //   own corpus       → every hunk must anchor byte-for-byte on ITS OWN revision
    //                      (a reseat here means the corpus is stale vs that branch)
    const clean = tot.reseat === 0 && tot.unplaced === 0 && tot.missingFile === 0;
    const verdict = clean ? 'green' : inherits ? 'INHERITANCE EXPIRED' : 'STALE CORPUS';
    if (!clean) anyRed = true;
    // how the revision gets its hunks: inherited, its own corpus, or (nothing ported yet)
    // a corpus of its own that is still empty
    const own = rows.some(r => r.corpus === rev);
    const how = inherits ? `inherits ${inherits}` : own ? 'own corpus' : 'nothing ported';
    report.revs[rev] = {
        declared, inherits, ownCorpus: own, verdict, ...tot,
        mods: rows.map(r => ({ mod: r.mod, corpus: r.corpus, hunks: r.hunks, exact: r.exact, already: r.already, reseat: r.reseat, unplaced: r.unplaced.length, missingFile: r.missingFile.length })),
        details: rows.filter(r => r.reseat || r.unplaced.length || r.missingFile.length)
            .map(r => ({ mod: r.mod, reseat: r.reseat, unplaced: r.unplaced, missingFile: r.missingFile })),
    };
    console.log(`  ${rev.padEnd(6)} ${how.padEnd(16)} `
        + `${String(tot.hunks).padStart(4)} hunks · exact ${tot.exact} · already ${tot.already} · reseat ${tot.reseat} · unplaced ${tot.unplaced} · missing file ${tot.missingFile}   ${clean ? '✓' : '✗'} ${verdict}`);
    for (const d of report.revs[rev].details) {
        if (d.reseat) console.log(`         ${d.mod}: ${d.reseat} hunk(s) would need reseating — this revision has moved`);
        for (const u of d.unplaced.slice(0, 4)) console.log(`         ${d.mod} ${u.file}: UNPLACED ${u.note}`);
        if (d.unplaced.length > 4) console.log(`         ${d.mod}: +${d.unplaced.length - 4} more unplaced`);
        for (const m of d.missingFile.slice(0, 3)) console.log(`         ${d.mod}: file missing in this revision — ${m.note}`);
    }
    if (!declared) { report.issues.push(`${rev} has a corpus but revs.json does not declare it`); anyRed = true; }
}

console.log('');
if (anyRed) {
    console.log('  A red revision is not broken code — it is a corpus that needs attention:');
    console.log('    own corpus, stale     → LCLITE_ROOT=<that install> node tools/port.mjs <rev>');
    console.log('                            then regen, then apply --check');
    console.log('    inheritance expired   → port it, so it gets a corpus of its own, or fix the');
    console.log('                            primary corpus if the drift is upstream\'s');
}
report.ok = !anyRed;
if (asJson) console.log(JSON.stringify(report, null, 1));
else console.log(anyRed ? '  ✗ at least one declared revision does not apply cleanly' : '  ✓ every declared revision applies cleanly');
process.exitCode = anyRed ? 2 : 0;
