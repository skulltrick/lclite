#!/usr/bin/env node
// lclite install — apply the mod overlay onto clean upstream repos, then build + deploy.
//
//   node lclite/install.mjs apply          # patch upstreams in place (idempotent)
//   node lclite/install.mjs apply --check  # dry-run: report what would apply/fail
//   node lclite/install.mjs build          # bun bundle webclient -> engine/public/client/client.js
//   node lclite/install.mjs                # apply then build
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MODS_DIR = path.join(__dirname, 'mods');

const BUN = process.env.LCLITE_BUN || findBun();
function findBun() {
    const cands = [
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp/bunx/bun-windows-x64/bun.exe') : '',
        'bun',
        path.join(process.env.HOME || '', '.bun/bin/bun')
    ];
    for (const c of cands) { try { if (c && fs.existsSync(c)) return c; } catch {} }
    return 'bun';
}

function toLF(s) { return s.replace(/\r\n/g, '\n'); }
function restoreEOL(s, hadCRLF) { return hadCRLF ? s.replace(/\n/g, '\r\n') : s; }
function countOccurrences(haystack, needle) {
    if (!needle) return 0;
    let n = 0, i = 0;
    while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
    return n;
}

function loadMods() {
    const mods = [];
    if (!fs.existsSync(MODS_DIR)) return mods;
    for (const name of fs.readdirSync(MODS_DIR)) {
        const dir = path.join(MODS_DIR, name);
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
    return mods;
}

// returns {applied, already, failed:[{note, find0, reason}]}
function applyPatchFile(patch, checkOnly) {
    const abs = path.join(ROOT, patch.file);
    const res = { file: patch.file, applied: 0, already: 0, failed: [] };
    if (!fs.existsSync(abs)) {
        res.failed.push({ note: 'file missing', find0: '', reason: `${patch.file} does not exist — wrong rev? clone it first.` });
        return res;
    }
    const raw = fs.readFileSync(abs, 'utf-8');
    const hadCRLF = raw.includes('\r\n');
    let text = toLF(raw);

    for (const h of patch.hunks) {
        const find = h.find.join('\n');
        const rep = h.replace.join('\n');
        // Idempotency: skip whenever the replacement content is already in the file.
        // (We deliberately do NOT require find to be absent — a replacement can contain
        // its own context lines as a substring, and stale find hits caused a double-apply
        // corruption in an earlier version of this tool.)
        if (countOccurrences(text, rep) >= 1) { res.already++; continue; }
        const n = countOccurrences(text, find);
        if (n === 0) { res.failed.push({ note: h.note || '', find0: h.find[0] || '', reason: 'anchor not found (upstream drifted or rev mismatch)' }); continue; }
        if (n > 1) { res.failed.push({ note: h.note || '', find0: h.find[0] || '', reason: `anchor ambiguous (${n} matches)` }); continue; }
        // Stale-JSON guard: rep isn't verbatim in the tree, yet the region right after
        // (or inside) the anchor already contains a run of this hunk's added lines =>
        // the mod IS present, hand-edited inside the replacement region. Re-inserting
        // would duplicate the block (the TS2300 incident). Count as already; regen fixes.
        // (Sample several added lines, not just the first two: hand-edits often rewrite
        // exactly the leading comment lines, which let a 2-line probe slip through.)
        {
            const added = h.replace.filter(l => l.trim()).filter(l => !h.find.includes(l));
            // only count distinctive (long enough) added lines — short ones like "}"
            // occur everywhere upstream and would false-positive the guard
            const sample = added.filter(l => l.trim().length >= 12).slice(0, 12);
            const need = Math.max(2, Math.ceil(sample.length * 0.5));
            if (sample.length >= 2) {
                let idx = text.indexOf(find);
                while (idx !== -1) {
                    const window = text.slice(idx, idx + find.length + 800);
                    const hits = sample.filter(l => window.includes(l)).length;
                    if (hits >= need) {
                        res.already++;
                        res.warned = (res.warned || 0) + 1;
                        idx = -2; // found
                        break;
                    }
                    idx = text.indexOf(find, idx + 1);
                }
                if (idx === -2) continue;
            }
        }
        if (!checkOnly) text = text.replace(find, () => rep);
        res.applied++;
    }
    if (!checkOnly) fs.writeFileSync(abs, restoreEOL(text, hadCRLF));
    return res;
}

function copyModFiles(mod) {
    const out = [];
    const fdir = path.join(mod.dir, 'files');
    if (!fs.existsSync(fdir)) return out;
    const walk = d => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else {
                const rel = path.relative(fdir, p).replace(/\\/g, '/');
                const dst = path.join(ROOT, rel);
                fs.mkdirSync(path.dirname(dst), { recursive: true });
                fs.copyFileSync(p, dst);
                out.push(rel);
            }
        }
    };
    walk(fdir);
    return out;
}

function run(cmd, opts = {}) {
    console.log(`$ ${cmd}`);
    return execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function build() {
    const wc = path.join(ROOT, 'webclient');
    if (!fs.existsSync(wc)) { console.error('no webclient dir'); process.exit(1); }
    const out = execSync(`"${BUN}" run bundle.ts`, { cwd: wc, encoding: 'utf-8', stdio: 'pipe' }).toString();
    if (out.trim()) console.log(out);
    const src = path.join(wc, 'out/client.js');
    const dst = path.join(ROOT, 'engine/public/client/client.js');
    fs.copyFileSync(src, dst);
    for (const ext of ['.map']) {
        try { fs.copyFileSync(src + ext, dst + ext); } catch {}
    }
    console.log('built + deployed client.js');
}

function main() {
    const args = process.argv.slice(2);
    const doApply = args.length === 0 || args.includes('apply');
    const doBuild = args.length === 0 || args.includes('build');
    const check = args.includes('--check');

    if (doApply) {
        const mods = loadMods();
        let fails = 0;
        for (const mod of mods) {
            let tA = 0, tL = 0, tF = 0;
            for (const patch of mod.patches) {
                const r = applyPatchFile(patch, check);
                tA += r.applied; tL += r.already; tF += r.failed.length;
                for (const f of r.failed) {
                    fails++;
                    console.log(`  ✗ [${mod.name}] ${patch.file}: ${f.reason}\n      anchor: ${JSON.stringify((f.find0 || '').slice(0, 80))}  (${f.note})`);
                }
            }
            const copied = check ? [] : copyModFiles(mod);
            console.log(`${check ? 'would apply' : 'applied'} [${mod.name}]  +${tA} ~${tL} ✗${tF}${copied.length ? `  files:${copied.length}` : ''}`);
        }
        if (fails) {
            console.log(`\n${fails} hunk(s) need reseating for this rev. Anchors carry 3 lines of context each side — adjust the JSON in lclite/mods/*/patches, then rerun.`);
            process.exitCode = 2;
        }
    }
    if (doBuild) build();
}

main();
