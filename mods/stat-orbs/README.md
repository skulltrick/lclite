# mods/stat-orbs

OSRS-style **Hitpoints / Prayer / Run-energy data orbs**, drawn on the 2004Scape minimap
panel in the 2004/5 idiom: hard 1px outlines, flat palette colours, stepped shading
bands, no anti-aliasing and no smooth gradients anywhere.

Player-visible effect: a vertical column of three orbs down the minimap panel's left
stone strip, below the compass, in OSRS order (Hitpoints, Prayer, Run energy top to
bottom), each with its value **to its left**. The orbs fill and drain live, the Hitpoints
orb flashes below a quarter health, and the whole column can be moved with **Alt+drag**
and put back with **Alt+right-click** or the panel's *Reset position* row. Every setting
applies on the next frame — nothing here needs a rebuild or a reload.

## What's in the box

- `patches/Client_ts.json` — FOUR hunks into `webclient/src/client/Client.ts`:
  1. the fields + `orbLayout()` / `drawStatOrbs()` / `drawOrb()` / `drawOrbNumber()` /
     helpers block, parked in the isolated slot before `gameDraw()` so regen routes the
     whole block to this mod (far from any other mod's hunks);
  2. the top of `minimapDraw()` — the master-key read plus the one-shot wipe when the
     mod is switched off mid-session;
  3. the hidden-minimap branch of `minimapDraw()` (`minimapState == 2`);
  4. the end of `minimapDraw()` — the normal draw.
- Panel rows: `MOD_REGISTRY` + eight `MODS[]` rows for `stat-orbs` in
  `mods/control-panel/files/engine/public/lclite/panel.js` (size, numbers, fill style,
  low-HP warning, three colours, reset position).
- `lcmStatOrbsBounds` is the only cross-realm name this mod adds, and it is reserved in
  `bundle.ts` (control-panel's island).

## Where it draws, and why there

The orbs paint into the **`areaMap` widget buffer** (172×156, composited at canvas
550,4) at the end of `minimapDraw()`, which is the same ride the minimap itself takes:
`gameDraw()` blits that buffer over the sidebar every tick, so the orbs land **on top of
the interface**, survive an open modal, and are picked up by the gpu mod's HUD overlay
upload like every other HUD pixel. `Pix2D` is already bound to that buffer at the hook
site, and nothing needs restoring because `minimapDraw`'s own tail rebinds `areaGame`.

Two facts about that buffer drive the whole design:

- **The strip is only 25px wide.** The rotating map window is the 146×151 rect at (25,5)
  and the 33×33 compass owns (0,0)–(32,32), so the free stone is x < 25 below the
  compass. The map circle is inscribed in that window, so the frame *widens* above and
  below the circle's rim — the column is straight anyway (predictable for dragging), and
  only the middle orb's rim touches the map's left edge.
- **The stone is painted once, at boot.** Areas left of the map window are never
  re-cleared per tick, so (a) every pixel written must be **opaque** — an alpha blend
  there accumulates and darkens a little more every frame — and (b) anything that moves
  or changes shape leaves stale pixels behind, which is what the wipe below is for.

## Layout

`orbLayout()` recomputes this every frame from this mod's own keys (rule 5):

- `r` = size/2, clamped to 20–28px.
- Numbers to the left ⇒ the column sits at `orbLeft = 14` (three 4px digits + a 2px gap
  fill x 0–11); with numbers *inside* or *hidden* there is no text beside the orbs, so
  `orbLeft = 3` and they hug the frame edge instead.
- The three orbs spread evenly down y 34–154 (below the compass, above the widget edge):
  `step = 60 - r`, so the group is always 120px tall whatever the size.
- The group box (`orbLeft + 2r` × 120) is then placed from the `lcmStatOrbs*` placement
  keys and clamped **flush** inside the widget — the same clamp the panel applies.

## Art

`drawOrb()` rasterizes one orb as a pixel circle: hard 1px black outline → a 2px metal
rim **lit on the top half and shadowed below** (a diagonal split read as one flat dark
ring against the stone, and the first colours were too close to the stone to see at all)
→ a dark glass body → the fill. The fill is shaded in three **hard** bands (a radial
bevel), never a gradient: that gradient was what made the old orbs read as modern vector
art. The liquid fill draws a 1px lighter meniscus at the surface; the pie fill sweeps
clockwise from 12 o'clock. On top sit the stat's 7×7 glyph (heart / four-point star /
boot) with a 1px outline so it stays legible over both the liquid and the dark glass,
and the 2004 gloss glint (a small rounded blob on the upper-left shoulder).

Readouts use `ORB_DIGITS`, a hand-rolled **3×5 pixel font** with a 1px black shadow. This
is not a style choice: no 2004 font fits beside an orb — `p12` digits are 6px wide plus a
shadow, so three of them are 18px against a 25px strip — and a tiny font is what OSRS
itself draws its orb numbers in. HP's readout keeps the classic fraction colour coding
(green > 66%, yellow > 33%, red below) and everything else is white.

## Settings contract

All of these are this mod's OWN localStorage keys, read at its own hook **every frame** —
no hub, no other mod's key, and every change lands on the next frame.

| key | values | default | row |
|---|---|---|---|
| `statOrbs` | `'true'`/`'false'` | `'false'` | master switch on the mod's row |
| `statOrbsSize` | `'20'`–`'28'` (px, even) | `'22'` | Orb size (slider) |
| `statOrbsNumbers` | `left`/`inside`/`hidden` | `left` | Orb numbers (select) |
| `statOrbsFill` | `liquid`/`pie` | `liquid` | Fill style (select) |
| `statOrbsPulse` | `'true'`/`'false'` | `'true'` | Low HP warning (toggle) |
| `statOrbsHpColor` | `'#rrggbb'` | `'#e82623'` | Hitpoints color |
| `statOrbsPrayerColor` | `'#rrggbb'` | `'#d9a318'` | Prayer color |
| `statOrbsRunColor` | `'#rrggbb'` | `'#71c8e8'` | Run energy color |
| `lcmStatOrbsAnchor` / `lcmStatOrbsOffset` | anchor name + buffer-px offset | unset | written by the drag layer ONLY |

## Placement (alt-drag)

The orbs are a **canvas-buffer surface**: `drawStatOrbs()` self-registers through
`window.lcmAnchor.registerCanvas([...])` with a positional array, publishing its box as
`window['lcmStatOrbsBounds']()` → `[x, y, w, h]` in the widget's own pixels (or `null`
while the mod is off, so Alt+drag cannot grab a hidden surface). The 7th element of that
array is this mod's contribution to the placement platform: the **region** descriptor
`[550, 4, 172, 156, 172, 156]` — the minimap widget's rect in the canvas's 765×503
logical space plus that buffer's pixel size. Without it the panel would clamp the orbs
into the game viewport, which is a different buffer entirely.

The panel drags a ghost box and writes the keys; this mod only ever **reads** them
(rule 5). Reset comes from the drag layer too — the panel's *Reset position* row calls
`window.lcmAnchor.reset('stat-orbs')`, which is the same code path as Alt+right-click.

Two traps found while wiring this up, both now fixed platform-wide:

- **A runtime string must never be an object-literal key in bundled code.** The anchor
  names ('MC'…) are stored in localStorage, and terser's property mangler renames
  object-literal keys, so `ORB_ANCH['MC']` shipped as `SD["MC"]` against a renamed
  `{av: …}`: every lookup missed and the orbs could never move. The table is now two
  parallel arrays matched by index (the same fix as `xp-drops`).
- **`hitCanvasSpec` compared against `.right`/`.bottom` on a plain object**, so the
  canvas hit test could never match at all — alt-drag on a canvas surface was dead.

## Deliberate divergences and limits

- **The orbs ride the minimap widget, not a DOM overlay.** They therefore cannot be
  dragged into the sidebar, the chatbox or the letterbox — the 172×156 buffer is their
  hard boundary. That is the same limit the xp tracker has, and it is why the drag layer
  clamps canvas surfaces flush instead of leaving a margin.
- **The middle orb's rim overlaps the map's left edge** by a few px at the default size
  (and more at 28px). That is where OSRS's orbs sit too — they are mounted over the
  panel's inner edge — and the numbers are what force the column that far right.
- **The wipe is content-keyed, not per-frame.** Moving, resizing, recolouring or a
  changed readout re-plots the mapback once (the readouts change width with the value, so
  "100" → "45" would otherwise leave a stale third digit). While nothing changes, no wipe
  runs at all. The mapback's map window is a transparent hole, so re-plotting it restores
  the stone and leaves the map alone.
- **Only three stats.** Special attack energy does not exist in 2004, and OSRS's fourth
  orb has nothing to show here.
- **No hover/click behaviour on the orbs** (no quick-prayers, no tooltips): the orbs are
  a readout, and the 2004 panel has no click-through affordances to borrow.

## Verified

- Live in-game: default column position, all three fill levels and colours, the liquid
  meniscus row (50% ⇒ the surface sits exactly on the orb's centre row), the pie wedge
  (50% ⇒ the boundary is the centre column, filled clockwise from 12 o'clock), the
  low-HP flash, the `inside`/`hidden` number modes, the 28px size, and the tiny font
  glyphs pixel-for-pixel.
- Alt+drag moves the column and writes the keys; the position survives a full reload;
  `lcmAnchor.reset('stat-orbs')` (and therefore the panel row) puts it back to the
  default box `[0, 34, 36, 120]`; the ghost box and the drawn orbs agree.
- The panel's mod view lists all eight rows with the right kinds, and the master switch
  gates them.
