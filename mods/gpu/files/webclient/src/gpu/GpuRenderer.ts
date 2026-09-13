// lclite "gpu" mod v2 (WebGPU) — renderer orchestrator / capture / composite.
//
// Architecture (docs/gpu-v2-assessment.md + GpuFormat.ts — READ THOSE FIRST):
// the CPU keeps doing EVERYTHING it's good at — scene construction, culling,
// lighting, painter ordering, and ALL picking (Model.mouseCheck / World.groundX
// resolve unchanged because capture happens after them, at the three Pix3D
// raster entry points). Only pixel work moves to the GPU. The capture format
// is backend-neutral (shared tier of the plan's split diagram); this file plus
// GpuShaders.ts is the WebGPU backend.
//
//   Pix3D capture (here, installPatches + capturePrim/captureTex)
//        -> Float32Array of 12-slot vertices (GpuFormat.ts)
//        -> ONE scene draw + ONE HUD overlay draw per frame on WebGPU
//
// Painter's algorithm preserved exactly, at depth-buffer speed: every captured
// triangle carries its capture sequence number as vertex z (seq * 2^-23);
// depth32float cleared to 0 with 'greater-equal' => "later capture always
// wins a pixel", the software's own semantics, but resolved by the fixed-
// function depth unit in one draw instead of v1's 30-60k drawArrays.
//
// P2 scope (this build):
//  - gouraud + flat triangles -> GPU (terrain, walls, decor, models,
//    near-plane-clipped fans from render3ZClip — all arrive as the same atoms).
//  - textured faces (Pix3D.textureTriangle) -> GPU as FLAT average-colour
//    faces (Pix3D.getTextureAverage — the same value the software's lowMem
//    path uses). They keep exact seq ordering, so painter's order never
//    splits; real texel sampling + hole discard is P5 (format slots 6-11
//    are reserved for the texture plane for that reason).
//  - HUD (chat bubbles, hitbars, headicons, walk arrow, xp tracker, orbs,
//    in-viewport interface text — CPU Pix2D writes into the same Int32Array
//    after world render) -> whole 512x334 r32uint upload + final quad pass,
//    non-black replaces, black discards. v1 uploaded the same full buffer
//    (R32UI); dirty-rect tracking is a later-phase optimization.
//  - capture overflow (frame > MAX_TRIS): extra triangles fall through to
//    the software raster and ride up via the overlay — v1's documented
//    degradation, unchanged.
//
// Compositing (differs from BOTH v1 and the abandoned WIP — deliberate):
// the WebGPU canvas is attached to the DOM, positioned exactly over the game
// rect of #canvas, alphaMode 'opaque'. A detached or display:none WebGPU
// canvas may never be PRESENTED (Dawn only presents canvases the page
// renders), which makes canvas2d.drawImage-from-it read an empty buffer —
// the suspect that the WIP's dbg5 "no-depth magenta triangle" experiment
// never ruled out because every debug mode shared that readback path. With a
// genuinely visible canvas there is no presentation variable at all: what
// the pipeline drew is what composites. When the GPU owns a frame the
// patched PixMap.draw SKIPS putImageData (the overlay replaces the game
// rect); on every non-GPU frame the overlay hides and software resumes
// pixel-exact. Known trade-off: fullscreen (#canvas-only element) would not
// show a body-level overlay — revisit with drawImage readback or reparenting
// if fullscreen GPU-on matters (software mode is unaffected).
//
// Failure model: every init/validation/device-lost path disables the GPU and
// surfaces the reason verbatim in window.lcliteGpuError (panel badge shows
// it) and flips localStorage 'gpu' off (panel badge reads it), same contract
// as v1. The software renderer underneath is never touched.
//
// Debug: localStorage 'gpudbg' = '1' draws the P1 proof triangle (no
// capture, no overlay) through the SAME canvas/place/depth plumbing — one
// glance separates "backend/canvas broken" from "capture/depth wrong".
//
// Settings: localStorage 'gpu' (default OFF), re-read at Pix2D.cls() so it
// can never flip mid-frame.
//
// The WebGL2 v1 (the reference implementation this ports, retired) lives in
// lclite git at 45eb643 — its capture semantics, colourTable/texture/blend
// dossier and tools/gpu_parity_test.ts remain the behavioral spec.

import Pix2D from '#/graphics/Pix2D.js';
import PixMap from '#/graphics/PixMap.js';
import Pix3D from '#/dash3d/Pix3D.js';
import GpuContext from '#/gpu/GpuContext.js';
import { sceneWgsl, OVERLAY_WGSL, TRIANGLE_WGSL } from '#/gpu/GpuShaders.js';
import {
    VS, MAX_TRIS, OXY, OSHADE, OMODE, OSEQ, OALPHA,
    OTU, OTV, OTW, OTEX, OTOPAQUE,
    MODE_GOURAUD, MODE_FLAT, MODE_TEX, TEX_COUNT, TEX_W, TEX_H,
    SEQ_DEPTH_SCALE,
    USAGE_COPY_DST, USAGE_VERTEX, USAGE_UNIFORM,
    USAGE_TEXTURE_COPY_DST, USAGE_TEXTURE_BINDING, USAGE_RENDER_ATTACHMENT,
} from '#/gpu/GpuFormat.js';

type Win = Record<string, unknown>;
const WIN = window as unknown as Win;

// the game viewport is a 512x334 areaGame buffer drawn at canvas (4,4)
export const GAME_W = 512;
export const GAME_H = 334;

interface GpuStats {
    frames: number;   // game-buffer frames seen while enabled
    tris: number;     // triangles submitted last frame
    batches: number;  // draw calls last frame
    ms: number;       // smoothed render+composite time
    glFrames: number; // frames owned by the GPU
    swFrames: number; // frames left fully to software
}

export class GpuRenderer {
    private static wanted = false;
    private static ready = false;
    private static failed = false;
    private static initializing = false;
    private static initMs = 0;

    // gpu objects (any: no @webgpu/types dependency — overlay rule)
    private static scenePipeline: any = null;
    private static overlayPipeline: any = null;
    private static proofPipeline: any = null;
    private static vbo: any = null;
    private static depthTex: any = null;
    private static colourTex: any = null;
    private static sceneBind: any = null;
    private static texArray: any = null;
    private static overlayTex: any = null;
    private static overlayBind: any = null;
    private static overlayUniform: any = null;
    private static overlayVbo: any = null;

    // P5 texel pool: mirrors getTexels (50 textures x 4 lightness bands) into
    // the 2D texture array; texHoles = authoritative per-layer hole flags
    // computed at upload (same rule getTexels uses for texTrans)
    private static readonly texScratch = new Uint32Array(TEX_W * TEX_H);
    private static readonly zeroScratch = new Uint32Array(TEX_W * TEX_H);
    private static texDirty = new Uint8Array(TEX_COUNT).fill(1);
    private static texHoles = new Uint8Array(TEX_COUNT).fill(2); // 2=never uploaded
    private static sceneLowMem = false; // LOW_MEM baked into scene shader

    // shared capture buffer (format: GpuFormat.ts)
    private static readonly capture = new Float32Array(MAX_TRIS * 3 * VS);
    private static nv = 0;   // captured vertices this frame (tris = nv/3)
    private static seq = 1;  // 1-based capture order within the frame

    private static gameBuf: Int32Array | null = null;
    private static gameU32: Uint32Array | null = null;
    private static colourDirty = true;
    private static overlayVisible = false;
    private static lastPlace = '';

    private static lastRenderMs = 0;
    private static readonly stats: GpuStats = { frames: 0, tris: 0, batches: 0, ms: 0, glFrames: 0, swFrames: 0 };

    /** one-shot wiring; called at module load (side-effect import from Client.ts) */
    public static attach(): void {
        if (WIN['lcliteGpuAttached']) {
            return;
        }
        WIN['lcliteGpuAttached'] = true;
        WIN['lcliteGpuStats'] = this.stats;
        this.installPatches();
    }

    // ---- lifecycle ------------------------------------------------------------

    /** Refresh on/off at Pix2D.cls(): the flag can never flip between the
     *  world render and the composite inside one frame (same as v1). */
    public static refresh(): void {
        const wanted = typeof localStorage !== 'undefined' && localStorage.getItem('gpu') === 'true';
        if (wanted && !this.wanted && !this.ready && !this.failed && !this.initializing) {
            this.startInit();
        }
        this.wanted = wanted && !this.failed;
        if (!this.wanted) {
            this.hideOverlay();
            if (!this.failed) {
                WIN['lcliteGpuError'] = null;
            }
            return;
        }
        // lowMem flips the engine's texel pool addressing (Client.setLowMem
        // at runtime); LOW_MEM is baked into the scene shader, so rebuild it.
        // Rare path: guarded by the compare, and flushTextures re-dirties all
        // layers because their layout depends on the mode.
        const lm = (Pix3D as unknown as { lowMem?: boolean }).lowMem === true;
        if (this.ready && lm !== this.sceneLowMem && !this.rebuilding) {
            this.rebuilding = true;
            this.ready = false; // software frames carry the scene meanwhile
            this.texDirty.fill(1);
            this.buildPipelines().then((err): void => {
                this.rebuilding = false;
                if (err !== null) {
                    this.disable('lowMem rebuild: ' + err);
                    return;
                }
                this.ready = true;
            }, (e: unknown): void => {
                this.rebuilding = false;
                this.disable('lowMem rebuild threw: ' + (e instanceof Error ? e.message : String(e)));
            });
        }
    }

    private static rebuilding = false;

    private static startInit(): void {
        this.initializing = true;
        const t0 = performance.now();
        GpuContext.init(GAME_W, GAME_H).then((r): void => {
            this.initializing = false;
            this.initMs = Math.round(performance.now() - t0);
            if (!r.ok) {
                this.disable(r.error ?? 'init failed');
                return;
            }
            this.buildPipelines().then((err): void => {
                if (err !== null) {
                    this.disable(err);
                    return;
                }
                this.ready = true;
                WIN['lcliteGpuReady'] = true;
                WIN['lcliteGpuError'] = null;
            });
        }, (e: unknown): void => {
            this.initializing = false;
            this.disable('init rejected: ' + (e instanceof Error ? e.message : String(e)));
        });
    }

    private static async buildPipelines(): Promise<string | null> {
        const device: any = GpuContext.device;

        // -- scene module: LOW_MEM baked into the WGSL (see sceneWgsl) --
        this.sceneLowMem = (Pix3D as unknown as { lowMem?: boolean }).lowMem === true;
        let sm: any;
        try {
            sm = device.createShaderModule({ code: sceneWgsl(this.sceneLowMem), label: 'lclite-gpu-scene' });
        } catch (e) {
            return 'scene shader threw: ' + (e instanceof Error ? e.message : String(e));
        }
        let cerr: string | null = await GpuRenderer.compileErrors(sm, 'scene');
        if (cerr) {
            return cerr;
        }

        let err: string | null = await GpuContext.inErrorScope((): void => {
            this.scenePipeline = device.createRenderPipeline({
                label: 'lclite-gpu-scene',
                layout: 'auto',
                vertex: {
                    module: sm,
                    entryPoint: 'vs',
                    buffers: [{
                        arrayStride: VS * 4,
                        attributes: [
                            { shaderLocation: 0, offset: OXY * 4, format: 'float32x2' },   // xy
                            { shaderLocation: 1, offset: OSHADE * 4, format: 'float32' },   // shade
                            { shaderLocation: 2, offset: OMODE * 4, format: 'float32' },    // mode
                            { shaderLocation: 3, offset: OSEQ * 4, format: 'float32' },     // seq
                            { shaderLocation: 4, offset: OALPHA * 4, format: 'float32' },   // alpha
                            { shaderLocation: 5, offset: OTU * 4, format: 'float32x3' },    // u,v,w plane
                            { shaderLocation: 6, offset: OTEX * 4, format: 'float32x2' },   // texId, opaque
                        ],
                    }],
                },
                fragment: { module: sm, entryPoint: 'fs', targets: [{
                    format: GpuContext.format,
                    // fs emits premultiplied rgb = c*(1-a) with a = trans/256
                    // (dst weight): out = src + dst*a reproduces the software
                    // mix c*(256-t)/256 + dst*t/256 exactly. a=0 => overwrite.
                    blend: {
                        color: { srcFactor: 'one', dstFactor: 'src-alpha', operation: 'add' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    },
                }] },
                primitive: { topology: 'triangle-list', cullMode: 'none' },
                depthStencil: { depthWriteEnabled: true, depthCompare: 'greater-equal', format: 'depth32float' },
            });
        });
        if (err) {
            return 'scene pipeline: ' + err;
        }

        // -- overlay module --
        let om: any;
        try {
            om = device.createShaderModule({ code: OVERLAY_WGSL, label: 'lclite-gpu-overlay' });
        } catch (e) {
            return 'overlay shader threw: ' + (e instanceof Error ? e.message : String(e));
        }
        cerr = await GpuRenderer.compileErrors(om, 'overlay');
        if (cerr) {
            return cerr;
        }

        err = await GpuContext.inErrorScope((): void => {
            this.overlayPipeline = device.createRenderPipeline({
                label: 'lclite-gpu-overlay',
                layout: 'auto',
                vertex: {
                    module: om,
                    entryPoint: 'vs2',
                    buffers: [{
                        arrayStride: 8,
                        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
                    }],
                },
                // WebGPU REQUIRES pipeline attachment state to match the
                // render pass: our shared frame pass always attaches the
                // depth buffer, so even the overlay pipeline must declare a
                // depthStencil (compare 'always' + no write = it wins every
                // pixel it paints, exactly the "no depth interaction" intent
                // WebGL got from glDisable(DEPTH_TEST)). A pipeline with NO
                // depthStencil here poisons setPipeline -> invalid command
                // buffer -> black frame (learned live, Sept 10).
                fragment: { module: om, entryPoint: 'fs2', targets: [{ format: GpuContext.format }] },
                primitive: { topology: 'triangle-list', cullMode: 'none' },
                depthStencil: { depthWriteEnabled: false, depthCompare: 'always', format: 'depth32float' },
            });
        });
        if (err) {
            return 'overlay pipeline: ' + err;
        }

        // -- proof pipeline (P1 regression, gpudbg=1) --
        let pm: any;
        try {
            pm = device.createShaderModule({ code: TRIANGLE_WGSL, label: 'lclite-gpu-proof' });
        } catch (e) {
            return 'proof shader threw: ' + (e instanceof Error ? e.message : String(e));
        }
        cerr = await GpuRenderer.compileErrors(pm, 'proof');
        if (cerr) {
            return cerr;
        }
        err = await GpuContext.inErrorScope((): void => {
            this.proofPipeline = device.createRenderPipeline({
                label: 'lclite-gpu-proof',
                layout: 'auto',
                vertex: { module: pm, entryPoint: 'vs' },
                fragment: { module: pm, entryPoint: 'fs', targets: [{ format: GpuContext.format }] },
                primitive: { topology: 'triangle-list' },
                // same pass needs compatible depth state; z=0 passes GEQUAL vs clear 0
                depthStencil: { depthWriteEnabled: true, depthCompare: 'greater-equal', format: 'depth32float' },
            });
        });
        if (err) {
            return 'proof pipeline: ' + err;
        }

        // -- persistent resources --
        err = await GpuContext.inErrorScope((): void => {
            this.vbo = device.createBuffer({
                label: 'lclite-gpu-vbo',
                size: this.capture.byteLength,
                usage: USAGE_COPY_DST | USAGE_VERTEX,
            });
            this.depthTex = device.createTexture({
                label: 'lclite-gpu-depth',
                size: { width: GAME_W, height: GAME_H },
                dimension: '2d',
                format: 'depth32float',
                usage: USAGE_RENDER_ATTACHMENT,
                sampleCount: 1,
            });
            // colourTable: 65536 gamma-baked 0xRRGGBB as 256x256 r32uint
            this.colourTex = device.createTexture({
                label: 'lclite-gpu-colourtable',
                size: { width: 256, height: 256 },
                dimension: '2d',
                format: 'r32uint',
                usage: USAGE_TEXTURE_COPY_DST | USAGE_TEXTURE_BINDING,
            });
            // P5 texel pool: 50 layers x (128 wide x 512 tall = 4 bands x
            // 128 rows), one layer per Pix3D texture id. lowMem fills the
            // first 256 rows (64-col bands at row stride 128) — same buffer
            // shape either way, the shader's addressing differs (LOW_MEM).
            this.texArray = device.createTexture({
                label: 'lclite-gpu-texarray',
                size: { width: TEX_W, height: TEX_H, depthOrArrayLayers: TEX_COUNT },
                // WebGPU has NO '2d-array' dimension (that's GL's enum name):
                // array textures are dimension '2d' + depthOrArrayLayers.
                dimension: '2d',
                format: 'r32uint',
                usage: USAGE_TEXTURE_COPY_DST | USAGE_TEXTURE_BINDING,
            });
            this.sceneBind = device.createBindGroup({
                layout: this.scenePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.colourTex.createView() },
                    { binding: 1, resource: this.texArray.createView() },
                ],
            });
            // HUD overlay: uniform (rect origin+size) + full-frame r32uint tex
            this.overlayUniform = device.createBuffer({
                label: 'lclite-gpu-overlay-uniform',
                size: 16,
                usage: USAGE_COPY_DST | USAGE_UNIFORM,
            });
            this.overlayVbo = device.createBuffer({
                label: 'lclite-gpu-overlay-quad',
                size: 24 * 4,
                usage: USAGE_COPY_DST | USAGE_VERTEX,
            });
            this.overlayTex = device.createTexture({
                label: 'lclite-gpu-hud',
                size: { width: GAME_W, height: GAME_H },
                dimension: '2d',
                format: 'r32uint',
                usage: USAGE_TEXTURE_COPY_DST | USAGE_TEXTURE_BINDING,
            });
            this.overlayBind = device.createBindGroup({
                layout: this.overlayPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.overlayUniform } },
                    { binding: 1, resource: this.overlayTex.createView() },
                ],
            });
            // full-frame quad in rect-local 0..1 space (uniform maps to px)
            const q = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
            device.queue.writeBuffer(this.overlayVbo, 0, q.buffer, 0, q.byteLength);
        });
        if (err) {
            return 'resources: ' + err;
        }

        this.colourDirty = true;
        return null;
    }

    private static async compileErrors(module: any, which: string): Promise<string | null> {
        try {
            if (module.getCompilationInfo) {
                const info: any = await module.getCompilationInfo();
                const errs: string[] = (info.messages ?? []).filter((m: any): boolean => m.type === 'error')
                    .map((m: any): string => m.message + ' @' + m.lineOffset + ':' + m.offset);
                if (errs.length > 0) {
                    return 'WGSL compile(' + which + '): ' + errs.join(' | ');
                }
            }
        } catch (_e) {
            // older/limited impls: pipeline creation still errors loudly
        }
        return null;
    }

    private static disable(reason: string): void {
        this.failed = true;
        this.ready = false;
        this.wanted = false;
        this.nv = 0;
        this.seq = 1;
        this.hideOverlay();
        WIN['lcliteGpuReady'] = false;
        WIN['lcliteGpuError'] = reason;
        try {
            localStorage.setItem('gpu', 'false');
            window.dispatchEvent(new CustomEvent('lclite-gpu-off', { detail: reason }));
        } catch { /* ignore */ }
        // eslint-disable-next-line no-console
        console.error('[lclite gpu] disabled:', reason, '— software renderer stays active');
    }

    public static isReady(): boolean {
        return this.ready && !this.failed;
    }

    // ---- capture --------------------------------------------------------------

    /** true while triangles should be captured into the GPU batch */
    public static capturing(): boolean {
        return this.wanted && this.ready && !this.failed && this.gameBuf !== null && Pix2D.pixels === this.gameBuf;
    }

    /** append one triangle; false = capture full (caller runs software raster).
     *  alpha = destination weight (Pix3D.trans/256): gouraud/flat pass it,
     *  texture faces pass 0 — the software textureRaster REPLACES (v1 rule).
     *  public for tools/gpu_parity_test (same reason as v1's capturePrim). */
    public static captureTri(mode: number, alpha: number,
        xA: number, xB: number, xC: number,
        yA: number, yB: number, yC: number,
        sA: number, sB: number, sC: number): boolean {
        if (this.nv + 3 > MAX_TRIS * 3) {
            return false;
        }
        const c = this.capture;
        const seq = this.seq++;
        const a = alpha;
        let o = this.nv * VS;
        const put = (x: number, y: number, s: number): void => {
            c[o] = x; c[o + 1] = y; c[o + 2] = s; c[o + 3] = mode; c[o + 4] = seq; c[o + 5] = a;
            o += VS;
        };
        put(xA, yA, sA);
        put(xB, yB, sB);
        put(xC, yC, sC);
        this.nv += 3;
        return true;
    }

    /** P5: textured face -> affine u,v,w plane evaluated at each screen
     *  vertex exactly the way textureRaster walks to it (v1's captureTex,
     *  parity-tested by tools/gpu_parity_test): base (u0,v0,w0) from the
     *  cross products, += stepVertical*dy, += (stride>>3)*dx, int32 via
     *  imul; the Float32Array store itself performs the f32 rounding the
     *  GLSL mirror reads back. texId/opaque are per-triangle constants.
     *  public for tools/gpu_parity_test (same reason as v1's captureTex). */
    public static captureTexTri(
        xA: number, xB: number, xC: number,
        yA: number, yB: number, yC: number,
        sA: number, sB: number, sC: number,
        oX: number, oY: number, oZ: number,
        bX: number, cX: number,
        bY: number, cY: number,
        bZ: number, cZ: number,
        tex: number
    ): boolean {
        if (this.nv + 3 > MAX_TRIS * 3) {
            return false;
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

        const c = this.capture;
        const seq = this.seq++;
        // textures never alpha-mix (the raster replaces) — alpha slot 0
        const opaque = this.textureHasHoles(tex) ? 0 : 1;
        const ocx = Pix3D.originX;
        const ocy = Pix3D.originY;
        const xs = [xA, xB, xC];
        const ys = [yA, yB, yC];
        const shs = [sA, sB, sC];
        let o = this.nv * VS;
        for (let v = 0; v < 3; v++) {
            const dx = xs[v] - ocx;
            const dy = ys[v] - ocy;
            let u = (u0 + Math.imul(u2, dy)) | 0;
            let vv = (v0 + Math.imul(v2, dy)) | 0;
            let w = (w0 + Math.imul(w2, dy)) | 0;
            u = (u + Math.imul(u1 >> 3, dx)) | 0;
            vv = (vv + Math.imul(v1 >> 3, dx)) | 0;
            w = (w + Math.imul(w1 >> 3, dx)) | 0;
            c[o] = xs[v]; c[o + 1] = ys[v];
            c[o + 2] = (shs[v] << 17) | 0; // textureRaster's shade word
            c[o + 3] = MODE_TEX; c[o + 4] = seq; c[o + 5] = 0;
            c[o + OTU] = u; c[o + OTV] = vv; c[o + OTW] = w;
            c[o + OTEX] = tex; c[o + OTOPAQUE] = opaque;
            o += VS;
        }
        this.nv += 3;
        return true;
    }

    /** Authoritative per-texture hole flags (v1's texHoles): computed at
     *  upload exactly like getTexels derives texTrans (any base-band texel
     *  === 0 after the 0xf8f8ff mask). 2 = never uploaded -> fall back to
     *  Pix3D.texTrans (stale-but-usually-right from the last software run). */
    private static textureHasHoles(id: number): boolean {
        const s = this.texHoles[id];
        if (s !== 2) {
            return s === 1;
        }
        const tt = (Pix3D as unknown as { texTrans?: boolean[] }).texTrans;
        return !!tt && tt[id] === true;
    }

    /** (re)upload dirty texture layers into the array, mirroring getTexels:
     *  palette values masked 0xf8f8ff + 3 shade bands. Reads texture.data +
     *  texPal directly (v1's route), NOT the engine's LRU activeTexels pool —
     *  textureRunAnims swaps .data then pushTexture()s, which marks layers
     *  dirty here, so animated water stays current even when software never
     *  touches the pool while the GPU owns frames. lowMem writes the
     *  4096-texel layout (64x64 per band, bands at rows 64*i); the 64px
     *  source upsample matches getTexels' (x>>1)+((y>>1)<<6) indexing. */
    private static flushTextures(): void {
        const queue: any = GpuContext.queue;
        let anyDirty = false;
        for (let id = 0; id < TEX_COUNT; id++) {
            if (this.texDirty[id]) {
                anyDirty = true;
                break;
            }
        }
        if (!anyDirty) {
            return;
        }
        const lowMem = (Pix3D as unknown as { lowMem?: boolean }).lowMem === true;
        const pal0 = (Pix3D as unknown as { texPal: (Int32Array | null)[] }).texPal;
        for (let id = 0; id < TEX_COUNT; id++) {
            if (!this.texDirty[id]) {
                continue;
            }
            this.texDirty[id] = 0;
            const texture = Pix3D.textures[id];
            const pal = pal0[id];
            if (!texture || !pal) {
                this.texHoles[id] = 1; // empty layer: getTexels would return null
                queue.writeTexture(
                    { texture: this.texArray, mipLevel: 0, origin: [0, 0, id] },
                    this.zeroScratch,
                    { bytesPerRow: TEX_W * 4, rowsPerImage: 256 },
                    { width: TEX_W, height: 256, depthOrArrayLayers: 1 },
                );
                continue;
            }
            const data = texture.data;
            const sc = this.texScratch;
            let holes = 0;
            if (lowMem) {
                for (let i = 0; i < 4096; i++) {
                    const rgb = pal[data[i]] & 0xf8f8ff;
                    if (rgb === 0) {
                        holes = 1;
                    }
                    const base = (i & 63) + ((i >> 6) << 7); // x + y*128
                    sc[base] = rgb;
                    sc[64 * 128 + base] = (rgb - (rgb >>> 3)) & 0xf8f8ff;
                    sc[2 * 64 * 128 + base] = (rgb - (rgb >>> 2)) & 0xf8f8ff;
                    sc[3 * 64 * 128 + base] = (rgb - (rgb >>> 2) - (rgb >>> 3)) & 0xf8f8ff;
                }
                queue.writeTexture(
                    { texture: this.texArray, mipLevel: 0, origin: [0, 0, id] },
                    sc,
                    { bytesPerRow: TEX_W * 4, rowsPerImage: 256 },
                    { width: TEX_W, height: 256, depthOrArrayLayers: 1 },
                );
            } else {
                const upsample = (texture as unknown as { wi: number }).wi === 64;
                for (let i = 0; i < 16384; i++) {
                    const src = upsample ? ((i >> 8) << 6) + ((i & 127) >> 1) : i;
                    const rgb = pal[data[src]] & 0xf8f8ff;
                    if (rgb === 0) {
                        holes = 1;
                    }
                    sc[i] = rgb;
                    sc[16384 + i] = (rgb - (rgb >>> 3)) & 0xf8f8ff;
                    sc[32768 + i] = (rgb - (rgb >>> 2)) & 0xf8f8ff;
                    sc[49152 + i] = (rgb - (rgb >>> 2) - (rgb >>> 3)) & 0xf8f8ff;
                }
                queue.writeTexture(
                    { texture: this.texArray, mipLevel: 0, origin: [0, 0, id] },
                    sc,
                    { bytesPerRow: TEX_W * 4, rowsPerImage: TEX_H },
                    { width: TEX_W, height: TEX_H, depthOrArrayLayers: 1 },
                );
            }
            this.texHoles[id] = holes;
        }
    }

    // ---- frame ----------------------------------------------------------------

    /** called from the patched PixMap.draw for the game buffer. true = GPU
     *  owns the frame (overlay placed+visible, software putImageData skipped). */
    public static onGameDraw(x: number, y: number): boolean {
        this.stats.frames++;
        if (!this.wanted) {
            this.stats.swFrames++;
            return false;
        }
        if (GpuContext.lost !== null) {
            this.disable(GpuContext.lost);
            this.stats.swFrames++;
            return false;
        }
        if (!this.ready || !GpuContext.alive()) {
            // pending/broken: software drew everything into the buffer —
            // normal putImageData, hide any stale overlay
            this.nv = 0;
            this.seq = 1;
            this.hideOverlay();
            this.stats.swFrames++;
            return false;
        }

        const t0 = performance.now();
        try {
            this.renderFrame(x, y);
        } catch (e) {
            this.disable('render threw: ' + (e instanceof Error ? e.message : String(e)));
            return false;
        }
        const dt = performance.now() - t0;
        this.lastRenderMs = this.lastRenderMs === 0 ? dt : this.lastRenderMs * 0.9 + dt * 0.1;
        this.stats.ms = Math.round(this.lastRenderMs * 100) / 100;
        this.stats.glFrames++;
        return true;
    }

    /** place the DOM overlay exactly over the game rect and make it visible.
     *  Recomputed per frame (canvas resize / page scroll) but only written on
     *  change, so steady-state cost is one getBoundingClientRect. */
    private static place(x: number, y: number): void {
        const c = GpuContext.canvas;
        const base = document.getElementById('canvas') as HTMLCanvasElement | null;
        if (!c || !base || !base.width || !base.height) {
            return;
        }
        const rect = base.getBoundingClientRect();
        const sx = rect.width / base.width;   // css px per backing-store px
        const sy = rect.height / base.height;
        const want = 'position:fixed;z-index:3;pointer-events:none;image-rendering:pixelated;'
            + 'left:' + (rect.left + x * sx).toFixed(2) + 'px;'
            + 'top:' + (rect.top + y * sy).toFixed(2) + 'px;'
            + 'width:' + (GAME_W * sx).toFixed(2) + 'px;'
            + 'height:' + (GAME_H * sy).toFixed(2) + 'px;';
        if (want !== this.lastPlace) {
            this.lastPlace = want;
            c.style.cssText = want;
        }
        if (!this.overlayVisible) {
            this.overlayVisible = true;
            c.style.display = 'block';
        }
    }

    private static hideOverlay(): void {
        const c = GpuContext.canvas;
        if (c && this.overlayVisible) {
            this.overlayVisible = false;
            c.style.display = 'none';
        }
    }

    private static renderFrame(bx: number, by: number): void {
        const device: any = GpuContext.device;
        const queue: any = GpuContext.queue;
        const context: any = GpuContext.context;
        const target: any = context.getCurrentTexture().createView();

        const dbgMode = typeof localStorage !== 'undefined' ? (localStorage.getItem('gpudbg') ?? '0') : '0';

        // P5: dirty texel layers before anything can sample them
        this.flushTextures();

        if (this.colourDirty) {
            // colourTable is Int32Array(65536) of 0xRRGGBB; as u32 into
            // 256x256 r32uint (x = idx & 255, y = idx >> 8; bytesPerRow
            // 1024 is %256-clean — no padding needed)
            queue.writeTexture(
                { texture: this.colourTex },
                new Uint32Array(Pix3D.colourTable.buffer),
                { bytesPerRow: 256 * 4, rowsPerImage: 256 },
                { width: 256, height: 256, depthOrArrayLayers: 1 },
            );
            this.colourDirty = false;
        }

        const encoder: any = device.createCommandEncoder({ label: 'lclite-gpu-frame' });
        const pass: any = encoder.beginRenderPass({
            colorAttachments: [{
                view: target,
                // opaque canvas clears black; a=1 so blending dst alpha is
                // well-defined for the trans-mix (dst alpha is only a
                // blend-channel, the canvas itself is composited opaque)
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: 'clear' as const,
                storeOp: 'store' as const,
            }],
            depthStencilAttachment: {
                view: this.depthTex.createView(),
                depthClearValue: 0.0,
                depthLoadOp: 'clear' as const,
                depthStoreOp: 'discard' as const,
            },
        });

        let batches = 0;
        if (dbgMode === '1') {
            // P1 proof: fixed triangle through the SAME pipeline/canvas/place
            // plumbing, no capture, no overlay
            pass.setPipeline(this.proofPipeline);
            pass.draw(3, 1, 0, 0);
            batches = 1;
            this.stats.tris = 1;
        } else {
            if (this.nv >= 3) {
                queue.writeBuffer(this.vbo, 0, this.capture.buffer, 0, this.nv * VS * 4);
                pass.setPipeline(this.scenePipeline);
                pass.setBindGroup(0, this.sceneBind);
                pass.setVertexBuffer(0, this.vbo);
                pass.draw(this.nv, 1, 0, 0);
                batches++;
                this.stats.tris = this.nv / 3;
            } else {
                this.stats.tris = 0;
            }

            // HUD overlay: whole game buffer, non-black replaces, last-wins
            const buf = this.gameU32 ??= new Uint32Array(this.gameBuf!.buffer);
            queue.writeTexture(
                { texture: this.overlayTex },
                buf,
                { bytesPerRow: GAME_W * 4, rowsPerImage: GAME_H },
                { width: GAME_W, height: GAME_H, depthOrArrayLayers: 1 },
            );
            queue.writeBuffer(this.overlayUniform, 0, new Float32Array([0, 0, GAME_W, GAME_H]));
            pass.setPipeline(this.overlayPipeline);
            pass.setBindGroup(0, this.overlayBind);
            pass.setVertexBuffer(0, this.overlayVbo);
            pass.draw(6, 1, 0, 0);
            batches++;
        }
        pass.end();
        // WebGPU validation is ASYNC: bad pass/pipeline state (attachment
        // mismatch etc.) does not throw here — it poisons the command buffer
        // and surfaces later, which would otherwise spam the console every
        // frame with a black rect while our stats claim healthy frames
        // (v1 had gl.getError() for exactly this; the port must keep that
        // discipline). One error scope around submit: the first frame that
        // misvalidates disables the GPU with the message verbatim.
        device.pushErrorScope('validation');
        device.queue.submit([encoder.finish()]);
        device.popErrorScope().then((e: any): void => {
            if (e && !this.failed) {
                this.disable('submit validation: ' + String(e.message ?? e).slice(0, 300));
            }
        });

        this.stats.batches = batches;
        // overlay is the whole game rect now (opaque): position + show it
        this.place(bx, by);

        // reset the batch: frames with no world render must not resubmit
        this.nv = 0;
        this.seq = 1;
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

    // ---- monkey patches -------------------------------------------------------

    private static installed = false;

    private static installPatches(): void {
        if (this.installed) {
            return;
        }
        this.installed = true;
        const gpu = this;

        // Pix2D.setPixels: choke point where every render target binds; the
        // 512x334 one is areaGame — the ONLY buffer the GPU path owns.
        const origSetPixels = Pix2D.setPixels;
        Pix2D.setPixels = function (pixels: Int32Array, width: number, height: number): void {
            origSetPixels.call(this, pixels, width, height);
            if (width === GAME_W && height === GAME_H) {
                gpu.noteGameBuffer(pixels);
            }
        };

        // Pix2D.cls: per-frame settings refresh (also = new frame boundary).
        // GPU frames clear to SENTINEL_BLACK=1 instead of 0: the software
        // buffer's "empty" value (0) is INDISTINGUISHABLE from Colour.BLACK
        // (0x0 — the minimenu title bar, text shadows), so an overlay that
        // discards 0 punches holes in black UI (v1's documented artifact,
        // now eliminated). With a GPU frame active the world never writes
        // the buffer, so sentinel-1 means "nothing drawn here" exactly.
        // putImageData is skipped for GPU frames so 1 never reaches screen;
        // if the GPU dies mid-frame, 0x000001 reads as black anyway.
        const origCls = Pix2D.cls;
        Pix2D.cls = function (): void {
            gpu.refresh();
            if (gpu.wanted && gpu.ready && !gpu.failed && gpu.gameBuf !== null
                && Pix2D.pixels === gpu.gameBuf && Pix2D.width === GAME_W && Pix2D.height === GAME_H) {
                Pix2D.pixels.fill(1);
                return;
            }
            origCls.call(this);
        };

        // PixMap.draw: game buffer composite point. When the GPU owns the
        // frame the overlay canvas REPLACES the game rect — putImageData is
        // redundant (v1 semantics). Off/pending/failed: fall through.
        const origDraw = PixMap.prototype.draw;
        PixMap.prototype.draw = function (x: number, y: number): void {
            if (this.data === gpu.gameBuf && gpu.onGameDraw(x, y)) {
                return;
            }
            origDraw.call(this, x, y);
        };

        // gouraud: shade = colourTable index, resolved on GPU
        const origGouraud = Pix3D.gouraudTriangle;
        Pix3D.gouraudTriangle = function (
            xA: number, xB: number, xC: number,
            yA: number, yB: number, yC: number,
            cA: number, cB: number, cC: number
        ): void {
            if (gpu.capturing() && gpu.captureTri(MODE_GOURAUD, Pix3D.trans / 256, xA, xB, xC, yA, yB, yC, cA, cB, cC)) {
                return;
            }
            origGouraud.call(this, xA, xB, xC, yA, yB, yC, cA, cB, cC);
        };

        // flat: already-resolved 0xRRGGBB
        const origFlat = Pix3D.flatTriangle;
        Pix3D.flatTriangle = function (
            xA: number, xB: number, xC: number,
            yA: number, yB: number, yC: number,
            c: number
        ): void {
            if (gpu.capturing() && gpu.captureTri(MODE_FLAT, Pix3D.trans / 256, xA, xB, xC, yA, yB, yC, c, c, c)) {
                return;
            }
            origFlat.call(this, xA, xB, xC, yA, yB, yC, c);
        };

        // P5: textured faces capture their affine plane + texel array layer
        // (v1's parity-tested route) — real RGSS-style texel sampling on GPU.
        // Out-of-range or not-yet-unpacked textures draw NOTHING in software
        // (getTexels null / tex<0), so consume them while capturing (v1 rule).
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
            if (tex < 0 || tex >= 50 || !Pix3D.textures[tex]) {
                if (gpu.capturing()) {
                    return;
                }
            } else if (gpu.capturing() && gpu.captureTexTri(
                xA, xB, xC, yA, yB, yC, sA, sB, sC, oX, oY, oZ, bX, cX, bY, cY, bZ, cZ, tex)) {
                return;
            }
            origTex.call(this, xA, xB, xC, yA, yB, yC, sA, sB, sC, oX, oY, oZ, bX, cX, bY, cY, bZ, cZ, tex);
        };

        // animated water: Client.textureRunAnims swaps textures[].data then
        // pushTexture()s the pool -> mark the GPU layer dirty too
        const origPush = Pix3D.pushTexture;
        Pix3D.pushTexture = function (id: number): void {
            origPush.call(this, id);
            if (id >= 0 && id < TEX_COUNT) {
                gpu.texDirty[id] = 1;
            }
        };

        // gamma/brightness rebuild: colourTable + every texPal + averages stale
        const origICT = Pix3D.initColourTable;
        Pix3D.initColourTable = function (brightness: number): void {
            origICT.call(this, brightness);
            gpu.colourDirty = true;
            gpu.texDirty.fill(1);
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
