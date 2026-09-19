#!/usr/bin/env node
/* lclite:tcg — catalog dates + revision cutoffs.
   Fills the release date on every card of the TCG catalog and refreshes the
   revision -> release-date map that the bundled core filters with, so the cards
   a player can collect match the game build they are playing.

   WHERE THE DATES COME FROM
   The card NAMES come from the OSRS wiki (via the OSRS TCG plugin's Card.json),
   so that wiki is the first source; a card it does not date falls back to
   runescape.wiki, which is the continuity wiki for the original RS2/RS3 game and
   the better authority for a 2005 release date. A card with no date at all is
   written as 0 and is EXCLUDED from every revision-filtered catalog (the undated
   bucket is dominated by OSRS-era items, so excluding is the honest default).
   Only the EARLIEST date found is kept (pages for multi-variant items use
   release1/release2/... — the first appearance is what matters here).

   WHERE THE CUTOFFS COME FROM
   https://2004.lostcity.rs/roadmap — the Lost City project's own table of which
   revision is which historical build (289 = 2005-01-17). Re-run this after a new
   revision is cut and the map picks it up; no card re-fetch is needed, because
   every card already carries its date.

   USAGE (from the overlay root)
     node mods/tcg/tools/catalog_dates.mjs               # fill gaps + refresh cutoffs
     node mods/tcg/tools/catalog_dates.mjs --refresh     # re-query every card too
     node mods/tcg/tools/catalog_dates.mjs --check       # report only, write nothing
     node mods/tcg/tools/catalog_dates.mjs --no-roadmap  # keep the existing cutoff map

   Network: ~130 batched requests per wiki on a --refresh run (50 titles each),
   a handful on the normal gap-filling run. The output is deterministic apart from
   the wiki data itself, so a re-run with no wiki changes rewrites the file
   byte-identically. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));                 // mods/tcg/tools
const OVERLAY = path.resolve(HERE, '../../..');                           // the overlay root
const CATALOG = path.join(HERE, '../files/engine/public/lclite/tcg/cards.json');
const REVS = path.join(OVERLAY, 'revs.json');

const WIKIS = [
    { id: 'osrs', api: 'https://oldschool.runescape.wiki/api.php' },
    { id: 'rs3', api: 'https://runescape.wiki/api.php' }
];
const ROADMAP = 'https://2004.lostcity.rs/roadmap';
const UA = 'LCLite-tcg-catalog/1.0 (LCLite mod tooling; +https://github.com/LostCityRS)';
const BATCH = 50;
const WORKERS = 4;
const PACE_MS = 150;   // polite gap between API calls; the wikis 429 a tight loop

const args = new Set(process.argv.slice(2));
const REFRESH = args.has('--refresh');
const CHECK = args.has('--check');
const NO_ROADMAP = args.has('--no-roadmap');

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const DATE_RE = /\[\[(\d{1,2})\s+([A-Za-z]+)\]\]\s*\[\[(\d{4})\]\]/g;

function normName(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// `|release = [[26 January]] [[2005]]` (single-variant) or release1..releaseN
// (multi-variant pages: Amulet of glory, Granite maul, ...). Earliest wins.
function parseReleases(text) {
    const out = [];
    for (const line of text.split('\n')) {
        const m = /^\s*\|\s*release\s*\d*\s*=\s*(.*)$/i.exec(line);
        if (!m) { continue; }
        DATE_RE.lastIndex = 0;
        let d;
        while ((d = DATE_RE.exec(m[1]))) {
            const mon = MONTHS[d[2].toLowerCase()];
            if (mon) { out.push(Number(d[3]) * 10000 + mon * 100 + Number(d[1])); }
        }
    }
    return out;
}

async function api(base, params) {
    const url = base + '?' + new URLSearchParams({ format: 'json', ...params }).toString();
    for (let attempt = 0; attempt < 5; attempt++) {
        await sleep(PACE_MS);
        try {
            const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
            if (r.status === 429 || r.status >= 500) { throw new Error('http ' + r.status); }
            if (!r.ok) { return {}; }
            return await r.json();
        } catch (e) {
            if (attempt === 4) { console.error('  ! ' + base + ' request failed: ' + e.message); return {}; }
            await sleep(1500 * (attempt + 1));
        }
    }
    return {};
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── wiki title resolution ────────────────────────────────────────────────────
// MediaWiki answers a `titles=` batch keyed by the RESOLVED title, and it always
// follows redirects (the `redirects` flag is presence-only: `redirects=0` still
// resolves them, and the query then reports the from/to pairs). A redirect page
// is a different item unless the target is clearly the same thing, so:
//  * the exact pass accepts a date only when the resolved title IS the card's
//    name (first letter case-insensitive, as MediaWiki titles are);
//  * the recovery pass prefixsearches the name — MediaWiki titles are only
//    case-insensitive on their first letter, and this catalog has names like
//    "Amulet of Glory" for the wiki's "Amulet of glory" — and then accepts a
//    resolved title whose words are a subset of the card's ("Lit candle" ->
//    "Candle" ✓, "Part admiral pie" -> "Admiral pie" ✓, "Black ring" ->
//    "Onyx ring" ✗ — a different item).
function words(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}
function sameName(a, b) { return normName(a) === normName(b); }
function subsetName(target, source) {
    const t = words(target), s = new Set(words(source));
    return t.length > 0 && t.every(w => s.has(w));
}
function resolveChain(batch, q) {
    const map = new Map(batch.map(t => [t, t]));
    const apply = (list) => {
        for (const [from, to] of list ?? []) {
            for (const [k, v] of map) { if (v === from) { map.set(k, to); } }
        }
    };
    apply((q?.normalized ?? []).map(n => [n.from, n.to]));
    apply((q?.redirects ?? []).map(r => [r.from, r.to]));
    return map;
}

// accept(requested, resolvedTitle) decides whether the resolved page may date the
// card. Returns Map(requested name -> { date, title })
async function queryTitles(wiki, titles, accept) {
    const out = new Map();
    for (let i = 0; i < titles.length; i += BATCH) {
        const batch = titles.slice(i, i + BATCH);
        const d = await api(wiki.api, {
            action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
            rvsection: '0', titles: batch.join('|')
        });
        const pages = Object.values(d?.query?.pages ?? {});
        const chain = resolveChain(batch, d?.query);
        for (const name of batch) {
            const final = chain.get(name) ?? name;
            const page = pages.find(p => p.title === final);
            const text = page?.revisions?.[0]?.slots?.main?.['*'] ?? '';
            const dates = text ? parseReleases(text) : [];
            if (dates.length && accept(name, final)) {
                out.set(name, { date: Math.min(...dates), title: final });
            }
        }
    }
    return out;
}
const exactOnly = (requested, resolved) => sameName(requested, resolved);
const recovered = (requested, resolved) => sameName(requested, resolved) || subsetName(resolved, requested);

// prefixsearch the name, then date the page it points at
async function recover(wiki, names) {
    const candidates = new Map();
    await mapLimit(names, WORKERS, async (name) => {
        const d = await api(wiki.api, { action: 'query', list: 'prefixsearch', pssearch: name, pslimit: '5' });
        const hits = (d?.query?.prefixsearch ?? []).map(h => h.title);
        const hit = hits.find(h => sameName(h, name)) ?? hits.find(h => subsetName(h, name));
        if (hit) { candidates.set(name, hit); }
    });
    const titles = [...new Set(candidates.values())];
    const dated = titles.length ? await queryTitles(wiki, titles, recovered) : new Map();
    const byTitle = new Map([...dated.values()].map(v => [v.title, v.date]));
    const out = new Map();
    for (const [name, title] of candidates) {
        const direct = dated.get(name);
        const viaCandidate = byTitle.get(title) ?? [...dated.values()].find(v => sameName(v.title, title))?.date ?? 0;
        const d = direct?.date ?? viaCandidate;
        if (d > 0) { out.set(name, d); }
    }
    return out;
}

async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i], i);
        }
    }));
    return out;
}

async function fetchRoadmap() {
    const r = await fetch(ROADMAP, { headers: { 'User-Agent': UA } });
    if (!r.ok) { throw new Error('roadmap http ' + r.status); }
    const html = await r.text();
    const map = {};
    for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
        // strip tags + entities, then take the first 3-digit revision and the
        // first ISO date on the row (the roadmap's ⓘ marker sits in the revision
        // cell as an entity, which is why cell-splitting needs the decode).
        const text = row.replace(/<[^>]+>/g, ' ')
            .replace(/&#?\w+;/g, ' ')
            .replace(/\s+/g, ' ');
        const rev = /\b(\d{3}(?:\.\d+)?)\b/.exec(text);
        const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
        if (rev && date) { map[rev[1]] = Number(date[1].replace(/-/g, '')); }
    }
    if (!Object.keys(map).length) { throw new Error('roadmap parsed to nothing — page shape changed?'); }
    return map;
}

function cutoffLabel(d) {
    return d ? `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6, 8)}` : 'none';
}

// ── main ─────────────────────────────────────────────────────────────────────
const originalText = fs.readFileSync(CATALOG, 'utf8');
const raw = JSON.parse(originalText);
const version = String(raw[0]);
const cards = raw[1];
const revMap = raw[2] ?? {};

if (!Array.isArray(cards) || !cards.length) { throw new Error('cards.json has no card rows'); }

const undated = cards.filter(c => !(c[5] > 0));
const targets = REFRESH ? cards.slice() : undated;
console.log(`catalog ${version}: ${cards.length} cards · ${undated.length} without a date` +
    (REFRESH ? ' · --refresh: re-querying all' : ''));

const byName = new Map();
if (targets.length) {
    const names = targets.map(c => c[0]);
    for (const wiki of WIKIS) {
        const exact = await queryTitles(wiki, names, exactOnly);
        let hit = 0;
        for (const c of targets) {
            const d = exact.get(c[0])?.date ?? 0;
            if (d > 0 && !(byName.get(c[0]) > 0)) { byName.set(c[0], d); hit++; }
        }
        const missing = targets.map(c => c[0]).filter(n => !(byName.get(n) > 0));
        const found = await recover(wiki, missing);
        let hit2 = 0;
        for (const [name, d] of found) {
            if (d > 0 && !(byName.get(name) > 0)) { byName.set(name, d); hit2++; }
        }
        console.log(`  ${wiki.id}: ${hit} exact + ${hit2} recovered of ${names.length} · ${missing.length} unresolved here`);
    }
}

let filled = 0;
for (const c of targets) {
    const d = byName.get(c[0]) || 0;
    if (d > 0) { c[5] = d; filled++; }
    else if (!(c[5] > 0)) { c[5] = 0; }
}
for (const c of cards) { if (!(c[5] > 0)) { c[5] = 0; } }

let nextMap = revMap;
if (!NO_ROADMAP) {
    try {
        nextMap = await fetchRoadmap();
        console.log(`  roadmap: ${Object.keys(nextMap).length} revisions (${Object.keys(nextMap)[0]} .. ${Object.keys(nextMap).at(-1)})`);
    } catch (e) {
        console.error('  ! roadmap fetch failed (' + e.message + ') — keeping the existing cutoff map');
    }
}

const nowUndated = cards.filter(c => !(c[5] > 0));
console.log(`dated ${cards.length - nowUndated.length}/${cards.length} (filled ${filled} this run) · still undated ${nowUndated.length}`);
if (nowUndated.length) {
    console.log('  undated (excluded from every revision-filtered catalog): ' + nowUndated.slice(0, 40).map(c => c[0]).join(', ') +
        (nowUndated.length > 40 ? ` … +${nowUndated.length - 40}` : ''));
}

let declared = {};
try { declared = JSON.parse(fs.readFileSync(REVS, 'utf8')).supported ?? {}; } catch (e) { /* revs.json is optional here */ }
for (const rev of Object.keys(declared).sort()) {
    const cut = nextMap[rev] || 0;
    const keep = cards.filter(c => c[5] > 0 && cut > 0 && c[5] <= cut).length;
    console.log(`  rev ${rev}: released on or before ${cutoffLabel(cut)} -> ${keep} cards${cut ? '' : '  (revision missing from the roadmap map — the core will not filter)'}`);
}

if (CHECK) { console.log('--check: nothing written'); process.exit(0); }

const base = version.split('+')[0];
const nextVersion = base + '+d1';
const out = [nextVersion, cards, nextMap];
const text = JSON.stringify(out);
if (text === originalText) {
    console.log('unchanged — cards.json left alone');
} else {
    fs.writeFileSync(CATALOG, text);
    console.log(`wrote ${path.relative(OVERLAY, CATALOG)} (version ${nextVersion}, ${(text.length / 1024).toFixed(0)} KB)`);
    console.log('next: bump the ?v= keys (tcg_core.ts CAT_URL + the client.ejs ui.js tag) and run tools/regen.mjs');
}
