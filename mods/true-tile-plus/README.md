# mods/true-tile-plus

**Ground effects that ride the true tile.** The first effect is **Flames**: flat black
tongues licking outward off the tile's four borders, lying on the ground plane — the tile
the SERVER has you on (the head of the local move queue), the same tile `mods/true-tile`
outlines.

Player-visible effect: fire on the floor around the tile you are actually standing on. It
pulls ahead of your character by up to a full tick while you run, exactly like the true
tile itself, and it is **on the ground**, not pasted over the scene: your own model covers
it, walls and NPCs occlude it, and nearer ground wins over the parts that reach past the
tile. It follows slopes and stairs (the blades are built from the tile's own projected
corners), it is clipped at the viewport, and it is hidden with the tile when the tile is not
rendered. Both settings apply on the next frame — nothing here needs a rebuild or a reload.

This is the demo run for the mod: **the effect list is the extension point**. `Flames` is
effect 1; adding another is one branch in the payload's dispatcher, its geometry function,
and one option in the panel's select row — the engine hunks and the settings table never
change (see *Adding the next effect*).

## What's in the box

- `files/webclient/src/dash3d/TrueTilePlus.ts` — the mod's **pure core** (settings parse +
  the flame geometry). It touches no client state, so the harness below runs the real
  shipped logic headlessly. `apply` copies it verbatim; one import hunk in `World.ts` pulls
  it into the bundle.
- `patches/289/Client_ts.json` — ONE hunk into `webclient/src/client/Client.ts`: the arm call
  in `gameDrawMain()`, before the camera-shake loop, where the client hands World the tile
  the server has the player on plus the level. The mod has no other footprint in the client.
- `patches/289/World_ts.json` — THREE hunks into `webclient/src/dash3d/World.ts`:
  1. the payload import (in the dash3d import group);
  2. the armed state, `World.trueTilePlusArm()`, the projector and the
     `trueTilePlusDraw()` draw, parked in the pristine run between the small accessors and
     `shareLight()`;
  3. one call in `fill()`, on the true tile's own turn — after the tile's ground, **before**
     its walls and sprites.
- Panel rows: `MOD_REGISTRY` + two `MODS[]` rows for `true-tile-plus` in
  `mods/control-panel/files/engine/public/lclite/panel.js` (Ground effect select, Effect
  color), plus a prefix wipe in its Reset-all list. The panel's own `?v=` went 19 → 20.
- `tools/true_tile_plus_edit.py` — the idempotent tree edit script (marker-paired blocks,
  CRLF-preserving), so the tree can be rebuilt from scratch without hand-editing.
- `tools/true_tile_plus_test.ts` — 54-check bun harness (see *Verified*).

## How it is drawn (the design decision)

**Ground geometry, on the true tile's own turn in the scene fill order** — the same ride as
`mods/true-tile`, and for the same reason. `World.renderAll` walks the scene back to front
and `fill()` draws each tile's ground, then its walls, then its sprites; the mod's call sits
between the ground and the walls. Three things fall out of that:

1. **The flames are on the floor.** Everything the engine draws after that point covers
   them — the player's model above all, but equally an NPC standing there, a wall on the
   tile, or a nearer tile's rising ground. That is what makes them read as fire *on the
   ground* rather than as a sticker on the screen.
2. **They follow the floor they sit on.** The blade geometry is built from the tile's four
   **projected** corners (world → camera → buffer pixels, each corner's height read from the
   ground itself), so the fire shears over slopes and stairs exactly like the floor under
   it, at any camera yaw or pitch.
3. **Visibility is the engine's own.** A tile that is not rendered (off-camera, out of the
   build area, behind a roof) gets no flames, because `fill()` is never called for it.

The one piece of extra machinery is the **outward probe**. Each edge gets a fifth projected
point: that edge's world midpoint pushed out by `TRUE_TILE_PLUS_OUTER_UNITS` (64, i.e. half a
tile) along the tile's own plane. The payload divides the probe's screen length by that
constant to get px-per-world-unit for that edge, and uses the probe direction as "outward".
That is what makes the effect camera-proof: a flame stays glued to its own border, points
the right way, and grows and shrinks with zoom instead of being a fixed-pixel spike that
swings off the tile as the camera turns. The probes ride the **tile's own plane** (the mean
of that edge's two corner heights) rather than sampling the ground beyond the tile, so a
flat decal that follows the tile it frames can never slide down a cliff face.

A flame is a **three-triangle blade**: a base quad that tapers to a waist at 45 % of its
reach, then a point that leans along the edge as it flickers. One triangle reads as a spike;
the waist and the lean are what make it read as fire at this size. Everything is emitted as
**integers** (the rasterizer works in integer pixels) and everything is a pure function of
`phase`, so the harness can replay any whole frame.

Cost: at most 12 blades = 36 triangles per frame, and nothing at all when the mod is off —
the master key is read inside the draw, before any geometry is built. The animation clock is
wall-clock time (`Date.now() / 1000`) rather than a frame counter, so the flicker speed does
not change with FPS.

## Settings contract

All of these are this mod's OWN localStorage keys, read at its own hook (the World-side
draw) **every frame** — no hub, no other mod's key (rule 5: it deliberately does NOT read
`trueTile*`), and every change lands on the next frame.

| key | values | default | row |
|---|---|---|---|
| `trueTilePlus` | `'true'`/`'false'` | `'true'` | master switch on the mod's row |
| `trueTilePlusEffect` | `'flames'`/`'none'` | `'flames'` | Ground effect (select) |
| `trueTilePlusColor` | `'#rrggbb'` | `'#000000'` | Effect color |

Every value is validated in the payload (`trueTilePlusSettings`), not at the call site: a
stale, hand-typed or half-written key clamps (colour → default unless it is a 7-char
`#rrggbb`; effect → flames unless the value is exactly `'none'`) and can never paint garbage.
Only the literal `'false'` disables the mod.

The **shape of the effect itself** is payload constants, not keys, because the mod ships
with one select row and one colour row and nothing else (that was the design brief for the
demo): 3 flames per edge, a reach of 34 world units, the 64-unit probe, a 4 px minimum edge,
a 48 px maximum reach, and a 1 px root inset. Each is documented at its definition in the
payload; turning one into a slider later is one `MODS[]` row plus one `read()` in
`trueTilePlusSettings` — the hook and the geometry never move.

## Deliberate divergences from RuneLite, and limits

- **Flat, not volumetric.** These are ground decals: no billboards, no particles, no glow
  pass. The 2004 renderer draws quads on the ground plane and this mod stays on that path —
  "flat flames" is the honest description, and it is why the effect is cheap and why it
  occludes correctly.
- **Black by default.** Black fire reads as a silhouette on light ground (grass, sand, dirt)
  and nearly vanishes on dark ground (cave floor, night). That is the requested look; the
  Effect color row is there for exactly this reason.
- **Occluded by everything in front of it**, not just by the player: a wall on the tile, an
  NPC standing there, or a nearer tile's rising ground all paint over the flames that reach
  past the tile. That is the honest consequence of drawing on the floor.
- **The flames reach past the tile.** They are rooted on the border but extend outward over
  the neighbouring tiles, so a neighbouring tile that is nearer to the camera (drawn later)
  will cover the overlap. On a ledge the part hanging over the drop stays visible, because
  the probes ride the tile's own plane rather than the ground out there.
- **No destination tile, and no interaction with the true-tile mod.** The effect frames
  whatever is there: with `true-tile` off you get fire around an invisible tile. Hovered tile
  = `mods/hover-tile`.
- **289 and 274 only.** `274` inherits the 289 corpus. `254` has no corpus for this mod (like
  hover-tile, ground-items, wiki-lookup and the rest), so it is simply unavailable there.

## Adding the next effect

1. a `TRUE_TILE_PLUS_EFFECT_<NAME>` integer id in the payload's constants (integers, never
   strings — a runtime string must not index a table in bundled code: the property mangler
   renames object-literal keys);
2. its geometry function, taking the same `(emit, px, py, ox, oy, rgb, phase)` arguments;
3. one branch in `trueTilePlusEffect()`;
4. one `options` entry in the panel's Ground effect row (and, if it needs its own look, one
   more key + row).

Nothing else changes: no hunk, no rebuild of the hook, and the settings table stays as it is.

## Verified

- `tools/true_tile_plus_test.ts` — **54 checks, all green**, run against both the `files/`
  payload and the copy inside an applied tree. It covers the settings table (defaults, every
  clamp, the master/effect/colour semantics), the triangle budget (3 tongues × 4 edges × 3 =
  36), the integer-pixel and opaque-`trans` contract, non-degenerate triangles, determinism
  (the same phase replays byte-identically; a different phase differs), that blades point
  **outward** and never back into the tile, that every root sits on its own border, the
  reach cap, the degenerate cases (edge-on quad, collapsed projection, collapsed probes, a
  tile under the 4 px minimum), the flicker's stated `[0.60, 1.30]` range, per-tongue seed
  uniqueness/stability, and the dispatcher (master off → nothing, `none` → nothing, an
  unknown effect id → nothing, a stored colour → the geometry).
- `tsc --noEmit` clean on the full tree.
- `regen` twice byte-identical · `apply --check` ✗0 · `doctor` exit 0 · `matrix` green on
  every declared revision · `tools/acceptance.sh` byte-compares a pristine clone at the
  pinned revs against the live install and proves the converge round-trip byte-stable.
- The edit script is idempotent by region: a second run is byte-identical (proven by hash).
- The shipped bundle carries the payload's key literals (`trueTilePlus`,
  `trueTilePlusEffect`, `trueTilePlusColor`) — the terser property mangler renames the mod's
  function names, never these strings, so the panel and the engine agree in prod.
- Panel, live page: the *True tile+* row appears with the right name/description and a master
  switch; its view opens with the Ground effect select at `Flames` and the Effect color
  swatch at `#000000`; both write their own keys; no console errors.
- **In-game feel is player-verified** (see the handover checklist): the flames around the
  tile while standing and running, their lead on the model mid-run, occlusion by walls/NPCs
  and by the player's own model, the reach and flicker at default and zoomed-out camera, and
  both settings reading live.
