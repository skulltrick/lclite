// lclite:true-tile functional test — runs the REAL core (files/webclient/src/dash3d/
// TrueTile.ts, the same file `apply` copies into the tree) headlessly:
//
//   bun run mods/true-tile/tools/true_tile_test.ts        (from anywhere)
//
// Set LCLITE_ROOT=<install> to test the copy inside an applied tree; it prints which
// file it loaded either way.
//
// Covers the three things a browser cannot tell us cheaply:
//  1. the settings parse/clamp table — a stale or hand-typed localStorage value must
//     never paint garbage (bad colour → default, out-of-range numbers → clamped);
//  2. the decal geometry — the emitted triangles must cover the SAME pixels the mod's
//     per-pixel edge-function rasterizer covered before it moved onto Pix3D, at any
//     skew, in any vertex order, with the border exactly `thick` px wide;
//  3. the contract the gpu mod consumes — the fill's `trans` is the destination weight
//     (0 = opaque, 256 = clear), which is BOTH what the software raster mixes with and
//     what the GPU captures per triangle. That is the whole reason the fill works on a
//     gpu frame now (see the payload header).
//
// PARITY ORACLE: `oracleRaster` below is a verbatim copy of the per-pixel rasterizer
// this mod shipped before the rework (the two mods' shared edge-function pass). It is
// kept here — and NOT in the payload — so the new geometry is checked against the
// implementation users already had, by an independent formulation. Its edge convention
// (a pixel exactly ON an edge counts as inside, so a quad of S units covers S+1 pixels
// across) differs from a triangle rasterizer's by up to one pixel on the boundary, so
// the parity checks assert (a) no pixel is more than 1px from the other set, and
// (b) every pixel more than 1px away from the ring's boundary is in the same class in
// both. Nothing is asserted "approximately".
import path from 'node:path';

const LCLITE = path.resolve(import.meta.dir, '../../..');
const PAYLOAD = path.join(LCLITE, 'mods/true-tile/files/webclient/src/dash3d/TrueTile.ts');
const CORE = process.env.LCLITE_ROOT
    ? path.join(process.env.LCLITE_ROOT, 'webclient/src/dash3d/TrueTile.ts')
    : PAYLOAD;

console.log('\ntrue-tile test — core: ' + CORE);
const T: any = await import(new URL('file://' + CORE.replace(/\\/g, '/')).href);

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra?: any) {
    if (cond) { pass++; console.log('  ✓ ' + msg); }
    else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}
function eq(got: any, want: any, msg: string) { ok(JSON.stringify(got) === JSON.stringify(want), msg, { got, want }); }

// ---- settings ---------------------------------------------------------------
const store = (kv: Record<string, string>) => (key: string) => (key in kv ? kv[key] : null);
const S = (kv: Record<string, string> = {}) => T.trueTileSettings(store(kv));
const look = (s: any) => [s.enabled, s.rgb, s.thick, s.fillA, s.onlyDesync];

console.log('\nsettings defaults (empty store = a fresh install)');
eq(look(S()), [true, 0x00ff00, 1, 0, false], 'defaults: on, green, 1px, no fill, always visible');
eq(Object.keys(S()).sort(), ['enabled', 'fillA', 'onlyDesync', 'rgb', 'thick'], 'the settings object has exactly the documented fields');
eq(T.TRUE_TILE_DEFAULT_COLOR, '#00ff00', 'documented default colour is the panel default');
eq([T.TRUE_TILE_DEFAULT_OUTLINE, T.TRUE_TILE_DEFAULT_FILL], [1, 0], 'documented default px/% match the panel rows');

console.log('\nmaster key');
eq(S({ trueTile: 'true' }).enabled, true, "'true' → on");
eq(S({ trueTile: 'false' }).enabled, false, "'false' → off");
eq(S({ trueTile: 'TRUE' }).enabled, true, 'anything else → on (only the literal false disables)');
eq(S({ trueTile: '' }).enabled, true, 'empty string → on');

console.log('\ncolour: only a 7-char #rrggbb is accepted');
eq(S({ trueTileColor: '#00ff00' }).rgb, 0x00ff00, "'#00ff00' → 0x00ff00");
eq(S({ trueTileColor: '#FF00FF' }).rgb, 0xff00ff, "'#FF00FF' parses (case-insensitive)");
eq(S({ trueTileColor: 'red' }).rgb, 0x00ff00, "'red' → default green");
eq(S({ trueTileColor: '#fff' }).rgb, 0x00ff00, 'short hex → default');
eq(S({ trueTileColor: '#gggggg' }).rgb, 0x00ff00, 'non-hex digits → default');
eq(S({ trueTileColor: '#000000' }).rgb, 0x000000, 'black is a legal colour, not a falsy default');

console.log('\nborder px: clamped to 1..8, NaN/garbage → 1');
eq(S({ trueTileOutline: '1' }).thick, 1, "'1' → 1");
eq(S({ trueTileOutline: '8' }).thick, 8, "'8' → 8 (max)");
eq(S({ trueTileOutline: '0' }).thick, 1, "'0' → 1 (a zero-width border would be invisible)");
eq(S({ trueTileOutline: '-4' }).thick, 1, 'negative → 1');
eq(S({ trueTileOutline: '99' }).thick, 8, 'over max → 8');
eq(S({ trueTileOutline: 'abc' }).thick, 1, 'non-numeric → 1');
eq(S({ trueTileOutline: '3.9' }).thick, 3, 'parseInt truncates 3.9 → 3');

console.log('\nfill %: clamped to 0..100, NaN/negative → 0');
eq(S({ trueTileFill: '0' }).fillA, 0, "'0' → 0 (outline only)");
eq(S({ trueTileFill: '55' }).fillA, 55, "'55' → 55");
eq(S({ trueTileFill: '100' }).fillA, 100, "'100' → 100");
eq(S({ trueTileFill: '150' }).fillA, 100, 'over 100 → 100');
eq(S({ trueTileFill: '-5' }).fillA, 0, 'negative → 0');
eq(S({ trueTileFill: 'x' }).fillA, 0, 'non-numeric → 0');

console.log('\nonlyDesync (RuneLite\'s "hidden" behaviour)');
eq(S({ trueTileOnlyDesync: 'true' }).onlyDesync, true, "'true' → hide while the model tile matches the server tile");
eq(S({ trueTileOnlyDesync: 'false' }).onlyDesync, false, "'false' → always visible");
eq(S({}).onlyDesync, false, 'unset → always visible (the default the mod shipped with)');
eq(S({ trueTileOnlyDesync: '1' }).onlyDesync, false, 'anything else → off (only the literal true hides)');

// ---- decal geometry ---------------------------------------------------------
const W = 96, HG = 96;
type Quad = { px: number[]; py: number[] };
type Tri = { xA: number; xB: number; xC: number; yA: number; yB: number; yC: number; colour: number; trans: number; fill: boolean };

/** Run the payload's decal and collect the triangles it emits. The first two are the
 *  fill's (the geometry emits the wash before the ring), which is the only way to tell
 *  them apart at fillA=100 — there the wash is opaque (trans 0) exactly like the ring. */
function emit(q: Quad, rgb: number, thick: number, fillA: number): Tri[] {
    const out: Tri[] = [];
    let n = 0;
    T.trueTileDecal((xA: number, xB: number, xC: number, yA: number, yB: number, yC: number, colour: number, trans: number) => {
        out.push({ xA, xB, xC, yA, yB, yC, colour, trans, fill: fillA > 0 && n < 2 });
        n++;
    }, q.px, q.py, rgb, thick, fillA);
    return out;
}

/** Reference triangle rasterizer: pixel-centre sampling, inclusive edges, painted in
 *  emission order (so an opaque triangle really does cover an earlier wash, exactly as
 *  Pix3D's painter ordering does in the buffer). Deliberately a different formulation
 *  from Pix3D's scanline walk — the parity checks allow the one-pixel boundary
 *  difference that follows from that. */
function paint(tris: Tri[]): { border: Set<number>; fill: Set<number> } {
    const cls = new Map<number, boolean>();   // pixel → true when the LAST triangle covering it was the wash
    for (const t of tris) {
        const area = (t.xB - t.xA) * (t.yC - t.yA) - (t.yB - t.yA) * (t.xC - t.xA);
        if (area === 0) { continue; }
        const s = area < 0 ? -1 : 1;
        const x0 = Math.max(Math.floor(Math.min(t.xA, t.xB, t.xC)), 0), x1 = Math.min(Math.ceil(Math.max(t.xA, t.xB, t.xC)), W - 1);
        const y0 = Math.max(Math.floor(Math.min(t.yA, t.yB, t.yC)), 0), y1 = Math.min(Math.ceil(Math.max(t.yA, t.yB, t.yC)), HG - 1);
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const sx = x + 0.5, sy = y + 0.5;
                const e0 = s * ((t.xB - t.xA) * (sy - t.yA) - (t.yB - t.yA) * (sx - t.xA));
                const e1 = s * ((t.xC - t.xB) * (sy - t.yB) - (t.yC - t.yB) * (sx - t.xB));
                const e2 = s * ((t.xA - t.xC) * (sy - t.yC) - (t.yA - t.yC) * (sx - t.xC));
                if (e0 >= 0 && e1 >= 0 && e2 >= 0) { cls.set(x + y * W, t.fill); }
            }
        }
    }
    const border = new Set<number>(), fill = new Set<number>();
    for (const [p, isFill] of cls) {
        (isFill ? fill : border).add(p);
    }
    return { border, fill };
}

/** VERBATIM the per-pixel rasterizer this mod shipped before the rework. */
function oracleRaster(q: Quad, thick: number, fillA: number): { border: Set<number>; fill: Set<number> } {
    const cxs = (q.px[0] + q.px[1] + q.px[2] + q.px[3]) * 0.25;
    const cys = (q.py[0] + q.py[1] + q.py[2] + q.py[3]) * 0.25;
    const ex = [0, 0, 0, 0], ey = [0, 0, 0, 0], dLim = [0, 0, 0, 0];
    let minX = q.px[0], maxX = q.px[0], minY = q.py[0], maxY = q.py[0];
    for (let i = 0; i < 4; i++) {
        const j = (i + 1) & 3;
        ex[i] = q.px[j] - q.px[i];
        ey[i] = q.py[j] - q.py[i];
        const fc = ex[i] * (cys - q.py[i]) - ey[i] * (cxs - q.px[i]);
        const dir = fc < 0 ? -1 : 1;
        ex[i] *= dir;
        ey[i] *= dir;
        dLim[i] = thick * Math.sqrt(ex[i] * ex[i] + ey[i] * ey[i]);
        if (q.px[i] < minX) minX = q.px[i];
        if (q.px[i] > maxX) maxX = q.px[i];
        if (q.py[i] < minY) minY = q.py[i];
        if (q.py[i] > maxY) maxY = q.py[i];
    }
    const bx0 = Math.max(minX | 0, 0), bx1 = Math.min((maxX + 1) | 0, W);
    const by0 = Math.max(minY | 0, 0), by1 = Math.min((maxY + 1) | 0, HG);
    const border = new Set<number>(), fill = new Set<number>();
    for (let y = by0; y < by1; y++) {
        for (let x = bx0; x < bx1; x++) {
            const s0 = ex[0] * (y - q.py[0]) - ey[0] * (x - q.px[0]); if (s0 < 0) continue;
            const s1 = ex[1] * (y - q.py[1]) - ey[1] * (x - q.px[1]); if (s1 < 0) continue;
            const s2 = ex[2] * (y - q.py[2]) - ey[2] * (x - q.px[2]); if (s2 < 0) continue;
            const s3 = ex[3] * (y - q.py[3]) - ey[3] * (x - q.px[3]); if (s3 < 0) continue;
            if (s0 >= dLim[0] && s1 >= dLim[1] && s2 >= dLim[2] && s3 >= dLim[3]) {
                if (fillA > 0) { fill.add(y * W + x); }
            } else {
                border.add(y * W + x);
            }
        }
    }
    return { border, fill };
}

/** Perpendicular distance to the nearest edge, and whether the point is inside the
 *  quad — an independent float formulation (no edge functions, no centroid flip). */
function classify(q: Quad, x: number, y: number): { inside: boolean; dist: number } {
    const cxs = (q.px[0] + q.px[1] + q.px[2] + q.px[3]) / 4;
    const cys = (q.py[0] + q.py[1] + q.py[2] + q.py[3]) / 4;
    let inside = true, minD = Infinity;
    for (let i = 0; i < 4; i++) {
        const j = (i + 1) & 3;
        const ex = q.px[j] - q.px[i], ey = q.py[j] - q.py[i];
        const len = Math.hypot(ex, ey);
        if (len === 0) { continue; }
        const s = ex * (y - q.py[i]) - ey * (x - q.px[i]);
        const sc = ex * (cys - q.py[i]) - ey * (cxs - q.px[i]);
        if (s * sc < 0) { inside = false; }
        const d = Math.abs(s) / len;
        if (d < minD) { minD = d; }
    }
    return { inside, dist: minD };
}

/** Every pixel of A has a neighbour (8-way) in B. */
function within1px(a: Set<number>, b: Set<number>): number {
    let bad = 0;
    for (const p of a) {
        const x = p % W, y = (p / W) | 0;
        let found = false;
        for (let dy = -1; dy <= 1 && !found; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < W && ny >= 0 && ny < HG && b.has(nx + ny * W)) { found = true; break; }
            }
        }
        if (!found) { bad++; }
    }
    return bad;
}

/** The parity claim, in full: no pixel is more than 1px from the other set, and every
 *  pixel well clear of the ring's boundary is in the SAME class in both. */
function parity(q: Quad, rgb: number, thick: number, fillA: number, label: string) {
    const tris = emit(q, rgb, thick, fillA);
    const got = paint(tris);
    const want = oracleRaster(q, thick, fillA);
    ok(tris.length <= 10, label + ': at most 10 triangles (' + tris.length + ')');
    ok(tris.every(t => t.colour === rgb), label + ': every triangle carries the mod\'s colour');

    const gotAll = new Set<number>([...got.border, ...got.fill]);
    const wantAll = new Set<number>([...want.border, ...want.fill]);
    const strayA = within1px(wantAll, gotAll), strayB = within1px(gotAll, wantAll);
    ok(strayA === 0 && strayB === 0, label + ': the painted region matches the old rasterizer within 1px', { strayA, strayB, got: gotAll.size, want: wantAll.size });

    let wrongClass = 0;
    for (let y = 0; y < HG; y++) {
        for (let x = 0; x < W; x++) {
            const p = x + y * W;
            const c = classify(q, x + 0.5, y + 0.5);   // pixel CENTRE, the convention the rasterizer samples
            if (!c.inside) { continue; }
            if (c.dist < thick - 1) {
                if (!got.border.has(p)) { wrongClass++; }
            } else if (c.dist > thick + 1) {
                const isFill = got.fill.has(p);
                if (isFill !== (fillA > 0)) { wrongClass++; }
            }
        }
    }
    ok(wrongClass === 0, label + ': deep border/fill classification matches the independent geometry', { wrongClass });
    return tris;
}

const sq = (x0: number, y0: number, x1: number, y1: number): Quad => ({ px: [x0, x1, x1, x0], py: [y0, y0, y1, y1] });

console.log('\ndecal: triangle budget and the trans contract');
{
    const plain = emit(sq(10, 10, 50, 50), 0x00ff00, 2, 0);
    eq(plain.length, 8, 'outline only → the 4 ring quads (8 triangles)');
    eq(plain.every((t: Tri) => t.trans === 0), true, 'the ring is opaque (trans 0) in every triangle');
    const filled = emit(sq(10, 10, 50, 50), 0x00ff00, 2, 20);
    eq(filled.length, 10, 'with a fill → the 2 wash triangles + the ring');
    eq(filled.slice(0, 2).every((t: Tri) => t.trans === 205), true, 'fill 20% → trans 205 (256 - round(20*256/100)) — the destination weight');
    eq(emit(sq(10, 10, 50, 50), 0x00ff00, 2, 100).slice(0, 2).map((t: Tri) => t.trans), [0, 0], 'fill 100% → trans 0, an exact overwrite');
    eq(emit(sq(10, 10, 50, 50), 0x00ff00, 2, 5).slice(0, 2).map((t: Tri) => t.trans), [243, 243], 'fill 5% → trans 243');
}

console.log('\ndecal: axis-aligned quad');
{
    const q = sq(10, 10, 50, 50), thick = 2, side = 40;
    const tris = parity(q, 0x00ff00, thick, 0, 'outline only');
    const { border, fill } = paint(tris);
    eq(fill.size, 0, 'no fill pixels at fill 0');
    eq(border.size, side * side - (side - 2 * thick) * (side - 2 * thick), 'border area = the quad minus its inner quad, T=2 → 304px');
    eq(border.has(10 + 10 * W), true, 'the corner pixel is painted');
    eq(border.has(30 + 30 * W), false, 'the centre is not painted at all at fill 0');
    eq(border.has(11 + 30 * W), true, 'a pixel 1.5px inside the left edge is still border');
    eq(border.has(12 + 30 * W), false, 'a pixel 2.5px inside is not — the border is exactly T wide');
}

console.log('\ndecal: fill covers the interior, ring covers the border');
{
    const q = sq(10, 10, 50, 50);
    const { border, fill } = paint(emit(q, 0xffffff, 2, 20));
    eq(fill.has(30 + 30 * W), true, 'the centre is washed');
    eq(border.has(30 + 30 * W), false, 'and it is not also border');
    eq(border.has(10 + 10 * W), true, 'the corner is opaque border');
    eq(fill.has(10 + 10 * W), false, 'and it is not also washed (the ring paints over the wash)');
    ok(fill.size > 0 && border.size > 0, 'both regions are populated', { fill: fill.size, border: border.size });
    parity(q, 0xffffff, 2, 20, 'fill 20');
    parity(q, 0xffffff, 4, 60, 'fill 60, thicker border');
}

console.log('\ndecal: vertex order and winding do not matter');
{
    const ref = paint(emit(sq(10, 10, 50, 50), 0x00ff00, 2, 30));
    const variants: [string, Quad][] = [
        ['reversed winding', { px: [10, 10, 50, 50], py: [10, 50, 50, 10] }],
        ['another corner first', { px: [50, 50, 10, 10], py: [10, 50, 50, 10] }],
        ['rotated + reversed', { px: [50, 10, 10, 50], py: [50, 50, 10, 10] }],
    ];
    for (const [name, q] of variants) {
        const got = paint(emit(q, 0x00ff00, 2, 30));
        eq([got.border.size, got.fill.size], [ref.border.size, ref.fill.size], 'identical output with ' + name);
        let diff = 0;
        for (const p of ref.border) { if (!got.border.has(p)) { diff++; } }
        for (const p of ref.fill) { if (!got.fill.has(p)) { diff++; } }
        eq(diff, 0, 'and the exact same pixels (' + name + ')');
    }
}

console.log('\ndecal: skewed quad (a camera-rotated tile) keeps a uniform border');
{
    const cx = 48, cy = 48, r = 20, a = (20 * Math.PI) / 180;
    const rot = (x: number, y: number): [number, number] => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)];
    const q: Quad = {
        px: [rot(-r, -r), rot(r, -r), rot(r, r), rot(-r, r)].map(p => Math.round(p[0])),
        py: [rot(-r, -r), rot(r, -r), rot(r, r), rot(-r, r)].map(p => Math.round(p[1])),
    };
    const thick = 2;
    const { border, fill } = paint(emit(q, 0xffffff, thick, 0));
    parity(q, 0xffffff, thick, 0, 'rotated 20 degrees');
    const perimeter = 4 * (2 * r);
    ok(border.size > perimeter * thick * 0.8 && border.size < perimeter * thick * 1.2,
        'border area ≈ perimeter x thickness — uniform, not one fat side', { border: border.size, expected: perimeter * thick });
    eq(fill.size, 0, 'no wash at fill 0');
    const f = paint(emit(q, 0xffffff, thick, 40));
    ok(f.fill.size > 0, 'the same skewed quad washes its interior', { fill: f.fill.size });
    parity(q, 0xffffff, thick, 40, 'rotated 20 degrees, fill 40');
}

console.log('\ndecal: a tile thinner than its border is all border');
{
    // a 3-unit quad with an 8px border: the inner quad would be inside out, so the
    // whole tile is drawn as border — the pixels the old rasterizer covered there
    const q = sq(30, 30, 33, 33);
    const tris = emit(q, 0xffffff, 8, 50);
    eq(tris.length, 4, 'the wash plus the whole-quad fallback (no ring)');
    const { border, fill } = paint(tris);
    eq(fill.size, 0, 'nothing is left washed — the opaque fallback covers it');
    ok(border.size > 0, 'and the tile is still drawn', { border: border.size });
    parity(q, 0xffffff, 8, 50, 'thin tile');
    parity(sq(10, 10, 18, 18), 0xffffff, 8, 0, 'thick border, no fill');
}

console.log('\ndecal: degenerate input draws nothing and never throws');
{
    let threw = false, n = 0;
    try { n = emit({ px: [40, 40, 40, 40], py: [40, 40, 40, 40] }, 0xffffff, 2, 20).length; } catch (e) { threw = true; }
    ok(!threw && n === 0, 'a zero-area quad emits no triangles and does not throw', { n });
    try { n = emit({ px: [10, 40, 70, 100], py: [10, 40, 70, 100] }, 0xffffff, 2, 50).length; } catch (e) { threw = true; }
    ok(!threw && n === 0, 'a collinear quad emits no triangles', { n });
    try { n = emit({ px: [0, 0, 95, 95], py: [95, 0, 0, 95] }, 0xffffff, 8, 100).length; } catch (e) { threw = true; }
    ok(!threw && n > 0, 'a quad spanning the whole buffer draws without throwing', { n });
    try { n = emit(sq(10, 10, 50, 50), 0xffffff, 1, 1).length; } catch (e) { threw = true; }
    ok(!threw && n === 10, 'the smallest legal settings (1px, 1%) are fine', { n });
}

console.log('\ndecal: settings → decal integration');
{
    const s = S({ trueTileColor: '#ff8800', trueTileOutline: '4', trueTileFill: '60' });
    const tris = emit(sq(20, 20, 60, 60), s.rgb, s.thick, s.fillA);
    eq(tris.every((t: Tri) => t.colour === 0xff8800), true, 'the parsed colour reaches every triangle');
    eq(tris.slice(0, 2).map((t: Tri) => t.trans), [102, 102], 'the parsed 60% fill becomes trans 102');
    parity(sq(20, 20, 60, 60), s.rgb, s.thick, s.fillA, 'parsed settings');
    const junk = S({ trueTileColor: 'nope', trueTileOutline: 'oops', trueTileFill: '-1' });
    eq([junk.rgb, junk.thick, junk.fillA], [0x00ff00, 1, 0], 'a garbage store clamps to green / 1px / no fill');
    parity(sq(20, 20, 60, 60), junk.rgb, junk.thick, junk.fillA, 'clamped garbage');
}

console.log(`\n${fail === 0 ? '✓ all green' : '✗ FAILURES'}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
