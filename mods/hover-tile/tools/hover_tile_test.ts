// lclite:hover-tile functional test — runs the REAL core (files/webclient/src/client/
// HoverTile.ts, the same file `apply` copies into the tree) headlessly:
//
//   bun run mods/hover-tile/tools/hover_tile_test.ts        (from anywhere)
//
// Set LCLITE_ROOT=<install> to test the copy inside an applied tree; it prints which
// file it loaded either way.
//
// Covers the two things a browser cannot tell us cheaply:
//  1. the settings parse/clamp table — a stale or hand-typed localStorage value must
//     never paint garbage (bad colour → default, out-of-range numbers → clamped);
//  2. the quad rasterizer's geometry — a UNIFORM border at any skew (the reason the
//     edge functions are centroid-normalized), vertex-order/CW-CCW independence, the
//     in-place fill mix, clip-rect respect, and degenerate quads not throwing.
//
// The geometry checks compare against an INDEPENDENT float implementation
// (point-in-quad + perpendicular distance to the nearest edge), not against a copy of
// the rasterizer's integer math. Pixel counts are derived from that, so they encode the
// real convention: a pixel exactly on an edge counts as INSIDE (s >= 0), which means a
// projected quad of S units covers S+1 pixels across (see the payload's note).
import path from 'node:path';

const LCLITE = path.resolve(import.meta.dir, '../../..');
const PAYLOAD = path.join(LCLITE, 'mods/hover-tile/files/webclient/src/client/HoverTile.ts');
const CORE = process.env.LCLITE_ROOT
    ? path.join(process.env.LCLITE_ROOT, 'webclient/src/client/HoverTile.ts')
    : PAYLOAD;

console.log('\nhover-tile test — core: ' + CORE);
const H: any = await import(new URL('file://' + CORE.replace(/\\/g, '/')).href);

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra?: any) {
    if (cond) { pass++; console.log('  ✓ ' + msg); }
    else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}
function eq(got: any, want: any, msg: string) { ok(JSON.stringify(got) === JSON.stringify(want), msg, { got, want }); }

// ---- settings ---------------------------------------------------------------
const store = (kv: Record<string, string>) => (key: string) => (key in kv ? kv[key] : null);
const S = (kv: Record<string, string> = {}) => H.hoverTileSettings(store(kv));
const look = (s: any) => [s.enabled, s.rgb, s.thick, s.fillA];

console.log('\nsettings defaults (empty store = a fresh install)');
eq(look(S()), [true, 0xffffff, 2, 20], 'defaults: on, white, 2px, 20% fill');
eq(Object.keys(S()).sort(), ['enabled', 'fillA', 'rgb', 'thick'], 'the settings object has exactly the documented fields');
eq(H.HOVER_TILE_DEFAULT_COLOR, '#ffffff', 'documented default colour is the panel default');
eq([H.HOVER_TILE_DEFAULT_OUTLINE, H.HOVER_TILE_DEFAULT_FILL], [2, 20], 'documented default px/% match the panel rows');

console.log('\nmaster key');
eq(S({ hoverTile: 'true' }).enabled, true, "'true' → on");
eq(S({ hoverTile: 'false' }).enabled, false, "'false' → off");
eq(S({ hoverTile: 'TRUE' }).enabled, true, 'anything else → on (only the literal false disables)');
eq(S({ hoverTile: '' }).enabled, true, 'empty string → on');

console.log('\ncolour: only a 7-char #rrggbb is accepted');
eq(S({ hoverTileColor: '#00ff00' }).rgb, 0x00ff00, "'#00ff00' → 0x00ff00");
eq(S({ hoverTileColor: '#FFFFFF' }).rgb, 0xffffff, "'#FFFFFF' parses (case-insensitive)");
eq(S({ hoverTileColor: '#0a0B0c' }).rgb, 0x0a0b0c, "'#0a0B0c' mixed case parses");
eq(S({ hoverTileColor: 'red' }).rgb, 0xffffff, "'red' → default");
eq(S({ hoverTileColor: '#fff' }).rgb, 0xffffff, 'short hex → default');
eq(S({ hoverTileColor: '#gggggg' }).rgb, 0xffffff, 'non-hex digits → default');
eq(S({ hoverTileColor: '#1234567' }).rgb, 0xffffff, '8 chars → default');
eq(S({ hoverTileColor: '#12345' }).rgb, 0xffffff, '6 chars → default');
eq(S({ hoverTileColor: '#000000' }).rgb, 0x000000, 'black is a legal colour, not a falsy default');

console.log('\nborder px: clamped to 1..8, NaN/garbage → 1');
eq(S({ hoverTileOutline: '1' }).thick, 1, "'1' → 1");
eq(S({ hoverTileOutline: '8' }).thick, 8, "'8' → 8 (max)");
eq(S({ hoverTileOutline: '0' }).thick, 1, "'0' → 1 (a zero-width border would be invisible)");
eq(S({ hoverTileOutline: '-4' }).thick, 1, 'negative → 1');
eq(S({ hoverTileOutline: '99' }).thick, 8, 'over max → 8');
eq(S({ hoverTileOutline: 'abc' }).thick, 1, 'non-numeric → 1');
eq(S({ hoverTileOutline: '' }).thick, 1, 'empty string → 1');
eq(S({ hoverTileOutline: '3.9' }).thick, 3, 'parseInt truncates 3.9 → 3');

console.log('\nfill %: clamped to 0..100, NaN/negative → 0');
eq(S({ hoverTileFill: '0' }).fillA, 0, "'0' → 0 (outline only)");
eq(S({ hoverTileFill: '55' }).fillA, 55, "'55' → 55");
eq(S({ hoverTileFill: '100' }).fillA, 100, "'100' → 100");
eq(S({ hoverTileFill: '150' }).fillA, 100, 'over 100 → 100');
eq(S({ hoverTileFill: '-5' }).fillA, 0, 'negative → 0');
eq(S({ hoverTileFill: 'x' }).fillA, 0, 'non-numeric → 0');
eq(S({ hoverTileFill: '' }).fillA, 0, 'empty string → 0');

// ---- rasterizer -------------------------------------------------------------
const W = 96, HG = 96, SENT = 0x123456;
const BG = [(SENT >> 16) & 0xff, (SENT >> 8) & 0xff, SENT & 0xff];
type Quad = { px: number[]; py: number[] };

/** Independent float geometry: is (x,y) inside the quad, and how far is it from the
 *  nearest edge (px)? Orientation is decided with the centroid like the rasterizer
 *  does, but the rest is a different formulation (distances, not edge functions). */
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

type Tally = { border: number; badBorder: number; fill: number; interiorUntouched: number; outside: number; clipped: number; total: number };

function run(q: Quad, rgb: number, thick: number, fillA: number, clip = [0, W, 0, HG]): { b: Int32Array; t: Tally } {
    const b = new Int32Array(W * HG);
    b.fill(SENT);
    H.hoverTileRaster(b, W, clip[0], clip[1], clip[2], clip[3], q.px, q.py, rgb, thick, fillA);
    const t: Tally = { border: 0, badBorder: 0, fill: 0, interiorUntouched: 0, outside: 0, clipped: 0, total: 0 };
    for (let y = 0; y < HG; y++) {
        for (let x = 0; x < W; x++) {
            const v = b[x + y * W];
            const painted = v !== SENT;
            if (painted) { t.total++; }
            const inClip = x >= clip[0] && x < clip[1] && y >= clip[2] && y < clip[3];
            const c = classify(q, x, y);
            if (painted && (!inClip || !c.inside)) { t.outside++; continue; }
            if (!inClip) { t.clipped++; continue; }
            if (!c.inside) { continue; }
            if (c.dist < thick) {
                if (v === rgb) { t.border++; } else { t.badBorder++; }
            } else if (painted) {
                t.fill++;
            } else {
                t.interiorUntouched++;
            }
        }
    }
    return { b, t };
}

/** Every pixel's painted/unpainted state must agree with the independent geometry. */
function matchesGeometry(t: Tally, msg: string, tol = 0) {
    ok(t.outside <= tol && t.badBorder <= tol, msg, t);
}

/** Count painted pixels inside a rect (for clip assertions). */
function paintedIn(b: Int32Array, x0: number, x1: number, y0: number, y1: number): number {
    let n = 0;
    for (let y = y0; y < y1; y++) { for (let x = x0; x < x1; x++) { if (b[x + y * W] !== SENT) { n++; } } }
    return n;
}

const sq = (x0: number, y0: number, x1: number, y1: number): Quad => ({ px: [x0, x1, x1, x0], py: [y0, y0, y1, y1] });
/** pixels covered by an axis-aligned quad from a to b (both edges inclusive) */
const span = (a: number, b: number) => b - a + 1;

console.log('\nraster: axis-aligned quad, outline only (exact integer geometry)');
{
    const S0 = 40, T = 2;
    const { t } = run(sq(10, 10, 50, 50), 0xffffff, T, 0);
    matchesGeometry(t, 'every pixel is either the opaque border or untouched — nothing outside the quad');
    eq(t.border, span(10, 50) ** 2 - span(12, 48) ** 2, 'border count = (S+1)² - (S+1-2T)² = 312 for a 40-unit square, T=2');
    eq(t.fill, 0, 'fill 0 paints no interior pixels');
    eq(t.interiorUntouched, span(12, 48) ** 2, 'the interior (37×37) stays exactly as it was');
    eq(t.total, t.border, 'only border pixels were written');
}
{
    const { t } = run(sq(10, 10, 50, 50), 0xffffff, 1, 0);
    eq(t.border, span(10, 50) ** 2 - span(11, 49) ** 2, 'thickness 1 → a single 160-pixel ring');
    matchesGeometry(t, 'a 1px ring is still uniform');
}
{
    const { t } = run(sq(10, 10, 18, 18), 0xffffff, 8, 0);
    ok(t.border > 0 && t.badBorder === 0 && t.fill === 0, 'a quad narrower than its border is all border, no crash', t);
}

console.log('\nraster: fill mix (in-place, Pix2D.hlineTrans semantics)');
{
    const q = sq(10, 10, 50, 50), rgb = 0xffffff;
    const { b, t } = run(q, rgb, 2, 100);
    eq(t.interiorUntouched, 0, 'fill 100 leaves no untouched interior pixel');
    eq(b[30 + 30 * W], rgb, 'fill 100 paints the interior in the exact colour (alpha 256, inv 0)');
    const { b: b50 } = run(q, rgb, 2, 50);
    const v = b50[30 + 30 * W];
    const ch = [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
    const mid = BG.map((c: number) => (c + 255) / 2);
    ok(ch.every((c: number, i: number) => Math.abs(c - mid[i]) <= 1), 'fill 50 lands halfway between the background and the colour', { ch, mid });
    const { b: b0 } = run(q, rgb, 2, 0);
    eq(b0[30 + 30 * W], SENT, 'fill 0 leaves the interior exactly as it was');
    const { b: b5 } = run(q, rgb, 2, 5);
    const v5 = b5[30 + 30 * W];
    ok(v5 !== SENT && v5 !== rgb, 'a 5% fill tints without reaching the border colour', { v5: v5.toString(16) });
    const { b: b20 } = run(q, 0x000000, 2, 20);
    const v20 = b20[30 + 30 * W];
    const d20 = [16, 8, 0].map((sh: number) => (v20 >> sh) & 0xff);
    ok(d20.every((c: number, i: number) => c < BG[i]), 'a dark fill darkens every channel (a wash, not a tint)', { d20, BG });
}

console.log('\nraster: vertex order and orientation do not matter');
{
    const variants: [string, Quad][] = [
        ['reversed winding', { px: [10, 10, 50, 50], py: [10, 50, 50, 10] }],
        ['rotated start (another corner first)', { px: [50, 50, 10, 10], py: [10, 50, 50, 10] }],
        ['rotated start, reversed winding', { px: [50, 10, 10, 50], py: [50, 50, 10, 10] }],
    ];
    const ref = run(sq(10, 10, 50, 50), 0x00ff00, 2, 30).b;
    for (const [name, q] of variants) {
        const { b } = run(q, 0x00ff00, 2, 30);
        let diff = 0;
        for (let i = 0; i < b.length; i++) { if (b[i] !== ref[i]) { diff++; } }
        eq(diff, 0, `identical output with ${name}`);
    }
}

console.log('\nraster: skewed quad (a camera-rotated tile) keeps a uniform border');
{
    // a 40-unit square rotated ~20° about its centre: the case the centroid
    // normalization exists for — on-screen orientation is arbitrary
    const cx = 48, cy = 48, r = 20, a = (20 * Math.PI) / 180;
    const rot = (x: number, y: number): [number, number] => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)];
    const q: Quad = {
        px: [rot(-r, -r), rot(r, -r), rot(r, r), rot(-r, r)].map(p => Math.round(p[0])),
        py: [rot(-r, -r), rot(r, -r), rot(r, r), rot(-r, r)].map(p => Math.round(p[1])),
    };
    const thick = 2;
    const { t } = run(q, 0xffffff, thick, 0);
    matchesGeometry(t, 'every painted pixel is a border pixel and nothing escapes the quad (≤1px rounding tolerance)', 1);
    eq(t.fill, 0, 'with no fill there is no interior wash');
    const perimeter = 4 * (2 * r);
    ok(t.border > perimeter * thick * 0.8 && t.border < perimeter * thick * 1.2,
       'border pixel count ≈ perimeter × thickness — uniform, not one fat side', { border: t.border, expected: perimeter * thick });
    const { t: t2 } = run(q, 0xffffff, thick, 40);
    ok(t2.fill > 0 && t2.badBorder <= 1, 'the same skewed quad fills its interior', t2);
}

console.log('\nraster: clip rect is respected');
{
    // the clip box sits INSIDE the quad: its pixels are interior, so with fill 0 the
    // whole box must stay untouched even though the quad covers it
    const { b, t } = run(sq(10, 10, 50, 50), 0xffffff, 2, 0, [16, 48, 16, 48]);
    eq([t.border, t.fill, t.total], [0, 0, 0], 'a clip box inside the quad paints nothing at fill 0');
    eq(paintedIn(b, 16, 48, 16, 48), 0, 'the whole 32×32 clip box is untouched');
    eq(t.interiorUntouched, 32 * 32, 'all 1024 pixels of the clip box are interior and untouched');
    eq(t.clipped, 96 * 96 - 32 * 32, 'every pixel outside the clip rect is reported as clipped');

    // the clip box cuts the quad in half: only the visible part of the ring is painted
    const { b: b1, t: t1 } = run(sq(10, 10, 50, 50), 0xffffff, 2, 0, [0, 20, 0, 96]);
    matchesGeometry(t1, 'the clipped quad still matches the geometry (no missing or extra pixels)');
    ok(t1.border > 0, 'the visible part of the ring is painted', t1);
    eq(paintedIn(b1, 20, W, 0, HG), 0, 'nothing at all is written at or past clipMaxX (half-open clip, like Pix2D)');

    // a quad running off the low side: clipped, not wrapped
    const { t: t2 } = run({ px: [-20, 40, 40, -20], py: [-20, -20, 40, 40] }, 0xffffff, 2, 0);
    matchesGeometry(t2, 'a quad hanging off the top-left corner paints only its visible part');
    ok(t2.border > 0, 'and that visible part is painted', t2);

    // entirely off-screen: the clipped box is empty
    const { b: b3, t: t3 } = run({ px: [-40, -10, -10, -40], py: [-40, -40, -10, -10] }, 0xffffff, 2, 50);
    eq([t3.border, t3.fill, t3.outside, t3.total], [0, 0, 0, 0], 'a fully off-screen quad paints nothing and does not throw');
    ok(b3.every((v: number) => v === SENT), 'buffer untouched for the off-screen quad');
}

console.log('\nraster: degenerate quads do not throw or smear');
{
    let threw = false, painted = 0;
    try {
        const { b } = run({ px: [40, 40, 40, 40], py: [40, 40, 40, 40] }, 0xffffff, 2, 20);
        for (let i = 0; i < b.length; i++) { if (b[i] !== SENT) { painted++; } }
    } catch (e) { threw = true; }
    ok(!threw, 'a zero-area quad does not throw');
    ok(painted <= 1, 'a zero-area quad paints at most the single pixel under it', { painted });

    let threw2 = false;
    try { run({ px: [10, 40, 70, 100], py: [10, 40, 70, 100] }, 0xffffff, 2, 50); } catch (e) { threw2 = true; }
    ok(!threw2, 'a collinear quad does not throw');

    let threw3 = false;
    try { run({ px: [0, 0, 95, 95], py: [95, 0, 0, 95] }, 0xffffff, 8, 100); } catch (e) { threw3 = true; }
    ok(!threw3, 'a quad spanning the whole buffer does not throw');
}

console.log('\nraster: settings → raster integration');
{
    const s = S({ hoverTileColor: '#ff8800', hoverTileOutline: '4', hoverTileFill: '60' });
    const { t } = run(sq(20, 20, 60, 60), s.rgb, s.thick, s.fillA);
    matchesGeometry(t, 'the parsed settings drive a clean 4px border');
    ok(t.fill > 0, 'the parsed 60% fill paints the interior', t);
    const junk = S({ hoverTileColor: 'nope', hoverTileOutline: 'oops', hoverTileFill: '-1' });
    eq([junk.rgb, junk.thick, junk.fillA], [0xffffff, 1, 0], 'a garbage store clamps to white / 1px / no fill');
    const { t: tj } = run(sq(20, 20, 60, 60), junk.rgb, junk.thick, junk.fillA);
    matchesGeometry(tj, 'and the clamped values still rasterize cleanly');
}

console.log(`\n${fail === 0 ? '✓ all green' : '✗ FAILURES'}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
