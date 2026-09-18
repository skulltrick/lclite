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
//  3. the settings parse/clamp table;
//  4. the menu PLAN and the insertion itself — replayed against the client's own menu
//     sort, to prove the two invariants that keep the mod safe: our row lands on the
//     bottom row (index 1, above 'Cancel'), and it can never become the top row, which
//     IS the left-click default. It also proves the insertion moves no engine row.
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
// and > 1000 (the engine's sort only moves entries > 1000, so ours stays where it is
// put — see the insertion checks below).
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

console.log('\ntarget parse — the label round-trips');
for (const s of ['Chop down @cya@Tree', 'Attack @yel@Goblin@yel@ (level-2)', 'Wield @lre@Rune scimitar']) {
    const t = W.wikiLookupTarget(s);
    const back = W.wikiLookupTarget(W.wikiLookupLabel(t));
    eq(back ? [back.name, back.kind, back.tag] : null, [t.name, t.kind, t.tag], 'label of ' + JSON.stringify(s) + ' re-parses to the same target');
}
eq(W.wikiLookupLabel(W.wikiLookupTarget('Chop down @cya@Tree')), 'Wiki @cya@Tree', 'the row reads "Wiki <target>" in the engine\'s own colour');

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
const look = (s: any) => [s.enabled, s.style, s.modifier];

console.log('\nsettings defaults (empty store = a fresh install)');
eq(look(S()), [true, 'page', 'none'], 'defaults: on, direct page, always in the menu');
eq(look(S({ wikiLookup: 'true' })), [true, 'page', 'none'], 'explicit on');
eq(look(S({ wikiLookup: 'false' })), [false, 'page', 'none'], "'false' is the only value that disables");
eq(look(S({ wikiLookup: 'nonsense' })), [true, 'page', 'none'], 'garbage in the master key leaves it on');
eq(look(S({ wikiLookupStyle: 'search' })), [true, 'search', 'none'], 'search style');
eq(look(S({ wikiLookupStyle: 'SEARCH' })), [true, 'page', 'none'], 'the style is matched exactly, not case-folded');
eq(look(S({ wikiLookupStyle: 'nope' })), [true, 'page', 'none'], 'an unknown style clamps to the page form');
eq(look(S({ wikiLookupModifier: 'shift' })), [true, 'page', 'shift'], 'shift modifier');
eq(look(S({ wikiLookupModifier: 'ctrl' })), [true, 'page', 'ctrl'], 'ctrl modifier');
eq(look(S({ wikiLookupModifier: 'alt' })), [true, 'page', 'alt'], 'alt modifier');
eq(look(S({ wikiLookupModifier: 'meta' })), [true, 'page', 'none'], 'an unknown modifier clamps to always');
eq(look(S({ wikiLookupModifier: '' })), [true, 'page', 'none'], 'an empty modifier clamps to always');

// ---- the plan ---------------------------------------------------------------
const locMenu = ['Cancel', 'Walk here @whi@Tree', 'Chop down @cya@Tree', 'Examine @cya@Tree'];
const locActions = [1106, 718, 625, 1381];
const npcMenu = ['Cancel', 'Walk here @whi@Goblin', 'Attack @yel@Goblin@yel@ (level-2)', 'Examine @yel@Goblin@yel@ (level-2)'];
const bankMenu = ['Cancel', 'Withdraw-1 @lre@Shark', 'Withdraw-5 @lre@Shark', 'Withdraw-10 @lre@Shark', 'Withdraw-All @lre@Shark', 'Examine @lre@Shark'];
const chatMenu = ['Cancel', 'Add friend @whi@Bob', 'Add ignore @whi@Bob'];
const playerMenu = ['Cancel', 'Walk here @whi@Zezima', 'Attack @whi@Zezima@whi@ (level-126)', 'Follow @whi@Zezima@whi@ (level-126)'];
const buttonMenu = ['Cancel', 'Close'];
const ON = { enabled: true, style: 'page', modifier: 'none' };

console.log('\nthe plan');
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
eq(planOf(locMenu, { enabled: false, style: 'page', modifier: 'none' }), null, 'the master switch off plans nothing');
eq(planOf(locMenu, { enabled: true, style: 'page', modifier: 'shift' }, false), null, 'a modifier that is not held plans nothing');
eq(planOf(locMenu, { enabled: true, style: 'page', modifier: 'shift' }, true), ['Tree', 'object', '@cya@'], 'and the same menu plans normally once it is held');
eq(planOf(locMenu, { enabled: true, style: 'page', modifier: 'none' }, false), ['Tree', 'object', '@cya@'], "'none' never depends on a key");
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

console.log(`\n${fail === 0 ? '✓ all green' : '✗ FAILURES'}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
