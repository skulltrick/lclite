# mods/wiki-lookup

A **Wiki** row in the right-click menu that opens the Oldschool RuneScape wiki page for
whatever you right-clicked — RuneLite's *Wiki* plugin (its classic menu-option form) as a
2004Scape mod.

Player-visible effect: right-click a goblin, a tree, a bank booth, a coin stack on the
floor or a shark in your bank and the menu gains a `Wiki Goblin` / `Wiki Tree` / `Wiki
Shark` row, on the bottom line just above `Cancel`. Clicking it opens
`oldschool.runescape.wiki/w/<name>` in a new tab. It never becomes the left-click
default, so gameplay is untouched: left-clicking still attacks/chops/wields.

The wiki is the OSRS one on purpose: 2004Scape and OSRS share item, NPC and object
*names* for the overwhelming majority of entities, so the OSRS page is the right page for
almost everything a player will look up. Cache **ids** are not shared (OSRS renumbered
everything after 2004), which is why this mod looks up by name and never sends an id.

## What's in the box

- `files/webclient/src/client/WikiLookup.ts` — the mod's **pure core** (settings parse,
  the target extraction, the URL builder, the menu plan) plus the two page-side helpers
  (modifier tracking, the blocked-popup card). The parse/URL/plan half touches no client
  state and no DOM, so the harness below runs the real shipped logic headlessly. `apply`
  copies it verbatim; one import hunk in `Client.ts` pulls it into the bundle.
- `patches/289/Client_ts.json` — FOUR hunks into `webclient/src/client/Client.ts`:
  1. the payload import, inside the config-import block (clear of every other mod's
     import islands — deliberately NOT next to `import JagFX`, whose neighbourhood
     carries the revision-specific `const CLIENT_VERSION = 289;` line that would expire
     274's `inherits` claim);
  2. `this.wikiLookupMenu()` at the end of `buildMinimenu()`, immediately **before** the
     engine's own menu sort;
  3. `if (this.wikiLookupDispatch(optionId)) return;` at the top of `doAction()`, right
     after the action is read;
  4. the two methods, parked in the pristine gap above `buildMinimenu()`.
- Panel rows: `MOD_REGISTRY` + three `MODS[]` rows for `wiki-lookup` in
  `mods/control-panel/files/engine/public/lclite/panel.js` (lookup style, menu key,
  search). The `panel.js?v=` key in `client.ejs` was bumped for this change (14 → 15),
  the house rule for any panel.js edit.
- `tools/wiki_lookup_test.ts` — 94-check bun harness (see *Verified*).

## How the target is found (the design decision)

**The name comes off the menu the engine just built — the option text the player can
see — not from a second entity lookup.** RuneLite's wiki plugin does the same thing: it
reads the *top* menu entry (the one a left click would run) and derives the page from its
target text. Here the client tags that target with a colour code, and the tag *is* the
entity kind:

| tag | kind | example option the engine builds |
|---|---|---|
| `@cya@` | object (loc) | `Chop down @cya@Tree` |
| `@yel@` | NPC | `Attack @yel@Goblin@yel@ (level-2)` |
| `@lre@` | item | `Wield @lre@Rune scimitar` |

Players, chat/friend options, `Walk here` and every interface button use `@whi@` or no
tag at all, so they are excluded by construction — a player's name can never become a
wiki page. The extraction takes the text after the first target tag, strips the client's
remaining tags and the ` (level-NN)` combat suffix it appends to NPC tooltips, and trims.

Three things fall out of reading the menu instead of the world:

1. **Every source of an entity option is covered at once.** World NPCs, locs, ground
   items, the inventory, worn equipment, the bank and shop rows all build their options
   in different methods (`addWorldOptions`, `addComponentOptions`, `addNpcOptions`, …);
   the menu is the one place they all meet. `Withdraw-All @lre@Shark` is a bank row, not
   an inventory row, and the mod neither knows nor cares.
2. **One hook site for the row, one for the click.** The row is added by a single call at
   the end of `buildMinimenu()`; every way a row can be chosen (the open-menu click, the
   default left click, the touch paths) funnels through `doAction()`, so the dispatch is a
   single check there.
3. **The row and the lookup cannot disagree.** The dispatch re-parses the row's own text
   — the same string the parse built it from — exactly as `mods/shift-drop` matches the
   visible `Drop ` label.

## Where the row goes, and why it can never be the default click

The row is written into slot **1**: the bottom line, directly above `Cancel`. The *top*
row (index `menuNumEntries - 1`) is the left-click default, so a row landing there would
replace the player's attack/chop/wield — RuneLite's wiki option is likewise never the
default click. Two properties keep slot 1 stable:

- **The action id is `1234`** — not a `MiniMenuAction` value (the harness asserts that
  against the enum's own numbers), and `> 1000`.
- **`buildMinimenu()`'s sort runs after the insertion** and only ever swaps a pair whose
  left action is `< 1000` and whose right action is `> 1000` (it walks `>1000` entries
  downward, toward `Cancel`). Our row is the *left* operand of no swap (it is `>1000`) and
  the *right* operand of none either (the row below it is `Cancel` at `1106`), so it never
  moves. The harness replays the engine's own bubble sort over a real menu and proves
  both that our row stays in slot 1 and that **no engine row changes order** because of
  us.

When the menu opens, `buildMinimenu()` stops running (`gameDrawMain` skips it while
`isMenuOpen`), so the arrays — and therefore the row the player clicks and the index
`doAction` receives — are frozen together.

## Opening the page, and the popup fallback

The click that selects the row is dispatched from the game loop a few milliseconds after
the DOM event, which is inside the browser's transient-activation window, so
`window.open` normally opens a new tab. A stricter browser or a popup blocker can refuse
it — `window.open` then returns `null` and the mod shows a small card in the viewport's
top-left (the FAB owns the top-right) with the target name and a real link: the feature
degrades to one extra click instead of doing nothing. The card never touches the canvas,
and it is never shown when the tab opened fine.

## Settings contract

All of these are this mod's OWN localStorage keys, read at its own hook **every frame** —
no hub, no other mod's key, and every change lands on the next frame.

| key | values | default | row |
|---|---|---|---|
| `wikiLookup` | `'true'`/`'false'` | `'true'` | master switch on the mod's row |
| `wikiLookupStyle` | `'page'`/`'search'` | `'page'` | Lookup style (select) |
| `wikiLookupModifier` | `'none'`/`'shift'`/`'ctrl'`/`'alt'` | `'none'` | Menu key (select) |

Every value is validated in the payload (`wikiLookupSettings`), not at the call site: an
unknown style clamps to `page`, an unknown modifier clamps to `none` (always visible), and
only the literal `'false'` disables the mod. The modifier keys are tracked by the payload
itself from capture-phase `keydown`/`keyup`/`blur` listeners on the page — GameShell's key
handlers belong to `mods/hotkeys`, and a mod does not get to add a second claim hook to
them.

The panel's **Search the wiki** action is the stand-in for the wiki button's own *Search*
option: it prompts for a name and opens `Special:Search` in a new tab, for the things that
are not entities (quests, skills, guides). It is a page script, so it repeats the wiki's
base URL rather than importing the payload — keep the two in step
(`WIKI_LOOKUP_ORIGIN`).

## Deliberate divergences from RuneLite, and limits

- **Name lookup, not `Special:Lookup`.** Modern RuneLite resolves entities through
  `Special:Lookup?type=&id=&name=&x=&y=&plane=` — an OSRS *id* lookup that would land on
  the wrong page with 2004 cache ids. This mod uses the name (what RuneLite's classic wiki
  option did), with the wiki's own search as the alternative style.
- **The wiki button itself does not exist here.** Modern RuneLite (and OSRS) expose the
  lookup through a wiki orb under the minimap, with the entity's `Lookup` target verb; the
  2004 interface has no room for that widget, so the menu row is the port. The panel's
  Search action covers the orb's other half.
- **The row is always there by default.** RuneLite's classic plugin also just added the
  option; the `Menu key` setting exists for players who want a clean menu (OSRS itself
  makes you activate the wiki button first).
- **Bottom row, not adjacent to the entity's own options.** A deliberate placement, for
  the default-click reason above.
- **One page per target, no disambiguation UI.** `Tree` opens the wiki's `Tree` page even
  where several trees exist, and a name the OSRS wiki does not have shows the wiki's
  own "no page" screen (the `search` style avoids that by always landing on results).
- **Ground-item stacks and multi-name menus use the TOP row.** Only one row is added, for
  the entry a left click would have run — so a tile with three items gets the page for the
  top one, exactly as RuneLite behaves.
- **289 and 274 only.** `274` inherits the 289 corpus; `254` has its own corpus and this
  mod is not ported to it (same as camera, control-panel, hotkeys, stat-orbs, hover-tile
  and xp-drops). `node tools/port.mjs 254` is the one command that changes that.

## Verified

- `tools/wiki_lookup_test.ts` — 94 checks, all green, run against both the `files/`
  payload and the copy inside an applied tree: the action id against `MiniMenuAction`'s
  own numbers and the `>1000 / <2000` range; the target parse against the exact option
  strings the 289 client builds (loc/NPC/item ops, use-item-on-X, spell targets, bank and
  shop rows, ground items, the NPC combat-level colour in all its variants) and against
  everything that must NOT get a page (players, chat rows, `Walk here`, interface
  buttons, empty options, a tag with nothing after it); the label round-trip; the URL
  builder (page/search, spaces, apostrophes, `&`, `%`, stray whitespace); the settings
  table (defaults, every clamp, a garbage store); the plan (master off, modifier not held,
  a 499/500-entry menu) and the insertion replayed through the engine's own sort.
- `tsc --noEmit` clean on the full tree, and clean with `apply --mods wiki-lookup` alone
  (the mod depends on no other mod).
- `regen` twice byte-identical · `apply --check` ✗0 on all 14 mods · `doctor` exit 0 ·
  `matrix` green on every declared revision (274 inherits all 116 hunks exactly, 254
  untouched) · `tools/acceptance.sh` byte-compares a pristine clone at the pinned revs
  against the live install (23 files, this mod's payload included) and proves the converge
  round-trip byte-stable.
- The shipped prod bundle carries the payload's key literals (`oldschool.runescape.wiki`,
  `Special:Search?search=`, `lcwiki-card`, `Wiki lookup`) — the terser property mangler
  renames the mod's function names, never these strings.
- Panel, live page: the *Wiki lookup* row appears with the right name/description and a
  master switch (default on); its view opens with all three rows at the documented
  defaults (`Direct page`, `Always`, the `Open` button); switching it off writes
  `wikiLookup=false` and shows "Mod disabled — enable it to change these settings.";
  both selects write their own keys; the section survives 10+ s; no console errors. The
  page requests `/lclite/panel.js?v=15`, i.e. the bumped version key, not a cached copy.
- **In-game feel is player-verified** (see the mod's handover checklist): the `Wiki
  <name>` row on NPCs, objects, ground items, inventory/equipment, bank and shop rows;
  the row opening the right page; and the `Menu key` setting hiding it again.
