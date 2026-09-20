# mods/xp-drops

OSRS-style XP feedback: a floating `+N` row per gain (with the skill's icon) and a tan
level-progress tracker in the viewport's top-right corner that auto-hides when you stop
gaining. The player notices it the moment they train anything.

TYPE B, **8 hunks in ONE file** — `webclient/src/client/Client.ts` (corpus `289`;
**274 inherits** it byte-for-byte; **not ported to 254**, which has no corpus for this
mod). No payload: all of it is hunks, so `mods/xp-drops/tools/` is empty by design — the
mod's logic is drawing geometry, and its real test is a live client (see §Verification).

## Where it draws, and why

Everything renders **into the 512×334 `areaGame` game buffer**, at the top of
`entityOverlays()` — the same ride as the hitbars, so the crosshair, private messages,
modals and the right-click minimenu all composite ON TOP of it later in the same buffer,
exactly like OSRS. It can never float over an interface, and opening a menu no longer
blanks the tracker (an earlier version drew in `gameDrawMain` and the menu wiped it).

```
XP_DROP_X      = 508      right edge of a row (buffer x, flush with the panel text)
XP_DROP_BOTTOM = 276      y a fresh row appears at
XP_DROP_TOP    = 56       y a row retires at (just below the panel)
XP_DROP_STEP   = 15       min vertical gap between live rows
XP_DROP_SPEED  = 1.0      px per client cycle upward (loopCycle ≈52/s → ≈4.2s of life)
XP_HIDE_MS     = 6000     auto-hide after this long with no gain
XP_BURST_MS    = 1000     gains this close merge into one tracked burst (xpRates)
XP_PANEL_*     150×40 at buffer (362, 2) — the tracker, tan 0x8a7454 / border 0x4e3f27
```

Skill icons are the client's own `staticons` sprites (`Pix8.depack(media, 'staticons', i)`
for skills 0–17 plus `staticons2` 0), depacked once into `xpStaticons[]` and mapped by
`xpSkillLabel()`/the icon index — no hand-drawn art.

**Login vs gain.** A row appears only for a real gain: the hook compares the incoming xp
against the stored value (`xp > stored` = drop; equal or below = login baseline, silent).
A fresh session (world hop / re-login) resets `xpLastSkill = -1` and zeroes `xpRates`, so
an offline-trained jump is never replayed as a burst of drops.

## Settings contract

| key | who writes it | meaning |
|---|---|---|
| `xpDrops` | the F1 panel's master switch | on/off. Read **per frame** at the mod's own hook (`getItem('xpDrops') !== 'false'`), so unset or junk means ON and only the literal `false` turns it off. |
| `lcmXpTrackerAnchor` | the panel's alt-drag layer ONLY | anchor name (one of `TL TC TR ML MC MR BL BC BR`), default `TR` |
| `lcmXpTrackerOffset` | the panel's alt-drag layer ONLY | px offset inside that anchor rect, default `-152,2` |

The mod **reads** its placement keys every frame in `xpAnchorFrame()` (rule 5: the drag
layer is the only writer, the owner only reads) and derives the drop band from the panel's
own edges, so rows follow the tracker wherever it is dragged. It publishes its bounds for
the hit test through `window['lcmXpBounds']()` and self-registers the surface with
`lcmAnchor.registerCanvas(['xp-tracker', …])` — positional args, because object literals
across the bundle boundary arrive key-mangled.

**The anchor table is POSITIONAL on purpose.** `XP_ANCH_NAMES` and `XP_ANCH` are two
parallel arrays matched by `indexOf`, never an object keyed by the anchor name: terser's
property mangler renames object-literal KEYS, so a table keyed by a value that arrives at
runtime (`XP_ANCH['MC']`) ships renamed and every lookup misses — which is exactly what
made both canvas placement surfaces unplaceable until it was found. Do not "tidy" this
into an object.

Panel row: a single toggle (`MOD_REGISTRY`, master key `xpDrops`, default on) — this mod
has no other settings, so it has no `MODS` rows and no per-mod view.

## Verification

There is no bun harness: what this mod does is draw pixels and read three keys, and the
honest test is a live client — check a gain (row + icon + tracker bar), a burst, the
auto-hide, alt-drag placement + reload persistence, and that an open minimenu/interface
does not clip the tracker. `LCLITE_ROOT=<install> node tools/doctor.mjs` covers the hunk
side (8/8 applied, no overlaps), and `node tools/matrix.mjs` proves 274 still takes the
corpus.
