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

// P2 scene pass: non-indexed triangles, attribute layout = GpuFormat's VS.
export const SCENE_WGSL = `
@group(0) @binding(0) var colourTable: texture_2d<u32>;

struct VOut {
    @builtin(position) pos: vec4f,
    @location(0) shade: f32,
    @location(1) mode: f32,
    @location(2) alpha: f32,
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
    return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
    var rgb: vec3f;
    if (in.mode < 0.5) {
        // gouraud: colourTable[idx] direct
        let idx: u32 = min(u32(max(in.shade, 0.0)), 65535u);
        rgb = unpack(textureLoad(colourTable, vec2i(i32(idx & 255u), i32(idx >> 8u)), 0).x);
    } else {
        // flat / texture-average: shade slot IS the resolved 0xRRGGBB
        rgb = unpack(u32(max(in.shade, 0.0)));
    }
    let a: f32 = clamp(in.alpha, 0.0, 1.0);
    // premultiplied: rgb*(1-a), alpha channel carries the dst weight a
    return vec4f(rgb * (1.0 - a), a);
}
`;

// HUD overlay pass: the 512x334 game buffer still holding CPU pixels
// (bubbles/hitbars/orbs/tracker/in-viewport text). Texels are the raw
// 0xRRGGBB buffer ints as r32uint (v1's R32UI scheme; P2 uploads the whole
// frame — dirty-rect is a later optimization) — non-black replaces, black
// discards (the buffer's own empty value). No depth interaction: last-wins
// over the scene by construction.
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
    let dims = textureDimensions(hud);
    var tx: i32 = i32(in.uv.x * f32(dims.x));
    var ty: i32 = i32(in.uv.y * f32(dims.y));
    tx = clamp(tx, 0, i32(dims.x) - 1);
    ty = clamp(ty, 0, i32(dims.y) - 1);
    let c: u32 = u32(textureLoad(hud, vec2i(tx, ty), 0).x);
    if (c == 0u) {
        discard; // buffer-empty: let the scene show through
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
