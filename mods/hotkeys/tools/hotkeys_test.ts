// lclite:hotkeys functional test — runs the REAL core (files/webclient/src/client/
// Hotkeys.ts, the same file `apply` copies into the tree) headlessly, plus the
// panel↔core mirror checks that keep the duplicated key list honest.
//
//   bun run mods/hotkeys/tools/hotkeys_test.ts        (from anywhere)
//
// Covers: key-name normalisation, the settings defaults, and the whole claim
// decision table (tab keys, Esc's three jobs, the chat lock's Enter/Backspace
// transitions, printable-key yielding, camera keys with and without the lock).
import path from 'node:path';

const LCLITE = path.resolve(import.meta.dir, '../../..');
const CORE = path.join(LCLITE, 'mods/hotkeys/files/webclient/src/client/Hotkeys.ts');
const PANEL = path.join(LCLITE, 'mods/control-panel/files/engine/public/lclite/panel.js');

const H: any = await import(new URL('file://' + CORE.replace(/\\/g, '/')).href);

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra?: any) {
    if (cond) { pass++; console.log('  ✓ ' + msg); }
    else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}
function eq(got: any, want: any, msg: string) { ok(JSON.stringify(got) === JSON.stringify(want), msg, { got, want }); }

// ---- settings from a plain store (no localStorage needed) -------------------
const store = (kv: Record<string, string>) => (key: string, def: string) => (key in kv ? kv[key] : def);
const S = (kv: Record<string, string> = {}) => H.hotkeysReadSettings(store(kv));

console.log('\nkey names');
eq(H.hotkeysKeyName('Escape'), 'Esc', 'Escape → Esc (the binding string)');
eq(H.hotkeysKeyName('PageUp'), 'PgUp', 'PageUp → PgUp');
eq(H.hotkeysKeyName('PageDown'), 'PgDn', 'PageDown → PgDn');
eq(H.hotkeysKeyName('w'), 'W', 'a letter upper-cases (Shift-proof)');
eq(H.hotkeysKeyName('-'), '-', 'punctuation is unchanged');
eq(H.hotkeysKeyName('F1'), 'F1', 'function keys are unchanged');
eq(H.hotkeysKeyName('Tab'), 'Tab', 'Tab is unchanged');
eq(H.hotkeysKeyName('Enter'), 'Enter', 'Enter is unchanged');

console.log('\ndefaults (empty store)');
const d = S();
eq([d.on, d.fkeys, d.escClose, d.space, d.numbers, d.wasd, d.lock], [true, true, true, true, true, false, true], 'master/F-keys/Esc/Space/dialogues on, WASD off, chat lock on');
eq(d.tabs, H.HOTKEYS_TAB_DEFAULTS, 'tab bindings = the OSRS default map');
eq([d.camUp, d.camDown, d.camLeft, d.camRight], ['W', 'S', 'A', 'D'], 'camera keys default to WASD');
eq(H.HOTKEYS_TABS.length, 14, '14 sidebar slots (0..13)');
eq(H.HOTKEYS_TABS[7][0], '', 'slot 7 has no interface in this rev (no row, no binding)');
eq(H.hotkeysTabKey(7), '', 'slot 7 has no localStorage key');
eq(H.hotkeysTabKey(3), 'hotkeysKeyInventory', 'slot 3 → hotkeysKeyInventory');
eq(H.hotkeysTabKey(4), 'hotkeysKeyWorn', 'slot 4 → hotkeysKeyWorn');

console.log('\nkey list integrity');
eq(H.HOTKEYS_KEY_CHOICES[0], 'None', 'the list starts with None');
ok(new Set(H.HOTKEYS_KEY_CHOICES).size === H.HOTKEYS_KEY_CHOICES.length, 'no duplicate keys in the list');
ok(H.HOTKEYS_KEY_CHOICES.includes('PgDn') && H.HOTKEYS_KEY_CHOICES.includes('Z'), 'the list reaches punctuation and letters');
ok(!H.HOTKEYS_KEY_CHOICES.includes('Delete'), 'Delete is absent (the engine maps it to Backspace)');

// ---- the decision table ----------------------------------------------------
const ctx = (key: string, over: any = {}) => ({
    key,
    printable: key.length === 1,
    modified: over.modified ?? false,
    settings: S(over.store || {}),
    typing: over.typing ?? false,
    chatLen: over.chatLen ?? 0,
    modalOpen: over.modalOpen ?? false,
    textInputOpen: over.textInputOpen ?? false,
    inGame: over.inGame ?? true,
    designScreen: over.designScreen ?? false,
    dialogueContinue: over.dialogueContinue ?? false,
    dialogueOptions: over.dialogueOptions ?? 0
});
const A = H; // action constants
const name = (a: number) => ['PASS', 'CLAIM', 'TAB', 'CLOSE', 'CLEAR_CHAT', 'CAMERA', 'CONTINUE', 'OPTION'][a] ?? ('?' + a);

console.log('\ntab keys (defaults: F-keys on, WASD off)');
for (const [key, tab] of [['F1', 0], ['F2', 1], ['F3', 2], ['F4', 4], ['F5', 5], ['F6', 6], ['F8', 8], ['F9', 10], ['F10', 11]] as [string, number][]) {
    const r = H.hotkeysDecide(ctx(key));
    ok(r.action === A.HOTKEYS_TAB && r.tab === tab, `${key} opens tab ${tab} (${H.HOTKEYS_TABS[tab][1]})`, name(r.action) + ':' + r.tab);
}
ok(H.hotkeysDecide(ctx('F7')).action === A.HOTKEYS_PASS, 'F7 is unbound (no clan-chat tab in 2004) → passes through');
ok(H.hotkeysDecide(ctx('F12')).action === A.HOTKEYS_PASS, 'F12 is unbound by default (the browser owns F11/F12)');
ok(H.hotkeysDecide(ctx('Q')).action === A.HOTKEYS_PASS, 'an unbound letter passes through');
ok(H.hotkeysDecide(ctx('F1', { store: { hotkeysFkeys: 'false' } })).action === A.HOTKEYS_PASS, 'F-key tabs off → F1 passes through');
ok(H.hotkeysDecide(ctx('F1', { store: { hotkeys: 'false' } })).action === A.HOTKEYS_PASS, 'mod off → F1 passes through');
ok(H.hotkeysDecide(ctx('F1', { modified: true })).action === A.HOTKEYS_PASS, 'Ctrl/Alt/Meta + F1 is never claimed');
ok(H.hotkeysDecide(ctx('F1', { textInputOpen: true })).action === A.HOTKEYS_PASS, 'a text-input modal owns the keyboard');
ok(H.hotkeysDecide(ctx('F1', { inGame: false })).action === A.HOTKEYS_PASS, 'the login screen keeps its keys (nothing is claimed before login)');
ok(H.hotkeysDecide(ctx('W', { store: { hotkeysWasd: 'true' }, inGame: false })).action === A.HOTKEYS_PASS, 'the login screen keeps its letters too (WASD on)');
ok(H.hotkeysDecide(ctx('Enter', { store: { hotkeysWasd: 'true' }, inGame: false })).typing === false, 'the login screen never unlocks the chatbox');
ok(H.hotkeysDecide(ctx('F1', { chatLen: 3 })).action === A.HOTKEYS_TAB, 'F-keys still work while a chat line is live');
const dbl = S({ hotkeysKeyInventory: 'F3' });
ok(H.hotkeysDecide({ ...ctx('F3'), settings: dbl }).tab === 2, 'first bound slot wins when two tabs share a key');

console.log("\nEsc: typing → clear, modal → close, else the bound tab");
ok(H.hotkeysDecide(ctx('Esc')).action === A.HOTKEYS_TAB, 'Esc with nothing open switches to Inventory (OSRS)');
ok(H.hotkeysDecide(ctx('Esc', { modalOpen: true })).action === A.HOTKEYS_CLOSE, 'Esc closes the open interface');
ok(H.hotkeysDecide(ctx('Esc', { modalOpen: true, store: { hotkeysEscClose: 'false' } })).action === A.HOTKEYS_TAB, 'Esc-close off → Esc only switches tabs');
ok(H.hotkeysDecide(ctx('Esc', { chatLen: 3 })).action === A.HOTKEYS_CLEAR_CHAT, 'Esc discards a half-typed chat line');
ok(H.hotkeysDecide(ctx('Esc', { chatLen: 3, modalOpen: true })).action === A.HOTKEYS_CLEAR_CHAT, 'the chat line is emptied before any interface closes');
ok(H.hotkeysDecide(ctx('Esc', { chatLen: 0, store: { hotkeysKeyInventory: 'None' } })).action === A.HOTKEYS_PASS, 'Esc unbound + nothing open → passes through');
ok(H.hotkeysDecide(ctx('Esc', { modalOpen: true, designScreen: true })).action === A.HOTKEYS_TAB, 'the character-design screen is exempt: Esc does not close it (tutorial soft-lock)');
ok(H.hotkeysDecide(ctx('Esc', { modalOpen: true, designScreen: true, store: { hotkeysKeyInventory: 'None' } })).action === A.HOTKEYS_PASS, 'design screen + Inventory unbound → Esc does nothing at all');

console.log('\nWASD camera + chat lock (WASD on, lock on)');
const wasd = { hotkeysWasd: 'true' };
for (const [key, dir] of [['W', 3], ['S', 4], ['A', 1], ['D', 2]] as [string, number][]) {
    const r = H.hotkeysDecide(ctx(key, { store: wasd }));
    ok(r.action === A.HOTKEYS_CAMERA && r.dir === dir, `${key} drives camera dir ${dir}`, name(r.action) + ':' + r.dir);
}
ok(H.hotkeysDecide(ctx('W', { store: { hotkeysWasd: 'false' } })).action === A.HOTKEYS_PASS, 'WASD off → W passes through (types into chat)');
ok(H.hotkeysDecide(ctx('Q', { store: wasd })).action === A.HOTKEYS_CLAIM, 'locked chatbox swallows an unbound letter too');
ok(H.hotkeysDecide(ctx(' ', { store: wasd })).action === A.HOTKEYS_CLAIM, 'locked chatbox swallows Space');
const enter = H.hotkeysDecide(ctx('Enter', { store: wasd }));
ok(enter.action === A.HOTKEYS_PASS && enter.typing === true, 'Enter opens the locked chatbox (and reaches the engine)');
const colon = H.hotkeysDecide(ctx(':', { store: wasd }));
ok(colon.action === A.HOTKEYS_PASS && colon.typing === true, '":" opens the locked chatbox (RuneLite parity, minus "/")');
ok(H.hotkeysDecide(ctx('F1', { store: wasd })).action === A.HOTKEYS_TAB, 'F-keys still work while the chatbox is locked');
ok(H.hotkeysDecide(ctx('W', { store: wasd, typing: true })).action === A.HOTKEYS_PASS, 'typing: W types, it does not rotate');
ok(H.hotkeysDecide(ctx('Q', { store: wasd, typing: true })).action === A.HOTKEYS_PASS, 'typing: letters are never swallowed');
const send = H.hotkeysDecide(ctx('Enter', { store: wasd, typing: true, chatLen: 5 }));
ok(send.action === A.HOTKEYS_PASS && send.typing === false, 'Enter sends the message and re-locks');
const relock = H.hotkeysDecide(ctx('Backspace', { store: wasd, typing: true, chatLen: 1 }));
ok(relock.action === A.HOTKEYS_PASS && relock.typing === false, 'backspacing the line empty re-locks');
ok(H.hotkeysDecide(ctx('Backspace', { store: wasd, typing: true, chatLen: 3 })).typing === true, 'backspacing mid-line stays unlocked');
const escType = H.hotkeysDecide(ctx('Esc', { store: wasd, typing: true }));
ok(escType.action === A.HOTKEYS_CLEAR_CHAT && escType.typing === false, 'Esc leaves typing mode (and never touches interfaces)');
ok(H.hotkeysDecide(ctx('Esc', { store: wasd, typing: true, chatLen: 4 })).action === A.HOTKEYS_CLEAR_CHAT, 'Esc while typing discards the line');
ok(H.hotkeysDecide(ctx('Esc', { store: wasd, typing: true, modalOpen: true })).action === A.HOTKEYS_CLEAR_CHAT, 'Esc while typing does not close the interface behind it');
ok(H.hotkeysDecide(ctx('W', { store: { hotkeysWasd: 'true', hotkeysChatLock: 'false' }, chatLen: 0 })).action === A.HOTKEYS_CAMERA, 'lock off: W rotates while the chat line is empty');
ok(H.hotkeysDecide(ctx('W', { store: { hotkeysWasd: 'true', hotkeysChatLock: 'false' }, chatLen: 2 })).action === A.HOTKEYS_PASS, 'lock off: W types once a chat line exists');
ok(H.hotkeysDecide(ctx('Q', { store: { hotkeysWasd: 'true', hotkeysChatLock: 'false' } })).action === A.HOTKEYS_PASS, 'lock off: only the bound camera keys are claimed');

console.log('\nrebinding + the release side');
const cam = S({ hotkeysWasd: 'true', hotkeysKeyCamUp: 'Q', hotkeysKeyCamLeft: 'I' });
ok(H.hotkeysDecide({ ...ctx('Q'), settings: cam }).dir === 3, 'camera up rebound to Q');
ok(H.hotkeysDecide({ ...ctx('W'), settings: cam }).action === A.HOTKEYS_CLAIM, 'W is free once the camera moved off it (swallowed while locked)');
ok(H.hotkeysDecide({ ...ctx('I'), settings: cam }).dir === 1, 'camera left rebound to I');
eq(H.hotkeysCameraDir('W', cam), 0, 'keyup: W is no longer a camera key');
eq(H.hotkeysCameraDir('Q', cam), 3, 'keyup: Q releases the up direction');
eq(H.hotkeysCameraDir('S', cam), 4, 'keyup: S still releases down');
eq(H.hotkeysCameraDir('W', S()), 0, 'keyup: WASD off → nothing to release');
eq(H.hotkeysCameraDir('W', S({ hotkeysWasd: 'true' })), 3, 'keyup: WASD on → W releases up');
eq(H.hotkeysCameraDir('W', S({ hotkeysWasd: 'true', hotkeys: 'false' })), 0, 'keyup: mod off → nothing to release');

console.log('\nper-frame chat prompt read');
const locked = (kv: Record<string, string>, typing = false) => H.hotkeysLocked(store(kv), typing);
ok(locked({ hotkeysWasd: 'true' }) === true, 'WASD + lock on → the prompt is live');
ok(locked({ hotkeysWasd: 'true' }, true) === false, 'typing → no prompt');
ok(locked({ hotkeysWasd: 'false' }) === false, 'WASD off → no prompt (the lock is meaningless without it)');
ok(locked({ hotkeysWasd: 'true', hotkeysChatLock: 'false' }) === false, 'lock off → no prompt');
ok(locked({ hotkeysWasd: 'true', hotkeys: 'false' }) === false, 'mod off → no prompt');

console.log('\noption rows + the continue button (the pure shape policy)');
const OK = H.HOTKEYS_BUTTON_OK, CONT = H.HOTKEYS_BUTTON_CONTINUE;
// Fixtures transcribed from this rev's own interfaces
// (content/scripts/interface_chat/interfaces/*.if); the content-tree check at the
// bottom of this file re-derives them from the real files when an install is present.
const rowset = (rs: any[]) => rs.map((r, i) => ({ id: 900 + i, x: r[0], y: r[1], width: r[2], height: r[3], text: r[4], button: r[5] }));
const MULTI3 = rowset([[0, 23, 480, 17, 'option1', OK], [0, 47, 480, 17, 'option2', OK], [0, 71, 480, 17, 'option3', OK]]);
const MULTI5 = rowset([[0, 15, 480, 16, 'a', OK], [0, 31, 480, 16, 'b', OK], [0, 47, 480, 16, 'c', OK], [0, 63, 480, 16, 'd', OK], [0, 79, 480, 16, 'e', OK]]);
const MULTIOBJ2 = rowset([[74, 16, 100, 93, 'Make X', OK], [305, 16, 100, 93, 'Make X', OK]]);
const SKILL_MULTI3 = rowset([
    [38, 16, 100, 93, 'Make X', OK], [38, 16, 100, 93, 'Make 10', OK], [38, 16, 100, 93, 'Make 5', OK], [38, 16, 100, 93, 'Make 1', OK],
    [189, 16, 100, 93, 'Make X', OK], [189, 16, 100, 93, 'Make 10', OK], [189, 16, 100, 93, 'Make 5', OK], [189, 16, 100, 93, 'Make 1', OK],
    [342, 16, 100, 93, 'Make X', OK], [342, 16, 100, 93, 'Make 10', OK], [342, 16, 100, 93, 'Make 5', OK], [342, 16, 100, 93, 'Make 1', OK]
]);
const NPCCHAT = rowset([[34, 34, 32, 32, '', 0], [111, 0, 350, 17, 'Name', 0], [111, 80, 350, 17, 'Click here to continue', CONT]]);

eq(H.hotkeysOptionRows(MULTI3).map((r: any) => r.text), ['option1', 'option2', 'option3'], 'multi3: the three options, top to bottom');
eq(H.hotkeysOptionRows(MULTI3)[2].id, 902, 'the option a key picks is the row\'s own component id');
eq(H.hotkeysOptionRows(MULTI5).length, 5, 'multi5: five options');
eq(H.hotkeysOptionRows([...MULTI3].reverse()).map((r: any) => r.text), ['option1', 'option2', 'option3'], 'the order is geometric, not the child order');
eq(H.hotkeysOptionRows(MULTIOBJ2), [], 'multiobj2 (a row of equal-y item cells) is refused');
eq(H.hotkeysOptionRows(SKILL_MULTI3), [], 'skill_multi3 (four buttons on ONE line per item) is refused');
eq(H.hotkeysOptionRows(NPCCHAT), [], 'a chat box with no option rows is refused');
eq(H.hotkeysOptionRows(MULTI3.slice(0, 1)), [], 'one button is not a numbered list');
eq(H.hotkeysOptionRows(MULTI5.concat([{ id: 999, x: 0, y: 95, width: 480, height: 16, text: 'sixth', button: OK }])), [], 'six options is past the number row (1-5)');
eq(H.hotkeysOptionRows(MULTI3.concat([{ id: 999, x: 0, y: 30, width: 480, height: 17, text: 'overlapping', button: OK }])), [], 'a row overlapping the one above is not a list');
eq(H.hotkeysOptionRows(MULTI3.concat([{ id: 999, x: 200, y: 95, width: 100, height: 17, text: 'indented', button: OK }])), [], 'a row off the column\'s left edge is not a list');
eq(H.hotkeysOptionRows(MULTI3.concat([{ id: 999, x: 0, y: 95, width: 480, height: 17, text: '', button: OK }])).map((r: any) => r.text), ['option1', 'option2', 'option3'], 'a button with no text is ignored (it cannot shift the numbering)');
eq(H.hotkeysOptionRows(MULTI3.concat([{ id: 999, x: 0, y: 95, width: 480, height: 17, text: 'wait', button: CONT }])), ['option1', 'option2', 'option3'].map((t: string, i: number) => MULTI3[i]), 'a continue button is never an option');

eq(H.hotkeysContinueRow(NPCCHAT)!.id, 902, 'the continue button is the pause-typed component');
eq(H.hotkeysContinueRow(NPCCHAT)!.text, 'Click here to continue', 'and its own text comes along');
eq(H.hotkeysContinueRow(MULTI3), null, 'a dialogue with options has no continue button (Space does nothing there)');
eq(H.hotkeysContinueRow([{ id: 1, x: 0, y: 0, width: 1, height: 1, text: '', button: CONT }]), null, 'a continue button with no text is not one');
eq(H.hotkeysContinueRow([{ id: 1, x: 0, y: 0, width: 1, height: 1, text: 'Ok', button: OK }]), null, 'a plain Ok button is not a continue button');

console.log('\nSpace + the number row (the decision)');
const r3 = { dialogueOptions: 3 };
ok(H.hotkeysDecide(ctx(' ', { dialogueContinue: true })).action === A.HOTKEYS_CONTINUE, 'Space advances the open dialogue');
ok(H.hotkeysDecide(ctx(' ', { dialogueContinue: true, store: wasd })).action === A.HOTKEYS_CONTINUE, 'Space beats the locked chatbox (a dialogue owns the key)');
ok(H.hotkeysDecide(ctx(' ', { dialogueContinue: true, store: wasd })).typing === false, 'advancing a dialogue never unlocks the chatbox');
ok(H.hotkeysDecide(ctx(' ', {})).action === A.HOTKEYS_PASS, 'no dialogue → Space still types a space');
ok(H.hotkeysDecide(ctx(' ', { store: wasd })).action === A.HOTKEYS_CLAIM, 'no dialogue + locked chatbox → Space is swallowed as before');
ok(H.hotkeysDecide(ctx(' ', { dialogueContinue: true, typing: true, store: wasd })).action === A.HOTKEYS_PASS, 'a live chat line keeps Space');
ok(H.hotkeysDecide(ctx(' ', { dialogueContinue: true, store: { hotkeysSpace: 'false' } })).action === A.HOTKEYS_PASS, 'the Space toggle off → Space types again');
ok(H.hotkeysDecide(ctx(' ', { dialogueContinue: true, store: { hotkeys: 'false' } })).action === A.HOTKEYS_PASS, 'mod off → nothing is claimed');
ok(H.hotkeysDecide(ctx(' ', { dialogueContinue: true, modified: true })).action === A.HOTKEYS_PASS, 'Ctrl/Alt/Meta + Space is never claimed');
ok(H.hotkeysDecide(ctx(' ', { dialogueContinue: true, inGame: false })).action === A.HOTKEYS_PASS, 'the login screen keeps Space');
ok(H.hotkeysDecide(ctx(' ', { dialogueContinue: true, textInputOpen: true })).action === A.HOTKEYS_PASS, 'an enter-amount box keeps Space');

for (const [key, option] of [['1', 1], ['2', 2], ['3', 3]] as [string, number][]) {
    const r = H.hotkeysDecide(ctx(key, r3));
    ok(r.action === A.HOTKEYS_OPTION && r.option === option, `${key} picks option ${option} of a 3-option dialogue`, name(r.action) + ':' + r.option);
}
ok(H.hotkeysDecide(ctx('4', r3)).action === A.HOTKEYS_PASS, 'a number past the dialogue\'s own count falls through');
ok(H.hotkeysDecide(ctx('0', r3)).action === A.HOTKEYS_PASS, '0 is not an option key');
ok(H.hotkeysDecide(ctx('6', r3)).action === A.HOTKEYS_PASS, '6 is past the number row');
ok(H.hotkeysDecide(ctx('5', { dialogueOptions: 5 })).option === 5, 'a five-option dialogue reaches 5');
ok(H.hotkeysDecide(ctx('1', {})).action === A.HOTKEYS_PASS, 'no dialogue → 1 is not claimed');
ok(H.hotkeysDecide(ctx('1', r3)).action === A.HOTKEYS_OPTION, 'the digit is claimed while the dialogue is up');
ok(H.hotkeysDecide(ctx('1', { ...r3, store: wasd })).action === A.HOTKEYS_OPTION, 'numbers beat the locked chatbox too');
ok(H.hotkeysDecide(ctx('1', { ...r3, typing: true, store: wasd })).action === A.HOTKEYS_PASS, 'a live chat line keeps the digits');
ok(H.hotkeysDecide(ctx('1', { ...r3, store: { hotkeysNumbers: 'false' } })).action === A.HOTKEYS_PASS, 'the numbers toggle off → the digits are free again');
const tabOn1 = { hotkeysKeyInventory: '1' };
ok(H.hotkeysDecide(ctx('1', { ...r3, store: tabOn1 })).action === A.HOTKEYS_OPTION, 'a digit bound to a tab picks the option while a dialogue is up');
ok(H.hotkeysDecide(ctx('1', { store: tabOn1 })).action === A.HOTKEYS_TAB, 'and opens the tab once the dialogue is gone');
ok(H.hotkeysDecide(ctx('1', { ...r3, store: { ...tabOn1, hotkeysNumbers: 'false' } })).action === A.HOTKEYS_TAB, 'numbers off → the tab binding gets the digit back, dialogue or not');
ok(H.hotkeysDecide(ctx('1', { ...r3, store: { hotkeysFkeys: 'false' } })).action === A.HOTKEYS_OPTION, 'the option key does not depend on the tab keys');

console.log('\nthe ButtonType mirror (the core spells the engine\'s enum out)');
{
    const contentRoot = process.env.LCLITE_ROOT || 'C:/Users/canno/AppData/Local/LCLite/installs/289';
    const ifType = Bun.file(path.join(contentRoot, 'webclient/src/config/IfType.ts'));
    if (await ifType.exists()) {
        const src = await ifType.text();
        const value = (n: string) => Number((src.match(new RegExp('\\b' + n + ' = (\\d+)')) ?? [])[1]);
        eq(H.HOTKEYS_BUTTON_OK, value('BUTTON_OK'), 'HOTKEYS_BUTTON_OK === ButtonType.BUTTON_OK');
        eq(H.HOTKEYS_BUTTON_CONTINUE, value('BUTTON_CONTINUE'), 'HOTKEYS_BUTTON_CONTINUE === ButtonType.BUTTON_CONTINUE');
    } else {
        console.log(`  · skipped: no webclient at ${contentRoot} (set LCLITE_ROOT to check)`);
    }
}

console.log('\nthe policy against the rev\'s own interface files');
{
    const contentRoot = process.env.LCLITE_ROOT || 'C:/Users/canno/AppData/Local/LCLite/installs/289';
    const dir = path.join(contentRoot, 'content/scripts/interface_chat/interfaces');
    if (await Bun.file(path.join(dir, 'multi3.if')).exists()) {
        // one .if block → one HotkeysRow, exactly as the client hands them over
        const ifRows = (src: string) => {
            const out: any[] = [];
            for (const block of src.split(/\r?\n(?=\[)/)) {
                if (!/^\[/.test(block)) continue;
                const kv: Record<string, string> = {};
                for (const line of block.split('\n').slice(1)) {
                    const i = line.indexOf('=');
                    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
                }
                if (!kv.buttontype) continue;
                const button = kv.buttontype === 'pause' ? H.HOTKEYS_BUTTON_CONTINUE : kv.buttontype === 'normal' ? H.HOTKEYS_BUTTON_OK : 0;
                out.push({ id: out.length + 1, x: +(kv.x ?? 0), y: +(kv.y ?? 0), width: +(kv.width ?? 0), height: +(kv.height ?? 0), text: kv.text ?? kv.option ?? '', button });
            }
            return out;
        };
        const readIf = async (f: string) => ifRows(await Bun.file(path.join(dir, f)).text());
        eq(H.hotkeysOptionRows(await readIf('multi2.if')).length, 2, 'multi2.if is a 2-option list');
        eq(H.hotkeysOptionRows(await readIf('multi3.if')).length, 3, 'multi3.if is a 3-option list');
        eq(H.hotkeysOptionRows(await readIf('multi4.if')).length, 4, 'multi4.if is a 4-option list');
        eq(H.hotkeysOptionRows(await readIf('multi5.if')).length, 5, 'multi5.if is a 5-option list');
        eq(H.hotkeysOptionRows(await readIf('multi5dupe.if')).length, 5, 'multi5dupe.if is a 5-option list');
        eq(H.hotkeysOptionRows(await readIf('multiobj2.if')), [], 'multiobj2.if (item cells side by side) is refused');
        eq(H.hotkeysOptionRows(await readIf('multiobj3.if')), [], 'multiobj3.if is refused');
        eq(H.hotkeysOptionRows(await readIf('multiobj4.if')), [], 'multiobj4.if is refused');
        eq(H.hotkeysOptionRows(await readIf('skill_multi3.if')), [], 'skill_multi3.if (Make-X) is refused');
        eq(H.hotkeysOptionRows(await readIf('skill_multi5.if')), [], 'skill_multi5.if (Make-X) is refused');
        eq(H.hotkeysOptionRows(await readIf('npcchat1.if')), [], 'npcchat1.if has no options');
        ok(H.hotkeysContinueRow(await readIf('npcchat1.if')) !== null, 'npcchat1.if offers a continue button');
        ok(H.hotkeysContinueRow(await readIf('message1.if')) !== null, 'message1.if offers a continue button');
        ok(H.hotkeysContinueRow(await readIf('objbox1.if')) !== null, 'objbox1.if offers a continue button');
        ok(H.hotkeysContinueRow(await readIf('multi3.if')) === null, 'multi3.if offers none (a dialogue with options)');
    } else {
        console.log(`  · skipped: no content tree at ${dir}`);
    }
}

// ---- the panel's mirror of the core ----------------------------------------
console.log('\npanel ↔ core mirror (panel.js duplicates the key list by hand)');
const panelSrc = await Bun.file(PANEL).text();
const keysBlock = panelSrc.match(/const HK_KEYS = \[([\s\S]*?)\];/);
const tabsBlock = panelSrc.match(/const HK_TABS = \[([\s\S]*?)\n {4}\];/);
ok(!!keysBlock && !!tabsBlock, 'panel.js still declares HK_KEYS and HK_TABS');
if (keysBlock && tabsBlock) {
    const panelKeys: string[] = new Function(`return [${keysBlock[1]}]`)();
    eq(panelKeys, H.HOTKEYS_KEY_CHOICES, 'panel key list === HOTKEYS_KEY_CHOICES');
    const panelTabs: string[][] = new Function(`return [${tabsBlock[1]}]`)();
    const named = H.HOTKEYS_TABS.map((t: string[], i: number) => [t[0], H.HOTKEYS_TAB_DEFAULTS[i]]).filter((t: string[]) => t[0] !== '');
    eq(panelTabs.map((t: string[]) => t[1]), named.map((t: string[]) => t[0]), 'panel tab rows cover every named slot, in order');
    eq(panelTabs.map((t: string[]) => t[2]), named.map((t: string[]) => t[1]), 'panel tab defaults === HOTKEYS_TAB_DEFAULTS');
    for (const [id, key, def] of [['hk-cam-up', 'hotkeysKeyCamUp', 'W'], ['hk-cam-down', 'hotkeysKeyCamDown', 'S'], ['hk-cam-left', 'hotkeysKeyCamLeft', 'A'], ['hk-cam-right', 'hotkeysKeyCamRight', 'D']]) {
        ok(panelSrc.includes(`'${id}'`) && panelSrc.includes(`'${key}'`) && panelSrc.includes(`'${def}'`), `panel row ${id} → ${key} (default ${def})`);
    }
    for (const [id, key] of [['hk-space', 'hotkeysSpace'], ['hk-numbers', 'hotkeysNumbers']]) {
        ok(panelSrc.includes(`'${id}'`) && panelSrc.includes(`'${key}'`) && panelSrc.includes(`'${key}', kind: 'toggle', def: 'true'`), `panel row ${id} → ${key} (toggle, default on)`);
    }
    ok(panelSrc.includes(`hotkeysBinding('F1')`), 'the panel yields F1 to the game while a tab is bound to it');

    // the mod's one-line description is duplicated in tools/lib.mjs MOD_META and the
    // panel's MOD_REGISTRY — doctor checks the pair, so catch a one-sided edit here
    const libSrc = await Bun.file(path.join(LCLITE, 'tools/lib.mjs')).text();
    const descOf = (src: string, re: RegExp) => (src.match(re) ?? [])[1];
    const metaDesc = descOf(libSrc, /'hotkeys': \{\s*label: 'Hotkeys',\s*desc: '([^']*)'/);
    const registryDesc = descOf(panelSrc, /\{ id: 'hotkeys', name: 'Hotkeys', desc: '([^']*)'/);
    ok(!!metaDesc && !!registryDesc && metaDesc === registryDesc, 'the Hotkeys one-line description matches in tools/lib.mjs and panel.js', { metaDesc, registryDesc });
}

// ---- the payload the tree actually runs ------------------------------------
console.log('\npayload ↔ installed tree');
const root = process.env.LCLITE_ROOT || 'C:/Users/canno/AppData/Local/LCLite/installs/289';
const treeCore = path.join(root, 'webclient/src/client/Hotkeys.ts');
const treeFile = Bun.file(treeCore);
if (await treeFile.exists()) {
    const a = new Uint8Array(await treeFile.arrayBuffer());
    const b = new Uint8Array(await Bun.file(CORE).arrayBuffer());
    ok(a.length === b.length && a.every((v, i) => v === b[i]), 'the tree copy is byte-identical to the payload (apply is up to date)');
} else {
    console.log(`  · skipped: no install at ${root} (set LCLITE_ROOT to check)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
