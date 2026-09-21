# mods/ground-items

**Labels on the items lying on the ground** — RuneLite's *Ground Items* plugin, as a
2004Scape mod.

Player-visible effect: every item you can see on the floor carries its name above it, and
holding **Alt** reveals the ones you filtered out plus a small `[-]` / `[+]` pair beside
every label — click `[-]` to hide that item from then on, `[+]` (or the label itself) to
always show it. That is RuneLite's own curation loop, including its `[-]`/`[+]` boxes, and
the two lists it edits are the same ones the panel's *Shown items* / *Hidden items* text
rows read and write. Every setting applies on the next frame: nothing here needs a rebuild
or a reload.

## What's in the box

- `files/webclient/src/client/GroundItems.ts` — the mod's **pure core**: the high-alch
  value, the label text, the shown/hidden list edits, the label classification, the
  distance cull, the `[-]`/`[+]` box hit test and the Alt state. It touches no client
  state, so the harness below runs the real shipped logic headlessly. `apply` copies it
  verbatim; one import hunk in `Client.ts` pulls it into the bundle.
- `patches/289/Client_ts.json` — FOUR hunks into `webclient/src/client/Client.ts`:
  1. the payload import, in the clean gap of the import block (clear of every other mod's
     import islands);
  2. the six box arrays + `giBoxAdd()` / `groundItemsDraw()` / `giDrawBox()` /
     `groundItemsAltClick()`, parked in the pristine gap before `mapBuild()`;
  3. `this.groundItemsDraw()` as the **last statement of `entityOverlays()`**;
  4. `if (this.groundItemsAltClick()) return;` at the **top of `mouseLoop()`**.
- Panel rows: a `MOD_REGISTRY` entry + seven `MODS[]` rows for `ground-items` in
  `mods/control-panel/files/engine/public/lclite/panel.js`, plus a new **`kind: 'text'`**
  row type (see *Settings contract*).
- `tools/ground_items_test.ts` — 86-check bun harness (see *Verified*).

## Where it draws, and why there

The labels are painted at the **end of `entityOverlays()`**. That is still inside the
per-frame world pass: `Pix2D` is bound to the 512×334 `areaGame` buffer (the same ride as
`true-tile`'s outline and its hovered-tile square), and `otherOverlays()` runs afterwards, so
**interfaces still composite on top of the labels** — a bank, a dialogue or the
character-design screen covers them exactly as it covers the ground itself. Drawing after
`otherOverlays()` (e.g. beside `areaGame.draw(4, 4)`) would put labels over the bank.

The site was also chosen for the hunk system: `entityOverlays()`'s body carries no other
mod's markers, and the insertion leaves three untouched lines (the method's closing brace,
a blank, `coordArrow`'s signature) before `true-tile`'s block, so `-U0` keeps them as
separate islands.

## How an item is found and placed (the design decisions)

**The item list is the client's own.** `Client.groundObj[level][x][z]` is the engine's
per-scene-tile `LinkList` of `ClientObj` (id + count), and `showObject()` files every one
of them under `minusedlevel` — the same array the client's own ground-item right-click
menu and its minimap item dots walk. So the mod reads the items the client is actually
rendering, in the engine's own "top item first" order (`showObject` pushes the highest-cost
item to the head), instead of reverse-engineering spawn packets.

**The position is the engine's own projection.** `getOverlayPos(sceneX*128+64, sceneZ*128+64,
GI_OFFSET_Z)` is the call entity names and `true-tile` use; it walks `getAvH`
per point, so a label sits on the ground correctly on slopes and stairs, and returns
`projectX = -1` behind the camera or outside the build area.

**The cull is RuneLite's own number.** Labels are drawn for items within 2500 local units
(~19.5 tiles) of the player — `GroundItemsOverlay.MAX_DISTANCE`, kept identical on purpose.
RuneLite does **not** occlusion-test its labels (no wall or roof check), so neither does
this mod; the scan is bounded to a ±21-tile box around the player, which is what keeps it
cheap.

**Stacked items stack their labels.** Two items on one tile get two labels 15px apart
(`GI_STRING_GAP`, RuneLite's), up to five per tile. The order is the client's own list
order, so the label nearest the ground belongs to the item the engine chose as the tile's
top model.

**One label class, three colours.** A label is *hidden* (on the hidden list → no label
unless Alt is held, then the dim colour), *shown* (above the value threshold, or no
threshold set → the label colour), or *listed* (on the shown list → the highlight colour).
RuneLite's `getHighlighted()`/`updateItemColor()` rank them the same way, including hidden
beating shown when a name somehow ends up on both lists.

## The click that curates the lists

With Alt held, every label carries the two boxes, and a click that lands on one is
consumed at the **top of `mouseLoop()`** — before `buildMinimenu`'s dispatch, before the
item-drag setup and before the walk/take action — so curating a list can never make you
walk somewhere or pick something up. Anything else falls through untouched: Alt+click on
the world still walks, Alt+click on an item still takes it. RuneLite's own mouse adapter
does exactly this (it consumes the click only when it hit a label box).

The click pixel is the buffer-space `mouseClickX/mouseClickY - 4`; the `-4` is the
`areaGame.draw(4, 4)` composite offset the engine itself applies when it sets
`Model.mouseX = this.mouseX - 4`. Boxes are re-collected every frame while Alt is held, so
the hit test always matches the boxes the player can actually see (one frame of latency,
the same as RuneLite's overlay/mouse ordering).

The list edit is RuneLite's `updateList()`: toggle the clicked list, and drop the name from
the other one, so an item can never be on both.

## Settings contract

All of this mod's **own** localStorage keys, read per frame at its own hook (hard rule 5).
No other mod reads them, and this mod reads no other mod's keys.

| key | panel row | default | meaning |
|---|---|---|---|
| `groundItems` | master switch on the mod's row | `true` | the whole mod |
| `groundItemsValue` | Min high alch value (slider) | `0` | only label items whose high alch value is **above** this. `0` = no value filter |
| `groundItemsShown` | Shown items (text) | `''` | comma-separated names to always label (highlight colour) |
| `groundItemsHidden` | Hidden items (text) | `''` | comma-separated names to never label |
| `groundItemsShowValue` | Show high alch value (toggle) | `false` | append `(23.4K gp)` to each label |
| `groundItemsColor` | Label color | `#ffffff` | a normal label |
| `groundItemsHighlightColor` | Shown-item color | `#ff9040` | an item on the shown list |
| `groundItemsHiddenColor` | Hidden-item color | `#808080` | a hidden item while Alt is held |

- Name matching is **case-insensitive** and exact (no wildcards); the list keeps the
  spelling the game used, which is what `ObjType.name` gives.
- The two text rows are edited in the panel *and* by Alt+click in game — one string, two
  editors, no shadow state.
- `kind: 'text'` is new to the panel: it writes the raw string on `change` (Enter/blur)
  rather than per keystroke, so the engine never reads a half-typed list and a re-render
  cannot eat a keystroke. `.lcm-text` in `panel.css` styles it.
- `Reset all lclite settings` (which wiped every `groundItems*` key by prefix) is gone
  from the panel: nothing wipes keys any more, so the two text rows are edited in place
  (an empty list labels every item that is not on the hidden list).

## The high alch value is the server's, not an estimate

The client has no GE prices, so the only honest "price" is what the server pays. Lost
City's alchemy does `max(scale(6, 10, oc_cost($item)), 1)`
(`content/scripts/skill_magic/scripts/spells/alchemy.rs2`) — 0.6 × the obj config's cost,
floored, minimum 1 — and the client's `ObjType.cost` is the same number the server reads.
`giHaValue()` reproduces it exactly, so the threshold compares against the real coin
payout. The value is only *displayed* when asked for, and never for a 1gp item, so coins
(whose cost is 1) do not grow a pointless `(1 gp)` — RuneLite special-cases coins by item
id for the same reason; this uses the value instead of hardcoding id 995.

## Deliberate divergences from RuneLite, and limits

- **Alt is not configurable** (RuneLite's hotkey is). Alt is free in this client —
  `GameShell` has no `altKey` use — and it is already the placement modifier, so the mod
  uses it directly rather than adding a key-binding surface.
- **No despawn timers, lootbeams, ownership filter or per-item name colours.** Those are
  RuneLite features this mod does not port; the value filter, the two lists and the Alt
  boxes are the ones a 2004 player actually uses.
- **No GE prices, so no price display mode** — the single value shown is the high alch
  value (see above).
- **Labels are not occlusion-tested** (RuneLite's are not either): an item in the next room
  is labelled through the wall if it is within 2500 local units.
- **The label font is `p11`**, the engine's own small font (damage values, XP drops), not a
  scaled-up name font — labels stay compact over a cluttered floor.
- **Alt-held labels of hidden items are dim grey, not the item's own colour** (RuneLite
  keeps the colour and dims it); one colour row controls it instead.
- The Alt state is tracked off the DOM (`window` keydown/keyup in the capture phase, plus
  `blur`), the same pattern `wiki-lookup`'s menu modifier uses. Alt+Tab mid-hold clears it,
  because the keyup never arrives.
- **A label whose boxes would fall off the buffer is drawn without them** (the label itself
  is still clickable); a label off the buffer entirely is skipped.
- The label list is capped at 1024 boxes and 5 labels per tile, so an absurd pile of drops
  cannot cost a frame.

## Verified

- `bun run mods/ground-items/tools/ground_items_test.ts` — **86 checks, 0 failures**
  (run against the shipped payload and, with `LCLITE_ROOT`, against the applied tree):
  the high-alch table (written out by hand from the server's formula, including the
  floor-not-round case and the min-1 clamp), the stack-size formatter, the settings parse
  (junk, negative and huge thresholds all clamp; malformed hex colours fall back), list
  parsing and edits (case folding, toggling, capitalisation, refusals), the classification
  table with both edges (threshold 0 and the strict "above"), the label text, RuneLite's
  distance cull, and the box hit test against the **real** label geometry including the 2px
  gap between the two boxes.
- `node tools/lclite.mjs apply --check` → ✗0 on every mod (ground-items: 4 hunks);
  `node tools/doctor.mjs` → exit 0, healthy, markers 126/126.
- `node tools/regen.mjs` twice → byte-identical corpus (idempotent).
- `tsc --noEmit -p tsconfig.json` in the applied webclient → clean.
- `node tools/matrix.mjs` → 274 still inherits the 289 corpus (its anchors are
  revision-stable); 254 has no ground-items corpus, like camera/hotkeys/stat-orbs.
- Acceptance: pristine clones at the pinned revisions + `apply` reproduce the live tree
  byte-for-byte (see the repo README's acceptance section).
