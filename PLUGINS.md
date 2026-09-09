# Writing lclite plugins

lclite is deliberately two kinds of mod, because the engine underneath is a compiled
TypeScript bundle while this overlay is plain web files. Pick the kind you need:

```
TYPE A — ui plugin        panel mods, DOM stuff, no engine code changes
TYPE B — engine mod       anything that touches the game client's internals (camera,
                          renderer, input, packets, interfaces)
```

---

## TYPE A — UI-only plugin (start here if you can)

Add it to `lclite/mods/control-panel/files/engine/public/lclite/panel.js`.
The whole panel is driven by the `MODS` registry; one entry = one row:

```js
{
    id: 'my-mod',                 // unique
    group: 'Camera',                  // one of GROUPS (add your own group name there too)
    name: 'My mod',               // row title (the ONLY visible text on the row)
    desc: 'What it does, one line.',  // hover tooltip on the title + searchable text
    kind: 'toggle',                   // 'toggle' | 'slider' | 'select' | 'action'
    key: 'myMod',                 // the localStorage key — your settings bus!
    def: 'false'                      // default value as string
}
```

Rows are single-line: `desc` is not subtext — `panel.js` surfaces it as a shared
hover tooltip (`[data-tip]` → `#lclite-tip`, anchored left of the panel) and folds it
into the row's `data-name` so search matches on it too. Keep `desc` a real sentence.

Kinds:
- **toggle** — sliding switch; writes `'true'/'false'` to `localStorage[key]`.
- **slider** — needs `min/max/step/def`, optional `get()` (live value) and `apply(v)`;
  the camera-zoom slider is the reference.
- **select** — `options: [['val','Label'], ...]`, optional `get()`, `apply(v)`.
- **action** — `run()` fires on click (see Fullscreen/screenshot rows).

Every mod gets a toast automatically. New settings **only** via localStorage keys —
that's the durable contract with the game (see "The contract" below).

Re-copy into the tree and you're done (no rebuild for panel changes):

```
node lclite/install.mjs apply     # rewrites engine/public/lclite/*
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
| overlay ON TOP of the interface  | end of `minimapDraw()` — Pix2D is bound to the 172x156 `areaMap` widget, composited over the sidebar every tick (stat orbs live here). NB: widget stone is painted once at boot — draw OPAQUE only, or repaint mapback to wipe |
| add/replace sidebar UI           | `drawSide()` (~line 11192), stat values: `this.stats[s].base` (HP=3, Prayer=5), `this.runenergy`, redraw flag `redrawSide` |
| react to input before the engine | `GameShell` handlers (see wheel zoom, ~line 300)    |
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

### 3. Snapshot your edit as hunks
Add the file to `MODS` in `lclite/regen.mjs` (new folder = new mod, e.g.
`mods/xp-drops`), then:
```
node lclite/regen.mjs          # regenerates lclite/mods/*/patches/*.json from git diff
```
Hunks are `{find:[old lines], replace:[new lines]}` — `find` gets auto-widened with
context until unique in the *pristine* old file. If regen warns `AMBIGUOUS`, your edit is
inside a region that appears multiple times — restructure the edit (anchor on a unique
line) rather than fighting the tool. When one file hosts SEVERAL mods (Client.ts does —
camera, xp-drops, stat-orbs, anti-cheat), `HUNK_OWNER` regexes route each hunk to its
folder by argmax of token hits in the ADDED lines (camera is a scored rule too, so the
settings-bus hunk stays with camera on score; a genuinely merged hunk like CYCLELOGIC7+
clearPick goes to whichever side dominates). CRITICAL: edits closer than ~61 pristine
lines merge into ONE git -U30 hunk, so each mod's fields/methods must live in an
ISOLATED region clear of other mods' hooks — e.g. stat-orbs keeps its whole
fields+drawStatOrbs+drawOrb block in one slot before gameDraw(); anti-cheat's field
sits between the menu and midi field groups. If routing looks wrong after an edit,
check the hunks didn't silently merge: `git diff -U30` and count blank context between
your +/- blocks.

### 4. Prove it survives
```
# fresh clones at base revs + apply must reproduce your tree byte-for-byte
git clone --no-checkout ../webclient t/webclient && git clone --no-checkout ../engine t/engine
(cd t/webclient && git checkout <base-rev>) && (cd t/engine && git checkout <base-rev>)
cp -r lclite t && cd t && node lclite/install.mjs
# diff every patched file against your live tree — must be empty
```

---

## The contract between panel and engine (keep it boring)

- **Settings bus** = `localStorage` keys. The engine reads them in
  `Client.applyCameraSettings()` (boot + any time the panel calls it) and writes them
  back when state changes in-game (e.g. wheel writes `cameraZoom`). Names are stable
  strings — they survive minification untouched.
- **Two reserved names** in `webclient/bundle.ts` terser config (patched via
  `mods/control-panel/patches/bundle_ts.json`; they *must* stay listed):
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

## Rev-upgrade day, the short version

1. commit modded trees (`git -C webclient add -A && …`) — safety net for manual reseating
2. change rev via `start.bat`, or `git pull` per repo
3. `node lclite/install.mjs` → clean? build+play. Failing hunks? each prints
   `anchor not found` / `ambiguous` + the file and old-line number — open that patch JSON,
   find where the `find:` lines moved in the new upstream, reseat, rerun.
4. `node lclite/regen.mjs` when you've since polished the edits in-tree.

## Ideas register (parking lot)

- [x] wheel zoom + middle-drag rotate + one-shot walk pick + far-plane/viewRadius fix — `mods/camera`
- [x] anti-cheat/telemetry suppression toggle — `mods/anti-cheat` (split out of camera 2026-09-09)
- [x] smooth-shading option (Pix3D/ObjType save-restore) — `mods/rendering` (split out of camera 2026-09-09)
- [x] HP/Prayer/Run orbs (the 225-guide style) — SHIPPED (`mods/stat-orbs`, split out of camera 2026-09-09), the reference TYPE B example: ~80 lines in Client.ts (`drawStatOrbs`/`drawOrb`, hooked at the END of `minimapDraw()` — both the normal and hidden-minimap (`minimapState==2`) branches — so they paint into the 172x156 `areaMap` widget buffer which `gameDraw()` composites at canvas (550,4) over the sidebar every tick; Pix2D is already bound to areaMap there, and the hook must restore nothing because minimapDraw's tail rebinds `areaGame` itself. OSRS placement: three r=12 orbs OUTSIDE the map circle down its lower-LEFT (compass-mirrored column): fixed widget centres HP(15,92) -> Prayer(26,120) -> Energy(44,140) (circle is centre ~(98,80) R~73, window left edge x=25; x<25 is bare stone, verified by pixel sweep). Each orb has an OPAQUE 0x101010 r+1 backing ring — NOT an alpha halo: areaMap stone is only painted at boot (mapback in vLoaded), never re-cleared per tick, so any alpha blend there accumulates and darkens every frame. Numbers ALWAYS drawn (`centreStringTag`, shadowed) — no hover gate; HP text colour-codes green>66% / yellow>33% / red. Values: `statEffectiveLevel[3|5]`/`statBaseLevel[3|5]`, `runenergy` (wire = energy/100 → 0-100). Toggle-off ghost wipe: `orbsWereOn` flag, on off-transition `mapback.plotSprite(0,0)` once into areaMap re-exposes the (untouched, non-destructive) map window holes AND repaints the stone — minimapDraw re-blits the map every tick so no flash. Verified idempotent (pixels identical T0 vs T+4s) and ON->OFF->ON live via applyCameraSettings with no reload. Panel toggle: Interface group 'Stat orbs' (localStorage statOrbs). Hunks routed by HUNK_OWNER 'stat-orbs' rule; the whole fields+methods block lives in ONE isolated slot before gameDraw() so regen can never merge it with camera/xp edits.
- [x] XP drops + level-progress tracker — SHIPPED (lclite TYPE B, `mods/xp-drops` hunks; split out of `mods/camera` 2026-09-08 so each mod's hunks live in their own folder). Port of the 225 community guide, re-anchored for 289: UPDATE_STAT listener in the packet switch pushes `{skill,xp,y}` rows (only when `statXP[stat] >= 0 && xp > prev` — statXP is filled with -1 at login and the login UPDATE_STAT burst adopts silently, so no fake drops); rows render right-aligned in the game buffer (XP_DROP_* tunables), frame-driven scroll (NOT loopCycle — it catch-ups in bursts during loading), queue parks newer rows 15px BELOW the previous. ROW FORMAT: skill ICON + `+N` (xpDropIcon helper → xpStaticons via STAT_ICON_BY_SKILL; falls back to skill name for skills with no icon in the pack). Tracker panel: drawn straight into the game buffer at XP_PANEL_GX/GY = viewport top-right (OSRS default spot; replaced the old bottom-right canvas PixMap composite); solid 2004Scape-tan fill (XP_PANEL_BG 0x8a7454 sampled from the backbase frames); panel line 1 reads `Experience <total>` (skill shown by icon, not name). Hook sits at the TOP of `entityOverlays()` — everything composited later in the frame (chat privates, modals, the right-click minimenu) paints OVER the tracker, so the old blanket `!isMenuOpen` hide (which blanked the tracker on every right click) is GONE; no float-over-interface risk remains. Auto-hides XP_HIDE_MS (6s) after the last gained xp via `xpLastGainAt` (OSRS-style); rows drain at ~4.2s so nothing freezes mid-band, plus an explicit queue flush on hide. PANEL SKILL = biggest gainer of the current burst: gains within XP_BURST_MS (1s) merge into `xpRates[]` and the panel tracks max(xpRates) — combat hits drip small Hitpoints/Defence xp alongside the real skill, so training Attack keeps showing Attack (ties resolve to the earlier-logged skill; verified headless: hp-then-bigger-attack burst → Attack wins, new-burst defence-only → Defence). Icons: xpStaticons = staticons 0-17 + staticons2 0, via STAT_ICON_BY_SKILL = stats.if grid order [0,2,1,6,3,4,5,15,17,11,14,16,10,13,12,8,7,9,-1,-1,18,...] (pack order is NOT skill order). Skill labels: Skill.names capitalized ('hitpoints'→'Hitpoints'). localStorage key xpDrops (default ON); panel Interface toggle + live via applyCameraSettings (that one-line read stays in the camera-owned settings hunk). All geometry/colors in the XP_* tunables block at top of Client.ts. Verified headless: panel+rows at top-right, tracker survives an open minimenu, panel gone after 11s idle, burst-priority flips. regen.mjs routes shared Client.ts hunks by ADDED-line tokens (HUNK_OWNER, >=2 hits wins).
- [ ] Keybind rebinds: TYPE B (GameShell key handlers) + TYPE A UI list
- [ ] Minimap zoom-sync to camera zoom: TYPE B, trivial (see sync comment in Client.ts)
- [ ] FPS counter / ping display: TYPE B read of `this.fps`, TYPE A widget slot
