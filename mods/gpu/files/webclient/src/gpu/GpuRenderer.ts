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
import { SCENE_WGSL, OVERLAY_WGSL, TRIANGLE_WGSL } from '#/gpu/GpuShaders.js';
import {
    VS, MAX_TRIS, OXY, OSHADE, OMODE, OSEQ, OALPHA,
    MODE_GOURAUD, MODE_FLAT, SEQ_DEPTH_SCALE,
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
    private static colourBind: any = null;
    private static overlayTex: any = null;
    private static overlayBind: any = null;
    private static overlayUniform: any = null;
    private static overlayVbo: any = null;

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
        }
    }

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

        // -- scene module (WGSL compile info surfaced, never silently bad) --
        let sm: any;
        try {
            sm = device.createShaderModule({ code: SCENE_WGSL, label: 'lclite-gpu-scene' });
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
                // NO depthStencil: overlay wins every pixel it paints
                fragment: { module: om, entryPoint: 'fs2', targets: [{ format: GpuContext.format }] },
                primitive: { topology: 'triangle-list', cullMode: 'none' },
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
            this.colourBind = device.createBindGroup({
                layout: this.scenePipeline.getBindGroupLayout(0),
                entries: [{ binding: 0, resource: this.colourTex.createView() }],
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
     *  texture faces pass 0 — the software textureRaster REPLACES (v1 rule). */
    private static captureTri(mode: number, alpha: number,
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

    /** cached per-texture average rgb (0xRRGGBB) via the engine's own
     *  Pix3D.getTextureAverage; re-keyed on colourTable / texture unpack */
    private static readonly avgCache = new Int32Array(50);

    private static avgColour(tex: number): number {
        let c = this.avgCache[tex];
        if (c === 0) {
            c = Pix3D.getTextureAverage(tex) | 0;
            if (c === 0) {
                c = 1; // software does the same (never truly black)
            }
            this.avgCache[tex] = c;
        }
        return c;
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
                pass.setBindGroup(0, this.colourBind);
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
        device.queue.submit([encoder.finish()]);

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

        // Pix2D.cls: per-frame settings refresh (also = new frame boundary)
        const origCls = Pix2D.cls;
        Pix2D.cls = function (): void {
            gpu.refresh();
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

        // P2: textured triangles go to the GPU as flat average-colour faces.
        // They carry seq like everything else, so painter's order stays
        // EXACT (the WIP left them on the CPU and their overlay-pass
        // last-wins punched textured floors through later GPU walls). Real
        // texel sampling is P5. tex<0 / untextured: software would draw
        // nothing — consume identically.
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
            // v1 semantics: out-of-range or not-yet-unpacked textures draw
            // NOTHING in software — consume them while capturing so the GPU
            // frame matches (an average-colour triangle would be wrong here).
            if (tex < 0 || tex >= 50 || !Pix3D.textures[tex]) {
                if (gpu.capturing()) {
                    return;
                }
            } else if (gpu.capturing()
                && gpu.captureTri(MODE_FLAT, 0, xA, xB, xC, yA, yB, yC,  // textures never alpha-mix (v1 rule)
                    gpu.avgColour(tex), gpu.avgColour(tex), gpu.avgColour(tex))) {
                return;
            }
            origTex.call(this, xA, xB, xC, yA, yB, yC, sA, sB, sC, oX, oY, oZ, bX, cX, bY, cY, bZ, cZ, tex);
        };

        // gamma/brightness rebuild: colourTable + texture averages stale
        const origICT = Pix3D.initColourTable;
        Pix3D.initColourTable = function (brightness: number): void {
            origICT.call(this, brightness);
            gpu.colourDirty = true;
            gpu.avgCache.fill(0);
        };

        // world hop / re-login re-unpacks the texture pack: averages stale
        const origUnpack = Pix3D.unpackTextures;
        Pix3D.unpackTextures = function (jag: Parameters<typeof Pix3D.unpackTextures>[0]): void {
            origUnpack.call(this, jag);
            gpu.avgCache.fill(0);
        };
    }
}

GpuRenderer.attach();
