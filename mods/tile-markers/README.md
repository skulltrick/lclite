# mods/tile-markers

**Mark tiles by hand, and keep them.** RuneLite's *Ground Markers* plugin, 2004 flavour:
**Shift+right-click** any tile and the right-click menu gains a **"Mark Tile"** row — or
**"Unmark Tile"** if that tile is already marked — and clicking that row toggles the mark.
It is RuneLite's own interaction, not a lookalike: their plugin appends the same row to the
same menu, under the same condition (Shift held, the menu over walkable ground), and the
row is what does the marking. The marks are yours — they persist across sessions, they are
drawn only on the plane you made them on, and they stop drawing beyond 32 tiles from you
(RuneLite's own cull), so a wall of markers does not turn into a wall of noise when you walk
away.

Player-visible effect: a yellow-bordered square appears on the floor of the tile you picked,
with a faint dark wash inside it (RuneLite's own default look). It stays there until you
unmark it, through logouts, world hops and scene reloads. A Shift+right-click over ground
opens the ordinary menu with one extra row at the bottom, directly above *Cancel*; a
Shift+right-click anywhere else (sky, sidebar, chatbox) opens the ordinary menu with no
extra row, and every other right-click in the game is untouched.

## What's in the box

- `files/webclient/src/dash3d/TileMarkers.ts` — the mod's **pure core**: the settings
  parse, the marker store (parse / serialise / find / toggle), the menu row's label and
  action id, the Shift state and the projected-quad decal geometry. It touches no client
  state, so the harness below runs the real shipped logic headlessly. `apply` copies it
  verbatim; the import hunk pulls it into the bundle.
- `patches/289/Client_ts.json` — FIVE hunks into `webclient/src/client/Client.ts`:
  1. the payload import, in the dash3d import group (deliberately **not** after
     true-tile's import line: that island's 2-line context window reaches
     `const CLIENT_VERSION = 289;`, which is how true-tile's own import expired 274's
     `inherits` claim once);
  2. the Shift+right-click **arm**, at the bottom of `mouseLoop()`'s closed-menu branch,
     before the engine's own right-click path (33 untouched lines clear of shift-drop's
     insertion above it). It arms the ground pick and does **not** consume the click, so
     the engine opens its menu as it always did;
  3. the per-frame resolve + row + draw call in `gameDrawMain()`, between `removeSprites()`
     and `entityOverlays()` — after `renderAll` (which resolves the armed ground pick) and
     before the entity overlays and interfaces composite. Deliberately **not** beside
     true-tile's `hoverTileDraw()` call, which is 1 line from the block above it: a second
     insertion there is ONE `-U0` island and regen reports `MIXED MARKERS`;
  4. the row **dispatch**, at the top of `doAction()` — the single funnel every menu click
     passes through, which is where wiki-lookup hangs its own row. The site is 9 pristine
     lines clear of wiki-lookup's `doAction` hunk, whose `find[]` is a contiguous 4-line
     window (`""` / `let action:` / `const a:` / `const b:`): an insertion splitting it
     would break wiki-lookup's anchor, so the clearance is deliberate;
  5. the parked fields + methods, before `getOverlayPosEntity()` — beside the very methods
     `tileMarkersDraw()` uses. That site is a **measurement**: see *The parked-block
     landmine* below.
- Panel rows: `MOD_REGISTRY` + five `MODS[]` rows in
  `mods/control-panel/files/engine/public/lclite/panel.js`, and the same wording in
  `tools/lib.mjs` `MOD_META` (doctor checks the two agree). Adding the rows bumped
  `/lclite/panel.js?v=33` → `34` in control-panel's own `engine/view/client.ejs` hunk —
  without it a returning player keeps the cached panel and the row is missing. The row
  wording was updated for the menu-row interaction in the same commit as the behaviour.
- `tools/tile_markers_edit.py` — the idempotent-by-region edit script that writes the five
  hunks into a live tree (the payload is copied, not generated). Run it twice and the file
  is byte-identical; every anchor must match exactly once.
- `tools/tile_markers_site_search.py` — the brute-force site search described below.
- `tools/tile_markers_test.ts` — 155-check bun harness (see *Verified*).

## How it works (the four decisions)

**The row is added to the menu the engine already opened, not built by a second menu.** This
is the part the engine's own frame order dictates, and it is worth spelling out because it
looks roundabout:

- the menu is **built** every frame while it is *closed* (`otherOverlays()` calls
  `buildMinimenu()` only when `!isMenuOpen`) — that is what feeds the top-left feedback text
  and the left-click default;
- it is **frozen** when `openMenu()` opens it: nothing rebuilds it while it is on screen;
- and it is **painted** later in the same frame, by `drawMinimenu()`.

So the row cannot be written at build time (the tile is not known yet) and cannot be written
at open time either (that happens in `mouseLoop`, before the draw). It goes in between:
`tileMarkersFrame()` runs in `gameDrawMain()` — after `renderAll` has resolved the pick,
before `otherOverlays()` paints the menu — inserts the row at slot 1 (the bottom option,
directly above *Cancel*), and calls `openMenu()` again. `openMenu()` is pure layout (it
computes the menu's width, height, x and y from its option list), so re-running it is the
engine's own layout with one more row, and the row hit-test in `mouseLoop()` reads the same
arrays. The result is a menu that was never drawn without the row in it.

The row is stamped `TM_MENU_ACTION` (1235) — an id in the client's flat action space that is
not a `MiniMenuAction` value, is > 1000 so `buildMinimenu()`'s own bubble sort cannot move
it, and is < `_PRIORITY` (2000) so `doAction()` never treats it as a priority-wrapped engine
action. The **tile rides the row's own `menuParamA/B/C`**, so the row and the tile it marks
cannot drift apart, and the click is handled at the top of `doAction()` — the single funnel
every menu click passes through (the open menu's row click, the left-click default, the
touch paths), which is the same funnel wiki-lookup hangs its row on.

**The tile comes from the ENGINE'S OWN ground pick, not a re-implementation.** A walk click
is resolved by `World.updateMousePicking(px, py)` arming `World.click` with a pixel, after
which the ground rasterizer hit-tests that pixel against every front-facing ground triangle
as it draws — that is the `World.groundX/groundZ` machinery `mouseLoop()` walks you to. The
mod arms exactly that pick on the Shift+right-click, so the tile it marks is the tile a
click at that pixel would have walked you to. Walls, npcs and items do not block it (the
pick is the GROUND), ground the camera cannot see can never be picked, and the mod needs
**no `World.ts` hunk at all** — which also keeps it out of the three pick sites `true-tile`
owns.

That resolution happens during the NEXT `renderAll`, one call later, so the click handler
only ARMS the pick (`tileMarkersPending`) and `tileMarkersFrame()` reads it back after the
draw, then clears `groundX/groundZ` and calls `World.clearPick()` — before `gameLoop()`'s
own walk consumption can see it. **The pick never walks you**, and a pick that resolves to
nothing (clicking the sky) is dropped rather than left to resolve onto somebody else's
click: the menu opens with no extra row, exactly as it would have without the mod.

The row's **label** is decided where the row is written, from the store as it stands at that
moment (`tmMenuLabel`): "Mark Tile" when the tile is unmarked, "Unmark Tile" when it is —
RuneLite's own `existingOpt.isPresent() ? "Unmark" : "Mark"`.

**The marks are positional numbers, never objects.** `tileMarkersMarks` is a JSON array of
flat `x, z, level` triples. Terser's property mangler renames object-literal KEYS, so a
store written as `[{x,z,level}]` could not be read back by the next build (the same
positional law the bundle↔page boundary follows); an array of numbers has no keys to mangle
and makes the per-frame walk a strided loop with no allocation. A mark is per
`(x, z, plane)`: the same tile upstairs is a different mark, exactly as RuneLite's
`p.getZ() == worldPoint.getPlane()` filter treats it.

**The decal is Pix3D triangles, drawn over the scene.** RuneLite's ground markers are an
`OverlayLayer.ABOVE_SCENE` overlay, so this draws after `renderAll` and before the
interfaces — the same ride as `true-tile`'s hovered tile, and the reason the marks read
over the ground rather than under the player's feet. `Pix3D.trans` is BOTH the destination
weight the software raster mixes with AND the per-triangle alpha the gpu mod captures, so
the wash blends with the ground in either renderer; a translucent pixel written straight
into the game buffer cannot (on a gpu frame that buffer is sentinel-cleared, so the mix runs
against black and the HUD overlay then paints the result opaque — the bug `true-tile`
already paid for). Geometry is the same mitred-ring-plus-wash decal `true-tile` ships: the
copy is deliberate, because a shared library would make one mod's hunk a dependency of the
other's. Height comes from `getOverlayPos(corner, 0)`, i.e. the ground of the PLAYER's
level with the engine's own LinkBelow promotion — the surface the player's feet are on for
that tile, which is where a marker made on this plane belongs (on the Lumbridge bridge the
level-0 square IS the deck).

## Settings contract

All of these are this mod's OWN localStorage keys, read at its own hook (hard rule 5) —
`tileMarkersClick` reads the master key to decide whether the click is even ours, and
`tileMarkersFrame` reads all of them **every frame**, so every change lands on the next
frame with no reload and no rebuild.

| key | values | default | row |
|---|---|---|---|
| `tileMarkers` | `'true'`/`'false'` | `'true'` | master switch on the mod's row |
| `tileMarkersColor` | `'#rrggbb'` | `'#ffff00'` | Border color (RuneLite's `markerColor`) |
| `tileMarkersFillColor` | `'#rrggbb'` | `'#000000'` | Fill color (RuneLite's fill is always black) |
| `tileMarkersOutline` | `'1'`–`'8'` px | `'2'` | Border width (slider) |
| `tileMarkersFill` | `'0'`–`'100'` % | `'20'` | Fill opacity (slider) |
| `tileMarkersMarks` | JSON flat `[x,z,level,…]` | absent | no row — made in game; the **Clear all markers** action deletes it |

Every value is validated in the payload, not at the call site: a stale, hand-typed or
half-written key clamps (colour → default unless it is a 7-char `#rrggbb`, width 1–8 px,
opacity 0–100 %) and can never paint garbage. Only the literal `'false'` disables the mod —
`undefined`/junk means "never touched it", so an install that has never opened the panel
still gets the feature. The store is validated harder than it is repaired: anything that is
not a whole number in range is **dropped**, so a truncated or hand-edited store can never
paint a marker at a garbage coordinate. The cap is `TM_MAX_MARKS` (512); a full store
refuses a new mark rather than evicting one of yours.

## Deliberate divergences from RuneLite, and limits

- **The menu row is RuneLite's own interaction, ported** (their `onMenuEntryAdded`:
  `hotKeyPressed && (menuAction == WALK || SET_HEADING)` → `setOption(marked ? "Unmark" :
  "Mark")` + `setTarget("Tile")`, and the row's click toggles the tile). The label, the
  condition for adding the row and the slot it takes are theirs. Two mechanics differ, both
  forced by how this engine works rather than chosen:
  - **The tile is the one under the cursor at the CLICK**, from the engine's own ground pick,
    where RuneLite reads a live per-frame hover pick (`wv.getSelectedSceneTile()`). A live
    hover pick here would have to be armed every frame against `World.click`, which is the
    same state a real walk click uses — true-tile owns the three pick sites that make that
    safe, and borrowing them would make one mod a dependency of the other. The visible
    consequence: the row describes the tile you right-clicked, not the tile the cursor has
    drifted onto while the menu is open.
  - **The row stays in the menu after Shift is released.** This engine freezes the menu once
    it is open, so there is no per-frame rebuild to remove it from; RuneLite's row disappears
    with the key. Releasing Shift before clicking the row therefore still works here.
  Shift is otherwise free in this client (shift-drop uses it for LEFT clicks only, and the
  engine never reads it), and a right-click with Shift **not** held is untouched in every way.
- **No import/export, no labels, no per-marker colours.** RuneLite's sharing manager, its
  per-marker `Label`/`Color` submenu, and its minimap overlay are all out of scope. Every
  mark shares the mod's colour.
- **Not per-region storage.** RuneLite keeps `region_<id>` config keys and re-derives world
  coords from `(regionId, regionX, regionY, plane)`; the split exists so a big marker set is
  not rewritten wholesale, which localStorage does not need. This mod stores absolute world
  tiles in one key.
- **One plane only.** Marks are drawn when `level === minusedlevel`, so a mark made
  downstairs is invisible upstairs (RuneLite's own plane filter). A mark on the outermost
  ring of the scene (tile 0 or 103) draws nothing — `getOverlayPos` itself refuses scene
  coords below 128, exactly like the engine's own hint arrow out there.
- **No hover preview.** Holding Shift does not ghost the tile under the cursor: that needs a
  per-frame ground pick, which would fight the engine's walk pick for the same
  `World.click` state (the reason the pick here is armed only for a click). If you want to
  see where the cursor is, `true-tile`'s hovered-tile marker is the honest tool for it.
- **The marks are local.** They are a client-side visual, so nobody else sees them and
  nothing about them reaches the server. Losing `tileMarkersMarks` (a cleared browser
  profile, "Clear all markers") loses the marks: there is no backup and no undo.

## The parked-block landmine (why the block sits where it sits)

`git diff -U0` aligns the whole file, so inserting a large block can re-split ANOTHER mod's
islands into fragments with no marker line: regen then files those fragments differently and
`git status --short mods/` names a patch JSON nobody touched. Parked at the END of the class
— the obvious home — this mod churned `ground-items`' and `true-tile`'s corpora (measured:
ground-items' 4-line window expanded to 9 lines and its hunk split in two). Parked beside
`true-tile`'s own block (`checkMinimap`) or `camera`'s (`addPlayers`), regen reported
`MIXED MARKERS`. `tools/tile_markers_site_search.py` inserts the block at every candidate
method boundary, runs a REAL regen for each, and reports the collateral; the overlay-
projection run before `getOverlayPosEntity()` came back clean, and that is where it lives.
Re-measure with `python mods/tile-markers/tools/tile_markers_site_search.py --one '<anchor>'`
if it ever has to move.

## Verified

- `tools/tile_markers_test.ts` — **155 checks, all green**, against both the `files/`
  payload and the copy inside an applied tree. It covers the settings parse (defaults, every
  clamp, a garbage store), key isolation (the exact set of keys read — five, no more), the
  store (round-trip, junk JSON, a truncated triple, fractional/string/out-of-range values,
  the cap), find/toggle semantics (plane-distinct, order-preserving, non-mutating, the
  full-store refusal), the two culls (Chebyshev 32, the scene bounds), the Shift state, and
  the **menu row** (the label on an unmarked / marked / other-plane / second mark, the label
  flipping on the very array `tmToggle` returns, and the action id: > 1000 so the engine's
  sort cannot move it, < `_PRIORITY` so it is never priority-wrapped, and colliding with no
  engine action id above 1000 nor with wiki-lookup's row).
  The decal is checked by **rasterizing the emitted triangles against an independent
  geometry oracle**: for an axis-aligned, a rotated, a sheared and a reversed-order quad,
  every pixel inside the border band must be painted opaquely, no pixel clear of the border
  and the mitre may be painted by the ring, every interior pixel must carry the wash, and
  nothing may be painted outside the quad — plus the exact triangle budget (10 with a fill,
  8 without), the `trans` values (20 % → 205, 100 % → 0), the 3px-wide overlap case, the
  1px-wide fallback, and degenerate quads emitting nothing.
- `tsc --noEmit` clean on the full tree, and clean with `apply --mods tile-markers` alone
  (the mod depends on no other mod).
- `regen` twice byte-identical, and the regen that produced the new corpus changed **only**
  this mod's patch JSON (`git status --short mods/` named `mods/tile-markers/patches/289/
  Client_ts.json` and nothing else) — the doAction hunk's insertion point was checked
  against wiki-lookup's own doAction hunk (`find[]` is a contiguous 4-line pristine window,
  and this mod's window sits 7 pristine lines above it, so neither apply order breaks the
  other). `apply --check` ✗0 (17/17 mods) · `doctor` exit 0 (147 hunks, markers 147/147) ·
  `matrix` green on every declared revision (274 inherits all 147 hunks exactly; 254 applies
  its own 18 and does not carry this mod) · `tools/acceptance.sh` byte-compares a pristine
  clone at the pinned revs against the live install (this mod's payload included) and proves
  the converge round-trip byte-stable.
- `node tools/lclite.mjs build`: the deployed `engine/public/client/client.js` carries all
  six key literals (`tileMarkers`, `tileMarkersColor`, `tileMarkersFillColor`,
  `tileMarkersOutline`, `tileMarkersFill`, `tileMarkersMarks`) **and both row labels**
  (`Mark Tile`, `Unmark Tile`) — the terser property mangler renames the mod's function
  names, never these strings, so the panel and the engine agree in prod. `installed.json`
  lists the mod.
- Panel, live page (`http://localhost/rs2.cgi`, panel.js?v=35 — the bump is what stops a
  returning player's cached panel from showing the old one-line description): the **Tile
  markers** row appears with the right name/description (the wording above), a master switch
  that is ON, the gear and the live status ("no tiles marked"); opening it shows five rows —
  Border color `#ffff00`, Fill color `#000000`, Border width `2px` (readout "2px"), Fill
  opacity `20%` (readout "20%"), Clear all markers; the master switch writes `tileMarkers`
  `'false'`/`'true'` and the status hides while off; no console errors, no page errors.
- **What is NOT proven headlessly:** everything engine-side — that the ground pick resolves
  on a real Shift+right-click, that the row lands in the menu the engine actually opened
  (with the right label, at the right slot, and a menu geometry tall enough to contain it),
  that clicking the row toggles the tile under the cursor and that the row's own click is
  consumed before any game action, that the pick is cleared before the walk consumption (so
  the gesture never walks you), and the visual read of the decal over the scene. Those are
  in-game checks (see the handover list), not harness checks; the harness's own header says
  so.
