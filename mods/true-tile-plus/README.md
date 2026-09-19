# mods/true-tile-plus

**Ground effects that ride the true tile.** The first effect is **Flames**: flat tongues
licking outward off the tile's four borders, lying on the ground plane — the tile the
SERVER has you on (the head of the local move queue), the same tile `mods/true-tile`
outlines.

Player-visible effect: fire on the floor around the tile you are actually standing on. It
pulls ahead of your character by up to a full tick while you run, exactly like the true
tile itself, and it is **on the ground**, not pasted over the scene: your own model covers
it, walls and NPCs occlude it, and the ground under each flame is drawn before the flame is.
It follows slopes and stairs (the blades are built from the tile's own projected corners),
it is clipped at the viewport, and it is hidden with the tile when the tile is not rendered.
All five settings apply on the next frame — nothing here needs a rebuild or a reload.

This is the demo run for the mod: **the effect list is the extension point**. `Flames` is
effect 1; adding another is one branch in the payload's dispatcher, its geometry function,
and one option in the panel's select row — the engine hunks and the settings table never
change (see *Adding the next effect*).

## What's in the box

- `files/webclient/src/dash3d/TrueTilePlus.ts` — the mod's **pure core** (settings parse +
  the flame geometry). It touches no client state, so the harness and the preview tool below
  run the real shipped logic headlessly. `apply` copies it verbatim; one import hunk in
  `World.ts` pulls it into the bundle.
- `patches/289/Client_ts.json` — ONE hunk into `webclient/src/client/Client.ts`: the arm call
  in `gameDrawMain()`, before the camera-shake loop, where the client hands World the tile
  the server has the player on plus the level. The mod has no other footprint in the client.
- `patches/289/World_ts.json` — THREE hunks into `webclient/src/dash3d/World.ts`:
  1. the payload import (in the dash3d import group);
  2. the armed state, `World.trueTilePlusArm()`, `ttpFacingEdge()`, the projector and the
     `trueTilePlusDraw()` draw, parked in the pristine run between the small accessors and
     `shareLight()`;
  3. one call in `fill()`, once a tile's ground is down.
- Panel rows: `MOD_REGISTRY` + five `MODS[]` rows for `true-tile-plus` in
  `mods/control-panel/files/engine/public/lclite/panel.js` (Ground effect select, Effect
  color, Flames per edge, Flame reach, Flicker speed), plus a prefix wipe in its Reset-all
  list. The panel's own `?v=` went 19 → 20 → 21 as rows were added.
- `tools/true_tile_plus_edit.py` — the idempotent tree edit script (marker-paired blocks,
  CRLF-preserving), so the tree can be rebuilt from scratch without hand-editing.
- `tools/true_tile_plus_test.ts` — 93-check bun harness (see *Verified*).
- `tools/true_tile_plus_preview.ts` — rasterizes the real payload into an ASCII view and
  `true_tile_plus_preview.png` (a 4-phase filmstrip at 3x), and asserts per edge that the
  flames exist and touch the border. This is how the look is judged without a login.

## How it is drawn (the design decision)

**Ground geometry, painted on the turn of the tile each flame lies over.** `World.renderAll`
walks the scene and `fill()` draws each tile's ground, then its walls, then its sprites; the
mod's call sits between the ground and the walls. Three things fall out of that:

1. **The flames are on the floor.** Everything the engine draws after that point covers them
   — the player's model above all, but equally an NPC standing there, a wall on the tile, or
   a nearer tile's rising ground. That is what makes them read as fire *on the ground*.
2. **They follow the floor they sit on.** The blade geometry is built from the true tile's
   four **projected** corners (world → camera → buffer pixels, each corner's height read from
   the ground itself), so the fire shears over slopes and stairs exactly like the floor under
   it, at any camera yaw or pitch.
3. **Visibility is the engine's own.** A tile that is not rendered (off-camera, out of the
   build area, behind a roof) gets no flames, because `fill()` is never called for it.

### Why per-neighbour, not per-tile (the bug this shipped with)

A flame is rooted on the true tile's border and reaches OUTWARD, so **every blade lies over
the tile next door**. The first version drew all four edges on the true tile's own turn, and
in game only **2–3 of the 4 edges ever appeared** — and which edges survived changed with the
camera angle. The cause is the walk order: `renderAll` expands outward from the *camera's*
own tile (`World.gx/gz`, an axis-aligned ring walk, not a true radial sort), so a
neighbouring tile drawn **after** the true tile paints its ground straight over any blade
that reached into it.

The fix is to draw each edge's blades when **the tile they lie over** is drawn: the caller
passes a `mask` (one bit per edge, `TRUE_TILE_PLUS_EDGE_*`), and `World.ttpFacingEdge()`
answers "which edge of the armed tile reaches over this tile". That is order-proof by
construction: the tile's own ground is already down when the blade goes in, its walls and
sprites still come after (so they cover the blade, correctly), and no later tile overlaps the
ground the blade burns on. It also means the flames disappear on a side whose ground is not
rendered at all — honest, since there is no floor there to be on fire.

The one piece of extra machinery is the **outward probe**. Each edge gets a fifth projected
point: that edge's world midpoint pushed out by `TRUE_TILE_PLUS_OUTER_UNITS` (64, i.e. half a
tile) along the tile's own plane. The payload divides the probe's screen length by that
constant to get px-per-world-unit for that edge, and uses the probe direction as "outward".
That is what makes the effect camera-proof: a flame stays glued to its own border, points the
right way, and grows and shrinks with zoom instead of being a fixed-pixel spike that swings
off the tile as the camera turns. The probes ride the **tile's own plane** (the mean of that
edge's two corner heights) rather than sampling the ground beyond the tile, so a flat decal
that follows the tile it frames can never slide down a cliff face.

### Why no two flames look alike

A flame is a **three-triangle blade**: a base quad that tapers to a waist, then a point that
leans along the edge as it flickers. One triangle reads as a spike; the waist and the lean are
what make it read as fire at this size. On top of that, each tongue gets its own two seeds and
therefore its own everything:

- its own **size** (0.60–1.25x) and **width** (0.50–1.65x, fatter when shorter), so tall thin
  licks sit beside short fat ones instead of a comb of equals;
- its own **place** along the edge — evenly spaced, then nudged by its seed and slowly
  **drifted** over time, so the row wanders rather than sitting pinned to its slots;
- its own **flicker** (three harmonics, 0.53–1.31x) and its own **flare** envelope (1.00–1.30x:
  a tongue surges and dies back on a beat of its own), so the ring breathes unevenly.

Everything is emitted as **integers** (the rasterizer works in integer pixels) and everything
is a pure function of `phase`, so the harness can replay any whole frame and the preview tool
can render any frame. The animation clock is wall-clock time (`Date.now() / 1000`) scaled by
the speed setting, so the flicker speed does not change with FPS.

Cost: at most 8 tongues x 4 edges = 32 blades = 96 triangles per frame in the worst case, and
in practice one edge's worth per tile turn (4 blades = 12 triangles) — with nothing at all
when the mod is off, since the master key is read before any geometry is built.

## Settings contract

All of these are this mod's OWN localStorage keys, read at its own hook (the World-side draw)
**every frame** — no hub, no other mod's key (rule 5: it deliberately does NOT read
`trueTile*`), and every change lands on the next frame.

| key | values | default | row |
|---|---|---|---|
| `trueTilePlus` | `'true'`/`'false'` | `'true'` | master switch on the mod's row |
| `trueTilePlusEffect` | `'flames'`/`'none'` | `'flames'` | Ground effect (select) |
| `trueTilePlusColor` | `'#rrggbb'` | `'#000000'` | Effect color |
| `trueTilePlusCount` | `'1'`–`'8'` | `'4'` | Flames per edge |
| `trueTilePlusReach` | `'4'`–`'75'` (% of a tile side) | `'23'` | Flame reach |
| `trueTilePlusSpeed` | `'0'`–`'3'` (0.25 steps) | `'1'` | Flicker speed |

Every value is validated in the payload (`trueTilePlusSettings`), not at the call site: a
stale, hand-typed or half-written key clamps (colour → default unless it is a 7-char
`#rrggbb`; count 1–8; reach 4–75 %; speed 0–3, with a negative or unparseable speed frozen
rather than silently sped up) and can never paint garbage. Only the literal `'false'`
disables the mod, and only the literal `'none'` turns the effect off.

**Reach is a share of a tile side** (128 world units), not a pixel count: the flames then keep
their proportion to the tile as the camera zooms instead of growing with the screen. The
panel row shows it as a percentage for that reason. `Flicker speed` is the one fractional
setting, so its row carries an explicit `apply()` — the panel's default slider write rounds to
an integer, which would pin every value to 0 or 1.

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
- **A side with no rendered ground gets no flames** — the blades are drawn on the neighbour's
  turn, so a neighbour whose ground is culled (behind a wall, at the edge of the build area)
  has nothing to be on fire. That is deliberate: drawing there would put fire over whatever
  the engine actually drew instead.
- **The reach is capped** (`TRUE_TILE_PLUS_MAX_LENGTH`, 80 px) so a grazing camera or a big
  flare cannot throw a blade across the screen; a very large `Flame reach` at high zoom will
  therefore stop growing.
- **No destination tile, and no interaction with the true-tile mod.** The effect frames
  whatever is there: with `true-tile` off you get fire around an invisible tile. Hovered tile
  = `mods/hover-tile`.
- **289 and 274 only.** `274` inherits the 289 corpus. `254` has no corpus for this mod (like
  hover-tile, ground-items, wiki-lookup and the rest), so it is simply unavailable there.

## Adding the next effect

1. a `TRUE_TILE_PLUS_EFFECT_<NAME>` integer id in the payload's constants (integers, never
   strings — a runtime string must not index a table in bundled code: the property mangler
   renames object-literal keys);
2. its geometry function, taking the same `(emit, px, py, ox, oy, settings, phase, mask)`
   arguments — `mask` is the set of edges to draw, and honouring it is what keeps the effect
   on the ground it belongs to;
3. one branch in `trueTilePlusEffect()`;
4. one `options` entry in the panel's Ground effect row (and, if it needs its own look, one
   more key + row).

Nothing else changes: no hunk, no rebuild of the hook, and the settings table stays as it is.

## Verified

- `tools/true_tile_plus_test.ts` — **93 checks, all green**, run against both the `files/`
  payload and the copy inside an applied tree. It covers the settings table (defaults, every
  clamp, the master/effect/colour semantics, the three sliders incl. the fractional speed),
  the triangle budget and integer-pixel/opaque-`trans` contract, non-degenerate triangles,
  determinism, the **edge mask** (each bit draws exactly that edge, and that edge's blades
  point out of its own side), outward-pointing blades with roots on their own border, the
  anti-uniformity contract (ring size spread and single-edge spread measured, the row's drift
  over time), speed 0 freezing the effect and speed being a pure time scale, the flicker/flare
  documented ranges, per-tongue seed uniqueness and the second salt, the sliders changing the
  geometry they claim to, the reach cap, the degenerate cases, and the dispatcher.
- `tools/true_tile_plus_preview.ts` — renders the real payload at 3x and asserts **all four
  edges have flames, rooted on the border, at four phases** (the regression guard for the
  2-3-edges bug), plus an ASCII view and `true_tile_plus_preview.png` for eyeballing.
- `tsc --noEmit` clean on the full tree.
- `regen` twice byte-identical · `apply --check` ✗0 · `doctor` exit 0 · `matrix` green on
  every declared revision · `tools/acceptance.sh` byte-compares a pristine clone at the
  pinned revs against the live install and proves the converge round-trip byte-stable.
- The edit script is idempotent by region: a second run is byte-identical (proven by hash).
- The shipped bundle carries the payload's key literals (`trueTilePlus`,
  `trueTilePlusEffect`, `trueTilePlusColor`, `trueTilePlusCount`, `trueTilePlusReach`,
  `trueTilePlusSpeed`) — the terser property mangler renames the mod's function names, never
  these strings, so the panel and the engine agree in prod.
- Panel, live page: the *True tile+* row appears with the right name/description and a master
  switch; its view opens with all five rows at the documented defaults (`Flames`, `#000000`,
  `4`, `23%`, `1.00×`); the select, the colour swatch and all three sliders write their own
  keys live (`6` / `40` / `0.25` were each observed in localStorage, and each row's reset
  restores its default); no console errors.
- **In-game feel is player-verified** (see the handover checklist): flames on all four edges
  while standing and running, their lead on the model mid-run, occlusion by walls/NPCs and by
  the player's own model, the reach/flicker/count at default and zoomed-out camera, and all
  five settings reading live.
