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
// Vertex slots (stride VS*4 = 64B; slots 6-11 reserved for P5 texture-plane
// data exactly like the v2 WIP did, so no format migration when textures move
// on-GPU):
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

// attribute offsets (float indices)
export const OXY = 0;  // vec2f
export const OSHADE = 2;
export const OMODE = 3;
export const OSEQ = 4;
export const OALPHA = 5;

// draw modes
export const MODE_GOURAUD = 0; // shade slot = colourTable index (gamma-baked)
export const MODE_FLAT = 1;    // shade slot = resolved 0xRRGGBB int

// seq -> depth scale (2^-23) and the back-face tie-break unit (2^-24)
export const SEQ_DEPTH_SCALE = 0.00000011920928955078125;

// GPU usage bitfields (no @webgpu/types dependency — overlay rule: no new deps)
export const USAGE_COPY_DST = 4;
export const USAGE_VERTEX = 16;
export const USAGE_UNIFORM = 32;
export const USAGE_TEXTURE_COPY_DST = 2;
export const USAGE_TEXTURE_BINDING = 4;
export const USAGE_RENDER_ATTACHMENT = 16;
