# mods/wiki-lookup

A **wiki button on the minimap** that opens the Oldschool RuneScape wiki page for
whatever you click next — RuneLite's *Wiki* plugin (its modern wiki-orb form), plus the
plugin's classic form as an opt-in: a **`Wiki <target>` row in the right-click menu**.

Player-visible effect, the default way in: click the stone-rimmed **W** orb at the
bottom-left of the minimap panel, then click any NPC, object or item — a goblin, a tree,
a bank booth, a coin stack on the floor, a shark in your bank, the sword you are wearing
— and `oldschool.runescape.wiki/w/<name>` opens in a new tab. While the button is armed
it turns OSRS-blue and pulses, and the thing under your cursor gets **`Lookup <name>`**
as its *left-click* option, exactly as RuneLite's wiki icon does; the click that runs it
opens the page instead of attacking/chopping/wielding, and then the button turns itself
off (one click, one page — RuneLite deselects its icon on use too). Click the orb again
to cancel. Walking, talking and the rest of the menu are untouched.

The classic **`Wiki Goblin`** row is off by default and lives in the panel: switch
*Right-click menu row* on and every valid right-click menu gains the row on its bottom
line, just above `Cancel`. It never becomes the left-click default, so gameplay is
untouched: left-clicking still attacks/chops/wields.

The wiki is the OSRS one on purpose: 2004Scape and OSRS share item, NPC and object
*names* for the overwhelming majority of entities, so the OSRS page is the right page for
almost everything a player will look up. Cache **ids** are not shared (OSRS renumbered
everything after 2004), which is why this mod looks up by name and never sends an id.

## What's in the box

- `files/webclient/src/client/WikiLookup.ts` — the mod's **pure core**: the settings
  parse, the target extraction, the URL builder, the two menu plans, and the wiki
  button's own geometry, hit test and **pixels** (`wikiLookupDrawButton` paints into a
  plain `Int32Array`). Nothing in it touches client state or the DOM except the two
  page-side helpers (modifier tracking, the blocked-popup card), so the harness below
  runs the real shipped logic headlessly — the button's pixels included. `apply` copies
  it verbatim; one import hunk in `Client.ts` pulls it into the bundle.
- `patches/289/Client_ts.json` — SEVEN hunks into `webclient/src/client/Client.ts`:
  1. the payload import, inside the config-import block (clear of every other mod's
     import islands — deliberately NOT next to `import JagFX`, whose neighbourhood
     carries the revision-specific `const CLIENT_VERSION = 289;` line that would expire
     274's `inherits` claim);
  2. the parked block above `buildMinimenu()`: the two menu methods, the armed state,
     the button's box/over/draw methods, and `wikiLookupLoop()`;
  3. `this.wikiLookupLoop();` as the FIRST statement of mainloop's `checkClickInput`
     block — before the engine's own click loops, so the button's click is consumed
     before anything can also walk the minimap or run a menu action;
  4. `this.wikiLookupMenu()` at the end of `buildMinimenu()`, immediately **before** the
     engine's own menu sort (the classic row);
  5. `this.wikiLookupArmedRow()` immediately **after** that sort (the armed row — see
     below);
  6. `this.wikiLookupDraw()` in `gameDraw()`, right after the minimap widget is
     composited (`this.areaMap?.draw(550, 4)`);
  7. `if (this.wikiLookupDispatch(optionId)) return;` at the top of `doAction()`, right
     after the action is read.
- Panel rows: `MOD_REGISTRY` + five `MODS[]` rows for `wiki-lookup` in
  `mods/control-panel/files/engine/public/lclite/panel.js` (minimap button, right-click
  menu row, lookup style, reset position, search). The `panel.js?v=` key in `client.ejs`
  was bumped for this change (15 → 16), the house rule for any panel.js edit. The
  button's cross-realm placement name `lcmWikiLookupBounds` was added to the
  control-panel reserve island in `webclient/bundle.ts`.
- `tools/wiki_lookup_test.ts` — 158-check bun harness (see *Verified*).
- `tools/wiki_button_edit.py` — the idempotent, CRLF-preserving script that writes the
  seven hunks into a live `Client.ts` (region-based, so a re-run is a no-op). Kept
  because it is the fastest way to re-do this edit after a revision port or an anchor
  reseat; it takes `LCLITE_ROOT` (or the install path as argv[1]).

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
2. **Two hook sites for the row, one for the click.** The classic row is added by a
   single call before `buildMinimenu()`'s sort; the armed row is a second call after it;
   and every way either row can be chosen (the open-menu click, the default left click,
   the touch paths) funnels through `doAction()`, so the dispatch is a single check
   there.
3. **A row and its lookup cannot disagree.** The dispatch re-parses the row's own text —
   the same string the parse built it from — exactly as `mods/shift-drop` matches the
   visible `Drop ` label.

## The minimap button

**Where it lives.** The 2004 minimap panel (`areaMap`, 172x156, composited onto the
canvas at 550,4) has a free stone strip 25px wide down its left side, with the compass
owning `y < 33` and the map window starting at `x = 25`. The button is a 21px orb tucked
into the **bottom-left** of that strip — where OSRS and RuneLite put the wiki orb. It is
drawn in the same visual language as `mods/stat-orbs`' data orbs (hard 1px steps, a
bevelled stone rim lit upper-left, a dark glass body, no anti-aliasing) with the wiki's
own **W** as a 7x7 pixel glyph. Idle it is stone and dark glass; hovered its rim warms;
armed its glass turns OSRS-blue and pulses on a 16-tick period.

**How it is drawn.** `gameDraw()` composites the panel with `this.areaMap?.draw(550, 4)`
— a straight `putImageData` of the widget's own buffer — so the only place a mod's
minimap pixels can live is that buffer. `wikiLookupDraw()` binds it
(`this.areaMap?.setPixels()`), paints, and restores the frame's previous `Pix2D` target
exactly. Consequences worth knowing:

- The button appears one frame after a state change (~16ms) — the composite for the
  current frame has already happened.
- The panel's stone is painted once at boot and only partly redrawn per frame, so
  abandoned pixels (a moved button, a switched-off button) would stay on it. A change of
  box/on-off state re-plots the mapback, whose map window and compass are transparent
  holes; `minimapDraw` redraws the map, the compass and stat-orbs' orbs before the next
  composite, so the wipe costs nobody a frame.
- Because the paint happens after the composite, nothing this mod draws can be
  overwritten by another mod's wipe in the same frame — stat-orbs' frequent
  stale-pixel wipe (it fires whenever HP/prayer/run energy changes) cannot flicker the
  button.
- Painting into the widget buffer is also what makes the button ride the gpu mod's
  frame upload like every other HUD pixel, and scale with the canvas.

**Arming.** Clicking the button toggles `wikiLookupArmedOn` and consumes the click
(`mouseClickButton = 0`) before the engine's click loops see it. The flag is dropped
when the mod or the button is switched off, when there is no local player, and after a
completed lookup. It is never persisted: a reload starts disarmed.

**The armed row.** While armed, `wikiLookupArmedRow()` writes
`Lookup <tag><name>` over the menu's **top** slot with action id 1234. Two things make
that safe:

- It runs AFTER `buildMinimenu()`'s own sort (a second hook site). That sort walks every
  `>1000` row toward `Cancel`, so an armed row written before it would sink out of the
  top slot and could never be the left-click default. Nothing runs after our call, so
  the row the player clicks — and the index `doAction` receives — is the armed one.
- It only overwrites the top slot when the engine's own top entry names an NPC, object
  or item. Over empty ground, a player or a chat line there is no armed row at all, so
  walking, following and chatting still work while armed — RuneLite's wiki mode behaves
  the same way. The row is also the tooltip `drawFeedback()` shows above the viewport, so
  the armed target is visible before you click.

The armed row replaces the classic row for that frame (the classic row is skipped while
armed) — one row, not two.

## Where the classic row goes, and why it can never be the default click

The row is written into slot **1**: the bottom line, directly above `Cancel`. The *top*
row (index `menuNumEntries - 1`) is the left-click default, so a row landing there would
replace the player's attack/chop/wield — RuneLite's classic wiki option is likewise never
the default click. Two properties keep slot 1 stable:

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

The click that selects a row is dispatched from the game loop a few milliseconds after
the DOM event, which is inside the browser's transient-activation window, so
`window.open` normally opens a new tab. A stricter browser or a popup blocker can refuse
it — `window.open` then returns `null` and the mod shows a small card in the viewport's
top-left (the FAB owns the top-right) with the target name and a real link: the feature
degrades to one extra click instead of doing nothing. The card never touches the canvas,
and it is never shown when the tab opened fine.

## Settings contract

All of these are this mod's OWN localStorage keys, read at its own hooks **every frame** —
no hub, no other mod's key, and every change lands on the next frame.

| key | values | default | row |
|---|---|---|---|
| `wikiLookup` | `'true'`/`'false'` | `'true'` | master switch on the mod's row |
| `wikiLookupButton` | `'true'`/`'false'` | `'true'` | Minimap wiki button (toggle) |
| `wikiLookupMenu` | `'off'`/`'always'`/`'shift'`/`'ctrl'`/`'alt'` | `'off'` | Right-click menu row (select) |
| `wikiLookupStyle` | `'page'`/`'search'` | `'page'` | Lookup style (select) |
| `lcmWikiLookupAnchor`, `lcmWikiLookupOffset` | anchor name + px offset | `'BL'`, `'2,-24'` | written by the panel's drag layer only |

Every value is validated in the payload (`wikiLookupSettings`), not at the call site: an
unknown style clamps to `page`, an unknown menu value clamps to `off` (so a player's
stale `wikiLookupModifier` from the earlier version simply stops mattering), and only the
literal `'false'` disables the master or the button. The menu keys are tracked by the
payload itself from capture-phase `keydown`/`keyup`/`blur` listeners on the page —
GameShell's key handlers belong to `mods/hotkeys`, and a mod does not get to add a second
claim hook to them.

The panel's **Search the wiki** action is the stand-in for the wiki button's own *Search*
option: it prompts for a name and opens `Special:Search` in a new tab, for the things that
are not entities (quests, skills, guides). It is a page script, so it repeats the wiki's
base URL rather than importing the payload — keep the two in step
(`WIKI_LOOKUP_ORIGIN`).

The panel's **Reset button position** row (and Alt+right-click on the orb) asks the drag
layer to clear the placement keys — the drag layer is the only writer of those, so a
reset never races it.

## Deliberate divergences from RuneLite, and limits

- **Name lookup, not `Special:Lookup`.** Modern RuneLite resolves entities through
  `Special:Lookup?type=&id=&name=&x=&y=&plane=` — an OSRS *id* lookup that would land on
  the wrong page with 2004 cache ids. This mod uses the name (what RuneLite's classic wiki
  option did), with the wiki's own search as the alternative style.
- **A drawn orb, not a widget.** RuneLite adds its icon as a child widget of the minimap
  and uses the engine's own *target verb* machinery (`setTargetVerb('Lookup')` +
  `USE_NPC|USE_OBJECT|USE_GROUND_ITEM`); the 2004 interface has no such widget, so this
  mod paints its own orb into the panel buffer and gets the same player-visible result —
  the entity's left-click option becomes `Lookup <name>` — by rewriting the menu's top
  slot after the engine's sort. What it does NOT get for free is RuneLite's engine-side
  cancel semantics; the button toggles off on a second click and after each lookup
  instead.
- **Armed mode is per-session.** It is not saved: a reload starts with the orb off.
- **Bottom row, not adjacent to the entity's own options.** A deliberate placement for
  the classic row, for the default-click reason above.
- **One page per target, no disambiguation UI.** `Tree` opens the wiki's `Tree` page even
  where several trees exist, and a name the OSRS wiki does not have shows the wiki's
  own "no page" screen (the `search` style avoids that by always landing on results).
- **Ground-item stacks and multi-name menus use the TOP row.** Only one row is added, for
  the entry a left click would have run — so a tile with three items gets the page for the
  top one, exactly as RuneLite behaves.
- **It shares the panel's left strip with `mods/stat-orbs`.** With both mods on their
  default spots the wiki orb overlaps the bottom data orb slightly (stat-orbs' column
  runs down the same strip). Both are alt-draggable — grab whichever one you can see and
  move it — and the panel's *Reset button position* row puts the orb back.
- **289 and 274 only.** `274` inherits the 289 corpus; `254` has its own corpus and this
  mod is not ported to it (same as camera, control-panel, hotkeys, stat-orbs, hover-tile
  and xp-drops). `node tools/port.mjs 254` is the one command that changes that.

## Verified

- `tools/wiki_lookup_test.ts` — 158 checks, all green, run against both the `files/`
  payload and the copy inside an applied tree: the action id against `MiniMenuAction`'s
  own numbers and the `>1000 / <2000` range; the target parse against the exact option
  strings the 289 client builds (loc/NPC/item ops, use-item-on-X, spell targets, bank and
  shop rows, ground items, the NPC combat-level colour in all its variants) and against
  everything that must NOT get a page (players, chat rows, `Walk here`, interface
  buttons, empty options, a tag with nothing after it); both labels (`Wiki <target>`,
  `Lookup <target>`) round-tripping through the parse; the URL builder (page/search,
  spaces, apostrophes, `&`, `%`, stray whitespace); the settings table (defaults — menu
  row OFF — every clamp, a stale `wikiLookupModifier`); the classic plan and the armed
  plan (master off, menu off, button off, not armed, a 499/500-entry menu); the classic
  insertion and the armed overwrite replayed through the engine's own sort; the button's
  box maths (default spot inside the strip, every anchor, garbage offsets, clamping) and
  its hit test (exactly 21x21 clicks); and the **pixels** — nothing painted outside the
  box, no pixel written as 0 (a hole in the stone), the disc covering ~317 of the 441 box
  pixels, hover/armed/pulse each repainting (104 / 253 / 130 px), the pulse period, and
  the 7x7 W glyph's shape and ink colour in both states. It also prints the idle button
  as ASCII art so the shape can be eyeballed without the game.
- `tsc --noEmit` clean on the full tree.
- `regen` twice byte-identical (hash of every patch JSON + doc) · `apply --check` ✗0 on
  all 14 mods (7 hunks for this one) · `doctor` exit 0 with no findings ·
  `node tools/matrix.mjs` green on every declared revision (274 inherits all 119 hunks
  exactly, 254 untouched) · `tools/acceptance.sh` byte-compares a pristine clone at the
  pinned revs against the live install (23 files, this mod's payload included) and proves
  the converge round-trip byte-stable.
- The shipped prod bundle carries the payload's key literals (`oldschool.runescape.wiki`,
  `Special:Search?search=`, `lcwiki-card`, `Lookup `, `wikiLookupButton`,
  `wikiLookupMenu`) and the reserved placement names (`lcmWikiLookupBounds`,
  `lcmWikiLookupAnchor`, `registerCanvas`) — the terser property mangler renames the mod's
  function names, never these strings.
- Panel, live page (world booted from the install): the *Wiki lookup* row appears with the
  new name/description and a master switch (default on); its view opens with all five rows
  at the documented defaults (Minimap wiki button **on**, Right-click menu row **off**,
  `Direct page`, Reset, Open); switching the button toggle writes `wikiLookupButton=false`,
  the menu select writes `wikiLookupMenu=always`, and both were restored to their defaults
  afterwards; the section survives 10+ s; no console errors. The page requests
  `/lclite/panel.js?v=16`, i.e. the bumped version key, not a cached copy.
- **In-game feel is player-verified** (see the mod's handover checklist): the orb's look
  and position on the minimap, the armed highlight, the `Lookup <name>` left-click while
  armed, and the classic row once the panel setting is switched on.
