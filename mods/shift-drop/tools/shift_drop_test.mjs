/* mods/shift-drop/tools/shift_drop_test.mjs — harness for the shift-click-drop rule.
 *
 * shiftDropIndex() is the whole mod: which menu entry counts as "Drop". It runs the
 * REAL method out of the patched Client.ts (type annotations stripped, MiniMenuAction
 * and localStorage stubbed) so the rules are checked rather than eyeballed:
 *   - it matches the LABEL the player sees, restricted to item-op actions, so a
 *     bank/trade/shop inventory (Withdraw-1 / Deposit-5 / Remove-All) never matches;
 *   - it never reads entries at or above menuNumEntries — those hold the PREVIOUS
 *     buildMinimenu()'s text and would drop the wrong item;
 *   - the mod's own key turns it off.
 *
 * Usage:  LCLITE_ROOT=<install> node mods/shift-drop/tools/shift_drop_test.mjs
 * Exit code 0 = all checks passed.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || process.env.LCLITE_ROOT || path.join(process.env.LOCALAPPDATA ?? '', 'LCLite', 'installs', '289');
const file = path.join(root, 'webclient', 'src', 'client', 'Client.ts');

if (!fs.existsSync(file)) {
    console.error(`no Client.ts at ${file}\npass LCLITE_ROOT (or the install path) as argv[2]`);
    process.exit(2);
}

const src = fs.readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');   // sources are CRLF
const start = src.indexOf('private shiftDropIndex(): number {');
if (start === -1) {
    console.error('shiftDropIndex() not found — is the shift-drop mod applied?');
    process.exit(2);
}
const end = src.indexOf('\n    }\n', start);
if (end === -1) {
    console.error('shiftDropIndex() body not terminated as expected');
    process.exit(2);
}
let method = src.slice(start, end + 6);
// strip the TS bits the runtime does not have (fail loudly rather than silently)
const strips = [
    ['private shiftDropIndex(): number {', 'function shiftDropIndex() {'],
    ['const option: string = ', 'const option = '],
    ['const action: number = ', 'const action = '],
    ['for (let i: number = ', 'for (let i = '],
];
for (const [from, to] of strips) {
    if (!method.includes(from)) {
        console.error(`harness out of date: expected \`${from}\` in shiftDropIndex()`);
        process.exit(2);
    }
    method = method.replace(from, to);
}

// MiniMenuAction values the rule filters on (kept in sync with src/client/MiniMenuAction.ts)
const MM = { OP_HELD1: 694, OP_HELD2: 962, OP_HELD3: 795, OP_HELD4: 681, OP_HELD5: 100, INV_BUTTON1: 582, INV_BUTTON2: 113, INV_BUTTON3: 555, INV_BUTTON4: 331, INV_BUTTON5: 354, OP_HELD6: 1328, USEHELD_START: 102, WALK: 718 };

const store = new Map();
const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
const make = new Function('MiniMenuAction', 'localStorage', `${method}\nreturn shiftDropIndex;`);
const shiftDropIndex = make(MM, localStorage);

// helper: how the engine fills the menu (index 0 = Cancel, last index = the default op)
const menu = entries => ({
    menuNumEntries: entries.length,
    menuOption: entries.map(e => e.option),
    menuAction: entries.map(e => e.action),
});

let pass = 0;
const failures = [];
const check = (label, got, want) => {
    if (got === want) { pass++; return; }
    failures.push(`${label}: got ${got}, want ${want}`);
};
const call = entries => shiftDropIndex.call(menu(entries));

// 1. a normal item whose menu carries Drop (obj.iop default puts it at op5)
const inventoryItem = [
    { option: 'Cancel', action: 1106 },
    { option: 'Examine @lre@Rune scimitar', action: MM.OP_HELD6 },
    { option: 'Drop @lre@Rune scimitar', action: MM.OP_HELD5 },
    { option: 'Wield @lre@Rune scimitar', action: MM.OP_HELD1 },
];
check('inventory item: Drop found', call(inventoryItem), 2);

// 2. an interface whose ops are all other things (bank / trade / shop)
check('bank withdraw menu: no match', call([
    { option: 'Cancel', action: 1106 },
    { option: 'Examine @lre@Coins', action: MM.OP_HELD6 },
    { option: 'Withdraw-5 @lre@Coins', action: MM.INV_BUTTON2 },
    { option: 'Withdraw-1 @lre@Coins', action: MM.INV_BUTTON1 },
]), -1);

// 3. a "Destroy" item: no Drop option -> falls through to normal behaviour
check('destroy item: no match', call([
    { option: 'Cancel', action: 1106 },
    { option: 'Destroy @lre@Crystal key', action: MM.OP_HELD5 },
    { option: 'Wield @lre@Crystal key', action: MM.OP_HELD1 },
]), -1);

// 4. armoured: every op is Drop-labelled only for the drop entry
check('worn item: Drop found', call([
    { option: 'Cancel', action: 1106 },
    { option: 'Drop @lre@Rune platebody', action: MM.OP_HELD5 },
    { option: 'Remove @lre@Rune platebody', action: MM.OP_HELD1 },
]), 1);

// 5. STALE TEXT: entries past menuNumEntries must never be read (they are the previous
//    menu's text, and reading them would drop the wrong item)
const stale = {
    menuNumEntries: 2,
    menuOption: ['Cancel', 'Examine @lre@Coins', 'Drop @lre@Rune scimitar', 'Wield @lre@Rune scimitar'],
    menuAction: [1106, MM.OP_HELD6, MM.OP_HELD5, MM.OP_HELD1],
};
check('stale entries beyond menuNumEntries ignored', shiftDropIndex.call(stale), -1);

// 6. index 0 (Cancel) is never considered
check('index 0 is never the drop', call([
    { option: 'Drop @lre@Nothing', action: MM.OP_HELD5 },
]), -1);

// 7. the same entry behind a priority (Add friend / Report abuse) reordering
check('priority-reordered menu', call([
    { option: 'Cancel', action: 1106 },
    { option: 'Drop @lre@Coins', action: MM.OP_HELD5 },
    { option: 'Add friend @whi@Zezima', action: 2605 },
]), 1);

// 8. the mod's own key turns it off
localStorage.setItem('shiftDrop', 'false');
check('shiftDrop=false: nothing matches', call(inventoryItem), -1);
localStorage.setItem('shiftDrop', 'true');
check('shiftDrop=true: back on', call(inventoryItem), 2);

// 9. a "Drop" label on a non-item action is not an item op
check('non-item action ignored', call([
    { option: 'Cancel', action: 1106 },
    { option: 'Drop @lre@signpost', action: MM.WALK },
]), -1);

for (const f of failures) console.log(`FAIL ${f}`);
console.log(`\n${pass} passed, ${failures.length} failed${failures.length ? '' : ' — shift-click-drop rule intact'}`);
process.exit(failures.length ? 1 : 0);
