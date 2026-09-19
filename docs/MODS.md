# Writing LCLite mods

lclite is deliberately two kinds of mod, because the engine underneath is a compiled
TypeScript bundle while this overlay is plain web files. Pick the kind you need:

```
TYPE A — ui mod            panel mods, DOM stuff, no engine code changes
TYPE B — engine mod       anything that touches the game client's internals (camera,
                          renderer, input, packets, interfaces)
```

> **Revisions.** A mod ships one corpus per revision it supports:
> `mods/<mod>/patches/<rev>/`, declared in `revs.json` and verified by
> `tools/matrix.mjs`. This document is about *authoring* a mod, and it is written for
> the **primary** revision — the one mods are written on and regenerated against. The
> revision model itself, and how a mod is ported to another revision, live in
> [REVS.md](REVS.md).

---

## TYPE A — UI-only mod (start here if you can)

The panel shows ONE mod at a time (RuneLite's plugin-list-then-config shape): a
**list** (one row per installed mod: name + description + master switch, favorites
pinned to the top) and, when you click a row or its gear, that mod's own view —
its row again with its settings under it and nothing else. The header's back
chevron (or Esc) returns to the list. A pin button in the header keeps the panel
open through in-game clicks. Everything is driven by two registries in `panel.js`:

1. Add the mod's row to `MODS` (or nothing, if it's a single toggle — see below):

```js
{
    id: 'my-mod',                 // unique
    mod: 'my-mod',                // the mods/<folder> this row belongs to —
                                  // that's what puts it in that mod's view
    name: 'My mod',               // row title (the ONLY visible text on the row)
    desc: 'One line for the mod list.',  // hover tooltip on the title + searchable text
    kind: 'toggle',                   // 'toggle' | 'slider' | 'select' | 'action'
    key: 'myMod',                 // the localStorage key — your settings bus!
    def: 'false'                      // default value as string
}
```

2. **Single-toggle mods need no MODS row at all.** If the whole mod is one
   on/off, give it just a `MOD_REGISTRY` entry — its master switch IS the setting:

```js
{ id: 'my-mod', name: 'My mod', desc: 'One line for the Mods tab.',
  master: { key: 'myMod', def: 'false' } }      // the engine's own localStorage key
```

`master` should be the SAME key the engine mod reads at its own hook site — no
separate on/off state. Only multi-setting mods need a master key beyond their
rows, and only camera has those today: its master `camera` is honored inside
`applyCameraSettings()` (off ⇒ vanilla camera + zoom 1×). If you add a second
multi-setting mod, give its master the same treatment in its own hook site —
do NOT route it through another mod.

A mod folder missing from `MOD_REGISTRY` still appears in the panel: the mod list
is derived from `installed.json`, and unknown mods get a synthesized row
(name = folder name, desc = joined row descs, master = the single toggle row's
key when exactly one exists). Add the real `MOD_REGISTRY` entry when you care about
the label.

Rows are single-line: `desc` is not subtext — `panel.js` surfaces it as a shared
hover tooltip (`[data-tip]` → `#lclite-tip`, anchored left of the panel) and folds it
into the row's `data-name` so search matches on it too. Keep `desc` a real sentence.

Kinds:
- **toggle** — sliding switch; writes `'true'/'false'` to `localStorage[key]`.
- **slider** — needs `min/max/step/def`, optional `get()` (live value) and `apply(v)`;
  the camera-zoom slider is the reference.
- **select** — `options: [['val','Label'], ...]`, optional `get()`, `apply(v)`.
- **action** — `run()` fires on click (see Fullscreen/screenshot rows); optional
  `btn: 'Open'` overrides the button label (default "Run") for actions that read
  better as a verb.

Every mod gets a toast automatically. New settings **only** via localStorage keys —
that's the durable contract with the game (see "The contract" below).

Re-copy into the tree and you're done (no rebuild for panel changes):

```
node tools/lclite.mjs apply     # rewrites engine/public/lclite/*
```

---

## TYPE B — Engine mod (needs a TypeScript patch)

Anything that changes what the client *does* (drawing, input, packets, camera) must be
patched into the `webclient`/`engine` TS sources and rebuilt — the runtime cannot reach
into the minified bundle. The pipeline exists so you author normal TS, then snapshot it
as anchor hunks:

### 1. Work in the live tree
Edit `webclient/src/...` directly (git-tracked — commit often). The client is one
11k-line `Client.ts`; mods are method-sized edits, e.g.:

| Want to…                         | Hook lives around…                                  |
|----------------------------------|-----------------------------------------------------|
| draw over the game viewport      | `gameDrawMain()` → after `world.renderAll`, before `areaGame.draw()` |
| hide/reveal whole levels (roofs) | `Client.roofCheck()` — its return value IS `renderAll`'s `maxLevel` (see `mods/hide-roofs`) |
| low detail (untextured ground)   | `World.lowMem` (read per ground triangle) · `Pix3D.lowMem` (**unpack-time only**) · `ClientBuild.lowMem` (scene build) — `mods/low-detail` |
| change what a left click does    | `Client.mouseLoop()` — the `doAction(menuNumEntries - 1)` dispatch, and the item-drag setup just above it (`mods/shift-drop`) |
| highlight the tile under the mouse | `World`'s OWN ground pick: `renderQuickGround()` / `renderGround()` test `World.click` + `insideTriangle` per front-facing ground triangle while drawing back-to-front, so the last hit is the nearest tile. Arm your own pixel beside it (`mods/hover-tile`: fields by `groundX`, three pick sites, arm in `gameDrawMain` before `renderAll`, draw after `coordArrow`) |
| label ground items | the client's own `groundObj[level][x][z]` `ClientObj` lists (what its right-click menu and minimap dots walk) + `getOverlayPos` for the position. Draw at the END of `entityOverlays()` — still the areaGame buffer, still before `otherOverlays()` composites the interfaces; a click on your own label boxes is consumed at the TOP of `mouseLoop()` (`mods/ground-items`) |
| overlay ON TOP of the interface  | end of `minimapDraw()` — Pix2D is bound to the 172x156 `areaMap` widget, composited over the sidebar every tick (stat orbs live here). NB: widget stone is painted once at boot — draw OPAQUE only, or repaint mapback to wipe. Second option, and the one to pick if another mod already paints here: `gameDraw()` right after `this.areaMap?.draw(550, 4)`, binding the widget yourself (`this.areaMap?.setPixels()` … restore the previous `Pix2D.pixels/width/height`) — you paint AFTER the composite (one frame of latency) and therefore after every other mod's wipe, so neither side can flicker the other (`mods/wiki-lookup`'s button) |
| make your menu row the LEFT-CLICK default | write it over `menuNumEntries - 1` in a hook that runs AFTER `buildMinimenu()`'s sort: the sort walks every `>1000` row toward `Cancel`, so a row written before it sinks out of the top slot (`mods/wiki-lookup`'s armed `Lookup <target>` row, and its second `buildMinimenu` hook site) |
| add/replace sidebar UI           | `drawSide()` (~line 11192), stat values: `this.stats[s].base` (HP=3, Prayer=5), `this.runenergy`, redraw flag `redrawSide` |
| react to input before the engine | `GameShell` handlers (see wheel zoom, ~line 300) |
| claim/modify keyboard input     | `GameShell.onkeydown`/`onkeyup` call the `hotkeyKeyDown`/`hotkeyKeyUp` hooks (both no-op by default) *before* the engine's key queue — `mods/hotkeys`. Two traps: `onkeydown`/`onkeyup` are private (hence the hooks), and any input mod MUST stand down while `Client.ingame` is false or it eats the login screen's username/password keys. Interface data (`IfType.list[].children`) can also still be unloaded on the first hook call — tolerate nulls |
| change packets/camera reporting  | `gameLoop`/input sections near `EVENT_CAMERA_POSITION` |
| tile/3D rendering behavior       | `dash3d/World.ts` (visibility/draw window), `Pix3D.ts` (raster), `Model.ts` |
| config-driven visuals (orbs, etc)| `config/IfType.ts` + `drawInterface`, or direct Pix2D like camera zoom does |

### 2. Dev-test fast
```
cd webclient && <bun> run bundle.ts dev   # unmangled names → window.lostcityClient.<field>
cp out/client.js ../engine/public/client/client.js
```
Then in the browser console you can poke real fields (`window.lostcityClient.cameraZoom`
etc.). Use `bundle.ts` (prod) only for final builds.

**Pure logic belongs in a `files/` payload, not in the hunk.** Anything a mod does that
does not need client state — a settings parse, a decision table, geometry — ships as
`mods/<mod>/files/webclient/src/...` and is pulled in by ONE import hunk, so a bun harness
can import the REAL shipped file and test it headlessly (`mods/hotkeys`, `mods/gpu`,
`mods/tcg`, `mods/hover-tile`). Two rules that bite: the client's tsconfig has
`verbatimModuleSyntax`, so a payload's `interface` must be imported with `import type` (or
avoided — `const s = mySettings(read)` infers it); and a payload's own cross-realm names
still need their bundle.ts reserve.

**A hook pair that must straddle the render pass takes TWO sites, not one.** Anything that
arms engine state and reads the result back (hover-tile: arm the pick before
`world.renderAll`, draw after it) inserts at both ends of the same call sequence — keep
them ≥3 untouched lines apart so `-U0` gives them separate islands, and put the logic in
methods parked in a pristine gap with only the two call lines in `gameDrawMain()`.

**Ground geometry that reaches beyond its own tile must be drawn on the turn of the tile it
LIES OVER, not on its own tile's turn.** `World.renderAll` draws back-to-front, but as an
axis-aligned square-ring walk around the CAMERA's own tile (`dx`/`dz` from `-viewRadius` to
`0`, outermost ring first, the camera's own tile last) — not a sort by true depth. So a
neighbouring tile that comes later in that walk paints its ground over anything you drew into
it earlier, and WHICH neighbour that is changes with the camera's yaw. `mods/true-tile-plus`
shipped straight into this: a flame is rooted on the true tile's border and reaches outward,
so it lies over the tile next door, and drawing all four edges on the true tile's own turn
showed only 2-3 of them in game. The fix is a per-edge `mask` passed from `fill()`: call the
draw for whichever tile is being painted and emit only the edge that reaches over it. Then the
ground under the decal is already down, that tile's own walls and sprites still come after it
(so they cover it, correctly), and no later tile overlaps the ground the decal sits on.

### 3. Snapshot your edit as hunks
Add the file to `MODS` in `tools/regen.mjs` (new folder = new mod, e.g. `mods/xp-drops`),
then, from the overlay repo:
```
LCLITE_ROOT=<install> node tools/regen.mjs   # rewrites mods/*/patches/<rev>/*.json from git diff
```
(`regen` diffs the tree at `LCLITE_ROOT`; without it the tools look one level above the
overlay — see CONTRIBUTING for its refusals and `--prune`.)
Hunks are `{find:[old lines], replace:[new lines]}` — `find` is the MINIMAL unique
window in the pristine old file (2-line context floor, expanded only while the anchor
is non-unique). If regen warns `AMBIGUOUS`, your hook site's surroundings repeat in the
file — widen your edit to include a unique line rather than fighting the tool. **A hunk's
context floor must also be REVISION-STABLE:** the floor reaches ~2 lines past your
insertion, so a neighbouring revision-specific line lands in `find[]` and the anchor can
only ever match the revision it was authored on — `mods/hover-tile`'s payload import
anchored after `import JagFX …` swallowed `const CLIENT_VERSION = 289;` and silently
expired 274's `inherits` claim (matrix: exact 111, reseat 1). Move the insertion until the
whole window is byte-identical on every revision that inherits, and let `tools/matrix.mjs`
prove it — the failure is invisible to `apply --check`, which only ever tests the tree you
are standing in. When one
file hosts SEVERAL mods (Client.ts does), each added block MUST start with a
`lclite:<mod>` marker (comment form matching the language, `<!-- lclite:mod -->` in
EJS); regen routes by marker with 100% precision and warns loudly on any unmarked
block (legacy regex fallback). **A WRAP-STYLE edit is TWO islands unless you re-indent
the lines you bracketed:** inserting `if (...) {` before existing lines and its `}` after
them leaves the originals untouched in between, so with `-U0` the closing brace lands in
an island with no marker and regen falls back to the regex route — indent the wrapped
lines (they then belong to the change) and the whole block is ONE marked island.
**EJS trap: inside a `<script>` block those
`<!-- ... -->` markers are Annex-B line comments — only a line that STARTS with
`<!--` is a comment, so a multi-line one is a syntax error the browser reports at
load. Use `// lclite:<mod>` for markers and comments inside page script blocks (the
marker regex does not care which comment form it is) and keep `<!-- -->` for the HTML
region.** **Second EJS trap: a template local is a page-breaking coupling.** A local
you add in a render call (`src/web.ts`) and read in the template lives in a DIFFERENT
file, so the two hunks fail independently on rev-upgrade day — and ejs throws
`ReferenceError` on an undefined local, which 500s the whole page rather than
degrading. Guard every read (`<%= typeof revision === 'number' ? revision : '' %>`)
so a half-applied rev renders without the value instead of dying. Same for attributes
(`data-foo="<%= typeof x === 'number' ? x : '' %>"`).** **`-U0` islands merge: an insertion with NO unchanged line between it and
another mod's insertion is one island, and regen reports `MIXED MARKERS <a>,<b>` — the
majority marker wins, so one mod silently swallows the other's hunk. A "natural" hook
site can be unusable for exactly this reason (`Client.mouseDown` has the camera mod's
lines right after `super.mouseDown(...)`, so shift-drop's Shift capture lives in
`pointerDown()` instead). When it fires, move your block to the nearest site with ≥1
untouched line on both sides — never "fix" it by editing the other mod.** The old
≥61-line isolation rule is RETIRED (2026-09-15):
regen now extracts `git diff -U0` islands, so adjacent change blocks stay separate
hunks automatically — but keep hunks' edit sites ≥3 untouched lines apart, and trust
`node tools/lclite.mjs doctor` (exit 3 = a hunk's deletions would break a sibling;
exit 2 = drift — and an overlay with no patch JSONs at all is structural, not "healthy")
anchor). Point doctor at the tree you're patching when this repo isn't inside one
(`LCLITE_ROOT=<install> node tools/doctor.mjs`); with no host tree at all it exits 3
and says so rather than reporting every mod as off.

### 4. Prove it survives
```
# fast form: against the install you are patching (every anchor found, doctor healthy)
LCLITE_ROOT=<install> node tools/lclite.mjs apply --check    # ✗0 on every mod
LCLITE_ROOT=<install> node tools/doctor.mjs                  # exit 0

# strong form: fresh clones at the base revs + apply reproduce your tree byte-for-byte
mkdir -p t && cd t
git clone https://github.com/LostCityRS/Client-TS webclient
git clone https://github.com/LostCityRS/Engine-TS engine
git -C webclient checkout <base-rev> && git -C engine checkout <base-rev>
cp -r .. lclite && cd lclite && node tools/lclite.mjs        # t/ is the host root
# diff every patched file against your live tree — must be empty
```

---

## The contract between panel and engine (keep it boring)

- **Settings bus** = `localStorage` keys. **Each engine mod reads its OWN key at
  its OWN per-frame hook site** — stat-orbs/xp-drops at the top of their draw
  hooks, anti-cheat once at the top of `gameLoop()`, true-tile inside
  `drawTrueTile()`, rendering at the top of `mainloop()` (Pix3D.lowDetail has no
  per-draw anchor), gpu at `Pix2D.cls()`, hide-roofs inside `roofCheck()`,
  low-detail at the top of `gameDrawMain()` (plus once in `setHighMem()` for the
  flags that are decided at load/build time), shift-drop at click time in
  `mouseLoop()`. No mod depends on another mod's
  settings code; a mod's hunks can fail on a new rev without silently killing
  anyone else's toggles. (The old design had camera's `applyCameraSettings()`
  read every mod's key — a hidden hub; that coupling is gone as of the
  true-tile mod. Don't reintroduce it: new TYPE B mod = new key read at the
  mod's own hook, nothing in camera.)
- **The one re-apply entry point** stays `window.lostcityClient.applyCameraSettings()`
  (historic name, terser-reserved; camera-owned keys: wheelZoom, middleRotate,
  wheelScrollChat + the cameraZoom slider which must push `World.setVisZoom`).
  The panel calls it after every toggle as a cheap no-op wake-up; mods that read
  per-frame don't need it. The wheel writes `cameraZoom` back. Names are stable
  strings — they survive minification untouched.
- **Two reserved names** in `webclient/bundle.ts` terser config (patched via
  `mods/control-panel/patches/289/bundle_ts.json`; they *must* stay listed):
  `lostcityClient` (the Client instance, exposed on `window`) and
  `applyCameraSettings` (the re-apply entry point). If your engine mod needs a new
  public method or field the panel touches, add it there too — anything else gets
  mangled to garbage per build.
- **Rule of thumb:** engine mods *write* and *read* localStorage; the panel *renders*
  those keys as controls. No other channel — DOM injection into the canvas, postMessage,
  whatever else all break across revs or stay unmaintained.
- **New mods must degrade gracefully** when absent on some future rev: panel code
  checks `typeof window.lostcityClient?.method === 'function'` before calling, and
  sliders fall back to reading their localStorage key. The panel is a static asset:
  it keeps working (minus the dead control) even if its engine hunk fails to apply.
- **The engine's REVISION is readable at runtime** — `client.ejs` is rendered with
  the engine's own `revision` local (`Environment.engine.revision`, the same value
  the title and the panel's header chip use), so any script tag the page carries can
  stamp it (`data-rev="<%= typeof revision === 'number' ? revision : '' %>"`) and
  both page scripts and BUNDLED code can read it back
  (`document.querySelector('script[data-rev]')`). That is how `mods/tcg` gates its
  card catalog to the build the player is on. Always treat an absent value as "no
  gate"/the old behaviour rather than as revision 0: the tag can be missing on a
  stale engine or a stripped hunk.
- **Page-loaded assets must be VERSION-KEYED** (`ui.js?v=N`, data `?v=N`, bumped
  on every revision you ship). **That includes `panel.js` itself**: its key lives in
  control-panel's own `engine/view/client.ejs` hunk (`/lclite/panel.js?v=N`), so a mod
  that adds panel rows hand-edits that line in the live tree, bumps N, and runs
  `regen` BEFORE `apply` — otherwise a returning player keeps the cached panel and
  their new row is missing (or shows up as the synthesized fallback). express serves
  them with `max-age=0` + ETag, and
  browsers — Brave demonstrably — re-serve stale disk-cache copies of a plain
  path *past hard refreshes*; the bundled core can't see it but the DOM layer is
  then an ancient build (tcg shipped through exactly this: old HUD anchored
  under the FAB looked like a dead mod). The tcg pattern: `?v=` in the ejs tag
  AND in the core's self-heal injection, `window.__lctcgUi` stamp so the core
  detects a stale UI and removes+replaces it. **The stamp must land on the
  SCRIPT TAG too** (`data-lctcg-ui="N"`): the self-heal probes
  `script[data-lctcg-ui]` before injecting, and a `<script src>` that never
  sets the attribute looks "missing" even when it loaded fine — the core then
  injects a SECOND copy and the page boots the mod twice (v6 shipped exactly
  this; ui.js now self-stamps via `document.currentScript` AND the ejs tag
  carries the attribute). Also never `fetch(..., {cache: 'force-cache'})` a mod
  data file — 'no-cache' revalidates and stays 304-cheap. That includes the
  panel's own `installed.json` read: a stale disk copy of that file silently
  GHOSTS a fully working mod from the list (it's the row filter).
- **`installed.json` is derived state — regen BEFORE apply when you hand-edit
  live files.** The list filters rows by `engine/public/lclite/installed.json`,
  which `apply` rebuilds from `modInstalled()` = "every hunk replacement is
  verbatim in the tree". Editing a live file (say, the ejs `?v=` bump) while the
  committed hunk JSON still holds the old text makes that mod read as NOT
  installed — the Mods row disappears although the mod works fine. Fix order is
  always: hand-edit → `node tools/regen.mjs` → `apply` (which then re-verifies
  and re-lists). `apply --check` ✗0 alone does NOT prove the manifest is right.
- **Placement (alt-drag movable overlays) is the one cross-mod WRITE, by
  design.** RuneLite parity: hold **Alt** and drag any movable surface to one of
  9 anchor points plus a px offset; snap dots appear mid-drag; Alt+right-click
  resets a surface; panel → Reset all wipes every `lcm*` key. The anchor RECT
  depends on where the surface is painted: **DOM surfaces** (FAB, panel, tcg
  HUD) anchor to the whole CLIENT WINDOW (browser viewport) — the letterbox
  beside a scaled canvas is valid real estate, exactly where the FAB defaults;
  **canvas-buffer surfaces** anchor inside the buffer they actually paint into,
  which is a REGION the owner declares: `[x, y, w, h, bufferW, bufferH]` in the
  canvas's 765×503 logical space, as the optional 7th element of
  `registerCanvas([...])`. Omit it and you get the game viewport (the 512×334
  `areaGame` buffer at 4,4) — the xp tracker's home; the stat orbs pass the
  minimap widget instead (`[550, 4, 172, 156, 172, 156]`). Either way the buffer
  is a hard boundary: it physically cannot paint into the sidebar/chat/letterbox.
  An 8th optional element widens that boundary for a mod that composites a
  SECOND buffer outside the one it draws into: the OVERHANG
  `[left, right, top, bottom]` as DISTANCES OUTWARD in the same buffer px, which extends the drag's
  clamp and moves the snap targets outward while the ANCHOR POINTS and the
  stored offsets stay the region's (so no saved placement shifts meaning).
  stat-orbs passes `[34, 0, 0, 0]`: it paints the sidebar's own stone strip
  left of the minimap widget into a buffer of its own (see its README), which
  is what lets a dragged orb column hang out of the widget — the first surface
  that can leave its buffer at all, and the reason the ghost's clamp and the
  owner's clamp have to be told the same number.
  The region is measured off the CANVAS ELEMENT (`getBoundingClientRect`), not the
  window — the page centres a scaled 765×503 canvas inside the letterbox, so a
  window-derived rect put every canvas ghost hundreds of px from its pixels. The DRAG LAYER (control-panel's
  panel.js) is the only WRITER of `lcm<Surface>Anchor` / `lcm<Surface>Offset`
  localStorage keys; each surface's OWNER still READS its own keys at its own
  hook (rule 5 untouched — placement is settings-with-a-UI, not a hub). DOM
  surfaces (FAB, tcg HUD) call `window.lcmAnchor.register(spec)` — if the panel
  isn't installed there's simply no drag, and the owner's own read still honors
  the keys. Canvas-buffer surfaces (xp tracker) are the harder kind: the owner
  computes its live origin per frame from the same keys (see `xpAnchorFrame()`
  in Client.ts — anchor + buffer-px offset mapped onto the 512×334 viewport,
  clamped, drop-band derived from the panel edges), exposes bounds for
  hit-testing through a terser-reserved `window['lcmXpBounds']()` returning a
  POSITIONAL `[x,y,w,h]`, and self-registers via
  `lcmAnchor.registerCanvas([...])` (positional args — object literals across
  the bundle boundary arrive key-mangled). The panel never positions canvas
  surfaces itself; it drags a ghost box and, while held, flags
  `window['lcmHeld'] = id` (plus `window['lcmAlt']` while Alt is down) so the
  owner keeps painting the real thing at the live anchor — the ghost and the
  element agree because both derive from the same keys + the same viewport
  rect (`panel.js vpRect()`: canvas × 512/765, 4/765 offset, 334/503).
  **Canvas surfaces are placed LIVE:** the drag layer writes the anchor keys on
  every pointermove (not just on release), because that is what makes a canvas
  surface FOLLOW the cursor — its owner re-reads its own keys every frame, so
  the keys ARE the position. The write is unsnapped (the snap still lands on
  release, where it always did) and the ghost for a canvas surface is a bare
  dashed outline, since a tinted box would sit on top of the thing you are
  placing. Escape and window blur CANCEL a drag: the keys as they were before
  it are restored (and UNSET keys go back to unset) — a half-dragged surface
  must not be left placed.
  A new movable DOM surface = one `register()` call; a new movable canvas
  surface = that same pattern (live origin, bounds fn, registerCanvas + its
  region, reserve the names). Canvas surfaces clamp FLUSH (the panel passes margin
  0 for them, the owner clamps the same way) because their region IS the buffer —
  a 4px margin would just be dead space in a 172px-wide widget.
  **Reset has one writer too:** `window.lcmAnchor.reset(id)` clears a surface's
  keys and re-applies (Alt+right-click calls the same path; `lcm-anchor-reset`
  with the id as detail is the event form), so a panel row or another mod's ui.js
  can offer "put it back" without ever touching the keys itself.
  **TRAP — never key a table by a value that arrives at runtime.** The anchor
  names ('MC', …) are stored in localStorage, and terser's property mangler
  renames object-literal KEYS: `XP_ANCH['MC']` shipped as `YG["MC"]` against a
  renamed `{av: …}`, so every lookup missed and canvas surfaces could never move
  (the hit test had a second, independent bug: it compared `.right`/`.bottom` on
  a plain object). Store names and values as two PARALLEL ARRAYS matched by
  `indexOf` — same positional law as the bundle↔page boundary. `register()` is the ONLY way in: it stamps `data-lcm-surface`
  (the drag hit-test + Alt-outline hook) — a bare push onto the spec list
  leaves the surface invisible to dragging (bit the FAB at first ship).
  Everything clamps inside its anchor rect, so a dragged overlay can never be
  lost off-screen; F1 works regardless of FAB position.
- **The FAB lives at viewport top-right BY DEFAULT** (44px at top:14 right:18,
  z 9000; the panel drops from top:66) — but it is movable (see above), so page
  overlays must not assume that corner is theirs either: tcg's HUD defaults to
  canvas top-left and dodges a relocated FAB automatically. When an overlay
  needs to cover the whole frame, layer above: `z-index > 9500` (snap dots and
  the drag ghost ride at 9700, above tcg's 9600 chrome).

## Rev-upgrade day, the short version

Since the launcher handles installs, "rev-upgrade day" is usually just its
**Update from GitHub** button: it fast-forwards client + engine + content, re-applies
your mods, rebuilds, and reports any failing anchor. By hand, in an install (or a
checkout of your own):

1. commit modded trees (`git -C <install>/webclient add -A && …`) — safety net for
   manual reseating (never on the tracked upstream branch itself)
2. `git -C <install>/<repo> pull` per repo, or switch revision in the launcher
3. `LCLITE_ROOT=<install> node tools/lclite.mjs` → clean? build+play. Failing hunks?
   each prints `anchor not found` / `ambiguous` + the file and old-line number — open
   that patch JSON, find where the `find:` lines moved in the new upstream, reseat, rerun.
4. `LCLITE_ROOT=<install> node tools/regen.mjs` when you've since polished the edits in-tree.
   Note: installs cloned by the launcher are **shallow**, so regen/doctor can't resolve
   the old pinned commit there — a pin that is simply older than HEAD is a note, not drift.

## TYPE C blueprint — visual entities (model overrides, fake NPCs)

Researched against bd6cad7 (2026-09-15). The engine's rendering model is friendly here:
models are *derived* from data every frame, so client-side visuals can lie safely.

**Worn items / player appearance** — `ClientPlayer.appearance` is a `Uint16Array(12)`
decoded from the wire; `getTempModel2()` rebuilds the combined model each frame from
those slot IDs (body ≥256, equipment `slot-512` → ObjType). Override **at the model
getter, not the field**: `appearance[]` is re-decoded on every appearance-update
packet, so field writes get stomped; a `getTempModel2` prototype-patch from files/
code (gpu-style, ONE import hunk) survives. Precedent in-tree: transmog already
replaces the entity model wholesale (`this.transmog.getTempModel(...)` at
ClientPlayer.ts ~426) — proven to compose with anims/spotanims/picking. Other
players see vanilla (local-visual lie, same as RuneLite model swaps).

**Fake NPCs** — do NOT insert into `npc[]`/`npcCount`: the server update loop owns
those (assigns entries, area-clear resets). Keep a parallel `fakeNpcs[]` and hook
the four places that iterate entities: draw loop (~Client.ts 4947, `index < playerCount
+ npcCount`), entity sort/depth, picking (`World.click`/`mouseCheck` resolution), and
tick/cull (despawn on teleport/area change). Everything else (spawn API, menu actions
via MiniMenuAction, despawn rules) is files/ code. Limits: no server gameplay (no
talk/attack resolution, no collision) — decorative/marker NPCs only. For YOUR OWN
server, a real engine-side NPC with normal update packets is the better lane; TYPE C
is for other people's servers and pure-local cosmetics.

---

## Authoring for distribution (a mod folder others can install)

A third-party lclite mod IS just a folder — no new framework:
1. `mods/<name>/patches/<rev>/*.json` hunks, every added block marker-first (`lclite:<mod>`).
2. optional `files/` payload (copied verbatim; stripped only if unedited).
3. optional panel row (MOD_REGISTRY entry in control-panel's panel.js — or rely on the
   synthesized row; ship the row as your own files/ copy if you want rich UI).
4. namespaced your keys: `localStorage` names prefixed with your mod (camelCase);
   read them at YOUR hook site, per frame.
5. degrade gracefully: `typeof window.lostcityClient?.foo === 'function'` before any
   engine call; fall back when a cache pack lacks icons/sprites.
6. target a host with `root.json` (repo dirs/remotes) — patch JSONs reseat per host;
   hunks against Lost City apply as-is to revs near the pinned `generated_from.head`.
7. one name, one description: add your `MOD_META` entry in `tools/lib.mjs` (the
   launcher and the CLI picker read `label`/`desc` from there) and make it read
   exactly like your F1 panel row (`MOD_REGISTRY` in control-panel's panel.js).
   Two lists with two wordings is how a mod ends up "Low detail option" in one
   place and "Low detail" in the other; `node tools/doctor.mjs` prints a note
   when they drift.

Distributing = publishing a repo with this layout; users point `LCLITE_ROOT` at it or
drop it beside their repos like any other overlay. A mods *registry* is deliberately
NOT a thing yet — folders + git remotes are enough until someone installs one.

## Ideas register (parking lot)

- [x] wheel zoom + middle-drag rotate + one-shot walk pick + far-plane/viewRadius fix — `mods/camera`
- [x] anti-cheat/telemetry suppression toggle — `mods/anti-cheat` (split out of camera 2026-09-09)
- [x] smooth-shading option (Pix3D/ObjType save-restore) — `mods/rendering` (split out of camera 2026-09-09) — **REMOVED 2026-09-18: superseded by the GPU mod's own smooth path and no longer worth a mod slot.** Deleting it stripped its 3 hunks (the per-frame `smoothShading` read in Client.ts + the two ObjType.ts save/restore hunks), which returned `webclient/src/config/ObjType.ts` to pristine — nothing else patches that file now, so it is no longer diffed by regen at all.
- [x] HP/Prayer/Run orbs — SHIPPED (`mods/stat-orbs`, split out of camera 2026-09-09; **rebuilt as a full settings+placement mod 2026-09-18** — see `mods/stat-orbs/README.md` for the complete contract, this is the register entry). TYPE B, ~330 lines in Client.ts across 4 hunks: fields + `orbLayout`/`drawStatOrbs`/`drawOrb`/`drawOrbNumber`/colour helpers in ONE isolated slot before `gameDraw()`, plus three `minimapDraw` hooks (top = master-key read + off-wipe, the `minimapState==2` branch, and the tail). They paint into the 172x156 `areaMap` widget buffer (composited at canvas 550,4), which is the minimap's own ride: ON TOP of the interface, survives modals, and the gpu mod's HUD upload picks them up. **Layout is derived from that buffer's real geometry**: the rotating map window is the 146x151 rect at (25,5) and the compass owns (0,0)-(32,32), so the free stone is the x<25 strip below the compass; the column sits at `orbLeft = 14` (three 4px digits + a 2px gap fill x 0-11), spreads evenly down y 34-154 (`step = 60 - r`, so the group is always 120px tall), and only the middle orb's rim grazes the map's left edge. **Numbers go to the LEFT of each orb, OSRS-style** — and that is why the readouts use a hand-rolled 3x5 pixel font (`ORB_DIGITS`, 1px black shadow): no 2004 font fits there (p12 digits are 6px wide plus a shadow, so three of them are 18px against a 25px strip). **Art rules** (the previous pass read as modern vector art): hard 1px black outline, a 2px metal rim lit on the top half / shadowed below, a dark glass body, the fill in three HARD shading bands plus a 1px meniscus (liquid level, OSRS-style) or a clockwise pie sweep from 12 o'clock, a 7x7 glyph (heart / four-point star / boot) with a 1px outline, and the 2004 gloss glint as a small rounded blob. Every pixel is opaque: the stone strip is painted once at boot, so an alpha blend there would accumulate and darken every tick. **Settings** (all this mod's OWN keys, read per frame at its own hook — rule 5): `statOrbs` master, `statOrbsSize` 20-28px, `statOrbsNumbers` left|inside|hidden, `statOrbsFill` liquid|pie, `statOrbsPulse` (OSRS low-HP flash), `statOrbsHpColor`/`statOrbsPrayerColor`/`statOrbsRunColor`; panel rows for all eight (size slider, two selects, a toggle, three colour swatches, and a *Reset position* action). **Placement**: a canvas-buffer surface — `drawStatOrbs` self-registers via `lcmAnchor.registerCanvas([...])`, publishing `window['lcmStatOrbsBounds']()` (reserved in bundle.ts) and passing the NEW optional 7th element: the REGION descriptor `[550, 4, 172, 156, 172, 156]`, i.e. the minimap widget's rect in the canvas's 765x503 space plus that buffer's pixel size. The drag layer writes `lcmStatOrbsAnchor`/`lcmStatOrbsOffset`, the owner only reads them; the panel's reset row calls `lcmAnchor.reset('stat-orbs')`. **Stale-pixel wipe is content-keyed**: the layout signature includes the readout VALUES, because a changed value changes the glyph count and colour (100 -> 45 would otherwise leave a stale third digit) — the mapback is re-plotted once per real change (its map window is a transparent hole, so the map is untouched and `minimapDraw` re-blits it the same tick). Live-verified: the meniscus row at 50%, the pie boundary at the centre column, all three glyphs, the tiny-font digits pixel-for-pixel, alt-drag + reload persistence + reset, and the panel rows.
- [x] OSRS-style true tile — SHIPPED (`mods/true-tile`, TYPE B). Green outline on the tile the SERVER has the player on: `localPlayer.routeX/routeZ[0]` — the head of the 10-deep move queue that `getPlayerPosLocal` pushes local move codes into (same value the engine's own teleport/reset paths snap to), vs `player.x/z` the model lerps toward via `routeMove` (trails up to a tick, worst-case a full tile + run interpolation). Corners `(t<<7, t<<7)..+128` projected through `getOverlayPos` (height 0 → `getAvH` per corner, so the square shears correctly on slopes/stairs and hides off-camera/out-of-area like every overlay); drawn from `coordArrow()` (runs every frame in gameDrawMain right after entityOverlays, Pix2D bound to areaGame → the GPU mod's HUD composite uploads it like hitbars/chat, interfaces paint over later via otherOverlays). Methods parked in the pristine gap after `getOverlayPos` (>200 lines from any other mod's hunks — the coordArrow call sits ~65 lines clear of the anti-cheat cyclelogic5 guard); no fields — reads its OWN localStorage keys every frame (gpu pattern), all settings live with no reload. CUSTOMIZATION SHIPPED (RuneLite Tile Marking parity): rasterized as a convex-quad edge-function pass (centroid-normalized so vertex order/CW-CCW don't matter; s_i = len_i × perpendicular px distance ⇒ uniform border at ANY skew) — keys: `trueTile` master, `trueTileColor` '#rrggbb' (default 00ff00; engine validates 7-char #hex), `trueTileOutline` 1–8px solid border, `trueTileFill` 0–100% translucent interior (Pix2D hlineTrans integer-mix in-place), `trueTileOnlyDesync` hide-while-model-tile==server-tile (RuneLite "hidden" behaviour). Panel: master on Mods tab + Settings section (color swatch row, two unit sliders px/%, desync toggle) — panel grew `kind:'color'` rows and unit-labelled sliders (defaults now write `LS[f.key]` when no custom apply). Bresenham line helper removed (edge-pass supersedes it). Tunables verified headless (t/true_tile_raster_test.cjs: uniform runs at T=3, fill/border split, vertex-order independence). Also decoupled the settings hub while adding it: stat-orbs/xp-drops/anti-cheat/rendering keys now read at their own hook sites (see "The contract" — camera's applyCameraSettings is camera-only now). **REWORKED 2026-09-18 — the decal is GROUND GEOMETRY now** (drawn on the true tile's own turn in `World.fill()`, between that tile's ground and its walls/sprites), so the player's model and everything else drawn later covers it — the RuneLite "square under your character" reading, instead of the old over-the-feet pass from `coordArrow()`. The same rework fixes the fill on a gpu frame: the mod emits Pix3D triangles carrying `Pix3D.trans` (both the software raster's destination weight AND the gpu mod's per-triangle capture alpha), where the old in-place Pix2D blend mixed against the sentinel-cleared buffer and was then painted opaque by the HUD overlay ("a darker green that lightens as the fill rises"). Shape now: 1 Client.ts hunk (the arm call before `renderAll` — the client only hands World the server tile, the model tile and the level) + 3 World.ts hunks (the payload import; the armed state + `World.trueTileArm`/`trueTileDecal` parked after `removeSprites()`; the one `fill()` call) + the new pure payload `files/webclient/src/dash3d/TrueTile.ts` (settings parse + mitred-ring geometry, emit-injected so it is harness-testable) + `mods/true-tile/tools/true_tile_test.ts` (103 checks, including parity against this mod's OWN previous per-pixel rasterizer, kept in the harness as the oracle). The settings contract is UNCHANGED (all five keys), so the panel needed no edit. `254` still carries the pre-rework corpus — porting it needs that tree re-synced first (2 of tcg's 254 hunks no longer anchor). See `mods/true-tile/README.md`.
- [x] **TCG card packs (OSRS TCG plugin parity) — SHIPPED 2026-09-15** (`mods/tcg/`, TYPE B+A). Design port of Azderi/osrs-tcg beta (BSD-2): credits from play (100c per 1,000 xp + level-up curve 1,250→25,000 @ steepness 2.5), 2,500c Standard Pack, 5 pulls, 7 tiers with the beta's cumulative roll odds (0.66/2/4/8/16/32/37.34), score = max(value, level²[×1.5 monster]), per-category percentile tiering + score/value tie-unification + global value lift + low-value(≤1)→Common, 1% foils, 1/3000 apex packs (top-3 tiers, 5× foil, ≥1 foil guaranteed), dup sell-back max(10, round(score)/200) keep-one. 6,376-card catalog (wiki Card.json data, art = OSRS wiki CDN 130px thumbs, lazy-loaded). ARCHITECTURE: core = files/ TS bundled via ONE import hunk (gpu pattern) + ui.js = page script via client.ejs hunk (panel pattern) + cards.json static. THE TERSER LESSON (cost hours, now law): the property mangler rewrites string-literal KEY definitions too — `W['tcgInfo']=…` inside the bundle becomes `W.Xk=…`, so (a) every cross-realm name needs a bundle.ts reserve (tcg hunk) AND (b) every cross-realm VALUE must be a POSITIONAL ARRAY, never an object literal (info()/albumRows()/catalogMeta()/pulls/save all arrays; index maps documented in tcg_core.ts header). localStorage saves are positional for the same reason — quoted keys would mangle per-build and orphan every collection. Login settle: tcgSetAccount opens a 5s rebase window (offline-trained jumps and the login burst never retro-pay; the UPDATE_STAT hunk is an unconditional `window['tcgOnXp']?.(stat,xp)` — the core owns all dedupe against its saved baseline). ::tcg chat command (album; staff≥2: give/roll) intercepted BEFORE the CLIENT_CHEAT passthrough. Panel: MOD_REGISTRY entry with live status + master key `tcg` (default on). Harness: `bun run ../lclite/mods/tcg/tools/tcg_test.ts` from webclient/ — 48 checks incl. 2,000-pull odds distribution vs beta and seed-replay determinism. NOT ported (deliberate): party/trading/webhooks/safe-mode/save-restore. KILL CREDITS SHIPPED 2026-09-15 (the obvious next pass, done): credits = npc combat level, client-detected — local-player FACEENTITY (getPlayerPosDecodeExtended) marks engagement (beta InteractingChanged parity: targeting counts, so one-shots credit), BOTH npc hitsplat updates (HITMARK + HITMARK2, twin hunks — anchor on the trailing ANIM vs CHANGETYPE `if` since the blocks themselves are identical) carry health, `hp===0` is the death; `tcgNpcHit` pays iff engaged within ~7.2s (beta 12 ticks ≈ 400 loopCycles @52/s), re-stamps the window on a paid death (respawn farming: no fresh FACEENTITY arrives on auto-retarget) behind a ~2s re-grace vs corpse re-emits, and dies with the settle window (login mid-combat never retro-pays). This client's hitsplats are broadcast without ownership, so assisting someone else's kill credits — friendlier than beta, accepted. Level source chain: `NpcType.vislevel` (2004 defs often omit it) → OSRS card level by name key → full-hp proxy → 1. XP chunks now SKIP the 5 combat stats (beta COMBAT_SKILLS: attack/defence/strength/ranged/magic earn via kills; hitpoints/prayer still chunk — level-up bonuses still pay everywhere). info() grew [15] killCredits [16] killCount (positional, additive = old saves fine); save stats grew [7]/[8] (also append-only). UI v4 (?v=4 both sides). TWO FIELD FIXES after ship (user testing): HUD was viewport-top-right = under the LCLite FAB (clicks stolen, reveal behind panel chrome) — re-anchored to the canvas top-left per tick, layer z 1200→9600, and ::tcg got a visible 'engine not loaded' chat fallback instead of silent no-op; then Brave served a stale cached ui.js/cards.json past hard-refresh making it look unfixed — all page assets now version-keyed ?v=3 with the core stamp-check + self-heal described in The contract. Both lessons are the bullet points, not this paragraph — read those before shipping a DOM-layer mod. SETTINGS PASS + LOGIN GATE (2026-09-18, UI v8): the mod grew a real settings view (4 HUD toggles — box, credits, rate, progress — plus 2 action rows) and the HUD stopped drawing on the login screen. The gate is `window['tcgLoggedIn']()`, which reads `Client.ingame` from INSIDE the bundle (new reserve in the tcg island): a PAGE script reading the bundled property directly is the read-side of the terser trap — an unmangled name compared against the mangler's rename is silently wrong — while a bundled read is consistent by construction and needs NO new Client.ts hunk, so logout/disconnect/lostCon/failed-login are all covered for free. Fail-open when the accessor is missing (camera stripped ⇒ no window.lostcityClient), so a half-updated install keeps its old HUD instead of losing it. All three line switches off hides the box as a whole; the panel's album/pack actions call `tcgShowAlbum`/`tcgOpenPack` — the HUD's own click targets — so hiding the box never strands the player. Verified in the browser on the login screen (HUD `display:none`, panel row reads `not logged in`) and with a stubbed `tcgLoggedIn` for each switch. **REVISION GATE + ALBUM DUPLICATE SELLING (2026-09-18, UI v9 / cards v8):** the catalog is now cut to the build the player is on. Every card carries its WIKI RELEASE DATE and `cards.json` also carries the Lost City roadmap's revision→date map (289 = 2005-01-17); the bundled core reads the engine's own revision off the page (`script[data-rev]`, the `revision` local `client.ejs` renders with — see MODS.md §The contract) and keeps only cards released on or before that date, so a 289 install has 1,388 of the 6,376 cards and cannot roll a Slayer card. New tool `mods/tcg/tools/catalog_dates.mjs` fetches the dates (OSRS wiki first — the wiki the card names come from — then runescape.wiki; batched `titles=` with `rvsection=0`, prefixsearch for case-mismatched names, redirect targets accepted only when their words are a subset of the card's) and refreshes the cutoff map from https://2004.lostcity.rs/roadmap, so a NEW REVISION needs one tool run + a `?v=` bump and no card re-fetch. Undated cards (45) are excluded and reported in the album; tiers are assigned over the gated pool (a 289 card's rarity is its rarity among 289 cards); kill credits deliberately read the UNGATED name→level table so a gated-out monster still pays its level. Validation: 6,331/6,376 cards dated; cross-checked against the item/npc names packed in the 289 install (4,089 items, 1,596 npcs — 2004 spellings like `Adamnt warhammer`/`Antipoison(3)`), only 23 packed entities fall outside the gate and nearly all are modern name-variants or OSRS-era placeholders. The album also SELLS DUPLICATES now: a per-card `⇄ sell 1 (+N)` button (one delegated grid listener; the last copy and every foil are kept — the reveal's pull-back rule) plus a confirmed "Sell all duplicates" header action, with the header re-deriving credits/discovered/per-tier progress after every sale. Harness grew to 75 checks (gated run) / 70 (`TCG_TEST_REV=none`, which proves an absent `data-rev` leaves the catalog whole). Live-verified in the browser: gate label, sell buttons, bulk sell + persistence, and a pack reveal on the gated pool.
- [x] **Hide roofs — SHIPPED** (`mods/hide-roofs`, TYPE B, 1 hunk). "Remove roofs: Always": `Client.roofCheck()` (the method whose answer becomes `renderAll`'s `maxLevel`, i.e. "which levels still draw") returns `minusedlevel` whenever the mod's own key is set — the engine's own answer for "a roof is in the way", so roofs AND the storey above the player stop drawing with no renderer hack, no rebuild, live per frame. Cinema-camera `roofCheck2()` deliberately untouched. Not to be confused with hiding `LocShape.ROOF_*` locs at build time (that needs a rebuild and drops the `mapo |= 0x924` occlusion flags).
- [x] **Low detail — SHIPPED** (`mods/low-detail`, TYPE B, 2 hunks). RuneLite's Low Detail plugin (their words: ground decorations + some textures off) as a live switch instead of `?lowmem=1`: `World.lowMem` (textured ground → flat `TEXTURE_AVERAGE` colour) driven per frame at the top of `gameDrawMain()`; `Pix3D.lowMem` (half-size textures, lowMem raster) and `ClientBuild.lowMem` (skip `GROUND_DECOR` Locs + off-level geometry) set ONCE in `setHighMem()` before the load sequence — `Pix3D.lowMem` must never flip live (texture/texel-pool layout is decided at unpack time), and the scene builder re-derives `ClientBuild.lowMem` from `World.lowMem` per build, so decorations thin out as you cross areas. `Client.lowMem` deliberately untouched (it is the low-memory *client* launch mode: audio loading, the server-visible `lowMemory` bit, >50-player anim culling).
- [x] **Shift-click drop — SHIPPED** (`mods/shift-drop`, TYPE B, 3 hunks). Shift+left-click performs the item's "Drop" option: `shiftDropIndex()` (parked with the `shiftDown` field right before `mouseLoop()`) scans the menu `buildMinimenu()` built for a label starting with `Drop ` whose action is an item op — RuneLite's own rule — and the top of `mouseLoop()`'s closed-menu branch dispatches it through normal `doAction()` and consumes the click, BEFORE the item-drag setup (so a shift click can never start a drag). `mouseDown` cannot host the Shift capture (flush against the camera mod's insertions = one MIXED island); `pointerDown` does. Harness: `mods/shift-drop/tools/shift_drop_test.mjs`.
- [x] **Hotkeys (F-key tabs, Esc closes interfaces, WASD camera) — SHIPPED 2026-09-17** (`mods/hotkeys`, TYPE B + TYPE A panel rows). Design port of OSRS's own shortcut table + RuneLite's Key Remapping. ENGINE: two no-op hooks (`hotkeyKeyDown`/`hotkeyKeyUp`) inserted into `GameShell.onkeydown`/`onkeyup` before the engine's key queue — a claim means `preventDefault` + return, so a bound key can never also type into the chatbox; the decision itself is PURE (`files/webclient/src/client/Hotkeys.ts`, 94-check bun harness `mods/hotkeys/tools/hotkeys_test.ts`) and Client applies its action (TAB / CLOSE / CLEAR_CHAT / CAMERA / CLAIM). F-keys switch the sidebar exactly like clicking an icon (`activeIcon` + `redrawSide` + `redrawIcons`), and a tab key closes an open SIDE interface first (`closeModal()`) because in this rev the bank/shop own the sidebar (`drawSide` prefers `sideModalId`) — otherwise the key looks dead. Defaults = OSRS for the tabs this rev has (F1 combat … F6 spellbook, F8 friends, F9 logout, F10 options, Esc inventory); F7/F11/F12 and Ignore/Controls/Music stay free — **F11/F12 are the browser's** (fullscreen/devtools; a page cannot block them) and slot 7 has no interface in 289 at all. Esc = discard half-typed chat line → leave typing mode → `closeModal()` (the X button's own path; server `CloseModalHandler` → `requestModalClose` → `Player.closeModal()` runs `if_close`) → else its bound tab; **interface 3559 (the character-design screen) is exempt** via the `CC_DESIGN_PREVIEW` client code (the only interface of 11,942 carrying it) since the tutorial soft-locks without it. WASD sets `keyHeld[3|4|1|2]` — the arrow keys' own per-frame path, so easing/pitch clamp/camera telemetry are untouched — with RuneLite's **"Press Enter to Chat..."** chat lock (drawn in `drawChat()`) because this client's chatbox is always live; the whole mod stands down while `Client.ingame` is false so the login fields keep their keys. PANEL: 21 rows (4 toggles + 13 tab keys + 4 camera keys, hand-mirrored from the core and asserted equal by the harness) and one cross-mod courtesy: the panel yields F1 to the game while the canvas has focus and a tab is bound to it (`hotkeysBinding('F1')`), FAB still opens it. `panel.js?v=7`.
- [x] **Hover tile (RuneLite Tile Indicators, hovered tile) — SHIPPED 2026-09-18** (`mods/hover-tile`, TYPE B, 8 hunks). An outline on the tile the mouse is over. **The tile is the ENGINE'S OWN ground pick**: World's rasterizer already hit-tests a mouse pixel against every front-facing ground triangle (the `World.click`/`clickX/clickY` walk pick), so the mod arms a SECOND, independent test beside it (`hoverArmed` + `hoverMouseX/Y`, three pick sites: both triangles in `renderQuickGround`, the face path in `renderGround`) and reads `hoverX/hoverZ/hoverLevel` back after `renderAll`. Back-to-front draw order ⇒ the last hit is the nearest tile, so the highlight is exactly where a click at that pixel would send you and it inherits the engine's own visibility (never rasterized ⇒ never highlighted; works with the gpu mod, whose picking stays on the CPU). Armed in `gameDrawMain()` before `renderAll`, drawn after `coordArrow()` into the areaGame buffer (true-tile's ride), methods parked after `getAvH()`. Level-correct: the quick-ground path records the level it drew, and the projection passes `getOverlayPos` the per-corner height DIFFERENCE (`getAvH(minusedlevel) - getAvH(level)`) instead of duplicating its camera math — so the square shears over slopes/stairs on the hovered storey; the legacy `Ground` path (shapes 2–11) has no level in scope and records `-1` (player's level fallback). Settings + raster live in `files/webclient/src/client/HoverTile.ts` (the hotkeys/gpu payload pattern): one colour + border px + fill %, defaults white/2px/20 % (RuneLite's own 2px/20 % numbers, but VISIBLE — their shipped defaults are transparent-on-transparent), all clamped in the payload so a stale key cannot paint garbage. Harness `mods/hover-tile/tools/hover_tile_test.ts` (72 checks, bun) runs the REAL payload against an independent float geometry implementation. Not ported to 254 (like camera/control-panel/hotkeys/stat-orbs/xp-drops); 274 inherits. **REWORKED 2026-09-18 — the square is Pix3D triangles now** (ten at most: a two-triangle wash + four mitred ring quads), emitted over the scene at the same stage as before. Same reason as true-tile: the fill's translucency only survives a gpu frame through `Pix3D.trans` (the software raster's destination weight AND the gpu mod's per-triangle capture alpha), where the old in-place Pix2D blend mixed against the sentinel-cleared buffer and got painted opaque by the HUD overlay — the "darker colour that lightens as the fill rises" bug, which is what this rework was reported for. The mod's own per-pixel rasterizer moved into `mods/hover-tile/tools/hover_tile_test.ts` as the parity oracle (104 checks: no painted pixel more than 1px from the old set, same border/fill class everywhere clear of the ring's boundary, in every vertex order and winding). Deliberately still drawn OVER the scene and so NOT occluded by the player (a hovered tile is a cursor highlight; true-tile is the ground decal). The border stays a screen-space `thick` px; clipping is Pix3D's now (`hclip`/`clipMaxY`, the same regime every ground triangle uses). Settings contract and the pick machinery are unchanged. See `mods/hover-tile/README.md`.
- [x] **Wiki lookup (RuneLite Wiki plugin) — SHIPPED 2026-09-18** (`mods/wiki-lookup`, TYPE B, 7 hunks in Client.ts). TWO FORMS, the plugin's modern one by default and its classic one as an opt-in: a **wiki button on the minimap panel** (click it, then click any npc/object/item) and a **`Wiki <target>` right-click row** (panel setting, default OFF). Both open `oldschool.runescape.wiki/w/<name>` in a new tab — for NPCs, locs, ground items, inventory/equipment, bank and shop rows alike. THE DESIGN DECISION: the name comes off the menu the ENGINE just built (the top entry = the left-click default, exactly RuneLite's own rule), not from a second entity lookup — the client tags the target name with a colour code and the tag IS the kind (`@cya@` loc, `@yel@` NPC, `@lre@` item; players/chat/`Walk here` are `@whi@`, so they are excluded by construction), so one hook site covers every source of an entity option at once. CLASSIC ROW: slot **1** (bottom row, above `Cancel`) with action id **1234** — not a MiniMenuAction value and `>1000`, and `buildMinimenu()`'s own sort (which walks `>1000` entries downward) is the left/right operand of no swap for us, so the row is immobile and can never become the left-click default; the harness replays that sort and proves no engine row reorders. ARMED ROW (the button's mode): RuneLite gets its `Lookup <target>` left-click verb from the engine's target-verb machinery (`setTargetVerb('Lookup')` + a `USE_NPC|USE_OBJECT|USE_GROUND_ITEM` click mask on a minimap child widget); the 2004 interface has no such widget, so this mod paints its own orb into the widget buffer and writes `Lookup <tag><name>` over the menu's **top** slot itself — from a SECOND `buildMinimenu` hook site that runs AFTER the sort (a `>1000` row written before it sinks toward `Cancel` and could never be the default click). It only overwrites the top slot when that entry names an entity, so walking/following/chatting still work while armed; the armed row is also the tooltip `drawFeedback` shows, and it disarms on use (RuneLite deselects its icon too), on a second click, on logout and when the mod/button is switched off. Dispatch is one check at the top of `doAction()` (the single funnel for the open-menu click, the default click and the touch paths), re-parsing the row's OWN text so row and URL cannot disagree. THE BUTTON'S PIXELS ARE PURE PAYLOAD CODE: `wikiLookupDrawButton(px, stride, height, x, y, size, armed, hover, tick)` paints a 21px stone-rimmed orb with a 7x7 `W` glyph into a plain `Int32Array` (odd size on purpose: `r = size >> 1` then fills the box edge to edge — a 20px box spilled one pixel, caught by the pixel test), so the harness asserts opacity, bounds, hover/armed/pulse deltas and the glyph shape headlessly and can print the orb as ASCII art. WHERE IT IS DRAWN, and the trap: the panel is composited with `putImageData` from its own 172x156 `areaMap` buffer, so that buffer is the only writable surface — but stat-orbs already paints at the end of `minimapDraw()`, and its content-keyed wipe (fires whenever HP/prayer/run energy changes) would erase anything drawn earlier in the frame. So the button hooks `gameDraw()` right after `this.areaMap?.draw(550, 4)`: it binds the widget itself, paints, and restores the previous `Pix2D.pixels/width/height`. Painting after the composite costs one frame of latency and buys immunity to every other mod's wipe; the button's own abandoned pixels (moved/off) are wiped by re-plotting the mapback, which `minimapDraw` repairs before the next composite. Placement: a canvas-buffer surface (`registerCanvas` with the region `[550,4,172,156,172,156]`, `window['lcmWikiLookupBounds']` reserved in bundle.ts, keys `lcmWikiLookupAnchor`/`Offset`) so the orb is alt-draggable and resettable from the panel. Its default spot is the map window's bottom-right corner with 3px of clearance from the panel's right and bottom edges (RuneLite/OSRS' spot for the orb): FLUSH placement was the first try, and the zoomed render showed the orb's dark outline merging with the panel's border, so the default is an even 3px inset (the drag layer still clamps canvas surfaces flush, so a hard drag into the corner parks it there — a deliberate, documented 3px difference, invisible in play). Sitting over the map is also the cleanest place for a minimap overlay: the map is re-blitted every frame before the composite, so no abandoned pixel can survive there, and the panel's left strip stays free for stat-orbs. NAME lookup, not `Special:Lookup?id=`: 2004 cache ids are not OSRS ids and an id lookup would land on the wrong page. `window.open` runs a few ms after the click (inside the transient-activation window); if a popup blocker refuses it, a viewport card with a real link appears instead. Modifier keys are tracked by the PAYLOAD's own capture-phase page listeners — GameShell's key hooks belong to hotkeys. Settings: `wikiLookup` (master, on), `wikiLookupButton` (minimap orb, on), `wikiLookupMenu` (off|always|shift|ctrl|alt — default off), `wikiLookupStyle` (page|search), plus panel actions for `Special:Search` and for resetting the orb's position. Harness `mods/wiki-lookup/tools/wiki_lookup_test.ts` (159 checks) + the idempotent live-tree edit script `tools/wiki_button_edit.py`. 274 inherits; not ported to 254.
- [x] **Disable profanity filter — SHIPPED** (`mods/no-censor`, TYPE B, 3 hunks across BOTH repos). The 2004 chat censor, off — **on by default**. Lost City's own writeup is that the game filters chat in TWO places with the same Jagex algorithm over the same `wordenc` jag: client side (`WordFilter.filter` — what YOUR client shows: your own echo, other players' chat, incoming PMs) and server side (`WordEnc.filter`, called by `MessagePublicHandler` for public chat and `MessagePrivateEncoder` for PMs — what the world sends out). So the mod patches both, and the two halves are coupled by design: the client is the layer that can see a player's setting, so it owns the decision and the server stops PRE-censoring. CLIENT: ONE hunk wrapping the four masking passes (`filterTlds`/`filterBadWords`/`filterDomains`/`filterFragments`) in `if (localStorage.getItem('noCensor') === 'false')` — that covers all four client call sites at once because they all go through `filter()`, and the key is read per CALL (chat events only, never per frame, so the read is free and the panel switch lands on the next message; unset/junk = off, `'false'` = upstream verbatim). SERVER: `static censor: boolean = false` + the same guard, deliberately UNCONDITIONAL because the server cannot see a client's key — and display-neutral for everyone else, since every client re-filters incoming messages on receipt, so a vanilla client (or one with the mod off) sees exactly what it always saw. `format()` and the sentence-case passes stay on both sides (chat alphabet, space collapsing, capitals), so nothing downstream sees characters the 2004 font cannot draw. Harness `tools/no_censor_test.ts` (30 checks) runs the REAL shipped files against the REAL jag and parses `badenc`/`domainenc`/`tldlist` INDEPENDENTLY (369 bad words, 453 domains, 258 TLDs) so the corpus is an oracle rather than a copy of the code: **0 stars across the whole corpus with the filter off**, vanilla still masking 364/369 + 453/453 + 299/300 with it on (which is what stops the ON assertion being vacuous), plus key semantics, whitelist survival, determinism, formatting equivalence both ways, and the engine flipping back to masked when `censor = true`. 274 inherits (matrix 122/122 exact); 254 not ported. `panel.js?v=18` (single-toggle mod: registry row only, not `invert` — the name is the action, so checked = filter off = the key's own `'true'`, the hide-roofs shape).
- [x] **Ground item labels (RuneLite Ground Items) — SHIPPED 2026-09-18** (`mods/ground-items`, TYPE B, 4 hunks in ONE file). Labels over the items on the floor, with RuneLite's curation loop: hold **Alt** and every item is labelled (hidden ones dimmed) with its `[-]`/`[+]` boxes beside it — click `[-]` to hide that item, `[+]` or the label itself to always show it (a right-click on a label hides it too). **The items are the client's own**: `groundObj[minusedlevel][x][z]` is the per-scene-tile `ClientObj` list its right-click menu and minimap dots already walk, and `showObject()` pushes the highest-cost item to the head, so the engine's own "top item" is the first label of a stack; the position is the engine's own `getOverlayPos(sceneX*128+64, sceneZ*128+64, 20)` (the call entity names and true-tile use), culled at RuneLite's own `MAX_DISTANCE` 2500 local units — and like RuneLite, deliberately NOT occlusion-tested. Drawn as the last statement of `entityOverlays()` (areaGame bound, `otherOverlays()` still composites interfaces over it — the alternative, beside `areaGame.draw(4,4)`, would paint labels over the bank), boxes re-collected per frame while Alt is held and the click consumed at the TOP of `mouseLoop()` before any walk/take dispatch (`mouseClickX/Y - 4` = the buffer pixel the engine itself uses for `Model.mouseX`). **The price is the server's**: `max(scale(6, 10, oc_cost(item)), 1)` from `alchemy.rs2` = 0.6 × `ObjType.cost` floored, min 1 — so "Min high alch value" filters on the real coin payout, and 1gp items (coins) never grow a `(1 gp)`. Settings: master + threshold slider + **two free-text name lists** + value toggle + three colours; the lists are edited in the panel AND by Alt+click in game (one CSV string, two editors, no shadow state), which is why the panel grew **`kind: 'text'`** (writes the raw string on `change`, not per keystroke) and `.lcm-text`. Alt state is DOM-tracked in the payload (wiki-lookup's modifier pattern). Harness `tools/ground_items_test.ts` (86 checks) runs the REAL payload: the high-alch table hand-written from the server's formula, the settings clamps, list edits, the classification table, and the box hit test against the real label geometry. Not ported to 254 (like camera/hotkeys/stat-orbs); 274 inherits.
- [ ] Minimap zoom-sync to camera zoom: TYPE B, trivial (see sync comment in Client.ts)
- [ ] FPS counter / ping display: TYPE B read of `this.fps`, TYPE A widget slot
- [x] **GPU renderer (RuneLite equivalent) — SHIPPED 2026-09-10 as v1 (WebGL2), rewritten the SAME DAY as v2 (WebGPU) which is what ships today.** The long paragraph below is the **v1 design record** (its `gl_FragDepth`/`MAX_TRIS 98304`/full-buffer-upload details are v1-only); **read the v2 paragraph at the END of this entry first** — the file headers in `mods/gpu/files/` are also v2. v1 Design: CPU keeps ALL engine logic (culling/projection/lighting/picking untouched — `Model.mouseCheck` and `World.groundX` resolve exactly as before because they run before rasterization); the ONLY hijacked seam is the three `Pix3D` triangle entry points (`gouraudTriangle`/`flatTriangle`/`textureTriangle`), patched at module load via a single side-effect import hunk in `Client.ts` (line 1, ~87 pristine lines clear of the next mod's hunk). Captured triangles replay on the GPU in **capture order via `gl_FragDepth`** (GEQUAL, clear 0) = the painter's algorithm preserved exactly, blend mirrors `Pix3D.trans`'s integer mix (`ONE_MINUS_SRC_ALPHA/SRC_ALPHA` with `a=trans/256`; `trans=0` stays a plain overwrite), so translucent water/glass land where software put them. Texture sampling reproduces the rasterizer's affine plane bit-for-bit: same `<<14/<<8/<<5` int32 coefficients, `w>>14` (lowMem `>>12`) fixed-point division, `16256/4032` clamps, `0x3f80/0xfc0` row masks, `0xf8f8ff` 4-band R32UI texel array + the `(e>>21)&3`/`(e>>23)&31` shade-band extraction (e = `(shade<<17)|0`, textureRaster's accumulated word); holes `discard`, holeless-zero paints black — `textureRaster` has NO alpha branch (verified), replace always. Per-run scissor reproduces `Pix2D.setClipping` (headicon/label clips included). **Everything else stays software**: item icons, minimap, sidebar, chat, login/title — and the Pix2D overlay writes INTO the game buffer (bubbles/hitbars/trackers/orbs) are uploaded each frame as an R32UI texture and composited last, non-black = replace, which is exactly software's ordering (world first, overlays after) and what makes camera/xp-drops/stat-orbs pixel-identical with GPU on — zero coupling. Settings: `localStorage gpu` (default off), refreshed at `Pix2D.cls()` once per frame (never flips mid-frame; no `applyCameraSettings` hook needed). Self-disables + auto-falls-back on missing WebGL2/shader/link failure/context loss/`gl.getError`/triangle overflow (overflow frame stays correct: leftover tris ride the overlay). v1 honest gaps (also in file header): HSL shade steps per-pixel on GPU vs per-8px software (same look — RuneLite's GL shader made the same call), lowDetail's 4px blocks are a CPU artifact GL doesn't emulate, pure-black overlay pixels let terrain show through. `tools/gpu_parity_test.ts` (bun) rasterizes random tris through the REAL software rasters and a JS mirror of the shader: flat & textured paths EXACT (0 value mismatches), gouraud diffs traced to synthetic-colour-table HSL straddling + fill-rule edge jitter (GL diamond vs scanline top-left), not shader math. Tunables: `MAX_TRIS` 98304 (18.9 MB). Panel: Rendering group 'GPU rendering' toggle. WINDOWS ADAPTER HINT (2026-09-16): the adapter is requested BARE on Windows — Chromium ignores `powerPreference` there and logs a console notice for every optioned call (crbug.com/369219127), so `GpuContext.prefersBareAdapter()` (gated off `navigator.userAgentData?.platform ?? navigator.platform`) keeps the console clean while the high-performance hint stays on the platforms that honour it (dual-GPU Macs); the bare-retry fallback that Brave's fingerprinting defenses need is unchanged. **v2 (WebGPU) — WHAT SHIPS NOW, shipped 2026-09-10 → 09-13, rewrite decision + probes in `docs/archive/gpu-v2-assessment.md`:** native `navigator.gpu` + WGSL from TypeScript, no Rust/wgpu/WASM. Four files in `mods/gpu/files/webclient/src/gpu/`: `GpuFormat.ts` = the backend-neutral CAPTURE CONTRACT (the shared tier of the plan's split diagram: stride `VS*4` = 64 B, slots `[0..1]` xy already projected by the CPU, `[2]` shade word, `[3]` mode, `[4]` seq, `[5]` alpha = `Pix3D.trans/256`, `[6..11]` u,v,w,texId), `GpuShaders.ts` = the WGSL, `GpuContext.ts` = the whole adapter→device→overlay-canvas→configure lifecycle, `GpuRenderer.ts` = capture + pipelines + composite (the only file the `Client.ts` import hunk pulls in; the other three come with it). **What v2 buys:** ONE scene draw + ONE HUD overlay draw per frame instead of v1's 30-60k `drawArrays` — painter's order preserved by carrying the capture sequence number in the vertex's depth slot (`z = seq * 2^-23`, exact in f32 to 8.4 M tris) against a `depth32float` cleared to 0 with `greater-equal`, so "later capture always wins a pixel" is resolved by the fixed-function depth unit; WebGPU has no per-draw scissor, so v1's clip-rect batching (the exact fragmentation that forced the draw count) is gone and ordering carries correctness instead. **Compositing (differs from v1 AND from the abandoned WIP — deliberate):** the WebGPU canvas is a real DOM element positioned over the game rect, `alphaMode:'opaque'` — a detached or `display:none` WebGPU canvas may never be PRESENTED (Dawn only presents what the page renders), which makes a `drawImage` readback read an empty buffer, the suspect the WIP's `gpudbg` experiments never ruled out because every debug mode shared that path; with a visible canvas there is no presentation variable at all. When the GPU owns a frame the patched `PixMap.draw` SKIPS `putImageData`; on every non-GPU frame the overlay hides and software resumes pixel-exact. GPU frames clear the game buffer to `SENTINEL_BLACK`=1 rather than 0 so real `Colour.BLACK` HUD pixels (minimenu title bar/shadow, text shadows) are not discarded by the overlay. **P5 (2026-09-11) — real texel sampling on GPU:** `captureTexTri` ports v1's parity-tested affine plane (same `<<14/<<8/<<5` int32 coefficients walked from `originX/originY`), the texel pool uploads as a 50-layer 128×512 `texture_2d_array<u32>` mirroring `getTexels` (4 lightness bands, `0xf8f8ff`, 64 px upsample, lowMem layout variant, `pushTexture` dirty-tracking), the WGSL fragment stage mirrors v1's GLSL verbatim (`w>>14`/`>>12`, `0x3f80/0xfc0` masks, `16256/4032` clamps, holes `discard`, opaque-black replace, no alpha mix), `texHoles` stays authoritative. **P7 (2026-09-13):** dirty-rect HUD upload (scan the non-sentinel bbox, `writeTexture` that sub-rect, skip empty frames) + honest perf stats (`window.lcliteGpuStats` = tris / batches / cpuMs / hud px, what the panel row prints) + fullscreen reparent for the DOM overlay. **Failure model (unchanged from v1's contract):** every init/validation/device-lost/error-scope path disables the GPU, flips `localStorage 'gpu'` off and surfaces the reason VERBATIM in `window.lcliteGpuError` (the panel row prints it) — the software renderer underneath is never touched. Settings: `localStorage 'gpu'` (default OFF), re-read at `Pix2D.cls()` once per frame so it never flips mid-frame; `localStorage 'gpudbg'='1'` draws the P1 proof triangle through the same canvas/place/depth plumbing (one glance separates "backend/canvas broken" from "capture/depth wrong"). Tunable: `MAX_TRIS` 65536 (12.6 MB capture; a busy 289 scene runs 15-30k). Panel: a TOP-LEVEL `GPU` row (not the old Rendering-group toggle) with a live status line (`<tris>△ · <calls> calls · <ms>ms`, `starting…` until the first frame, `off: <reason>` on failure) and the master key `gpu`. Harness: `mods/gpu/tools/gpu_parity_test.ts` was ported to the v2 API (`captureTri`/`captureTexTri`/`nv` reset) and reports the SAME results as the v1/WebGL2 baseline (gouraud big 7729 / maxd 246, flat 0/0, tex d1 15); the residual mirror-vs-software deltas are v1's own documented 16.16 fixed-point interpolation-stepping artifact, not a v2 regression.
