# mods/stat-orbs

OSRS-style **Hitpoints / Prayer / Run-energy data orbs**, drawn on the 2004Scape minimap
panel in the 2004/5 idiom: hard 1px outlines, flat palette colours, stepped shading
bands, no anti-aliasing and no smooth gradients anywhere.

Player-visible effect: a vertical column of three orbs down the minimap panel's left
stone strip, below the compass, in OSRS order (Hitpoints, Prayer, Run energy top to
bottom), each with its value **to its left**, plus a fourth, larger **special attack orb**
at the panel's bottom left. The orbs fill and drain live, the Hitpoints orb flashes below
a quarter health, and the column can be moved with **Alt+drag** and put back with
**Alt+right-click** or the panel's *Reset position* row (the spec orb has its own drag and
its own reset row). Dragging moves the orbs **with the cursor, live** — they are painted
from the placement keys, and the drag layer writes those keys as the pointer moves, so
there is no ghost-only phase and no jump on release. The column may also be dragged
**past the minimap panel's left edge**: the 34px of the sidebar's own stone left of the
widget is painted by this mod too (see *The stone strip* below), so the readouts can be
pushed out until they sit flush against the sidebar's edge. Every setting applies on the
next frame — nothing here needs a rebuild or a reload.

Four of the orbs' own behaviours sit on top of that readout:

- **Number size** — the HP/Prayer/Run readouts are drawn at 1x, 1.5x, 2x, 2.5x or 3x.
  Bigger digits need more of the panel strip, so the column shifts further right and
  overlaps the map a little more; the placement keys are unchanged, so an existing dragged
  position still means the same thing.
- **Click the run orb to toggle run** — the same click the options tab's own Run/Walk
  button sends. The orb's glass lightens while run is on, which is the only feedback a
  one-click toggle can give.
- **Click the prayer orb for the prayer book** — the whole 2004 prayer book opens over
  the minimap: all fifteen prayers in the tab's own 3x5 grid, drawn with the game's own
  prayer icons and glow. Click a prayer to toggle it, the orb or anywhere on the panel
  to close. The orb column stays visible (and keeps updating) while the book is open.
- **The special attack orb** — a red orb with a green depleting fill (the 2004 spec bar's
  own colour scheme) reading out your special attack energy as a percentage, which turns
  plain grey while the wielded weapon has no special attack. See *The special attack orb*
  below.

## What's in the box

- `files/webclient/src/client/StatOrbs.ts` — the mod's **pure core**: this mod's settings
  parse, the readout font (both tables and their rasterizer), the orb marks, the
  STRUCTURAL lookup of the prayer book, the run/walk buttons and the special-attack bar in
  the loaded interface list, the quick-prayer panel's and the spec orb's geometry and hit
  tests, and the placement geometry the strip hangs off (`OrbLayout`, `ORB_STRIP_*`,
  `statOrbsClampX/Y`, `statOrbsInStrip`). Nothing in it touches client state, the DOM or
  Pix2D, so `mods/stat-orbs/tools/stat_orbs_test.ts` runs the REAL shipped logic
  headlessly. `apply` copies it verbatim; one import hunk in `Client.ts` pulls it into the
  bundle.
- `patches/289/Client_ts.json` — SIX hunks into `webclient/src/client/Client.ts`:
  1. the payload import, parked under the `IfType` imports (clear of every other mod's
     import islands, and nowhere near `import JagFX` — whose neighbourhood carries the
     revision-specific `const CLIENT_VERSION = 289;` line that would expire 274's
     `inherits` claim);
  2. the fields + `orbLayout()` / `drawStatOrbs()` / `orbsDrawOrbs()` / `orbsStripFrame()` /
     `orbsStripClear()` / `orbsStripStone()` / `drawOrb()` / `drawOrbNumber()` /
     `drawOrbBook()` / `orbsResolve()` / `orbsClickLoop()` / `orbsRunToggle()` /
     `orbsPrayerClick()` / helpers block, parked in the isolated slot before `gameDraw()`
     so regen routes the whole block to this mod (far from any other mod's hunks);
  3. `if (this.orbsClickLoop()) return;` at the TOP of `minimapLoop()` — see *The click
     hook* below for why it is not in `checkClickInput` with the wiki button's;
  4. the top of `minimapDraw()` — the master-key read plus the one-shot wipe when the
     mod is switched off mid-session (the widget buffer AND the stone strip);
  5. the hidden-minimap branch of `minimapDraw()` (`minimapState == 2`);
  6. the end of `minimapDraw()` — the normal draw.
- Panel rows: `MOD_REGISTRY` + fourteen `MODS[]` rows for `stat-orbs` in
  `mods/control-panel/files/engine/public/lclite/panel.js` (size, number size, numbers,
  fill style, low-HP warning, run click, prayer book, five colours, two reset positions).
  The `panel.js?v=` key in `client.ejs` was bumped for this change (24 → 25), and so was
  `panel.css?v=` (10 → 11) — the house rule for any panel edit.
- `lcmStatOrbsBounds` is the only cross-realm *global* this mod adds, and it is reserved in
  `bundle.ts` (control-panel's island). The spec orb registers a second surface with a
  closure instead, so it needs no new reserve; its keys
  (`lcmStatOrbsSpecAnchor`/`Offset`) are plain localStorage strings.
- `tools/stat_orbs_test.ts` — 142-check bun harness (see *Verified*), and
  `tools/apply_spec_orb.py`, the idempotent one-shot script that made this change to the
  live tree (kept because it documents the edit and can be re-run).

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

### The stone strip (why the orbs can leave the panel at all)

The widget buffer is the orbs' canvas, so **the widget's left edge used to be the hard
wall** — dragging further left simply clamped and nothing moved. But the sidebar's own
stone starts further left than that: the client paints its background sprites at canvas
x 516 (`backvmid1`, drawn at `(516, 4)`), and the minimap widget is composited *over*
them at 550. That leaves **34px of free sidebar stone** — `ORB_STRIP_W`, canvas
516..549, exactly the widget's height — and it is now the column's left wall instead.

Pixels outside the widget buffer cannot exist *in* it, so the strip is a **second buffer
this mod composites itself** (`orbsStripStone()` / `orbsStripFrame()`): a 34×156 `PixMap`
whose background is copied straight out of the sidebar's own `areaBackvmid1` pixels (the
same buffer the client's `backvmid1.draw(516, 4)` puts on the canvas, so the strip is
pixel-identical to the stone already there), composited at `(516, 4)` with
`PixMap.draw` — which forces every pixel opaque, exactly what a never-re-cleared strip
needs. The same orbs are then drawn over it, shifted right by the strip's width; Pix2D
clips each pass to the buffer it is bound to, so an overhanging column is simply drawn
half in the widget and half in the strip (`orbsDrawOrbs` is one routine, called twice).

Two consequences worth knowing:

- **No strip wipe is needed.** The stone is re-copied and the strip re-composited on
  every frame the orbs actually reach into it, so it can never hold a stale orb — and the
  frame they stop reaching, the bare stone is composited once more and the strip goes
  quiet (`statOrbsInStrip` is the test). Switching the mod off mid-session with the orbs
  hanging in the strip calls `orbsStripClear()` from the same off-wipe hook that
  re-plots the mapback, because nothing else would ever repaint that stone.
- **The strip's own limit is the sidebar's edge.** Further left is the game viewport
  (the world ends at 516) and the world is dynamic: an orb there would have to be
  re-composited over live terrain every frame, and on a gpu frame the world is not in
  any buffer the mod can read. So 34px is the whole of the extra room, and the drag's
  clamp, the ghost's clamp and the panel's own overhang all end at the same pixel.

## Layout

`orbLayout()` recomputes this every frame from this mod's own keys (rule 5):

- `r` = size/2, clamped to 20–28px.
- Numbers to the left ⇒ the column sits at `statOrbsOrbLeft('left', scale)` — the room
  three digits need at that scale, **14px at 1x** (the shipped default, unchanged), 17 at
  1.5x, 25 at 2x, 31 at 2.5x, 36 at 3x; with numbers *inside* or *hidden* there is no text
  beside the orbs, so `orbLeft = 3` and they hug the frame edge instead.
- The three orbs spread evenly down y 34–154 (below the compass, above the widget edge):
  `step = 60 - r`, so the group is always 120px tall whatever the size.
- The group box (`orbLeft + 2r` × 120) is then placed from the `lcmStatOrbs*` placement
  keys and clamped **flush** — the same clamp the panel applies — with ONE exception: the
  left edge may overhang the widget by `ORB_STRIP_W` (34px, into the sidebar's own stone
  strip, see above), which is what `statOrbsClampX` encodes. Vertically the widget is
  still the whole world (`statOrbsClampY`), because the strip is exactly the widget's
  height.
- The **spec orb** is 2px of radius bigger (`statOrbsSpecBox`), and its default spot is
  bottom-aligned with the column's own bottom edge, 4px clear of the column's right edge:
  the panel's bottom left, in the free stone below the map circle's left rim. It follows
  the column until it is dragged (its own `lcmStatOrbsSpec*` keys take over after that),
  and it clamps flush the same way. At the shipped size that is `[40, 128, 26, 26]` — the
  wiki button owns the bottom right, and nothing else is within 4px of it.

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

The spec orb passes `drawOrb` a **background** as well as a fill: `0` is the dark glass
every other orb has (byte for byte what it always was), and the spec orb hands in its own
red — or grey, for a weapon without a special attack — which gets the same two hard bands
as the dark glass, at the same two radii.

**The bolt is the mark the run orb was always meant to carry**, and it is the one thing
this mod shipped *wrong* for a while: the glyph table entry was 52 characters instead of
49, `drawOrb` only inks a complete 7×7, and the run orb therefore drew **nothing in the
middle** — with no error anywhere to say why. The tables now live in the pure core with a
`statOrbsGlyphOk()` guard, and the harness checks all three marks are complete 7×7s. 2004
has **no run icon of its own to borrow** (the options tab's run button is a plain button
graphic), so the orb carries the one mark that reads as "energy" at 7×7: a bolt, bar
across the middle row.

### The readout font, and why there are two of them

Readouts use `ORB_DIGITS`, a hand-rolled **3×5 pixel font** with a 1px black shadow. This
is not a style choice: no 2004 font fits beside an orb — `p12` digits are 6px wide plus a
shadow, so three of them are 18px against a 25px strip — and a tiny font is what OSRS
itself draws its orb numbers in.

**Number size moves in half steps** (1, 1.5, 2, 2.5, 3) because 1x → 2x was the whole
range in one notch. A 3×5 font has no crisp 1.5x: at that scale every stroke lands on a
1.5px boundary, and the only hard answers there are 1px (the strokes break up and the
weights go uneven) or 2px (a bold font that reads as 2x — the very jump the half step
exists to soften). So a half step draws a **second, purpose-drawn 4×7 font**
(`ORB_DIGITS_HALF`, the same blocky idiom, one pixel of stroke) at a whole multiple
instead:

| scale | font | ink box | stroke |
|---|---|---|---|
| 1x | 3×5 | 3×5 | 1px |
| 1.5x | 4×7 | 4×7 | 1px |
| 2x | 3×5 ×2 | 6×10 | 2px |
| 2.5x | 4×7 ×2 | 8×14 | 2px |
| 3x | 3×5 ×3 | 9×15 | 3px |

Every glyph stays square and on the pixel grid, the sizes only ever grow, and the stroke
weight steps 1/1/2/2/3 — which is what makes each notch read as a size rather than a
jump. The 1x rendering is the old one digit for digit. HP's readout keeps the classic
fraction colour coding (green > 66%, yellow > 33%, red below) and everything else is
white.

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

## The special attack orb

**2004Scape does have special attacks**, and it has the bar to prove it: every
weapon-category combat interface carries a `specbar_layer` holding ten model segments,
each shown while the energy varp is above its own threshold (`script1=gt,99` …
`gt,999`), and the server hides that whole layer for a weapon whose `specwep` param is not
set. So this orb reads the game's own numbers rather than inventing a parallel system:

- **The varp, and the maximum, come off the bar.** `statOrbsSpec()` walks the combat tab's
  own interface tree (`sideIcon[0]` — the tab the server swaps per weapon category with
  `if_settab($interface, 0)`) and looks for the one layer holding a run of `gt` segments
  that read the SAME varp with evenly rising thresholds. The varp they push is
  `sa_energy`, and the top threshold **plus one** is full energy — the thresholds are
  exclusive, so `gt,999` is the bar at 1000 (`^sa_max_energy` in the content). Ten
  segments of 100 is therefore 100%, and a server that rescaled the energy would still
  read correctly.
- **"Does this weapon have a special attack?" is the bar's own hidden flag.** No obj
  params reach the client (`ObjType` has none), so the honest source is the layer the
  server just hid: `statOrbsSpecWeapon()` reads `IfType.list[layer].hide` **live, every
  frame**, because the weapon — and with it the whole combat interface — can change on any
  tick. Grey orb, same percentage.
- **Only the combat tab is searched.** Every other category's spec bar keeps whatever
  hidden state it had when it was last on screen, so a stale one must never be mistaken
  for the wielded weapon's. The lookup is re-run whenever `sideIcon[0]` changes, and the
  FULLEST bar wins if a second, shorter run of `gt` segments exists elsewhere in the same
  interface.

**The look** is the 2004 spec bar's own colour scheme: a **red background** with a
**green depleting fill** (both are settings — `Special attack color` and `Special attack
fill`), drawn with the same rim, outline, hard fill bands and meniscus as every other orb.
A weapon with no special attack gets a **plain grey orb** that still reads the energy out,
so the orb never becomes a lie about your energy — only about whether you can spend it.

**It is a bit bigger than the rest** (+2px of radius: 26px against 22px at the shipped
size) and it sits at the panel's **bottom left**, bottom-aligned with the column and 4px
clear of its right edge — the free stone below the map circle's left rim, away from the
three orbs and from the wiki button that owns the bottom right. Its top-right rim overlaps
the map circle's lower-left edge by a few px, exactly as the middle orb's rim overlaps the
map's left edge at the default size.

**It is its own canvas surface.** The spec orb has its own placement keys
(`lcmStatOrbsSpecAnchor`/`Offset`), its own Alt+drag ghost and its own *Reset special orb
position* row, so it can be moved somewhere else entirely without dragging the column with
it — and until it IS dragged it follows the column, so resizing the orbs or growing the
readouts can never land it on top of one. It consumes clicks that land on it (its disc
straddles the map window's rim, so half of it would otherwise set a walk flag) and does
nothing with them, like the Hitpoints orb.

**The percentage is always drawn inside it**, at the largest scale that still fits its
glass (`statOrbsSpecTextScale`: 1.5x at the shipped size, 2x on a 28px orb). The *Orb
numbers* setting governs the column's readouts, not this one — a number beside this orb
would land on the run orb above it, and the number IS this orb's whole information.

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
| `statOrbsNumberScale` | `'1'`–`'3'` in half steps | `'1'` | Number size (slider) |
| `statOrbsNumbers` | `left`/`inside`/`hidden` | `left` | Orb numbers (select) |
| `statOrbsFill` | `liquid`/`pie` | `liquid` | Fill style (select) |
| `statOrbsPulse` | `'true'`/`'false'` | `'true'` | Low HP warning (toggle) |
| `statOrbsRunClick` | `'true'`/`'false'` | `'true'` | Run orb toggles run (toggle) |
| `statOrbsPrayerPanel` | `'true'`/`'false'` | `'true'` | Prayer book on the orb (toggle) |
| `statOrbsHpColor` | `'#rrggbb'` | `'#e82623'` | Hitpoints color |
| `statOrbsPrayerColor` | `'#rrggbb'` | `'#d9a318'` | Prayer color |
| `statOrbsRunColor` | `'#rrggbb'` | `'#71c8e8'` | Run energy color |
| `statOrbsSpecColor` | `'#rrggbb'` | `'#8b1a1a'` | Special attack color (the orb's background) |
| `statOrbsSpecFill` | `'#rrggbb'` | `'#3cbf2e'` | Special attack fill (the depleting part) |
| `lcmStatOrbsAnchor` / `lcmStatOrbsOffset` | anchor name + buffer-px offset | unset | written by the drag layer ONLY |
| `lcmStatOrbsSpecAnchor` / `lcmStatOrbsSpecOffset` | anchor name + buffer-px offset | unset | the spec orb's own spot — written by the drag layer ONLY |

The grey palette of a weapon without a special attack is deliberately **not** a setting:
it is the "you cannot spend this" state, not a look. The `statOrbsNumberScale` slider
writes its raw float (the default slider write rounds, which would pin every half step to
the whole one below it).

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
into the game viewport, which is a different buffer entirely. The 8th element is the
**overhang** `[ORB_STRIP_W, 0, 0, 0]`: the stone strip the mod paints itself means the
box may hang 34px out of the widget on the left, and the drag layer has to clamp and snap
against the same wall the owner does. Only the clamp and the snap targets widen — the
anchor points and the stored offsets stay the region's, so **no existing dragged position
shifts meaning** when the overhang is added.

The panel drags a ghost box and writes the keys; this mod only ever **reads** them
(rule 5). Since the orbs are painted from those keys on every frame, the drag layer
writes them **as the pointer moves** (not just on release), which is what makes the orbs
follow the cursor instead of waiting for the drop; the snap still lands on release, and
Escape or a window blur restores the keys the drag started with. The ghost over a canvas
surface is a bare dashed outline, because the real orbs are moving underneath it.
Reset comes from the drag layer too — the panel's *Reset position* row calls
`window.lcmAnchor.reset('stat-orbs')`, which is the same code path as Alt+right-click. The
**spec orb** registers a second canvas surface on the same region and overhang
(`stat-orbs-spec`), whose bounds are a closure over the same layout, so the panel
hit-tests and drags it exactly like the column while it needs no new `bundle.ts` reserve.

Two traps found while wiring this up, both now fixed platform-wide:

- **A runtime string must never be an object-literal key in bundled code.** The anchor
  names ('MC'…) are stored in localStorage, and terser's property mangler renames
  object-literal keys, so `ORB_ANCH['MC']` shipped as `SD["MC"]` against a renamed
  `{av: …}`: every lookup missed and the orbs could never move. The table is now two
  parallel arrays matched by index (the same fix as `xp-drops`).
- **`hitCanvasSpec` compared against `.right`/`.bottom` on a plain object**, so the
  canvas hit test could never match at all — alt-drag on a canvas surface was dead.

## Deliberate divergences and limits

- **The orbs ride the minimap widget, not a DOM overlay.** Their own canvas is the
  172×156 buffer, so 34px of the sidebar's stone left of it (the strip this mod paints)
  is the entire freedom they have outside the panel: the rest of the sidebar, the chatbox
  and the letterbox are out of reach, and so is the game world — that would mean drawing
  over live terrain every frame, and on a gpu frame the world is not in any buffer a mod
  can read. It is why the drag layer clamps canvas surfaces flush instead of leaving a
  margin. The quick-prayer book lives inside the widget buffer and is positioned from the
  orbs, not dragged.
- **The middle orb's rim overlaps the map's left edge** by a few px at the default size
  (and more at 28px). That is where OSRS's orbs sit too — they are mounted over the
  panel's inner edge — and the numbers are what force the column that far right.
- **The wipe is content-keyed, not per-frame.** Moving, resizing, recolouring, a changed
  readout, the number scale, the spec orb's percentage (or its weapon state, which
  recolours it), the book opening or closing, a prayer toggling, the prayer level unlocking
  an icon, or the cursor crossing onto another cell all re-plot the mapback once. While
  nothing changes, no wipe runs at all.
- **The spec orb is not a fourth stat.** It is special attack energy — 2004Scape's own
  `sa_energy` varp, read off the combat interface's spec bar — and it is a *separate
  surface* from the column: a bit bigger, at the panel's bottom left, with its own drag and
  its own reset. Its percentage is always drawn inside it, and it has no click action.
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
- Verified **headlessly, against the applied tree's own copy**: the run orb's **bolt** is
  a complete 7x7 and rasters (it drew nothing at all before the 49-character fix), the
  spec bar resolves off a combat_axe-shaped interface, the spec orb's box clears the
  column and the wiki button at every size, and the half-step ladder's metrics and rasters
  (see the harness line below).
- **Still to be looked at in-game** — the one thing a headless harness cannot answer:
  how the bolt reads at 1x and at the larger sizes, how the spec orb's red/green and grey
  states look against the stone and the map, and whether each of the five number sizes is
  worth its own notch.
- Alt+drag moves the column and writes the keys; the position survives a full reload;
  `lcmAnchor.reset('stat-orbs')` (and therefore the panel row) puts it back to the
  default box `[0, 34, 36, 120]`; the ghost box and the drawn orbs agree. Same for
  `lcmAnchor.reset('stat-orbs-spec')` and the spec orb's own default `[40, 128, 26, 26]`.
- **The stone strip is NOT yet verified in-game** — everything below about it is headless
  and static (the harness, the byte-compare, the bundle grep). What needs an eye in the
  client: that the strip's stone matches the sidebar with no seam at canvas 516 or at the
  widget's edge at 550, that an orb straddling the join is whole (not clipped or
  doubled), that the numbers really can be pushed flush against the sidebar's edge and no
  further, that dragging back out of the strip leaves no orb pixels behind on the stone,
  and that switching the mod off with the orbs in the strip clears it.
- The panel's mod view lists all fourteen rows with the right kinds, and the master switch
  gates them.
- `bun run mods/stat-orbs/tools/stat_orbs_test.ts` — 164 checks over the shipped core:
  the settings clamp table and the half-step ladder; the readout geometry at every scale
  (including the 1x expression being digit-for-digit the old one, and the ladder never
  shrinking); the font rasters (1x/2x/3x exactly the 3x5 table block for block, 1.5x/2.5x
  exactly the 4x7 one, and a stroke weight of 1/1/2/2/3 across the ladder); the orb marks
  all being complete 7x7s, with a one-character-off mark refused (the empty-orb bug) and
  the bolt's bar on its middle row; the prayer book resolving off 289's own prayer.if
  geometry, in book order, with the right varps, click ids and per-prayer icons, and
  refusing non-consecutive varps / a missing icon / misaligned icons / a renumbered
  interface; the run pair resolving off the run varp and never off the retaliate varp; the
  spec bar resolving off a combat_axe-shaped interface (varp, maximum off the bar's own
  top threshold, the hidden layer as "no special attack", the percentage maths) and
  refusing uneven thresholds, a single segment, a non-pushvar segment, an `eq` bar, a
  missing tree, and a shorter decoy bar; the panel's box, its fifteen cells and its hit
  test; and the spec orb's box, its distance from the column and the wiki button, its disc
  hit test and its inside-number scale; and the stone strip's geometry against the
  widget's (`ORB_STRIP_X + ORB_STRIP_W == ORB_ORIGIN_X`, the strip exactly the widget's
  height) with the placement clamp around it — the shipped default spot untouched, the
  strip's far edge reachable and the wall, the widget's right/bottom edges still walls,
  and `statOrbsInStrip` deciding the strip's paint (checked at both boxes' positions).
- `tsc -p tsconfig.json` clean on the applied tree, and the built `client.js` carries the
  new keys, the bolt's digits, and the two overhang registrations (`34,0,0,0`).
- The overlay's acceptance harness (pristine clones at the pins, byte-compare against
  the live install, converge round-trip) and `tools/matrix.mjs` over every declared
  revision.
