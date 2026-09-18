/* mods/no-censor/tools/no_censor_test.ts — harness for the "Disable profanity filter" mod.
 *
 * Runs the REAL shipped files (the tree's own WordFilter.ts and, when an install is
 * present, the engine's WordEnc.ts) against the REAL wordenc jag from the cache, so
 * the masking itself is the oracle rather than a copy of it:
 *
 *   - the two lists are parsed INDEPENDENTLY here (same container format, own reader),
 *     so "OFF mode masks the cache's own bad words" is a real assertion, not a
 *     restatement of the code under test;
 *   - ON mode is asserted UNIVERSALLY — every one of the 369 bad words, 453 domains
 *     and 258 TLDs, plus realistic chat lines, must come back with no '*' at all;
 *   - OFF mode must still mask them (a floor, printed), which is what makes the ON
 *     assertion non-vacuous: if the corpus or the filter ever stopped censoring, the
 *     test fails loudly instead of passing on a no-op;
 *   - formatting is asserted to be IDENTICAL in both modes for benign text, and to
 *     still run with the filter off (format() is not part of the censor);
 *   - the engine half is checked too: `WordEnc.censor === false`, unmasked output
 *     with it false, and masking restored when it is flipped back to true (which
 *     proves the guard is wired around the masking passes, not around all of them).
 *
 * Usage (from anywhere):
 *   bun run mods/no-censor/tools/no_censor_test.ts
 *   LCLITE_ROOT=<install> bun run mods/no-censor/tools/no_censor_test.ts
 *
 * Exit 0 = every check passed. The tree it picked is printed first, so a stale
 * choice is visible rather than silent.
 */
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.resolve(import.meta.dir, '../../..'); // mods/no-censor/tools -> overlay root

// ---- which tree to test ------------------------------------------------------
function pickTree(): string {
    const cands: string[] = [];
    if (process.env.LCLITE_ROOT) cands.push(process.env.LCLITE_ROOT.replace(/\\/g, '/').replace(/\/?$/, ''));
    if (process.env.LOCALAPPDATA) cands.push(path.join(process.env.LOCALAPPDATA, 'LCLite', 'installs', '289').replace(/\\/g, '/'));
    cands.push(path.resolve(HERE, '..').replace(/\\/g, '/')); // overlay living inside a checkout
    const ok = cands.find(d => fs.existsSync(`${d}/webclient/src/wordfilter/WordFilter.ts`) && fs.existsSync(`${d}/engine/data/raw/wordenc`));
    if (!ok) {
        console.error('FAIL: no tree with webclient/src/wordfilter/WordFilter.ts + engine/data/raw/wordenc. Tried:\n  ' + cands.join('\n  '));
        console.error('  (set LCLITE_ROOT=<install> — e.g. %LOCALAPPDATA%/LCLite/installs/289)');
        process.exit(2);
    }
    return ok;
}

const TREE = pickTree();
console.log(`\nno-censor test — tree under test: ${TREE}`);

// ---- the settings bus the mod reads (stubbed; bun's own localStorage is not used)
const LS: Record<string, string> = {};
(globalThis as any).localStorage = {
    getItem: (k: string) => (k in LS ? LS[k] : null),
    setItem: (k: string, v: string) => {
        LS[k] = String(v);
    },
    removeItem: (k: string) => {
        delete LS[k];
    }
};

const fileURL = (p: string) => 'file://' + p.replace(/\\/g, '/');

// ---- the code under test -----------------------------------------------------
const JagFile: any = (await import(fileURL(`${TREE}/webclient/src/io/JagFile.ts`))).default;
const Packet: any = (await import(fileURL(`${TREE}/webclient/src/io/Packet.ts`))).default;
const WordFilter: any = (await import(fileURL(`${TREE}/webclient/src/wordfilter/WordFilter.ts`))).default;

const hasEngine = fs.existsSync(`${TREE}/engine/src/cache/wordenc/WordEnc.ts`);
const WordEnc: any = hasEngine ? (await import(fileURL(`${TREE}/engine/src/cache/wordenc/WordEnc.ts`))).default : null;

const jagPath = `${TREE}/engine/data/raw/wordenc`;
const jag = new JagFile(new Uint8Array(fs.readFileSync(jagPath)));
WordFilter.unpack(jag);

// ---- the oracle: the cache's own lists, parsed here --------------------------
function readBadWords(): string[] {
    const p = new Packet(jag.read('badenc.txt'));
    const count: number = p.g4();
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
        const len: number = p.g1();
        let s = '';
        for (let j = 0; j < len; j++) s += String.fromCharCode(p.g1());
        const combos: number = p.g1();
        for (let j = 0; j < combos; j++) {
            p.g1b();
            p.g1b();
        }
        out.push(s);
    }
    return out;
}

function readDomains(): string[] {
    const p = new Packet(jag.read('domainenc.txt'));
    const count: number = p.g4();
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
        const len: number = p.g1();
        let s = '';
        for (let j = 0; j < len; j++) s += String.fromCharCode(p.g1());
        out.push(s);
    }
    return out;
}

function readTlds(): string[] {
    const p = new Packet(jag.read('tldlist.txt'));
    const count: number = p.g4();
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
        p.g1(); // type
        const len: number = p.g1();
        let s = '';
        for (let j = 0; j < len; j++) s += String.fromCharCode(p.g1());
        out.push(s);
    }
    return out;
}

const BAD = readBadWords();
const DOMAINS = readDomains();
const TLDS = readTlds();

// ---- helpers -----------------------------------------------------------------
let checks = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
    checks++;
    if (ok) {
        console.log(`  \u2713 ${name}${detail ? ' — ' + detail : ''}`);
    } else {
        failures.push(name);
        console.log(`  \u2717 ${name}${detail ? ' — ' + detail : ''}`);
    }
}
const stars = (s: string) => (s.match(/\*/g) || []).length;

/** Run the CLIENT filter with the mod's key at `mode` (null = the key is unset). */
function client(mode: string | null, s: string): string {
    if (mode === null) delete LS['noCensor'];
    else LS['noCensor'] = mode;
    return WordFilter.filter(s);
}

// ---- 1. the oracle is real ---------------------------------------------------
console.log('\ncorpus (parsed from the cache\u2019s own wordenc jag):');
check('bad-word list parsed', BAD.length >= 300, `${BAD.length} entries`);
check('domain list parsed', DOMAINS.length >= 300, `${DOMAINS.length} entries`);
check('tld list parsed', TLDS.length >= 100, `${TLDS.length} entries`);

// ---- 2. the settings key's semantics ----------------------------------------
console.log('\nkey semantics (localStorage.noCensor):');
const probe = BAD.find(w => stars(client('false', w)) > 0) ?? '';
check('a maskable probe exists in the corpus', probe.length > 0);
check('unset key = filter OFF (mod default on)', stars(client(null, probe)) === 0, `"${probe}" -> ${JSON.stringify(client(null, probe))}`);
check("'true' = filter OFF", stars(client('true', probe)) === 0);
check("a junk value = filter OFF", stars(client('yes', probe)) === 0);
check("'false' = vanilla masking", stars(client('false', probe)) > 0, `"${probe}" -> ${JSON.stringify(client('false', probe))}`);

// ---- 3. ON mode masks nothing, universally ----------------------------------
console.log('\nfilter off — nothing may be masked:');
const onBadStarred = BAD.filter(w => stars(client('true', w)) > 0);
check(`all ${BAD.length} bad words unmasked`, onBadStarred.length === 0, onBadStarred.length ? `still starred: ${onBadStarred.slice(0, 5).join(', ')}` : '');
const domProbes = DOMAINS.map(d => `www.${d}.com`);
const onDomStarred = domProbes.filter(s => stars(client('true', s)) > 0);
check(`all ${DOMAINS.length} domains unmasked`, onDomStarred.length === 0);
const tldProbes = TLDS.map(t => `www.blah.${t}/buy`);
const onTldStarred = tldProbes.filter(s => stars(client('true', s)) > 0);
check(`all ${TLDS.length} tld probes unmasked`, onTldStarred.length === 0);

// realistic chat lines, all four masking passes in play
const LINES = [
    ...BAD.slice(0, 120).map(w => `hello ${w} world`),
    ...BAD.slice(0, 60).map(w => `wow ${w}!! ${w}.`),
    ...DOMAINS.slice(0, 40).map(d => `check www.${d}.com out`),
    ...DOMAINS.slice(0, 40).map(d => `mail me @${d}.com`),
    ...TLDS.slice(0, 40).map(t => `go to blah.${t}/buy now`)
];
const onLineStarred = LINES.filter(s => stars(client('true', s)) > 0);
check(`${LINES.length} realistic chat lines unmasked`, onLineStarred.length === 0, onLineStarred.length ? `still starred: ${JSON.stringify(onLineStarred.slice(0, 3))}` : '');
check('input lines contain no literal *', LINES.every(s => !s.includes('*')));

// ---- 4. OFF mode is still the vanilla filter (the ON result means something) --
console.log('\nfilter on — vanilla masking must be intact:');
const offBadMasked = BAD.filter(w => stars(client('false', w)) > 0);
const offDomMasked = domProbes.filter(s => stars(client('false', s)) > 0);
check(`vanilla masks the bad-word list`, offBadMasked.length >= BAD.length - 10, `${offBadMasked.length}/${BAD.length} masked`);
check(`vanilla masks the domain list`, offDomMasked.length >= DOMAINS.length - 5, `${offDomMasked.length}/${DOMAINS.length} masked`);
const offLinesMasked = LINES.filter(s => stars(client('false', s)) > 0);
check(`vanilla masks the chat lines`, offLinesMasked.length >= LINES.length * 0.9, `${offLinesMasked.length}/${LINES.length} masked`);
check('the whitelist survives both ways', ['cook', 'seeks', 'sheet', 'faq'].every(w => client('false', w) === w && client('true', w) === w));

// ---- 5. formatting is untouched (both modes) --------------------------------
// Every string here is one the VANILLA filter leaves alone (asserted below), so the
// only thing that can make the two modes differ is the censor itself. Note 'symbols'
// deliberately avoids '@' and '.'/',' — vanilla treats that shape as a domain and
// masks it, which is a censoring case, not a formatting one.
console.log('\nformatting (not part of the censor — identical either way):');
const BENIGN = [
    'hello world',
    'Hello World',
    'hELLO wORLD',
    'hello. world! again',
    'a b  c   d',
    '  leading and trailing  ',
    'numbers 123 and 4567',
    'symbols !?:;-+=£$%[]',
    'mixed CASE and 42 numbers',
    'tab\there',
    'line\nbreak',
    "cook's and cooks and woops",
    'aéb',
    'emoji \u2764 test'
];
const benignDirty = BENIGN.filter(s => stars(client('false', s)) > 0);
check(`benign corpus is unmasked by vanilla (${BENIGN.length} strings)`, benignDirty.length === 0, benignDirty.length ? JSON.stringify(benignDirty.slice(0, 3)) : '');
const fmtMismatch = BENIGN.filter(s => client('false', s) !== client('true', s));
check(`${BENIGN.length} benign strings identical in both modes`, fmtMismatch.length === 0, fmtMismatch.length ? JSON.stringify(fmtMismatch.slice(0, 3)) : '');
check('capitals are preserved exactly as upstream preserves them', client('true', 'Hello World') === 'Hello World' && client('true', 'hELLO wORLD') === 'hello world', `${JSON.stringify(client('true', 'Hello World'))} / ${JSON.stringify(client('true', 'hELLO wORLD'))}`);
check('format() still runs with the filter off (disallowed char -> space)', client('true', 'aéb') === 'a b', JSON.stringify(client('true', 'aéb')));
check('format() still collapses runs of spaces', client('true', 'a  b') === 'a b', JSON.stringify(client('true', 'a  b')));
check('determinism (same input, same output twice)', BENIGN.every(s => client('true', s) === client('true', s) && client('false', s) === client('false', s)));

// ---- 6. the engine half -----------------------------------------------------
console.log('\nengine (WordEnc.filter — the server stops pre-censoring):');
if (!hasEngine) {
    console.log('  ! engine/src/cache/wordenc/WordEnc.ts not found in this tree — engine checks skipped');
} else {
    const EngineJagfile: any = (await import(fileURL(`${TREE}/engine/src/io/Jagfile.ts`))).default;
    check('WordEnc.censor is false (the shipped policy)', WordEnc.censor === false);
    WordEnc.readAll(EngineJagfile.load(jagPath));
    const engOff = BAD.filter(w => stars(WordEnc.filter(w)) > 0);
    check(`engine passes all ${BAD.length} bad words through`, engOff.length === 0, engOff.length ? `still starred: ${engOff.slice(0, 5).join(', ')}` : '');
    const engDom = domProbes.filter(s => stars(WordEnc.filter(s)) > 0);
    check(`engine passes all ${DOMAINS.length} domains through`, engDom.length === 0);
    const engLines = LINES.filter(s => stars(WordEnc.filter(s)) > 0);
    check(`engine passes all ${LINES.length} chat lines through`, engLines.length === 0);
    check('engine formatting is the client\u2019s formatting (same shape)', WordEnc.filter('a  b\u00e9') === client('true', 'a  b\u00e9'), `${JSON.stringify(WordEnc.filter('a  b\u00e9'))} vs ${JSON.stringify(client('true', 'a  b\u00e9'))}`);
    WordEnc.censor = true;
    const engMasked = BAD.filter(w => stars(WordEnc.filter(w)) > 0);
    check('flipping censor back to true restores masking (the guard wraps the passes, not the method)', engMasked.length >= BAD.length - 10, `${engMasked.length}/${BAD.length} masked`);
    check('engine keeps formatting with the guard on too', WordEnc.filter('a  b\u00e9') === client('false', 'a  b\u00e9'));
    WordEnc.censor = false;
}

// ---- report ------------------------------------------------------------------
console.log('');
if (failures.length) {
    console.log(`FAIL: ${failures.length} of ${checks} checks failed`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
}
console.log(`OK: all ${checks} checks passed`);
