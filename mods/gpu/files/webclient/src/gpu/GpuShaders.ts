// lclite "gpu" mod v2 (WebGPU) — WGSL shader sources.
//
// P1: the minimal proof pipeline — a fixed-position triangle drawn into the
// configured canvas, no buffers, no uniforms. Kept in its own module so the
// real scene shaders (P2+) grow next to it without touching bootstrap code.
//
// Projection note for the scene shaders to come: RS2 geometry arrives from
// the CPU ALREADY projected to 512x334 screen pixels
// (Model.worldRender: sx = originX + ((x << 9) / z)), so the scene vertex
// stage is a plain screen->NDC map, not a matrix multiply. The game camera
// stays the single source of truth (see docs/gpu-v2-assessment.md).

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
