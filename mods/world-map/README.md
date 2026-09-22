# mods/world-map

The client's own **world map**, on a globe orb beside the wiki orb. Click it and an
interactive map of the world fills the game window — terrain, place labels, the
point-of-interest icons and their key, monster and item spawns, multi-combat zones, the
dungeon and "extra" sheets, zoom, pan, and a **you are here** marker that follows your
character (switching to the sheet you are actually on). Click the orb again, press Esc, or
use the map's own close button and it goes away; the game never stops running behind it.

## Why this is a mod and not a feature port

The 2004 webclient **already contains the complete world map app**:
`webclient/src/mapview/MapView.ts` (a standalone `GameShell` subclass, ~1960 lines:
`renderWorldMap`, `labels.dat` place names, `mapfunction` icons with their key, npc/obj/
multi/free layers, an overview minimap, an export-to-PNG key) plus its own font pack
(`WorldMapFont.ts`). `webclient/bundle.ts` already builds it — it is one of the three
entrypoints, next to `Client.ts` and `OnDemandWorker.ts` — and the engine already serves
its data (`/worldmap.jag`, packed from the content maps by `tools/pack/map/Worldmap.ts`).

And then **nothing loads it**: no page, no button, no entry point. Upstream's map editor
(`/maped`) embeds its own viewer; a player has no way in at all. This mod is that missing
wiring plus the two things the app never had — a player marker and a UI around its canvas
— and it is **entirely client-side**: no server route, no packet, no new server-side data.
`apply --check`, `doctor`, `matrix` and `acceptance` all pass on it like any other mod.

## What's in the box

```
mods/world-map/
├── README.md                          this file (rule 7: it ships with any change)
├── files/
│   ├── webclient/src/client/WorldMap.ts        the game-side core (bundled into client.js)
│   ├── webclient/src/mapview/WorldMapCore.ts   the map-side core (bundled into mapview.js)
│   └── engine/public/lclite/worldmap/
│       ├── ui.js                      the overlay controller (page script)
│       ├── map.html                   the map document (inside the overlay's iframe)
│       └── (mapview.js)               NOT shipped — deployed by `lclite.mjs build`
├── patches/289/
│   ├── Client_ts.json                 4 hunks into webclient/src/client/Client.ts
│   ├── MapView_ts.json                4 hunks into webclient/src/mapview/MapView.ts
│   └── client_ejs.json                1 hunk into engine/view/client.ejs (the script tag)
└── tools/
    ├── world_map_test.ts              the harness (141 checks, both cores + MapView.ts)
    ├── world_map_edit.py              the idempotent, CRLF-preserving edit script
    ├── wm_site_search.py              brute-force site search (see §The parked-block landmine)
    └── wm_collateral_check.py         runs regen per candidate site and reports collateral
```

Both cores are DOM-free and client-free, so the harness exercises **the real shipped
code** headlessly — the orb's pixels and the marker's pixels included. `apply` copies them
verbatim; one import hunk each pulls them into their bundle.

## The hook sites

**`Client.ts` (the game — bundled into `client.js`)**

| # | site | what it does |
|---|---|---|
| 1 | the config-import block | imports the payload |
| 2 | before `gameLoop()` | the parked block: the settings read, the orb's box/hit test, the click hook, the pixel pass, and the page bridge (146 lines, one island) |
| 3 | before `const checkClickInput` in `gameLoop()` | `this.worldMapLoop()` — the orb's click, consumed before the engine's own click loops (the minimap's walk included) |
| 4 | before `this.worldUpdateNum = 0;` (the end of `gameDraw()`) | `this.worldMapDraw()` — the orb's pixels, after the minimap widget has been composited |

The orb is painted into the minimap **widget's own buffer** (the `areaMap` PixMap
composited at canvas 550,4), exactly like `mods/stat-orbs`' orbs and `mods/wiki-lookup`'s
orb, so it rides the interface and the gpu mod's HUD upload for free. Its default spot is
**immediately left of the wiki orb, a 2px gap** (the wiki orb's own default is the map
window's bottom-right corner with 3px clearance), so the pair reads as one row of orbs.

**`MapView.ts` (the map app — bundled into `mapview.js`)**

| # | site | what it does |
|---|---|---|
| 1 | the import block | imports the map-side core |
| 2 | before `loadWorldmap()` | the parked block: the player state, `worldMapUi(cmd)` (the page's ONE entry point), the sheet switch, "centre on me", the state array, and the marker's pixel pass |
| 3 | after `renderWorldMap(...)` in `mainredraw()` | `this.worldMapMarkerDraw()` — the marker in the map's own pass |
| 4 | inside `loadWorldmap()` (a REPLACE) | the jag URL comes from `WORLD_MAP_JAG_URLS[this.worldMapJagIndex]` instead of the hardcoded `/worldmap.jag` (see §The map data) |

`mods/world-map` is the first mod to touch `webclient/src/mapview/MapView.ts` — which is
also why `regen.mjs` lists it for this mod, and why this mod's code is the only mod code
that ships in `out/mapview.js` rather than `out/client.js`.

## The cross-realm contract (reserved names, positional arrays)

Four names are terser-RESERVED in `bundle.ts` (they ride the control-panel island's
reserve line, next to the `lcm*` placement names):

| name | written by | read by | shape |
|---|---|---|---|
| `worldMapToggle` | `lclite/worldmap/ui.js` (page) | the game bundle's orb click | `(centre: 0\|1)` |
| `worldMapPlayer` | the game bundle (`WorldMap.ts`'s payload, via `Client.ts`) | the page's poll | `[x, z, level, valid]` — world TILES |
| `worldMapUi` | the map app's bundle (`MapView.ts`) | `lclite/worldmap/map.html` | `(cmd: number[]) -> number[]` |
| `lcmWorldMapBounds` | the game bundle | the panel's drag layer | `() -> [x, y, w, h] \| null` |

Every VALUE that crosses a bundle boundary is a **positional array** — an object literal's
keys are renamed by the property mangler, so the page would read `undefined` for every
field (the tcg HUD's own bug). The command ops and the state array's index map are
documented in `WorldMapCore.ts` and asserted by the harness. A bundled READ of an
unreserved name is the silent failure, a write is the loud one, so both sides of each pair
are reserved.

**Fail-open everywhere.** With the page script missing (a stripped hunk, a stale cache) the
orb's click is a no-op; with the map bundle or the map data missing the overlay says so in
words and the game is untouched.

## The map data

The map app reads a `JagFile` of the packed world map. Where that comes from, in order:

1. **`/worldmap.jag`** — the engine's own route (`engine/src/web.ts`). It is registered
   **inside `if (Environment.node.debug)`**, so it exists on a dev world (the launcher's own
   local world, and any `npm run quickstart` world) and **404s on a production one**.
2. **`/client/worldmap.jag`** — a plain static file under `engine/public`, which every world
   serves. `node tools/lclite.mjs build` deploys the install's own packed jag there
   (`engine/data/pack/mapview/worldmap.jag`, written by the engine's map packer). That copy
   is also what makes the map work through the launcher's join bridge: the bridge serves
   `/client/*` from the LOCAL install even when the game itself is on somebody else's world.

`lclite/worldmap/map.html` probes both (in that order, `cache: 'no-cache'`, size-checked)
**before** booting the app, and hands the app the index it found via `worldMapUi([7, index])`
— an index, because a path is a string and a string cannot cross the bundle boundary as a
value. That probe exists because `MapView.loadWorldmap()` retries forever on a failed fetch
and does **not** check `response.ok`: a 404 would hand it an HTML error page to parse.

`lclite.mjs build` also deploys **`out/mapview.js`** → `engine/public/lclite/worldmap/` (the
map app's bundle — the same build step that deploys `client.js`, because the map app is
built by the same `bun run bundle.ts`). Nothing upstream ever deployed it; without that step
the mod's page reports a missing app in words.

## Settings contract

This mod's OWN localStorage keys (rule 5 — no hub, no other mod's key), read **every frame**
at the mod's own hooks, so a change lands on the next frame.

| key | values | default | panel row |
|---|---|---|---|
| `worldMap` | `'true'`/`'false'` | `'true'` | the master switch on the mod's row |
| `worldMapButton` | `'true'`/`'false'` | `'true'` | *Minimap world button* |
| `worldMapCentre` | `'true'`/`'false'` | `'true'` | *Centre on me when it opens* |
| `lcmWorldMapAnchor`, `lcmWorldMapOffset` | anchor name + px offset | `'BR'`, `'-47,-24'` (documentation — a canvas surface's default spot IS its box) | written by the panel's drag layer ONLY |

Only the literal `'false'` turns the master or the orb off. The panel also has an *Open the
world map* action row (the orb's click, without the orb) and a *Reset button position* row,
which asks the drag layer to clear the placement keys — the drag layer is the only writer of
those, so a reset never races it. The orb is a **canvas-buffer surface**
(`lcmAnchor.registerCanvas` with the minimap widget's region `[550, 4, 172, 156, 172, 156]`),
so it clamps FLUSH to the panel and is alt-draggable like every other surface on it.

## The overlay, and why it is an iframe

The map app is a second `GameShell`: it takes `#canvas` at module load and runs its own
mainloop. Booting it inside the game's page would fight the game for the canvas, the input
and the loop — so `ui.js` builds a fixed-position div **sized to the game canvas' rect**
(scale, position and letterboxing included, via a ResizeObserver plus scroll/resize
listeners) and puts the map document in an iframe inside it, scaled by CSS. The overlay is
z-index **9400**: above the game canvas, **below** the LCLite FAB (9500), the tcg HUD (9600)
and the panel, so a player can still open the panel over the map.

The parent polls the bundled `worldMapPlayer()` at 4Hz while the map is open and posts the
position to the iframe **only when it changes** (the map app redraws the world map for every
accepted position — real work, and pointless while standing still). The map page sends back
`close` / `ready` / `error`, and Escape closes from either side. Opening the map focuses the
iframe, so the game does not keep the keyboard while the map is up.

## Deliberate divergences, and limits

- **The spawn layers are the app's own, and they are dots.** `npc.dat` / `obj.dat` in the
  jag are per-tile BOOLEANS (the engine's packer writes `pbool(...)`), so the map can say
  "an NPC spawns here" but not which one. Per-monster data (names, levels, drops) is not in
  anything the client can read: 2004Scape keeps npc/obj spawns in the SERVER's map store
  (`n<m>_<z>`, `o<m>_<z>` in `maps-server.zip`), which the client never downloads. A
  MonsterMap-style named-monster table would need a baked data file shipped in the payload,
  generated by a tool run against the server's own maps — deliberately not in this pass.
- **Labels, the POI key, multi-combat zones and the F2P/members sheet** are the app's own
  layers, surfaced by the toolbar's checkboxes (NPCs, Items, Labels, Multi) plus the app's
  own bottom bar (Key, zoom, Overview, and `E` for a PNG export).
- **The toolbar covers the map's top 24px.** It is the mod's own chrome, drawn over the
  app's canvas (the app's own controls live in the bottom bar, so nothing is occluded).
- **A world with no map data shows an honest card**, not a broken map.
- **289 and 274 only** (274 inherits the 289 corpus). 254 has its own corpus and this mod is
  not ported to it — same as camera, control-panel, hotkeys, stat-orbs and xp-drops.
  `node tools/port.mjs 254` is the one command that changes that.

## The parked-block landmine (a real one, with the recipe)

The mod's Client.ts methods + fields are parked in ONE 146-line island. **Where that island
lands changes how `git diff -U0` aligns the whole file**, and at several sites it split
seven of `mods/ground-items`' islands into marker-less fragments that regen then filed under
`camera` — `doctor` exits 3 on those (`hunk has no marker`), and a marker-less fragment
would be applied by whichever mod the fallback routed it to.

The clean sites and the dirty ones were found by brute force (`tools/wm_site_search.py` inserts
the same block at every method boundary in the pristine file and reports the marker-less
island count): `before gameLoop()`, `before gameDrawMain()` and `before getSpecialArea()`
are clean; `before minimapDraw()`, `before drawSide()`, `before drawChat()`,
`before minimapDrawDot()` and `before addChat()` are not (88-91 islands, 7 marker-less).
The block sits before `gameLoop()`.

**After any edit to this mod, check three things before believing a green `apply`:
`node tools/doctor.mjs` exits 0 (not 3), `node tools/selfcheck.mjs` says the drop-in
contract holds, and `git status --short mods/` names ONLY `mods/world-map/*` plus the
control-panel files this mod deliberately edits (`panel.js`, `patches/289/bundle_ts.json`,
`patches/289/client_ejs.json`).** A patch JSON of another mod changing is the tell that an
island was re-routed.

Two more hand-edit laws this mod ran into:

- **`regen` reads the TREE, and `apply` re-inserts whatever the patch JSON says.** The
  scaffold's demo hunk (a script tag at `<body>`) was hand-removed from the tree and then
  re-inserted by the next `apply`, because the patch JSON still described it — the fix was
  to delete the stale patch JSON and regen, not to hand-edit the tree twice.
- **`apply` is what copies `files/` and rewrites `installed.json`, and it writes the
  manifest from the mods it can VERIFY as installed** — a hunk's `replace` text must be in
  the tree. So a tree edited by this mod's script but NOT yet regenerated has a stale
  corpus, and the next `apply` silently drops the mod from `installed.json` (and therefore
  from the F1 panel's list, which the manifest IS). The order is always: edit the tree →
  `regen` → `apply`. Two more consequences of the same law: a tree whose `installed.json`
  predates the mod shows no panel row for it at all, and the engine caches the rendered
  page — the world has to be restarted after a `client.ejs` change before the page carries
  the mod's script tag.

## Verified

- `tools/world_map_test.ts` — **141 checks, all green**, run against both the `files/`
  payload and the copy inside an applied tree (`LCLITE_ROOT=<install>`), which also reads
  that tree's own `MapView.ts`: the settings table (defaults, clamps, one key never turning
  another off); the orb's geometry (the default spot 2px left of the wiki orb's own default,
  the anchor maths, the clamps, the 21x21 hit test); the orb's **pixels** (nothing outside
  the box, no pixel written as 0, 317 painted of 441, hover/open/pulse all different, tick
  16 = tick 0, the glyph's 49-cell table and ink count, and a too-small glass getting no
  glyph); the payload's positional shape; the **area table re-derived from MapView's own
  `reloadMain`/`reloadDungeon`/`reloadExtra` and asserted equal**; the world→map transform
  (including the z flip and a cutscene region landing on no sheet); the marker's screen
  geometry at zoom 4 and 8 (screen px per map tile = zoom/2, straight out of
  `renderWorldMap`'s own `widthRatio`); the marker's pixels, pulse and caption (level
  suffix, both edge clamps); the command parse (every op, plus null, strings, empty arrays,
  out-of-range ops/areas/layers, NaN); and the state array's 12 documented slots. It also
  prints the orb and the marker as ASCII art.
- `tsc --noEmit` clean on the full tree (both cores and both patched files).
- `regen` twice byte-identical · `apply --check` ✗0 on all 16 mods (9 hunks for this one)
  · `doctor` exit 0 with no findings · `selfcheck` holds (the template's own anchors survive
  this mod being applied).
- `node tools/matrix.mjs` green on every declared revision: 289 own corpus 142 hunks exact,
  **274 inherits all 142 exactly** (the MapView hunks included), 254 untouched.
- `bash tools/acceptance.sh` byte-compares a pristine clone at the pinned revs against the
  live install (this mod's payload and patch JSONs included) and proves the converge
  round-trip byte-stable.
- `node tools/lclite.mjs build` deploys `client.js`, `lclite/worldmap/mapview.js` and
  `client/worldmap.jag`; `curl` on a booted dev world returns 200 for
  `/lclite/worldmap/ui.js`, `/lclite/worldmap/map.html`, `/lclite/worldmap/mapview.js`,
  `/worldmap.jag` and `/client/worldmap.jag`.
- Browser, on a booted world: the page carries `/lclite/worldmap/ui.js?v=1`; the panel lists
  **World map** with the registry wording and a master switch; `window.worldMapToggle` exists;
  opening it builds `#lcwm-root` at exactly the canvas rect (765x503 at z 9400) with the map
  app booted inside — the map canvas renders the world map (378,926 non-black pixels of
  384,795), the toolbar reads the app's real state, and no error card appears. In game,
  `window.worldMapPlayer()` exists and returns a positional payload.
- **The orb's click and the marker's pixels in a live in-game frame are player-verified** —
  see the checklist below.

## What to check in game

1. The **globe orb** on the minimap panel, immediately left of the wiki orb: it should read
   as a sibling of the wiki orb (same stone rim, dark glass, a small globe mark).
2. Click it: the map should fill the game window, centred on you, with a **red/white "You are
   here"** marker under your feet and its caption below it. Walk a few tiles — the marker
   should follow (it refreshes ~4x a second).
3. The orb should glow gold while the map is open, and clicking it again should close the
   map. **Esc** and the toolbar's **×** should close it too.
4. The toolbar: **Area** (Main/Dungeon/Extra), **NPCs**, **Items**, **Labels**, **Multi**,
   zoom, **Centre on me**. Walk into a dungeon (or `::home` and then a cellar) and press
   *Centre on me* — the map should switch to the **Dungeon** sheet and re-centre, with the
   caption reading "(level 2)" and up.
5. **Alt+drag** the orb somewhere else; it should move, survive a reload, and
   **Alt+right-click** (or the panel's *Reset button position*) should put it back.
6. The panel's *Open the world map* and *Centre on me when it opens* rows.
7. The game must keep running behind the map (you should still take damage, gain xp, etc.)
   and the LCLite FAB must still open over it.
