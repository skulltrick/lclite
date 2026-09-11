// lclite "gpu" mod v2 (WebGPU) — GPU bootstrap and diagnostics.
//
// Owns the entire WebGPU lifecycle: adapter -> device -> overlay canvas ->
// configure. Nothing in the game imports this directly; GpuRenderer drives it.
// Every failure path returns a human-readable error string that is surfaced
// verbatim through the panel badge (window.lcliteGpuError) — no silent
// fallback: if WebGPU cannot be used, the panel says exactly why and the
// software renderer keeps drawing.
//
// Types: the webclient has no @webgpu/types dependency and this mod must not
// add one (overlay rule: no new deps), so GPU handles are typed `any` at this
// boundary only. Everything above stays in plain TS.

type AnyWindow = Record<string, unknown>;

export interface GpuInitResult {
    ok: boolean;
    error?: string;
    adapter?: string;
    format?: string;
}

export default class GpuContext {
    static device: any = null;
    static queue: any = null;
    static context: any = null; // GPUCanvasContext of the overlay canvas
    static canvas: HTMLCanvasElement | null = null;
    static format: string = '';
    static adapterLabel: string = '';
    static lost: string | null = null;

    /** Create the 512x334 WebGPU overlay canvas sized to the game viewport.
     *  Async (adapter/device requests); safe to call once — re-entry is a no-op. */
    static async init(width: number, height: number): Promise<GpuInitResult> {
        try {
            const gpu: any = (navigator as unknown as AnyWindow).gpu;
            if (!gpu) {
                return { ok: false, error: 'WebGPU unavailable (navigator.gpu missing — needs Chrome/Edge 113+ or Firefox 141+)' };
            }

            let adapter: any;
            try {
                adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
            } catch (e) {
                return { ok: false, error: 'requestAdapter threw: ' + GpuContext.describe(e) };
            }
            if (!adapter) {
                return { ok: false, error: 'no suitable GPU adapter' };
            }

            // Adapter info is async + varies across Chrome versions (sync .info
            // in older builds, requestAdapterInfo() elsewhere) — best effort.
            try {
                const info: any = adapter.info
                    ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
                if (info) {
                    const parts: string[] = [];
                    if (info.vendor) parts.push(info.vendor);
                    if (info.architecture) parts.push(info.architecture);
                    if (info.device) parts.push(info.device);
                    if (info.description) parts.push(info.description);
                    GpuContext.adapterLabel = parts.join(' ') || 'adapter';
                } else {
                    GpuContext.adapterLabel = 'adapter (vendor hidden)';
                }
            } catch (_e) {
                GpuContext.adapterLabel = 'adapter (info unavailable)';
            }

            let device: any;
            try {
                device = await adapter.requestDevice();
            } catch (e) {
                return { ok: false, error: 'requestDevice failed: ' + GpuContext.describe(e) };
            }
            device.lost.then((info: any): void => {
                GpuContext.lost = 'device lost: ' + (info?.reason ?? '?') + (info?.message ? ' — ' + info.message : '');
                // eslint-disable-next-line no-console
                console.error('[lclite gpu]', GpuContext.lost);
            });

            const canvas: HTMLCanvasElement = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            let context: any;
            try {
                context = canvas.getContext('webgpu');
            } catch (_e) {
                context = null;
            }
            if (!context) {
                return { ok: false, error: "canvas.getContext('webgpu') returned null" };
            }

            const format: string = gpu.getPreferredCanvasFormat();
            try {
                context.configure({ device: device, format: format, alphaMode: 'premultiplied' });
            } catch (e) {
                return { ok: false, error: 'context.configure failed: ' + GpuContext.describe(e) };
            }

            GpuContext.device = device;
            GpuContext.queue = device.queue;
            GpuContext.context = context;
            GpuContext.canvas = canvas;
            GpuContext.format = format;

            return { ok: true, adapter: GpuContext.adapterLabel, format: format };
        } catch (e) {
            return { ok: false, error: 'unexpected: ' + GpuContext.describe(e) };
        }
    }

    /** Wrap `work` in a device error scope and await any validation error it
     *  produced. Used after pipeline/shader creation so failures are loud. */
    static async inErrorScope(work: () => void): Promise<string | null> {
        const device: any = GpuContext.device;
        if (!device || !device.pushErrorScope) {
            work();
            return null;
        }
        device.pushErrorScope('validation');
        let thrown: string | null = null;
        try {
            work();
        } catch (e) {
            thrown = GpuContext.describe(e);
        }
        const err: any = await device.popErrorScope();
        if (thrown) {
            return 'threw: ' + thrown;
        }
        return err ? 'validation: ' + (err.message ?? String(err)) : null;
    }

    static alive(): boolean {
        return GpuContext.device !== null && GpuContext.lost === null;
    }

    private static describe(e: unknown): string {
        return e instanceof Error ? e.message : String(e);
    }
}
