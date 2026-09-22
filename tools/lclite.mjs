#!/usr/bin/env node
// lclite install — apply the mod overlay onto clean upstream repos, then build + deploy.
// Run from this folder (lclite/ inside a Lost City checkout):
//
//   node tools/lclite.mjs                     # in a terminal: picker, then apply + build;
//                                        # piped/CI (no TTY): apply ALL mods + build
//   node tools/lclite.mjs apply               # apply ALL mods, no build (script-safe)
//   node tools/lclite.mjs --mods camera,xp-drops   # desired set: apply these, strip the others
//   node tools/lclite.mjs apply --check       # dry-run report (no writes)
//   node tools/lclite.mjs build               # bun bundle + deploy client.js only
//   node tools/lclite.mjs uninstall           # strip every mod back toward pristine
//   node tools/lclite.mjs pick                # picker only (what install.bat drives)
//   node tools/lclite.mjs list                # machine-readable: name|installed|label|desc
//
// apply/uninstall are idempotent and always converge the tree to the DESIRED set:
// selected mods get their hunks applied, deselected mods get their hunks stripped
// (find/replace reversed) and their copied files removed.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LIB_DIR, meta, findMods, countOccurrences, toLF, restoreEOL, stripPatchFile, loadRootManifest, loadRevManifest, supportedRevs, hostRev, payloadFiles, readmeSummary } from './lib.mjs';

const __dirname = LIB_DIR;                       // lclite/ root (overlay)
const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));   // <overlay>/tools/
// The Lost City root that holds webclient/ + engine/. Normally one level up
// from lclite/; LCLITE_ROOT points the installer at a different install
// (used by the t/ acceptance harness and by anyone keeping the overlay
// separate from the game folder).
const ROOT = path.resolve(process.env.LCLITE_ROOT || path.join(__dirname, '..'));

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

// ---- the revision target ----------------------------------------------------
// Everything below applies ONE revision's corpus to the tree at ROOT. Which
// revision that is comes from --rev, or from the tree's own branch, and it must be
// one revs.json declares — applying 289's hunks to a 254 tree "mostly working" is
// exactly the silent breakage the declaration exists to prevent.
const REVS = loadRevManifest(__dirname);
const REV_NAMES = supportedRevs(REVS);

function resolveRev(args) {
    const explicit = args.includes('--rev') ? args[args.indexOf('--rev') + 1] : null;
    const rev = explicit || hostRev(ROOT) || REVS.primary;
    if (!REV_NAMES.includes(rev)) {
        console.error(`!! revision "${rev}" is not one this overlay supports (${REV_NAMES.join(', ')})`);
        console.error(`   revs.json lists the supported revisions; add it there (and port the hunks:`);
        console.error(`   node tools/port.mjs ${rev}) before installing the overlay on it.`);
        process.exit(4);
    }
    return rev;
}

// ---- reseat assist (B4) ------------------------------------------------------
// When an anchor fails, don't just say "not found": fuzzy-locate its most
// distinctive lines in the current file and print WHERE they went. Rev-day
// reseating = read the line number, open the file there, fix find[], done.
function reseatHints(text, find) {
    const lines = text.split('\n');
    const probe = find.map(l => l.trim()).filter(l => l.length >= 20);
    probe.sort((a, b) => b.length - a.length);
    const out = [];
    for (const p of probe.slice(0, 3)) {
        const hit = lines.findIndex(l => l.trim() === p);
        if (hit >= 0) { out.push(`"${p.slice(0, 60)}..." now at line ${hit + 1}`); continue; }
        // relaxed: substring / whitespace-collapse match
        const rx = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\s+/g, '\\s*').slice(0, 180));
        const hit2 = lines.findIndex(l => rx.test(l));
        if (hit2 >= 0) out.push(`"${p.slice(0, 60)}..." ~ line ${hit2 + 1} (whitespace changed)`);
        else out.push(`"${p.slice(0, 60)}..." NOT found in file — likely renamed/removed upstream`);
    }
    return out;
}

// ---- apply (verbatim semantics of the original tool) ------------------------
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
        if (n === 0) { res.failed.push({ note: h.note || '', find0: h.find[0] || '', hints: reseatHints(text, h.find), reason: 'anchor not found (upstream drifted or rev mismatch)' }); continue; }
        if (n > 1) { res.failed.push({ note: h.note || '', find0: h.find[0] || '', hints: [], reason: `anchor ambiguous (${n} matches)` }); continue; }
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

// Remove a deselected mod's copied files — only when the tree copy still
// matches the overlay byte-for-byte (never clobber someone's hand edits) — and
// then prune the directories the payload created, so a strip really is the inverse
// of an apply instead of leaving empty `engine/public/lclite/<mod>/` folders behind.
function removeModFiles(mod) {
    const out = [];
    const fdir = path.join(mod.dir, 'files');
    if (!fs.existsSync(fdir)) return out;
    const dirs = new Set();
    const walk = d => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { walk(p); dirs.add(path.join(ROOT, path.relative(fdir, p))); }
            else {
                const rel = path.relative(fdir, p).replace(/\\/g, '/');
                const dst = path.join(ROOT, rel);
                if (!fs.existsSync(dst)) continue;
                const same = fs.readFileSync(dst).equals(fs.readFileSync(p));
                if (same) { fs.rmSync(dst); out.push(rel); }
                else console.log(`  ! kept ${rel} (edited in-tree, not identical to overlay)`);
            }
        }
    };
    walk(fdir);
    // deepest first; a directory that still holds anything (another mod's payload, a
    // file the user put there) is not empty and simply stays
    for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
        try { fs.rmdirSync(d); } catch { /* not empty, or already gone */ }
    }
    return out;
}

// ---- installed-state detection ----------------------------------------------
// A mod counts as installed when EVERYTHING it delivers is in the tree: every one
// of its hunks verbatim present (the same test apply uses for "already") and every
// file of its files/ payload copied. Anything else => strip then apply.
//
// A mod with NO hunks at all is still a mod when it ships a payload — that is the
// files/-only shape, and its payload is the whole of what it delivers. Requiring a
// hunk would make such a mod permanently "off": never in installed.json, never in
// the F1 panel's list, and never counted by `apply` as applied.
function modInstalled(mod) {
    let hunks = 0;
    for (const patch of mod.patches) {
        const abs = path.join(ROOT, patch.file);
        if (!fs.existsSync(abs)) return false;
        const text = toLF(fs.readFileSync(abs, 'utf-8'));
        for (const h of patch.hunks) {
            hunks++;
            if (countOccurrences(text, h.replace.join('\n')) < 1) return false;
        }
    }
    const payload = payloadFiles(mod.dir);
    if (!hunks) return payload.length > 0 && payload.every(rel => fs.existsSync(path.join(ROOT, rel)));
    return payload.every(rel => fs.existsSync(path.join(ROOT, rel)));
}

function buildManifest(mods) {
    const installed = mods.filter(m => { try { return modInstalled(m); } catch { return false; } }).map(m => m.name);
    const dst = path.join(ROOT, 'engine/public/lclite/installed.json');
    if (fs.existsSync(path.join(ROOT, 'engine'))) {
        if (installed.length) {
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.writeFileSync(dst, JSON.stringify({ mods: installed, page: true }, null, 1) + '\n');
        } else {
            try { fs.rmSync(dst); } catch { }     // full uninstall: no stale manifest
        }
    }
    return installed;
}

// ---- preflight ---------------------------------------------------------------
// Which sibling repos must exist comes from root.json (C1) so the overlay can
// target any 2004Scape-lineage client/server combo, not just Lost City.
function preflight() {
    const problems = [];
    const manifest = loadRootManifest(__dirname);
    const required = manifest.repos.filter(r => r.required);
    const missing = required.filter(r => !fs.existsSync(path.join(ROOT, r.dir)));
    if (!missing.length) return problems;

    if (missing.length === required.length) {
        // The normal shape since the launcher landed: this repo is the overlay on
        // its own, and installs live in the launcher's data folder.
        problems.push(`no Lost City checkout at ${ROOT} — this is the overlay on its own.`);
        problems.push(`  Run LCLite.exe to install a revision (it keeps them under its data folder),`);
        problems.push(`  or aim these tools at one that already exists:`);
        problems.push(`  LCLITE_ROOT=<install folder> node tools/lclite.mjs ${process.argv.slice(2).join(' ') || 'list'}`);
        return problems;
    }
    for (const repo of missing) {
        problems.push(`${repo.dir}/ not found at ${ROOT}${repo.remote ? ` — clone it from ${repo.remote}` : ''}`);
    }
    return problems;
}

function ensureBun() {
    try { execSync(`"${BUN}" --version`, { stdio: 'ignore' }); return true; } catch { }
    console.log('\nbun was not found — needed to build the webclient bundle.');
    console.log('  Windows/macOS/Linux:  powershell -c "irm bun.sh/install.ps1|iex"   (or: curl -fsSL https://bun.sh/install | bash)');
    console.log('  ...then reopen the terminal, or set LCLITE_BUN=<path to bun(.exe)> and rerun.');
    return false;
}

function build() {
    const wc = path.join(ROOT, 'webclient');
    if (!fs.existsSync(wc)) { console.error('no webclient dir'); process.exit(1); }
    if (!ensureBun()) { console.log('skipping build — run "LCLITE_ROOT=<install> node tools/lclite.mjs build" once bun is installed.'); return false; }
    if (!fs.existsSync(path.join(wc, 'node_modules'))) {
        console.log('webclient/node_modules missing — installing build deps (bun install)...');
        try { execSync(`"${BUN}" install`, { cwd: wc, stdio: 'inherit' }); }
        catch { console.log('!! bun install failed — rerun "LCLITE_ROOT=<install> node tools/lclite.mjs build" manually (network? bun version?).'); return false; }
    }
    const out = execSync(`"${BUN}" run bundle.ts`, { cwd: wc, encoding: 'utf-8', stdio: 'pipe' }).toString();
    if (out.trim()) console.log(out);
    const src = path.join(wc, 'out/client.js');
    const dst = path.join(ROOT, 'engine/public/client/client.js');
    fs.copyFileSync(src, dst);
    for (const ext of ['.map']) {
        try { fs.copyFileSync(src + ext, dst + ext); } catch {}
    }
    console.log('built + deployed client.js');

    // ---- the extra assets mods serve themselves --------------------------------
    // `bun run bundle.ts` also builds the world map app (src/mapview/MapView.ts is one
    // of its entrypoints), but nothing upstream ever deploys it — the engine serves
    // only public/, and public/client/ has always carried client.js alone. The
    // world-map mod's page loads it from /lclite/worldmap/mapview.js, so deploy it
    // there (the overlay's own folder, next to the panel assets apply copies).
    //
    // The world map's DATA is the engine's own packed jag. Its route (/worldmap.jag) is
    // registered inside `if (Environment.node.debug)`, so a live world 404s it; the
    // copy at /client/worldmap.jag is a plain static file every world serves — and the
    // launcher's join bridge serves /client/* from the LOCAL install, which is what
    // makes the map work on somebody else's world too. Each piece is optional: a tree
    // with no world map app (an older webclient) just skips it.
    const wmSrc = path.join(wc, 'out/mapview.js');
    if (fs.existsSync(wmSrc)) {
        const wmDst = path.join(ROOT, 'engine/public/lclite/worldmap/mapview.js');
        fs.mkdirSync(path.dirname(wmDst), { recursive: true });
        fs.copyFileSync(wmSrc, wmDst);
        try { fs.copyFileSync(wmSrc + '.map', wmDst + '.map'); } catch {}
        console.log('built + deployed lclite/worldmap/mapview.js');
    } else {
        console.log('note: no out/mapview.js — the world-map mod will report a missing map app');
    }

    const jagSrc = path.join(ROOT, 'engine/data/pack/mapview/worldmap.jag');
    if (fs.existsSync(jagSrc)) {
        const jagDst = path.join(ROOT, 'engine/public/client/worldmap.jag');
        fs.copyFileSync(jagSrc, jagDst);
        console.log('deployed the packed world map data to client/worldmap.jag');
    } else {
        console.log('note: no engine/data/pack/mapview/worldmap.jag yet — the world map needs one packed map (npm run build in engine/)');
    }

    return true;
}

// ---- the converge engine: apply desired set, strip the rest ------------------
function converge(mods, want, check, rev) {
    let fails = 0, changed = 0, skipped = [];
    for (const mod of mods) {
        const m = meta(mod.name);
        // A mod with no corpus for this revision (and nothing to inherit) has no
        // hunks to apply OR to strip. That is only a reason to skip it when it has
        // no files/ payload either — a files/-only mod delivers its payload on every
        // revision, and skipping it would make a dropped-in mod silently uninstallable.
        if (mod.missingCorpus && !mod.hasPayload) { skipped.push(mod.name); continue; }
        if (want[mod.name]) {
            let tA = 0, tL = 0, tF = 0;
            for (const patch of mod.patches) {
                const r = applyPatchFile(patch, check);
                tA += r.applied; tL += r.already; tF += r.failed.length;
                changed ||= r.applied > 0;
                for (const f of r.failed) {
                    fails++;
                    console.log(`  ✗ [${mod.name}] ${patch.file}: ${f.reason}\n      anchor: ${JSON.stringify((f.find0 || '').slice(0, 80))}  (${f.note})`);
                    for (const hint of (f.hints || [])) console.log(`      ↳ ${hint}`);
                }
            }
            const copied = check ? [] : copyModFiles(mod);
            if (!check && copied.length) changed = true;
            const src = mod.inherited ? ` (corpus ${mod.corpusRev})` : '';
            console.log(`${check ? 'would apply' : 'applied'} [${mod.name}]  +${tA} ~${tL} ✗${tF}${copied.length ? `  files:${copied.length}` : ''}${src}${m.required ? '  (required)' : ''}`);
        } else {
            let tR = 0, tC = 0, tS = 0;
            for (const patch of mod.patches) {
                const r = stripPatchFile(path.join(ROOT, patch.file), patch, check);
                tR += r.removed; tC += r.clean; tS += r.stuck.length;
                changed ||= r.removed > 0;
                for (const s of r.stuck) {
                    fails++;
                    console.log(`  ✗ [${mod.name}] ${patch.file}: ${s.reason} — hand-fix by restoring the original lines (${s.note})`);
                }
            }
            if (!check) { const removed = removeModFiles(mod); if (removed.length) changed = true; }
            console.log(`${check ? 'would strip' : 'stripped'} [${mod.name}]  -${tR} ~${tC} ✗${tS}`);
        }
    }
    if (skipped.length) {
        console.log(`  — not a mod on ${rev} (no hunks and no files/ payload): ${skipped.join(', ')} (see revs.json / tools/port.mjs)`);
    }
    return { fails, changed, skipped };
}

// ---- interactive picker -------------------------------------------------------
// Input is collected into a queue ourselves: rl.question() drops lines that
// arrive between prompts (a piped "toggle + Enter" burst loses the Enter and
// hangs), which a real double-clicked console can also do with fast typing.
async function pick(mods) {
    const sel = {};
    for (const m of mods) sel[m.name] = meta(m.name).required ? true : modInstalled(m);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const queue = []; let waiter = null, eof = false;
    rl.on('line', l => { if (waiter) { const w = waiter; waiter = null; w(l.trim()); } else queue.push(l.trim()); });
    rl.on('close', () => { eof = true; if (waiter) { const w = waiter; waiter = null; w(null); } });
    const ask = q => {
        process.stdout.write(q);
        if (queue.length) return Promise.resolve(queue.shift());
        if (eof) return Promise.resolve(null);
        return new Promise(res => { waiter = res; });
    };
    const render = () => {
        console.log('');
        console.log('  LCLite — pick mods (Lost City webclient overlay)');
        console.log('');
        mods.forEach((m, i) => {
            const info = meta(m.name);
            let inst = false; try { inst = modInstalled(m); } catch { }
            const box = info.required ? '[*]' : sel[m.name] ? '[X]' : '[ ]';
            const state = info.required ? 'required' : (inst ? 'installed' : (sel[m.name] ? 'will install' : 'off'));
            console.log(`   ${i + 1} ${box} ${info.label.padEnd(28)} ${info.desc}  (${state})`);
        });
        console.log('');
        console.log('   <n> = toggle mod n     a = toggle all (except required)     r = reset to defaults');
        console.log('   Enter = install selection        q = quit without installing');
        console.log('');
    };
    render();
    for (;;) {
        const ans = await ask('  > ');
        if (ans === null) { rl.close(); return null; }   // EOF / closed: quit, change nothing
        const a = ans.toLowerCase();
        if (a === 'q') { rl.close(); return null; }
        if (a === '') break;
        if (a === 'a') { const anyOn = mods.some(m => !meta(m.name).required && sel[m.name]); for (const m of mods) if (!meta(m.name).required) sel[m.name] = !anyOn; }
        else if (a === 'r') { for (const m of mods) sel[m.name] = true; }
        else {
            const n = parseInt(a, 10);
            const m = mods[n - 1];
            if (m) {
                if (meta(m.name).required) console.log('  required mod — cannot be unchecked');
                else sel[m.name] = !sel[m.name];
            } else console.log('  ?');
        }
        render();
    }
    rl.close();
    return sel;
}

// ---- new-mod scaffold (B2) ---------------------------------------------------
// One command instead of a wiki hunt. It COPIES the layout example in
// mods/_template/ — a complete, working mod (a files/ payload plus the ONE hunk
// that loads it) — under the new name, rewriting the id everywhere it appears:
// folder and file names, the `// lclite:<mod>` markers, the payload's own
// self-stamp, the README. What comes out is a mod the launcher lists and can apply
// and strip immediately; nothing about it is a stub, and doctor is green on it
// before you have written a line.
//
// The template folder is `_template` precisely so it is NOT a mod: every reader
// (these tools and the launcher) skips `mods/_*` and `mods/.*` (lib.mjs isModDir).
const TEMPLATE = path.join(__dirname, 'mods', '_template');
const TEMPLATE_ID = 'example-mod';
const camel = name => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

function scaffold(name) {
    const dir = path.join(__dirname, 'mods', name);
    if (fs.existsSync(dir)) { console.error(`mods/${name} already exists`); process.exitCode = 1; return; }
    if (!fs.existsSync(TEMPLATE)) {
        console.error(`mods/_template/ is missing — it is the layout example this command copies.`);
        console.error(`  restore it (git checkout -- mods/_template) and rerun.`);
        process.exitCode = 1;
        return;
    }
    const swap = s => s.split(TEMPLATE_ID).join(name).split(camel(TEMPLATE_ID)).join(camel(name));
    let files = 0;
    const copy = (src, dst) => {
        fs.mkdirSync(dst, { recursive: true });
        for (const e of fs.readdirSync(src, { withFileTypes: true })) {
            const s = path.join(src, e.name), d = path.join(dst, swap(e.name));
            if (e.isDirectory()) copy(s, d);
            else {
                // text files carry the id (markers, paths, keys); nothing in the
                // template is binary, so a utf-8 round-trip is safe here
                fs.writeFileSync(d, swap(fs.readFileSync(s, 'utf-8')));
                files++;
            }
        }
    };
    copy(TEMPLATE, dir);
    console.log(`created mods/${name}/  (${files} files, copied from mods/_template — the layout example)`);
    console.log('');
    console.log('it is a working mod already. To see it:');
    console.log(`  LCLITE_ROOT=<install> node tools/lclite.mjs apply --mods ${name},control-panel`);
    console.log('  ...then load the client: the page script logs one line and stamps itself.');
    console.log('');
    console.log('to make it yours (each step is checked by a tool, so nothing rots silently):');
    console.log(`  1. code      mods/${name}/files/engine/public/lclite/${name}/ui.js  — plain page script, no build`);
    console.log(`  2. hook      edit the tree, start every added block with // lclite:${name} (or <!-- lclite:${name} --> in ejs)`);
    console.log(`  3. snapshot  add '${name}': ['<file>', ...] to MODS in tools/regen.mjs, then LCLITE_ROOT=<install> node tools/regen.mjs`);
    console.log(`  4. settings  localStorage key '${camel(name)}' read at YOUR hook site, per frame (rule 5)`);
    console.log(`  5. panel row { id: '${name}', name: '…', desc: '…', master: { key: '${camel(name)}', def: 'false' } }`);
    console.log(`               in mods/control-panel/files/engine/public/lclite/panel.js + bump its ?v= in the ejs`);
    console.log(`  6. prove it  LCLITE_ROOT=<install> node tools/doctor.mjs (exit 0) · node tools/matrix.mjs`);
    console.log(`               bash tools/acceptance.sh  ·  node tools/lclite.mjs build`);
    console.log('');
    console.log(`layout, and what each part is for: mods/${name}/README.md + docs/MAKING-A-MOD.md`);
}

// ---- main ----------------------------------------------------------------------
function wantNames(mods, names) {
    const want = {};
    for (const m of mods) want[m.name] = meta(m.name).required || names.includes(m.name);
    return want;
}
function wantFromSel(mods, sel) {
    const want = {};
    for (const m of mods) want[m.name] = meta(m.name).required || !!sel[m.name];
    return want;
}

function doApply(mods, want, rev) {
    const { fails } = converge(mods, want, false, rev);
    const installed = buildManifest(mods);
    if (fails) {
        console.log(`\n${fails} hunk(s) need reseating for ${rev}. \`node tools/port.mjs ${rev}\` re-anchors what it`);
        console.log(`can against this tree and prints exactly what it could not place (the ↳ lines above say where`);
        console.log(`each anchor's lines went) — then regen snapshots the result as ${rev}'s own corpus.`);
        process.exitCode = 2;
    } else {
        console.log(`\nmods on the ${rev} tree: ${installed.join(', ') || '(none)'}`);
    }
    return fails;
}

async function main() {
    const args = process.argv.slice(2);
    const check = args.includes('--check');
    const noBuild = args.includes('--no-build');

    // bare `node tools/lclite.mjs` at a real terminal = the friendly picker;
    // with piped stdin (CI/scripts) it keeps the old apply-all + build meaning
    if (!args.length && process.stdin.isTTY) args.push('pick');

    if (args.includes('new')) {
        const name = args[args.indexOf('new') + 1];
        if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) { console.error('usage: node tools/lclite.mjs new <mod-name>  (lowercase, hyphens)'); process.exitCode = 1; return; }
        scaffold(name);
        return;
    }

    const rev = resolveRev(args);
    const mods = findMods(__dirname, rev);
    if (!mods.length) { console.error(`no mods found under ${path.join(__dirname, 'mods')}`); process.exit(1); }

    if (args.includes('list')) {
        console.log(`# revision ${rev}${REVS.primary !== rev ? ` (corpus inherited from ${REVS.primary})` : ''}`);
        for (const m of mods) {
            const info = meta(m.name);
            let inst = false; try { inst = modInstalled(m); } catch { }
            // what this mod delivers HERE: its hunks (own corpus or an inherited one)
            // or only its files/ payload. Neither = nothing to install on this rev.
            const src = !m.missingCorpus ? (m.inherited ? `inherited:${m.corpusRev}` : `corpus:${m.corpusRev}`)
                : m.hasPayload ? 'payload-only' : 'no-corpus';
            const state = (m.missingCorpus && !m.hasPayload) ? 'unavailable' : inst ? 'installed' : 'off';
            const desc = info.desc || readmeSummary(m.dir);
            console.log(`${m.name}|${state}|${info.label}|${desc}${info.required ? ' [required]' : ''}|${src}`);
        }
        return;
    }

    if (args.includes('pick')) {
        const problems = preflight();
        if (problems.length) { problems.forEach(p => console.log('!! ' + p)); process.exit(1); }
        console.log(`  revision: ${rev}`);
        const sel = await pick(mods);
        if (!sel) { console.log('quit — nothing changed.'); process.exitCode = 3; return; }
        if (doApply(mods, wantFromSel(mods, sel), rev) === 0 && !noBuild) build();
        return;
    }

    const problems = preflight();
    if (problems.length) { problems.forEach(p => console.log('!! ' + p)); process.exit(1); }

    // build-only mode
    if (args.includes('build')) { if (!check) build(); return; }

    if (args.includes('doctor')) {
        // forward ONLY the known-safe flag: never splice raw argv into a shell string
        try { execSync(`"${process.execPath}" "${path.join(TOOLS_DIR, 'doctor.mjs')}"${args.includes('--json') ? ' --json' : ''}`, { stdio: 'inherit' }); } catch { process.exitCode = 1; }
        return;
    }

    let want;
    if (args.includes('uninstall')) {
        // full clean: even the required mods come off (installer's only "strip-everything" mode)
        want = Object.fromEntries(mods.map(m => [m.name, false]));
    }
    else {
        const mi = args.indexOf('--mods');
        if (mi >= 0 && args[mi + 1]) {
            const names = args[mi + 1].split(/[, ]+/).filter(Boolean);
            const known = new Set(mods.map(m => m.name));
            for (const n of names) if (!known.has(n)) console.log(`  ? unknown mod "${n}" (no folder in mods/) — ignored`);
            want = wantNames(mods, names);
        }
        else want = wantNames(mods, mods.map(m => m.name));   // default / --all = everything
    }

    if (check) {
        // dry-run: full per-hunk report; still fails on drift (the CI canary
        // relies on exit code 2 == "a hunk's anchor moved upstream")
        console.log(`revision ${rev}  (corpus: ${mods.every(m => !m.missingCorpus) ? 'complete' : 'partial'})`);
        const { fails } = converge(mods, want, true, rev);
        if (fails) process.exitCode = 2;
        return;
    }

    const failed = doApply(mods, want, rev);
    // bare `apply` stays patch-only (build is a separate step); plain run converges+builds
    if (!failed && !noBuild && !args.includes('apply')) build();
}

main();
