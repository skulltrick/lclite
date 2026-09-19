// lclite:true-tile-plus preview — rasterizes the REAL payload (the same file `apply` copies
// into the tree) into an ASCII view and a PNG filmstrip per effect, so the look can be judged
// without a running game and without a login:
//
//   bun run mods/true-tile-plus/tools/true_tile_plus_preview.ts
//
// It draws one synthetic tile (a 512x512 buffer = 4px per world unit, the same relationship
// the engine's projection produces at default zoom) on a deliberately contrasting backdrop,
// marks the tile border (where true-tile's square sits), and renders the effects at four
// phases side by side. The tile is drawn CENTRED with its four neighbours implied, so an edge
// with nothing on it is obvious.
//
// The WAVE is rendered the way the World hook draws it: once with the four borders' bands
// (the orthogonal neighbours' turns) and once per corner for the miters (the diagonal
// neighbours' turns), because that split is what closes the ring.
//
// Three outputs, and the assertions are the point (a still cannot prove a claim):
//   - an ASCII view per effect at the first phase, one char per 8x8 px block;
//   - `true_tile_plus_preview.png` and `true_tile_plus_wave_preview.png` (4-phase filmstrips);
//   - a per-edge painted-pixel count per phase, asserted > 0 for ALL FOUR edges — the
//     regression guard for the bug this mod shipped with (geometry reaching over a neighbour
//     tile that the scene walk painted later, so only 2-3 edges ever showed);
//   - for the wave, that each CORNER's diagonal is painted too — the guard for the other half
//     of that bug: four bands that never meet leave the diagonals empty.
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
const ZOOM = 3;                    // rendered 3x: at 1x the effect is too small to judge by eye
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

// which panel column each edge's geometry occupies (edge 0 = -z/top, 1 = +x/right, 2 = +z/bottom, 3 = -x/left)
const EDGE_OF_PIXEL = (x: number, y: number) => {
    const out: number[] = [];
    if (y < Z0) out.push(0);
    if (x > X1) out.push(1);
    if (y > Z1) out.push(2);
    if (x < X0) out.push(3);
    return out;
};

// ---- a tiny rasterizer (winding-agnostic, integer, like the engine's) -------
// `alpha` is the mix weight, straight off the payload's trans (256 - trans/256), so a
// translucent swell renders as a wash instead of a second hard band.
type Buf = { w: number; h: number; px: Uint8Array };
function makeBuf(w: number, h: number, rgb: [number, number, number]): Buf {
    const px = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
        px[i * 3] = rgb[0]; px[i * 3 + 1] = rgb[1]; px[i * 3 + 2] = rgb[2];
    }
    return { w, h, px };
}
function put(buf: Buf, x: number, y: number, rgb: [number, number, number], alpha: number) {
    if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) return;
    const i = (y * buf.w + x) * 3;
    for (let c = 0; c < 3; c++) {
        buf.px[i + c] = Math.round(buf.px[i + c] * (1 - alpha) + rgb[c] * alpha);
    }
}
function tri(buf: Buf, xA: number, yA: number, xB: number, yB: number, xC: number, yC: number, rgb: [number, number, number], alpha: number) {
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
            if (all) put(buf, x, y, rgb, alpha);
        }
    }
}
function frame(buf: Buf, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
    for (let x = x0; x <= x1; x++) { put(buf, x, y0, rgb, 1); put(buf, x, y1, rgb, 1); }
    for (let y = y0; y <= y1; y++) { put(buf, x0, y, rgb, 1); put(buf, x1, y, rgb, 1); }
}

// ---- render one phase -------------------------------------------------------
const BACKDROP: [number, number, number] = [214, 210, 198];   // light path stone
const BORDER: [number, number, number] = [0, 200, 0];         // true-tile's green square

// every painted pixel, per edge and per corner diagonal (the "nothing is missing" measurements)
function measure(buf: Buf, before: Uint8Array) {
    const perEdge = [0, 0, 0, 0];
    let topY = -1, rightX = buf.w, bottomY = buf.h, leftX = -1;
    for (let y = 0; y < buf.h; y++) {
        for (let x = 0; x < buf.w; x++) {
            const i = (y * buf.w + x) * 3;
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
    return { perEdge, gap };
}

// is anything painted along a corner's own diagonal, out where the ring's corner has to be?
function cornerPainted(buf: Buf, before: Uint8Array, cx: number, cz: number, sx: number, sz: number): number {
    let n = 0;
    for (let d = 2; d < 2 * OUT; d++) {
        for (let o = -2; o <= 2; o++) {
            const x = Math.round(cx + sx * d + o * sz);
            const y = Math.round(cz + sz * d + o * sx);
            if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) continue;
            const i = (y * buf.w + x) * 3;
            if (buf.px[i] !== before[i] || buf.px[i + 1] !== before[i + 1] || buf.px[i + 2] !== before[i + 2]) n++;
        }
    }
    return n;
}

function renderPhase(settings: any, phase: number, showEdges: boolean) {
    const buf = makeBuf(PANEL, PANEL, BACKDROP);
    if (showEdges) frame(buf, X0, Z0, X1, Z1, BORDER);

    const before = Uint8Array.from(buf.px);
    const ink = (colour: number, trans: number) => (xA: number, xB: number, xC: number, yA: number, yB: number, yC: number) => {
        const rgb: [number, number, number] = [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff];
        tri(buf, xA, yA, xB, yB, xC, yC, rgb, 1 - trans / 256);
    };
    T.trueTilePlusEffect((xA: number, xB: number, xC: number, yA: number, yB: number, yC: number, colour: number, trans: number) => {
        ink(colour, trans)(xA, xB, xC, yA, yB, yC);
    }, QUAD.px, QUAD.py, QUAD.ox, QUAD.oy, settings, phase, T.TRUE_TILE_PLUS_EDGE_ALL);
    // the World hook's other half: each diagonal neighbour draws the miters at its corner
    for (let k = 0; k < 4; k++) {
        T.trueTilePlusEffect((xA: number, xB: number, xC: number, yA: number, yB: number, yC: number, colour: number, trans: number) => {
            ink(colour, trans)(xA, xB, xC, yA, yB, yC);
        }, QUAD.px, QUAD.py, QUAD.ox, QUAD.oy, settings, phase, 0, k);
    }

    const { perEdge, gap } = measure(buf, before);
    const pieces = bigPieces(buf, before);
    const corners = [
        cornerPainted(buf, before, X0, Z0, -1, -1),
        cornerPainted(buf, before, X1, Z0, 1, -1),
        cornerPainted(buf, before, X1, Z1, 1, 1),
        cornerPainted(buf, before, X0, Z1, -1, 1)
    ];
    return { buf, perEdge, gap, corners, pieces };
}

// ---- is the ring actually CLOSED? -------------------------------------------
// Flood-fill the painted pixels and count the big connected pieces. A closed ripple paints as
// ONE loop; four bands that never meet at the corners paint as FOUR. With up to 4 ripples alive
// (count's default) and each ripple's crest and swell touching, a healthy frame is 1-4 pieces —
// so anything above 4 means a ripple has been cut apart, which is exactly the corner bug.
function bigPieces(buf: Buf, before: Uint8Array): number {
    const on = new Uint8Array(buf.w * buf.h);
    for (let i = 0; i < buf.w * buf.h; i++) {
        const j = i * 3;
        if (buf.px[j] !== before[j] || buf.px[j + 1] !== before[j + 1] || buf.px[j + 2] !== before[j + 2]) on[i] = 1;
    }
    const seen = new Uint8Array(buf.w * buf.h);
    let big = 0;
    const stack: number[] = [];
    for (let i = 0; i < on.length; i++) {
        if (!on[i] || seen[i]) continue;
        seen[i] = 1;
        stack.length = 0;
        stack.push(i);
        let size = 0;
        while (stack.length) {
            const q = stack.pop() as number;
            size++;
            const x = q % buf.w, y = (q - x) / buf.w;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= buf.w || ny >= buf.h) continue;
                const n = ny * buf.w + nx;
                if (on[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
            }
        }
        if (size > 32) big++;
    }
    return big;
}

// ---- ASCII ------------------------------------------------------------------
function ascii(buf: Buf, step = 8): string {
    const lines: string[] = [];
    for (let y = 0; y < buf.h; y += step) {
        let line = '';
        for (let x = 0; x < buf.w; x += step) {
            const i = (y * buf.w + x) * 3;
            const r = buf.px[i], g = buf.px[i + 1], b = buf.px[i + 2];
            if (g > 150 && r < 100 && b < 100) line += 'T';            // tile border
            else if (r < 40 && g < 40 && b < 40) line += '#';          // the crest
            else if (r < BACKDROP[0] - 8) line += '+';                 // the swell's wash
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
const PHASES = [0, 0.6, 1.2, 1.8];
const COLS = 2;

console.log('\ntrue-tile-plus preview — core: ' + CORE);
console.log(`default settings: ${JSON.stringify(T.trueTilePlusSettings(store({})))}`);
console.log(`scene: ${PANEL}px panel, ${TILE}px tile, ${PX_PER_UNIT} px per world unit\n`);

let failures = 0;
for (const effect of ['flames', 'wave']) {
    const settings = T.trueTilePlusSettings(store({ trueTilePlusEffect: effect }));
    console.log(`--- ${effect.toUpperCase()} ---`);
    const strip = makeBuf(PANEL * COLS, PANEL * Math.ceil(PHASES.length / COLS), BACKDROP);
    for (let p = 0; p < PHASES.length; p++) {
        const { buf, perEdge, gap, corners, pieces } = renderPhase(settings, PHASES[p], true);
        console.log(`phase ${PHASES[p]}  painted px per edge [top, right, bottom, left]: ${JSON.stringify(perEdge)}`);
        console.log(`          nearest pixel to the border per edge: ${JSON.stringify(gap)}  (1 = touching it)`);
        if (effect === 'wave') {
            console.log(`          painted px along each corner's diagonal: ${JSON.stringify(corners)}`);
            console.log(`          connected pieces of paint (1-4 = one loop per live ripple): ${pieces}`);
        }
        for (let e = 0; e < 4; e++) {
            if (perEdge[e] <= 0) { console.log(`  ✗ edge ${e} is empty`); failures++; }
            if (gap[e] > 1) { console.log(`  ✗ edge ${e}'s geometry floats ${gap[e]}px off the border`); failures++; }
        }
        if (effect === 'wave') {
            for (let k = 0; k < 4; k++) {
                if (corners[k] <= 0) { console.log(`  ✗ corner ${k} is EMPTY — the ring is not closed there`); failures++; }
            }
            if (pieces > 4) { console.log(`  ✗ ${pieces} separate pieces of paint — a ripple is cut apart at the corners`); failures++; }
        }
        if (perEdge.every(v => v > 0) && gap.every(v => v <= 1) && (effect !== 'wave' || (corners.every(v => v > 0) && pieces <= 4))) {
            console.log(`  ✓ all four edges painted, rooted on the border${effect === 'wave' ? `, all four corners closed, and the ring is ${pieces} whole loop(s)` : ''}`);
        }
        const spread = Math.max(...perEdge) / Math.min(...perEdge);
        console.log(`  edge balance: ${spread.toFixed(2)}x between the busiest and quietest edge`);
        if (p === 0) console.log('\n' + ascii(buf));

        const row = Math.floor(p / COLS), col = p % COLS;
        for (let y = 0; y < PANEL; y++) {
            strip.px.set(buf.px.subarray(y * PANEL * 3, (y + 1) * PANEL * 3), ((row * PANEL + y) * strip.w + col * PANEL) * 3);
        }
    }

    const png = path.join(import.meta.dir, effect === 'flames' ? 'true_tile_plus_preview.png' : 'true_tile_plus_wave_preview.png');
    writePng(png, strip.w, strip.h, strip.px);
    console.log(`\nfilmstrip written: ${png} (${PHASES.length} phases, ${strip.w}x${strip.h})\n`);
}
console.log(failures === 0 ? 'preview ✔\n' : `preview FAILED (${failures})\n`);
if (failures > 0) process.exit(1);
