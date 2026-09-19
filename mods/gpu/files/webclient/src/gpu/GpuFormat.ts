// lclite "gpu" mod v2 (WebGPU) — shared capture/triangle format.
//
// This module is the backend CONTRACT, mirroring the RuneLite-GPU split the
// plan asks for:
//
//   Pix3D capture layer  (GpuRenderer.installPatches + capturePrim/captureTex)
//          ->  shared triangle stream (the 16-float layout below)
//          ->  WebGPU backend (GpuShaders.ts WGSL + pipelines here-adjacent)
//
// The format is v1's (WebGL2, git 45eb643) with the scissor-clip slots REPLACED
// by mode+front-face semantics: v1 could setScissor per run; WebGPU render
// bundles have no per-draw scissor (only one render-pass clamp), and v1's
// per-run batching on clip rect is exactly the fragmentation that forced
// 30-60k draws. Correctness instead comes from the fixed seq-depth ordering
// below, so clip is not needed at capture time at all.
//
// Vertex slots (stride VS*4 = 64B; slots 6-11 carry the P5 texture plane —
// u, v, w, texId, +2 spare — exactly as the v2 WIP reserved them, so the format
// never had to migrate when texel sampling moved on-GPU):
//   [0..1]  xy     screen px, 512x334, y-down (ALREADY projected by the CPU)
//   [2]     shade  gouraud: Pix3D.colourTable index | flat/tex-avg: 0xRRGGBB
//   [3]     mode   MODE_GOURAUD / MODE_FLAT
//   [4]     seq    1-based capture order in this frame -> frag depth below
//   [5]     alpha  Pix3D.trans/256 = DESTINATION weight (software mix factor)
//   [6..11] (P5)   u, v, w, texId, +2 reserved
//
// Depth semantics (ported from v1's gl_FragDepth scheme, load-bearing):
// each triangle carries its capture sequence number as depth:
//     z = seq * 2^-23   (exact in f32 to 8.4M tris; capture caps far below)
// depth32float cleared to 0 with 'greater-equal' compare, so "later capture
// always wins a pixel" — the software painter's algorithm, resolved by the
// fixed-function depth unit inside ONE draw instead of per-triangle draws.
//
// The ONE thing WebGPU adds (and what makes depth-buffered replay work at
// all where the software raster is backface-blind): the software rasterizer
// fills a triangle regardless of vertex winding (Model.render2 culls back
// faces on the CPU, but the raster itself is orientation-agnostic — so two
// triangles with EQUAL seq can never happen, yet adjacent-seq overlapping
// tris must still resolve deterministically). Ties between the three
// provoking vertices of one triangle cannot happen (constant z per tri);
// the real hazard is coincident draw order vs. the clear. We keep the v1
// rule pure: strictly increasing seq => strictly increasing z => GEQUAL
// against clear-0 admits every triangle, later overwrite earlier. No
// front/back fudge: the CPU already did all ordering decisions.
//
// Blend: fragment emits premultiplied rgb = colour*(1-a) with a = trans/256;
// pipeline blend (ONE, SRC_ALPHA) reconstructs the software mix
//     out = c*(256-t)/256 + dst*t/256  exactly.  a=0 stays a plain overwrite.

export const VS = 12; // float slots per vertex

export const MAX_TRIS = 65536; // 12.6 MB capture; a busy 289 scene runs 15-30k

// THE SENTINEL — the value the game buffer is cleared to on a GPU frame, i.e.
// "nothing was drawn here, the scene shows through". The overlay pass paints
// every OTHER pixel verbatim, so this value has to be one the software renderer
// can never produce:
//   * 0 is out: it is also Colour.BLACK (minimenu bar, text shadows), so the
//     overlay punched holes in black UI (v1's documented artifact);
//   * 1 is out too, and it cost us the "shiny interfaces": 1 is the engine's own
//     BLACK for sprites. Pix32.depack bumps a palette entry of 0 up to 1 (so it
//     stays distinct from transparent), ObjType writes an item icon's outline as
//     a literal 1, and Pix32.plotSprite copies any non-zero source pixel as-is —
//     so every black pixel of every media sprite (item icons, interface
//     graphics, the click crosses, headicons, buttons) landed on the sentinel
//     and got discarded, letting the world show through where black belonged.
// Bit 24 is unreachable: every writer packs 24 bits — Pix2D primitives and font
// ink as (r<<16)+(g<<8)+b, Pix32/Pix8 blits as stored palette colours, the Pix3D
// rasters through gammaCorrect (each channel <= 255) — and PixMap.prepareCanvas
// drops the top byte, so even a leaked sentinel composites as black, never as
// garbage. Hence SENTINEL = 1 << 24.
export const SENTINEL = 0x01000000;

// attribute offsets (float indices)
export const OXY = 0;  // vec2f
export const OSHADE = 2;
export const OMODE = 3;
export const OSEQ = 4;
export const OALPHA = 5;

// draw modes
export const MODE_GOURAUD = 0; // shade slot = colourTable index (gamma-baked)
export const MODE_FLAT = 1;    // shade slot = resolved 0xRRGGBB int
export const MODE_TEX = 2;     // P5: affine u,v,w texture mirror of textureRaster
                               // (slots 6-10 live; texel>>>shade-band, holes
                               // discard — v1's parity-proven shader math)

// P5 texture slots
export const OTU = 6;   // affine plane u (int32 value as f32)
export const OTV = 7;
export const OTW = 8;
export const OTEX = 9;  // texture array layer (0..49)
export const OTOPAQUE = 10; // 1 = no hole texels (zero texel paints black)

// texture array: 50 layers of 128x512 r32uint = 4 lightness bands x 128 rows
// (lowMem: bands at 64-row steps, 64 useful cols — same layout v1's
// getTexels mirror produced; re-upload per pushTexture (anim) /
// initColourTable (gamma) / unpackTextures (world hop))
export const TEX_COUNT = 50;
export const TEX_W = 128;
export const TEX_H = 512;

// seq -> depth scale (2^-23) and the back-face tie-break unit (2^-24)
export const SEQ_DEPTH_SCALE = 0.00000011920928955078125;

// GPU usage bitfields (no @webgpu/types dependency — overlay rule: no new
// deps), straight from the WebGPU IDL:
//   GPUBufferUsage:  COPY_SRC 0x04 · COPY_DST 0x08 · INDEX 0x10 · VERTEX 0x20
//                    UNIFORM 0x40  · STORAGE 0x80
//   GPUTextureUsage: COPY_SRC 0x01 · COPY_DST 0x02 · TEXTURE_BINDING 0x04
//                    RENDER_ATTACHMENT 0x10
// TRAP (killed the first P2 attempt twice): COPY_DST|VERTEX|UNIFORM are
// 8|32|64 — NOT 4|16|32 (that trio is COPY_SRC|INDEX|VERTEX). A bind group
// built on a mis-flagged buffer fails validation with
// "Binding usage (BufferUsage::(CopySrc|Vertex)) doesn't match expected
// usage (BufferUsage::Uniform)" — see wip/gpu-p2-capture and 57539b1.
export const USAGE_COPY_DST = 8;
export const USAGE_VERTEX = 32;
export const USAGE_UNIFORM = 64;
export const USAGE_TEXTURE_COPY_DST = 2;
export const USAGE_TEXTURE_BINDING = 4;
export const USAGE_RENDER_ATTACHMENT = 16;
