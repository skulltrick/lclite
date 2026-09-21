# mods/true-tile

**Three tile markers in one mod** — RuneLite's *Tile Indicators*, all three sections:
the tile the **server** has you on (the true tile), the tile your **mouse** is over (the
hovered tile) and the tile you are **walking to** (the destination tile). Each has its own
section in the mod's panel view, its own colour/border/fill, and its own on/off switch.

Player-visible effect: a square sits **on the floor under your character**, marking the
tile the SERVER believes you are standing on (it pulls ahead of the model by up to a full
tick while you run — that is the whole point: it is how you see the tick you are actually
on); a second square follows the **cursor** over the ground it is pointing at, sheared on
slopes and stairs, hidden once the cursor leaves the scene; and a third sits on the tile
you **clicked to walk to**, staying lit until the true tile reaches it. All three apply
their settings on the next frame — nothing here needs a rebuild or a reload.

## The 2026-09-21 merge: hover-tile moved in here

`mods/hover-tile` was a separate mod that shipped the hovered tile on 2026-09-18. It is
retired: its code, its three settings keys and its harness moved into this mod, and its
own panel section is now the **Hovered tile** section of this one's view. Two things were
deliberate about the move:

- **The keys did not change.** `hoverTile`, `hoverTileColor`, `hoverTileOutline`,
  `hoverTileFill` are still the keys the engine reads and the panel writes, so nobody's
  settings reset — the marker's switch simply lives inside this mod's view now, and the
  mod's own row switch (`trueTile`) gates all three markers at once.
- **The geometry did not get a second copy.** Both mods carried a byte-identical copy of
  the projected-quad decal (they were written as siblings); the merged payload has ONE
  `tileDecal()`, and the two harnesses became one (194 checks) with the old per-pixel
  rasterizer kept as the parity oracle.

Everything else about the hovered marker is unchanged: still resolved by the engine's own
ground pick, still drawn **over** the scene (a cursor highlight, deliberately not occluded
by the player) — see *Where each marker draws* below.

## What's in the box

- `files/webclient/src/dash3d/TrueTile.ts` — the mod's **pure core**: the settings parse
  for all three markers plus the projected-quad decal geometry they share. It touches no
  client state, so the harness below runs the real shipped logic headlessly. `apply` copies
  it verbatim; the import hunks in `Client.ts` and `World.ts` pull it into the bundle.
- `patches/289/Client_ts.json` — FIVE hunks into `webclient/src/client/Client.ts`:
  1. the payload import, at the end of the import block (clear of every other mod's
     import islands);
  2. the arm block in `gameDrawMain()`, after the camera-shake loop and before `Pix2D.cls()`
     + `World.renderAll()` — it hands World the server tile, the model tile, the level, and
     the client's own destination tile;
  3. `this.hoverTileArm()` right after `Model.mouseY` is set and **before** `renderAll` —
     the hover pick has to be armed before the ground is rasterized;
  4. `this.hoverTileDraw()` right after `this.coordArrow()` — after `renderAll`, before
     `areaGame.draw(4, 4)`;
  5. `hoverTileArm()`/`hoverTileDraw()`, parked in the pristine gap after `getAvH()`.
- `patches/289/World_ts.json` — SEVEN hunks into `webclient/src/dash3d/World.ts`:
  1. the payload import;
  2. the hover pick's fields, beside the existing `click`/`groundX` group (plus the
     destination marker's armed state);
  3. the true tile's armed state, `World.trueTileArm()`, the destination's `destTileArm()`,
     the shared `groundHeight()` / `tileQuad()` / `tileDecalDraw()` helpers and the two
     decals (`trueTileDecal`/`destTileDecal`), parked in the pristine run of small accessors
     after `removeSprites()`;
  4. one call in `fill()`, immediately after the tile's ground is drawn and **before** its
     walls and sprites — both ground decals draw from there;
  5–7. one pick site each in `renderQuickGround()` (both ground triangles) and
     `renderGround()` (the legacy face path).
- Panel rows: `MOD_REGISTRY` + thirteen `MODS[]` rows for `true-tile` in
  `mods/control-panel/files/engine/public/lclite/panel.js`, in three sections (this is what
  the `kind: 'section'` row was added for).
- `tools/true_tile_test.ts` — 194-check bun harness (see *Verified*).

## How each marker is resolved (the design decisions)

**The true tile is the server's tile, not the model's.** It is the head of the local move
queue, `localPlayer.routeX/routeZ[0]` — the value the engine's own teleport/reset paths
snap to — while `player.x/z` is what the model lerps toward. That is why the square leads
your character while you run.

**The hovered tile is the engine's own ground pick, not a re-implementation.** `World`'s
ground rasterizer already hit-tests a mouse pixel against every front-facing ground
triangle it draws — that is the `World.click`/`World.clickX/clickY` machinery a left click
uses to decide where you walk. The mod adds a second, independent arming of exactly that
test (`hoverArmed` + `hoverMouseX/Y`, the three pick sites), and because tiles are drawn
back-to-front **the last hit is the nearest one** — the same tile a click at that pixel
would send you to. Three things fall out of that for free:

1. **The highlight can never disagree with the walk pick.** It is literally the same test.
2. **Visibility is the engine's own.** Behind-the-camera and out-of-area ground is never
   rasterized, so it can never be highlighted; nothing needs a separate frustum or
   occlusion test.
3. **It composes with the renderer mods.** The gpu mod hijacks the *rasterizers* but
   deliberately leaves picking on the CPU (`World.groundX` and friends still resolve), so
   the hover pick keeps working with the GPU renderer on.

**The destination tile is the client's own destination, not a click hook.** The engine
already tracks it: `Client.minimapFlagX/Z` is set by `tryMove()` to the path's destination
tile — the same tile the minimap draws its own flag on, and the nearest REACHABLE tile
when the click was blocked — and the engine zeroes it the moment the player's model
arrives. So the marker reads that flag instead of intercepting clicks (no hook in the
click paths at all, and it is correct for every kind of move: a scene click, a minimap
click, an npc/object approach). Its one rule of its own is the one the mod was asked for:
**it gives way the moment the TRUE tile is on it**, so the square is gone the tick the
server has you there rather than a tick later when the model catches up.

## The elevation law (the 2026-09-21 fix: bridges and hillsides)

A tile marker has to sit on the ground **that was drawn**, and for two kinds of terrain
that is not the ground of the level you are standing on. `World.pushDown()` moves a
LinkBelow tile's squares down a level at scene-build time: a **bridge deck** and a
**hillside** are authored on level 1 (with the level-1 ground carrying the deck/slope
heights), the level-0 square underneath is the water/flat ground, and the engine shifts the
level-1 square down to level 0 and parks the original as that square's `linkedSquare`, so
the scene loop finds both where it expects them. `fill()` then draws the linked square at
level 0 and the tile's own ground at **`Square.originalLevel`** — and so does
`groundOccluded()`.

Both markers used to ignore that, and the Lumbridge bridge showed it from both sides at
once (the deck is real map data: `mapl[1]` carries `LinkBelow` on x31–39, z61–62 of map
square m50_50, the water beneath is at `groundh[0] = -8` and the deck at `groundh[1] =
-248`, a full 240 units — 1.875 tiles — above it):

- the **true tile** read `groundh[loopLevel]`, i.e. `groundh[0]` = **the water**, so
  stepping onto the bridge dropped the square off the deck into the river;
- the **hovered tile** asked `Client.getAvH(cx, cz, level)` for the level the rasterizer
  had already drawn (level 1, the deck) — and `getAvH` **promotes** a level by one for
  LinkBelow tiles, because its own callers pass the *player's* level and the promotion is
  what maps level 0 onto the deck. Asking it for an already-promoted level promotes it a
  second time: `groundh[2]` = 240 units of air above the deck. Hence "the hover tile shows
  a few tiles up in the air".

The fix is one rule, applied to all three markers: **the ground height of a tile marker
comes from the level that ground was DRAWN at, with no LinkBelow promotion.**

- the two ground decals take `heightLevel = Square.originalLevel` from `fill()` (the value
  the engine itself hands the rasterizer) and sample `World.groundHeight(heightLevel, …)`;
- the hovered tile takes the level its own pick recorded (`World.hoverLevel`, the
  rasterizer's `level` argument = the same `originalLevel`) and samples the same helper —
  so the outline hugs the ground under the cursor instead of a level above it. The legacy
  `Ground` path records `-1` (it has no level in scope), and there the engine's own
  `getAvH` answer — the player's level, promoted — is kept, which is what the marker
  shipped with.

`World.groundHeight()` is `getAvH`'s bilinear sample without the promotion, with the
bounds guard `getAvH` has. On an ordinary tile the two agree exactly; they differ only
where `pushDown` has moved a square, which is precisely where the markers were wrong.

The two markers now also agree with each other by construction: the decal sits at
`groundh[originalLevel]`, and the player's own model is placed at `getAvH(minusedlevel)` —
the same number, because the promotion exists for exactly these tiles. So the true tile is
on the deck **because** the player is.

## Where each marker draws, and why they differ

- **True tile and destination tile are GROUND GEOMETRY**, drawn on that tile's own turn in
  the scene fill order (`World.renderAll` walks back to front and `fill()` draws each
  tile's ground, then its walls, then its sprites; the mod's call sits between the ground
  and the walls). Everything the engine draws after that point covers them — the player's
  model above all, but equally an NPC standing there, a wall on the tile, or a nearer
  tile's ground that rises in front of them. That is the RuneLite reading of a true tile
  ("a square appears under your character"): the marker is on the floor, not pasted over
  the model. Drawing it later in the frame — which is what this mod used to do, from
  `coordArrow()` into the game buffer — paints it over the character's feet and reads as
  floating in front of them.
- **The hovered tile is drawn OVER the scene**, after `World.renderAll` and before
  `areaGame.draw(4, 4)`. A hovered tile is a cursor highlight, not a ground decal: it
  should read on top, and it is deliberately **not** occluded by the player or by walls.
  That is the one place the markers differ, and it is a documented divergence (RuneLite
  draws all three above the scene; this mod puts the two tile markers on the floor).
- **All three go in as Pix3D triangles carrying `Pix3D.trans`.** That single value is BOTH
  the destination weight the software raster mixes with AND the per-triangle alpha the gpu
  mod captures, so the fill blends with the ground in either renderer. A translucent pixel
  written straight into the game buffer cannot work on a gpu frame: the buffer is
  sentinel-cleared and the world is drawn on the GPU, so the mix runs against black, and
  the HUD overlay then paints the result opaque — the "darker green that lightens as you
  raise the fill" bug. See `mods/gpu/README.md` for the overlay contract.

The cost is ten triangles per marker per frame at most (a two-triangle wash plus four
mitred ring quads), and it is zero when a marker is off — the master key is read inside the
draw, before any geometry is built.

## Settings contract

All of these are this mod's OWN localStorage keys, read at each marker's own hook **every
frame** — no hub, no other mod's key, and every change lands on the next frame. The mod's
row switch is `trueTile`; each marker's first row in its own section is that marker's
switch, so the hovered and destination markers can each be silenced without losing the true
tile.

| section | key | values | default | row |
|---|---|---|---|---|
| *(mod)* | `trueTile` | `'true'`/`'false'` | `'true'` | master switch on the mod's row |
| True tile | `trueTileColor` | `'#rrggbb'` | `'#00ff00'` | Outline color |
| True tile | `trueTileOutline` | `'1'`–`'8'` (px) | `'1'` | Border thickness (slider) |
| True tile | `trueTileFill` | `'0'`–`'100'` (%) | `'0'` | Fill opacity (slider) |
| True tile | `trueTileOnlyDesync` | `'true'`/`'false'` | `'false'` | Only when out of sync (toggle) |
| Hovered tile | `hoverTile` | `'true'`/`'false'` | `'true'` | Highlight hovered tile (toggle) |
| Hovered tile | `hoverTileColor` | `'#rrggbb'` | `'#ffffff'` | Outline color |
| Hovered tile | `hoverTileOutline` | `'1'`–`'8'` (px) | `'2'` | Border thickness (slider) |
| Hovered tile | `hoverTileFill` | `'0'`–`'100'` (%) | `'20'` | Fill opacity (slider) |
| Destination tile | `destTile` | `'true'`/`'false'` | `'true'` | Highlight destination tile (toggle) |
| Destination tile | `destTileColor` | `'#rrggbb'` | `'#808080'` | Outline color |
| Destination tile | `destTileOutline` | `'1'`–`'8'` (px) | `'2'` | Border thickness (slider) |
| Destination tile | `destTileFill` | `'0'`–`'100'` (%) | `'20'` | Fill opacity (slider) |

Every value is validated in the payload (one shared validator behind the three parsers),
not at the call site: a stale, hand-typed or half-written key clamps (colour → default
unless it is a 7-char `#rrggbb`, border 1–8 px, fill 0–100 %) and can never paint garbage.
Only the literal `'false'` disables a marker. `trueTileOnlyDesync` is RuneLite's "hidden"
behaviour — draw the true tile only while the model tile and the server tile disagree — and
it is off by default so the square is always visible.

## Deliberate divergences from RuneLite, and limits

- **RuneLite draws all three markers ABOVE the scene** (one `OverlayLayer.ABOVE_SCENE`
  overlay, `Perspective.getCanvasTilePoly` + `renderPolygon`). This mod puts the true tile
  and the destination tile **on the floor** — they are tile markers, and a marker the
  player's own model stands on reads better under the model than over it. The hovered tile
  matches RuneLite (over the scene, never occluded).
- **One colour per marker, not two.** RuneLite gives the border and the fill separate
  colours (both with their own alpha). This mod keeps one colour plus a fill percentage, so
  the fill is the border colour washed over the tile and the three markers read the same in
  the panel.
- **The defaults are visible.** RuneLite ships the plugin off, with the hovered tile off
  and a fully transparent border colour — out of the box you see nothing until you
  configure it. A mod whose whole point is the markers has to show something the moment it
  is installed, so this one defaults to green/1px/no-fill (true tile), white/2px/20 %
  (hovered) and grey/2px/20 % (destination — RuneLite's own `Color.GRAY` and its 2px
  border; only the wash differs, per the one-colour contract above). RuneLite's
  "Highlight destination tile" is on by default too.
- **The border is screen-space, not scene-space.** A marker's outline is a pixel width: the
  ring is built from the projected corners, mitred per corner, so it stays `thick` px on a
  sheared or zoomed quad. It is not a world-space inset, so the border does not thicken as
  you zoom in.
- **A tile thinner on screen than the border is thick** (a very small quad, or a zoomed-out
  tile) has no valid inner quad: the ring would turn itself inside out, so the whole tile is
  drawn as border. That is exactly the pixel set the old per-pixel rasterizer covered there.
- **The true and destination markers are occluded by everything in front of them**, not
  just by the player: a wall on the tile, an NPC standing on it, or a nearer tile's rising
  ground all paint over the square. That is the honest consequence of putting them on the
  floor, and it is the RuneLite look too.
- **The destination marker and the engine's own click cross can both be on screen.** The
  engine draws its animated click cross (`crossX`/`crossY`) where you clicked; this marker
  marks the tile you are walking to until you get there. RuneLite has the same overlap. If
  the cross is enough for you, switch the destination marker off in its section.
- **A destination outside the loaded scene draws nothing.** The marker is drawn from
  `fill()`, so a tile the scene never reaches (a minimap click to somewhere far off, or
  beyond the build area) has no decal — the engine's own minimap flag is the marker for
  that. Nothing is drawn on the login screen either (no player, no scene).
- **Only over the game viewport, for the hovered marker.** The pick is armed only while the
  cursor is inside (4,4)–(516,338) — the same rect the engine's own option picking uses.
  There is no scene behind the sidebar, chatbox, minimap or letterbox, so there is nothing
  to point at.
- **289 and 274 only, for this design.** `274` inherits the 289 corpus. `254` still carries
  this mod's PRE-rework corpus (the per-pixel rasterizer, drawn over the character, and no
  hovered/destination marker): porting the current design there needs the 254 tree put back
  in sync first — two of `tcg`'s 254 hunks (`bundle.ts`, `engine/view/client.ejs`) no
  longer anchor, so a `regen` on that tree would silently drop them. Once that is resolved,
  `node tools/port.mjs 254 --mods true-tile` + a 254-side `regen` is the whole job.

## Verified

- `tools/true_tile_test.ts` — **194 checks, all green**, run against both the `files/`
  payload and the copy inside an applied tree. It covers all three settings tables
  (defaults, every clamp, a garbage store) plus key isolation — each marker must read its
  own four keys and ignore the other two markers' — and the decal geometry against the
  mod's **own previous per-pixel rasterizer**, kept in the harness as the parity oracle:
  for an axis-aligned quad, a 20°-rotated quad and a sheared one, in every vertex order and
  winding, no painted pixel is more than 1px from the old implementation's set and every
  pixel clear of the ring's boundary lands in the same class. Plus the exact triangle
  budget (8 without a fill, 10 with), the `trans` values (20 % → 205, 100 % → 0), the
  thin-tile fallback, degenerate quads (zero-area, collinear) emitting nothing, and a
  per-marker settings→decal integration pass.
- `tsc --noEmit` clean on the full tree, and clean with `apply --mods true-tile` alone (the
  mod depends on no other mod).
- `regen` twice byte-identical · `apply --check` ✗0 (15/15 mods) · `doctor` exit 0
  (133 hunks, markers 133/133) · `matrix` green on every declared revision (274 inherits
  all 133 hunks exactly; 254 applies its own 18) · `tools/acceptance.sh` byte-compares a
  pristine clone at the pinned revs against the live install (this mod's payload included)
  and proves the converge round-trip byte-stable.
- The shipped bundle carries all thirteen key literals (`trueTile`, `trueTileColor`,
  `trueTileOutline`, `trueTileFill`, `trueTileOnlyDesync`, `hoverTile…`, `destTile…`) — the
  terser property mangler renames the mod's function names, never these strings, so the
  panel and the engine agree in prod.
- Panel, live page: the *True tile* row appears with the right name/description and a
  master switch; opening it shows three section headers (**True tile**, **Hovered tile**,
  **Destination tile**) with twelve rows at the documented defaults; the three marker
  switches write `trueTile`/`hoverTile`/`destTile` (the hovered marker's key is the one the
  retired mod used, so old settings survive the merge); a search that filters a section's
  rows away hides its header with them; no console errors.
- **What is NOT proven headlessly:** the engine-side half of each marker — the level a
  decal is drawn at (`pushDown`/`originalLevel`), the ground pick that resolves the hovered
  tile, and the client's own destination flag. Those are read from the engine and verified
  in-game (see the handover checklist), not by the harness; the harness's own header says
  so.
