# mods/hover-tile

An outline on **the tile your mouse is over** — RuneLite's *Tile Indicators* hovered-tile
section, as a 2004Scape mod.

Player-visible effect: a square follows the cursor around the game view, drawn on the
ground the cursor is pointing at — sheared correctly on slopes and stairs, clipped at the
viewport, and hidden when the cursor leaves the scene (sidebar, chatbox, minimap,
letterbox). It is the companion of `mods/true-tile`: that one marks the tile the SERVER
has you on, this one marks the tile you are pointing at, and both use the same
colour + border-px + fill-% contract, so they read the same in the panel. Every setting
applies on the next frame — nothing here needs a rebuild or a reload.

## What's in the box

- `files/webclient/src/client/HoverTile.ts` — the mod's **pure core** (settings parse +
  the projected-quad decal geometry). It touches no client state, so the harness below runs
  the real shipped logic headlessly. `apply` copies it verbatim; one import hunk in
  `Client.ts` pulls it into the bundle.
- `patches/289/Client_ts.json` — FOUR hunks into `webclient/src/client/Client.ts`:
  1. the payload import, at the end of the import block (clear of every other mod's
     import islands);
  2. `this.hoverTileArm()` in `gameDrawMain()`, immediately after `Model.mouseY` is set
     and **before** `world.renderAll()` — the pick has to be armed before the ground is
     rasterized;
  3. `this.hoverTileDraw()` right after `this.coordArrow()` — after `renderAll`, before
     `areaGame.draw(4, 4)`;
  4. the two methods, parked in the pristine gap after `getAvH()`.
- `patches/289/World_ts.json` — FOUR hunks into `webclient/src/dash3d/World.ts`:
  1. the `hoverArmed`/`hoverMouseX`/`hoverMouseY`/`hoverX`/`hoverZ`/`hoverLevel` fields,
     beside the existing `click`/`groundX` group;
  2–4. one pick site each in `renderQuickGround()` (both ground triangles) and
     `renderGround()` (the legacy face path).
- Panel rows: `MOD_REGISTRY` + three `MODS[]` rows for `hover-tile` in
  `mods/control-panel/files/engine/public/lclite/panel.js` (colour, border px, fill %).
- `tools/hover_tile_test.ts` — 104-check bun harness (see *Verified*).

## How the hovered tile is resolved (the design decision)

**The tile comes from the engine's own ground pick, not from a re-implementation.**
`World`'s ground rasterizer already hit-tests a mouse pixel against every front-facing
ground triangle it draws — that is the `World.click`/`World.clickX/clickY` machinery a
left click uses to decide where you walk. The mod adds a second, independent arming of
exactly that test:

- `hoverTileArm()` sets `World.hoverArmed` + the mouse pixel (in `Pix2D` buffer space,
  `mouseX - 4`, the same convention as `Model.mouseX`) once per frame, and clears the
  result to `-1`;
- the three pick sites test `insideTriangle(World.hoverMouseX, World.hoverMouseY, …)`
  next to the existing click test and write `hoverX`/`hoverZ`/`hoverLevel` when they hit;
- tiles are drawn back-to-front, so **the last hit is the nearest one** — the same tile a
  click at that pixel would send you to.

Three things fall out of that for free, and they are the reason it is done this way
rather than by ray-casting the scene from the client:

1. **The highlight can never disagree with the walk pick.** It is literally the same test.
2. **Visibility is the engine's own.** Behind-the-camera and out-of-area ground is never
   rasterized, so it can never be highlighted; nothing needs a separate frustum or
   occlusion test.
3. **It composes with the renderer mods.** The gpu mod hijacks the *rasterizers* but
   deliberately leaves picking on the CPU (`World.groundX` and friends still resolve), so
   the hover pick keeps working with the GPU renderer on.

The cost when the mod is ON is one extra `insideTriangle` per front-facing ground
triangle per frame (the click pick already pays the same on every frame a click is
pending). When the mod is OFF nothing is armed and the cost is zero — the master key is
read at arm time, before any of it.

## Where it draws, and the level question

`hoverTileDraw()` projects the hovered tile's four corners and draws the square **over the
scene**, at the same stage it always did — after `World.renderAll`, before
`areaGame.draw(4, 4)`. Interfaces composite over it (in software via `otherOverlays`, on a
gpu frame because the HUD overlay is the last pass), and it is deliberately **not**
occluded by the player: a hovered tile is a cursor highlight, so it should read on top.
That is the one place this mod and `true-tile` differ — true-tile is ground geometry on
the tile's own turn in the fill order and IS occluded.

- **Projection.** `getOverlayPos()` measures the ground from the *player's* level. Rather
  than duplicating its camera math, the mod hands it the **per-corner height difference**:
  `getOverlayPos(cx, cz, getAvH(cx,cz,minusedlevel) - getAvH(cx,cz,level))` resolves to
  `getAvH(cx, cz, level)` exactly. `getAvH` is exact at 128-multiple corners
  (`tileLocalX/Z` are 0 there), so each corner gets its own ground height and the square
  shears over slopes/stairs exactly like the floor it covers.
- **Level.** The hovered tile can be on a level other than the player's (the storey the
  camera shows when a roof is up), so the pick records the level the rasterizer actually
  drew. The legacy `Ground` path (`TerrainOverlayShape` 2–11, the cut hillside wedges) has
  no level in scope, so it records `-1` and the client falls back to the player's own
  level; on such a tile the outline is the full tile square at the average ground height,
  which is also what RuneLite draws there.

## The 2026-09-18 rework: Pix3D triangles, and why

The square used to be rasterized per pixel straight into the game buffer. That is fine in
software, but on a **gpu frame the buffer holds no world pixels** — it is sentinel-cleared
and the world is drawn on the GPU — so the fill's in-place blend ran against black, and the
HUD overlay then painted the result opaque. The visible symptom was a fill that "went from
a darker colour to a lighter colour" as you raised the opacity, instead of washing the
ground beneath it. Both tile mods had it; it was reported on this one.

The fix is to stop writing pixels and emit **Pix3D triangles** carrying `Pix3D.trans`:
that single value is BOTH the destination weight the software raster mixes with AND the
per-triangle alpha the gpu mod captures, so the wash blends with the ground in either
renderer. The tile is ten triangles at most (a two-triangle wash plus four mitred ring
quads), whatever the skew; the border stays a screen-space `thick` px, and the geometry is
one mod-owned copy of `true-tile`'s — neither mod calls the other's code, so either can
fail on a revision without breaking the other. `mods/gpu/README.md` has the overlay
contract this leans on.

## Settings contract

All of these are this mod's OWN localStorage keys, read at its own hook **every frame** —
no hub, no other mod's key, and every change lands on the next frame.

| key | values | default | row |
|---|---|---|---|
| `hoverTile` | `'true'`/`'false'` | `'true'` | master switch on the mod's row |
| `hoverTileColor` | `'#rrggbb'` | `'#ffffff'` | Outline color |
| `hoverTileOutline` | `'1'`–`'8'` (px) | `'2'` | Border thickness (slider) |
| `hoverTileFill` | `'0'`–`'100'` (%) | `'20'` | Fill opacity (slider) |

Every value is validated in the payload (`hoverTileSettings`), not at the call site: a
stale, hand-typed or half-written key clamps (colour → default unless it is a 7-char
`#rrggbb`, border 1–8 px, fill 0–100 %) and can never paint garbage. Only the literal
`'false'` disables the mod.

## Deliberate divergences from RuneLite, and limits

- **The defaults are visible.** RuneLite's Tile Indicators ships with the plugin *and* the
  hovered tile off, a fully transparent border colour and a black ~20 % fill — out of the
  box you see nothing until you configure it. A mod whose only feature is the hover marker
  has to show something the moment it is installed, so this one defaults to white, 2 px,
  20 % fill. (The 2 px border and the 20 % fill are RuneLite's own numbers; only the
  colour differs.)
- **One colour, not two.** RuneLite gives the border and the fill separate colours (both
  with their own alpha). This mod keeps `mods/true-tile`'s contract — one colour plus a
  fill percentage — so the two tile markers have identical panel rows and the fill is the
  border colour washed over the tile.
- **No destination tile.** RuneLite's plugin also marks the tile you are walking to. That
  is a separate marker with its own colour and it is not in this mod; the engine already
  draws its own click cross (`crossX`/`crossY`) for a walk click. Current tile =
  `true-tile`.
- **Only over the game viewport.** The pick is armed only while the cursor is inside
  (4,4)–(516,338) — the same rect the engine's own option picking uses. There is no scene
  behind the sidebar, chatbox, minimap or letterbox, so there is nothing to point at.
- **`LinkBelow` tiles can sit a level out.** `getAvH` bumps its lookup by one level for
  tiles carrying `MapFlag.LinkBelow` (the engine's own "you can walk under this" rule),
  while the rasterizer draws `groundh[level]`. On such a tile — bridge/dungeon-entrance
  ground, rare — the outline is drawn at the linked height, one level above the ground it
  covers. Every other tile is exact.
- **Clipping is Pix3D's now**, not the mod's own rect test: the raster clamps x under
  `Pix3D.hclip` (which this mod sets, as every ground draw does) and y at
  `Pix2D.clipMaxY`, exactly like every other triangle in the scene. On the two edges a
  pixel of the projected quad lands differently than the old per-pixel pass did; the
  harness measures that as ≤1px, in the parity checks.
- **289 and 274 only.** `274` inherits the 289 corpus; `254` has its own corpus and this
  mod is not ported to it (same as camera, control-panel, hotkeys, stat-orbs and
  xp-drops). `node tools/port.mjs 254` is the one command that changes that.

## Verified

- `tools/hover_tile_test.ts` — 104 checks, all green, run against both the `files/` payload
  and the copy inside an applied tree. It covers the settings table (defaults, every clamp,
  a garbage store) and the decal geometry against the mod's **own previous per-pixel
  rasterizer**, kept in the harness as the parity oracle: for an axis-aligned quad, a
  20°-rotated quad and a sheared one, in every vertex order and winding, no painted pixel
  is more than 1px from the old implementation's set and every pixel clear of the ring's
  boundary lands in the same class. Plus the exact triangle budget (8 without a fill, 10
  with), the `trans` values (the default 20 % → 205, 100 % → 0), the thin-tile fallback,
  and degenerate quads (zero-area, collinear) emitting nothing.
- `tsc --noEmit` clean on the full tree, and clean with `apply --mods hover-tile` alone
  (the mod depends on no other mod).
- `regen` twice byte-identical · `apply --check` ✗0 · `doctor` exit 0 · `matrix` green on
  every declared revision (274 inherits all 128 hunks exactly) · `tools/acceptance.sh`
  byte-compares a pristine clone at the pinned revs against the live install (this mod's
  payload included) and proves the converge round-trip byte-stable.
- The shipped bundle carries the payload's key literals (`hoverTile`, `hoverTileColor`,
  `hoverTileOutline`, `hoverTileFill`) — the terser property mangler renames the mod's
  function names, never these strings, so the panel and the engine agree in prod.
- Panel, live page: the *Hover tile* row appears with the right name/description and a
  master switch; its view opens with all three rows at the documented defaults
  (`#ffffff`, 2px `[1..8]`, 20% `[0..100 step 5]`); switching it off writes
  `hoverTile=false` and shows "Mod disabled — enable it to change these settings."; the
  colour swatch and both sliders write their own keys with live readouts; no console
  errors.
- **In-game feel is player-verified** (see the mod's handover checklist): the outline
  tracking the cursor over grass, water, slopes, stairs and multi-storey areas, the
  on/off switch taking effect immediately, and the three settings reading live.
