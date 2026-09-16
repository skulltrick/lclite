# mods/low-detail

RuneLite's **Low Detail** plugin, as a switch inside the running client instead of a
second webclient launched with `?lowmem=1`. Per RuneLite's own description it turns off
ground decorations (pebbles, grass) and some textures; here that maps onto the engine's
three existing low-memory knobs:

| flag | what it does | when this mod applies it |
|---|---|---|
| `World.lowMem` | textured ground → flat average colour (`TEXTURE_AVERAGE` + `gouraudTriangle`) — the big win, ground rasterization is the most expensive path | per frame (live) |
| `Pix3D.lowMem` | half-size textures + the `lowMem` texture raster path + no `texTrans` | **boot only** |
| `ClientBuild.lowMem` | skips `LocShape.GROUND_DECOR` (flowers/grass/pebbles) and off-level geometry at scene-build time | boot, then re-derived by the builder from `World.lowMem` |

## Why the split is not lazy

`Pix3D.lowMem` decides the **texture and texel-pool layout at unpack time**
(`Pix8.halveSize()`, a 16,384- vs 65,536-int slot per texture, `texTrans` computed during
upload). Flipping it mid-session would leave already-uploaded textures in the other
layout and the rasterizer reading the wrong strides — wrong colours on any surface that
still samples a texture. So this mod sets it once, during construction, and never touches
it again. Consequence, and the panel row's description says so: turning the switch ON
mid-session gives the untextured ground **immediately**, ground decorations as you reach
the next area, and the halved-texture memory saving only after a **client refresh**.

`ClientBuild.lowMem` needs no live write either: the scene builder re-derives it from
`World.lowMem` on every build, so the per-frame hook driving `World.lowMem` is enough for
decorations and geometry to thin out as you walk into the next area.

## What's in the box

- `patches/Client_ts.json` — TWO hunks:
  1. `Client.setHighMem()` (constructor path): reads the key **once**, before the load
     sequence unpacks textures/sounds, and turns on `World.lowMem` + `Pix3D.lowMem` +
     `ClientBuild.lowMem`.
  2. `Client.gameDrawMain()`: per-frame `World.lowMem = key || Client.lowMem` — the live
     half of the switch.

## Settings contract

- `localStorage['lowDetail']` — this mod's OWN key, read at its own hook sites (`'true'`
  = on). A missing key is off. No other mod's key is touched, and nothing here is routed
  through the camera mod's `applyCameraSettings()`.
- Panel row: `MOD_REGISTRY` entry `low-detail` (`master.key === 'lowDetail'`), off by
  default — same default as RuneLite's plugin.

## Deliberate divergences

- **`Client.lowMem` is NOT set by this mod.** That flag is the low-memory *client* launch
  mode, not a graphics setting: it skips MIDI/sound loading (so turning it off later would
  leave `JagFX` uninitialised), sets the `lowMemory` bit the server reads in `PlayerOps`,
  and gates the >50-player animation culling. Opting into "flat ground" must not silently
  take your music away, so the mod sticks to the three rendering flags.
- **`?lowmem=1` still wins.** If the client was launched with the low-memory param the
  constructor calls `setLowMem()` instead, `Client.lowMem` is true, and the per-frame hook
  honours it (`|| Client.lowMem`) — the switch can only ever *add* low detail, never
  downgrade a low-memory session.
- **No roof removal here** (that is `mods/hide-roofs`) and no draw-distance change:
  `viewRadius`/`farPlane` belong to the camera mod's zoom parity, and shrinking them saves
  nothing measurable in the browser while breaking zoom framing.
