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

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
