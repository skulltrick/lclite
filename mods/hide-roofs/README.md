# mods/hide-roofs

The classic **"Remove roofs: Always"**: roofs come off everywhere, not only once you are
standing under them. Vanilla already removes a roof when you walk into a building (it
uses the map's `RemoveRoof` flag to decide); this mod simply always answers the way the
engine answers when it decides a roof is in the way. Off by default in the panel.

Player-visible effect: walking past Draynor Manor / any multi-storey building shows the
ground floor and walls with no roof and no upper storey in the way, and the change lands
on the **very next frame** — flipping the switch in the panel rebuilds nothing and
reloads nothing.

## What's in the box

- `patches/Client_ts.json` — ONE hunk, inside `Client.roofCheck()` (the method that
  answers "what is the highest level that still draws?"). When the mod is on it returns
  `this.minusedlevel` (the player's own level) instead of walking the camera ray; with
  the mod off the upstream code below it is untouched.

## Why it is a one-line answer

`Client.gameDrawMain()` calls `roofCheck()` every frame and hands the result to
`World.renderAll(..., level, ...)`, where `tile.drawLevel <= maxLevel` decides which
levels draw and `World.maxLevel` picks the occluder list. So the *only* thing "roof
removed" means in this client is "answer with `minusedlevel`" — which is exactly what
upstream returns the moment you stand under a roof. Forcing that answer hides roofs and
the storey above the player, and everything downstream (occlusion, the minimap, walk
picking) stays consistent because it is the engine's own value, not a renderer hack.

## Settings contract

- `localStorage['hideRoofs']` — this mod's OWN key, read at its own hook, **per frame**.
  `'true'` (the panel's Mods-tab switch) = always remove roofs; anything else (unset,
  `'false'`) = upstream's selective behaviour. No other mod's key is read.
- Panel row: `MOD_REGISTRY` entry `hide-roofs` in
  `mods/control-panel/files/engine/public/lclite/panel.js` (`master.key === 'hideRoofs'`).

## Deliberate divergences

- **The cinema-camera path is untouched.** `roofCheck2()` (used when `cinemaCam` is set)
  keeps vanilla behaviour — cutscene framing should not change under a player setting.
- **The whole storey goes, not just roof-shaped models.** That is the engine's own
  mechanism (the level above the player stops drawing), and it is what you see in
  vanilla when you step inside. Hiding only `LocShape.ROOF_*` models instead would mean
  patching the scene builder, which would (a) need a rebuild per toggle, (b) drop the
  `mapo |= 0x924` occlusion flags roofs set, and (c) keep upper-floor furniture visible.
- **Independent of `low-detail`** (roofs are not part of that mod's switch), so the two
  can be combined or used alone — same as the OSRS settings menu.
- **Matching the mod's name, there is only one mode.** The vanilla "Selective" mode is
  just this mod switched off, and "Off" (roofs never hidden, even indoors) is not
  offered: it fights the map data rather than expressing a preference.
