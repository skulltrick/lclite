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
  in shade-index units). Run it from the installed revision's `webclient/`,
  pointing at the overlay you are editing:
  `bun run <overlay>/mods/gpu/tools/gpu_parity_test.ts` — never the install's
  own `lclite/` copy, which is a snapshot from install time.

## Settings + status contract

- `localStorage 'gpu'` — the mod's master switch, **default OFF**, re-read once
  per frame at `Pix2D.cls()` so it can never flip between the world render and
  the composite inside one frame. Read at the mod's own hook site (no hub);
  written by the control panel's top-level **GPU** row.
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
- GPU frames clear the game buffer to `SENTINEL_BLACK` (1) instead of 0, so
  genuinely black HUD pixels (minimenu title bar, text shadows) survive the
  overlay's "non-sentinel = HUD" rule.
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

## Known stale comments in this mod (fix at the next rebuild)

These are comment-only, so they do not change behavior — but they mislead:

- `GpuRenderer.ts`'s header still describes "P2 scope (this build)" as textured
  faces drawn as flat average colour, with "real texel sampling + hole discard
  is P5". **P5 shipped 2026-09-11**: `captureTexTri` + the 50-layer r32uint
  texel pool + the WGSL texel walk are all in this same file.
- `GpuRenderer.ts` and `GpuFormat.ts` both point at `docs/gpu-v2-assessment.md`;
  that file now lives at `docs/archive/gpu-v2-assessment.md`.
