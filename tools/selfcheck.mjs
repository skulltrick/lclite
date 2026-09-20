#!/usr/bin/env node
// lclite selfcheck — the DROP-IN CONTRACT, asserted. No deps, no tree required.
//
//   node tools/selfcheck.mjs          # exit 0 = the contract holds, 1 = it does not
//
// Everything else in tools/ answers "is the overlay healthy against this tree?".
// This answers the one question an author asks first: "if I drop a folder into mods/,
// does it become a mod?" — and it pins the answers so they cannot drift apart between
// the CLI, the launcher (which has its own Go copy of the rule), acceptance.sh, and
// the layout example that `lclite.mjs new` hands to every new author.
//
//   1. `mods/_*` and `mods/.*` are NOT mods. That is the whole reason mods/_template
//      can live in the repo without showing up in a player's mod list, being applied
//      by a bare `apply`, being audited as a corpus, or being byte-compared.
//   2. A mod is discovered from disk alone: hunks and/or a files/ payload, with the
//      README's first line as the description until MOD_META has an entry.
//   3. The layout example is complete and still ANCHORS on the pinned tree — it is
//      what `new` copies, so a rotten template hands every new author a broken first
//      mod. (Checked when a host tree is reachable; a missing tree is a note.)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { LIB_DIR, findMods, isModDir, payloadFiles, readmeSummary, countOccurrences, toLF, loadRevManifest } from './lib.mjs';

const ROOT = path.resolve(process.env.LCLITE_ROOT || path.join(LIB_DIR, '..'));
const MARKER = /lclite:([a-z][a-z0-9-]*)/;
const TEMPLATE = path.join(LIB_DIR, 'mods', '_template');
const TEMPLATE_ID = 'example-mod';
const PRIMARY = loadRevManifest(LIB_DIR).primary;
const mods = findMods(LIB_DIR, PRIMARY);        // every real mod, for the hook-site clash check

let failed = 0;
const check = (name, cond, detail = '') => {
    if (cond) { console.log(`  ✓ ${name}`); return; }
    failed++;
    console.log(`  ✗ ${name}`);
    if (detail) console.log(`      ${detail}`);
};

console.log(`lclite selfcheck — ${LIB_DIR}`);
console.log(`  (host tree: ${ROOT}${fs.existsSync(path.join(ROOT, 'webclient')) ? '' : ' — not present'})`);
console.log('');

// ---- 1. the folder rule ------------------------------------------------------
console.log('mods/ folder rule');
check('a normal folder is a mod', isModDir('camera'));
check('`_`-prefixed folders are not mods (the template lives there)', !isModDir('_template'));
check('`.`-prefixed folders are not mods (scratch, editor droppings)', !isModDir('.scratch'));
{
    const names = mods.map(m => m.name);
    check('findMods skips `_`/`.` folders in the real mods/',
        !names.some(n => n.startsWith('_') || n.startsWith('.')),
        `findMods returned: ${names.join(', ')}`);
    check('mods/_template is NOT one of them', !names.includes('_template'));
}

// ---- 2. discovery from disk alone -------------------------------------------
console.log('');
console.log('discovery (a synthetic overlay: hunks and/or payload, no MOD_META entry)');
{
    const tmp = fs.mkdtempSync(path.join(process.env.LOCALAPPDATA || process.env.TMPDIR || '/tmp', 'lclite-selfcheck-'));
    const w = (rel, body) => { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), body); };
    w('revs.json', JSON.stringify({ primary: '289', supported: { 289: {} } }));
    w('mods/with-hunks/patches/289/Client_ts.json', JSON.stringify({ file: 'webclient/src/client/Client.ts', hunks: [] }));
    w('mods/payload-only/files/engine/public/lclite/payload-only/ui.js', '// x\n');
    w('mods/payload-only/README.md', '# payload-only\n\nA payload with no hunks.\n');
    w('mods/empty/README.md', 'delivers nothing\n');
    w('mods/_template/README.md', 'not a mod\n');
    const mods = findMods(tmp, '289');
    const by = Object.fromEntries(mods.map(m => [m.name, m]));
    check('only real folders are mods', mods.length === 3, `got ${mods.map(m => m.name).join(', ')}`);
    check('a hunks-only mod has no payload', by['with-hunks']?.hasPayload === false);
    check('a payload-only mod is discovered and flagged', by['payload-only']?.hasPayload === true && by['payload-only']?.missingCorpus === true);
    check('a folder with neither lane is not installable', by['empty']?.missingCorpus === true && by['empty']?.hasPayload === false);
    check('payloadFiles lists host-root-relative paths',
        JSON.stringify(payloadFiles(path.join(tmp, 'mods', 'payload-only'))) === JSON.stringify(['engine/public/lclite/payload-only/ui.js']),
        JSON.stringify(payloadFiles(path.join(tmp, 'mods', 'payload-only'))));
    check('the README is the fallback description',
        readmeSummary(path.join(tmp, 'mods', 'payload-only')) === 'A payload with no hunks.',
        JSON.stringify(readmeSummary(path.join(tmp, 'mods', 'payload-only'))));
    fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- 3. the layout example is complete, and still anchors -------------------
console.log('');
console.log('layout example (mods/_template — what `node tools/lclite.mjs new <name>` copies)');
if (!fs.existsSync(TEMPLATE)) {
    check('mods/_template exists', false, 'missing — `new` has nothing to copy (git checkout -- mods/_template)');
} else {
    check('it has a README', fs.existsSync(path.join(TEMPLATE, 'README.md')));
    const payload = payloadFiles(TEMPLATE);
    check('it ships a files/ payload', payload.length > 0);
    const corpora = fs.existsSync(path.join(TEMPLATE, 'patches'))
        ? fs.readdirSync(path.join(TEMPLATE, 'patches')).filter(d => fs.statSync(path.join(TEMPLATE, 'patches', d)).isDirectory())
        : [];
    check('it ships at least one corpus', corpora.length > 0, 'mods/_template/patches/<rev>/ is empty');
    check('every payload path carries the example id', payload.every(p => p.includes(TEMPLATE_ID)), payload.join(', '));

    let anchorsChecked = 0;
    for (const rev of corpora) {
        for (const f of fs.readdirSync(path.join(TEMPLATE, 'patches', rev)).filter(x => x.endsWith('.json'))) {
            const patch = JSON.parse(fs.readFileSync(path.join(TEMPLATE, 'patches', rev, f), 'utf-8'));
            check(`${rev}/${f} targets ${patch.file}`, typeof patch.file === 'string' && patch.file.includes('/'));
            check(`${rev}/${f} declares the id it is filed under`, patch.mod === TEMPLATE_ID, `mod = ${patch.mod}`);
            for (const h of patch.hunks) {
                const added = h.replace.filter(l => !h.find.includes(l));
                check(`${rev}/${f} @${h.note || '?'}: every added block carries a marker`,
                    added.some(l => (l.match(MARKER) || [])[1] === TEMPLATE_ID));
                check(`${rev}/${f} @${h.note || '?'}: the note carries the pristine line`,
                    /@ old line \d+/.test(h.note || ''), 'regen writes this; doctor reads it');
                const abs = path.join(ROOT, patch.file);
                if (!fs.existsSync(abs)) continue;
                // PRISTINE upstream, never the working tree: hunks anchor on upstream
                // code, and a host tree is normally modded (that is the whole point).
                // `git show HEAD:<file>` is the same text regen generated the anchors
                // from; a tree with no git (or a file the branch does not have) is a
                // note, not a failure.
                let text = null;
                try {
                    const repo = patch.file.split('/')[0];
                    const rel = patch.file.slice(repo.length + 1);
                    text = toLF(execSync(`git -C "${path.join(ROOT, repo)}" show HEAD:"${rel}"`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }));
                } catch { /* no git here, or no such file at HEAD */ }
                if (text === null) {
                    const raw = fs.readFileSync(abs, 'utf-8');
                    if (!/lclite:/.test(raw)) text = toLF(raw);      // unmodded tree: good enough
                }
                if (text === null) {
                    console.log(`  — ${patch.file}: no pristine copy to check against (no git in ${ROOT})`);
                    continue;
                }
                const find = h.find.join('\n');
                check(`${rev}/${f} @${h.note || '?'}: the anchor is unique in pristine ${patch.file}`, countOccurrences(text, find) === 1,
                    `${countOccurrences(text, find)} match(es) — reseat find[] against the pinned ${patch.file}, then copy it back into the template`);
                check(`${rev}/${f} @${h.note || '?'}: the example is not already applied there`, countOccurrences(text, h.replace.join('\n')) === 0);
                // ...and it must ALSO match a tree that already has the other mods applied:
                // `apply` runs against a modded working tree, so an anchor another mod's
                // insertion splits works on a pristine clone and fails in every real
                // install (that is how this example was first written, and how it was
                // caught: the launcher's apply failed on a live install).
                const live = toLF(fs.readFileSync(abs, 'utf-8'));
                check(`${rev}/${f} @${h.note || '?'}: the anchor survives the other mods being applied`,
                    countOccurrences(live, find) === 1,
                    `${countOccurrences(live, find)} match(es) in the working tree — another mod's insertion probably splits this window`);
                // two mods inserting into the SAME gap become one diff island, and regen
                // then routes the whole island to one of them (MIXED MARKERS)
                if (h.pos) {
                    const clash = [];
                    for (const other of mods) {
                        for (const op of other.patches) {
                            if (op.file !== patch.file) continue;
                            for (const oh of op.hunks) {
                                if (!oh.pos) continue;
                                if (oh.pos[0] === h.pos[0]) clash.push(`${other.name} inserts at the same gap (pos[0]=${oh.pos[0]})`);
                                else if (h.pos[0] >= oh.pos[2] && h.pos[0] <= oh.pos[3]) clash.push(`${other.name} owns window ${oh.pos[2]}..${oh.pos[3]}`);
                            }
                        }
                    }
                    check(`${rev}/${f} @${h.note || '?'}: no other mod uses this hook site`, clash.length === 0, clash.join('; '));
                }
                anchorsChecked++;
            }
        }
    }
    if (!anchorsChecked) console.log(`  — no host tree, so the template's anchors were not re-checked here`);
}

console.log('');
console.log(failed ? `  ✗ ${failed} check(s) failed` : '  ✔ the drop-in contract holds');
process.exitCode = failed ? 1 : 0;
