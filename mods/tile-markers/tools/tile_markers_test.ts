// lclite:tile-markers functional test — runs the REAL payload
// (files/webclient/src/dash3d/TileMarkers.ts, the same file `apply` copies into the tree)
// headlessly:
//
//   bun run mods/tile-markers/tools/tile_markers_test.ts        (from anywhere)
//
// Set LCLITE_ROOT=<install> to test the copy inside an applied tree; it prints which file
// it loaded either way.
//
// What this covers, and why each part is worth a check:
//  1. the settings parse — a stale or hand-typed localStorage value must never paint
//     garbage (bad colour -> default, junk width -> 1, junk opacity -> 0, out of range ->
//     clamped), and the master key must be ON unless it says 'false'.
//  2. key isolation — this mod reads its OWN keys and nothing else (hard rule 5). The
//     harness records every key asked for and compares the exact set.
//  3. the marker store — the flat x/z/level triple format, and that anything malformed is
//     DROPPED rather than repaired: a truncated or hand-edited store must never paint a
//     marker at a garbage tile.
//  4. find/toggle semantics — a mark is per (x, z, plane), a toggle round-trips, and a full
//     store refuses rather than evicting somebody's markers.
//  5. the culls — RuneLite's 32-tile Chebyshev draw distance and the scene bounds.
//  6. the decal geometry — triangle budget, the wash's `trans` values, and the ring itself,
//     checked by rasterizing the emitted triangles with an independent point-in-triangle
//     test: the border pixels must be covered OPAQUELY, the interior by the wash only, and
//     the outside by nothing. Degenerate and thinner-than-the-border quads are the two
//     cases where the geometry must change shape rather than emit nonsense.
//  7. the Shift state — the modifier this mod tracks itself (it must not read shift-drop's
//     field, which does not exist when that mod is not installed).
import path from 'node:path';

const LCLITE = path.resolve(import.meta.dir, '../../..');
const PAYLOAD = path.join(LCLITE, 'mods/tile-markers/files/webclient/src/dash3d/TileMarkers.ts');
const CORE = process.env.LCLITE_ROOT
    ? path.join(process.env.LCLITE_ROOT, 'webclient/src/dash3d/TileMarkers.ts')
    : PAYLOAD;

console.log('\ntile-markers test — core: ' + CORE);
const T: any = await import(new URL('file://' + CORE.replace(/\\/g, '/')).href);

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra?: any) {
    if (cond) { pass++; console.log('  ✓ ' + msg); }
    else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}
function eq(got: any, want: any, msg: string) { ok(JSON.stringify(got) === JSON.stringify(want), msg, { got, want }); }

const store = (kv: Record<string, string>) => (key: string) => (key in kv ? kv[key] : null);

// ---- 1. the settings parse --------------------------------------------------------
console.log('\nsettings');
{
    const s = T.tmSettings(store({}));
    eq(s.on, true, 'the mod is ON with nothing stored (unset is not "off")');
    eq(s.rgb, 0xffff00, 'border defaults to RuneLite\'s markerColor (yellow)');
    eq(s.fillRgb, 0x000000, 'fill defaults to RuneLite\'s own fixed black');
    eq(s.thick, 2, 'border width defaults to RuneLite\'s borderWidth 2');
    eq(s.fillA, 20, 'fill opacity defaults to ~RuneLite\'s 50/255');

    eq(T.tmSettings(store({ tileMarkers: 'false' })).on, false, "'false' is the only value that disables the mod");
    eq(T.tmSettings(store({ tileMarkers: 'true' })).on, true, "'true' keeps it on");
    eq(T.tmSettings(store({ tileMarkers: 'yes' })).on, true, 'junk in the master key reads as ON, not off');

    eq(T.tmSettings(store({ tileMarkersColor: '#00ffff' })).rgb, 0x00ffff, 'a valid #rrggbb colour is honoured');
    eq(T.tmSettings(store({ tileMarkersColor: '#fff' })).rgb, 0xffff00, 'a 3-digit hex falls back to the default');
    eq(T.tmSettings(store({ tileMarkersColor: 'red' })).rgb, 0xffff00, 'a colour NAME falls back to the default');
    eq(T.tmSettings(store({ tileMarkersColor: 'ff0000' })).rgb, 0xffff00, 'a hex with no # falls back');
    eq(T.tmSettings(store({ tileMarkersColor: '#gggggg' })).rgb, 0xffff00, 'non-hex digits fall back');
    eq(T.tmSettings(store({ tileMarkersFillColor: '#123456' })).fillRgb, 0x123456, 'the fill colour is parsed the same way');

    eq(T.tmSettings(store({ tileMarkersOutline: '4' })).thick, 4, 'a valid width is honoured');
    eq(T.tmSettings(store({ tileMarkersOutline: '0' })).thick, 1, 'width 0 clamps to 1 (a 0px border is no border)');
    eq(T.tmSettings(store({ tileMarkersOutline: '-3' })).thick, 1, 'a negative width clamps to 1');
    eq(T.tmSettings(store({ tileMarkersOutline: '99' })).thick, 8, 'an absurd width clamps to 8');
    eq(T.tmSettings(store({ tileMarkersOutline: 'wide' })).thick, 1, 'junk width -> 1');
    eq(T.tmSettings(store({ tileMarkersOutline: '' })).thick, 1, 'an empty width -> 1');

    eq(T.tmSettings(store({ tileMarkersFill: '0' })).fillA, 0, 'opacity 0 is legal (border only)');
    eq(T.tmSettings(store({ tileMarkersFill: '100' })).fillA, 100, 'opacity 100 is legal');
    eq(T.tmSettings(store({ tileMarkersFill: '-10' })).fillA, 0, 'a negative opacity -> 0');
    eq(T.tmSettings(store({ tileMarkersFill: '250' })).fillA, 100, 'an over-100 opacity clamps to 100');
    eq(T.tmSettings(store({ tileMarkersFill: 'half' })).fillA, 0, 'junk opacity -> 0');

    eq(T.tmColour('#abcdef', '#000000'), 0xabcdef, 'tmColour parses a valid hex');
    eq(T.tmColour(null, '#010203'), 0x010203, 'tmColour returns the default for null');
}

// ---- 2. key isolation (hard rule 5) ----------------------------------------------
console.log('\nkey isolation');
{
    const asked: string[] = [];
    const spy = (key: string) => { asked.push(key); return null; };
    T.tmSettings(spy);
    eq(asked.slice().sort(), [
        'tileMarkers', 'tileMarkersColor', 'tileMarkersFill', 'tileMarkersFillColor', 'tileMarkersOutline'
    ].sort(), 'tmSettings reads exactly its own five keys, and never another mod\'s');

    // a second read must not be cached: the panel writes keys while the game runs
    const kv: Record<string, string> = {};
    const read = (key: string) => (key in kv ? kv[key] : null);
    eq(T.tmSettings(read).thick, 2, 'default before the write');
    kv['tileMarkersOutline'] = '7';
    eq(T.tmSettings(read).thick, 7, 'the same read function sees the new value (no caching)');

    ok(T.TM_KEY_MARKS === 'tileMarkersMarks', 'the store key is the one the panel clears');
    ok(T.TM_KEY_ON === 'tileMarkers', 'the master key is the one the panel row writes');
}

// ---- 3. the marker store ---------------------------------------------------------
console.log('\nmarker store');
{
    eq(T.tmParseMarks(null), [], 'no store -> no marks');
    eq(T.tmParseMarks(''), [], 'an empty string -> no marks');
    eq(T.tmParseMarks('[]'), [], 'an empty array -> no marks');
    eq(T.tmParseMarks('[3222,3222,0]'), [3222, 3222, 0], 'a single flat triple parses');
    eq(T.tmParseMarks('[3222,3222,0,3223,3222,0]'), [3222, 3222, 0, 3223, 3222, 0], 'two triples parse in order');
    eq(T.tmParseMarks('not json'), [], 'junk JSON -> no marks (never a throw)');
    eq(T.tmParseMarks('{}'), [], 'an object is not a store');
    eq(T.tmParseMarks('null'), [], 'JSON null is not a store');
    eq(T.tmParseMarks('[1,2]'), [], 'a truncated triple is dropped');
    eq(T.tmParseMarks('[3222,3222,0,1,2]'), [3222, 3222, 0], 'a trailing partial triple is dropped, the rest survives');
    eq(T.tmParseMarks('[{"x":1,"z":2,"l":0}]'), [], 'the old object shape is refused (positional-only contract)');
    eq(T.tmParseMarks('[1.5,2,0]'), [], 'a fractional tile is dropped');
    eq(T.tmParseMarks('["1","2","0"]'), [], 'string coordinates are dropped');
    eq(T.tmParseMarks('[-1,2,0]'), [], 'a negative tile is dropped');
    eq(T.tmParseMarks('[16384,2,0]'), [], 'a tile past the map bound is dropped');
    eq(T.tmParseMarks('[3222,3222,4]'), [], 'a plane outside 0..3 is dropped');
    eq(T.tmParseMarks('[3222,3222,-1]'), [], 'a negative plane is dropped');
    eq(T.tmParseMarks('[3222,3222,0,3222,3222,9]'), [3222, 3222, 0], 'one bad triple does not take the good ones with it');
    eq(T.tmParseMarks('[0,0,0]'), [0, 0, 0], 'tile 0 is a legal tile (it just cannot be drawn - see the scene check)');
    eq(T.tmParseMarks('[16383,16383,3]'), [16383, 16383, 3], 'the far corner of the map is legal');

    // the cap: parse stops at TM_MAX_MARKS, so a hand-written store cannot blow up the loop
    const huge = JSON.stringify(Array.from({ length: (T.TM_MAX_MARKS + 50) * 3 }, (_, i) => (i % 3 === 2 ? 0 : i % 1000)));
    eq(T.tmParseMarks(huge).length, T.TM_MAX_MARKS * 3, 'a store larger than the cap is truncated to the cap');

    eq(T.tmSerialize([1, 2, 3]), '[1,2,3]', 'serialise is a plain JSON array of numbers');
    const round = T.tmParseMarks(T.tmSerialize([3222, 3222, 0, 3223, 3224, 1]));
    eq(round, [3222, 3222, 0, 3223, 3224, 1], 'serialise -> parse round-trips');
}

// ---- 4. find / toggle -------------------------------------------------------------
console.log('\nfind and toggle');
{
    const none: number[] = [];
    eq(T.tmFind(none, 1, 2, 0), -1, 'an empty store finds nothing');
    eq(T.tmFind([1, 2, 0], 1, 2, 0), 0, 'a mark is found at its own index');
    eq(T.tmFind([1, 2, 0], 1, 2, 1), -1, 'the same tile on another PLANE is a different mark');
    eq(T.tmFind([1, 2, 0, 3, 4, 0], 3, 4, 0), 3, 'the second mark is found at index 3');
    eq(T.tmFind([1, 2, 0, 3, 4, 0], 4, 3, 0), -1, 'x and z are not interchangeable');

    eq(T.tmToggle([], 5, 6, 0), [5, 6, 0], 'toggling an unmarked tile marks it');
    eq(T.tmToggle([5, 6, 0], 5, 6, 0), [], 'toggling it again unmarks it');
    eq(T.tmToggle([1, 1, 0], 5, 6, 0), [1, 1, 0, 5, 6, 0], 'a new mark is appended (the store only grows at the end)');
    eq(T.tmToggle([1, 1, 0, 5, 6, 0], 1, 1, 0), [5, 6, 0], 'unmarking the first keeps the rest in order');
    eq(T.tmToggle([1, 1, 0, 5, 6, 0, 7, 7, 0], 5, 6, 0), [1, 1, 0, 7, 7, 0], 'unmarking from the middle keeps the order');
    eq(T.tmToggle([1, 1, 0], 1, 1, 1), [1, 1, 0, 1, 1, 1], 'marking the same tile upstairs adds a second mark');

    const original = [1, 1, 0];
    const added = T.tmToggle(original, 2, 2, 0);
    eq(original, [1, 1, 0], 'toggle does not mutate the array it was handed');
    ok(added !== original, 'toggle returns a new array');

    const full = Array.from({ length: T.TM_MAX_MARKS }, (_, i) => [i, 0, 0]).flat();
    eq(T.tmToggle(full, 9999, 9999, 0), full, 'a full store refuses a new mark instead of evicting one');
    eq(T.tmToggle(full, 0, 0, 0).length, full.length - 3, 'but a full store can still be unmarked');
}

// ---- 5. the culls -----------------------------------------------------------------
console.log('\nculls');
{
    ok(T.TM_MAX_DISTANCE === 32, 'the draw distance is RuneLite\'s MAX_DRAW_DISTANCE (32)');
    ok(T.tmNear(0, 0), 'the player\'s own tile is in range');
    ok(T.tmNear(31, -31), '31 tiles away is in range');
    ok(!T.tmNear(32, 0), 'exactly 32 tiles is NOT in range (their check is `>=`)');
    ok(!T.tmNear(0, -32), 'nor on the other axis');
    ok(T.tmNear(-31.5, 0), 'a fractional in-range distance is in range');

    ok(!T.tmSceneTileOk(0), 'scene tile 0 is refused (getOverlayPos rejects coords below 128)');
    ok(T.tmSceneTileOk(1), 'scene tile 1 is drawable');
    ok(T.tmSceneTileOk(102), 'scene tile 102 is drawable');
    ok(!T.tmSceneTileOk(103), 'scene tile 103 is the far edge of the 104x104 scene: not drawable');
    ok(!T.tmSceneTileOk(-1), 'a negative scene tile is refused');
}

// ---- 6. the decal geometry ---------------------------------------------------------
console.log('\ndecal geometry');

const RGB = 0x00ffff, FILL = 0x000000;

type Tri = { x: number[]; y: number[]; colour: number; trans: number };
function collect(px: number[], py: number[], rgb: number, fillRgb: number, thick: number, fillA: number): Tri[] {
    const out: Tri[] = [];
    T.tmDecal((xA: number, xB: number, xC: number, yA: number, yB: number, yC: number, colour: number, trans: number) => {
        out.push({ x: [xA, xB, xC], y: [yA, yB, yC], colour, trans });
    }, px, py, rgb, fillRgb, thick, fillA);
    return out;
}
// independent point-in-triangle (sign test) — the harness rasterizes the emitted triangles
// itself rather than trusting the payload's own arithmetic
function inTri(t: Tri, x: number, y: number): boolean {
    const d1 = (x - t.x[1]) * (t.y[0] - t.y[1]) - (t.x[0] - t.x[1]) * (y - t.y[1]);
    const d2 = (x - t.x[2]) * (t.y[1] - t.y[2]) - (t.x[1] - t.x[2]) * (y - t.y[2]);
    const d3 = (x - t.x[0]) * (t.y[2] - t.y[0]) - (t.x[2] - t.x[0]) * (y - t.y[0]);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
}
const covered = (tris: Tri[], x: number, y: number, trans?: number) =>
    tris.some(t => (trans === undefined || t.trans === trans) && inTri(t, x, y));

/** Independent geometry oracle for one convex quad: signed edge functions (positive =
 *  inside, via the centroid), the perpendicular distance to the nearest edge, and the
 *  distance to the nearest corner (the mitre reaches further than `thick` near a corner,
 *  so those samples are excluded from the "must NOT be ring" assertion). */
function oracle(px: number[], py: number[]) {
    const cx = (px[0] + px[1] + px[2] + px[3]) / 4;
    const cy = (py[0] + py[1] + py[2] + py[3]) / 4;
    const edges = [0, 1, 2, 3].map(i => {
        const j = (i + 1) & 3;
        const rawX = px[j] - px[i], rawY = py[j] - py[i];
        const len = Math.hypot(rawX, rawY);
        const dir = rawX * (cy - py[i]) - rawY * (cx - px[i]) < 0 ? -1 : 1;
        const ex = rawX * dir, ey = rawY * dir;
        return { ex, ey, len, px: px[i], py: py[i] };
    });
    return (x: number, y: number) => {
        const s = edges.map(e => e.ex * (y - e.py) - e.ey * (x - e.px));
        const inside = s.every(v => v >= -0.5);
        const dist = Math.min(...edges.map(e => Math.abs(e.ex * (y - e.py) - e.ey * (x - e.px)) / e.len));
        const corner = Math.min(...[0, 1, 2, 3].map(i => Math.hypot(x - px[i], y - py[i])));
        return { inside, dist, corner };
    };
}

/** Rasterize the emitted triangles and compare each sample pixel against the oracle. */
function checkQuad(name: string, px: number[], py: number[], thick: number, fillA: number, expectTris: number) {
    const tris = collect(px, py, RGB, FILL, thick, fillA);
    eq(tris.length, expectTris, `${name}: ${expectTris} triangles`);

    const o = oracle(px, py);
    const minX = Math.min(...px), maxX = Math.max(...px), minY = Math.min(...py), maxY = Math.max(...py);
    // The two bands are inset from the border by three quarters of a pixel: the inner
    // corners are rounded to whole pixels, so a sample sitting exactly on the border's inner
    // boundary is genuinely ambiguous and is asserted on neither side. A 1px border is
    // thinner than that margin can sample, so its band assertions are skipped (its
    // coverage is still checked by the interior and leak assertions).
    const ringBand = thick - 0.75;
    const innerBand = thick + 0.75;
    let ringSamples = 0, interiorSamples = 0, outsideSamples = 0;
    let ringMissing = 0, ringTooWide = 0, washMissing = 0, leak = 0;

    for (let x = minX + 0.5; x < maxX; x += 1) {
        for (let y = minY + 0.5; y < maxY; y += 1) {
            const { inside, dist, corner } = o(x, y);
            const ring = covered(tris, x, y, 0);
            const wash = covered(tris, x, y, 256 - Math.round((fillA * 256) / 100));

            if (!inside) {
                // outside the quad nothing may be painted at all (the oracle's own ±0.5px
                // tolerance means only samples a clear pixel away count)
                if (dist > 1 && (ring || wash)) leak++;
                continue;
            }

            outsideSamples++;
            if (dist <= ringBand) {
                // a clear pixel inside the border band: must be painted, opaquely
                ringSamples++;
                if (!ring) ringMissing++;
            } else if (dist >= innerBand && corner > 3 * thick) {
                // clear of the border AND of the mitre: must NOT be ring
                interiorSamples++;
                if (ring) ringTooWide++;
                if (fillA > 0 && !wash) washMissing++;
            }
        }
    }

    ok(ringSamples > 20 || ringBand < 0.5, `${name}: the sample grid exercised the border (${ringSamples} pixels)`);
    ok(interiorSamples > 20, `${name}: and the interior (${interiorSamples} pixels)`);
    eq(ringMissing, 0, `${name}: every border pixel is painted opaquely (${ringSamples} checked)`);
    eq(ringTooWide, 0, `${name}: no interior pixel is painted by the ring (${interiorSamples} checked)`);
    if (fillA > 0) {
        eq(washMissing, 0, `${name}: every interior pixel carries the wash`);
    }
    eq(leak, 0, `${name}: nothing is painted outside the quad (${outsideSamples} samples)`);
}

{
    // RuneLite's own defaults: 2px border, ~20% black fill. Four shapes: axis-aligned,
    // rotated 45 degrees, a vertical shear, and the reverse vertex order (winding must not
    // matter, since a camera-rotated tile arrives in either).
    checkQuad('axis-aligned', [100, 140, 140, 100], [100, 100, 140, 140], 2, 20, 10);
    checkQuad('rotated', [120, 145, 120, 95], [95, 120, 145, 120], 2, 20, 10);
    checkQuad('sheared', [100, 140, 140, 100], [100, 110, 150, 140], 2, 20, 10);
    checkQuad('reversed order', [100, 100, 140, 140], [140, 100, 100, 140], 2, 20, 10);
    checkQuad('8px border', [100, 160, 160, 100], [100, 100, 160, 160], 8, 0, 8);
    checkQuad('1px border', [100, 140, 140, 100], [100, 100, 140, 140], 1, 0, 8);

    // the wash's own numbers, and the ring's colours
    const quad = collect([100, 140, 140, 100], [100, 100, 140, 140], RGB, FILL, 2, 20);
    eq(quad.filter(t => t.trans === 205).length, 2, 'the wash is 2 triangles at trans 205 (20% -> 256 - round(51.2))');
    eq(quad.filter(t => t.trans === 0).length, 8, 'the ring is 8 opaque triangles');
    ok(quad.filter(t => t.trans === 205).every(t => t.colour === FILL), 'the wash uses the FILL colour');
    ok(quad.filter(t => t.trans === 0).every(t => t.colour === RGB), 'the ring uses the border colour');

    eq(collect([100, 140, 140, 100], [100, 100, 140, 140], RGB, FILL, 2, 0).length, 8, 'opacity 0 emits the ring only (no wash triangles at all)');
    eq(collect([100, 140, 140, 100], [100, 100, 140, 140], RGB, FILL, 2, 100).filter(t => t.trans === 0).length, 10, 'opacity 100 -> trans 0 everywhere (a solid tile)');
    ok(!covered(collect([100, 140, 140, 100], [100, 100, 140, 140], RGB, FILL, 2, 0), 120, 120), 'with opacity 0 the interior is empty');

    // A tile NARROWER on screen than the border is thick has no valid inner quad. At 3px
    // wide the ring's two sides overlap and still cover the whole strip (which is what the
    // player must see); at 1px the mitre test fails outright and the geometry falls back to
    // painting the whole quad as border.
    const thin3 = collect([100, 103, 103, 100], [100, 100, 140, 140], RGB, FILL, 2, 0);
    ok([100.5, 101.5, 102.5].every(x => covered(thin3, x, 120, 0)), 'a 3px-wide tile is painted edge to edge, opaquely');
    const thin1 = collect([100, 101, 101, 100], [100, 100, 140, 140], RGB, FILL, 2, 0);
    eq(thin1.length, 2, 'a 1px-wide tile falls back to 2 triangles (the ring would be inside out)');
    ok(thin1.every(t => t.trans === 0 && t.colour === RGB), 'the fallback paints the whole quad as border');
    ok(covered(thin1, 100.5, 120, 0), 'and it does cover the strip');

    // degenerate quads emit nothing rather than nonsense
    eq(collect([100, 140, 140, 100], [100, 100, 100, 100], RGB, FILL, 2, 20).length, 0, 'a zero-height quad emits nothing');
    eq(collect([100, 100, 100, 100], [100, 100, 100, 100], RGB, FILL, 2, 20).length, 0, 'a collapsed quad emits nothing');
    eq(collect([100, 120, 140, 160], [100, 120, 140, 160], RGB, FILL, 2, 20).length, 0, 'a collinear quad emits nothing');
}

// ---- 7. the Shift state -----------------------------------------------------------
console.log('\nshift state');
{
    eq(T.tmShiftHeld(), false, 'Shift starts up');
    T.tmShiftSet(true);
    eq(T.tmShiftHeld(), true, 'Shift can be set (the DOM listeners cannot run headlessly, so this is the seam)');
    T.tmShiftSet(false);
    eq(T.tmShiftHeld(), false, 'and cleared');
    ok(typeof T.tmTrackShift === 'function', 'tmTrackShift exists for the engine hook to call every frame');
    T.tmTrackShift();
    ok(true, 'tmTrackShift is safe to call with no DOM (it must not throw under bun)');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
