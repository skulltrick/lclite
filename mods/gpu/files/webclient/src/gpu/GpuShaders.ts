// lclite "gpu" mod v2 (WebGPU) — WGSL shader sources.
//
// Backend-specific half of the split (GpuFormat.ts holds the shared triangle
// contract both backends consume). The capture layer produces screen-space,
// lit, painter-ordered triangles; these shaders replay them pixel-exact.
//
// Projection note (key to the whole design): RS2 geometry arrives from the
// CPU ALREADY projected to 512x334 game-buffer pixels (Model.worldRender:
// sx = originX + ((x << 9) / z)). The game camera therefore stays the single
// source of truth — the vertex stage is a plain screen->NDC map plus a
// sequence-in-depth passthrough, NOT a matrix pipeline, so no perspective
// divide either (RS2's raster is affine in screen space; matching it here is
// exactly parity, not an approximation).
//
// Depth semantics (ported from v1's gl_FragDepth scheme and load-bearing):
// each triangle carries its capture sequence number as depth
// (z = seq * 2^-23, exact in f32 to 8.4M triangles — capture caps far below).
// depth32float clears to 0 with 'greater-equal' compare, so "later capture
// always wins a pixel" — identical ordering to the software painter's
// algorithm, resolved by the fixed-function depth unit inside ONE draw call
// instead of v1's 30-60k. Vertex-position depth (not frag_depth): universal
// support, and per-triangle constant so per-vertex assignment is exact.
//
// Colour decode: gouraud vertices carry a Pix3D.colourTable index — the
// software raster reads colourTable[(shadeA >> 8)] after a <<15/>>7/>>8
// fixed-point round trip that cancels to the raw index (gouraudTriangle
// Pix3D.ts:332+). The 65536-entry gamma-baked table uploads as a 256x256
// r32uint texture: x = idx & 255, y = idx >> 8. Flat vertices carry an
// already-resolved 0xRRGGBB int.
//
// Blend: the fragment emits PREMULTIPLIED rgb = colour*(1-a) with
// a = Pix3D.trans/256 (the software destination weight); pipeline blend
// (ONE, SRC_ALPHA) reconstructs out = c*(256-t)/256 + dst*t/256 exactly.
// a=0 stays a plain overwrite. The canvas itself is opaque ('opaque'
// alphaMode in GpuContext): the software trans-mix happens inside the
// canvas against earlier scene pixels, so channel A here is only the
// blend's dst-weight carrier.

import { SENTINEL } from '#/gpu/GpuFormat.js';

// P2+ scene pass: non-indexed triangles, attribute layout mirrors GpuFormat
// (xy, shade, mode, seq, alpha, u, v, w, texId, texOpaque). Generated
// function because the lowMem texel-pool variant (64px bands, w>>12 fixed
// point, 4032 clamps) bakes in as a const — the engine flips Pix3D.lowMem
// without rebuilding anything else, and per-frame uniforms for a boolean that
// changes ~never are plumbing we don't need.
//
// MODE_TEX fragment path is v1's GLSL (45eb643) ported VERBATIM — it was
// pixel-parity-tested against the real textureRaster by tools/gpu_parity_test,
// so this is spec translation, not new math: affine i32 planes (interpolated
// linearly — w=1 positions make perspective-correct == affine, matching the
// raster's plane walk), w>>14 (>>12 lowMem) fixed-point division, 0x3f80
// (0xfc0 lowMem) row masks, 16256/4032 clamps, the 0xf8f8ff 4-band pool,
// texel>>>shadeShift, holes discard vs opaque-black-replace, textures never
// alpha-mix. Shade word e=(shade<<17): band=(e>>21)&3, shift=(e>>23)&31.
export function sceneWgsl(lowMem: boolean): string {
    return `
const LOW_MEM: bool = ${lowMem ? 'true' : 'false'};

@group(0) @binding(0) var colourTable: texture_2d<u32>;
@group(0) @binding(1) var texArray: texture_2d_array<u32>;

struct VOut {
    @builtin(position) pos: vec4f,
    @location(0) shade: f32,
    @location(1) mode: f32,
    @location(2) alpha: f32,
    @location(3) uvw: vec3f,                      // SMOOTH: affine plane walk
    @location(4) @interpolate(flat) tex: vec2f,   // id + opaque (per-tri const)
};

fn unpack(c: u32) -> vec3f {
    return vec3f(
        f32((c >> 16u) & 255u),
        f32((c >> 8u) & 255u),
        f32(c & 255u),
    ) / 255.0;
}

@vertex
fn vs(
    @location(0) xy: vec2f,
    @location(1) shade: f32,
    @location(2) mode: f32,
    @location(3) seq: f32,
    @location(4) alpha: f32,
    @location(5) uvw: vec3f,
    @location(6) tex: vec2f,
) -> VOut {
    var o: VOut;
    // screen px (y-down, 512x334) -> NDC; depth = seq * 2^-23 (exact f32)
    o.pos = vec4f(
        xy.x * (2.0 / 512.0) - 1.0,
        1.0 - xy.y * (2.0 / 334.0),
        seq * 0.00000011920928955078125,
        1.0,
    );
    o.shade = shade;
    o.mode = mode;
    o.alpha = alpha;
    o.uvw = uvw;
    o.tex = tex;
    return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
    if (in.mode > 1.5) {
        // ---- MODE_TEX: v1's parity-proven textureRaster mirror ----
        let cu0: i32 = i32(in.uvw.x);
        let cv0: i32 = i32(in.uvw.y);
        let cw0: i32 = i32(in.uvw.z);
        let e: i32 = i32(in.shade);
        let band: i32 = (e >> 21) & 3;
        let shift: u32 = u32((e >> 23) & 31);
        var col: i32;
        var row: i32;
        if (LOW_MEM) {
            let curW: i32 = cw0 >> 12;
            if (curW == 0) {
                discard;
            }
            var cu: i32 = cu0 / curW;
            cu = clamp(cu, 0, 4032);
            let cv: i32 = cv0 / curW;
            col = cu >> 6;
            row = ((cv & 0xfc0) >> 6) + band * 64;
        } else {
            let curW: i32 = cw0 >> 14;
            if (curW == 0) {
                discard;
            }
            var cu: i32 = cu0 / curW;
            cu = clamp(cu, 0, 16256);
            let cv: i32 = cv0 / curW;
            col = cu >> 7;
            row = ((cv & 0x3f80) >> 7) + band * 128;
        }
        var packed: u32 = textureLoad(texArray, vec2i(col, row), i32(in.tex.x), 0).x;
        packed = packed >> shift;
        if (packed == 0u) {
            if (in.tex.y > 0.5) {
                // pool has no holes: the raster wrote black (a=0 -> replace)
                return vec4f(0.0, 0.0, 0.0, 0.0);
            }
            discard; // transparent texel: the earlier pixel shows through
        }
        return vec4f(unpack(packed), 0.0); // textures replace (trans unused)
    }
    var rgb: vec3f;
    if (in.mode < 0.5) {
        // gouraud: colourTable[idx] direct
        let idx: u32 = min(u32(max(in.shade, 0.0)), 65535u);
        rgb = unpack(textureLoad(colourTable, vec2i(i32(idx & 255u), i32(idx >> 8u)), 0).x);
    } else {
        // flat: shade slot IS the resolved 0xRRGGBB
        rgb = unpack(u32(max(in.shade, 0.0)));
    }
    let a: f32 = clamp(in.alpha, 0.0, 1.0);
    // premultiplied: rgb*(1-a), alpha channel carries the dst weight a
    return vec4f(rgb * (1.0 - a), a);
}
`;
}

// HUD overlay pass: the game buffer still holding CPU pixels (bubbles/hitbars/
// orbs/tracker/in-viewport text). Texels are the raw 0xRRGGBB buffer ints as
// r32uint; the overlay is cleared to SENTINEL each frame, so only real HUD
// pixels composite — black UI (minimenu bars, shadows) included, AND sprite
// black (the engine stores that as 1, not 0 — see GpuFormat.SENTINEL). P7
// uploads only the dirty bounding box (uniform carries origin+size in buffer
// px; the texture stays full-size and sampling uses ABSOLUTE coords, so
// sub-rect uploads need no texture recreation). No depth interaction beyond
// compare 'always': last-wins over the scene by construction.
export const OVERLAY_WGSL = `
struct Uni {
    origin: vec2f,   // rect top-left in game px
    size: vec2f,     // rect w,h in game px
};
@group(0) @binding(0) var<uniform> u: Uni;
@group(0) @binding(1) var hud: texture_2d<u32>;

fn unpack(c: u32) -> vec4f {
    return vec4f(
        f32((c >> 16u) & 255u) / 255.0,
        f32((c >> 8u) & 255u) / 255.0,
        f32(c & 255u) / 255.0,
        1.0,
    );
}

struct FIn {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn vs2(
    @location(0) t: vec2f,      // rect-local 0..1
) -> FIn {
    var o: FIn;
    // uniform maps local -> absolute game px -> NDC
    let xy: vec2f = u.origin + t * u.size;
    o.pos = vec4f(
        xy.x * (2.0 / 512.0) - 1.0,
        1.0 - xy.y * (2.0 / 334.0),
        0.5,
        1.0,
    );
    o.uv = t;
    return o;
}

@fragment
fn fs2(in: FIn) -> @location(0) vec4f {
    // absolute buffer texel: quad spans origin..origin+size, fragment centers
    // land on exact texel indices (i32 truncation of x0+i+0.5)
    let dims = textureDimensions(hud);
    let ax: i32 = clamp(i32(u.origin.x + in.uv.x * u.size.x), 0, i32(dims.x) - 1);
    let ay: i32 = clamp(i32(u.origin.y + in.uv.y * u.size.y), 0, i32(dims.y) - 1);
    let c: u32 = u32(textureLoad(hud, vec2i(ax, ay), 0).x);
    if (c == ${SENTINEL}u) {
        // sentinel: GpuRenderer clears the game buffer to SENTINEL on GPU frames
        // so real Colour.BLACK HUD pixels (0 — minimenu bars, text shadows) AND
        // the engine's sprite-black (1 — item icon outlines, interface graphics,
        // the click crosses) both composite instead of punching holes. discard:
        // let the scene show.
        discard;
    }
    return unpack(c);
}
`;

// P1 proof pipeline kept for regression: draws the fixed green triangle with
// NO buffers/uniforms. localStorage 'gpudbg' = '1' makes the scene pass draw
// this triangle over the captured batch instead — the canvas/composite
// plumbing stays proven while backend experiments run.
export const TRIANGLE_WGSL = `
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(
        vec2f( 0.0, -0.66),   // top,   y-up
        vec2f( 0.66,  0.66),
        vec2f(-0.66,  0.66)
    );
    return vec4f(p[vi], 0.0, 1.0);
}

@fragment
fn fs() -> @location(0) vec4f {
    return vec4f(0.13, 0.85, 0.35, 1.0); // green triangle over the clear
}
`;
