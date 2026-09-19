# mods/gpu

A hardware renderer for the 3D world, in the spirit of RuneLite's GPU plugin —
the CPU keeps doing everything it is good at (scene construction, culling,
lighting, painter ordering, and **all** picking) and only the pixel work moves
to the GPU. The seam is three `Pix3D` triangle entry points
(`gouraudTriangle` / `flatTriangle` / `textureTriangle`), patched at module load
via a side-effect import on line 1 of `Client.ts`; captured triangles replay
one-to-one, so what the GPU draws is the software frame, just resolved by the
depth unit instead of the CPU raster. Chat, interfaces, item icons, the minimap
and the sidebar **stay software on purpose** — they are pixel-exact by
construction, and the mod can therefore be turned on and off mid-session
without changing anything you read or click.

Backend: **WebGPU** (native `navigator.gpu` + WGSL from TypeScript — no
Rust/wgpu/WASM; the scope decision and the browser probes are in
`docs/archive/gpu-v2-assessment.md`). This is v2: v1 (2026-09-10) was a WebGL2
build, rewritten the same day. `docs/MODS.md`'s ideas-register entry keeps the
v1 design record and carries the v2 story at its end.

## What's in the box

Four files under `files/webclient/src/gpu/` (they are **bundled into client.js**,
so editing them needs a build — unlike the control panel's `panel.js`, which is a
page asset):

- `GpuFormat.ts` — the backend-neutral **capture contract**: vertex stride
  `VS*4` = 64 B, slots `[0..1]` screen xy (already projected by the CPU to
  512x334 game-buffer pixels), `[2]` shade word, `[3]` mode, `[4]` capture
  sequence, `[5]` alpha (`Pix3D.trans/256`), `[6..11]` u, v, w, texId. Also
  `MAX_TRIS` (65536 → 12.6 MB capture; a busy 289 scene runs 15-30k).
- `GpuShaders.ts` — the WGSL: scene (gouraud / flat / textured, depth from the
  sequence number, colour-table decode, affine texel walk) and the HUD overlay
  pass.
- `GpuContext.ts` — the whole lifecycle: adapter → device → DOM overlay canvas
  → configure. Every failure returns a human-readable string; nothing is
  swallowed. GPU handles are typed `any` at this boundary only, because the
  overlay must not add a `@webgpu/types` dependency.
- `GpuRenderer.ts` — capture (`installPatches`, `captureTri`, `captureTexTri`),
  pipelines, the texel-pool upload, and the composite.
- `patches/Client_ts.json` — 1 hunk: the side-effect import. That is the entire
  engine-side footprint (plus control-panel's `bundle.ts` hunk, which reserves
  the `window.lcliteGpu*` names the panel reads).
- `tools/gpu_parity_test.ts` — the bun harness: random triangles go through the
  REAL software raster and through a JS mirror of the shader math, then the two
  are compared per pixel (the colour table is made a bijection so the report is
  in shade-index units). Its `./src/*` imports are webclient-root-relative by
  design (they need the engine's rasters plus the applied `GpuRenderer.ts`), so
  COPY it into an applied webclient tree first:
  `cp mods/gpu/tools/gpu_parity_test.ts <install>/webclient/ && cd
  <install>/webclient && bun gpu_parity_test.ts`. Diff the output against the
  golden numbers in the harness header (gouraud big 7729 / maxd 246 · flat 0/0 ·
  tex d1 15) — a change in them is a regression, not noise.

## Settings + status contract

- `localStorage 'gpu'` — the mod's master switch, **default OFF**, re-read once
  per frame at `Pix2D.cls()` so it can never flip between the world render and
  the composite inside one frame. Read at the mod's own hook site (no hub);
  written by the control panel's top-level **GPU** row.
- `localStorage 'gpuPixelScaling'` — `'pixelated'` (**default**) or `'auto'`: the
  mod's **Pixel scaling** setting, the one row in its panel section (the panel
  writes the key, the mod reads it per frame). The mod OWNS `#canvas`'s inline
  `image-rendering` with it — the same style `place()` copies onto the overlay,
  so the game rect scales exactly like the sidebar, chatbox and minimap beside
  it. With the GPU off (or self-disabled after a failure) the canvas is put back
  to `'auto'`, so pixel scaling is a GPU feature by construction: `pixelated` is
  the page stylesheet's own look for `#canvas`, `auto` is the smooth opt-out.
  It is written at `attach()`, again on `window` `load` (the body's own
  `loadSettings()` runs *after* this module and would otherwise clobber it from
  the page's legacy `filtering` key), and then every frame at `Pix2D.cls()` —
  which only runs on a game frame, so a change made in the panel lands on the
  next one, exactly like every other mod's settings (the title screen keeps
  whatever the two boot-time writes set). Compare-guarded, so steady state is
  one string compare per frame. This replaced the LCLite core row, which wrote
  the page's `filtering` key and claimed "Pixelated" by default while the page
  actually booted `auto` (smooth) — a panel row's `def` is a display fallback,
  never an applied default.
- `localStorage 'gpudbg'` — `'1'` draws the P1 proof triangle through the same
  canvas/place/depth plumbing (no capture, no overlay). One glance separates
  "backend/canvas broken" from "capture/depth wrong".
- `window.lcliteGpuStats` — `{ frames, tris, batches, ms, cpuMs, hud, glFrames,
  swFrames }`, live. The panel row prints `tris△ · calls · ms`.
- `window.lcliteGpuError` — set to the verbatim reason on any init/validation/
  device-lost/error-scope failure; the panel row shows it as `off: <reason>`
  and the mod flips its own `gpu` key off. `window.lcliteGpuReady` is true only
  once the backend is live (cleared on any failure); the panel's `starting…`
  state is `stats.frames === 0`.

## Deliberate divergences / honest gaps

- **The overlay is a real DOM canvas**, positioned over the game rect with
  `alphaMode:'opaque'` — not a readback. A detached or `display:none` WebGPU
  canvas may never be presented (Dawn presents only what the page renders), so
  a `drawImage` readback can read an empty buffer; with a visible canvas there
  is no presentation variable at all. The trade-off is that a `#canvas`-only
  fullscreen needed a reparent (shipped in P7) — the software mode never had
  the problem.
- GPU frames clear the game buffer to `SENTINEL` (`1 << 24`, in `GpuFormat.ts`)
  instead of 0 or 1: the overlay paints every other pixel verbatim, so the
  sentinel must be a value the software renderer cannot produce. 0 is
  `Colour.BLACK` (minimenu bar, text shadows) and 1 is the engine's own black
  for **sprites** — `Pix32.depack` bumps a palette entry of 0 up to 1 so it
  stays distinct from transparent, and `ObjType` writes an item icon's outline
  as a literal 1 — so both values punched holes in black pixels and let the
  world show through them. `1 << 24` is unreachable: every writer packs 24 bits
  (see "Sprite black vs the sentinel" below).
- **Interface models stay software.** `TYPE_MODEL` components (the
  character-design preview; any interface showing a 3D model) render through
  `Pix3D` with the game buffer bound, which is indistinguishable from world
  geometry to the capture layer — but they are drawn *into an interface* that
  the overlay then repaints on top of, so a captured model ends up under its own
  interface background and disappears. Capture is suspended around
  `Model.objRender` (the interface/icon entry point — world geometry goes
  through `worldRender`), so those triangles take the software raster in painter
  order, exactly as they would with the mod off.
- The overlay copies the page canvas's `image-rendering` instead of forcing
  `pixelated`, so the game rect scales exactly like the sidebar, chatbox and
  minimap beside it — and that style is this mod's own **Pixel scaling**
  setting now (see the settings contract): `pixelated` by default while the GPU
  is on, `auto` whenever it is off.
- Capture overflow past `MAX_TRIS` degrades honestly: the leftover triangles
  fall through to the software raster and ride up with the overlay, so the
  frame stays correct.
- HSL shade steps are computed per-pixel on the GPU where the software steps
  them per 8px, and low-detail's 4px texture blocks are a CPU artifact WGSL
  does not emulate. RuneLite's GL plugin made the same call; the look matches.
- On Windows the adapter is requested BARE — Chromium ignores
  `powerPreference` there and logs a console notice for asking anyway
  (crbug.com/369219127), so `GpuContext.prefersBareAdapter()` keeps the console
  clean while the high-performance hint stays on the platforms that honour it
  (dual-GPU Macs). The bare-retry fallback Brave's fingerprinting defenses need
  is unchanged.
- The mod never touches the software renderer: with `gpu` off, or after any
  failure, the client is bit-identical to a build without the mod (that is what
  the corpus's byte-compare acceptance covers).

## Sprite black vs the sentinel (why the interfaces looked "shiny")

The engine has TWO blacks. `Colour.BLACK` is 0 and is what `Pix2D.fillRect` and
font ink write; a **sprite's** black is 1, because `Pix32` stores resolved
colours with 0 meaning "transparent" — so `Pix32.depack` bumps a palette entry
of 0 up to 1, and `ObjType.getSprite` writes an item icon's outline as a literal
1. `Pix32.plot` copies any non-zero source pixel verbatim.

v2 cleared the buffer to 1, so every one of those pixels equalled the sentinel
and the overlay discarded it: the world showed through every black pixel of
every sprite drawn into the game window — item icons in the shop (their 1px
outline), the yellow/red click crosses (36 of a 10x10 cross's 100 pixels),
headicons including the multi-combat sign, interface graphics, buttons,
scrollbars. Measured on the click cross before the fix: 60 near-black pixels in
the cross's box with the GPU off, 28 with it on. The same sprite in the sidebar
inventory looked right, because the sidebar is a different `PixMap` and never
goes through the overlay — which is why the shop is where it got noticed.

Nothing else in the engine can collide with `1 << 24`: `Pix2D` primitives and
font ink pack `(r << 16) + (g << 8) + b`, `Pix32`/`Pix8` blits store palette
colours, the `Pix3D` rasters store `gammaCorrect`'d `0xRRGGBB` with each channel
<= 255, and `PixMap.prepareCanvas` drops the top byte on the way to `ImageData` —
so a leaked sentinel composites as black, never as garbage.

## The logout freeze (fixed)

With the GPU on, logging out left the last game frame frozen over the login
screen until a page reload — the bug this mod has had since v1. The engine stops
drawing the game buffer the moment the client leaves the world: the title screen
draws only its `imageTitle*` buffers, and `prepareTitle` early-returns once those
exist, so nothing ever called `onGameDraw` again and the overlay kept its last
presented frame on top of the login screen. The patched `PixMap.draw` now
notices a composite of any other buffer and hides the overlay when
`window.lostcityClient.ingame === false` — the engine's own "not in a world"
flag, read through the handle the camera and tcg mods use (bundled code reading a
bundled field is mangle-consistent by construction, and importing Client here
would be a load-order cycle). It fails open: anything other than an explicit
false leaves the overlay alone.

## Comment fixes from the earlier "stale comments" note

Both are done: `GpuRenderer.ts`'s header now reads the phases as history
("P2 capture -> P5 textures -> P7 HUD/perf") instead of claiming P2 scope, and
the doc paths point at `docs/archive/gpu-v2-assessment.md`.
