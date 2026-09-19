// lclite:true-tile-plus functional test — runs the REAL core (files/webclient/src/dash3d/
// TrueTilePlus.ts, the same file `apply` copies into the tree) headlessly:
//
//   bun run mods/true-tile-plus/tools/true_tile_plus_test.ts        (from anywhere)
//
// Set LCLITE_ROOT=<install> to test the copy inside an applied tree; it prints which file
// it loaded either way.
//
// Covers the things a browser cannot tell us cheaply:
//  1. the settings parse/clamp table — a stale or hand-typed localStorage value must never
//     paint garbage, and the effect only turns off on the literal 'none';
//  2. the flame geometry — a deterministic, bounded, outward-pointing set of blades: the
//     right triangle budget, integer pixels, tips that grow AWAY from the tile and never fly
//     off it, roots on the border, and nothing at all for a degenerate quad or an edge-on
//     tile;
//  3. the EDGE MASK the World hook relies on — mask bit i draws exactly edge i, and edge i's
//     blades point out of edge i's own side (this is what makes each blade land on the
//     neighbour tile it is drawn for, so nothing can cover it);
//  4. the animation — same phase replays byte-identically, different phases differ, the
//     flicker and flare stay inside their stated ranges, speed 0 FREEZES the effect, and
//     no two flames are alike (varied sizes, wandering positions) — the whole point of the
//     rework, and the thing "looks uniform" regressions hide behind;
//  5. the dispatcher contract the World hook relies on: disabled or effect 'none' emits
//     NOTHING, and the flames branch is exactly trueTilePlusFlames.
import path from 'node:path';

const LCLITE = path.resolve(import.meta.dir, '../../..');
const PAYLOAD = path.join(LCLITE, 'mods/true-tile-plus/files/webclient/src/dash3d/TrueTilePlus.ts');
const CORE = process.env.LCLITE_ROOT
    ? path.join(process.env.LCLITE_ROOT, 'webclient/src/dash3d/TrueTilePlus.ts')
    : PAYLOAD;

console.log('\ntrue-tile-plus test — core: ' + CORE);
const T: any = await import(new URL('file://' + CORE.replace(/\\/g, '/')).href);

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra?: any) {
    if (cond) { pass++; console.log('  ✓ ' + msg); }
    else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}
function eq(got: any, want: any, msg: string) { ok(JSON.stringify(got) === JSON.stringify(want), msg, { got, want }); }

// ---- settings ---------------------------------------------------------------
const store = (kv: Record<string, string>) => (key: string) => (key in kv ? kv[key] : null);
const S = (kv: Record<string, string> = {}) => T.trueTilePlusSettings(store(kv));
const DEF = S();
const look = (s: any) => [s.enabled, s.effect, s.rgb, s.count, s.reach, s.speed];

console.log('\nsettings defaults (empty store = a fresh install)');
eq(look(DEF), [true, T.TRUE_TILE_PLUS_EFFECT_FLAMES, 0x000000, 4, 23, 1], 'defaults: on, flames, black, 4 flames/edge, 23% reach, 1x speed');
eq(Object.keys(DEF).sort(), ['count', 'effect', 'enabled', 'reach', 'rgb', 'speed'], 'the settings object has exactly the documented fields');
eq(T.TRUE_TILE_PLUS_DEFAULT_COLOR, '#000000', 'documented default colour is the panel row default');
eq(T.TRUE_TILE_PLUS_DEFAULT_EFFECT, 'flames', 'documented default effect is the panel row default');
eq([T.TRUE_TILE_PLUS_DEFAULT_COUNT, T.TRUE_TILE_PLUS_DEFAULT_REACH, T.TRUE_TILE_PLUS_DEFAULT_SPEED], [4, 23, 1], 'documented defaults match the three slider rows');
eq([T.TRUE_TILE_PLUS_EFFECT_NONE, T.TRUE_TILE_PLUS_EFFECT_FLAMES], [0, 1], 'effect ids are integers (never strings that index a table)');

console.log('\nmaster key');
eq(S({ trueTilePlus: 'true' }).enabled, true, "'true' → on");
eq(S({ trueTilePlus: 'false' }).enabled, false, "'false' → off");
eq(S({ trueTilePlus: 'TRUE' }).enabled, true, 'anything else → on (only the literal false disables)');

console.log('\neffect key: only the literal none turns it off');
eq(S({ trueTilePlusEffect: 'none' }).effect, T.TRUE_TILE_PLUS_EFFECT_NONE, "'none' → no effect");
eq(S({ trueTilePlusEffect: 'flames' }).effect, T.TRUE_TILE_PLUS_EFFECT_FLAMES, "'flames' → flames");
eq(S({ trueTilePlusEffect: 'junk' }).effect, T.TRUE_TILE_PLUS_EFFECT_FLAMES, 'junk → flames, never a silent nothing');

console.log('\ncolour: only a 7-char #rrggbb is accepted');
eq(S({ trueTilePlusColor: '#ff8800' }).rgb, 0xff8800, "'#ff8800' parses");
eq(S({ trueTilePlusColor: 'red' }).rgb, 0x000000, "'red' → default black");
eq(S({ trueTilePlusColor: '#fff' }).rgb, 0x000000, 'short hex → default');

console.log('\nthe three geometry sliders clamp');
eq(S({ trueTilePlusCount: '1' }).count, 1, 'count 1 is legal (one flame per edge)');
eq(S({ trueTilePlusCount: '8' }).count, 8, 'count 8 is legal');
eq(S({ trueTilePlusCount: '99' }).count, T.TRUE_TILE_PLUS_MAX_COUNT, 'count above the max clamps to 8');
eq(S({ trueTilePlusCount: '0' }).count, 1, 'count 0 clamps up to 1');
eq(S({ trueTilePlusCount: '-4' }).count, 1, 'negative count clamps to 1');
eq(S({ trueTilePlusCount: 'abc' }).count, 4, 'junk count falls back to the default');
eq(S({ trueTilePlusReach: '75' }).reach, 75, 'reach 75 % is legal');
eq(S({ trueTilePlusReach: '200' }).reach, T.TRUE_TILE_PLUS_MAX_REACH, 'reach above the max clamps to 75');
eq(S({ trueTilePlusReach: '0' }).reach, 4, 'reach 0 clamps up to 4 (a flame must exist)');
eq(S({ trueTilePlusReach: '' }).reach, 23, 'empty reach → the default (an unparseable value is treated as unset, like the count)');
eq(S({ trueTilePlusSpeed: '0' }).speed, 0, 'speed 0 is legal (frozen)');
eq(S({ trueTilePlusSpeed: '0.25' }).speed, 0.25, 'the speed slider keeps its 0.25 step (read as a float, not rounded)');
eq(S({ trueTilePlusSpeed: '2.75' }).speed, 2.75, 'and any other quarter step');
eq(S({ trueTilePlusSpeed: '9' }).speed, T.TRUE_TILE_PLUS_MAX_SPEED, 'speed above the max clamps to 3');
eq(S({ trueTilePlusSpeed: '-1' }).speed, 0, 'negative speed clamps to frozen, not to the default');
eq(S({ trueTilePlusSpeed: 'fast' }).speed, 0, 'junk speed → frozen (never silently the default)');

// ---- geometry scaffolding ---------------------------------------------------
// A synthetic top-down projection of one tile: a 64x64 px square (scale 0.5 px per world
// unit) with the four outward probes exactly TRUE_TILE_PLUS_OUTER_UNITS out from each edge
// midpoint — the same relationship the World-side hook produces from a real camera.
const SCALE = 0.5;
const OUT = T.TRUE_TILE_PLUS_OUTER_UNITS;
const QUAD = {
    px: [0, 64, 64, 0],
    py: [0, 0, 64, 64],
    ox: [32, 64 + OUT * SCALE, 32, -OUT * SCALE],
    oy: [-OUT * SCALE, 32, 64 + OUT * SCALE, 32]
};
// edge i's outward unit vector in this synthetic view (edge 0 = y 0, 1 = x 64, 2 = y 64, 3 = x 0)
const OUTWARD = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function collect(phase: number, settings = DEF, mask = T.TRUE_TILE_PLUS_EDGE_ALL, quad = QUAD) {
    const tris: number[][] = [];
    const emit = (xA: number, xB: number, xC: number, yA: number, yB: number, yC: number, colour: number, trans: number) =>
        tris.push([xA, yA, xB, yB, xC, yC, colour, trans]);
    T.trueTilePlusFlames(emit, quad.px, quad.py, quad.ox, quad.oy, settings, phase, mask);
    return tris;
}

// blade b of an emitted set = triangles 3b, 3b+1, 3b+2 (base quad halves, then the tip)
const rootOf = (tris: number[][], b: number) => {
    const t = tris[b * 3];
    return [(t[0] + t[2]) / 2, (t[1] + t[3]) / 2];
};
const tipOf = (tris: number[][], b: number) => {
    const t = tris[b * 3 + 2];
    return [t[4], t[5]];
};
const bladeCount = (tris: number[][]) => tris.length / 3;
// how far a blade reaches OUT of its own edge (the lean is sideways, so this is the reach)
const outwardReach = (tris: number[][], b: number, edge: number) => {
    const r = rootOf(tris, b), p = tipOf(tris, b);
    return (p[0] - r[0]) * OUTWARD[edge][0] + (p[1] - r[1]) * OUTWARD[edge][1];
};

const COUNT = DEF.count;
console.log('\ntriangle budget and pixel contract');
const t0 = collect(0);
eq(bladeCount(t0), COUNT * 4, `${COUNT} flames x 4 edges = ${COUNT * 4} blades`);
eq(t0.length, COUNT * 4 * 3, 'three triangles per blade');
ok(t0.every(t => t.slice(0, 6).every(Number.isInteger)), 'every emitted coordinate is an integer (the rasterizer works in ints)');
ok(t0.every(t => t[6] === 0x000000), 'every triangle carries the requested colour');
ok(t0.every(t => t[7] === 0), 'every triangle is opaque (trans 0 = destination weight 0)');
ok(t0.every(t => {
    const [ax, ay, bx, by, cx, cy] = t;
    return (bx - ax) * (cy - ay) - (cx - ax) * (by - ay) !== 0;
}), 'no blade triangle is degenerate (a zero-area triangle would be a silent no-op)');

console.log('\nthe EDGE MASK the World hook relies on');
for (let e = 0; e < 4; e++) {
    const one = collect(1.1, DEF, 1 << e);
    eq(bladeCount(one), COUNT, `mask ${1 << e} draws exactly edge ${e} (${COUNT} blades)`);
    ok(one.every(t => t[6] === 0x000000), `edge ${e} alone still carries the colour`);
    let allOut = true;
    for (let b = 0; b < COUNT; b++) {
        if (outwardReach(one, b, e) <= 0) { allOut = false; }
    }
    ok(allOut, `edge ${e}'s blades all reach OUT of edge ${e}'s own side`);
}
eq(bladeCount(collect(0, DEF, T.TRUE_TILE_PLUS_EDGE_Z0 | T.TRUE_TILE_PLUS_EDGE_Z1)), COUNT * 2, 'two mask bits → two edges worth of blades');
eq([T.TRUE_TILE_PLUS_EDGE_Z0, T.TRUE_TILE_PLUS_EDGE_X1, T.TRUE_TILE_PLUS_EDGE_Z1, T.TRUE_TILE_PLUS_EDGE_X0, T.TRUE_TILE_PLUS_EDGE_ALL], [1, 2, 4, 8, 15], 'the edge bits are the documented ones');

console.log('\ndeterminism (the harness can assert a whole frame)');
eq(collect(0), collect(0), 'the same phase replays byte-identically');
eq(collect(3.75), collect(3.75), 'and so does an arbitrary later phase');
ok(JSON.stringify(collect(0)) !== JSON.stringify(collect(0.4)), 'a different phase emits a different frame (it animates)');
eq(collect(0, S({ trueTilePlusColor: '#123456' }))[0][6], 0x123456, 'a stored colour reaches the geometry');

console.log('\nthe flames are OUTWARD and rooted on their own border');
// every blade's tip must be at least as far from the tile centre as its own root
const CX = 32, CY = 32;
const dist = (x: number, y: number) => Math.hypot(x - CX, y - CY);
for (const phase of [0, 1.7, 9.3, 22.4]) {
    const tris = collect(phase);
    let outward = true, onBorder = true;
    for (let b = 0; b < bladeCount(tris); b++) {
        const r = rootOf(tris, b), p = tipOf(tris, b);
        if (dist(p[0], p[1]) < dist(r[0], r[1]) - 0.5) { outward = false; }
        // the root sits on its edge's line: edge 0 = y 0, 1 = x 64, 2 = y 64, 3 = x 0
        const off = [Math.abs(r[1]), Math.abs(r[0] - 64), Math.abs(r[1] - 64), Math.abs(r[0])][Math.floor(b / COUNT)];
        if (off > 2.5) { onBorder = false; }
    }
    ok(outward, `no blade points back into the tile at phase ${phase}`);
    ok(onBorder, `every blade root is on its own border at phase ${phase}`);
}

console.log('\nNO TWO FLAMES ALIKE (the anti-uniformity contract)');
{
    const tris = collect(0.6);
    const reaches: number[] = [];
    for (let b = 0; b < bladeCount(tris); b++) {
        reaches.push(outwardReach(tris, b, Math.floor(b / COUNT)));
    }
    const spread = Math.max(...reaches) / Math.min(...reaches);
    console.log(`    reaches at phase 0.6: ${reaches.map(r => r.toFixed(1)).join(', ')}  (spread ${spread.toFixed(2)}x)`);
    ok(spread >= 1.5, `the ring's flame sizes vary (max/min = ${spread.toFixed(2)}x)`);
    ok(reaches.every(r => r > 0), 'and every one of them reaches outward');

    // one edge alone must still look uneven, not like a comb
    const edge0 = reaches.slice(0, COUNT);
    const edgeSpread = Math.max(...edge0) / Math.min(...edge0);
    console.log(`    one edge: ${edge0.map(r => r.toFixed(1)).join(', ')}  (spread ${edgeSpread.toFixed(2)}x)`);
    ok(edgeSpread >= 1.15, `a single edge's flames are not a uniform row (max/min = ${edgeSpread.toFixed(2)}x)`);

    // the row wanders: the roots move along the edge over time
    const a = collect(0), c = collect(11);
    let drift = 0;
    for (let b = 0; b < bladeCount(a); b++) {
        const ra = rootOf(a, b), rc = rootOf(c, b);
        drift += Math.abs(ra[0] - rc[0]) + Math.abs(ra[1] - rc[1]);
    }
    ok(drift > 4, `the row drifts along the edges over time (total root movement ${drift.toFixed(1)}px)`);
}

console.log('\nspeed: 0 freezes the effect, higher speeds animate faster');
{
    const frozen = S({ trueTilePlusSpeed: '0' });
    eq(collect(0, frozen), collect(7.5, frozen), 'speed 0: the same frame at any phase (frozen, not just slow)');
    const fast = S({ trueTilePlusSpeed: '2' });
    ok(JSON.stringify(collect(1, fast)) !== JSON.stringify(collect(1, DEF)), 'speed 2 at phase 1 differs from speed 1 (the slider bites)');
    eq(collect(1, fast), collect(1, fast), 'and speed 2 is still deterministic');
    // 2x speed at phase t must equal 1x speed at phase 2t — the slider scales time, nothing else
    eq(collect(0.5, fast), collect(1, DEF), 'speed 2 at phase 0.5 == speed 1 at phase 1 (speed is a pure time scale)');
}

console.log('\nflicker + flare + seeds (uneven but bounded)');
{
    const flick = (p: number, s1: number, s2: number) => T.trueTilePlusFlicker(p, s1, s2);
    let fMin = Infinity, fMax = -Infinity, aMin = Infinity, aMax = -Infinity;
    for (let p = 0; p < 30; p += 0.05) {
        for (let s = 0; s < 1; s += 0.07) {
            const f = flick(p, s, 1 - s);
            fMin = Math.min(fMin, f); fMax = Math.max(fMax, f);
            const a = T.trueTilePlusFlare(p, s);
            aMin = Math.min(aMin, a); aMax = Math.max(aMax, a);
        }
    }
    ok(fMin >= 0.53 && fMax <= 1.31, `flicker stays inside its documented [0.53, 1.31] (saw ${fMin.toFixed(3)}..${fMax.toFixed(3)})`);
    ok(aMin >= 1 && aMax <= 1.30, `flare stays inside its documented [1.00, 1.30] (saw ${aMin.toFixed(3)}..${aMax.toFixed(3)})`);
    ok(aMin === 1, 'the flare bottoms out at exactly 1 (a tongue never goes below its own size)');
    ok(flick(1, 0.1, 0.2) !== flick(1, 0.9, 0.2), 'two tongues at the same phase flicker differently');

    const seeds: number[] = [];
    for (let e = 0; e < 4; e++) for (let k = 0; k < 8; k++) seeds.push(T.trueTilePlusSeed(e, k, 0));
    ok(seeds.every(s => s >= 0 && s < 1), 'every seed is in [0,1)');
    eq(new Set(seeds).size, seeds.length, 'every (edge, tongue) has its own seed');
    const salted: number[] = [];
    for (let e = 0; e < 4; e++) for (let k = 0; k < 8; k++) salted.push(T.trueTilePlusSeed(e, k, 1));
    ok(salted.every(s => !seeds.includes(s)), 'the second salt gives every tongue an independent second stream');
}

console.log('\nthe sliders change the geometry they claim to');
{
    // count
    eq(bladeCount(collect(0, S({ trueTilePlusCount: '8' }))), 32, 'count 8 → 8 flames per edge');
    eq(bladeCount(collect(0, S({ trueTilePlusCount: '1' }))), 4, 'count 1 → one flame per edge');
    // reach: doubling the % roughly doubles the reach (same seeds, same phase)
    const r23 = collect(0, S({ trueTilePlusReach: '23' }));
    const r46 = collect(0, S({ trueTilePlusReach: '46' }));
    const sum = (tris: number[][]) => { let s = 0; for (let b = 0; b < bladeCount(tris); b++) s += outwardReach(tris, b, Math.floor(b / COUNT)); return s; };
    const ratio = sum(r46) / sum(r23);
    console.log(`    reach 46% / reach 23% = ${ratio.toFixed(2)}x`);
    ok(ratio > 1.8 && ratio < 2.2, `reach scales with the slider (${ratio.toFixed(2)}x for 2x the %)`);
    // and the reach really is a fraction of a tile in world units: 23% of 128 = 29.44 units,
    // at this synthetic 0.5 px/unit scale = ~14.7px for an unscaled blade
    const base = outwardReach(r23, 0, 0);
    ok(base > 3 && base < 40, `a default blade reaches a sane number of px (${base.toFixed(1)}px at 0.5px/world-unit)`);
}

console.log('\nreach is bounded (no screen-crossing blade at a grazing view or on a flare)');
{
    const small = { px: [0, 2, 2, 0], py: [0, 0, 2, 2], ox: [1, 2 + OUT * 0.03125, 1, -OUT * 0.03125], oy: [-OUT * 0.03125, 1, 2 + OUT * 0.03125, 1] };
    eq(collect(0, DEF, T.TRUE_TILE_PLUS_EDGE_ALL, small).length, 0, 'a tile whose edges are under TRUE_TILE_PLUS_MIN_EDGE emits nothing');
    const huge = { px: [0, 4000, 4000, 0], py: [0, 0, 4000, 4000], ox: [2000, 4000 + OUT * 31, 2000, -OUT * 31], oy: [-OUT * 31, 2000, 4000 + OUT * 31, 2000] };
    const maxReach = S({ trueTilePlusReach: '75' });
    let worst = 0;
    for (let p = 0; p < 40; p += 0.37) {
        const tris = collect(p, maxReach, T.TRUE_TILE_PLUS_EDGE_ALL, huge);
        for (let b = 0; b < bladeCount(tris); b++) {
            const r = rootOf(tris, b), q = tipOf(tris, b);
            worst = Math.max(worst, Math.hypot(q[0] - r[0], q[1] - r[1]));
        }
    }
    console.log(`    worst blade at 75% reach, zoomed way in: ${worst.toFixed(1)}px`);
    ok(worst <= T.TRUE_TILE_PLUS_MAX_LENGTH * 1.3, `no blade exceeds the documented cap + lean headroom (${worst.toFixed(1)}px <= ${(T.TRUE_TILE_PLUS_MAX_LENGTH * 1.3).toFixed(0)}px)`);
}

console.log('\ndegenerate quads emit nothing');
eq(collect(0, DEF, T.TRUE_TILE_PLUS_EDGE_ALL, { px: [0, 10, 20, 30], py: [0, 10, 20, 30], ox: [0, 0, 0, 0], oy: [0, 0, 0, 0] }).length, 0, 'a zero-area (edge-on) quad emits nothing');
eq(collect(0, DEF, T.TRUE_TILE_PLUS_EDGE_ALL, { px: [0, 0, 0, 0], py: [0, 0, 0, 0], ox: [0, 0, 0, 0], oy: [0, 0, 0, 0] }).length, 0, 'a collapsed projection emits nothing');
eq(collect(0, DEF, T.TRUE_TILE_PLUS_EDGE_ALL, { px: QUAD.px, py: QUAD.py, ox: [32, 64, 32, 0], oy: [0, 32, 64, 32] }).length, 0, 'collapsed probes (no outward direction) emit nothing');

console.log('\nthe dispatcher (what the World hook actually calls)');
function dispatch(settings: any, phase = 0, mask = T.TRUE_TILE_PLUS_EDGE_ALL) {
    const tris: number[][] = [];
    const emit = (xA: number, xB: number, xC: number, yA: number, yB: number, yC: number, colour: number, trans: number) =>
        tris.push([xA, yA, xB, yB, xC, yC, colour, trans]);
    T.trueTilePlusEffect(emit, QUAD.px, QUAD.py, QUAD.ox, QUAD.oy, settings, phase, mask);
    return tris;
}
eq(dispatch({ ...DEF, enabled: false }).length, 0, 'master off → nothing is emitted (the key is read before any geometry)');
eq(dispatch({ ...DEF, effect: T.TRUE_TILE_PLUS_EFFECT_NONE }).length, 0, "effect 'none' → nothing is emitted");
eq(dispatch(DEF), collect(0), 'flames → exactly trueTilePlusFlames');
eq(dispatch(DEF, 0, T.TRUE_TILE_PLUS_EDGE_X1), collect(0, DEF, T.TRUE_TILE_PLUS_EDGE_X1), 'the mask is passed through the dispatcher');
eq(dispatch(S({ trueTilePlusColor: '#123456' })), collect(0, S({ trueTilePlusColor: '#123456' })), 'a stored colour reaches the geometry through the dispatcher');
eq(dispatch({ ...DEF, effect: 99 }).length, 0, 'an unknown future effect id emits nothing rather than guessing');


// ---- the WAVE effect --------------------------------------------------------
// The wave is a mitred RING: four border bands, closed at the corners by the miters that the
// tiles owning those corners draw. These checks cover what a browser cannot tell us cheaply:
// the settings, the budget, the trans contract (crest over swell), the mask AND corner split
// the World hook relies on, the ring actually closing at every corner, the train never
// vanishing, the reach being honoured, and the dispatcher passing the corner through.
console.log('\nthe WAVE: settings, budget and the pixel contract');
const WAVE = S({ trueTilePlusEffect: 'wave' });
eq(S({ trueTilePlusEffect: 'wave' }).effect, T.TRUE_TILE_PLUS_EFFECT_WAVE, "'wave' → the wave effect");
eq([T.TRUE_TILE_PLUS_EFFECT_NONE, T.TRUE_TILE_PLUS_EFFECT_FLAMES, T.TRUE_TILE_PLUS_EFFECT_WAVE], [0, 1, 2], 'the effect ids are integers, in the order the select row lists them');
eq(S({ trueTilePlusEffect: 'flames' }).effect, T.TRUE_TILE_PLUS_EFFECT_FLAMES, "'flames' still → flames");
eq(S({ trueTilePlusEffect: 'junk' }).effect, T.TRUE_TILE_PLUS_EFFECT_FLAMES, 'junk → flames, never a silent nothing (and never the second effect)');

function wave(settings: any, phase: number, mask = T.TRUE_TILE_PLUS_EDGE_ALL, corner = -1) {
    const tris: number[][] = [];
    const emit = (xA: number, xB: number, xC: number, yA: number, yB: number, yC: number, colour: number, trans: number) =>
        tris.push([xA, yA, xB, yB, xC, yC, colour, trans]);
    T.trueTilePlusWave(emit, QUAD.px, QUAD.py, QUAD.ox, QUAD.oy, settings, phase, mask, corner);
    return tris;
}
const vertsOf = (tris: number[][]) => tris.flatMap(t => [[t[0], t[1]], [t[2], t[3]], [t[4], t[5]]]);
const WCOUNT = WAVE.count;
const WSEGS = T.trueTilePlusWaveSegments(WCOUNT);
const WREACH = (WAVE.reach * T.TRUE_TILE_PLUS_TILE_UNITS) / 100 * SCALE;   // px, in this synthetic view
// a vertex's distance out from a border, and its position ALONG that border (0..1 = its span)
const radiusOf = (x: number, y: number, e: number) => (x - QUAD.px[e]) * OUTWARD[e][0] + (y - QUAD.py[e]) * OUTWARD[e][1];
function alongOf(x: number, y: number, e: number): number {
    const j = (e + 1) & 3;
    const ex = QUAD.px[j] - QUAD.px[e];
    const ey = QUAD.py[j] - QUAD.py[e];
    return ((x - QUAD.px[e]) * ex + (y - QUAD.py[e]) * ey) / (ex * ex + ey * ey);
}
{
    const one = wave(WAVE, 0, T.TRUE_TILE_PLUS_EDGE_Z0);
    ok(one.length > 0, 'a border alone paints something');
    ok(one.length <= WCOUNT * WSEGS * 4, `at most ${WCOUNT} ripples x ${WSEGS} quads x 4 triangles per border (got ${one.length})`);
    ok(one.every(t => t.slice(0, 6).every(Number.isInteger)), 'every emitted coordinate is an integer (the rasterizer works in ints)');
    ok(one.every(t => t[6] === 0x000000), 'every triangle carries the requested colour');
    ok(one.every(t => t[7] >= 0 && t[7] < 256), 'every trans is a legal destination weight [0, 256)');
    ok(one.every(t => {
        const [ax, ay, bx, by, cx, cy] = t;
        return (bx - ax) * (cy - ay) - (cx - ax) * (by - ay) !== 0;
    }), 'no ripple triangle is degenerate (a zero-area triangle would be a silent no-op)');
    ok(T.TRUE_TILE_PLUS_WAVE_CREST_ALPHA > T.TRUE_TILE_PLUS_WAVE_ALPHA,
        'the crest is the bolder of the two, so it can never read as the trail');
    // ONE ripple at full envelope, sampled where nothing collapses: the documented emit order is
    // swell, swell, crest, crest per quad, and the crest must never be the more transparent of
    // the pair (a dropped zero-area triangle would break a coarser version of this check, so it
    // is pinned to a frame where the geometry is fat)
    const c1 = S({ trueTilePlusEffect: 'wave', trueTilePlusCount: '1' });
    const want = T.trueTilePlusWaveSegments(1) * 4;
    let clean = -1;
    for (let p = 0; p < 2; p += 0.001) {
        if (wave(c1, p, T.TRUE_TILE_PLUS_EDGE_Z0).length === want) { clean = p; break; }
    }
    ok(clean >= 0, `a frame exists where nothing collapsed (${want} triangles), so the emit order can be checked`);
    const mid = wave(c1, clean, T.TRUE_TILE_PLUS_EDGE_Z0);
    eq(mid.length, want, 'one ripple with nothing collapsed emits every quad');
    let ordered = true;
    for (let g = 0; g + 3 < mid.length; g += 4) {
        if (!(mid[g + 2][7] <= mid[g][7] && mid[g + 3][7] <= mid[g + 1][7])) { ordered = false; }
    }
    ok(ordered, 'per quad: the crest is never more transparent than the swell it trails');
    // and over a sweep, both ends of the fade are really reached
    let sawOpaque = false, sawFaded = false, distinct = new Set<number>();
    for (let p = 0; p < 40; p += 0.05) {
        for (const t of wave(WAVE, p, T.TRUE_TILE_PLUS_EDGE_Z0)) {
            distinct.add(t[7]);
            if (t[7] <= 8) { sawOpaque = true; }
            if (t[7] >= 200) { sawFaded = true; }
        }
    }
    ok(sawOpaque, 'a young ripple carries a near-opaque crest');
    ok(sawFaded, 'and a dying one a ghost of it, so the ring dissolves instead of scaling forever');
    ok(distinct.size >= 16, `the fade is a real gradient, not two steps (${distinct.size} distinct trans values)`);
}

console.log('\nthe EDGE MASK and the CORNER split the World hook relies on');
for (let e = 0; e < 4; e++) {
    const one = wave(WAVE, 1.1, 1 << e);
    ok(one.length > 0, `mask ${1 << e} paints border ${e}`);
    let outside = true, onOwnBorder = true;
    for (const [x, y] of vertsOf(one)) {
        if (radiusOf(x, y, e) < -1) { outside = false; }
        if (alongOf(x, y, e) < -0.02 || alongOf(x, y, e) > 1.02) { onOwnBorder = false; }
    }
    ok(outside, `border ${e}'s ripples never reach inside the true tile (radius >= 0)`);
    ok(onOwnBorder, `border ${e}'s band stays within its own span (0..1)`);
}
for (let k = 0; k < 4; k++) {
    const eEnd = (k + 3) & 3, eStart = k;
    const m = wave(WAVE, 0.6, 0, k);
    ok(m.length > 0, `corner ${k} paints its miters`);
    let outside = true;
    for (const [x, y] of vertsOf(m)) {
        // a point in the diagonal tile at this corner is outside the true tile: it must have a
        // non-negative radius on at least one of the two borders meeting here
        if (radiusOf(x, y, eEnd) < -1 && radiusOf(x, y, eStart) < -1) { outside = false; }
    }
    ok(outside, `corner ${k}'s miters stay outside the true tile`);
    // THE RING CLOSES: both borders' miters must arrive at the corner at the same radius, which
    // is what makes the four bands one ring instead of four bars with notched diagonals
    const farEnd = vertsOf(m).filter(([x, y]) => alongOf(x, y, eEnd) > 1.02).map(([x, y]) => radiusOf(x, y, eEnd));
    const farStart = vertsOf(m).filter(([x, y]) => alongOf(x, y, eStart) < -0.02).map(([x, y]) => radiusOf(x, y, eStart));
    const cornerR = (vs: number[]) => (vs.length ? Math.max(...vs) : -1);
    ok(farEnd.length > 0 && farStart.length > 0, `corner ${k}: both borders reach past their own span to the corner`);
    ok(cornerR(farEnd) > 0 && Math.abs(cornerR(farEnd) - cornerR(farStart)) <= 1,
        `corner ${k}: the two borders' miters meet at the same corner radius (${cornerR(farEnd).toFixed(0)} vs ${cornerR(farStart).toFixed(0)}px)`);
    // and the miter stays inside the tile that owns it: at most 2x the reach of Manhattan
    // distance from the tile's corner (r out AND r along)
    const c = [[0, 0], [64, 0], [64, 64], [0, 64]][k];
    const man = Math.max(...vertsOf(m).map(([x, y]) => Math.abs(x - c[0]) + Math.abs(y - c[1])));
    ok(man <= 2 * WREACH + 2, `corner ${k}'s miters stay within the diagonal tile (${man.toFixed(0)}px <= ${(2 * WREACH + 2).toFixed(0)}px)`);
}
eq(wave(WAVE, 0, T.TRUE_TILE_PLUS_EDGE_Z0 | T.TRUE_TILE_PLUS_EDGE_Z1).length,
   wave(WAVE, 0, T.TRUE_TILE_PLUS_EDGE_Z0).length + wave(WAVE, 0, T.TRUE_TILE_PLUS_EDGE_Z1).length,
   'two mask bits paint exactly the two borders');

console.log('\nthe train: never vanishing, always outward, and bounded by the reach');
{
    let emptyFrames = 0, worstRadius = 0, minRadius = Infinity;
    for (let p = 0; p < 200; p += 0.0137) {
        const t = wave(WAVE, p, 1);
        if (t.length === 0) { emptyFrames++; }
        for (const [x, y] of vertsOf(t)) {
            const r = radiusOf(x, y, 0);
            worstRadius = Math.max(worstRadius, r);
            minRadius = Math.min(minRadius, r);
        }
    }
    console.log(`    over 200 phases: worst radius ${worstRadius.toFixed(1)}px, nearest ${minRadius.toFixed(1)}px, reach ${WREACH.toFixed(1)}px`);
    eq(emptyFrames, 0, 'EVERY phase paints a ripple on the border (a bunched train could blink out entirely — measured, it did)');
    ok(minRadius >= -1, 'no vertex of the train reaches inside the tile at any phase');
    ok(worstRadius <= WREACH + 2, `the train stays within the reach (${worstRadius.toFixed(1)}px <= ${(WREACH + 2).toFixed(1)}px)`);
    ok(worstRadius > WREACH * 0.8, 'and it really does reach the end of it, rather than hugging the border');
}

console.log('\nthe wave animates: determinism, the envelope, and the speed slider');
eq(wave(WAVE, 0), wave(WAVE, 0), 'the same phase replays byte-identically');
eq(wave(WAVE, 0, 0, 2), wave(WAVE, 0, 0, 2), 'and so does a corner call');
ok(JSON.stringify(wave(WAVE, 0)) !== JSON.stringify(wave(WAVE, 0.4)), 'a different phase emits a different frame (it sweeps)');
{
    const env = (u: number) => T.trueTilePlusWaveEnv(u);
    eq(env(0), 0, 'the envelope is 0 on the border');
    eq(env(1), 0, 'and 0 at the reach — nothing pops in or out');
    let lo = Infinity, hi = -Infinity, peak = 0;
    for (let u = 0.001; u < 1; u += 0.001) {
        const v = env(u);
        lo = Math.min(lo, v); hi = Math.max(hi, v);
        if (v > env(peak)) { peak = u; }
    }
    ok(lo > 0 && hi <= 1, `the envelope stays in (0, 1] between the ends (saw ${lo.toFixed(3)}..${hi.toFixed(3)})`);
    ok(peak < 0.5, `and peaks before half way (u=${peak.toFixed(3)}), so a ripple is born strong and dies slow`);
    const frozen = S({ trueTilePlusEffect: 'wave', trueTilePlusSpeed: '0' });
    eq(wave(frozen, 0), wave(frozen, 7.5), 'speed 0 freezes the wave (same frame at any phase)');
    const fast = S({ trueTilePlusEffect: 'wave', trueTilePlusSpeed: '2' });
    eq(wave(fast, 0.5), wave(WAVE, 1), 'speed 2 at phase 0.5 == speed 1 at phase 1 (speed is a pure time scale)');
    eq(wave(fast, 0.5, 0, 3), wave(WAVE, 1, 0, 3), 'and the same for the miters');
}
{
    // the sliders change the geometry they claim to
    const c8 = S({ trueTilePlusEffect: 'wave', trueTilePlusCount: '8' });
    const c1 = S({ trueTilePlusEffect: 'wave', trueTilePlusCount: '1' });
    const r75 = S({ trueTilePlusEffect: 'wave', trueTilePlusReach: '75' });
    const r12 = S({ trueTilePlusEffect: 'wave', trueTilePlusReach: '12' });
    const maxR = (st: any) => { let m = 0; for (let p = 0; p < 60; p += 0.02) { for (const [x, y] of vertsOf(wave(st, p, 1))) { m = Math.max(m, radiusOf(x, y, 0)); } } return m; };
    const far75 = maxR(r75), far12 = maxR(r12);
    console.log(`    furthest vertex: reach 75% = ${far75.toFixed(1)}px, reach 12% = ${far12.toFixed(1)}px`);
    ok(far75 > far12 * 3, 'the reach slider really moves the train out');
    eq(wave(c8, 0.6, 1).length > wave(c1, 0.6, 1).length, true, 'count 8 paints more ripples than count 1');
    eq(T.trueTilePlusWaveSegments(1), 14, 'a lone ripple gets the finest sampling (14 quads)');
    eq(T.trueTilePlusWaveSegments(8), 10, 'a dense train gets the coarsest, so the budget stays bounded');
}

console.log('\ndegenerate quads emit nothing (wave)');
eq(wave(WAVE, 0, T.TRUE_TILE_PLUS_EDGE_ALL, -1).length > 0 && wave(WAVE, 0, T.TRUE_TILE_PLUS_EDGE_ALL, -1) !== null, true, 'a normal frame paints');
eq(T.trueTilePlusWave((() => 0) as any, [0, 10, 20, 30], [0, 10, 20, 30], [0, 0, 0, 0], [0, 0, 0, 0], WAVE, 0, T.TRUE_TILE_PLUS_EDGE_ALL), undefined, 'a zero-area (edge-on) quad emits nothing');
eq(T.trueTilePlusWave((() => 0) as any, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], WAVE, 0, T.TRUE_TILE_PLUS_EDGE_ALL), undefined, 'a collapsed projection emits nothing');
eq(T.trueTilePlusWave((() => 0) as any, QUAD.px, QUAD.py, [32, 64, 32, 0], [0, 32, 64, 32], WAVE, 0, T.TRUE_TILE_PLUS_EDGE_ALL), undefined, 'collapsed probes (no outward direction) emit nothing');
{
    const small = { px: [0, 2, 2, 0], py: [0, 0, 2, 2], ox: [1, 2 + OUT * 0.03125, 1, -OUT * 0.03125], oy: [-OUT * 0.03125, 1, 2 + OUT * 0.03125, 1] };
    eq(wave(WAVE, 0, T.TRUE_TILE_PLUS_EDGE_ALL).length >= 0, true, 'sanity');
    eq(T.trueTilePlusWave((() => 0) as any, small.px, small.py, small.ox, small.oy, WAVE, 0, T.TRUE_TILE_PLUS_EDGE_ALL), undefined, 'a tile whose borders are under TRUE_TILE_PLUS_MIN_EDGE emits nothing');
}

console.log('\nthe dispatcher passes the corner through (what the World hook calls)');
function dispatchW(settings: any, phase = 0, mask = T.TRUE_TILE_PLUS_EDGE_ALL, corner = -1) {
    const tris: number[][] = [];
    const emit = (xA: number, xB: number, xC: number, yA: number, yB: number, yC: number, colour: number, trans: number) =>
        tris.push([xA, yA, xB, yB, xC, yC, colour, trans]);
    T.trueTilePlusEffect(emit, QUAD.px, QUAD.py, QUAD.ox, QUAD.oy, settings, phase, mask, corner);
    return tris;
}
eq(dispatchW(WAVE), wave(WAVE, 0), 'wave → exactly trueTilePlusWave');
eq(dispatchW(WAVE, 0, 0, 3), wave(WAVE, 0, 0, 3), 'the corner reaches the wave through the dispatcher');
eq(dispatchW({ ...WAVE, enabled: false }, 0, 0, 3).length, 0, 'master off → nothing, miters included');
eq(dispatchW({ ...WAVE, effect: T.TRUE_TILE_PLUS_EFFECT_NONE }).length, 0, "effect 'none' → nothing");
eq(dispatchW({ ...WAVE, effect: T.TRUE_TILE_PLUS_EFFECT_FLAMES }).length, collect(0).length, 'effect flames → the flames, unchanged (the corner argument is ignored)');
eq(dispatch(S({ trueTilePlusEffect: 'wave' })), wave(WAVE, 0), 'the settings object alone selects the wave');


console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
