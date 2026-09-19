# mods/true-tile-plus

**Ground effects that ride the true tile.** Two effects so far:

- **Flames** — flat tongues licking outward off the tile's four borders, lying on the ground
  plane. Fixed in shape, alive in flicker.
- **Wave** — a train of ripples sweeping outward off the tile's four borders, like the rings a
  stone leaves in water. The four borders' bands form ONE ring, mitred closed at the corners;
  the crest undulates along the border, and every ripple fades as it travels.

Both ride the tile the SERVER has you on (the head of the local move queue), the same tile
`mods/true-tile` outlines.

Player-visible effect: fire on the floor around the tile you are actually standing on, or a
square ripple ring sweeping out of it. Both pull ahead of your character by up to a full tick
while you run, exactly like the true tile itself, and both are **on the ground**, not pasted
over the scene: your own model covers them, walls and NPCs occlude them, and the ground under
each piece is drawn before the piece is. They follow slopes and stairs (built from the tile's
own projected corners), they are clipped at the viewport, and they are hidden with the tile when
the tile is not rendered. All five settings apply on the next frame — nothing here needs a
rebuild or a reload.

**The effect list is the extension point.** `Flames` was effect 1; `Wave` is effect 2 — adding it
took its geometry function, one branch in the payload's dispatcher, and one option in the
panel's select row (see *Adding the next effect*). The engine hunks changed for one reason only:
the wave needs the diagonal neighbours as well as the orthogonal ones, so the World-side hook
grew a second mask (see *How the wave is drawn*).

## What's in the box

- `files/webclient/src/dash3d/TrueTilePlus.ts` — the mod's **pure core** (settings parse, the
  flame geometry, the wave geometry). It touches no client state, so the harness and the preview
  tool below run the real shipped logic headlessly. `apply` copies it verbatim; one import hunk
  in `World.ts` pulls it into the bundle.
- `patches/289/Client_ts.json` — ONE hunk into `webclient/src/client/Client.ts`: the arm call
  in `gameDrawMain()`, before the camera-shake loop, where the client hands World the tile
  the server has the player on plus the level. The mod has no other footprint in the client.
- `patches/289/World_ts.json` — THREE hunks into `webclient/src/dash3d/World.ts`:
  1. the payload import (in the dash3d import group);
  2. the armed state, `World.trueTilePlusArm()`, `ttpFacingEdge()`/`ttpFacingCorner()`, the
     projector and the `trueTilePlusDraw()` draw, parked in the pristine run between the small
     accessors and `shareLight()`;
  3. one call in `fill()`, once a tile's ground is down.
- Panel rows: `MOD_REGISTRY` + six `MODS[]` rows for `true-tile-plus` in
  `mods/control-panel/files/engine/public/lclite/panel.js` (Ground effect select — `Flames`,
  `Wave`, `None` — Effect color, Elements per edge, Effect reach, Effect speed), plus a prefix
  wipe in its Reset-all list. The panel's own `?v=` went 19 → 20 → 21 → 22 as rows were added
  and the effect list grew.
- `tools/true_tile_plus_edit.py` — the idempotent tree edit script (marker-paired blocks,
  CRLF-preserving), so the tree can be rebuilt from scratch without hand-editing.
- `tools/true_tile_plus_test.ts` — 173-check bun harness (93 flames + 80 wave; see *Verified*).
- `tools/true_tile_plus_preview.ts` — rasterizes the real payload into ASCII views and one PNG
  filmstrip per effect (`true_tile_plus_preview.png`, `true_tile_plus_wave_preview.png`), and
  asserts per border that the geometry exists and touches the border, per corner that the ring
  is closed there, and that no ripple has been cut into pieces. This is how the look is judged
  without a login.

## How it is drawn (the design decision)

**Ground geometry, painted on the turn of the tile each piece lies over.** `World.renderAll`
walks the scene and `fill()` draws each tile's ground, then its walls, then its sprites; the
mod's call sits between the ground and the walls. Three things fall out of that:

1. **The effects are on the floor.** Everything the engine draws after that point covers them
   — the player's model above all, but equally an NPC standing there, a wall on the tile, or a
   nearer tile's rising ground. That is what makes them read as fire (or water) *on the ground*.
2. **They follow the floor they sit on.** The geometry is built from the true tile's four
   **projected** corners (world → camera → buffer pixels, each corner's height read from the
   ground itself), so it shears over slopes and stairs exactly like the floor under it, at any
   camera yaw or pitch.
3. **Visibility is the engine's own.** A tile that is not rendered (off-camera, out of the
   build area, behind a roof) gets nothing, because `fill()` is never called for it.

### Why per-neighbour, not per-tile (the bug this shipped with)

An effect is rooted on the true tile's border and reaches OUTWARD, so **it lies over the tile
next door**. The first version drew everything on the true tile's own turn, and in game only
**2–3 of the 4 edges ever appeared** — and which edges survived changed with the camera angle.
The cause is the walk order: `renderAll` draws the scene back-to-front, but as an **axis-aligned
square-ring walk around the *camera's* own tile** (`dx`/`dz` from `-viewRadius` to `0`: the
outermost ring first, the camera's own tile last), not a sort by true depth. A neighbouring tile
that comes later in that walk therefore paints its ground straight over anything that had
reached into it — and which neighbour that is changes with the camera's yaw.

The fix is to draw each piece when **the tile it lies over** is drawn: the caller passes a `mask`
(one bit per border, `TRUE_TILE_PLUS_EDGE_*`), and `World.ttpFacingEdge()` answers "which border
of the armed tile reaches over this tile". That is order-proof by construction: the tile's own
ground is already down when the piece goes in, its walls and sprites still come after (so they
cover the piece, correctly), and no later tile overlaps the ground the piece sits on. It also
means an effect disappears on a side whose ground is not rendered at all — honest, since there
is no floor there to be on fire.

The same law has a second half: **geometry must never reach INWARD past the border**, because
the true tile is a different tile drawn on its own turn and its ground could paint over anything
that spilled onto it. Both effects clamp every radius at zero for that reason.

The one piece of extra machinery is the **outward probe**. Each border gets a fifth projected
point: that border's world midpoint pushed out by `TRUE_TILE_PLUS_OUTER_UNITS` (64, i.e. half a
tile) along the tile's own plane. The payload divides the probe's screen length by that
constant to get px-per-world-unit for that border, and uses the probe direction as "outward".
That is what makes the effects camera-proof: an element stays glued to its own border, points
the right way, and grows and shrinks with zoom instead of being a fixed-pixel shape that swings
off the tile as the camera turns. The probes ride the **tile's own plane** (the mean of that
border's two corner heights) rather than sampling the ground beyond the tile, so a flat decal
that follows the tile it frames can never slide down a cliff face.

### How the wave is drawn (and the corner bug it shipped with)

A ripple is a **band**: a strip of quads along the border, whose ends are pushed in and out by an
undulation, with a solid crest in front and a translucent swell trailing behind it (toward the
tile). Everything the flames do per tongue, the wave does per ripple — with one deliberate
exception (below).

**The ring is mitred, and the miters belong to the diagonal tiles.** A band runs corner to
corner, so four bands leave the four diagonal regions empty: the first version drew exactly that,
and it read as four wavy bars with notched diagonals, not as a ripple ring. Closing it needs the
band to continue *past* its own corner — the ring's corner is the ripple's radius OUT and the
same distance ALONG — which puts that stub over the **diagonal** neighbour tile.

Drawing that stub on the orthogonal neighbour's turn does not work, and this is the subtle part:
`renderAll` reaches a tile's neighbours in an order that changes with where the camera is, and
measured, with the true tile left-and-backward of the camera the diagonal neighbour is drawn
**last** — so it wipes whatever the two orthogonal neighbours put there. So the hook grew a
second answer, `ttpFacingCorner()`: the four diagonal neighbours own the miters at the corner
they share, and the payload draws each piece on the tile that owns it. Every pixel is then drawn
exactly once, on the tile whose ground is already down. The miters hold the **corner's own**
radii, which is what makes the two borders' ripples meet there with no step — both evaluate the
undulation at the corner's own perimeter position. It is a picture-frame joint, in three quads
per piece, and it keeps undulating along its length so a long reach gets a wavy corner rather
than a dead-straight L.

**The train.** Ripple *b* sits at radius `frac(t * rate + b / count) * wavelength`, so the train
marches outward in step and every ripple is born on the border and dies at the reach. The
wavelength is the reach ITSELF, with a floor (7 px, itself capped at half the reach) so a short
reach shows **fewer** ripples — the rest are still inside the tile and are culled — instead of
packing every ripple into a sliver where none of them could be seen. The spacing is **exact**: no
per-ripple travel rate, no wandering slot. That is not laziness, it is a fix — a train whose
ripples drift relative to each other can bunch, and when they all bunch into the part of the
cycle that is still inside the tile the effect blinks out entirely (measured: it did). The
individuality is bought instead from things that cannot collide: each ripple's own undulation
phase, its own waviness and its own crest weight.

**The undulation** is a sine whose phase is a function of the PERIMETER — `p = (border + a) / 4`,
sampled per quad end — never of the border alone, so border *i*'s `a=1` end and border *i+1*'s
`a=0` end (the same corner) agree exactly and the ripple wraps the square continuously instead of
breaking into four straight sides. The crest is thicker where the undulation pushes it out, so the
wave has shoulders.

**The fade.** The crest's alpha, the swell's alpha, the crest's thickness and the undulation's
amplitude all scale by one envelope: `sin(pi * u^0.7)` of the ripple's progress to the reach, so
a ripple is solid when it is born on the border and a ghost by the time it gets there. That is
what stops a growing ring from reading as a scaled outline. It is also the mechanism that lets
the swell be translucent at all: `Pix3D.trans` is both the software raster's destination weight
and the per-triangle alpha the gpu mod captures, so a translucent ground effect blends in either
renderer — a Pix2D blend into the game buffer would mix against a sentinel-cleared buffer on a
gpu frame.

## Settings contract

All of these are this mod's OWN localStorage keys, read at its own hook (the World-side draw)
**every frame** — no hub, no other mod's key (rule 5: it deliberately does NOT read `trueTile*`),
and every change lands on the next frame. The rows are shared by both effects, which is why none
of them names one.

| key | values | default | row |
|---|---|---|---|
| `trueTilePlus` | `'true'`/`'false'` | `'true'` | master switch on the mod's row |
| `trueTilePlusEffect` | `'flames'`/`'wave'`/`'none'` | `'flames'` | Ground effect (select) |
| `trueTilePlusColor` | `'#rrggbb'` | `'#000000'` | Effect color |
| `trueTilePlusCount` | `'1'`–`'8'` | `'4'` | Elements per edge |
| `trueTilePlusReach` | `'4'`–`'75'` (% of a tile side) | `'23'` | Effect reach |
| `trueTilePlusSpeed` | `'0'`–`'3'` (0.25 steps) | `'1'` | Effect speed |

Every value is validated in the payload (`trueTilePlusSettings`), not at the call site: a
stale, hand-typed or half-written key clamps (colour → default unless it is a 7-char
`#rrggbb`; count 1–8; reach 4–75 %; speed 0–3, with a negative or unparseable speed frozen
rather than silently sped up) and can never paint garbage. Only the literal `'false'` disables
the mod, and only the literal `'none'` turns the effect off — junk in the effect key falls back
to `flames`, never to the second effect.

**Reach is a share of a tile side** (128 world units), not a pixel count: the effect then keeps
its proportion to the tile as the camera zooms instead of growing with the screen. The panel row
shows it as a percentage for that reason. `Effect speed` is the one fractional setting, so its
row carries an explicit `apply()` — the panel's default slider write rounds to an integer, which
would pin every value to 0 or 1.

What `count` means differs by effect, honestly: for the flames it is tongues per border; for the
wave it is ripples in the train, of which only those inside the reach are visible.

## Deliberate divergences from RuneLite, and limits

- **Flat, not volumetric.** These are ground decals: no billboards, no particles, no glow
  pass. The 2004 renderer draws quads on the ground plane and this mod stays on that path —
  "flat flames" and "a flat ripple" are the honest descriptions, and it is why the effects are
  cheap and why they occlude correctly.
- **Black by default.** Black fire reads as a silhouette on light ground (grass, sand, dirt)
  and nearly vanishes on dark ground (cave floor, night). That is the requested look; the
  Effect color row is there for exactly this reason.
- **Occluded by everything in front of it**, not just by the player: a wall on the tile, an
  NPC standing there, or a nearer tile's rising ground all paint over what reaches past the
  tile. That is the honest consequence of drawing on the floor.
- **A border with no rendered ground gets nothing** — the pieces are drawn on the neighbour's
  turn, so a neighbour whose ground is culled (behind a wall, at the edge of the build area) has
  nothing to be on fire. That is deliberate: drawing there would put fire over whatever the
  engine actually drew instead. For the wave it applies to the corners too: a corner whose
  DIAGONAL tile is not rendered gets no miter, so the ring is open there — visible as a gap on
  that one corner rather than a wrong-coloured patch.
- **The flames' reach is capped** (`TRUE_TILE_PLUS_MAX_LENGTH`, 80 px) so a grazing camera or a
  big flare cannot throw a tongue across the screen; the wave's travel is capped at the border's
  own screen length so a ripple cannot reach past the tile it lies over.
- **The wave wants a bigger reach than the flames do.** The reach default (23 %) was tuned for
  flame tongues, and at that setting the ripple ring is a tight shimmer hugging the tile: the
  effect reads best around 50–75 %, where the ring sweeps out over most of the neighbouring
  tiles. The row's tooltip says so.
- **The wave is a square ring, not a circle.** It follows the tile grid, which is why it reads
  as a shockwave out of your tile rather than a pond ripple; the corners are 90° joints (mitred,
  not rounded).
- **No destination tile, and no interaction with the true-tile mod.** The effects frame whatever
  is there: with `true-tile` off you get fire or a ripple around an invisible tile. Hovered tile
  = `mods/hover-tile`.
- **289 and 274 only.** `274` inherits the 289 corpus. `254` has no corpus for this mod (like
  hover-tile, ground-items, wiki-lookup and the rest), so it is simply unavailable there.

## Adding the next effect

1. a `TRUE_TILE_PLUS_EFFECT_<NAME>` integer id in the payload's constants (integers, never
   strings — a runtime string must not index a table in bundled code: the property mangler
   renames object-literal keys);
2. its geometry function, taking the same `(emit, px, py, ox, oy, settings, phase, mask)`
   arguments — `mask` is the set of borders to draw, and honouring it is what keeps the effect
   on the ground it belongs to (add a `corner` argument only if it needs corner geometry, the
   way the wave does);
3. one branch in `trueTilePlusEffect()`;
4. one `options` entry in the panel's Ground effect row (and, if it needs its own look, one
   more key + row — but note the rows are shared, so a new row must not name one effect).

Nothing else changes: no hunk, no rebuild of the hook, and the settings table stays as it is.

## Verified

- `tools/true_tile_plus_test.ts` — **173 checks, all green** (93 flames + 80 wave), run against
  both the `files/` payload and the copy inside an applied tree. The flames' 93 are as before.
  The wave's 80 cover: the settings table and the three effect ids; the triangle budget per
  border; integer pixels, the colour, legal `trans` and no degenerate triangles; the documented
  emit order (per quad, the crest is never more transparent than the swell it trails) and both
  ends of the fade being reached; the **edge mask** and the **corner split** (each bit paints
  exactly its own border, every vertex stays outside the true tile and within the tile that owns
  it, and — the regression guard for the corner bug — **both borders' miters meet at the same
  corner radius, so the ring closes**); the train never vanishing at ANY phase (the regression
  guard for the bunched-train blink-out), never reaching inside the tile, and staying inside the
  reach while really using it; determinism; the envelope's documented shape (0 at both ends,
  (0,1] between, peaking before half way); speed 0 freezing and speed being a pure time scale,
  miters included; the sliders moving the geometry they claim to; the degenerate cases; and the
  dispatcher passing `corner` through while the flames ignore it.
- `tools/true_tile_plus_preview.ts` — renders the real payload at 3x for BOTH effects and
  asserts, per phase, that all four borders are painted and rooted on the border; for the wave
  additionally that **every corner's diagonal is painted** (the guard for the notched-diagonal
  bug) and that the painted region is **at most four connected pieces** — a closed ripple paints
  as one loop, four bands that never meet paint as four, so a healthy frame is 1–4. Measured on
  the shipped defaults: 1–2 loops at reach 23 %, 3–4 at reach 75 %.
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
  switch; its view opens with all six rows at the documented defaults (`Flames`, `#000000`,
  `4`, `23%`, `1.00×`); the select now lists `Flames` / `Wave` / `None`; the select, the colour
  swatch and all three sliders write their own keys live, and each row's reset restores its
  default; no console errors.
- **In-game feel is player-verified** (see the handover checklist): flames on all four edges
  while standing and running, their lead on the model mid-run, occlusion by walls/NPCs and by
  the player's own model, the reach/flicker/count at default and zoomed-out camera, and all
  settings reading live. The wave's own checklist is the same shape: the ring closed at all four
  corners, the ripples sweeping outward and fading, the corner joints clean at a high reach, and
  the crest/trail reading as water rather than as a scaled outline.
