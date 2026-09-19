// lclite:true-tile-plus preview — rasterizes the REAL payload (the same file `apply` copies
// into the tree) into an ASCII view and a PNG filmstrip, so the look can be judged without a
// running game and without a login:
//
//   bun run mods/true-tile-plus/tools/true_tile_plus_preview.ts
//
// It draws one synthetic tile (a 512x512 buffer = 4px per world unit, the same relationship
// the engine's projection produces at default zoom) on a deliberately contrasting backdrop,
// marks the tile border (where true-tile's square sits), and renders the four edges' flames
// at four phases side by side. The tile is drawn CENTRED with its four neighbours implied, so
// an edge with no flames is obvious.
//
// Two outputs, and the assertions are the point (a still cannot prove a claim):
//   - an ASCII view per phase, one char per 8x8 px block;
//   - `true_tile_plus_preview.png` (a 4-phase filmstrip) in this tool's folder;
//   - a per-edge painted-pixel count per phase, asserted > 0 for ALL FOUR edges — this is
//     the regression guard for the bug this mod shipped with (blades reaching over a
//     neighbour tile that the scene walk painted later, so only 2-3 edges ever showed).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const LCLITE = path.resolve(import.meta.dir, '../../..');
const PAYLOAD = path.join(LCLITE, 'mods/true-tile-plus/files/webclient/src/dash3d/TrueTilePlus.ts');
const CORE = process.env.LCLITE_ROOT
    ? path.join(process.env.LCLITE_ROOT, 'webclient/src/dash3d/TrueTilePlus.ts')
    : PAYLOAD;
const T: any = await import(new URL('file://' + CORE.replace(/\\/g, '/')).href);

// ---- the synthetic scene ----------------------------------------------------
const ZOOM = 3;                    // rendered 3x: at 1x the blades are too small to judge by eye
const PANEL = 320 * ZOOM;          // one phase's panel, px
const TILE = 128 * ZOOM;           // the tile's side on screen (a tile at default zoom)
const ORIGIN = (PANEL - TILE) / 2; // tile top-left inside the panel
const X0 = ORIGIN, Z0 = ORIGIN, X1 = ORIGIN + TILE, Z1 = ORIGIN + TILE;
const CENTRE = PANEL / 2;
const PX_PER_UNIT = TILE / T.TRUE_TILE_PLUS_TILE_UNITS;   // 1 px per world unit here
const OUT = T.TRUE_TILE_PLUS_OUTER_UNITS * PX_PER_UNIT;

// corners in the payload's own order: 0 = (x0,z0), 1 = (x1,z0), 2 = (x1,z1), 3 = (x0,z1)
const QUAD = {
    px: [X0, X1, X1, X0],
    py: [Z0, Z0, Z1, Z1],
    ox: [CENTRE, X1 + OUT, CENTRE, X0 - OUT],
    oy: [Z0 - OUT, CENTRE, Z1 + OUT, CENTRE]
};

// which panel column each edge's blades occupy (edge 0 = -z/top, 1 = +x/right, 2 = +z/bottom, 3 = -x/left)
const EDGE_OF_PIXEL = (x: number, y: number) => {
    const out: number[] = [];
    if (y < Z0) out.push(0);
    if (x > X1) out.push(1);
    if (y > Z1) out.push(2);
    if (x < X0) out.push(3);
    return out;
};

// ---- a tiny rasterizer (winding-agnostic, integer, like the engine's) -------
type Buf = { w: number; h: number; px: Uint8Array };
function makeBuf(w: number, h: number, rgb: [number, number, number]): Buf {
    const px = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
        px[i * 3] = rgb[0]; px[i * 3 + 1] = rgb[1]; px[i * 3 + 2] = rgb[2];
    }
    return { w, h, px };
}
function put(buf: Buf, x: number, y: number, rgb: [number, number, number]) {
    if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) return;
    const i = (y * buf.w + x) * 3;
    buf.px[i] = rgb[0]; buf.px[i + 1] = rgb[1]; buf.px[i + 2] = rgb[2];
}
function tri(buf: Buf, xA: number, yA: number, xB: number, yB: number, xC: number, yC: number, rgb: [number, number, number]) {
    const minX = Math.max(0, Math.min(xA, xB, xC)), maxX = Math.min(buf.w - 1, Math.max(xA, xB, xC));
    const minY = Math.max(0, Math.min(yA, yB, yC)), maxY = Math.min(buf.h - 1, Math.max(yA, yB, yC));
    const area = (xB - xA) * (yC - yA) - (xC - xA) * (yB - yA);
    if (area === 0) return;
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const s1 = (xB - xA) * (y - yA) - (yB - yA) * (x - xA);
            const s2 = (xC - xB) * (y - yB) - (yC - yB) * (x - xB);
            const s3 = (xA - xC) * (y - yC) - (yA - yC) * (x - xC);
            const all = (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
            if (all) put(buf, x, y, rgb);
        }
    }
}
function frame(buf: Buf, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
    for (let x = x0; x <= x1; x++) { put(buf, x, y0, rgb); put(buf, x, y1, rgb); }
    for (let y = y0; y <= y1; y++) { put(buf, x0, y, rgb); put(buf, x1, y, rgb); }
}

// ---- render one phase -------------------------------------------------------
const BACKDROP: [number, number, number] = [214, 210, 198];   // light path stone
const BORDER: [number, number, number] = [0, 200, 0];         // true-tile's green square
const INK: [number, number, number] = [0, 0, 0];              // the flames

function renderPhase(settings: any, phase: number, showEdges: boolean): { buf: Buf; perEdge: number[] } {
    const buf = makeBuf(PANEL, PANEL, BACKDROP);
    if (showEdges) frame(buf, X0, Z0, X1, Z1, BORDER);

    const before = Uint8Array.from(buf.px);
    T.trueTilePlusEffect((xA: number, xB: number, xC: number, yA: number, yB: number, yC: number, colour: number, trans: number) => {
        const rgb: [number, number, number] = [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff];
        tri(buf, xA, yA, xB, yB, xC, yC, rgb);
    }, QUAD.px, QUAD.py, QUAD.ox, QUAD.oy, settings, phase, T.TRUE_TILE_PLUS_EDGE_ALL);

    // per-edge painted pixels, plus how close the nearest one gets to the tile border (the
    // "flames are attached to the edge, not floating beside it" claim, measured)
    const perEdge = [0, 0, 0, 0];
    let topY = -1, rightX = PANEL, bottomY = PANEL, leftX = -1;
    for (let y = 0; y < PANEL; y++) {
        for (let x = 0; x < PANEL; x++) {
            const i = (y * PANEL + x) * 3;
            if (buf.px[i] === before[i] && buf.px[i + 1] === before[i + 1] && buf.px[i + 2] === before[i + 2]) continue;
            for (const e of EDGE_OF_PIXEL(x, y)) {
                perEdge[e]++;
                if (e === 0) topY = Math.max(topY, y);
                else if (e === 1) rightX = Math.min(rightX, x);
                else if (e === 2) bottomY = Math.min(bottomY, y);
                else leftX = Math.max(leftX, x);
            }
        }
    }
    const gap = [Z0 - topY, rightX - X1, bottomY - Z1, X0 - leftX];
    return { buf, perEdge, gap };
}

// ---- ASCII ------------------------------------------------------------------
function ascii(buf: Buf, step = 8): string {
    const lines: string[] = [];
    for (let y = 0; y < buf.h; y += step) {
        let line = '';
        for (let x = 0; x < buf.w; x += step) {
            const i = (y * buf.w + x) * 3;
            const r = buf.px[i], g = buf.px[i + 1], b = buf.px[i + 2];
            if (r === 0 && g === 0 && b === 0) line += '#';            // flame
            else if (g > 150 && r < 100) line += 'T';                  // tile border
            else if (r === 150 && g === 150) line += '+';              // neighbour outline
            else line += '.';
        }
        lines.push(line);
    }
    return lines.join('\n');
}

// ---- PNG (pure stdlib: zlib + struct) --------------------------------------
function writePng(file: string, w: number, h: number, rgb: Uint8Array) {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0;
        Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
    }
    const chunk = (type: string, data: Buffer) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
        return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    fs.writeFileSync(file, Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]));
}

// ---- run --------------------------------------------------------------------
const store = (kv: Record<string, string>) => (key: string) => (key in kv ? kv[key] : null);
const settings = T.trueTilePlusSettings(store({}));
const PHASES = [0, 0.6, 1.2, 1.8];

console.log('\ntrue-tile-plus preview — core: ' + CORE);
console.log(`default settings: ${JSON.stringify(settings)}`);
console.log(`scene: ${PANEL}px panel, ${TILE}px tile, ${PX_PER_UNIT} px per world unit\n`);

let failures = 0;
const COLS = 2;
const strip = makeBuf(PANEL * COLS, PANEL * Math.ceil(PHASES.length / COLS), BACKDROP);
for (let p = 0; p < PHASES.length; p++) {
    const { buf, perEdge, gap } = renderPhase(settings, PHASES[p], true);
    console.log(`phase ${PHASES[p]}  painted px per edge [top, right, bottom, left]: ${JSON.stringify(perEdge)}`);
    console.log(`          nearest flame pixel to the border per edge: ${JSON.stringify(gap)}  (1 = touching it)`);
    for (let e = 0; e < 4; e++) {
        if (perEdge[e] <= 0) { console.log(`  ✗ edge ${e} has NO flames`); failures++; }
        if (gap[e] > 1) { console.log(`  ✗ edge ${e}'s flames float ${gap[e]}px off the border`); failures++; }
    }
    if (perEdge.every(v => v > 0) && gap.every(v => v <= 1)) console.log('  ✓ all four edges have flames, all rooted on the border');
    const spread = Math.max(...perEdge) / Math.min(...perEdge);
    console.log(`  edge balance: ${spread.toFixed(2)}x between the busiest and quietest edge`);
    if (p === 0) console.log('\n' + ascii(buf));

    const row = Math.floor(p / COLS), col = p % COLS;
    for (let y = 0; y < PANEL; y++) {
        strip.px.set(buf.px.subarray(y * PANEL * 3, (y + 1) * PANEL * 3), ((row * PANEL + y) * strip.w + col * PANEL) * 3);
    }
}

const png = path.join(import.meta.dir, 'true_tile_plus_preview.png');
writePng(png, strip.w, strip.h, strip.px);
console.log('\nfilmstrip written: ' + png + ` (${PHASES.length} phases, ${strip.w}x${strip.h})`);
console.log(failures === 0 ? '\npreview ✔\n' : `\npreview FAILED (${failures})\n`);
if (failures > 0) process.exit(1);
