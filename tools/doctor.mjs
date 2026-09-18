#!/usr/bin/env node
// lclite doctor — one command, structured health report for the whole overlay.
//
//   node lclite/doctor.mjs          human report
//   node lclite/doctor.mjs --json   machine-readable (agents / CI)
//
// exit codes: 0 healthy · 2 anchor drift (apply --check would fail) ·
//             3 structural problem (hunk overlap, marker gap, hard rev skew, EOL)
//             — also 3 when there is no host checkout here at all (standalone
//             overlay: point LCLITE_ROOT at an install, see the message)
//
// NOTE the pin check is ancestry-aware: a pin older than HEAD is fine while the
// hunks apply, because the launcher installs branch tips.
//
// It answers, in order, the questions a session always asks by hand:
//   which mods are on? did anything drift? can two hunks fight over one region?
//   is ownership declared (markers) everywhere? do patch JSONs agree on a base rev?
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { LIB_DIR, meta, findMods, toLF } from './lib.mjs';

const ROOT = path.resolve(process.env.LCLITE_ROOT || path.join(LIB_DIR, '..'));
const asJson = process.argv.includes('--json');
const mods = findMods(LIB_DIR);   // LIB_DIR = lclite/ root

const issues = [];      // {sev:'drift'|'struct', msg}
const notes = [];       // informational — do not affect the exit code
const report = { root: ROOT, mods: {}, files: {}, revs: {}, corpus: { hunks: 0, declared: 0, addedLines: 0, findLines: 0, markerHunks: 0 } };

const git = (repo, cmd) => {   // probe helper: quiet on failure, null = unknown
    try { return execSync(`git -C "${path.join(ROOT, repo)}" ${cmd}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return null; }
};

// panelRegistry reads the in-game control panel's mod list (name + desc per mod
// id) straight out of the shipped panel.js, so the wording check below compares
// against what players actually see. Null when the file isn't there.
function panelRegistry() {
    const file = path.join(LIB_DIR, 'mods', 'control-panel', 'files', 'engine', 'public', 'lclite', 'panel.js');
    let text;
    try { text = fs.readFileSync(file, 'utf-8'); } catch { return null; }
    const start = text.indexOf('const MOD_REGISTRY = [');
    if (start < 0) return null;
    const end = text.indexOf('\n    ];', start);
    const block = text.slice(start, end < 0 ? text.length : end);
    const out = {};
    // every entry starts at a line beginning `{ id: '`; name/desc are the first
    // two keys of each, so the first match inside a chunk is the right one
    for (const chunk of block.split(/\n\s*\{ id: '/).slice(1)) {
        const id = chunk.slice(0, chunk.indexOf("'"));
        const q = re => { const m = re.exec(chunk); return m ? (m[1] !== undefined ? m[1] : m[2]) : ''; };
        out[id] = { name: q(/name: '([^']*)'|name: "([^"]*)"/), desc: q(/desc: '([^']*)'|desc: "([^"]*)"/) };
    }
    return out;
}

// ---- 1. per-mod install state + corpus stats --------------------------------
const MARKER = /lclite:([a-z][a-z0-9-]*)/;
const regions = new Map();      // file -> [{mod, note, start, len}] in PRISTINE line space
let anyDrift = false, anyMissing = false;

for (const mod of mods) {
    const m = meta(mod.name);
    let installed = true, ok = 0, drift = 0;
    for (const patch of mod.patches) {
        const abs = path.join(ROOT, patch.file);
        const revRepo = patch.file.split('/')[0];
        if (report.revs[revRepo] && report.revs[revRepo] !== patch.generated_from?.head) {
            issues.push({ sev: 'struct', msg: `${patch.file}: base rev mismatch in this overlay (${report.revs[revRepo]} vs ${patch.generated_from?.head}) — regen everything or nothing` });
        }
        report.revs[revRepo] = patch.generated_from?.head;
        // count what the overlay DECLARES before asking the tree about it: with the
        // tree absent every hunk is unverifiable, and "corpus.hunks === 0" then means
        // "no tree", not "no patches" (the empty-overlay check below needs the latter).
        report.corpus.declared += patch.hunks.length;
        if (!fs.existsSync(abs)) { installed = false; anyMissing = true; continue; }
        const text = toLF(fs.readFileSync(abs, 'utf-8'));
        for (const h of patch.hunks) {
            report.corpus.hunks++;
            const rep = h.replace.join('\n');
            const find = h.find.join('\n');
            const present = text.includes(rep);
            if (present) ok++;
            else {
                installed = false;
                if (!text.includes(find)) drift++;   // rep gone AND find gone = DRIFT
                // (rep absent, find present = simply not installed: clean, no alarm)
            }
            const added = h.replace.filter(l => !h.find.includes(l));
            report.corpus.addedLines += added.length;
            report.corpus.findLines += h.find.length;
            if (added.some(l => MARKER.test(l))) report.corpus.markerHunks++;
            const noteM = /@ old line (\d+)/.exec(h.note || '');
            if (noteM) {
                if (!regions.has(patch.file)) regions.set(patch.file, []);
                regions.get(patch.file).push({ mod: mod.name, note: h.note, start: +noteM[1], len: h.find.length });
            } else {
                issues.push({ sev: 'struct', msg: `${mod.name} ${h.note || '?'}: no "old line" note — regen to get position metadata` });
            }
        }
    }
    report.mods[mod.name] = { required: !!m.required, installed, hunks_ok: ok, hunks_drifted: drift };
    if (drift) anyDrift = true;
}

// ---- 1b. an overlay with nothing to apply is a broken overlay ---------------
// If every patch JSON is gone (botched regen, bad merge, stray `git clean`), the
// per-mod result is ok=0 everywhere — which reads exactly like a healthy overlay in a
// tree where nothing is installed yet. That state silently disables the whole mod set,
// so it has to be structural, not a shrug.
if (report.corpus.declared === 0) {
    issues.push({ sev: 'struct', msg: 'no hunks declared in any patch JSON under mods/*/patches — apply would deliver nothing (restore mods/ from git, or regen against the installed tree)' });
}
for (const mod of mods) {
    const hasPayload = fs.existsSync(path.join(LIB_DIR, 'mods', mod.name, 'files'));
    if (!mod.patches.length && !hasPayload) {
        issues.push({ sev: 'struct', msg: `${mod.name}: no patches and no files/ payload — this mod cannot deliver anything` });
    }
}

// ---- 1c. one name per mod: MOD_META vs the in-game panel --------------------
// The launcher and the CLI picker show label/desc from MOD_META; players read
// the same mods in the F1 panel's Mods tab (control-panel's MOD_REGISTRY). Two
// lists with two wordings is how a mod ends up called "Low detail option" in
// one place and "Low detail" in the other, so say it out loud. Wording is
// cosmetic: a note, never an exit code.
{
    const panel = panelRegistry();
    if (panel) {
        for (const mod of mods) {
            const p = panel[mod.name];
            if (!p) continue;
            const m = meta(mod.name);
            if (p.name && p.name !== m.label) {
                notes.push(`wording: mods/${mod.name} is "${p.name}" in the F1 panel but "${m.label}" in tools/lib.mjs MOD_META (the launcher + picker show MOD_META) — make them identical`);
            } else if (p.desc && p.desc !== m.desc) {
                notes.push(`wording: mods/${mod.name}'s description differs between the F1 panel and MOD_META ("${p.desc}" vs "${m.desc}") — make them identical`);
            }
        }
    }
}

// ---- 2. A3: hunk apply-safety geometry (pristine line space) ----------------
// Regen guarantees disjoint find windows EXCEPT shared edge context, and anchors
// match by TEXT (indexOf), so what actually breaks a sibling is a hunk whose
// MUTATION ZONE [pos0, pos0+del) deletes lines inside another hunk's window
// [winLo, winHi] — the deleted text can no longer be found after the first apply.
// (Pure insertions del=0 are harmless: they add lines, never remove anchor text.)
report.overlaps = [];
for (const [file, list] of regions) {
    list.sort((a, b) => a.start - b.start);
    for (const A of list) {
        if (!A.pos || A.pos[1] === 0) continue;
        for (const B of list) {
            if (A === B || !B.pos) continue;
            const [a0, aDel] = A.pos, [, , bLo, bHi] = B.pos;
            if (a0 <= bHi && a0 + aDel - 1 >= bLo) {
                const msg = `OVERLAP ${file}: [${A.mod} ${A.note}] deletes lines inside [${B.mod} ${B.note}]'s anchor window — apply order would break it`;
                if (!report.overlaps.some(o => o.msg === msg)) { issues.push({ sev: 'struct', msg }); report.overlaps.push({ file, a: A, b: B, msg }); }
            }
        }
    }
}

// ---- 2b. is there a host tree here at all? ----------------------------------
// Since the launcher installs revisions into its own data folder, this repo is
// normally the overlay on its own — nothing to inspect, and saying so beats a
// wall of "off" mods and git fatals about missing siblings.
{
    const pinnedRepos = Object.keys(report.revs);
    const present = pinnedRepos.filter(r => fs.existsSync(path.join(ROOT, r)));
    if (pinnedRepos.length && !present.length) {
        const msg = `no Lost City checkout at ${ROOT} — this is the overlay on its own. ` +
                    `Point it at an install instead: LCLITE_ROOT=<install folder> node tools/doctor.mjs ` +
                    `(the launcher keeps them under its data folder, e.g. .../LCLite/installs/289), ` +
                    `or open LCLite.exe and use the dashboard.`;
        if (asJson) {
            console.log(JSON.stringify({ ok: false, exit: 3, root: ROOT, error: 'no host tree', notes, hint: msg }, null, 1));
        } else {
            console.log(`lclite doctor — ${ROOT}`);
            console.log('');
            console.log('  ' + msg);
            // overlay-level notes (wording drift) don't need a host tree to be useful
            for (const n of notes) console.log(`\n  [note] ${n}`);
        }
        process.exit(3);
    }
}

// ---- 3. marker coverage (assessment #2 retirement meter) --------------------
if (report.corpus.hunks && report.corpus.markerHunks < report.corpus.hunks) {
    issues.push({ sev: 'struct', msg: `${report.corpus.hunks - report.corpus.markerHunks} hunk(s) lack a \`// lclite:<mod>\` marker — routed by regex fallback, add markers` });
}

// ---- 4. base rev vs actual HEAD (rev-skew, the silent one) ------------------
// A pin OLDER than HEAD is not drift if every hunk still applies. The launcher
// clones branch tips, so a freshly installed revision legitimately sits ahead of
// the pin (289 moves as Lost City works). Only a pin that is NOT an ancestor of
// HEAD means the base shifted out from under the hunks — that is the real alarm.
for (const [repo, pinned] of Object.entries(report.revs)) {
    if (!fs.existsSync(path.join(ROOT, repo))) {
        report.revs[repo] = { pinned, head: null, match: false, missing: true, modified_files: 0 };
        continue;
    }
    const head = git(repo, 'rev-parse HEAD');
    const dirty = (git(repo, 'status --porcelain') || '').split('\n').filter(l => l.trim() && !l.startsWith('??')).length;
    // ahead: true = pin is behind HEAD · false = the base moved under the hunks
    // · null = can't tell (the launcher clones shallow, so the pin isn't here)
    let ahead = false;
    if (head && pinned && head !== pinned) {
        const pinHere = git(repo, `cat-file -e ${pinned}^{commit}`) !== null;
        if (!pinHere) ahead = null;
        else ahead = git(repo, `merge-base --is-ancestor ${pinned} HEAD`) !== null;
    }
    report.revs[repo] = { pinned, head, match: head === pinned, ahead, missing: false, modified_files: dirty };
    if (head && pinned && head !== pinned) {
        if (ahead === null) {
            notes.push(`${repo}/ is a shallow clone — the pinned ${pinned.slice(0, 7)} isn't in its history, so pin-vs-HEAD can't be compared here. The hunk counts above are the authority (all applied = fine).`);
        } else if (ahead) {
            notes.push(`${repo}/ HEAD ${head.slice(0, 7)} is ahead of the pinned ${pinned.slice(0, 7)} — fine while apply --check stays ✗0 (regen re-pins it)`);
        } else {
            issues.push({ sev: 'drift', msg: `${repo}/ HEAD ${head.slice(0, 7)} != pinned ${pinned.slice(0, 7)} (and the pin is not an ancestor) — hunks were generated against a different rev; run apply --check` });
        }
    }
}

// ---- 5. EOL health of patched files (the marker-sweep lesson) ---------------
// All Lost City sources are CRLF in the checkout; a patched file with ZERO CRLFs
// means some tool flattened it. Cheap heuristic, no git needed (works in t/ + CI).
{
    const seen = new Set();
    for (const mod of mods) {
        for (const patch of mod.patches) {
            if (seen.has(patch.file)) continue;
            seen.add(patch.file);
            const abs = path.join(ROOT, patch.file);
            if (!fs.existsSync(abs)) continue;
            const raw = fs.readFileSync(abs, 'utf-8');
            if (raw.includes('\n') && !raw.includes('\r\n')) (report.eol ||= {})[patch.file] = 'LF-only';
        }
    }
}

// ---- output ------------------------------------------------------------------
const exitStruct = issues.some(i => i.sev === 'struct') ? 3 : 0;
const exitDrift = (anyDrift || anyMissing || issues.some(i => i.sev === 'drift')) ? 2 : 0;
const code = exitStruct || exitDrift;   // structural outranks drift: fix order matters

if (asJson) {
    console.log(JSON.stringify({ ok: code === 0, exit: code, corpus: report.corpus, mods: report.mods, revs: report.revs, overlaps: report.overlaps, notes, issues }, null, 1));
} else {
    console.log(`lclite doctor — ${ROOT}`);
    const c = report.corpus;
    console.log(`corpus: ${c.hunks} hunks · ${c.addedLines} added lines · ${c.findLines} anchor lines (ratio ${(c.findLines / Math.max(1, c.addedLines)).toFixed(2)}) · markers ${c.markerHunks}/${c.hunks}`);
    console.log('');
    for (const [name, s] of Object.entries(report.mods)) {
        console.log(`  ${s.installed ? 'ON ' : 'off'}  ${name.padEnd(14)} hunks ok=${s.hunks_ok}${s.hunks_drifted ? ` DRIFTED=${s.hunks_drifted}` : ''}${s.required ? '  (required)' : ''}`);
    }
    console.log('');
    for (const [repo, r] of Object.entries(report.revs)) {
        if (r.missing) { console.log(`  ${repo.padEnd(10)} not present here (pinned ${String(r.pinned).slice(0, 7)})`); continue; }
        const verdict = r.match ? '= ok'
            : r.ahead === null ? '= shallow clone (pin not comparable)'
            : r.ahead ? '= pin is behind HEAD (ok)'
            : '!= DRIFT CHECK NEEDED';
        console.log(`  ${repo.padEnd(10)} pinned ${String(r.pinned).slice(0, 7)} | HEAD ${String(r.head || '?').slice(0, 7)} ${verdict} | ${r.modified_files} tracked files modified (the modded state)`);
    }
    if (report.overlaps.length) console.log('\n  overlaps: ' + report.overlaps.map(o => o.file).join(', '));
    if (report.eol && Object.keys(report.eol).length) console.log('\n  LF-only patched files (upstream convention is CRLF): ' + Object.keys(report.eol).join(', '));
    for (const n of notes) console.log(`\n  [note] ${n}`);
    for (const i of issues) console.log(`\n  [${i.sev}] ${i.msg}`);
    console.log(code === 0 ? '\n  ✔ healthy' : `\n  exit ${code} (2=drift, 3=structural)`);
}
process.exitCode = code;
