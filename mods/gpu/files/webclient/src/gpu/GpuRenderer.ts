// lclite "gpu" mod — WebGL2 hardware rasterization of the 3D scene.
//
// The RuneLite GPU idea, adapted to the webclient without forking the engine:
// the CPU keeps doing everything it is good at (culling, projection, lighting,
// and ALL picking — Model.mouseCheck / World.groundX resolve unchanged because
// picking runs before rasterization), but at the three Pix3D rasterizer entry
// points a triangle is captured into a flat command buffer instead of being
// software-rasterized, then replayed on the GPU.
//
// Painter's algorithm preserved exactly: each captured triangle carries its
// capture sequence number into gl_FragDepth; the depth test is GEQUAL against
// a zero-cleared buffer, so "later capture always wins a pixel" — identical
// ordering semantics to the software renderer. Blend mirrors Pix3D's mix:
// out = colour*(256-trans)/256 + dst*trans/256, i.e. fragColour.a = trans/256
// under (ONE_MINUS_SRC_ALPHA, SRC_ALPHA) — trans=0 stays a plain overwrite,
// so no pass is reordered or re-blended.
//
// The software rasterizer is mirrored, not approximated, at the sampling
// level: textureTriangle's affine u,v,w plane (same int32 <<14/<<8/<<5
// coefficients, same w>>14 (>>12 lowMem) fixed-point division, same
// 0x3f80/0xfc0 row masks, same 16256/4032 clamps, same 0xf8f8ff 4-band texel
// pool) is evaluated per-vertex; gl_Position is built from SCREEN coordinates
// so GL's interpolation is affine too — the same plane textureRaster walks.
// The per-pixel shade word e=(shade<<17)|0 interpolates continuously: band =
// (e>>21)&3, shift = (e>>23)&31, texel >>> shift — identical math, minus the
// software's per-8px stepping (the same call RuneLite's GL shader makes).
// Texture triangles never alpha-mix (the software textureRaster replaces, and
// discards holes) — reproduced exactly. Gouraud colours index the gamma-baked
// colourTable (uploaded per initColourTable); flat colours are the resolved
// 0xRRGGBB ints the callers already pass. Per-run scissor reproduces the
// Pix2D clip rect at capture time (mid-frame setClipping callers included).
//
// What stays on the CPU: everything that is not a Pix3D triangle while the
// 512x334 game buffer is bound — item icons, minimap, sidebar, chatbox,
// login/title screens. The Pix2D writes that DO land in the game buffer every
// frame (chat bubbles, hit bars, headicons, walk arrow, xp tracker, orbs,
// in-viewport interface text) are untouched — they write into the same
// Int32Array — and are uploaded as an R32UI overlay texture composited over
// the GL scene wherever non-black. The world render is the only thing that
// bypasses the buffer now, so at flush time non-black buffer pixels are
// exactly the HUD/interface overlay — one final pass reproduces their order.
// This is also what keeps camera / stat-orbs / xp-drops pixel-identical with
// the GPU on: zero coupling, they are just overlay.
//
// Zero hunk surface beyond Client.ts: this file monkey-patches the Pix3D
// statics, Pix2D.setPixels/cls and PixMap.prototype.draw at load time
// (triggered by a single side-effect import in Client.ts). If WebGL2 is
// missing, shaders fail to compile, or the context is lost, the mod
// self-disables and every call site falls through to the untouched original
// software rasterizer.
//
// Settings: localStorage key 'gpu', default OFF. The flag refreshes at every
// Pix2D.cls() — the game viewport clears before the first triangle of a frame
// is captured — so the control-panel toggle applies live (never mid-frame)
// with no engine-side settings hook at all.
//
// Known v1 limitations (documented honestly):
//  - Texture/HSL shading steps per 8px in software, per pixel on GPU (same
//    look, continuous gradient).
//  - The software 'lowDetail' 4px blocky shading is a CPU artifact; the GPU
//    always per-pixel interpolates (the smooth-shading look, for free).
//  - Overlay pixels that are exactly black (0x000000 — also the buffer's
//    empty value) let the 3D scene show through. Black text/borders sit on
//    shadow pads, so real UI is unaffected.
//  - A frame over MAX_TRIS keeps overflowing triangles on the CPU raster;
//    they arrive via the overlay (HUD order instead of painter order that
//    frame only). A static screen never overflows; dense cities may.

import { canvas2d } from '#/graphics/Canvas.js';
import Pix2D from '#/graphics/Pix2D.js';
import PixMap from '#/graphics/PixMap.js';
import Pix3D from '#/dash3d/Pix3D.js';

type Win = Record<string, unknown>;
const WIN = window as unknown as Win;

// one captured triangle = 3 vertices x 16 floats
const VS = 16;
const MAX_TRIS = 98304; // 18.9 MB capture buffer; a busy 289 scene runs 30-60k

// vertex float slots
const AX = 0, AY = 1;
const MODE = 2;
const CLIP_X0 = 3, CLIP_Y0 = 4, CLIP_X1 = 5, CLIP_Y1 = 6;
// 7 unused
const TU = 8, TV = 9, TW = 10;
const TEXID = 11;
const SHADE = 12;  // gouraud: colourTable index | flat: 0xRRGGBB | tex: (shade<<17)
const ALPHA = 13;  // Pix3D.trans/256 = DESTINATION weight (software mix)
const SEQ = 14;    // capture order (1-based, per frame)
// 15 unused

// draw modes (uniform uMode)
const MODE_GOURAUD = 0; // colourTable[vShade]
const MODE_TEX = 1;     // texture-array affine sampling, replace/discard only
const MODE_OVERLAY = 2; // HUD composite fullscreen triangle
const MODE_FLAT = 3;    // vShade is an already-resolved 0xRRGGBB

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aXY;      // 512x334 screen space, y down
layout(location = 1) in float aShade;
layout(location = 2) in vec3 aUvw;
layout(location = 3) in float aTexId;
layout(location = 4) in float aAlpha;
layout(location = 5) in float aSeq;
out float vShade;
out vec3 vUvw;
flat out float vTexId;
flat out float vAlpha;
flat out float vSeq;
void main() {
    // the capture is already projected: NDC straight from screen coords.
    // 2/512 = 0.00390625, 2/334 — affine GL interpolation == raster affine.
    gl_Position = vec4(aXY.x * 0.00390625 - 1.0, 1.0 - aXY.y * 0.005988023952095808, 0.0, 1.0);
    vShade = aShade;
    vUvw = aUvw;
    vTexId = aTexId;
    vAlpha = aAlpha;
    vSeq = aSeq;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2DArray;
precision highp usampler2D;
in float vShade;
in vec3 vUvw;
flat in float vTexId;
flat in float vAlpha;
flat in float vSeq;
uniform int uMode;
uniform bool uLowMem;
uniform bool uTexOpaque;
uniform float uDepthScale;
uniform mediump usampler2DArray uTex;
uniform mediump usampler2D uColourTable;
uniform highp usampler2D uOverlay;
out vec4 fragColour;

vec3 unpack24(uint v) {
    return vec3(float((v >> 16u) & 255u), float((v >> 8u) & 255u), float(v & 255u)) * 0.00392156862745098;
}

void main() {
    // capture order as depth: GEQUAL + clear 0 => later sequence always wins
    gl_FragDepth = vSeq * uDepthScale;
    float trans = vAlpha; // dst weight, Pix3D.trans/256 (0 = replace)
    if (uMode == ${MODE_OVERLAY}) {
        // game-buffer Pix2D pixels (chat bubbles, hitbars, trackers, HUD).
        // buffer row 0 = top; gl_FragCoord.y counts from the bottom -> flip.
        uvec4 o = texelFetch(uOverlay, ivec2(int(gl_FragCoord.x), 333 - int(gl_FragCoord.y)), 0);
        if (o.r == 0u) {
            discard;
        }
        fragColour = vec4(unpack24(o.r), 1.0);
        return;
    }
    if (uMode == ${MODE_GOURAUD}) {
        int idx = int(vShade + 0.5);
        idx = idx < 0 ? 0 : (idx > 65535 ? 65535 : idx);
        fragColour = vec4(unpack24(texelFetch(uColourTable, ivec2(idx & 255, idx >> 8), 0).r), trans);
        return;
    }
    if (uMode == ${MODE_FLAT}) {
        int c = int(vShade + 0.5);
        vec3 rgb = vec3(float((c >> 16) & 255), float((c >> 8) & 255), float(c & 255)) * 0.00392156862745098;
        fragColour = vec4(rgb, trans);
        return;
    }

    // textureTriangle mirror: integer affine planes, w>>14 (>>12 lowMem)
    // fixed point, same clamps/masks/bands/shifts; holes discard (replace),
    // zero texels of a no-hole texture paint black exactly like the raster.
    int cu0 = int(vUvw.x);
    int cv0 = int(vUvw.y);
    int cw0 = int(vUvw.z);
    int e = int(vShade);
    int band = (e >> 21) & 3;
    int shift = (e >> 23) & 31;
    int col;
    int row;
    if (uLowMem) {
        int curW = cw0 >> 12;
        if (curW == 0) {
            discard;
        }
        int cu = cu0 / curW;
        cu = cu < 0 ? 0 : (cu > 4032 ? 4032 : cu);
        int cv = cv0 / curW;
        col = cu >> 6;
        row = ((cv & 0xfc0) >> 6) + band * 64;
    } else {
        int curW = cw0 >> 14;
        if (curW == 0) {
            discard;
        }
        int cu = cu0 / curW;
        cu = cu < 0 ? 0 : (cu > 16256 ? 16256 : cu);
        int cv = cv0 / curW;
        col = cu >> 7;
        row = ((cv & 0x3f80) >> 7) + band * 128;
    }
    uint packed = texelFetch(uTex, ivec3(col, row, int(vTexId)), 0).r;
    packed = packed >> uint(shift);
    if (packed == 0u) {
        if (uTexOpaque) {
            fragColour = vec4(0.0, 0.0, 0.0, 0.0); // pool has no holes: raster wrote black (blend a=0 -> replace)
            return;
        }
        discard; // transparent texel: the earlier pixel shows through
    }
    fragColour = vec4(unpack24(packed), 0.0); // textures replace (trans unused)
}
`;

interface GpuStats {
    frames: number;
    tris: number;
    batches: number;
    ms: number;
    glFrames: number;
    swFrames: number;
}

/// World/Pix3D/Client lowMem flip together (setLowMem/setHighMem) and decide
/// the texel pool addressing (64px vs 128px). Reading the Pix3D static is
/// safe: property mangling rewrites every reference identically in-bundle.
function poolLowMem(): boolean {
    return (Pix3D as unknown as { lowMem?: boolean }).lowMem === true;
}

/// Does texture `id` have zero (hole) texels? Authoritative answer comes from
/// GpuRenderer.texHoles, computed in flushTextures exactly like the software
/// getTexels does (base-band texels === 0). Before a texture has ever been
/// uploaded we fall back to Pix3D.texTrans (stale-but-usually-correct, since
/// getTexels filled it the last time the software rendered).
function textureHasHoles(id: number): boolean {
    const s = GpuRenderer.texHoles[id];
    if (s !== 2) {
        return s === 1;
    }
    const tt = (Pix3D as unknown as { texTrans?: boolean[] }).texTrans;
    return !!tt && tt[id] === true;
}

export class GpuRenderer {
    private static wanted = false;
    private static ready = false;
    private static failed = false;
    private static gl: WebGL2RenderingContext | null = null;
    private static glCanvas: HTMLCanvasElement | null = null;
    private static prog: WebGLProgram | null = null;
    private static vbo: WebGLBuffer | null = null;
    private static quadVbo: WebGLBuffer | null = null;
    private static texArray: WebGLTexture | null = null;
    private static overlayTex: WebGLTexture | null = null;
    private static colourTex: WebGLTexture | null = null;

    private static readonly tris = new Float32Array(MAX_TRIS * VS * 3);
    private static ntris = 0;
    private static seq = 1;

    private static gameBuf: Int32Array | null = null;
    private static gameU32: Uint32Array | null = null;
    private static readonly texScratch = new Uint32Array(128 * 512);
    private static readonly zeroScratch = new Uint32Array(128 * 512);
    private static texDirty = new Uint8Array(51).fill(1);
    // per-texture hole flags: 2 = unknown (never uploaded), 1/0 = authoritative
    static texHoles = new Uint8Array(51).fill(2);
    private static colourDirty = true;

    private static uMode: WebGLUniformLocation | null = null;
    private static uLowMem: WebGLUniformLocation | null = null;
    private static uTexOpaque: WebGLUniformLocation | null = null;
    private static uTex: WebGLUniformLocation | null = null;
    private static uColourTable: WebGLUniformLocation | null = null;
    private static uOverlay: WebGLUniformLocation | null = null;
    private static uDepthScale: WebGLUniformLocation | null = null;

    private static readonly stats: GpuStats = { frames: 0, tris: 0, batches: 0, ms: 0, glFrames: 0, swFrames: 0 };

    /** one-shot wiring; called at module load (side-effect import from Client.ts) */
    public static attach(): void {
        if (WIN['lcliteGpuAttached']) {
            return;
        }
        WIN['lcliteGpuAttached'] = true;
        this.installPatches();
        WIN['lcliteGpuStats'] = this.stats;
    }

    // ---- frame lifecycle ------------------------------------------------------

    /** Refresh the on/off flag once per frame at Pix2D.cls(): the game
     *  viewport clears before the first triangle is captured, so 'wanted' can
     *  never flip between capture and flush inside one frame. */
    public static refresh(): void {
        this.wanted = typeof localStorage !== 'undefined' && localStorage.getItem('gpu') === 'true';
    }

    /** true when triangles should be captured right now */
    public static capturing(): boolean {
        return this.wanted && this.ready && !this.failed && this.gameBuf !== null && Pix2D.pixels === this.gameBuf;
    }

    /** called from the patched PixMap.draw for the game buffer. Returns true
     *  when the GL scene has been composited onto the page canvas; false means
     *  the caller must run the original software putImageData path. */
    public static onGameDraw(x: number, y: number): boolean {
        if (!this.wanted) {
            this.stats.swFrames++;
            this.ntris = 0;
            this.seq = 1;
            return false;
        }
        if (this.ntris === 0) {
            this.seq = 1;
            if (!this.ready && !this.failed) {
                this.initGL(); // first GL frame paints via software, next captures
            }
            this.stats.swFrames++;
            return false;
        }
        if (!this.ready || this.failed || this.gl === null) {
            this.ntris = 0;
            this.seq = 1;
            this.stats.swFrames++;
            return false;
        }

        this.render();
        const err = this.gl.getError();
        if (err !== this.gl.NO_ERROR) {
            this.disable('webgl error 0x' + err.toString(16));
            return false;
        }
        canvas2d.drawImage(this.glCanvas!, x, y);
        this.stats.glFrames++;
        return true;
    }

    /** the per-frame game-buffer bind point (PixMap constructor / setPixels path) */
    public static noteGameBuffer(data: Int32Array): void {
        if (this.gameBuf !== data) {
            this.gameU32 = null;
        }
        this.gameBuf = data;
    }

    public static getStats(): GpuStats {
        return this.stats;
    }

    public static isReady(): boolean {
        return this.ready && !this.failed;
    }

    public static getError(): string {
        return String(WIN['lcliteGpuError'] ?? '');
    }

    private static disable(reason: string): void {
        this.ready = false;
        this.failed = true;
        this.ntris = 0;
        this.seq = 1;
        WIN['lcliteGpuError'] = reason;
        WIN['lcliteGpuReady'] = false;
        try {
            localStorage.setItem('gpu', 'false');
            window.dispatchEvent(new CustomEvent('lclite-gpu-off', { detail: reason }));
        } catch { /* ignore */ }
        console.warn('[lclite] gpu renderer disabled:', reason);
    }

    // ---- GL setup ---------------------------------------------------------------

    private static initGL(): void {
        try {
            const c = document.createElement('canvas');
            c.width = 512;
            c.height = 334;
            const gl = c.getContext('webgl2', {
                alpha: false,
                antialias: false,
                depth: true,
                stencil: false,
                premultipliedAlpha: true,
                preserveDrawingBuffer: false,
                powerPreference: 'high-performance'
            }) as WebGL2RenderingContext | null;
            if (!gl) {
                throw new Error('no WebGL2 context');
            }
            this.gl = gl;
            this.glCanvas = c;

            const vs = this.compile(gl, gl.VERTEX_SHADER, VERT_SRC);
            const fs = this.compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
            const prog = gl.createProgram()!;
            gl.attachShader(prog, vs);
            gl.attachShader(prog, fs);
            gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
                throw new Error('link: ' + String(gl.getProgramInfoLog(prog)));
            }
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            this.prog = prog;
            gl.useProgram(prog);

            this.uMode = gl.getUniformLocation(prog, 'uMode');
            this.uLowMem = gl.getUniformLocation(prog, 'uLowMem');
            this.uTexOpaque = gl.getUniformLocation(prog, 'uTexOpaque');
            this.uTex = gl.getUniformLocation(prog, 'uTex');
            this.uColourTable = gl.getUniformLocation(prog, 'uColourTable');
            this.uOverlay = gl.getUniformLocation(prog, 'uOverlay');
            this.uDepthScale = gl.getUniformLocation(prog, 'uDepthScale');
            gl.uniform1i(this.uTex, 0);
            gl.uniform1i(this.uOverlay, 1);
            gl.uniform1i(this.uColourTable, 2);

            // main capture buffer + attribute layout (16 floats/vertex)
            this.vbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
            gl.bufferData(gl.ARRAY_BUFFER, this.tris.byteLength, gl.DYNAMIC_DRAW);
            this.rebindAttribs(gl);

            // overlay: one giant screen triangle, only aXY matters
            this.quadVbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                -2, -2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                6, -2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                -2, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
            ]), gl.STATIC_DRAW);

            // 50 textures: 128 wide x 512 tall (4 shade bands x 128 rows) R32UI
            this.texArray = gl.createTexture();
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArray);
            gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R32UI, 128, 512, 50);
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 128, 512, 50, gl.RED_INTEGER, gl.UNSIGNED_INT, new Uint32Array(128 * 512 * 50));
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

            // overlay: the game buffer's Pix2D pixels
            this.overlayTex = gl.createTexture();
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32UI, 512, 334);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

            // colourTable: 65536 gamma-baked entries as 256x256 R32UI
            this.colourTex = gl.createTexture();
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this.colourTex);
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32UI, 256, 256);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

            gl.clearColor(0, 0, 0, 1);
            gl.clearDepth(0);
            gl.depthFunc(gl.GEQUAL); // capture-order depth: later always wins
            gl.enable(gl.DEPTH_TEST);
            gl.disable(gl.CULL_FACE);
            gl.enable(gl.SCISSOR_TEST);

            c.addEventListener('webglcontextlost', (e: Event) => {
                e.preventDefault();
                this.disable('webgl context lost');
            });

            this.ready = true;
            this.colourDirty = true;
            this.texDirty.fill(1);
            WIN['lcliteGpuReady'] = true;
        } catch (e) {
            this.failed = true;
            this.ready = false;
            WIN['lcliteGpuError'] = e instanceof Error ? e.message : String(e);
            console.warn('[lclite] gpu renderer unavailable:', e);
        }
    }

    private static rebindAttribs(gl: WebGL2RenderingContext): void {
        const stride = VS * 4;
        // loc: 0 aXY(0)  1 aShade(12)  2 aUvw(8)  3 aTexId(11)  4 aAlpha(13)  5 aSeq(14)
        const f = (loc: number, size: number, off: number): void => {
            gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
            gl.enableVertexAttribArray(loc);
        };
        f(0, 2, AX);
        f(1, 1, SHADE);
        f(2, 3, TU);
        f(3, 1, TEXID);
        f(4, 1, ALPHA);
        f(5, 1, SEQ);
    }

    private static compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            throw new Error('shader: ' + String(gl.getShaderInfoLog(s)));
        }
        return s;
    }

    // ---- capture ---------------------------------------------------------------

    /** reserve a triangle and stamp the per-tri constants; returns the vertex
     *  base offset into tris, or -1 (overflow) — caller falls back to software */
    private static begin(mode: number, alpha: number): number {
        if (this.ntris >= MAX_TRIS) {
            return -1;
        }
        const t = this.tris;
        const base = this.ntris * VS * 3;
        this.ntris++;
        for (let v = 0; v < 3; v++) {
            const o = base + v * VS;
            t[o + MODE] = mode;
            t[o + CLIP_X0] = Pix2D.clipMinX;
            t[o + CLIP_Y0] = Pix2D.clipMinY;
            t[o + CLIP_X1] = Pix2D.clipMaxX;
            t[o + CLIP_Y1] = Pix2D.clipMaxY;
            t[o + SEQ] = this.seq;
            t[o + ALPHA] = alpha;
            t[o + TU] = 0;
            t[o + TV] = 0;
            t[o + TW] = 0;
            t[o + TEXID] = 0;
            t[o + SHADE] = 0;
        }
        this.seq++;
        return base;
    }

    /** gouraudTriangle (mode 0) / flatTriangle (mode 3): shade slot holds the
     *  colourTable index (gouraud) or the resolved 0xRRGGBB (flat) */
    public static capturePrim(
        mode: number,
        xA: number, xB: number, xC: number,
        yA: number, yB: number, yC: number,
        cA: number, cB: number, cC: number
    ): boolean {
        const alpha = Pix3D.trans * (1 / 256); // dst weight; 0 = plain overwrite
        const base = this.begin(mode, alpha);
        if (base < 0) {
            return false;
        }
        const t = this.tris;
        const xs = [xA, xB, xC];
        const ys = [yA, yB, yC];
        const cs = [cA, cB, cC];
        for (let v = 0; v < 3; v++) {
            const o = base + v * VS;
            t[o + AX] = xs[v];
            t[o + AY] = ys[v];
            t[o + SHADE] = cs[v];
        }
        return true;
    }

    /** textureTriangle: exact copy of the software plane setup (see Pix3D),
     *  evaluated at each screen vertex the way textureRaster would walk to it */
    public static captureTex(
        xA: number, xB: number, xC: number,
        yA: number, yB: number, yC: number,
        shadeA: number, shadeB: number, shadeC: number,
        oX: number, oY: number, oZ: number,
        bX: number, cX: number,
        bY: number, cY: number,
        bZ: number, cZ: number,
        tex: number
    ): boolean {
        if (tex < 0 || tex >= 50 || !Pix3D.textures[tex]) {
            return true; // no texels — software would raster nothing; consume
        }
        // vertical = origin - B, horizontal = C - origin (as in textureTriangle)
        const vX = oX - bX, vY = oY - bY, vZ = oZ - bZ;
        const hX = cX - oX, hY = cY - oY, hZ = cZ - oZ;

        const u0 = ((hX * oY - hY * oX) << 14) | 0;
        const u1 = ((hY * oZ - hZ * oY) << 8) | 0;
        const u2 = ((hZ * oX - hX * oZ) << 5) | 0;
        const v0 = ((vX * oY - vY * oX) << 14) | 0;
        const v1 = ((vY * oZ - vZ * oY) << 8) | 0;
        const v2 = ((vZ * oX - vX * oZ) << 5) | 0;
        const w0 = ((vY * hX - vX * hY) << 14) | 0;
        const w1 = ((vZ * hY - vY * hZ) << 8) | 0;
        const w2 = ((vX * hZ - vZ * hX) << 5) | 0;

        const base = this.begin(MODE_TEX, 0); // textures never alpha-mix
        if (base < 0) {
            return false;
        }
        const t = this.tris;

        const ocx = Pix3D.originX;
        const ocy = Pix3D.originY;
        const xs = [xA, xB, xC];
        const ys = [yA, yB, yC];
        const shs = [shadeA, shadeB, shadeC];
        for (let v = 0; v < 3; v++) {
            const o = base + v * VS;
            const dx = xs[v] - ocx;
            const dy = ys[v] - ocy;
            // textureRaster's initial walk from (originX, rowY):
            //   u += uStepVertical * dy   then   u += (uStride >> 3) * dx
            // int32 semantics preserved with imul.
            let u = (u0 + Math.imul(u2, dy)) | 0;
            let vv = (v0 + Math.imul(v2, dy)) | 0;
            let w = (w0 + Math.imul(w2, dy)) | 0;
            u = (u + Math.imul(u1 >> 3, dx)) | 0;
            vv = (vv + Math.imul(v1 >> 3, dx)) | 0;
            w = (w + Math.imul(w1 >> 3, dx)) | 0;
            t[o + AX] = xs[v];
            t[o + AY] = ys[v];
            t[o + TU] = u;
            t[o + TV] = vv;
            t[o + TW] = w;
            t[o + TEXID] = tex;
            t[o + SHADE] = (shs[v] << 17) | 0; // textureRaster's shade word: (shade<<16)>>8<<9
        }
        return true;
    }

    // ---- render -------------------------------------------------------------------

    private static render(): void {
        const gl = this.gl!;
        const t = this.tris;
        const n = this.ntris;
        const t0 = performance.now();

        this.flushTextures();
        if (this.colourDirty) {
            this.uploadColourTable(gl);
        }

        gl.viewport(0, 0, 512, 334);
        gl.useProgram(this.prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArray);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.colourTex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
        gl.activeTexture(gl.TEXTURE0);

        gl.depthMask(true);
        gl.enable(gl.DEPTH_TEST);
        gl.scissor(0, 0, 512, 334);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // out = src*(1-trans/256) + dst*(trans/256); fragColour.a = trans/256
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.ONE_MINUS_SRC_ALPHA, gl.SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform1i(this.uLowMem!, poolLowMem() ? 1 : 0);
        gl.uniform1f(this.uDepthScale!, 1 / (this.seq + 1));

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        if (n > 0) {
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, t.subarray(0, n * VS * 3));
        }

        // batch runs of identical (mode, tex-hole class, clip rect); translucent
        // and opaque share runs — the per-triangle seq depth keeps it exact.
        let batches = 0;
        let i = 0;
        let curMode = -1;
        let curOpaque = -1;
        while (i < n) {
            const vb = i * VS * 3;
            const mode = t[vb + MODE] | 0;
            const texOpaque = mode === MODE_TEX ? (textureHasHoles(t[vb + TEXID] | 0) ? 0 : 1) : 1;
            const cx0 = t[vb + CLIP_X0];
            const cy0 = t[vb + CLIP_Y0];
            const cx1 = t[vb + CLIP_X1];
            const cy1 = t[vb + CLIP_Y1];

            let j = i + 1;
            while (j < n) {
                const wb = j * VS * 3;
                if ((t[wb + MODE] | 0) !== mode) break;
                if (mode === MODE_TEX && (texOpaque === 1) === textureHasHoles(t[wb + TEXID] | 0)) break;
                if (t[wb + CLIP_X0] !== cx0 || t[wb + CLIP_Y0] !== cy0 ||
                    t[wb + CLIP_X1] !== cx1 || t[wb + CLIP_Y1] !== cy1) break;
                j++;
            }

            if (mode !== curMode) {
                gl.uniform1i(this.uMode!, mode);
                curMode = mode;
            }
            if (mode === MODE_TEX && texOpaque !== curOpaque) {
                gl.uniform1i(this.uTexOpaque!, texOpaque);
                curOpaque = texOpaque;
            }
            this.setScissor(gl, cx0, cy0, cx1, cy1);
            gl.drawArrays(gl.TRIANGLES, i * 3, (j - i) * 3);
            batches++;
            i = j;
        }

        // HUD overlay: game-buffer Pix2D pixels, replace where non-black
        this.uploadOverlay(gl);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.disable(gl.BLEND);
        gl.uniform1i(this.uMode!, MODE_OVERLAY);
        gl.scissor(0, 0, 512, 334);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, VS * 4, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // restore state for next frame
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        this.rebindAttribs(gl);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);

        this.ntris = 0;
        this.seq = 1;
        this.stats.frames++;
        this.stats.tris = n;
        this.stats.batches = batches;
        this.stats.ms = performance.now() - t0;
        // refresh the panel-visible view (string element access survives mangling)
        (window as unknown as Record<string, unknown>)['lcliteGpuStats'] = this.snapshot();
    }

    /** panel-visible status snapshot (plain object, no mangled keys) */
    public static snapshot(): Record<string, number> {
        return {
            frames: this.stats.frames,
            tris: this.stats.tris,
            batches: this.stats.batches,
            ms: Math.round(this.stats.ms * 10) / 10,
            glFrames: this.stats.glFrames,
            swFrames: this.stats.swFrames
        };
    }

    private static setScissor(gl: WebGL2RenderingContext, minX: number, minY: number, maxX: number, maxY: number): void {
        const x0 = minX < 0 ? 0 : minX | 0;
        const x1 = maxX > 512 ? 512 : maxX | 0;
        const y0 = minY < 0 ? 0 : minY | 0;
        const y1 = maxY > 334 ? 334 : maxY | 0;
        if (x1 <= x0 || y1 <= y0) {
            gl.scissor(0, 0, 0, 0);
            return;
        }
        gl.scissor(x0, 334 - y1, x1 - x0, y1 - y0);
    }

    private static uploadOverlay(gl: WebGL2RenderingContext): void {
        if (!this.gameBuf) {
            return;
        }
        if (!this.gameU32) {
            this.gameU32 = new Uint32Array(this.gameBuf.buffer);
        }
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 334, gl.RED_INTEGER, gl.UNSIGNED_INT, this.gameU32);
        gl.activeTexture(gl.TEXTURE0);
    }

    private static uploadColourTable(gl: WebGL2RenderingContext): void {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.colourTex);
        const table = Pix3D.colourTable;
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 256, gl.RED_INTEGER, gl.UNSIGNED_INT, new Uint32Array(table.buffer));
        gl.activeTexture(gl.TEXTURE0);
        this.colourDirty = false;
    }

    /** (re)upload dirty textures into the R32UI array, mirroring getTexels:
     *  palette values masked to 0xf8f8ff + 3 extra shade bands stacked below */
    private static flushTextures(): void {
        const gl = this.gl;
        if (!gl) {
            return;
        }
        let any = false;
        for (let id = 0; id < 50; id++) {
            if (this.texDirty[id]) {
                any = true;
                break;
            }
        }
        if (!any) {
            return;
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArray);
        const pal0: (Int32Array | null)[] = (Pix3D as unknown as { texPal: (Int32Array | null)[] }).texPal;
        for (let id = 0; id < 50; id++) {
            if (!this.texDirty[id]) {
                continue;
            }
            this.texDirty[id] = 0;
            const texture = Pix3D.textures[id];
            const pal = pal0[id];
            if (!texture || !pal) {
                this.texHoles[id] = 1; // all-zero layer: software getTexels returns null (draws nothing)
                gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, id, 128, 512, 1, gl.RED_INTEGER, gl.UNSIGNED_INT, this.zeroScratch);
                continue;
            }
            const data = texture.data;
            const sc = this.texScratch;
            let holes = 0;
            if (poolLowMem()) {
                // 64x64 pool, bands at flat-index +4096*i (getTexels layout);
                // mirror into GL rows: band b starts at row b*64, 64 cols
                for (let i = 0; i < 4096; i++) {
                    const rgb = pal[data[i]] & 0xf8f8ff;
                    if (rgb === 0) holes = 1; // same rule getTexels uses for texTrans
                    const x = i & 63;
                    const y = i >> 6;
                    const base = y * 128 + x;
                    sc[base] = rgb;
                    sc[64 * 128 + base] = (rgb - (rgb >>> 3)) & 0xf8f8ff;
                    sc[2 * 64 * 128 + base] = (rgb - (rgb >>> 2)) & 0xf8f8ff;
                    sc[3 * 64 * 128 + base] = (rgb - (rgb >>> 2) - (rgb >>> 3)) & 0xf8f8ff;
                }
                gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, id, 128, 256, 1, gl.RED_INTEGER, gl.UNSIGNED_INT, sc);
            } else {
                const upsample = texture.wi === 64;
                for (let i = 0; i < 16384; i++) {
                    const src = upsample ? ((i >> 8) << 6) + ((i & 127) >> 1) : i;
                    const rgb = pal[data[src]] & 0xf8f8ff;
                    if (rgb === 0) holes = 1;
                    sc[i] = rgb;
                    sc[16384 + i] = (rgb - (rgb >>> 3)) & 0xf8f8ff;
                    sc[32768 + i] = (rgb - (rgb >>> 2)) & 0xf8f8ff;
                    sc[49152 + i] = (rgb - (rgb >>> 2) - (rgb >>> 3)) & 0xf8f8ff;
                }
                gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, id, 128, 512, 1, gl.RED_INTEGER, gl.UNSIGNED_INT, sc);
            }
            this.texHoles[id] = holes;
        }
        gl.activeTexture(gl.TEXTURE0);
    }

    // ---- monkey patches -----------------------------------------------------------

    private static installed = false;

    private static installPatches(): void {
        if (this.installed) {
            return;
        }
        this.installed = true;
        const gpu = this;

        // Pix2D.setPixels: the choke point where every render target binds.
        // areaGame (512x334) is the ONLY buffer whose triangles go to GL.
        const origSetPixels = Pix2D.setPixels;
        Pix2D.setPixels = function (pixels: Int32Array, width: number, height: number): void {
            origSetPixels.call(this, pixels, width, height);
            if (width === 512 && height === 334) {
                gpu.noteGameBuffer(pixels);
            }
        };

        // Pix2D.cls: per-frame settings refresh (runs right before world render)
        const origCls = Pix2D.cls;
        Pix2D.cls = function (): void {
            gpu.refresh();
            origCls.call(this);
        };

        // PixMap.draw: the game buffer's composite is the GL flush + blit point
        const origDraw = PixMap.prototype.draw;
        PixMap.prototype.draw = function (x: number, y: number): void {
            if (this.data === gpu.gameBuf && gpu.onGameDraw(x, y)) {
                return;
            }
            origDraw.call(this, x, y);
        };

        const origGouraud = Pix3D.gouraudTriangle;
        Pix3D.gouraudTriangle = function (
            xA: number, xB: number, xC: number,
            yA: number, yB: number, yC: number,
            cA: number, cB: number, cC: number
        ): void {
            if (gpu.capturing() && gpu.capturePrim(MODE_GOURAUD, xA, xB, xC, yA, yB, yC, cA, cB, cC)) {
                return;
            }
            origGouraud.call(this, xA, xB, xC, yA, yB, yC, cA, cB, cC);
        };

        const origFlat = Pix3D.flatTriangle;
        Pix3D.flatTriangle = function (
            xA: number, xB: number, xC: number,
            yA: number, yB: number, yC: number,
            c: number
        ): void {
            if (gpu.capturing() && gpu.capturePrim(MODE_FLAT, xA, xB, xC, yA, yB, yC, c, c, c)) {
                return;
            }
            origFlat.call(this, xA, xB, xC, yA, yB, yC, c);
        };

        const origTex = Pix3D.textureTriangle;
        Pix3D.textureTriangle = function (
            xA: number, xB: number, xC: number,
            yA: number, yB: number, yC: number,
            sA: number, sB: number, sC: number,
            oX: number, oY: number, oZ: number,
            bX: number, cX: number,
            bY: number, cY: number,
            bZ: number, cZ: number,
            tex: number
        ): void {
            if (gpu.capturing() && gpu.captureTex(xA, xB, xC, yA, yB, yC, sA, sB, sC, oX, oY, oZ, bX, cX, bY, cY, bZ, cZ, tex)) {
                return;
            }
            origTex.call(this, xA, xB, xC, yA, yB, yC, sA, sB, sC, oX, oY, oZ, bX, cX, bY, cY, bZ, cZ, tex);
        };

        // animated water: Client.textureRunAnims swaps textures[].data then
        // pushes the texel pool -> invalidate the GL layer too
        const origPush = Pix3D.pushTexture;
        Pix3D.pushTexture = function (id: number): void {
            origPush.call(this, id);
            if (id >= 0 && id < 50) {
                gpu.texDirty[id] = 1;
            }
        };

        // gamma/brightness rebuild -> colourTable + every texPal changes
        const origICT = Pix3D.initColourTable;
        Pix3D.initColourTable = function (brightness: number): void {
            origICT.call(this, brightness);
            gpu.texDirty.fill(1);
            gpu.colourDirty = true;
        };

        // world hop / re-login re-unpacks the texture pack
        const origUnpack = Pix3D.unpackTextures;
        Pix3D.unpackTextures = function (jag: Parameters<typeof Pix3D.unpackTextures>[0]): void {
            origUnpack.call(this, jag);
            gpu.texDirty.fill(1);
        };
    }
}

GpuRenderer.attach();
