# GPU v2 — Architectural Assessment (pre-implementation)

Date: 2026-09-10. Status: investigation complete, no v2 code written yet.
Scope decision: WebGPU from TypeScript (native `navigator.gpu`, WGSL). No Rust/wgpu/native/WASM.

## 1. What we're working against

- Client actually in use: `webclient/` TypeScript webclient (LostCityRS/Client-TS @ bd6cad7), served by the engine at `http://localhost/rs2.cgi`, built with `bun run bundle.ts` → deployed to `engine/public/client/client.js`. (The `javaclient/` repo exists but is not our target.)
- The working tree is the lclite-modded client: camera/xp-drops/orbs/anti-cheat/rendering/panel hunks + the failed v1 "gpu" mod. The v1 gpu mod is **one side-effect import in `Client.ts` line 1** + `src/gpu/GpuRenderer.ts` (960 lines) — surgically separable from the other mods.
- Browser reality (probed on the dev machine, 2026-09-10): Chrome 152. WebGPU adapter + device + canvas configure (`bgra8unorm`) + WGSL compile + a triangle draw all succeed headlessly. `maxBufferSize` 2 GB. Phase 1 has no platform risk.

## 2. The software render pipeline (traced)

### Frame path
`gameDraw()` (Client.ts:4112) → `gameDrawMain()` (:4394):
1. Entities pushed into the world each frame: `addPlayers/addNpcs/addProjectiles/addMapAnim` → `World.addDynamic(2)`/`setObj`/etc. — scene construction stays untouched by the renderer swap.
2. Camera: `camFollow(pitch, yaw, orbitX, eyeY - 50·z, orbitZ, (pitch·3 + 600)·z)` (:4421) → `camX/camY/camZ/camPitch/camYaw`. Pitch ∈ [128, 383] (2048 = 360°), yaw 0..2047, `cameraZoom` is the lclite 0.4–2.6 scale.
3. `roofCheck()` picks the visible level.
4. `Pix2D.cls()` (:4473) clears the 512×334 game buffer (`Pix2D.pixels` Int32Array bound by `setPixels`).
5. `world.renderAll(camX, camY, camZ, level, camYaw, camPitch)` (World.ts:1033) — the entire 3D scene raster.
6. `entityOverlays(); coordArrow(); textureRunAnims(); otherOverlays()` (:4475–4478) — chat bubbles, hit splats, headicons, XP tracker, orbs — CPU Pix2D writes **into the same game buffer**, on top of the 3D scene.
7. `areaGame?.draw(4, 4)` (:4479) — `putImageData` of the buffer into the 765×503 page canvas at rect (4,4)–(516,338). Sidebar/chat/minimap are separate PixMaps blitted at fixed rects (gameDraw :4112ff).

### renderAll internals (World.ts)
- Sets trig statics + `World.cx/cy/cz` (camera), `gx/gz` (camera tile), view window `minX..maxZ = gx ± viewRadius` (default 25 tiles, lclite grows to 63 with zoom).
- Per level → per tile: visibility via precomputed `visBacking` table (or live `visTileAt` frustum probe when zoomed — lclite), roof/occlusion (`calcOcclude`, `groundOccluded`).
- Painter's queue: `fill()` (:1520) drains squares back-to-front (BFS from camera-adjacent tiles, adjacency/sprite-span rules); each tile renders linked ground, walls, decor, ground-decor, objects, dynamic entities — all via `renderGround` (World.ts:2220) or `Model.worldRender(yaw, sinPitch, cosPitch, sinYaw, cosYaw, relX, relY, relZ, typecode)`.

### Model geometry (Model.ts)
- Raw data: `pointX/Y/Z` (y = height axis), faces `faceVertexA/B/C`, `faceRenderType` (0=gouraud, 1=flat, 2/3=texture; `&0x3`, texture id at `>>2`… see render3), `faceColourA/B/C` = **lit shade indices** (written by `calculateNormals/light` :1457–1606 from ambient/contrast/directional light + `World.shareLight*`), `facePriority` (12 buckets incl. 10/11 interleave specials), `faceAlpha` (→ `Pix3D.trans`), `faceTextureP/M/N` = indices of three **world-space texture-plane control vertices**.
- `worldRender` (:1717): model yaw rotate + translate by camera-relative → eye yaw → eye pitch → **RS2 projection: `sx = originX + (x << 9) / z`** (512 = scale, integer divide), near clip `z ≥ 50` (`Pix3D.nearPlane` exists but the 50 is hardcoded here and in render2 culls). Verts failing the clip get `screenX = -5000` → their faces route to `render3ZClip` (:2158, CPU near-plane triangulation). Entity-level cull: radius sphere vs farPlane, plus screen-quad rejects.
- `render2` (:1838): per-face backface cull (cross product ≤ 0 skip), bucket into depth array `z̄ + minDepth`, draw far→near; `facePriority` models interleave priorities 10/11 (blends/overlays) by average-depth comparison (:1955ff) — the classic RS2 "translucent stuff draws over/under by buckets" behavior.
- `render3` (:2085): dispatch to the three raster entry points:
  - `Pix3D.gouraudTriangle(xA..yC, cA,cB,cC)` — colours are indices into `Pix3D.colourTable` (65536-entry gamma+brightness table, `>> 8` index, Pix3D.ts:961),
  - `Pix3D.flatTriangle(x..y, colourTable-resolved 0xRRGGBB)`,
  - `Pix3D.textureTriangle(screen xy×3, shade×3, three view-space control verts, texture id)` — affine u,v,w plane equation from the control verts, 4 lightness bands (`0xf8f8ff`, shifts 0/3/2/1, Pix3D.ts:185–215), `Pix3D.trans` blend `out = c·(256−t)/256 + dst·t/256` (:953, :1035, :1570).
- Terrain: NOT Model objects — `renderGround`/`renderQuickGround` (World.ts:2220/:2054) project ≤6 tile-quad verts with the identical math and call the same three Pix3D rasters. `Ground.vertexX/Y/Z` is a persistent per-tile CPU array (world coords; tile = 128 units, height level = 24).

### Scene boundary (the answer to "where does the renderer plug in")
The natural, honest geometry boundary is **one `worldRender`/`renderGround` call = one batch** (≤ ~2000 verts, ≤ ~2500 faces, already camera-transformed, lit, culled, and depth/priority-ordered). The atom below it is the projected triangle at the three `Pix3D.*Triangle` statics. Scene construction (culling, lighting, ordering, picking) happens **entirely above the atom** and can stay 100% CPU, untouched. Picking (`Model.mouseCheck`, `World.groundX/Z`) runs during/around these calls and must keep running — it's game logic, not rendering.

## 3. Failed v1 post-mortem (`mods/gpu/`, commits dbe1f13 + 45eb643)

**What it attempted:** monkey-patched the three `Pix3D.*Triangle` statics at import time; each captured triangle → 3×16 floats in a flat 98304-tri (18.9 MB) command buffer (screen xy, mode, shade, alpha, affine u/v/w computed CPU-side from control verts, seq number, per-run clip rect). Replayed on WebGL2 with `gl_FragDepth = seq` (GEQUAL) to preserve painter's order exactly; HUD/interface pixels read back out of `Pix2D.pixels` as a full-frame 512×334 `R32UI` texture composited last. Auto-disabled to software on any GL failure. No edits to Model/World/Pix3D source — pure load-time patches.

**Why it failed to satisfy:**
1. **Per-triangle `drawArrays`** — every raster call is its own draw, no batching at all: 30–60k draws/frame in a busy scene. This is the dominant cost; the GPU became a very expensive fill unit that never overlapped.
2. Whole-frame Int32 → R32UI overlay upload every frame (~680 KB) + the capture buffer itself.
3. Affine UVs computed on CPU per triangle (the plane equation duplicated in JS) — pure extra CPU work the GPU could do in-shader.
4. Painter's-order-perfect by construction (seq in depth) — correct, but it forfeited every GPU batching opportunity that a real depth buffer enables.

**Did it modify core logic?** No — the only core-tree edit is `import '#/gpu/GpuRenderer.js'` in Client.ts (+4 reserved-name keys in bundle.ts). Architecture coupling: it *depended* on `Pix2D.pixels` being the single source of both scene and HUD (the overlay trick), which forced the per-frame whole-buffer upload.

**Verdict: discard the capture/replay skeleton; salvage the knowledge.** Specifically salvage:
- Panel toggle row + `localStorage 'gpu'` + Rendering group wiring (control-panel patch).
- Status-badge window-key contract `lcliteGpuStats/lcliteGpuReady/lcliteGpuError` + their `bundle.ts` terser reserves (proven mangle-safe).
- Self-disable-on-failure discipline → software renderer untouched below it.
- The **RS2 math dossier encoded in its header comments + parity test**: colourTable semantics (`index >>8`, gamma-baked), `trans` blend formula, texture band encoding (`(shade<<17)|0`, band `(e>>21)&3`, shifts, `0xf8f8ff` masks, 16256/4032 clamps), flat-vs-gouraud colour routing, per-run clip rect. `tools/gpu_parity_test.ts` (bun) is a working harness comparing real software rasters vs a JS mirror of the shader — adapt, don't rewrite.
- Discard: GL program/VBO plumbing, the 16-float triangle capture format, R32UI overlay mechanism internals (concept of HUD-on-top survives, implementation redone), per-triangle loop.

## 4. Proposed v2 architecture

```
gameDrawMain (untouched)
   ├─ camFollow → camX/Y/Z/Pitch/Yaw          ── camera reused, never duplicated
   ├─ Pix2D.cls
   ├─ world.renderAll ─┬─ renderGround ────────┐ tile geometry (projected, lit)
   │                   └─ Model.worldRender ───┤ BATCH = one flush per call
   │                       (Model.objRender, sprites excluded)
   ├─ entityOverlays/otherOverlays (CPU HUD → Pix2D.pixels, untouched)
   └─ areaGame.draw(4,4)
                     │                │
        geometry batches      Pix2D.pixels (HUD non-black px)
                     ▼                ▼
              WebGPURenderer (behind Renderer boundary)
        VBO/IBO cache · texture array · overlay texture
        WGSL: RS2 affine pipeline (no perspective divide —
        screen-space vertices ARE the projection; custom NDC map)
                     ▼
        GPU canvas behind/over page canvas, game rect (4,4)–(516,338)
```

- `Renderer` interface module; `WebGPURenderer` owns device/queue/context/buffers/pipelines/samplers/depth/texture-atlas; `SoftwareRenderer` = "no patches installed" (the current tree is the software renderer, so the fallback is the absence of the mod, exactly like v1 — do not touch Pix3D unless GPU is active).
- Hook style stays lclite-native: one import hunk (regen's HUNK_OWNER routes it to `mods/gpu`), everything else in `files/webclient/src/gpu/`.
- **Key shift from v1: batch at the worldRender call.** The CPU keeps producing *projected, shaded, ordered* triangles (that's what worldRender already is — a free transform+light+cull stage we'd be foolish to rebuild). The GPU gets a vertex buffer per batch and does the raster. Because batches stay in painter order, and within a batch faces are already sorted, the first iteration keeps **seq-as-depth within the batch** (no cross-batch depth buffer yet — same correctness v1 had, at ~1 draw per batch instead of ~1 draw per 400 triangles → the 30-60k→~1-3k draw drop is the whole game).
- Texture planes move on-GPU: upload the 50 RS2 textures once as a 2D texture **array** (128×128×(50×4 bands) from `Pix3D.textures`+`texPal`, re-upload any id whose `texCycle` advanced — that's animation), emit the 3 view-space control verts per textured face as attributes, compute the u,v,w plane in the vertex shader (exact same cross-product formula), interpolate affinely. `lowMem` 4096×4 variant handled by band stride. No CPU per-triangle plane math.
- ZClip faces: keep the existing CPU `render3ZClip` triangulation path (it already emits rasters — captured identically). Near-plane handling is v1's proven trick, unchanged.
- HUD: same requirement as v1 (bubbles/orbs/xp tracker must land on top) — upload only the dirty bounding box of non-black `Pix2D.pixels` (track writes with a min/max rect; `cls()` resets it), not the whole 512×334 every frame, and composite as a final textured pass. Exact-black-pixel artifact persists (documented, same as v1).
- Depth buffer, per-model persistent VBOs keyed on model hash+frame, culling of batches, MSAA toggle, fog uniform, draw-distance separation: **later phases**, in the prompt's order, after correctness.

### Diagnostics (built in from Phase 1, no silent fallback)
`navigator.gpu` missing / adapter null / device failure / `device.lost` / shader `getCompilationInfo` / pipeline errors → surface verbatim through `lcliteGpuError` badge, disable GPU, software continues. Stats through `lcliteGpuStats`: fps, frame ms, cpu-ms, draw calls, tris, verts, bytes uploaded/frame, batches, texture re-uploads.

## 5. Phase plan (adapted from the prompt to this codebase)

1. **P1 WebGPU proof** — WebGPURenderer bootstraps on a small probe surface; clear + triangle; all diagnostics. Hard checkpoint.
2. **P2 one model** — hook `Model.worldRender` capture; batch upload; gouraud+flat only; verify a single prop appears correctly placed. Textures off.
3. **P3 camera** — free: batches already use the game camera via worldRender args; verify rotate/zoom follow.
4. **P4 terrain** — hook renderGround/QuickGround batches; whole world visible, flat colors + gouraud.
5. **P5 textures** — array upload + on-GPU plane UVs; parity vs software rasters via adapted gpu_parity_test.
6. **P6 depth/order** — keep seq-depth first (v1 semantics); evaluate real depth-buffer + two-pass (opaque depth-tested, then trans/allocation priorities) as an explicit experiment, since prompt's Phase 6 goal conflicts with RS2 bucket interleave — document findings.
7. **P7 entities polish + HUD overlay composite + performance pass** (batch counts, buffer reuse, dirty-rect overlay), then open the draw-distance work.

## 6. Open questions for the user (from the v1 verdict "not efficient or useful")
- Primary success metric to optimize first: fps at default view? fps when zoomed out (the scenario v1 choked on)? memory? parity fidelity?
- Keep v1's module `mods/gpu/` (revert contents) or new `mods/gpu2/` with v1 parked as reference until P1 lands?
