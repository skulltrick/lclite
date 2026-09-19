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

Three of the orbs' own behaviours sit on top of that readout:

- **Number size** — the HP/Prayer/Run readouts are drawn at 1x, 2x or 3x. Bigger digits
  need more of the panel strip, so the column shifts further right and overlaps the map
  a little more; the placement keys are unchanged, so an existing dragged position still
  means the same thing.
- **Click the run orb to toggle run** — the same click the options tab's own Run/Walk
  button sends. The orb's glass lightens while run is on, which is the only feedback a
  one-click toggle can give.
- **Click the prayer orb for the prayer book** — the whole 2004 prayer book opens over
  the minimap: all fifteen prayers in the tab's own 3x5 grid, drawn with the game's own
  prayer icons and glow. Click a prayer to toggle it, the orb or anywhere on the panel
  to close. The orb column stays visible (and keeps updating) while the book is open.

## What's in the box

- `files/webclient/src/client/StatOrbs.ts` — the mod's **pure core**: this mod's settings
  parse, the readout font's geometry, the STRUCTURAL lookup of the prayer book and the
  run/walk buttons in the loaded interface list, and the quick-prayer panel's box, cell
  positions and hit tests. Nothing in it touches client state, the DOM or Pix2D, so
  `mods/stat-orbs/tools/stat_orbs_test.ts` runs the REAL shipped logic headlessly. `apply`
  copies it verbatim; one import hunk in `Client.ts` pulls it into the bundle.
- `patches/289/Client_ts.json` — SIX hunks into `webclient/src/client/Client.ts`:
  1. the payload import, parked under the `IfType` imports (clear of every other mod's
     import islands, and nowhere near `import JagFX` — whose neighbourhood carries the
     revision-specific `const CLIENT_VERSION = 289;` line that would expire 274's
     `inherits` claim);
  2. the fields + `orbLayout()` / `drawStatOrbs()` / `drawOrb()` / `drawOrbNumber()` /
     `drawOrbBook()` / `orbsResolve()` / `orbsClickLoop()` / `orbsRunToggle()` /
     `orbsPrayerClick()` / helpers block, parked in the isolated slot before `gameDraw()`
     so regen routes the whole block to this mod (far from any other mod's hunks);
  3. `if (this.orbsClickLoop()) return;` at the TOP of `minimapLoop()` — see *The click
     hook* below for why it is not in `checkClickInput` with the wiki button's;
  4. the top of `minimapDraw()` — the master-key read plus the one-shot wipe when the
     mod is switched off mid-session;
  5. the hidden-minimap branch of `minimapDraw()` (`minimapState == 2`);
  6. the end of `minimapDraw()` — the normal draw.
- Panel rows: `MOD_REGISTRY` + eleven `MODS[]` rows for `stat-orbs` in
  `mods/control-panel/files/engine/public/lclite/panel.js` (size, number size, numbers,
  fill style, low-HP warning, run click, prayer book, three colours, reset position). The
  `panel.js?v=` key in `client.ejs` was bumped for this change (22 → 23), the house rule
  for any panel.js edit.
- `lcmStatOrbsBounds` is the only cross-realm name this mod adds, and it is reserved in
  `bundle.ts` (control-panel's island).
- `tools/stat_orbs_test.ts` — 78-check bun harness (see *Verified*).

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
  (The mapback's transparent region is the map CIRCLE plus a 33px compass hole, so
  re-plotting it restores the stone and disturbs neither the map nor the compass.)

## Layout

`orbLayout()` recomputes this every frame from this mod's own keys (rule 5):

- `r` = size/2, clamped to 20–28px.
- Numbers to the left ⇒ the column sits at `statOrbsOrbLeft('left', scale)` — the room
  three digits need at that scale, **14px at 1x** (the shipped default, unchanged), 25 at
  2x, 36 at 3x; with numbers *inside* or *hidden* there is no text beside the orbs, so
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
**lightning bolt**) with a 1px outline so it stays legible over both the liquid and the
dark glass, and the 2004 gloss glint (a small rounded blob on the upper-left shoulder).

The run mark used to be a boot-ish blob that read as neither. 2004 has **no run icon of
its own to borrow** (the options tab's run button is a plain button graphic), so the orb
carries the one mark that reads as "energy" at 7×7: a lightning bolt.

Readouts use `ORB_DIGITS`, a hand-rolled **3×5 pixel font** with a 1px black shadow. This
is not a style choice: no 2004 font fits beside an orb — `p12` digits are 6px wide plus a
shadow, so three of them are 18px against a 25px strip — and a tiny font is what OSRS
itself draws its orb numbers in. The **Number size** setting scales it by an integer
factor: each glyph pixel becomes an s×s block and the shadow moves a whole block, so the
digits stay square and stay on the pixel grid at 2x and 3x instead of smearing. HP's
readout keeps the classic fraction colour coding (green > 66%, yellow > 33%, red below)
and everything else is white.

## The quick-prayer book

**What it contains is the REAL 2004 prayer book.** 2004Scape's prayer tab is the 2004
fifteen: Thick/Rock/Steel Skin, Burst of Strength/Superhuman/Ultimate Strength, Clarity
of Thought/Improved/Incredible Reflexes, Rapid Restore, Rapid Heal, Protect Item, and
Protect from Magic/Missiles/Melee. There is **no Eagle Eye, Mystic Might, Augury, Piety
or Rigour in 2004** — those are 2006+ — so the panel is the book the game actually has,
in the tab's own 3×5 grid, and it is the *whole* book rather than a "combat set" chosen
for the player. (Adding the missing prayers would be a content mod, not this one.)

**The icons are the game's own.** Each cell blits its icon component's `graphic` (unlit)
or `graphic2` (lit — the component's own `script1=gt,<level>` IS the level requirement,
and the client's `getIfActive()` already answers it), and the toggle's `activegraphic` —
`prayerglow` — goes over the top while that prayer is on. So the book can never disagree
with the prayer tab, and this mod ships **no art at all** for it.

**Nothing is hardcoded.** Component ids are assigned by the interface packer, so they are
a revision-specific accident. What is stable is the SHAPE of the interface, and that is
what `statOrbsBook()` matches:

- the layer holding fifteen `BUTTON_TOGGLE` components whose script 0 pushes **fifteen
  consecutive varps** (the prayer tab is the only such layer);
- each of those toggles paired with the 30×30 `graphic`+`activegraphic` icon centred
  inside its own 34×34 box (a pairing that is not centred is some other interface that
  merely looks like the book, and is refused);
- cells come back in **book order** — the tab's grid read row-major, so cell 0 is Thick
  Skin and cell 14 is Protect from Melee, which is also the order the `prayeroff` /
  `prayeron` frames use.

The harness proves the same tab at shifted component ids still resolves, and that a
fourteen-icon or non-consecutive-varp layer is refused.

**Geometry.** The panel is the tab's grid turned back the right way up — 3 columns × 5
rows of 30×30 icons at a 31px pitch, 95×156 in the widget's pixels — and it opens
immediately right of the orb column, sliding right as the readouts grow and clamping
flush inside the widget. It is TALL rather than wide because the orb column owns the
panel's left edge and the widget is only 172px across: a 5-across grid would either cover
the orbs or force the icons down to a non-integer scale. It is drawn **under** the orbs
(drawing order, not z-order games): at 3x the readouts reach across the panel's own left
edge, and a prayer book you cannot see your prayer points through is worse than one icon
behind an orb.

**The panel's own frame** is 2004 interface furniture: a hard 1px black outline, a bevel
lit on the top and left and shadowed on the bottom and right, and the stone the side
panels are made of (`0x564d42`, the colour `invback.png` is drawn in). Every pixel is
opaque — the stone strip is never re-cleared, so a blend there would accumulate.

## The run orb, and the click hook

**Toggling run is the options tab's own click.** The mod sends the same `IF_BUTTON`
packet the player's click on the Run/Walk button sends. Nothing is special-cased for the
server: the controls tab sits in `player.tabs` from login, which is exactly what makes
its components visible to the `IfButtonHandler`, so the click is accepted no matter which
tab the player is looking at. Which component to click is found the same way the SERVER
finds it: the run varp is the one the cache marks **`clientcode=7`** (the engine's own
`VarPlayerType.RUN` test), and the pair of `BUTTON_SELECT` buttons pushing it are the
walk (operand 0) and run (operand 1) buttons.

Both the run toggle and a prayer flip the varp **optimistically**, exactly as the client's
own `TOGGLE_BUTTON`/`SELECT_BUTTON` paths do. That is safe because every prayer trigger
ends with `%prayerN = %prayerN;` and both run triggers with `%option_run = %option_run;`
— the "resync varp" idiom — so a refusal (no prayer points, level too low, under 1%
energy) or a conflicting-prayer shutdown is corrected on the next tick.

**The click hook hangs off `minimapLoop()`, not `checkClickInput`.** `orbsClickLoop()`
runs as the first statement of `minimapLoop()` and returns whether it consumed the click
(the caller returns early if it did), which is inside `checkClickInput`'s guard — the
engine only reaches `minimapLoop` through it — and ahead of the walk the minimap click
would otherwise set. Two reasons it is there and not next to the wiki button's hook:

- the wiki button already owns the only free insertion island in the `checkClickInput`
  block, and a second insertion beside it is **one patch island**, because the lines
  between two insertions are new lines, not unchanged ones. Regen attributed the orbs'
  lines to wiki-lookup, which would have made stripping wiki-lookup silently strip the
  orbs' clicks too.
- `mouseLoop()` (which runs first) consumes clicks while a right-click menu is open, and
  that is the behaviour we want: a click that dismisses a menu should not also toggle a
  prayer.

All three orbs consume the click, including the Hitpoints orb, which does nothing: the
orbs straddle the map window's own left edge, so half of each one would otherwise set a
walk flag under the cursor. A click anywhere else on the panel is left to the engine.

## Settings contract

All of these are this mod's OWN localStorage keys, read at its own hook **every frame** —
no hub, no other mod's key, and every change lands on the next frame.

| key | values | default | row |
|---|---|---|---|
| `statOrbs` | `'true'`/`'false'` | `'false'` | master switch on the mod's row |
| `statOrbsSize` | `'20'`–`'28'` (px, even) | `'22'` | Orb size (slider) |
| `statOrbsNumberScale` | `'1'`–`'3'` | `'1'` | Number size (slider) |
| `statOrbsNumbers` | `left`/`inside`/`hidden` | `left` | Orb numbers (select) |
| `statOrbsFill` | `liquid`/`pie` | `liquid` | Fill style (select) |
| `statOrbsPulse` | `'true'`/`'false'` | `'true'` | Low HP warning (toggle) |
| `statOrbsRunClick` | `'true'`/`'false'` | `'true'` | Run orb toggles run (toggle) |
| `statOrbsPrayerPanel` | `'true'`/`'false'` | `'true'` | Prayer book on the orb (toggle) |
| `statOrbsHpColor` | `'#rrggbb'` | `'#e82623'` | Hitpoints color |
| `statOrbsPrayerColor` | `'#rrggbb'` | `'#d9a318'` | Prayer color |
| `statOrbsRunColor` | `'#rrggbb'` | `'#71c8e8'` | Run energy color |
| `lcmStatOrbsAnchor` / `lcmStatOrbsOffset` | anchor name + buffer-px offset | unset | written by the drag layer ONLY |

The panel's open state is deliberately **not** persisted: a reload starts closed, and
switching the mod off closes it.

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
  clamps canvas surfaces flush instead of leaving a margin. The quick-prayer book lives
  inside the same buffer and is positioned from the orbs, not dragged.
- **The middle orb's rim overlaps the map's left edge** by a few px at the default size
  (and more at 28px). That is where OSRS's orbs sit too — they are mounted over the
  panel's inner edge — and the numbers are what force the column that far right.
- **The wipe is content-keyed, not per-frame.** Moving, resizing, recolouring, a changed
  readout, the number scale, the book opening or closing, a prayer toggling, the prayer
  level unlocking an icon, or the cursor crossing onto another cell all re-plot the
  mapback once. While nothing changes, no wipe runs at all.
- **Only three stats.** Special attack energy does not exist in 2004, and OSRS's fourth
  orb has nothing to show here.
- **No tooltips or right-click on the orbs**, and the book has no level-requirement
  readout: the 2004 tab shows it as a hover overlay layer, and the panel's unlit icons
  already say the same thing at a glance. The book's hover feedback is one lit box.
- **The book is the whole prayer book, not a configurable quick set.** If the missing
  2006 prayers ever arrive in the content, this panel picks them up automatically only
  once the tab's shape still matches (fifteen consecutive-varp toggles with centred
  icons) — a larger prayer book would need the lookup's `ORB_BOOK_SIZE` revisited.

## Verified

- Live in-game: default column position, all three fill levels and colours, the liquid
  meniscus row (50% ⇒ the surface sits exactly on the orb's centre row), the pie wedge
  (50% ⇒ the boundary is the centre column, filled clockwise from 12 o'clock), the
  low-HP flash, the `inside`/`hidden` number modes, the 28px size, and the tiny font
  glyphs pixel-for-pixel.
- Alt+drag moves the column and writes the keys; the position survives a full reload;
  `lcmAnchor.reset('stat-orbs')` (and therefore the panel row) puts it back to the
  default box `[0, 34, 36, 120]`; the ghost box and the drawn orbs agree.
- The panel's mod view lists all eleven rows with the right kinds, and the master switch
  gates them.
- `bun run mods/stat-orbs/tools/stat_orbs_test.ts` — 78 checks over the shipped core:
  the settings clamp table; the readout geometry at every scale (including the 1x
  expression being digit-for-digit the old one); the prayer book resolving off 289's own
  prayer.if geometry, in book order, with the right varps, click ids and per-prayer
  icons, and refusing non-consecutive varps / a missing icon / misaligned icons / a
  renumbered interface; the run pair resolving off the run varp and never off the
  retaliate varp; the panel's box, its fifteen cells and its hit test (every cell's
  centre maps back to itself, the frame is not a cell, nothing outside the box is).
- `tsc -p tsconfig.json` clean on the applied tree, and the built `client.js` carries the
  three new keys.
- The overlay's acceptance harness (pristine clones at the pins, byte-compare against
  the live install, converge round-trip) and `tools/matrix.mjs` over every declared
  revision.
