# mods/true-tile

An outline on **the tile the server has you on** — RuneLite's *Tile Indicators* "current
tile" (the true tile), as a 2004Scape mod.

Player-visible effect: a square sits **on the floor under your character**, marking the
tile the SERVER believes you are standing on. Because that is the head of the local move
queue (`routeX/routeZ[0]`) and not the walk-interpolated model position, it pulls ahead of
your character by up to a full tick while you run — which is the whole point: it is how you
see the tick you are actually on. The square follows slopes and stairs, is clipped at the
viewport, hides behind anything in front of it, and is the companion of `mods/hover-tile`
(that one marks the tile you are pointing at; both use the same colour + border-px +
fill-% contract, so they read the same in the panel). Every setting applies on the next
frame — nothing here needs a rebuild or a reload.

## What's in the box

- `files/webclient/src/dash3d/TrueTile.ts` — the mod's **pure core** (settings parse + the
  projected-quad decal geometry). It touches no client state, so the harness below runs the
  real shipped logic headlessly. `apply` copies it verbatim; one import hunk in `World.ts`
  pulls it into the bundle.
- `patches/289/Client_ts.json` — ONE hunk into `webclient/src/client/Client.ts`: the arm
  call in `gameDrawMain()`, after the camera-shake loop and before `Pix2D.cls()` +
  `World.renderAll()` — the client hands World the server tile, the model tile and the
  level, and nothing else. The mod has no other footprint in the client.
- `patches/289/World_ts.json` — THREE hunks into `webclient/src/dash3d/World.ts`:
  1. the payload import;
  2. the armed state, `World.trueTileArm()` and the `trueTileDecal()` draw, parked in the
     pristine run of small accessors after `removeSprites()`;
  3. one call in `fill()`, immediately after the tile's ground is drawn and **before** its
     walls and sprites.
- Panel rows: `MOD_REGISTRY` + four `MODS[]` rows for `true-tile` in
  `mods/control-panel/files/engine/public/lclite/panel.js` (colour, border px, fill %,
  desync toggle) — unchanged by the 2026-09-18 rework, because the settings contract is.
- `tools/true_tile_test.ts` — 103-check bun harness (see *Verified*).

## How it is drawn (the design decision)

**The decal is ground geometry, drawn on the true tile's own turn in the scene fill order.**
`World.renderAll` walks the scene back to front and `fill()` draws each tile's ground, then
its walls, then its sprites; the mod's call sits between the ground and the walls. Three
things fall out of that, and they are the reason it is done this way:

1. **The square is under the character.** Everything the engine draws after that point
   covers it — the player's model above all, but equally an NPC standing there, a wall on
   the tile, or a nearer tile's ground that rises in front of it. That is the RuneLite
   reading of a true tile ("a square appears under your character"): the marker is on the
   floor, not pasted over the model. Drawing it later in the frame — which is what the mod
   used to do, from `coordArrow()` into the game buffer — paints it over the character's
   feet and reads as floating in front of them.
2. **The fill's opacity works in both renderers.** The decal is emitted as Pix3D triangles
   carrying `Pix3D.trans`, and that one value is BOTH the destination weight the software
   raster mixes with AND the per-triangle alpha the gpu mod captures for its blend. A
   translucent pixel written straight into the game buffer cannot work on a gpu frame: the
   buffer is sentinel-cleared and the world is drawn on the GPU, so the mix runs against
   black, and the HUD overlay then paints the result opaque — the "darker green that
   lightens as you raise the fill" bug. See `mods/gpu/README.md` for the overlay contract.
3. **Visibility is the engine's own.** A tile that is not rendered (off-camera, out of the
   build area, behind a roof) gets no decal, because `fill()` is never called for it, and
   the client's projection uses the same camera math as every other overlay
   (`Client.getOverlayPos` / `renderQuickGround`): world → camera → 512x334 buffer pixels,
   with each corner's height read from the ground itself, so the square shears exactly like
   the floor it covers.

The cost is ten triangles per frame at most (the tile is one quad: a two-triangle wash plus
four mitred ring quads), and it is zero when the mod is off — the master key is read inside
the draw, before any geometry is built.

## Settings contract

All of these are this mod's OWN localStorage keys, read at its own hook (the World-side
decal) **every frame** — no hub, no other mod's key, and every change lands on the next
frame.

| key | values | default | row |
|---|---|---|---|
| `trueTile` | `'true'`/`'false'` | `'true'` | master switch on the mod's row |
| `trueTileColor` | `'#rrggbb'` | `'#00ff00'` | Outline color |
| `trueTileOutline` | `'1'`–`'8'` (px) | `'1'` | Border thickness (slider) |
| `trueTileFill` | `'0'`–`'100'` (%) | `'0'` | Fill opacity (slider) |
| `trueTileOnlyDesync` | `'true'`/`'false'` | `'false'` | Only when out of sync (toggle) |

Every value is validated in the payload (`trueTileSettings`), not at the call site: a stale,
hand-typed or half-written key clamps (colour → default unless it is a 7-char `#rrggbb`,
border 1–8 px, fill 0–100 %) and can never paint garbage. Only the literal `'false'`
disables the mod. `trueTileOnlyDesync` is RuneLite's "hidden" behaviour — draw only while
the model tile and the server tile disagree — and it is off by default so the square is
always visible.

## Deliberate divergences from RuneLite, and limits

- **RuneLite draws its true tile ABOVE the scene.** Its `TileIndicatorsOverlay` is a
  `OverlayLayer.ABOVE_SCENE` 2D polygon (`Perspective.getCanvasTilePoly` + `renderPolygon`,
  read from `runelite/runelite` on 2026-09-18), so the plugin's square is painted over the
  character's feet. This mod deliberately does the opposite and puts the decal on the
  ground: it is a tile marker, and a marker the player's own model stands on reads better
  under the model than over it. The plugin the reading comes from is still Tile Indicators
  (its `highlightCurrentTile` uses `player.getWorldLocation()`, i.e. the true tile).
- **The border is screen-space, not scene-space.** `trueTileOutline` is a pixel width: the
  ring is built from the projected corners, mitred per corner, so it stays `thick` px on a
  sheared or zoomed quad — the same contract the per-pixel rasterizer had. It is not a
  world-space inset, so the border does not thicken as you zoom in.
- **A tile thinner on screen than the border is thick** (a very small quad, or a zoomed-out
  tile) has no valid inner quad: the ring would turn itself inside out, so the whole tile is
  drawn as border. That is exactly the pixel set the old rasterizer covered there.
- **Occluded by everything in front of it**, not just by the player: a wall on the tile, an
  NPC standing on it, or a nearer tile's rising ground all paint over the square. That is
  the honest consequence of putting it on the floor, and it is the RuneLite look too.
- **No destination tile.** RuneLite's plugin also marks the tile you are walking to; the
  engine already draws its own click cross (`crossX`/`crossY`) for a walk click. Hovered
  tile = `mods/hover-tile`.
- **289 and 274 only, for the ground-decal design.** `274` inherits the 289 corpus. `254`
  still carries this mod's PRE-rework corpus (the per-pixel rasterizer, drawn over the
  character): porting the new design there needs the 254 tree put back in sync first — two
  of `tcg`'s 254 hunks (`bundle.ts`, `engine/view/client.ejs`) no longer anchor, so a
  `regen` on that tree would silently drop them. Once that is resolved,
  `node tools/port.mjs 254 --mods true-tile` + a 254-side `regen` is the whole job.

## Verified

- `tools/true_tile_test.ts` — 103 checks, all green, run against both the `files/` payload
  and the copy inside an applied tree. It covers the settings table (defaults, every clamp,
  a garbage store) and the decal geometry against the mod's **own previous per-pixel
  rasterizer**, kept in the harness as the parity oracle: for an axis-aligned quad, a
  20°-rotated quad and a sheared one, in every vertex order and winding, no painted pixel
  is more than 1px from the old implementation's set and every pixel clear of the ring's
  boundary lands in the same class. Plus the exact triangle budget (8 without a fill, 10
  with), the `trans` values (20 % → 205, 100 % → 0), the thin-tile fallback, and degenerate
  quads (zero-area, collinear) emitting nothing.
- `tsc --noEmit` clean on the full tree, and clean with `apply --mods true-tile` alone.
- `regen` twice byte-identical · `apply --check` ✗0 · `doctor` exit 0 · `matrix` green on
  every declared revision · `tools/acceptance.sh` byte-compares a pristine clone at the
  pinned revs against the live install and proves the converge round-trip byte-stable.
- The shipped bundle carries the payload's key literals (`trueTile`, `trueTileColor`,
  `trueTileOutline`, `trueTileFill`, `trueTileOnlyDesync`) — the terser property mangler
  renames the mod's function names, never these strings, so the panel and the engine agree
  in prod.
- Panel, live page: the *True tile* row appears with the right name/description and a
  master switch; its view opens with all four rows at the documented defaults (`#00ff00`,
  1px `[1..8]`, 0% `[0..100 step 5]`, desync off); the colour swatch, both sliders and the
  toggle write their own keys with live readouts; no console errors.
- **In-game feel is player-verified** (see the handover checklist): the square under the
  character while standing and running, its lead on the model mid-run, occlusion by walls
  and NPCs, the fill's opacity with the gpu mod both ON and OFF, and all four settings
  reading live.
