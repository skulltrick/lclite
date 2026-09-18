// lclite:wiki-lookup functional test — runs the REAL core (files/webclient/src/client/
// WikiLookup.ts, the same file `apply` copies into the tree) headlessly:
//
//   bun run mods/wiki-lookup/tools/wiki_lookup_test.ts        (from anywhere)
//
// Set LCLITE_ROOT=<install> to test the copy inside an applied tree; it prints which
// file it loaded either way.
//
// Covers what a browser cannot tell us cheaply:
//  1. the target parse against the EXACT option formats the 289 client builds (quoted
//     from addWorldOptions/addNpcOptions/addPlayerOptions/addChatOptions and the item
//     branch of addComponentOptions) — including the NPC combat-level colour and
//     ' (level-N)' suffix, and every non-entity menu the client also builds;
//  2. the URL builder (page vs search, spaces, apostrophes, reserved characters);
//  3. the settings parse/clamp table (master, minimap button, menu row, style);
//  4. the classic menu PLAN and the insertion itself — replayed against the client's own
//     menu sort, to prove the two invariants that keep that row safe: it lands on the
//     bottom row (index 1, above 'Cancel'), and it can never become the top row, which
//     IS the left-click default. It also proves the insertion moves no engine row;
//  5. the ARMED plan (the minimap button's lookup mode) — that it only ever fires while
//     armed, and that it takes the TOP row, which is the left-click default;
//  6. the minimap button: its default placement inside the panel's free stone strip, the
//     placement-key maths the panel's drag layer writes, the hit test, and the PIXELS —
//     every pixel of the disc opaque, nothing painted outside the box, and idle / hover /
//     armed / pulse all visibly different states.
import path from 'node:path';

const LCLITE = path.resolve(import.meta.dir, '../../..');
const PAYLOAD = path.join(LCLITE, 'mods/wiki-lookup/files/webclient/src/client/WikiLookup.ts');
const CORE = process.env.LCLITE_ROOT
    ? path.join(process.env.LCLITE_ROOT, 'webclient/src/client/WikiLookup.ts')
    : PAYLOAD;

console.log('\nwiki-lookup test — core: ' + CORE);
const W: any = await import(new URL('file://' + CORE.replace(/\\/g, '/')).href);

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra?: any) {
    if (cond) { pass++; console.log('  ✓ ' + msg); }
    else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}
function eq(got: any, want: any, msg: string) { ok(JSON.stringify(got) === JSON.stringify(want), msg, { got, want }); }

// ---- the menu action id ------------------------------------------------------
// MiniMenuAction's own numbers, copied from webclient/src/client/MiniMenuAction.ts.
// Our id must be outside that set (a collision would dispatch somebody else's action)
// and > 1000 (the engine's sort only moves entries > 1000, so the classic row stays
// where it is put — see the insertion checks below).
const ENUM = [
    2000, 899, 625, 721, 743, 357, 1071, 810, 240, 242, 209, 309, 852, 793, 829,
    370, 139, 778, 617, 224, 662, 111, 131, 639, 957, 499, 27, 387, 507, 185, 275,
    563, 694, 962, 795, 681, 100, 398, 582, 113, 555, 331, 354, 718, 231, 274, 737,
    435, 225, 997, 102, 1381, 1714, 1152, 1328, 1106, 524, 605, 47, 513, 884, 902
];

console.log('\naction id');
ok(!ENUM.includes(W.WIKI_LOOKUP_ACTION), 'WIKI_LOOKUP_ACTION is not a MiniMenuAction value', W.WIKI_LOOKUP_ACTION);
ok(W.WIKI_LOOKUP_ACTION > 1000 && W.WIKI_LOOKUP_ACTION < 2000, 'it is >1000 (immobile in the engine sort) and below _PRIORITY', W.WIKI_LOOKUP_ACTION);
// _PRIORITY + x combinations the engine builds for chat rows and for NPCs above your
// combat level: all >= 2000, so our range can never collide with one of those either.
ok(W.WIKI_LOOKUP_ACTION < 2000, 'and below every _PRIORITY (2000+) combination the engine builds');

// ---- target parse -----------------------------------------------------------
const tgt = (s: string) => { const t = W.wikiLookupTarget(s); return t ? [t.name, t.kind] : null; };

console.log('\ntarget parse — the client\'s own option formats');
eq(tgt('Chop down @cya@Tree'), ['Tree', 'object'], 'loc op: chop down Tree');
eq(tgt('Examine @cya@Bank booth'), ['Bank booth', 'object'], 'loc examine');
eq(tgt('Use Rune scimitar with @cya@Oak'), ['Oak', 'object'], 'use-item-on-loc takes the TARGET, not the held item');
eq(tgt('Cast @cya@Chest'), ['Chest', 'object'], 'spell target on a loc');
eq(tgt('Attack @yel@Goblin@yel@ (level-2)'), ['Goblin', 'npc'], 'npc op: the level suffix and its colour tag are dropped');
eq(tgt('Attack @yel@Greater demon@red@ (level-92)'), ['Greater demon', 'npc'], 'a much stronger npc (red level colour)');
eq(tgt('Talk-to @yel@Man@gr1@ (level-2)'), ['Man', 'npc'], 'and a much weaker one (green level colour)');
eq(tgt('Trade @yel@Shop keeper@or1@ (level-3)'), ['Shop keeper', 'npc'], 'orange level colour');
eq(tgt('Use Rune scimitar with @yel@Goblin@yel@ (level-2)'), ['Goblin', 'npc'], 'use-item-on-npc');
eq(tgt('Examine @yel@Chicken@gre@ (level-1)'), ['Chicken', 'npc'], 'npc examine');
eq(tgt('Wield @lre@Rune scimitar'), ['Rune scimitar', 'item'], 'inventory op (wield)');
eq(tgt('Drop @lre@Coins'), ['Coins', 'item'], 'inventory drop (the label shift-drop matches too)');
eq(tgt('Examine @lre@Coins'), ['Coins', 'item'], 'inventory examine');
eq(tgt('Withdraw-1 @lre@Shark'), ['Shark', 'item'], 'bank row');
eq(tgt('Withdraw-All @lre@Bones'), ['Bones', 'item'], 'bank row, hyphenated op');
eq(tgt('Buy 10 @lre@Rune platebody'), ['Rune platebody', 'item'], 'shop row');
eq(tgt('Take @lre@Coins'), ['Coins', 'item'], 'ground item');
eq(tgt('Use Rune scimitar with @lre@Shark'), ['Shark', 'item'], 'use-item-on-item');
eq(tgt('Sell 5 @lre@Lobster'), ['Lobster', 'item'], 'shop sell row');

console.log('\ntarget parse — everything that must NOT get a page');
eq(tgt('Cancel'), null, 'Cancel');
eq(tgt('Walk here @whi@Tree'), null, 'Walk here (its tooltip is white-tagged)');
eq(tgt('Walk here'), null, 'bare Walk here');
eq(tgt('Attack @whi@Zezima@whi@ (level-126)'), null, 'a PLAYER is not a wiki entity');
eq(tgt('Follow @whi@Zezima@whi@ (level-126)'), null, 'player follow');
eq(tgt('Trade with @whi@Zezima@whi@ (level-126)'), null, 'player trade');
eq(tgt('Add friend @whi@Bob'), null, 'chat row');
eq(tgt('Add ignore @whi@Bob'), null, 'ignore row');
eq(tgt('Report abuse @whi@Bob'), null, 'report row');
eq(tgt('Accept trade @whi@Bob'), null, 'trade request row');
eq(tgt('Remove @whi@Bob'), null, 'friend-list remove');
eq(tgt('Message @whi@Bob'), null, 'message row');
eq(tgt('Set up'), null, 'a plain interface button (no colour tag at all)');
eq(tgt('Close'), null, 'an interface close button');
eq(tgt('Deposit'), null, 'a bank button');
eq(tgt(''), null, 'an empty option (defensive: stale array slots)');
eq(W.wikiLookupTarget('Examine @cya@   '), null, 'a tag with nothing after it');

console.log('\ntarget parse — the labels round-trip');
for (const s of ['Chop down @cya@Tree', 'Attack @yel@Goblin@yel@ (level-2)', 'Wield @lre@Rune scimitar']) {
    const t = W.wikiLookupTarget(s);
    const back = W.wikiLookupTarget(W.wikiLookupLabel(t));
    eq(back ? [back.name, back.kind, back.tag] : null, [t.name, t.kind, t.tag], 'label of ' + JSON.stringify(s) + ' re-parses to the same target');
}
eq(W.wikiLookupLabel(W.wikiLookupTarget('Chop down @cya@Tree')), 'Wiki @cya@Tree', 'the classic row reads "Wiki <target>" in the engine\'s own colour');
// the ARMED row must round-trip through the same parse — it is the row doAction reads
eq(W.wikiLookupLookupLabel(W.wikiLookupTarget('Chop down @cya@Tree')), 'Lookup @cya@Tree', 'the armed row reads "Lookup <target>"');
for (const s of ['Chop down @cya@Tree', 'Attack @yel@Goblin@yel@ (level-2)', 'Wield @lre@Rune scimitar']) {
    const t = W.wikiLookupTarget(s);
    const back = W.wikiLookupTarget(W.wikiLookupLookupLabel(t));
    eq(back ? [back.name, back.kind, back.tag] : null, [t.name, t.kind, t.tag], 'the armed label of ' + JSON.stringify(s) + ' re-parses to the same target');
}

// ---- URL --------------------------------------------------------------------
console.log('\nurl builder');
eq(W.wikiLookupUrl('Rune scimitar', 'page'), 'https://oldschool.runescape.wiki/w/Rune_scimitar?utm_source=lclite', 'page style: spaces become underscores');
eq(W.wikiLookupUrl('Goblin', 'page'), 'https://oldschool.runescape.wiki/w/Goblin?utm_source=lclite', 'page style: plain name');
eq(W.wikiLookupUrl('Rune scimitar', 'search'), 'https://oldschool.runescape.wiki/w/Special:Search?search=Rune%20scimitar&utm_source=lclite', 'search style');
eq(W.wikiLookupUrl('Goblin', 'anything-else'), 'https://oldschool.runescape.wiki/w/Goblin?utm_source=lclite', 'an unknown style falls back to the page form');
ok(W.wikiLookupUrl('Guard dog', 'page').indexOf(' ') === -1, 'no raw space survives into the page url');
eq(W.wikiLookupUrl("Bob's axe", 'page'), "https://oldschool.runescape.wiki/w/Bob's_axe?utm_source=lclite", 'an apostrophe is left as-is (a valid MediaWiki title)');
ok(W.wikiLookupUrl('A & B', 'page').indexOf('&') === -1, 'an ampersand is encoded (it would otherwise start a query parameter)');
ok(W.wikiLookupUrl('50% off', 'page').indexOf('50%25') !== -1, 'a percent sign is encoded');
ok(W.wikiLookupUrl('  Rune   scimitar  ', 'page').indexOf('/w/Rune_scimitar?') !== -1, 'stray whitespace is normalised');

// ---- settings ---------------------------------------------------------------
const store = (kv: Record<string, string>) => (key: string) => (key in kv ? kv[key] : null);
const S = (kv: Record<string, string> = {}) => W.wikiLookupSettings(store(kv));
const look = (s: any) => [s.enabled, s.button, s.menu, s.style];

console.log('\nsettings defaults (empty store = a fresh install)');
eq(look(S()), [true, true, 'off', 'page'], 'defaults: on, minimap button on, menu row OFF, direct page');
eq(look(S({ wikiLookup: 'true' })), [true, true, 'off', 'page'], 'explicit on');
eq(look(S({ wikiLookup: 'false' })), [false, true, 'off', 'page'], "'false' is the only value that disables the master");
eq(look(S({ wikiLookup: 'nonsense' })), [true, true, 'off', 'page'], 'garbage in the master key leaves it on');
eq(look(S({ wikiLookupButton: 'false' })), [true, false, 'off', 'page'], 'the minimap button can be switched off');
eq(look(S({ wikiLookupButton: 'nonsense' })), [true, true, 'off', 'page'], 'garbage in the button key leaves it on');
eq(look(S({ wikiLookupStyle: 'search' })), [true, true, 'off', 'search'], 'search style');
eq(look(S({ wikiLookupStyle: 'SEARCH' })), [true, true, 'off', 'page'], 'the style is matched exactly, not case-folded');
eq(look(S({ wikiLookupStyle: 'nope' })), [true, true, 'off', 'page'], 'an unknown style clamps to the page form');
eq(look(S({ wikiLookupMenu: 'always' })), [true, true, 'always', 'page'], 'the menu row can be made permanent');
eq(look(S({ wikiLookupMenu: 'shift' })), [true, true, 'shift', 'page'], 'shift menu row');
eq(look(S({ wikiLookupMenu: 'ctrl' })), [true, true, 'ctrl', 'page'], 'ctrl menu row');
eq(look(S({ wikiLookupMenu: 'alt' })), [true, true, 'alt', 'page'], 'alt menu row');
eq(look(S({ wikiLookupMenu: 'off' })), [true, true, 'off', 'page'], 'explicit off');
eq(look(S({ wikiLookupMenu: 'none' })), [true, true, 'off', 'page'], "the OLD 'none' value is not 'always' any more: it clamps to off");
eq(look(S({ wikiLookupMenu: 'meta' })), [true, true, 'off', 'page'], 'an unknown menu value clamps to off');
eq(look(S({ wikiLookupMenu: '' })), [true, true, 'off', 'page'], 'an empty menu value clamps to off');

// ---- the classic menu plan ---------------------------------------------------
const locMenu = ['Cancel', 'Walk here @whi@Tree', 'Chop down @cya@Tree', 'Examine @cya@Tree'];
const locActions = [1106, 718, 625, 1381];
const npcMenu = ['Cancel', 'Walk here @whi@Goblin', 'Attack @yel@Goblin@yel@ (level-2)', 'Examine @yel@Goblin@yel@ (level-2)'];
const bankMenu = ['Cancel', 'Withdraw-1 @lre@Shark', 'Withdraw-5 @lre@Shark', 'Withdraw-10 @lre@Shark', 'Withdraw-All @lre@Shark', 'Examine @lre@Shark'];
const chatMenu = ['Cancel', 'Add friend @whi@Bob', 'Add ignore @whi@Bob'];
const playerMenu = ['Cancel', 'Walk here @whi@Zezima', 'Attack @whi@Zezima@whi@ (level-126)', 'Follow @whi@Zezima@whi@ (level-126)'];
const buttonMenu = ['Cancel', 'Close'];
const ON = { enabled: true, button: true, menu: 'always', style: 'page' };
const OFF = { enabled: true, button: true, menu: 'off', style: 'page' };

console.log('\nthe classic menu plan');
const planOf = (menu: string[], settings = ON, held = false) => {
    const t = W.wikiLookupPlan(menu, menu.length, settings, held);
    return t ? [t.name, t.kind, t.tag] : null;
};
eq(planOf(locMenu), ['Tree', 'object', '@cya@'], 'a loc menu plans "Tree"');
eq(planOf(npcMenu), ['Goblin', 'npc', '@yel@'], 'an npc menu plans "Goblin" (level suffix stripped)');
eq(planOf(bankMenu), ['Shark', 'item', '@lre@'], 'a bank menu plans the banked item');
eq(planOf(chatMenu), null, 'a chat menu has nothing to look up');
eq(planOf(playerMenu), null, 'a player menu has nothing to look up');
eq(planOf(buttonMenu), null, 'an interface button menu has nothing to look up');
eq(planOf(['Cancel']), null, 'Cancel alone (count 1) plans nothing');
eq(planOf([], ON), null, 'an empty menu plans nothing');
eq(planOf(locMenu, OFF), null, 'menu row OFF (the default) plans nothing');
eq(planOf(locMenu, { enabled: false, button: true, menu: 'always', style: 'page' }), null, 'the master switch off plans nothing');
eq(planOf(locMenu, { enabled: true, button: false, menu: 'always', style: 'page' }), ['Tree', 'object', '@cya@'], 'the menu row does not depend on the button being shown');
eq(planOf(locMenu, { enabled: true, button: true, menu: 'shift', style: 'page' }, false), null, 'a menu key that is not held plans nothing');
eq(planOf(locMenu, { enabled: true, button: true, menu: 'shift', style: 'page' }, true), ['Tree', 'object', '@cya@'], 'and the same menu plans normally once it is held');
eq(planOf(locMenu, { enabled: true, button: true, menu: 'always', style: 'page' }, false), ['Tree', 'object', '@cya@'], "'always' never depends on a key");
{
    // the array cap: menuOption is a plain array but menuAction/menuParamA/B/C are
    // Int32Array(500), so the insertion may write slot 499 (count 499) and nothing
    // beyond it — a full menu must be left alone rather than desynchronise the arrays.
    // (The engine's own add* methods stop at 400 entries, so this is defensive.)
    const big: string[] = ['Cancel'];
    for (let i = 0; i < 500; i++) big.push('Chop down @cya@Tree');
    const plan499 = W.wikiLookupPlan(big, 499, ON, false);
    eq(plan499 ? [plan499.name, plan499.kind, plan499.tag] : null, ['Tree', 'object', '@cya@'], 'a 499-entry menu still fits the entry (slot 499 is the last one)');
    eq(W.wikiLookupPlan(big, 500, ON, false), null, 'a 500-entry menu is left alone (the shift would run past the arrays)');
}

// ---- the armed plan (the minimap button's lookup mode) -----------------------
console.log('\nthe armed plan (button mode)');
const armedOf = (menu: string[], armed = true, settings = ON) => {
    const t = W.wikiLookupArmedPlan(menu, menu.length, settings, armed);
    return t ? [t.name, t.kind, t.tag] : null;
};
eq(armedOf(locMenu), ['Tree', 'object', '@cya@'], 'armed: a loc plans "Tree"');
eq(armedOf(npcMenu), ['Goblin', 'npc', '@yel@'], 'armed: an npc plans "Goblin"');
eq(armedOf(bankMenu), ['Shark', 'item', '@lre@'], 'armed: a bank row plans the banked item');
eq(armedOf(chatMenu), null, 'armed: a chat row has nothing to look up (so the click behaves normally)');
eq(armedOf(playerMenu), null, 'armed: a player has no wiki page');
eq(armedOf(['Cancel']), null, 'armed: Cancel alone is not a menu');
eq(armedOf([], true), null, 'armed: an empty menu plans nothing');
eq(armedOf(locMenu, false), null, 'NOT armed plans nothing — the button is the only thing that arms it');
eq(armedOf(locMenu, true, { enabled: false, button: true, menu: 'always', style: 'page' }), null, 'armed but the mod is off: nothing');
eq(armedOf(locMenu, true, OFF), ['Tree', 'object', '@cya@'], 'armed works with the menu row off — the button does not need it');
eq(armedOf(locMenu, true, { enabled: true, button: false, menu: 'off', style: 'page' }), null, 'and never fires when the button is hidden (nothing can arm it)');

// ---- the insertion, replayed against the engine's own sort -------------------
// Mirrors wikiLookupMenu() in Client.ts (shift every slot above index 1 up by one,
// write ours into slot 1) and then runs buildMinimenu's bubble sort over the result.
// The sort is the engine's, copied verbatim: it swaps any (i, i+1) pair whose left
// action is < 1000 and whose right action is > 1000, i.e. it moves >1000 entries
// toward index 0 ('Cancel'). It runs AFTER the insertion point this mod uses, so the
// replay below is the real sequence.
function engineSort(options: string[], actions: number[], n: number) {
    let sorted = false;
    while (!sorted) {
        sorted = true;
        for (let i = 0; i < n - 1; i++) {
            if (actions[i] < 1000 && actions[i + 1] > 1000) {
                const o = options[i]; options[i] = options[i + 1]; options[i + 1] = o;
                const a = actions[i]; actions[i] = actions[i + 1]; actions[i + 1] = a;
                sorted = false;
            }
        }
    }
}

// the engine's own result for a menu, with no mod installed
function plain(menu: string[], actions: number[]) {
    const o = [...menu], a = [...actions];
    engineSort(o, a, o.length);
    return o;
}

function insert(options: string[], actions: number[]) {
    const target = W.wikiLookupPlan(options, options.length, ON, false);
    for (let i = options.length; i > 1; i--) {
        options[i] = options[i - 1];
        actions[i] = actions[i - 1];
    }
    options[1] = W.wikiLookupLabel(target);
    actions[1] = W.WIKI_LOOKUP_ACTION;
    engineSort(options, actions, options.length);
    return target;
}

console.log('\nthe insertion (index 1, then the engine sort)');
{
    const options = [...locMenu], actions = [...locActions];
    const vanilla = plain(locMenu, locActions);
    const target = insert(options, actions);

    eq(options.length, 5, 'the menu grew by exactly one row');
    eq(options[1], 'Wiki @cya@Tree', 'and it sits on the bottom row, above Cancel');
    eq(actions[1], W.WIKI_LOOKUP_ACTION, 'carrying our own action id');
    eq(options[0], 'Cancel', 'Cancel is still the bottom entry');
    eq(options[options.length - 1], vanilla[vanilla.length - 1], 'the engine\'s left-click default is unchanged (' + vanilla[vanilla.length - 1] + ')');
    ok(actions[options.length - 1] !== W.WIKI_LOOKUP_ACTION, 'so a left click can never open a wiki page by accident');
    eq(options.filter((o: string) => o !== 'Wiki @cya@Tree'), vanilla, 'and every engine row kept its exact order — we only added one slot');
    eq([target.name, target.kind, target.tag], ['Tree', 'object', '@cya@'], 'the row that was added is the top row\'s target');
}

console.log('\nthe insertion — the shapes that could push our row up');
{
    // worst case: a menu whose engine rows are nearly all >1000 (npc examine 1714, an
    // above-level attack = _PRIORITY + 242). The sort only ever moves >1000 entries
    // DOWN, so a >1000 row of ours cannot be overtaken from below, and it is never the
    // left operand of a swap either: index 1 holds.
    const menu = ['Cancel', 'Walk here @whi@Goblin', 'Attack @yel@Goblin@yel@ (level-92)', 'Examine @yel@Goblin@yel@ (level-92)'];
    const acts = [1106, 718, 2000 + 242, 1714];
    const options = [...menu], actions = [...acts];
    const vanilla = plain(menu, acts);
    insert(options, actions);

    eq(options[1], 'Wiki @yel@Goblin', 'a menu full of >1000 rows still leaves ours at index 1');
    eq(options.filter((o: string) => o !== 'Wiki @yel@Goblin'), vanilla, 'and no engine row moved by more than the slot we inserted');
    eq(options[0], 'Cancel', 'Cancel stays the bottom row');
    eq(options[options.length - 1], vanilla[vanilla.length - 1], 'the default click is the engine\'s own answer (' + vanilla[vanilla.length - 1] + ')');
    eq(actions[0], 1106, 'and Cancel\'s action is untouched (>1000 rows never swap with each other)');
}

console.log('\nthe insertion — a menu with nothing to look up is left alone');
{
    const options = [...chatMenu], actions = [1106, 605, 47];
    const n = options.length;
    const target = W.wikiLookupPlan(options, options.length, ON, false);
    eq(target, null, 'the plan refuses a chat menu');
    eq(options.length, n, 'and nothing is inserted (the client bails before the shift loop)');
    eq(options, chatMenu, 'the array is untouched');
}

// ---- the armed row, replayed against the engine's own sort -------------------
// The armed row REPLACES the top slot (no shift) and the client writes it AFTER the
// sort — so this replay is: build the menu, sort it, then overwrite the top slot. The
// invariant to prove is the one the mod depends on: our row IS the top row afterwards,
// and a left click therefore runs our action.
console.log('\nthe armed row (over the top slot, after the sort)');
{
    const menu = ['Cancel', 'Walk here @whi@Goblin', 'Attack @yel@Goblin@yel@ (level-2)', 'Examine @yel@Goblin@yel@ (level-2)'];
    const acts = [1106, 718, 242, 1714];
    const options = [...menu], actions = [...acts];
    engineSort(options, actions, options.length);
    const vanilla = plain(menu, acts);

    const target = W.wikiLookupArmedPlan(options, options.length, ON, true);
    const top = options.length - 1;
    options[top] = W.wikiLookupLookupLabel(target);
    actions[top] = W.WIKI_LOOKUP_ACTION;

    eq(options.length, menu.length, 'the armed row adds no slot — it overwrites');
    eq(options[top], 'Lookup @yel@Goblin', 'and it lands on the TOP row, which a left click runs');
    eq(actions[top], W.WIKI_LOOKUP_ACTION, 'with our action id');
    eq(options.filter((o: string) => o !== 'Lookup @yel@Goblin'), vanilla.filter((o: string) => o !== vanilla[vanilla.length - 1]), 'every other engine row is untouched');
    eq(options[0], 'Cancel', 'Cancel is still the bottom row');
    // and the reverse: with nothing under the cursor the engine's own top row survives
    const walk = ['Cancel', 'Walk here @whi@Tree'];
    const wt = W.wikiLookupArmedPlan(walk, walk.length, ON, true);
    eq(wt, null, 'armed over empty ground: no armed row is written at all (walking stays)');
}

// ---- the minimap button: geometry + hit test ---------------------------------
console.log('\nthe minimap button — placement');
const defBox = W.wikiLookupButtonBox('', '');
eq(defBox, [2, 132, 21, 21], 'default box: bottom-left of the minimap panel');
eq(W.wikiLookupButtonBox(W.WIKI_LOOKUP_ANCHOR_DEF, W.WIKI_LOOKUP_OFFSET_DEF), defBox, 'the registered default anchor/offset (BL, 2,-24) resolves to the same box');
ok(defBox[0] + defBox[2] <= 25, 'it sits in the panel\'s free left stone strip (the map window starts at x=25)', defBox);
ok(defBox[1] >= 33, 'and clear of the compass, which owns y < 33', defBox);
ok(defBox[1] + defBox[3] <= W.WIKI_LOOKUP_PANEL_H, 'and inside the panel (156 tall)', defBox);
eq(W.WIKI_LOOKUP_BUTTON_SIZE, 21, 'a 21px orb (OSRS-size next to the 22px data orbs)');
eq(W.wikiLookupButtonBox('BR', '0,0'), [151, 135, 21, 21], 'anchor BR: flush bottom-right of the panel');
eq(W.wikiLookupButtonBox('TL', '0,0'), [0, 0, 21, 21], 'anchor TL: flush top-left');
eq(W.wikiLookupButtonBox('TL', '-50,-50'), [0, 0, 21, 21], 'clamped FLUSH at the top-left (never off the panel)');
eq(W.wikiLookupButtonBox('BR', '9999,9999'), [151, 135, 21, 21], 'and clamped at the bottom-right');
eq(W.wikiLookupButtonBox('MC', '4,4'), [90, 82, 21, 21], 'a mid anchor + offset: 172/2+4, 156/2+4');
eq(W.wikiLookupButtonBox('BR', 'garbage'), [151, 135, 21, 21], 'a hand-typed offset falls back to 0,0 rather than NaN');
eq(W.wikiLookupButtonBox('nope', '0,0'), defBox, 'an unknown anchor name falls back to the default spot');
eq(W.WIKI_LOOKUP_ANCH_NAMES.length, W.WIKI_LOOKUP_ANCH.length, 'anchor names and points are parallel arrays (the boundary law)');

console.log('\nthe minimap button — hit test');
const hit = (mx: number, my: number) => W.wikiLookupButtonHit(mx, my, defBox);
ok(hit(12, 142), 'the centre hits');
ok(hit(2, 132), 'the near corner hits (inclusive)');
ok(hit(22, 152), 'the far corner hits (half-open on the far edge)');
ok(!hit(1, 142) && !hit(12, 131) && !hit(23, 142) && !hit(12, 153), 'a pixel outside each edge misses');
ok(!hit(0, 0) && !hit(171, 155), 'the panel corners miss');
{
    let inside = 0;
    for (let x = 0; x < W.WIKI_LOOKUP_PANEL_W; x++) for (let y = 0; y < W.WIKI_LOOKUP_PANEL_H; y++) if (hit(x, y)) inside++;
    eq(inside, 441, 'the clickable area is exactly the 21x21 box');
}

// ---- the minimap button: the pixels -----------------------------------------
console.log('\nthe minimap button — the pixels');
// the client draws into the minimap WIDGET's own buffer (172x156, composited onto the
// canvas at 550,4), so the tests do exactly that — box coords are widget coords.
const PW = W.WIKI_LOOKUP_PANEL_W, PH = W.WIKI_LOOKUP_PANEL_H, SENT = -12345;
function drawInto(box: number[], armed: boolean, hovered: boolean, tick: number) {
    const px = new Int32Array(PW * PH).fill(SENT);
    W.wikiLookupDrawButton(px, PW, PH, box[0], box[1], box[2], armed, hovered, tick);
    return px;
}
function census(px: Int32Array, box: number[]) {
    let painted = 0, untouchedInBox = 0, outsideBox = 0, zero = 0;
    for (let y = 0; y < PH; y++) {
        for (let x = 0; x < PW; x++) {
            const c = px[x + y * PW];
            const inBox = x >= box[0] && x < box[0] + box[2] && y >= box[1] && y < box[1] + box[3];
            if (c === SENT) { if (inBox) untouchedInBox++; else continue; }
            else if (inBox) { painted++; if (c === 0) zero++; }
            else outsideBox++;
        }
    }
    return { painted, untouchedInBox, outsideBox, zero };
}
const idle = drawInto(defBox, false, false, 0);
const hovered = drawInto(defBox, false, true, 0);
const armedOn = drawInto(defBox, true, false, 0);
const armedOff = drawInto(defBox, true, false, 8);
{
    const c = census(idle, defBox);
    eq(c.outsideBox, 0, 'nothing is painted outside the button\'s box');
    eq(c.zero, 0, 'no pixel is written as 0 (a 0 would read as a hole in the panel stone)');
    ok(c.painted > 300 && c.painted < 330, 'the disc covers ~317 of the 441 box pixels (a circle, not a square)', c.painted);
    eq(c.untouchedInBox, 441 - c.painted, 'and the box corners are left as they were');
    eq(c.painted + c.untouchedInBox, 441, 'the box is exactly 21x21');
}
{
    // states must be VISIBLY different — the whole point of the armed state is that a
    // player can see why their left click is opening wiki pages
    let hoverDiff = 0, armedDiff = 0, pulseDiff = 0, periodDiff = 0;
    for (let i = 0; i < idle.length; i++) {
        if (idle[i] !== hovered[i]) hoverDiff++;
        if (idle[i] !== armedOn[i]) armedDiff++;
        if (armedOn[i] !== armedOff[i]) pulseDiff++;
    }
    const armedNext = drawInto(defBox, true, false, 16);
    for (let i = 0; i < armedOn.length; i++) if (armedOn[i] !== armedNext[i]) periodDiff++;
    ok(hoverDiff > 40, 'hover repaints the rim (' + hoverDiff + ' px)', hoverDiff);
    ok(armedDiff > 100, 'armed repaints the whole orb (' + armedDiff + ' px)', armedDiff);
    ok(pulseDiff > 100, 'the armed pulse is a real second state (' + pulseDiff + ' px)', pulseDiff);
    eq(periodDiff, 0, 'and the pulse repeats on a 16-tick period');
}
{
    // the glyph: 7x7, every row inked, the middle peak reaching the top row
    const g: string = W.WIKI_LOOKUP_GLYPH_W;
    eq(g.length, 49, 'the glyph bitmap is 7x7');
    eq(g.split('').filter((c: string) => c === '1').length, 19, 'the W has 19 ink pixels');
    let emptyRows = 0, topRowInk = 0, rowInk: number[] = [];
    for (let j = 0; j < 7; j++) {
        const row = g.substring(j * 7, j * 7 + 7);
        const n = row.split('').filter((c: string) => c === '1').length;
        rowInk.push(n);
        if (n === 0) emptyRows++;
        if (j === 0) topRowInk = n;
    }
    eq(emptyRows, 0, 'no blank row — the mark fills the glass disc');
    eq(topRowInk, 3, 'the top row has three peaks (left, middle, right): it reads as a W');
    eq(rowInk, [3, 3, 3, 3, 3, 2, 2], 'and the strokes converge downward, as a W does');
    // and it is actually ON the disc: the ink colour is present, and differs by state
    const idleInk = idle.filter((c: number) => c === 0xf7f3e8).length;
    const armedInk = armedOn.filter((c: number) => c === 0xffffff).length;
    eq(idleInk, 19, 'the 19 glyph pixels are painted in the idle ink colour');
    eq(armedInk, 19, 'and in white while armed');
}
{
    // an ASCII render, printed so a human can eyeball the shape without the game
    let art = '';
    for (let y = defBox[1] - 1; y < defBox[1] + defBox[3] + 1; y++) {
        let line = '';
        for (let x = defBox[0] - 1; x < defBox[0] + defBox[2] + 1; x++) {
            const c = idle[x + y * PW];
            line += c === SENT ? '.' : (c === 0x0a0a0a ? '#' : (c === 0xf7f3e8 ? 'W' : (c === 0x161310 ? ' ' : (c === 0x2b2721 ? ':' : (c === 0x7d7466 ? '+' : '/')))));
        }
        art += '\n    ' + line;
    }
    console.log('\nthe idle button, as pixels (' + defBox.join(',') + '):' + art);
}

console.log(`\n${fail === 0 ? '✓ all green' : '✗ FAILURES'}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);