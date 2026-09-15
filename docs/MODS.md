# Writing LCLite mods

lclite is deliberately two kinds of mod, because the engine underneath is a compiled
TypeScript bundle while this overlay is plain web files. Pick the kind you need:

```
TYPE A — ui mod            panel mods, DOM stuff, no engine code changes
TYPE B — engine mod       anything that touches the game client's internals (camera,
                          renderer, input, packets, interfaces)
```

---

## TYPE A — UI-only mod (start here if you can)

The panel has two tabs (RuneLite's two surfaces): a **Mods** tab (one row per
installed mod: name + description + master switch) and a **Settings** tab
(collapsible sections, one per mod, shown only for mods that HAVE sub-settings —
sections open collapsed, a Mods-row click or header click expands one for the
session). A pin button in the header keeps the panel open through in-game
clicks. Everything is driven by two registries in `panel.js`:

1. Add the mod's row to `MODS` (or nothing, if it's a single toggle — see below):

```js
{
    id: 'my-mod',                 // unique
    mod: 'my-mod',                // the lclite/mods/<folder> this row belongs to —
                                  // that's what groups it into its Settings section
    name: 'My mod',               // row title (the ONLY visible text on the row)
    desc: 'What it does, one line.',  // hover tooltip on the title + searchable text
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
- **action** — `run()` fires on click (see Fullscreen/screenshot rows).

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
Add the file to `MODS` in `tools/regen.mjs` (run from `lclite/`) (new folder = new mod, e.g.
`mods/xp-drops`), then:
```
node tools/regen.mjs          # regenerates lclite/mods/*/patches/*.json from git diff
```
Hunks are `{find:[old lines], replace:[new lines]}` — `find` is the MINIMAL unique
window in the pristine old file (2-line context floor, expanded only while the anchor
is non-unique). If regen warns `AMBIGUOUS`, your hook site's surroundings repeat in the
file — widen your edit to include a unique line rather than fighting the tool. When one
file hosts SEVERAL mods (Client.ts does), each added block MUST start with a
`lclite:<mod>` marker (comment form matching the language, `<!-- lclite:mod -->` in
EJS); regen routes by marker with 100% precision and warns loudly on any unmarked
block (legacy regex fallback). The old ≥61-line isolation rule is RETIRED (2026-09-15):
regen now extracts `git diff -U0` islands, so adjacent change blocks stay separate
hunks automatically — but keep hunks' edit sites ≥3 untouched lines apart, and trust
`node tools/lclite.mjs doctor` (exit 3 = a hunk's deletions would break a sibling's
anchor).

### 4. Prove it survives
```
# fresh clones at base revs + apply must reproduce your tree byte-for-byte
git clone --no-checkout ../webclient t/webclient && git clone --no-checkout ../engine t/engine
(cd t/webclient && git checkout <base-rev>) && (cd t/engine && git checkout <base-rev>)
cp -r lclite t && cd t && node lclite/tools/lclite.mjs
# diff every patched file against your live tree — must be empty
```

---

## The contract between panel and engine (keep it boring)

- **Settings bus** = `localStorage` keys. **Each engine mod reads its OWN key at
  its OWN per-frame hook site** — stat-orbs/xp-drops at the top of their draw
  hooks, anti-cheat once at the top of `gameLoop()`, true-tile inside
  `drawTrueTile()`, rendering at the top of `mainloop()` (Pix3D.lowDetail has no
  per-draw anchor), gpu at `Pix2D.cls()`. No mod depends on another mod's
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
- **Page-loaded assets must be VERSION-KEYED** (`ui.js?v=N`, data `?v=N`, bumped
  on every revision you ship). express serves them with `max-age=0` + ETag, and
  browsers — Brave demonstrably — re-serve stale disk-cache copies of a plain
  path *past hard refreshes*; the bundled core can't see it but the DOM layer is
  then an ancient build (tcg shipped through exactly this: old HUD anchored
  under the FAB looked like a dead mod). The tcg pattern: `?v=` in the ejs tag
  AND in the core's self-heal injection, `window.__lctcgUi` stamp so the core
  detects a stale UI and removes+replaces it. Also never `fetch(..., {cache:
  'force-cache'})` a mod data file — 'no-cache' revalidates and stays 304-cheap.
- **The FAB owns viewport top-right** (44px at top:14 right:18, z 9000; the
  panel drops from top:66). Page overlays must anchor elsewhere (tcg pins its
  HUD to the canvas top-left rect per tick) and, when they need to cover the
  whole frame, layer above: `z-index > 9500`.

## Rev-upgrade day, the short version

1. commit modded trees (`git -C webclient add -A && …`) — safety net for manual reseating
2. change rev via `start.bat`, or `git pull` per repo
3. `node lclite/tools/lclite.mjs` → clean? build+play. Failing hunks? each prints
   `anchor not found` / `ambiguous` + the file and old-line number — open that patch JSON,
   find where the `find:` lines moved in the new upstream, reseat, rerun.
4. `node lclite/tools/regen.mjs` when you've since polished the edits in-tree.

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
1. `mods/<name>/patches/*.json` hunks, every added block marker-first (`lclite:<mod>`).
2. optional `files/` payload (copied verbatim; stripped only if unedited).
3. optional panel row (MOD_REGISTRY entry in control-panel's panel.js — or rely on the
   synthesized row; ship the row as your own files/ copy if you want rich UI).
4. namespaced your keys: `localStorage` names prefixed with your mod (camelCase);
   read them at YOUR hook site, per frame.
5. degrade gracefully: `typeof window.lostcityClient?.foo === 'function'` before any
   engine call; fall back when a cache pack lacks icons/sprites.
6. target a host with `root.json` (repo dirs/remotes) — patch JSONs reseat per host;
   hunks against Lost City apply as-is to revs near the pinned `generated_from.head`.

Distributing = publishing a repo with this layout; users point `LCLITE_ROOT` at it or
drop it beside their repos like any other overlay. A mods *registry* is deliberately
NOT a thing yet — folders + git remotes are enough until someone installs one.

## Ideas register (parking lot)

- [x] wheel zoom + middle-drag rotate + one-shot walk pick + far-plane/viewRadius fix — `mods/camera`
- [x] anti-cheat/telemetry suppression toggle — `mods/anti-cheat` (split out of camera 2026-09-09)
- [x] smooth-shading option (Pix3D/ObjType save-restore) — `mods/rendering` (split out of camera 2026-09-09)
- [x] HP/Prayer/Run orbs (the 225-guide style) — SHIPPED (`mods/stat-orbs`, split out of camera 2026-09-09), the reference TYPE B example: ~80 lines in Client.ts (`drawStatOrbs`/`drawOrb`, hooked at the END of `minimapDraw()` — both the normal and hidden-minimap (`minimapState==2`) branches — so they paint into the 172x156 `areaMap` widget buffer which `gameDraw()` composites at canvas (550,4) over the sidebar every tick; Pix2D is already bound to areaMap there, and the hook must restore nothing because minimapDraw's tail rebinds `areaGame` itself. OSRS placement: three r=12 orbs OUTSIDE the map circle down its lower-LEFT (compass-mirrored column): fixed widget centres HP(15,92) -> Prayer(26,120) -> Energy(44,140) (circle is centre ~(98,80) R~73, window left edge x=25; x<25 is bare stone, verified by pixel sweep). Each orb has an OPAQUE 0x101010 r+1 backing ring — NOT an alpha halo: areaMap stone is only painted at boot (mapback in vLoaded), never re-cleared per tick, so any alpha blend there accumulates and darkens every frame. Numbers ALWAYS drawn (`centreStringTag`, shadowed) — no hover gate; HP text colour-codes green>66% / yellow>33% / red. Values: `statEffectiveLevel[3|5]`/`statBaseLevel[3|5]`, `runenergy` (wire = energy/100 → 0-100). Toggle-off ghost wipe: `orbsWereOn` flag, on off-transition `mapback.plotSprite(0,0)` once into areaMap re-exposes the (untouched, non-destructive) map window holes AND repaints the stone — minimapDraw re-blits the map every tick so no flash. Verified idempotent (pixels identical T0 vs T+4s) and ON->OFF->ON live with no reload (own per-frame key read at the minimapDraw hook — no settings hub). Panel toggle: Interface group 'Stat orbs' (localStorage statOrbs). Hunks routed by HUNK_OWNER 'stat-orbs' rule; the whole fields+methods block lives in ONE isolated slot before gameDraw() so regen can never merge it with camera/xp edits.
- [x] XP drops + level-progress tracker — SHIPPED (lclite TYPE B, `mods/xp-drops` hunks; split out of `mods/camera` 2026-09-08 so each mod's hunks live in their own folder). Port of the 225 community guide, re-anchored for 289: UPDATE_STAT listener in the packet switch pushes `{skill,xp,y}` rows (only when `statXP[stat] >= 0 && xp > prev` — statXP is filled with -1 at login and the login UPDATE_STAT burst adopts silently, so no fake drops); rows render right-aligned in the game buffer (XP_DROP_* tunables), frame-driven scroll (NOT loopCycle — it catch-ups in bursts during loading), queue parks newer rows 15px BELOW the previous. ROW FORMAT: skill ICON + `+N` (xpDropIcon helper → xpStaticons via STAT_ICON_BY_SKILL; falls back to skill name for skills with no icon in the pack). Tracker panel: drawn straight into the game buffer at XP_PANEL_GX/GY = viewport top-right (OSRS default spot; replaced the old bottom-right canvas PixMap composite); solid 2004Scape-tan fill (XP_PANEL_BG 0x8a7454 sampled from the backbase frames); panel line 1 reads `Experience <total>` (skill shown by icon, not name). Hook sits at the TOP of `entityOverlays()` — everything composited later in the frame (chat privates, modals, the right-click minimenu) paints OVER the tracker, so the old blanket `!isMenuOpen` hide (which blanked the tracker on every right click) is GONE; no float-over-interface risk remains. Auto-hides XP_HIDE_MS (6s) after the last gained xp via `xpLastGainAt` (OSRS-style); rows drain at ~4.2s so nothing freezes mid-band, plus an explicit queue flush on hide. PANEL SKILL = biggest gainer of the current burst: gains within XP_BURST_MS (1s) merge into `xpRates[]` and the panel tracks max(xpRates) — combat hits drip small Hitpoints/Defence xp alongside the real skill, so training Attack keeps showing Attack (ties resolve to the earlier-logged skill; verified headless: hp-then-bigger-attack burst → Attack wins, new-burst defence-only → Defence). Icons: xpStaticons = staticons 0-17 + staticons2 0, via STAT_ICON_BY_SKILL = stats.if grid order [0,2,1,6,3,4,5,15,17,11,14,16,10,13,12,8,7,9,-1,-1,18,...] (pack order is NOT skill order). Skill labels: Skill.names capitalized ('hitpoints'→'Hitpoints'). localStorage key xpDrops (default ON); panel Interface toggle; live with no reload via xp-drops' OWN per-frame read at the hook (no settings hub — see "The contract"). All geometry/colors in the XP_* tunables block at top of Client.ts. Verified headless: panel+rows at top-right, tracker survives an open minimenu, panel gone after 11s idle, burst-priority flips. regen.mjs routes shared Client.ts hunks by ADDED-line tokens (HUNK_OWNER, >=2 hits wins).
- [x] OSRS-style true tile — SHIPPED (`mods/true-tile`, TYPE B). Green outline on the tile the SERVER has the player on: `localPlayer.routeX/routeZ[0]` — the head of the 10-deep move queue that `getPlayerPosLocal` pushes local move codes into (same value the engine's own teleport/reset paths snap to), vs `player.x/z` the model lerps toward via `routeMove` (trails up to a tick, worst-case a full tile + run interpolation). Corners `(t<<7, t<<7)..+128` projected through `getOverlayPos` (height 0 → `getAvH` per corner, so the square shears correctly on slopes/stairs and hides off-camera/out-of-area like every overlay); drawn from `coordArrow()` (runs every frame in gameDrawMain right after entityOverlays, Pix2D bound to areaGame → the GPU mod's HUD composite uploads it like hitbars/chat, interfaces paint over later via otherOverlays). Methods parked in the pristine gap after `getOverlayPos` (>200 lines from any other mod's hunks — the coordArrow call sits ~65 lines clear of the anti-cheat cyclelogic5 guard); no fields — reads its OWN localStorage keys every frame (gpu pattern), all settings live with no reload. CUSTOMIZATION SHIPPED (RuneLite Tile Marking parity): rasterized as a convex-quad edge-function pass (centroid-normalized so vertex order/CW-CCW don't matter; s_i = len_i × perpendicular px distance ⇒ uniform border at ANY skew) — keys: `trueTile` master, `trueTileColor` '#rrggbb' (default 00ff00; engine validates 7-char #hex), `trueTileOutline` 1–8px solid border, `trueTileFill` 0–100% translucent interior (Pix2D hlineTrans integer-mix in-place), `trueTileOnlyDesync` hide-while-model-tile==server-tile (RuneLite "hidden" behaviour). Panel: master on Mods tab + Settings section (color swatch row, two unit sliders px/%, desync toggle) — panel grew `kind:'color'` rows and unit-labelled sliders (defaults now write `LS[f.key]` when no custom apply). Bresenham line helper removed (edge-pass supersedes it). Tunables verified headless (t/true_tile_raster_test.cjs: uniform runs at T=3, fill/border split, vertex-order independence). Also decoupled the settings hub while adding it: stat-orbs/xp-drops/anti-cheat/rendering keys now read at their own hook sites (see "The contract" — camera's applyCameraSettings is camera-only now).
- [x] **TCG card packs (OSRS TCG plugin parity) — SHIPPED 2026-09-15** (`mods/tcg/`, TYPE B+A). Design port of Azderi/osrs-tcg beta (BSD-2): credits from play (100c per 1,000 xp + level-up curve 1,250→25,000 @ steepness 2.5), 2,500c Standard Pack, 5 pulls, 7 tiers with the beta's cumulative roll odds (0.66/2/4/8/16/32/37.34), score = max(value, level²[×1.5 monster]), per-category percentile tiering + score/value tie-unification + global value lift + low-value(≤1)→Common, 1% foils, 1/3000 apex packs (top-3 tiers, 5× foil, ≥1 foil guaranteed), dup sell-back max(10, round(score)/200) keep-one. 6,376-card catalog (wiki Card.json data, art = OSRS wiki CDN 130px thumbs, lazy-loaded). ARCHITECTURE: core = files/ TS bundled via ONE import hunk (gpu pattern) + ui.js = page script via client.ejs hunk (panel pattern) + cards.json static. THE TERSER LESSON (cost hours, now law): the property mangler rewrites string-literal KEY definitions too — `W['tcgInfo']=…` inside the bundle becomes `W.Xk=…`, so (a) every cross-realm name needs a bundle.ts reserve (tcg hunk) AND (b) every cross-realm VALUE must be a POSITIONAL ARRAY, never an object literal (info()/albumRows()/catalogMeta()/pulls/save all arrays; index maps documented in tcg_core.ts header). localStorage saves are positional for the same reason — quoted keys would mangle per-build and orphan every collection. Login settle: tcgSetAccount opens a 5s rebase window (offline-trained jumps and the login burst never retro-pay; the UPDATE_STAT hunk is an unconditional `window['tcgOnXp']?.(stat,xp)` — the core owns all dedupe against its saved baseline). ::tcg chat command (album; staff≥2: give/roll) intercepted BEFORE the CLIENT_CHEAT passthrough. Panel: MOD_REGISTRY entry with live status + master key `tcg` (default on). Harness: `bun run ../lclite/mods/tcg/tools/tcg_test.ts` from webclient/ — 33 checks incl. 2,000-pull odds distribution vs beta and seed-replay determinism. NOT ported (deliberate): party/trading/webhooks/safe-mode/save-restore; kill-credits is the obvious next pass (needs NpcType combat level client-side). TWO FIELD FIXES after ship (user testing): HUD was viewport-top-right = under the LCLite FAB (clicks stolen, reveal behind panel chrome) — re-anchored to the canvas top-left per tick, layer z 1200→9600, and ::tcg got a visible 'engine not loaded' chat fallback instead of silent no-op; then Brave served a stale cached ui.js/cards.json past hard-refresh making it look unfixed — all page assets now version-keyed ?v=3 with the core stamp-check + self-heal described in The contract. Both lessons are the bullet points, not this paragraph — read those before shipping a DOM-layer mod.
- [ ] Keybind rebinds: TYPE B (GameShell key handlers) + TYPE A UI list
- [ ] Minimap zoom-sync to camera zoom: TYPE B, trivial (see sync comment in Client.ts)
- [ ] FPS counter / ping display: TYPE B read of `this.fps`, TYPE A widget slot
- [x] **GPU renderer (RuneLite equivalent) — SHIPPED 2026-09-10** (`mods/gpu/`, WebGL2). Design: CPU keeps ALL engine logic (culling/projection/lighting/picking untouched — `Model.mouseCheck` and `World.groundX` resolve exactly as before because they run before rasterization); the ONLY hijacked seam is the three `Pix3D` triangle entry points (`gouraudTriangle`/`flatTriangle`/`textureTriangle`), patched at module load via a single side-effect import hunk in `Client.ts` (line 1, ~87 pristine lines clear of the next mod's hunk). Captured triangles replay on the GPU in **capture order via `gl_FragDepth`** (GEQUAL, clear 0) = the painter's algorithm preserved exactly, blend mirrors `Pix3D.trans`'s integer mix (`ONE_MINUS_SRC_ALPHA/SRC_ALPHA` with `a=trans/256`; `trans=0` stays a plain overwrite), so translucent water/glass land where software put them. Texture sampling reproduces the rasterizer's affine plane bit-for-bit: same `<<14/<<8/<<5` int32 coefficients, `w>>14` (lowMem `>>12`) fixed-point division, `16256/4032` clamps, `0x3f80/0xfc0` row masks, `0xf8f8ff` 4-band R32UI texel array + the `(e>>21)&3`/`(e>>23)&31` shade-band extraction (e = `(shade<<17)|0`, textureRaster's accumulated word); holes `discard`, holeless-zero paints black — `textureRaster` has NO alpha branch (verified), replace always. Per-run scissor reproduces `Pix2D.setClipping` (headicon/label clips included). **Everything else stays software**: item icons, minimap, sidebar, chat, login/title — and the Pix2D overlay writes INTO the game buffer (bubbles/hitbars/trackers/orbs) are uploaded each frame as an R32UI texture and composited last, non-black = replace, which is exactly software's ordering (world first, overlays after) and what makes camera/xp-drops/stat-orbs pixel-identical with GPU on — zero coupling. Settings: `localStorage gpu` (default off), refreshed at `Pix2D.cls()` once per frame (never flips mid-frame; no `applyCameraSettings` hook needed). Self-disables + auto-falls-back on missing WebGL2/shader/link failure/context loss/`gl.getError`/triangle overflow (overflow frame stays correct: leftover tris ride the overlay). v1 honest gaps (also in file header): HSL shade steps per-pixel on GPU vs per-8px software (same look — RuneLite's GL shader made the same call), lowDetail's 4px blocks are a CPU artifact GL doesn't emulate, pure-black overlay pixels let terrain show through. `tools/gpu_parity_test.ts` (bun) rasterizes random tris through the REAL software rasters and a JS mirror of the shader: flat & textured paths EXACT (0 value mismatches), gouraud diffs traced to synthetic-colour-table HSL straddling + fill-rule edge jitter (GL diamond vs scanline top-left), not shader math. Tunables: `MAX_TRIS` 98304 (18.9 MB). Panel: Rendering group 'GPU rendering' toggle.
