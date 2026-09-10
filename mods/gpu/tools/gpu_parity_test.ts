// Pixel-parity harness v2: rasterizes random triangles (gouraud/flat/textured)
// with the REAL engine software raster, then "replays" each captured triangle
// through a JS mirror of the GPU shader math (as written in GpuRenderer.ts).
//
// To measure interpolation error in SHADE-INDEX units (not exaggerated colour
// units), the colourTable is a bijection: colourTable[i] = i*254 (injective for
// i in [0,65536), max 16,645,890 < 2^24). Decoding a software pixel: idx = px/254.
// The mirror writes the *same* bijection, so pixel equality == index equality.
//
// Reports: coverage mismatch (pixel written by one side only), and the
// distribution of |software idx - GL idx| for pixels both wrote.
//
// Run: bun gpu_parity_test.ts
(globalThis as Record<string, unknown>)['window'] = globalThis;
(globalThis as Record<string, unknown>)['document'] = { getElementById: () => null };
(globalThis as Record<string, unknown>)['localStorage'] = {
    getItem: () => 'false', setItem: () => { /* noop */ }, removeItem: () => { /* noop */ }
};

import Pix2D from './src/graphics/Pix2D.js';
import Pix3D from './src/dash3d/Pix3D.js';
import Pix8 from './src/graphics/Pix8.js';

const { GpuRenderer } = await import('./src/gpu/GpuRenderer.js');
const gr = GpuRenderer as unknown as {
    capturePrim(mode: number, xA: number, xB: number, xC: number, yA: number, yB: number, yC: number, cA: number, cB: number, cC: number): boolean;
    captureTex(xA: number, xB: number, xC: number, yA: number, yB: number, yC: number, sA: number, sB: number, sC: number, oX: number, oY: number, oZ: number, bX: number, cX: number, bY: number, cY: number, bZ: number, cZ: number, tex: number): boolean;
    tris: Float32Array;
    ntris: number;
    seq: number;
};

const W = 64, H = 64;
const swBuf = new Int32Array(W * H);
const glBuf = new Int32Array(W * H);

// --- bijection colourTable: idx <-> idx*254 -----------------------------------
function encIdx(i: number): number { return i * 254; }
function decIdx(px: number): number { return px % 254 === 0 ? px / 254 : -1; }
for (let i = 0; i < 65536; i++) Pix3D.colourTable[i] = encIdx(i);

// --- two textures with distinct palette (also bijective in a sub-range) --------
// palette[i] = i*6443 (<2^24 for i<2560, we use 256) -> texel value encodable
function makeTexture(w: number, holes: boolean): Pix8 {
    const pal = new Int32Array(256);
    for (let i = 0; i < 256; i++) pal[i] = ((((i * 3 + 1) * 0x10001) & 0xffffff) | 1);
    const t = new Pix8(w, w, pal);
    for (let i = 0; i < t.data.length; i++) t.data[i] = (i * 7 + (i >> 3)) & 0xff;
    if (holes) t.data[100] = 0;
    return t;
}
Pix3D.lowMem = false;
Pix3D.textures[0] = makeTexture(128, true);
Pix3D.textures[1] = makeTexture(64, false);
Pix3D.numTextures = 2;
{
    const P = Pix3D as unknown as { texPal: (Int32Array | null)[]; texTrans: boolean[] };
    for (let id = 0; id < 2; id++) {
        P.texPal[id] = (Pix3D.textures[id] as Pix8).bpal;
    }
}

// GL texture array image (what flushTextures would upload)
function buildTexArrayGL(): Uint32Array {
    const arr = new Uint32Array(2 * 128 * 512);
    const P = Pix3D as unknown as { texPal: (Int32Array | null)[] };
    for (let id = 0; id < 2; id++) {
        const tex = Pix3D.textures[id] as Pix8;
        const pal = P.texPal[id] as Int32Array;
        const sc = new Uint32Array(128 * 512);
        const upsample = tex.wi === 64;
        for (let i = 0; i < 16384; i++) {
            const src = upsample ? ((i >> 8) << 6) + ((i & 127) >> 1) : i;
            const rgb = pal[tex.data[src]] & 0xf8f8ff;
            sc[i] = rgb;
            sc[16384 + i] = (rgb - (rgb >>> 3)) & 0xf8f8ff;
            sc[32768 + i] = (rgb - (rgb >>> 2)) & 0xf8f8ff;
            sc[49152 + i] = (rgb - (rgb >>> 2) - (rgb >>> 3)) & 0xf8f8ff;
        }
        arr.set(sc, id * 128 * 512);
    }
    return arr;
}
function buildPoolSoftware(id: number): Int32Array {
    const tex = Pix3D.textures[id] as Pix8;
    const P = Pix3D as unknown as { texPal: (Int32Array | null)[] };
    const pal = P.texPal[id] as Int32Array;
    const texels = new Int32Array(65536);
    const upsample = tex.wi === 64;
    for (let i = 0; i < 16384; i++) {
        const src = upsample ? ((i >> 8) << 6) + ((i & 127) >> 1) : i;
        const rgb = pal[tex.data[src]];
        texels[i] = rgb;
        texels[i + 16384] = (rgb - (rgb >>> 3)) & 0xf8f8ff;
        texels[i + 32768] = (rgb - (rgb >>> 2)) & 0xf8f8ff;
        texels[i + 49152] = (rgb - (rgb >>> 2) - (rgb >>> 3)) & 0xf8f8ff;
    }
    return texels;
}
const glArr = buildTexArrayGL();

Pix2D.setPixels(swBuf, W, H);
Pix3D.setPixels(swBuf, W, H);
Pix3D.setRenderClipping();

// ---- shader mirror (GLSL semantics, fp32-ish via Math.fround where it matters) --
const VS = 16;
function f32(x: number): number { return Math.fround(x); }

function mirrorTri(glArr: Uint32Array, lowDetail: boolean): void {
    const t = gr.tris;
    // MODE slot=2 (same for all verts), shade=12, uvw=8..10, texid=11, alpha=13
    const mode = t[2] | 0;
    const alpha = t[13];
    const ocx = (Pix3D as unknown as { originX: number }).originX;
    const ocy = (Pix3D as unknown as { originY: number }).originY;
    const xs = [f32(t[0]), f32(t[VS]), f32(t[2 * VS])];
    const ys = [f32(t[1]), f32(t[VS + 1]), f32(t[2 * VS + 1])];
    const shs = [f32(t[12]), f32(t[VS + 12]), f32(t[2 * VS + 12])];
    const us = [f32(t[8]), f32(t[VS + 8]), f32(t[2 * VS + 8])];
    const vs = [f32(t[9]), f32(t[VS + 9]), f32(t[2 * VS + 9])];
    const ws = [f32(t[10]), f32(t[VS + 10]), f32(t[2 * VS + 10])];
    const texid = t[11] | 0;
    const lowMem = (Pix3D as unknown as { lowMem: boolean }).lowMem;

    let area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[1]);
    if (area === 0) return;
    const sgn = area < 0 ? -1 : 1;
    area = area * sgn;
    const minX = Math.max(0, Math.floor(Math.min(xs[0], xs[1], xs[2])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(xs[0], xs[1], xs[2])));
    const minY = Math.max(0, Math.floor(Math.min(ys[0], ys[1], ys[2])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(ys[0], ys[1], ys[2])));
    const cx0 = t[3] | 0, cy0 = t[4] | 0, cx1 = t[5] | 0, cy1 = t[6] | 0;

    for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
            // GL samples pixel center (px+0.5); software rasters integer px
            const x = px + 0.5, y = py + 0.5;
            const w0 = sgn * ((xs[1] - x) * (ys[2] - y) - (xs[2] - x) * (ys[1] - y)) / area;
            const w1 = sgn * ((xs[2] - x) * (ys[0] - y) - (xs[0] - x) * (ys[2] - y)) / area;
            const w2 = 1 - w0 - w1;
            if (w0 < 0 || w1 < 0 || w2 < 0) continue;
            if (px < cx0 || px >= cx1 || py < cy0 || py >= cy1) continue; // scissor
            const off = px + py * W;
            if (mode === 0) {
                let idx = Math.round(f32(shs[0] * w0 + shs[1] * w1 + shs[2] * w2));
                idx = idx < 0 ? 0 : idx > 65535 ? 65535 : idx;
                const c = Pix3D.colourTable[idx];
                if (alpha >= 1.0) {
                    glBuf[off] = c;
                } else {
                    const a255 = Math.round(alpha * 255);
                    const inv = 255 - a255;
                    const d = swBuf[off];
                    glBuf[off] = ((((c >> 16) & 255) * a255 + ((d >> 16) & 255) * inv) / 255) | 0 << 16
                        | ((((c >> 8) & 255) * a255 + ((d >> 8) & 255) * inv) / 255 | 0) << 8
                        | (((c & 255) * a255 + (d & 255) * inv) / 255 | 0);
                }
            } else if (mode === 3) {
                const c = Math.round(f32(shs[0] * w0 + shs[1] * w1 + shs[2] * w2)) & 0xffffff;
                glBuf[off] = c;
            } else {
                const u = us[0] * w0 + us[1] * w1 + us[2] * w2;
                const v = vs[0] * w0 + vs[1] * w1 + vs[2] * w2;
                const w = ws[0] * w0 + ws[1] * w1 + ws[2] * w2;
                const e = Math.round(f32(shs[0] * w0 + shs[1] * w1 + shs[2] * w2));
                const band = (e >> 21) & 3;
                const shift = (e >> 23) & 31;
                let col: number, row: number;
                if (lowMem) {
                    const curW = (w | 0) >> 12;
                    if (curW === 0) continue;
                    let cu = (u | 0) / curW | 0;
                    cu = cu < 0 ? 0 : cu > 4032 ? 4032 : cu;
                    const cv = (v | 0) / curW | 0;
                    col = cu >> 6;
                    row = ((cv & 0xfc0) >> 6) + band * 64;
                } else {
                    const curW = (w | 0) >> 14;
                    if (curW === 0) continue;
                    let cu = (u | 0) / curW | 0;
                    cu = cu < 0 ? 0 : cu > 16256 ? 16256 : cu;
                    const cv = (v | 0) / curW | 0;
                    col = cu >> 7;
                    row = ((cv & 0x3f80) >> 7) + band * 128;
                }
                let packed = (glArr[texid * 128 * 512 + row * 128 + col] >>> shift) >>> 0;
                if (packed === 0) continue; // hole discard / black-replace handled by pool class
                glBuf[off] = packed;
            }
            void ocx; void ocy; void lowDetail;
        }
    }
}

let rngState = 987654321;
function rnd(): number {
    rngState = (Math.imul(rngState, 1103515245) + 12345) & 0x7fffffff;
    return rngState / 0x7fffffff;
}

const stats: Record<string, { n: number; both: number; cover: number; d1: number; d2: number; big: number; maxd: number }> = {};
function st(k: string): { n: number; both: number; cover: number; d1: number; d2: number; big: number; maxd: number } {
    if (!stats[k]) stats[k] = { n: 0, both: 0, cover: 0, d1: 0, d2: 0, big: 0, maxd: 0 };
    return stats[k];
}

const cases = 300;
for (let c = 0; c < cases; c++) {
    const xA = (rnd() * (W - 4)) | 0, xB = (rnd() * (W - 4)) | 0, xC = (rnd() * (W - 4)) | 0;
    const yA = (rnd() * (H - 4)) | 0, yB = (rnd() * (H - 4)) | 0, yC = (rnd() * (H - 4)) | 0;
    // skip degenerate/thin triangles (software skips them too)
    const area2 = (xB - xA) * (yC - yA) - (xC - xA) * (yB - yA);
    if (Math.abs(area2) < 30) continue;
    swBuf.fill(0);
    glBuf.fill(0);
    gr.ntris = 0;
    gr.seq = 1;
    Pix2D.setPixels(swBuf, W, H);
    Pix3D.setPixels(swBuf, W, H);
    Pix3D.setRenderClipping();
    Pix3D.hclip = false;
    Pix3D.trans = 0;

    const kind = c % 3;
    const kindName = ['gouraud', 'flat', 'tex'][kind];
    st(kindName).n++;
    if (kind === 0) {
        Pix3D.lowDetail = false;
        const cA = (rnd() * 65536) | 0, cB = (rnd() * 65536) | 0, cC = (rnd() * 65536) | 0;
        Pix3D.gouraudTriangle(xA, xB, xC, yA, yB, yC, cA, cB, cC);
        gr.capturePrim(0, xA, xB, xC, yA, yB, yC, cA, cB, cC);
    } else if (kind === 1) {
        const cA = (rnd() * 0xffffff) | 0;
        Pix3D.flatTriangle(xA, xB, xC, yA, yB, yC, cA);
        gr.capturePrim(3, xA, xB, xC, yA, yB, yC, cA, cA, cA);
    } else {
        Pix3D.lowDetail = false;
        const tex = (rnd() * 2) | 0;
        const pool = buildPoolSoftware(tex);
        Pix3D.activeTexels[tex] = pool;
        const PT = Pix3D as unknown as { texTrans: boolean[] };
        PT.texTrans[tex] = pool.subarray(0, 16384).some(v => (v & 0xf8f8ff) === 0);
        Pix3D.cycle = 0;
        const oX = (rnd() * 4000 - 2000) | 0, oY = (rnd() * 4000 - 2000) | 0, oZ = (50 + rnd() * 3000) | 0;
        const bX = (oX + (rnd() * 800 - 400)) | 0, bY = (oY + (rnd() * 800 - 400)) | 0, bZ = (oZ + rnd() * 400) | 0;
        const cX = (oX + (rnd() * 800 - 400)) | 0, cY = (oY + (rnd() * 800 - 400)) | 0, cZ = (oZ + rnd() * 400) | 0;
        const sA = (rnd() * 255) | 0, sB = (rnd() * 255) | 0, sC = (rnd() * 255) | 0;
        Pix3D.textureTriangle(xA, xB, xC, yA, yB, yC, sA, sB, sC, oX, oY, oZ, bX, cX, bY, cY, bZ, cZ, tex);
        gr.captureTex(xA, xB, xC, yA, yB, yC, sA, sB, sC, oX, oY, oZ, bX, cX, bY, cY, bZ, cZ, tex);
    }
    if (gr.ntris === 0 && kind === 2) continue; // consumed-invalid case
    mirrorTri(glArr, false);

    const S = st(kindName);
    for (let p = 0; p < W * H; p++) {
        const a = swBuf[p] >>> 0, b = glBuf[p] >>> 0;
        if (a === 0 && b === 0) continue;
        if (a === 0 || b === 0) {
            // a "hole" texel discard vs software black, or edge-rule diffs:
            // only count when the OTHER side is a triangle-interior pixel; both
            // coverage styles are acceptable at exact triangle edges
            S.cover++;
            continue;
        }
        S.both++;
        let d: number;
        if (kind === 0) {
            const ia = decIdx(a), ib = decIdx(b);
            d = ia >= 0 && ib >= 0 ? Math.abs(ia - ib) : Math.max(...[0, 1, 2].map(k => Math.abs(((a >> (16 - 8 * k)) & 255) - ((b >> (16 - 8 * k)) & 255))));
        } else {
            d = Math.max(Math.abs(((a >> 16) & 255) - ((b >> 16) & 255)), Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)), Math.abs((a & 255) - (b & 255)));
        }
        if (d === 0) continue;
        if (d === 1) S.d1++;
        else if (d === 2) S.d2++;
        else S.big++;
        if (d > S.maxd) S.maxd = d;
    }
}
console.log(JSON.stringify(stats, null, 1));
