// lclite:ground-items functional test — runs the REAL payload (files/webclient/src/
// client/GroundItems.ts, the same file `apply` copies into the tree) headlessly:
//
//   bun run mods/ground-items/tools/ground_items_test.ts        (from anywhere)
//
// Set LCLITE_ROOT=<install> to test the copy inside an applied tree; it prints which
// file it loaded either way.
//
// What a browser cannot tell us cheaply, and what this covers:
//  1. the high-alch value — it must equal what the SERVER pays, which is
//     max(scale(6, 10, cost), 1) in content/scripts/skill_magic/scripts/spells/
//     alchemy.rs2. The expected column below is written out by hand from that
//     formula, not recomputed from the payload.
//  2. the settings parse — a stale or hand-typed localStorage value must never paint
//     garbage (bad colour → default, junk threshold → 0, out-of-range → clamped).
//  3. the shown/hidden list edits — RuneLite's updateList semantics: case-insensitive,
//     toggling, and never on both lists at once.
//  4. the classification table — which of the three label classes an item lands in,
//     including the two edges (0 = "no value filter" and Alt-held).
//  5. the +/- box hit test — the boxes the Alt-click consumes, including overlap order.
import path from 'node:path';

const LCLITE = path.resolve(import.meta.dir, '../../..');
const PAYLOAD = path.join(LCLITE, 'mods/ground-items/files/webclient/src/client/GroundItems.ts');
const CORE = process.env.LCLITE_ROOT
    ? path.join(process.env.LCLITE_ROOT, 'webclient/src/client/GroundItems.ts')
    : PAYLOAD;

console.log('\nground-items test — core: ' + CORE);
const G: any = await import(new URL('file://' + CORE.replace(/\\/g, '/')).href);

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra?: any) {
    if (cond) { pass++; console.log('  ✓ ' + msg); }
    else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}
function eq(got: any, want: any, msg: string) { ok(JSON.stringify(got) === JSON.stringify(want), msg, { got, want }); }

const store = (kv: Record<string, string>) => (key: string) => (key in kv ? kv[key] : null);

// ---- 1. the high alch value (the server's own numbers) ----------------------------
// cost -> the coins `max(scale(6, 10, cost), 1)` hands over, checked by hand:
//   0 -> 1, 1 -> 1, 5 -> 3, 100 -> 60, 1000 -> 600, 12345 -> 7407, 2_100_000 -> 1_260_000
console.log('\nhigh alch value');
eq(G.giHaValue(0), 1, 'cost 0 still alchs for 1 (the server clamps to 1)');
eq(G.giHaValue(1), 1, 'cost 1 -> 1');
eq(G.giHaValue(5), 3, 'cost 5 -> 3');
eq(G.giHaValue(100), 60, 'cost 100 -> 60');
eq(G.giHaValue(1000), 600, 'cost 1000 -> 600');
eq(G.giHaValue(12345), 7407, 'cost 12345 -> 7407 (integer 0.6, floored)');
eq(G.giHaValue(2100000), 1260000, 'cost 2.1m -> 1.26m');
eq(G.giHaValue(-50), 1, 'a negative cost cannot produce a negative value');
// an item whose 0.6 lands on 0.4 must NOT round up
eq(G.giHaValue(9), 5, 'cost 9 -> 5 (5.4 floored, not rounded)');

// ---- 2. stack-size formatting ----------------------------------------------------
console.log('\nstack size');
eq(G.giStackSize(1), '1', '1');
eq(G.giStackSize(999), '999', '999');
eq(G.giStackSize(9999), '9999', '9999 (no suffix below 10K)');
eq(G.giStackSize(12345), '12.3K', '12345 -> 12.3K');
eq(G.giStackSize(23400), '23.4K', '23400 -> 23.4K');
eq(G.giStackSize(100000), '100K', '100000 -> 100K (a .0 suffix is dropped)');
eq(G.giStackSize(250000), '250K', '250000 -> 250K');
eq(G.giStackSize(1500000), '1.5M', '1.5m -> 1.5M (not RuneLite\'s 1500K)');
eq(G.giStackSize(12500000), '12.5M', '12.5m -> 12.5M');

// ---- 3. the settings parse -------------------------------------------------------
console.log('\nsettings');
const def = G.giSettings(store({}));
eq(def.on, true, 'no key at all = the mod is on (only the literal "false" turns it off)');
eq(def.minValue, 0, 'no threshold key = 0 (label everything)');
eq(def.showValue, false, 'value display is off by default');
eq(def.shownCsv, '', 'shown list starts empty');
eq(def.hiddenCsv, '', 'hidden list starts empty');
eq(def.color, 0xffffff, 'default label colour is white');
eq(def.highlightColor, 0xff9040, 'default shown-item colour is RuneLite-ish gold');
eq(def.hiddenColor, 0x808080, 'default hidden colour is grey');

eq(G.giSettings(store({ groundItems: 'false' })).on, false, '"false" turns the mod off');
eq(G.giSettings(store({ groundItems: 'junk' })).on, true, 'junk in the master key leaves it on');

eq(G.giSettings(store({ groundItemsValue: 'junk' })).minValue, 0, 'a junk threshold reads as 0');
eq(G.giSettings(store({ groundItemsValue: '-500' })).minValue, 0, 'a negative threshold is clamped to 0');
eq(G.giSettings(store({ groundItemsValue: '99999999' })).minValue, 1000000, 'a huge threshold is clamped to 1m');
eq(G.giSettings(store({ groundItemsValue: '2500' })).minValue, 2500, 'a real threshold survives');

eq(G.giSettings(store({ groundItemsColor: '#ff0000' })).color, 0xff0000, 'a valid hex colour is parsed');
eq(G.giSettings(store({ groundItemsColor: '#ff00' })).color, 0xffffff, 'a short hex falls back to white');
eq(G.giSettings(store({ groundItemsColor: 'ff0000' })).color, 0xffffff, 'a missing # falls back to white');
eq(G.giSettings(store({ groundItemsColor: '#zzzzzz' })).color, 0xffffff, 'a non-hex body falls back to white');

// ---- 4. list parsing + edits -----------------------------------------------------
console.log('\nname lists');
eq(G.giSplit(null), [], 'null parses to an empty list');
eq(G.giSplit(''), [], 'empty parses to an empty list');
eq(G.giSplit(' Bones ,, Ashes ,'), ['Bones', 'Ashes'], 'blanks and stray spaces are dropped');

ok(G.giListHas('Bones, Ashes', 'bones'), 'list membership is case-insensitive');
ok(G.giListHas('Bones, Ashes', 'ASHES'), 'list membership ignores case both ways');
ok(!G.giListHas('Bones', 'Big bones'), 'a longer name is not a substring match');
ok(!G.giListHas('Bones', ''), 'an empty name never matches');

eq(G.giListEdit('', 'Bones', true), 'Bones', 'adding to an empty list');
eq(G.giListEdit('Bones', 'Ashes', true), 'Bones, Ashes', 'adding appends');
eq(G.giListEdit('Bones, Ashes', 'bones', true), 'Ashes, bones', 're-adding replaces the entry rather than duplicating it by casing');
eq(G.giListEdit('Bones, Ashes', 'Bones', false), 'Ashes', 'removing drops the entry');
eq(G.giListEdit('Bones', 'Ashes', false), 'Bones', 'removing something absent changes nothing');
eq(G.giListEdit('bones', 'Bones', true), 'Bones', 'the list keeps the game\'s own capitalisation');
eq(G.giListEdit('Bones', '', true), 'Bones', 'an empty name is refused');

// ---- 5. classification -----------------------------------------------------------
console.log('\nclassification');
const HIDDEN = G.GI_HIDDEN, SHOWN = G.GI_SHOWN, LISTED = G.GI_LISTED;
eq(G.giClassify('Bones', 1, '', '', 0), SHOWN, 'threshold 0 labels everything not hidden');
eq(G.giClassify('Bones', 1, '', 'Bones', 0), HIDDEN, 'the hidden list wins');
eq(G.giClassify('Bones', 1, 'Bones', 'Bones', 0), HIDDEN, 'hidden beats shown when a name is on both');
eq(G.giClassify('Bones', 1, 'Bones', '', 0), LISTED, 'the shown list is its own class');
eq(G.giClassify('Rune platebody', 23400, '', '', 10000), SHOWN, 'above the threshold is labelled');
eq(G.giClassify('Rune platebody', 23400, '', '', 50000), HIDDEN, 'below the threshold is not');
eq(G.giClassify('Rune platebody', 23400, '', '', 23400), HIDDEN, '"above" is strict — the value itself does not qualify');
eq(G.giClassify('Bones', 1, '', '', 10000), HIDDEN, 'a cheap item is dropped once a threshold is set');
eq(G.giClassify('Bones', 1, 'Bones', '', 10000), LISTED, 'the shown list survives a threshold');

// ---- 6. the label text -----------------------------------------------------------
console.log('\nlabel text');
eq(G.giLabel('Bones', 1, 1, false), 'Bones', 'a plain single item is just its name');
eq(G.giLabel('Coins', 250, 1, false), 'Coins (250)', 'a stack shows its size');
eq(G.giLabel('Coins', 1500000, 1, false), 'Coins (1.5M)', 'a big stack is abbreviated');
eq(G.giLabel('Rune platebody', 1, 23400, true), 'Rune platebody (23.4K gp)', 'the value is appended when asked for');
eq(G.giLabel('Rune platebody', 1, 23400, false), 'Rune platebody', 'and left off when not');
eq(G.giLabel('Coins', 250, 1, true), 'Coins (250)', 'a 1gp item never grows a value (coins stay clean)');
eq(G.giLabel('Bones', 5, 1, true), 'Bones (5)', 'value display on a 1gp item is still suppressed');

// ---- 7. the distance cull + the box hit test -------------------------------------
console.log('\ndistance + hit test');
ok(G.giDistanceOk(0, 0), 'standing on the item is in range');
ok(G.giDistanceOk(2500, 0), 'exactly RuneLite\'s cutoff is in range');
ok(!G.giDistanceOk(2501, 0), 'one unit past it is out');
ok(!G.giDistanceOk(1800, 1800), 'the cull is a radius, not a box (diagonal)');
eq(G.GI_MAX_DISTANCE, 2500, 'the cutoff is RuneLite\'s own 2500 local units');

// The arrays below are the REAL layout the engine records for one label: textX=12,
// width=30, textY=30, rowH=15 -> label box (10,13,34,19), [-] box (44,19,8,8), [+] box
// (54,19,8,8). The two boxes sit 2px apart, which is the one gap a click can fall into.
const xs = new Int32Array([10, 44, 54]), ys = new Int32Array([13, 19, 19]);
const ws = new Int32Array([34, 8, 8]), hs = new Int32Array([19, 8, 8]);
eq(G.giHit(xs, ys, ws, hs, 3, 0, 0), -1, 'outside every box misses');
eq(G.giHit(xs, ys, ws, hs, 3, 20, 20), 0, 'inside the label box hits it');
eq(G.giHit(xs, ys, ws, hs, 3, 46, 22), 1, 'the [-] box hits');
eq(G.giHit(xs, ys, ws, hs, 3, 56, 22), 2, 'the [+] box hits');
eq(G.giHit(xs, ys, ws, hs, 3, 53, 22), -1, 'the 2px gap between the two boxes misses');
eq(G.giHit(xs, ys, ws, hs, 3, 44, 19), 1, 'the box\'s top-left pixel is inside');
eq(G.giHit(xs, ys, ws, hs, 3, 52, 19), -1, 'one pixel past the [-] box is outside');
eq(G.giHit(xs, ys, ws, hs, 3, 10, 32), -1, 'one pixel below the label box is outside');
eq(G.giHit(xs, ys, ws, hs, 3, 43, 20), 0, 'the label box\'s last pixel is still the label');
eq(G.giHit(xs, ys, ws, hs, 0, 20, 20), -1, 'an empty box list misses');
// later boxes win: they were drawn last, so they are the ones on screen
const oxs = new Int32Array([10, 12]), oys = new Int32Array([10, 12]);
const ows = new Int32Array([30, 30]), ohs = new Int32Array([14, 14]);
eq(G.giHit(oxs, oys, ows, ohs, 2, 20, 20), 1, 'the box drawn last wins an overlap');

// ---- 8. the Alt state ------------------------------------------------------------
console.log('\nalt state');
eq(G.giAltHeld(), false, 'Alt starts up');
G.giAltSet(true);
eq(G.giAltHeld(), true, 'Alt can be set');
G.giAltSet(false);
eq(G.giAltHeld(), false, 'and cleared');
ok(typeof G.giTrackAlt === 'function', 'giTrackAlt exists for the engine hook to call every frame');

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
