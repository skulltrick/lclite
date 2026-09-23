/* mods/rotten-potato/tools/rotten_potato_test.mjs — the mod's headless harness.
 *
 *   $LOCALAPPDATA/Temp/bunx/bun-windows-x64/bun.exe mods/rotten-potato/tools/rotten_potato_test.mjs
 *
 * It exercises the REAL shipped core (files/.../core.js) — the catalogue, the
 * command-string builder, the search and the CSV helpers — and, when it can find
 * a Lost City tree (LCLITE_ROOT, or a sibling content/ + engine/ next to the
 * overlay), it checks the catalogue AGAINST THE SOURCES rather than trusting it:
 *
 *   · every `~name` entry must exist as a `[debugproc,name]` proc in the content
 *     repo's scripts, with the same argument count;
 *   · every non-`~` entry must be a command the engine's own ClientCheatHandler
 *     dispatches (`cmd === 'name'`) or one of the client-side ones the webclient
 *     implements (::fpson / ::fpsoff / ::fps N / ::tcg).
 *
 * That is the point: the palette can only ever offer commands that exist. A
 * missing tree downgrades those checks to a warning, never a false pass.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
    VERSION, CATEGORIES, COMMANDS, SKILLS, byId,
    commandLine, parseRaw, searchCommands, csvList, csvAdd, csvToggle, normalizeName, argValue, haystack
} from '../files/engine/public/lclite/rotten-potato/core.js';

let pass = 0, fail = 0, warn = 0;
const ok = (cond, what) => { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + what); } };
const note = (what) => { warn++; console.log('  ~ ' + what); };

const KINDS = ['skill', 'number', 'item', 'name', 'coord', 'player', 'text', 'select'];
const CATS = CATEGORIES.map((c) => c.id);

// ---- shape ----------------------------------------------------------------
console.log('catalogue shape');
ok(typeof VERSION === 'number' && VERSION >= 1, 'VERSION is a number');
ok(COMMANDS.length > 100, 'the catalogue has real depth (' + COMMANDS.length + ' commands)');
const ids = new Set();
for (const c of COMMANDS) {
    ok(!!c.id && !ids.has(c.id), 'unique id: ' + c.id);
    ids.add(c.id);
    ok(CATS.indexOf(c.cat) !== -1, c.id + ': category is declared');
    ok(!!c.label && !!c.cmd, c.id + ': label + cmd');
    ok(!c.cmd.startsWith('::') && !c.cmd.startsWith('~ ') && c.cmd === c.cmd.trim(), c.id + ': cmd is a bare body');
    ok(!/\s/.test(c.cmd), c.id + ': cmd is one token (' + c.cmd + ')');
    ok(typeof c.note === 'string' && c.note.length > 8, c.id + ': has a note');
    for (const a of c.args || []) {
        ok(!!a.name && KINDS.indexOf(a.kind) !== -1, c.id + '/' + a.name + ': known arg kind');
        if (a.kind === 'select') { ok((a.options || []).length > 0, c.id + '/' + a.name + ': select has options'); }
        if (a.kind === 'number') { ok(!isNaN(parseInt(a.def, 10)), c.id + '/' + a.name + ': numeric default'); }
        if (a.kind === 'skill') { ok(SKILLS.indexOf(a.def) !== -1, c.id + '/skill: default is a real skill'); }
    }
}
ok(CATEGORIES.length === 6, 'six categories (::~help\'s five + the staff set)');

// ---- the built line -------------------------------------------------------
console.log('command lines');
const line = (id, values) => commandLine(byId(id), values || []);
ok(line('give', ['rune_axe', '5']) === '::give rune_axe 5', 'give with a name + amount');
ok(line('give', ['Rune Axe', '']) === '::give rune_axe 1', 'give: spaces -> underscores, lowercased, amount defaults to 1');
ok(line('givemany', ['lobster']) === '::givemany lobster', 'givemany takes the name alone');
ok(line('maxme') === '::~maxme', 'a debug proc keeps its tilde (::~maxme)');
ok(line('advancestat', ['attack', '99']) === '::advancestat attack 99', 'advancestat: skill + level');
ok(line('advancestat', ['ATTACK', '500']) === '::advancestat attack 99', 'advancestat: skill normalised, level clamped to 99');
ok(line('advancestat', ['notaskill', '70']) === '::advancestat attack 70', 'advancestat: unknown skill falls back to attack');
ok(line('north', ['5']) === '::~north 5', 'direction teleport carries its distance');
ok(line('tele', ['0,50,50,22,22']) === '::tele 0,50,50,22,22', 'tele: the coord keeps its commas');
ok(line('tele', ['0 50 50 22 22']) === '::tele 050502222', 'tele: anything but digits/commas is stripped');
ok(line('tele', ['']) === '::tele 0,50,50,22,22', 'tele: empty falls back to the default coord');
ok(line('clearinv', []) === '::~clearinv inv', 'clearinv defaults to the inventory');
ok(line('clearinv', ['worn']) === '::~clearinv worn', 'clearinv takes another inventory');
ok(line('objbox', ['dragon bones']) === '::~objbox dragon_bones', 'a name arg normalises too');
ok(line('broadcast', ['world restarting in 5']) === '::broadcast world restarting in 5', 'text args keep their spaces');
ok(line('giveother', ['Zezima', 'rune_axe', '2']) === '::giveother Zezima rune_axe 2', 'player names pass through untouched');
ok(line('locadd', ['tree']) === '::locadd tree', 'engine locadd takes a name');
ok(line('npc', ['king_dragon']) === '::~npc king_dragon', 'debug proc npc takes a name');
ok(line('setvar', ['heroquest', '4']) === '::setvar heroquest 4', 'setvar: name + value');
ok(line('fps', ['50']) === '::fps 50', 'the client-side ::fps');
ok(line('fpson') === '::fpson', 'the client-side ::fpson');
for (const c of COMMANDS) {
    const l = commandLine(c, []);
    ok(l.startsWith('::') && l.length <= 79, c.id + ': default line fits the chat line (' + l.length + ')');
    ok(!/ {2}/.test(l), c.id + ': no double spaces in the default line');
}

// ---- raw / search / favourites -------------------------------------------
console.log('raw, search, favourites');
ok(parseRaw('maxme') === '::maxme', 'raw: a bare word becomes an engine command');
ok(parseRaw('~maxme') === '::~maxme', 'raw: a leading tilde is preserved as typed');
ok(parseRaw('::~maxme') === '::~maxme', 'raw: a pasted command is not double-prefixed');
ok(parseRaw('  ::give rune_axe  ') === '::give rune_axe', 'raw: trimmed');
ok(parseRaw('') === '', 'raw: empty stays empty');
ok(searchCommands(COMMANDS, 'rune_axe', null).length > 0, 'search finds an item name from an arg placeholder');
ok(searchCommands(COMMANDS, 'teleport', null).length > 5, 'search finds a word in labels');
ok(searchCommands(COMMANDS, 'maxme', null).some((c) => c.id === 'maxme'), 'search finds by id');
ok(searchCommands(COMMANDS, '~bank', null).every((c) => haystack(c).indexOf('bank') !== -1), 'search: ~bank is a substring match');
ok(searchCommands(COMMANDS, 'give', 'items').every((c) => c.cat === 'items'), 'search respects the category');
ok(searchCommands(COMMANDS, 'quest tele', null).every((c) => haystack(c).indexOf('quest') !== -1 && haystack(c).indexOf('tele') !== -1), 'multi-token search ANDs');
ok(searchCommands(COMMANDS, '', 'quests').length > 15, 'an empty query lists the whole category');
ok(normalizeName('  Dragon   BONES ') === 'dragon_bones', 'normalizeName collapses whitespace');
ok(argValue({ kind: 'number', def: 5, min: 1, max: 9 }, '50') === '9', 'numbers clamp to max');
ok(argValue({ kind: 'number', def: 5 }, 'abc') === '5', 'a junk number falls back to the default');
ok(csvToggle('a,b', 'c') === 'a,b,c' && csvToggle('a,b', 'a') === 'b', 'favourites toggle');
ok(csvAdd('b,a', 'a', 8) === 'a,b', 'recents move the newest to the front');
ok(csvAdd('a,b,c', 'd', 2) === 'd,a', 'recents are capped');
ok(csvList(' a , ,b ') .join('|') === 'a|b', 'CSV parsing drops blanks');

// ---- against the sources --------------------------------------------------
console.log('against the sources');
const root = process.env.LCLITE_ROOT || path.resolve(import.meta.dir, '../../..');
const contentDir = path.join(root, 'content', 'scripts');
const engineCheat = path.join(root, 'engine', 'src', 'network', 'game', 'client', 'handler', 'ClientCheatHandler.ts');
const clientTs = path.join(root, 'webclient', 'src', 'client', 'Client.ts');

if (!fs.existsSync(contentDir) || !fs.existsSync(engineCheat)) {
    note('no Lost City tree at ' + root + ' — source cross-checks skipped (set LCLITE_ROOT)');
} else {
    // every debug proc, with its declared parameter count, straight off the content repo
    const procs = new Map();
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { walk(p); } else if (e.name.endsWith('.rs2')) {
                for (const line of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
                    const m = line.match(/^\[debugproc,([a-z0-9_]+)\]\s*(\(([^)]*)\))?/);
                    if (m) { procs.set(m[1], (m[3] || '').split(',').filter((s) => s.trim() !== '').length); }
                }
            }
        }
    };
    walk(contentDir);

    // every engine command the cheat handler dispatches
    const cheat = fs.readFileSync(engineCheat, 'utf-8');
    const engineCmds = new Set([...cheat.matchAll(/cmd === '([a-z0-9_]+)'/g)].map((m) => m[1]));
    const clientCmds = new Set(['fpson', 'fpsoff', 'fps', 'tcg']);   // the webclient's own :: branches

    let procChecked = 0, cmdChecked = 0;
    for (const c of COMMANDS) {
        const tilde = c.cmd.startsWith('~');
        const name = tilde ? c.cmd.slice(1) : c.cmd;
        if (tilde) {
            ok(procs.has(name), 'debug proc exists in content: ::~' + name);
            if (procs.has(name)) {
                procChecked++;
                ok(procs.get(name) === (c.args || []).length, '::~' + name + ': arg count matches the proc (' + procs.get(name) + ')');
            }
        } else {
            ok(engineCmds.has(name) || clientCmds.has(name), 'engine/client command exists: ::' + name);
            cmdChecked++;
        }
    }
    console.log('  · ' + procChecked + ' debug procs and ' + cmdChecked + ' engine commands verified against the sources');

    // the engine half this mod ships must be exactly where the page expects it
    if (fs.existsSync(clientTs)) {
        const src = fs.readFileSync(clientTs, 'utf-8');
        ok(src.includes("(window as any)['rottenPotatoCmd']"), 'Client.ts carries the command handoff');
        ok(/chatModalId === -1 \|\| typeof \(window as any\)\['rottenPotatoCmd'\] === 'string'/.test(src), 'Client.ts widens the chatbox guard for exactly this handoff');
        const bundle = path.join(root, 'webclient', 'bundle.ts');
        ok(fs.readFileSync(bundle, 'utf-8').includes("'rottenPotatoCmd'"), "bundle.ts reserves 'rottenPotatoCmd' (a cross-realm name must be)");
    }
}

console.log('\n' + (fail ? '✗ ' : '✔ ') + pass + ' checks passed' + (fail ? ', ' + fail + ' FAILED' : '') + (warn ? ', ' + warn + ' skipped' : ''));
process.exit(fail ? 1 : 0);
