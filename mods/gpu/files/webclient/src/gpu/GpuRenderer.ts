// lclite "gpu" mod v2 (WebGPU) — renderer orchestrator / lifecycle.
//
// PHASE 1 ONLY (per docs/gpu-v2-assessment.md): establish a clean, minimal,
// WORKING WebGPU pipeline against the real client. What this file does today:
//
//   1. Side-effect import from Client.ts wires three monkey-patches only:
//      Pix2D.setPixels (find the 512x334 game buffer), Pix2D.cls (per-frame
//      settings refresh + async init kick-off), PixMap.prototype.draw (game
//      buffer composite point). Nothing else in the engine is touched.
//   2. When localStorage 'gpu' === 'true': boot WebGPU (GpuContext), compile
//      a WGSL render pipeline, and at the game-buffer draw point render the
//      P1 proof pass (clear + triangle from GpuShaders) into a transparent
//      overlay canvas, then blit that canvas over the software frame via
//      canvas2d.drawImage — so the checkpoint is VISIBLE in-game while the
//      software renderer underneath stays fully functional.
//   3. Any failure (no navigator.gpu / no adapter / device creation /
//      shader compile / pipeline creation / device lost) disables the GPU
//      path with the reason surfaced verbatim in window.lcliteGpuError —
//      the panel badge shows it. No silent half-broken behavior.
//
// P2+ replaces the proof pass with real scene batches (worldRender/
// renderGround capture -> vertex buffers). Until then this renderer draws
// NO game geometry — that is honest, not fake: the triangle is the P1
// acceptance test the rework plan requires before RS2 models.
//
// The WebGL2 v1 this replaces is archived in lclite git history
// (commit 45eb643, mods/gpu/). Its salvage used here: the module layout,
// the panel/badge contract (lcliteGpuStats/lcliteGpuReady/lcliteGpuError,
// terser-reserved in bundle.ts), the localStorage 'gpu' refresh-at-cls()
// pattern, the error-scope discipline, and the RS2 math dossier (its
// header comments + tools/gpu_parity_test.ts) that P5 will port to WGSL.

import { canvas2d } from '#/graphics/Canvas.js';
import Pix2D from '#/graphics/Pix2D.js';
import PixMap from '#/graphics/PixMap.js';
import GpuContext from '#/gpu/GpuContext.js';
import { TRIANGLE_WGSL } from '#/gpu/GpuShaders.js';

type Win = Record<string, unknown>;
const WIN = window as unknown as Win;

// the game viewport is a 512x334 areaGame buffer drawn at canvas (4,4)
export const GAME_W = 512;
export const GAME_H = 334;

interface GpuStats {
    frames: number;   // total game frames seen while enabled
    tris: number;     // triangles submitted last frame
    batches: number;  // draw calls last frame
    ms: number;       // last composite time (render+blit), smoothed
    glFrames: number; // frames composited by the GPU path
    swFrames: number; // frames left to the software path
}

export class GpuRenderer {
    private static wanted = false;
    private static ready = false;
    private static failed = false;
    private static initializing = false;
    private static initMs = 0;

    private static pipeline: any = null;
    private static gameBuf: Int32Array | null = null;
    private static lastFrame = 0;
    private static lastComposite = 0;

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
        // turning GPU off at runtime: stop compositing, software resumes
        this.wanted = wanted;
        if (!wanted) {
            WIN['lcliteGpuError'] = null;
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
            this.buildPipeline().then((err): void => {
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

    private static async buildPipeline(): Promise<string | null> {
        const device: any = GpuContext.device;

        // -- shader module: surface compilation info, never silently bad --
        let module: any;
        try {
            module = device.createShaderModule({ code: TRIANGLE_WGSL, label: 'lclite-gpu-triangle' });
        } catch (e) {
            return 'createShaderModule threw: ' + (e instanceof Error ? e.message : String(e));
        }
        try {
            if (module.getCompilationInfo) {
                const info: any = await module.getCompilationInfo();
                const errs: string[] = (info.messages ?? []).filter((m: any): boolean => m.type === 'error')
                    .map((m: any): string => m.message + ' @' + m.lineOffset + ':' + m.offset);
                if (errs.length > 0) {
                    return 'WGSL compile: ' + errs.join(' | ');
                }
            }
        } catch (_e) {
            // older/limited impls: pipeline creation below still errors loudly
        }

        // -- pipeline inside a validation error scope --
        let err: string | null = null;
        try {
            err = await GpuContext.inErrorScope((): void => {
                this.pipeline = device.createRenderPipeline({
                    label: 'lclite-gpu-p1',
                    layout: 'auto',
                    vertex: { module: module, entryPoint: 'vs' },
                    fragment: { module: module, entryPoint: 'fs', targets: [{ format: GpuContext.format }] },
                    primitive: { topology: 'triangle-list' },
                    // P1: no depth; scene shaders add it in P6 (see plan)
                });
            });
        } catch (e) {
            err = 'createRenderPipeline threw: ' + (e instanceof Error ? e.message : String(e));
        }
        return err;
    }

    private static disable(reason: string): void {
        this.failed = true;
        this.ready = false;
        WIN['lcliteGpuReady'] = false;
        WIN['lcliteGpuError'] = reason;
        // eslint-disable-next-line no-console
        console.error('[lclite gpu] disabled:', reason, '— software renderer stays active');
    }

    public static isReady(): boolean {
        return this.ready && !this.failed;
    }

    // ---- frame ----------------------------------------------------------------

    /** Called from the patched PixMap.draw for the game buffer. Returns true
     *  when the GPU overlay has been composited (caller skips putImageData
     *  only if it also wants the software frame hidden — it does NOT: the
     *  software frame is drawn first, the overlay blits on top). */
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
        if (!this.ready || this.pipeline === null || !GpuContext.alive()) {
            this.stats.swFrames++;
            return false;
        }

        const t0 = performance.now();
        try {
            this.renderProofPass();
        } catch (e) {
            this.disable('render threw: ' + (e instanceof Error ? e.message : String(e)));
            return false;
        }
        // blit the overlay (transparent where untouched) over the software frame
        canvas2d.drawImage(GpuContext.canvas!, x, y);

        const dt = performance.now() - t0;
        this.lastComposite = this.lastComposite === 0 ? dt : this.lastComposite * 0.9 + dt * 0.1;
        this.stats.ms = Math.round(this.lastComposite * 100) / 100;
        this.stats.glFrames++;
        return true;
    }

    private static renderProofPass(): void {
        const device: any = GpuContext.device;
        const context: any = GpuContext.context;
        const target: any = context.getCurrentTexture().createView();

        const encoder: any = device.createCommandEncoder({ label: 'lclite-gpu-p1-frame' });
        const pass: any = encoder.beginRenderPass({
            colorAttachments: [{
                view: target,
                // KNOWN-COLOR CLEAR, alpha 0: the checkpoint color is the
                // triangle itself; transparent clear lets the still-working
                // software renderer show through underneath.
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
                loadOp: 'clear' as const,
                storeOp: 'store' as const,
            }],
        });
        pass.setPipeline(this.pipeline);
        pass.draw(3, 1, 0, 0);
        pass.end();
        device.queue.submit([encoder.finish()]);

        this.stats.tris = 1;
        this.stats.batches = 1;
    }

    /** the per-frame game-buffer bind point (PixMap constructor / setPixels path) */
    public static noteGameBuffer(data: Int32Array): void {
        this.gameBuf = data;
    }

    public static getStats(): GpuStats {
        return this.stats;
    }

    /** true when the current Pix2D target IS the game buffer (P1: unused —
     *  scene capture in P2 uses exactly this gate, same as v1) */
    public static capturing(): boolean {
        return this.wanted && this.ready && !this.failed && this.gameBuf !== null && Pix2D.pixels === this.gameBuf;
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
        // 512x334 one is areaGame — the ONLY buffer the GPU path composites.
        const origSetPixels = Pix2D.setPixels;
        Pix2D.setPixels = function (pixels: Int32Array, width: number, height: number): void {
            origSetPixels.call(this, pixels, width, height);
            if (width === GAME_W && height === GAME_H) {
                gpu.noteGameBuffer(pixels);
            }
        };

        // Pix2D.cls: per-frame settings refresh + init kick-off
        const origCls = Pix2D.cls;
        Pix2D.cls = function (): void {
            gpu.refresh();
            origCls.call(this);
        };

        // PixMap.draw: game buffer composite point (software draws first, we
        // blit the overlay on top; v1 REPLACED the putImageData — v2 P1 does
        // not, so the software path stays fully exercised until P2 lands).
        const origDraw = PixMap.prototype.draw;
        PixMap.prototype.draw = function (x: number, y: number): void {
            origDraw.call(this, x, y);
            if (this.data === gpu.gameBuf) {
                gpu.onGameDraw(x, y);
            }
        };
    }
}

GpuRenderer.attach();
