#!/usr/bin/env node
// lclite install — apply the mod overlay onto clean upstream repos, then build + deploy.
// Run from this folder (lclite/ inside a Lost City checkout):
//
//   node install.mjs                     # in a terminal: picker, then apply + build;
//                                        # piped/CI (no TTY): apply ALL mods + build
//   node install.mjs apply               # apply ALL mods, no build (script-safe)
//   node install.mjs --mods camera,xp-drops   # desired set: apply these, strip the others
//   node install.mjs apply --check       # dry-run report (no writes)
//   node install.mjs build               # bun bundle + deploy client.js only
//   node install.mjs uninstall           # strip every mod back toward pristine
//   node install.mjs pick                # picker only (what install.bat drives)
//   node install.mjs list                # machine-readable: name|installed|label|desc
//
// apply/uninstall are idempotent and always converge the tree to the DESIRED set:
// selected mods get their hunks applied, deselected mods get their hunks stripped
// (find/replace reversed) and their copied files removed.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execSync } from 'node:child_process';
import { LIB_DIR, meta, findMods, countOccurrences, toLF, restoreEOL, stripPatchFile, loadRootManifest } from './lib.mjs';

const __dirname = LIB_DIR;
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
// matches the overlay byte-for-byte (never clobber someone's hand edits).
function removeModFiles(mod) {
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
                if (!fs.existsSync(dst)) continue;
                const same = fs.readFileSync(dst).equals(fs.readFileSync(p));
                if (same) { fs.rmSync(dst); out.push(rel); }
                else console.log(`  ! kept ${rel} (edited in-tree, not identical to overlay)`);
            }
        }
    };
    walk(fdir);
    return out;
}

// ---- installed-state detection ----------------------------------------------
// A mod counts as installed when every one of its hunks is verbatim present
// (the same test apply uses for "already"). Anything else => strip then apply.
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
    if (!hunks) return false;
    const fdir = path.join(mod.dir, 'files');
    if (fs.existsSync(fdir)) {
        let any = false;
        const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { any = true; if (!fs.existsSync(path.join(ROOT, path.relative(fdir, p)))) throw new Error('gone'); } } };
        try { walk(fdir); } catch { return false; }
        if (!any) return false;
    }
    return true;
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
    for (const repo of manifest.repos) {
        if (!repo.required) continue;
        if (!fs.existsSync(path.join(ROOT, repo.dir))) problems.push(`${repo.dir}/ not found — clone the host client first${repo.remote ? ` (${repo.remote})` : ''}, then place lclite/ in that folder next to the repos.`);
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
    if (!ensureBun()) { console.log('skipping build — run "node lclite/install.mjs build" once bun is installed.'); return false; }
    if (!fs.existsSync(path.join(wc, 'node_modules'))) {
        console.log('webclient/node_modules missing — installing build deps (bun install)...');
        try { execSync(`"${BUN}" install`, { cwd: wc, stdio: 'inherit' }); }
        catch { console.log('!! bun install failed — rerun "node lclite/install.mjs build" manually (network? bun version?).'); return false; }
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
    return true;
}

// ---- the converge engine: apply desired set, strip the rest ------------------
function converge(mods, want, check) {
    let fails = 0, changed = false;
    for (const mod of mods) {
        const m = meta(mod.name);
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
            console.log(`${check ? 'would apply' : 'applied'} [${mod.name}]  +${tA} ~${tL} ✗${tF}${copied.length ? `  files:${copied.length}` : ''}${m.required ? '  (required)' : ''}`);
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
    return { fails, changed };
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
// One command instead of a wiki hunt. Creates the folder contract and prints the
// exact 5-step recipe; `doctor` will verify every step afterwards.
function scaffold(name) {
    const dir = path.join(__dirname, 'mods', name);
    if (fs.existsSync(dir)) { console.error(`mods/${name} already exists`); process.exitCode = 1; return; }
    fs.mkdirSync(path.join(dir, 'patches'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'),
        `# mods/${name}\n\nOne paragraph: what this mod does and how a player notices it.\n\n` +
        `## Engine hunks (TYPE B)\nEdit the live tree, then \`node lclite/regen.mjs\` — hunks route here\n` +
        `automatically because every added block carries \`// lclite:${name}\` as its first line.\n` +
        `Files this mod patches must be listed in MODS + HUNK_OWNER fallback in regen.mjs.\n\n` +
        `## Settings contract\nlocalStorage key \`${name}\` (camelCase), read per-frame at this mod's OWN hook site.\n` +
        `Panel row: PLUGINS entry in mods/control-panel/files/engine/public/lclite/panel.js.\n`);
    console.log(`created mods/${name}/`);
    console.log('\nnext steps (all verified by `node lclite/install.mjs doctor`):');
    console.log(`  1. edit webclient/src/... (or engine/view/...) directly — start every added block with "/* lclite:${name} */"`);
    console.log('  2. dev-test fast:   bun run bundle.ts dev   (unmangled names for console probes)');
    console.log(`  3. snapshot hunks:  add '${name}': ['<file>', ...] to MODS in regen.mjs, then node lclite/regen.mjs`);
    console.log('  4. prove it:        t/ pristine apply == live tree byte-for-byte (README "acceptance test")');
    console.log('  5. panel row:       PLUGINS entry { id, name, desc, master:{key,def} } in panel.js (TYPE A if no hunks)');
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

function doApply(mods, want) {
    const { fails } = converge(mods, want, false);
    const installed = buildManifest(mods);
    if (fails) {
        console.log(`\n${fails} hunk(s) need reseating for this rev. The ↳ lines above say where the anchor's lines moved — open lclite/mods/<mod>/patches/*.json, update the find[] array to the new surrounding code, rerun.`);
        process.exitCode = 2;
    } else {
        console.log(`\nmods on the tree: ${installed.join(', ') || '(none)'}`);
    }
    return fails;
}

async function main() {
    const args = process.argv.slice(2);
    const check = args.includes('--check');
    const noBuild = args.includes('--no-build');

    const mods = findMods(__dirname);
    if (!mods.length) { console.error(`no mods found under ${path.join(__dirname, 'mods')}`); process.exit(1); }

    // bare `node install.mjs` at a real terminal = the friendly picker;
    // with piped stdin (CI/scripts) it keeps the old apply-all + build meaning
    if (!args.length && process.stdin.isTTY) args.push('pick');

    if (args.includes('list')) {
        for (const m of mods) {
            const info = meta(m.name);
            let inst = false; try { inst = modInstalled(m); } catch { }
            console.log(`${m.name}|${inst ? 'installed' : 'off'}|${info.label}|${info.desc}${info.required ? ' [required]' : ''}`);
        }
        return;
    }

    if (args.includes('pick')) {
        const problems = preflight();
        if (problems.length) { problems.forEach(p => console.log('!! ' + p)); process.exit(1); }
        const sel = await pick(mods);
        if (!sel) { console.log('quit — nothing changed.'); process.exitCode = 3; return; }
        if (doApply(mods, wantFromSel(mods, sel)) === 0 && !noBuild) build();
        return;
    }

    const problems = preflight();
    if (problems.length) { problems.forEach(p => console.log('!! ' + p)); process.exit(1); }

    // build-only mode
    if (args.includes('build')) { if (!check) build(); return; }

    if (args.includes('doctor')) {
        // forward ONLY the known-safe flag: never splice raw argv into a shell string
        try { execSync(`node "${path.join(__dirname, 'doctor.mjs')}"${args.includes('--json') ? ' --json' : ''}`, { stdio: 'inherit' }); } catch { process.exitCode = 1; }
        return;
    }
    if (args.includes('new')) {
        const name = args[args.indexOf('new') + 1];
        if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) { console.error('usage: node install.mjs new <mod-name>  (lowercase, hyphens)'); process.exitCode = 1; return; }
        scaffold(name);
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
        const { fails } = converge(mods, want, true);
        if (fails) process.exitCode = 2;
        return;
    }

    const failed = doApply(mods, want);
    // bare `apply` stays patch-only (build is a separate step); plain run converges+builds
    if (!failed && !noBuild && !args.includes('apply')) build();
}

main();
