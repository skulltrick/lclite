// lclite:true-tile-plus functional test — runs the REAL core (files/webclient/src/dash3d/
// TrueTilePlus.ts, the same file `apply` copies into the tree) headlessly:
//
//   bun run mods/true-tile-plus/tools/true_tile_plus_test.ts        (from anywhere)
//
// Set LCLITE_ROOT=<install> to test the copy inside an applied tree; it prints which file
// it loaded either way.
//
// Covers the four things a browser cannot tell us cheaply:
//  1. the settings parse/clamp table — a stale or hand-typed localStorage value must never
//     paint garbage, and the effect only turns off on the literal 'none';
//  2. the flame geometry — a deterministic, bounded, outward-pointing set of blades: the
//     right triangle budget, integer pixels, tips that grow AWAY from the tile and never
//     fly off it, and nothing at all for a degenerate quad or an edge-on tile;
//  3. the animation — same phase replays byte-identically (the harness can assert a whole
//     frame), different phases actually differ, and the flicker stays inside its stated
//     range so a blade can neither vanish nor double its reach;
//  4. the dispatcher contract the World hook relies on: disabled or effect 'none' emits
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
const look = (s: any) => [s.enabled, s.effect, s.rgb];

console.log('\nsettings defaults (empty store = a fresh install)');
eq(look(S()), [true, T.TRUE_TILE_PLUS_EFFECT_FLAMES, 0x000000], 'defaults: on, flames, black');
eq(Object.keys(S()).sort(), ['effect', 'enabled', 'rgb'], 'the settings object has exactly the documented fields');
eq(T.TRUE_TILE_PLUS_DEFAULT_COLOR, '#000000', 'documented default colour is the panel row default');
eq(T.TRUE_TILE_PLUS_DEFAULT_EFFECT, 'flames', 'documented default effect is the panel row default');
eq([T.TRUE_TILE_PLUS_EFFECT_NONE, T.TRUE_TILE_PLUS_EFFECT_FLAMES], [0, 1], 'effect ids are integers (never strings that index a table)');

console.log('\nmaster key');
eq(S({ trueTilePlus: 'true' }).enabled, true, "'true' → on");
eq(S({ trueTilePlus: 'false' }).enabled, false, "'false' → off");
eq(S({ trueTilePlus: 'TRUE' }).enabled, true, 'anything else → on (only the literal false disables)');
eq(S({ trueTilePlus: '' }).enabled, true, 'empty string → on');

console.log('\neffect key: only the literal none turns it off');
eq(S({ trueTilePlusEffect: 'none' }).effect, T.TRUE_TILE_PLUS_EFFECT_NONE, "'none' → no effect");
eq(S({ trueTilePlusEffect: 'flames' }).effect, T.TRUE_TILE_PLUS_EFFECT_FLAMES, "'flames' → flames");
eq(S({ trueTilePlusEffect: '' }).effect, T.TRUE_TILE_PLUS_EFFECT_FLAMES, 'empty string → flames (an untouched select has no stored value)');
eq(S({ trueTilePlusEffect: 'None' }).effect, T.TRUE_TILE_PLUS_EFFECT_FLAMES, 'case matters: the panel writes lowercase only');
eq(S({ trueTilePlusEffect: 'junk' }).effect, T.TRUE_TILE_PLUS_EFFECT_FLAMES, 'junk → flames, never a silent nothing');

console.log('\ncolour: only a 7-char #rrggbb is accepted');
eq(S({ trueTilePlusColor: '#000000' }).rgb, 0x000000, 'black is the default and a legal value');
eq(S({ trueTilePlusColor: '#FF00FF' }).rgb, 0xff00ff, "'#FF00FF' parses (case-insensitive)");
eq(S({ trueTilePlusColor: '#ff8800' }).rgb, 0xff8800, "'#ff8800' parses");
eq(S({ trueTilePlusColor: 'red' }).rgb, 0x000000, "'red' → default black");
eq(S({ trueTilePlusColor: '#fff' }).rgb, 0x000000, 'short hex → default');
eq(S({ trueTilePlusColor: '#gggggg' }).rgb, 0x000000, 'non-hex digits → default');

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

function collect(phase: number, quad = QUAD, rgb = 0x000000, opts: any = {}) {
    const tris: number[][] = [];
    const emit = (xA: number, xB: number, xC: number, yA: number, yB: number, yC: number, colour: number, trans: number) =>
        tris.push([xA, yA, xB, yB, xC, yC, colour, trans]);
    T.trueTilePlusFlames(emit, quad.px, quad.py, quad.ox, quad.oy, rgb, phase);
    return tris;
}

const TONGUES = T.TRUE_TILE_PLUS_TONGUES;
const BUDGET = TONGUES * 4 * 3;

console.log('\ntriangle budget and pixel contract');
const t0 = collect(0);
eq(t0.length, BUDGET, `${TONGUES} tongues x 4 edges x 3 triangles = ${BUDGET} triangles`);
ok(t0.every(t => t.slice(0, 6).every(Number.isInteger)), 'every emitted coordinate is an integer (the rasterizer works in ints)');
ok(t0.every(t => t[6] === 0x000000), 'every triangle carries the requested colour');
ok(t0.every(t => t[7] === 0), 'every triangle is opaque (trans 0 = destination weight 0)');
ok(t0.every(t => {
    const [ax, ay, bx, by, cx, cy] = t;
    return (bx - ax) * (cy - ay) - (cx - ax) * (by - ay) !== 0;
}), 'no blade triangle is degenerate (a zero-area triangle would be a silent no-op)');

console.log('\ndeterminism (the harness can assert a whole frame)');
eq(collect(0), collect(0), 'the same phase replays byte-identically');
eq(collect(3.75), collect(3.75), 'and so does an arbitrary later phase');
ok(JSON.stringify(collect(0)) !== JSON.stringify(collect(0.4)), 'a different phase emits a different frame (it animates)');
eq(collect(0, QUAD, 0xff0000)[0][6], 0xff0000, 'the colour flows through to the geometry');

console.log('\nthe flames are OUTWARD and stay on their own edge');
// the tile's centre; every edge's outward normal points away from it
const CX = 32, CY = 32;
// blade b = triangles 3b (base quad half), 3b+1 (base quad half), 3b+2 (the leaning tip).
// The tip must never be nearer the tile's centre than that blade's own root.
const bladesOutward = (tris: number[][]) => {
    for (let b = 0; b < tris.length / 3; b++) {
        const rootX = tris[b * 3][0], rootY = tris[b * 3][1];
        const tipX = tris[b * 3 + 2][4], tipY = tris[b * 3 + 2][5];
        if (Math.hypot(tipX - CX, tipY - CY) < Math.hypot(rootX - CX, rootY - CY) - 0.5) {
            return false;
        }
    }
    return true;
};
ok(bladesOutward(collect(0)), 'no blade points back into the tile at phase 0');
ok(bladesOutward(collect(1.7)), 'no blade points back into the tile at phase 1.7');
ok(bladesOutward(collect(9.3)), 'no blade points back into the tile at phase 9.3');

// each edge's tips must sit outside the quad on ITS side
const edgeOut = (tris: number[][], edge: number) => {
    const out = [[0, -1], [1, 0], [0, 1], [-1, 0]][edge];   // world-space outward per edge
    return tris.slice(edge * TONGUES * 3, (edge + 1) * TONGUES * 3).every(t => {
        const tx = t[4], ty = t[5];
        if (out[0] !== 0) return out[0] > 0 ? tx > 64 : tx < 0;
        return out[1] > 0 ? ty > 64 : ty < 0;
    });
};
for (let e = 0; e < 4; e++) {
    ok(edgeOut(collect(2.2), e), `edge ${e}'s tips are outside the tile on that edge's own side`);
}

console.log('\nthe root sits ON the border (a flame grows out of the edge, not beside it)');
// every base vertex of every blade must lie on its own edge's line (sideways offsets are
// along the edge, so they cannot move it off): edge 0 = y 0, 1 = x 64, 2 = y 64, 3 = x 0.
const rootsOnEdge = (tris: number[][]) => {
    for (let b = 0; b < tris.length / 3; b++) {
        const edge = Math.floor(b / TONGUES);
        const t = tris[b * 3];                        // [blx, bly, brx, bry, wrx, wry]
        const along = edge === 0 || edge === 2 ? [t[1], t[3]] : [t[0], t[2]];
        const target = [0, 64, 64, 0][edge];          // edge 0 = y 0, 1 = x 64, 2 = y 64, 3 = x 0
        for (const v of along) {
            if (Math.abs(v - target) > 2.5) return false;
        }
    }
    return true;
};
ok(rootsOnEdge(collect(0)), 'every blade root lies on its own tile border (within the 1px inset + rounding)');
ok(rootsOnEdge(collect(5.5)), 'and still does at another phase');

console.log('\nreach is bounded (no screen-crossing blade at a grazing view)');
const small = { px: [0, 2, 2, 0], py: [0, 0, 2, 2], ox: [1, 2 + OUT * 0.03125, 1, -OUT * 0.03125], oy: [-OUT * 0.03125, 1, 2 + OUT * 0.03125, 1] };
eq(collect(0, small).length, 0, 'a tile whose edges are under TRUE_TILE_PLUS_MIN_EDGE emits nothing');
const huge = { px: [0, 4000, 4000, 0], py: [0, 0, 4000, 4000], ox: [2000, 4000 + OUT * 31, 2000, -OUT * 31], oy: [-OUT * 31, 2000, 4000 + OUT * 31, 2000] };
const hugeT = collect(0, huge);
ok(hugeT.length === BUDGET, 'a zoomed-in tile still emits the full budget');
ok(hugeT.every(t => Math.hypot(t[4] - t[0], t[5] - t[1]) <= T.TRUE_TILE_PLUS_MAX_LENGTH * 1.4 + 4),
    'no blade reaches further than the documented cap (x the flicker/lean headroom)');

console.log('\ndegenerate quads emit nothing');
eq(collect(0, { px: [0, 10, 20, 30], py: [0, 10, 20, 30], ox: [0, 0, 0, 0], oy: [0, 0, 0, 0] }).length, 0, 'a zero-area (edge-on) quad emits nothing');
eq(collect(0, { px: [0, 0, 0, 0], py: [0, 0, 0, 0], ox: [0, 0, 0, 0], oy: [0, 0, 0, 0] }).length, 0, 'a collapsed projection emits nothing');
// probes ON the edge midpoints = a zero-length outward vector: no direction to point a flame in
eq(collect(0, { px: QUAD.px, py: QUAD.py, ox: [32, 64, 32, 0], oy: [0, 32, 64, 32] }).length, 0, 'collapsed probes (no outward direction) emit nothing');

console.log('\nflicker + seeds (the look must be uneven but bounded)');
const flick = (p: number, s: number) => T.trueTilePlusFlicker(p, s);
let fMin = Infinity, fMax = -Infinity;
for (let p = 0; p < 40; p += 0.05) {
    for (let s = 0; s < 1; s += 0.1) {
        const f = flick(p, s);
        fMin = Math.min(fMin, f); fMax = Math.max(fMax, f);
    }
}
ok(fMin >= 0.60 && fMax <= 1.30, `flicker stays inside its documented [0.60, 1.30] range (saw ${fMin.toFixed(3)}..${fMax.toFixed(3)})`);
ok(flick(1, 0.1) !== flick(1, 0.9), 'two tongues at the same phase flicker differently (no printed-looking row)');
const seeds: number[] = [];
for (let e = 0; e < 4; e++) for (let k = 0; k < TONGUES; k++) seeds.push(T.trueTilePlusSeed(e, k));
ok(seeds.every(s => s >= 0 && s < 1), 'every seed is in [0,1)');
eq(new Set(seeds).size, seeds.length, 'every (edge, tongue) has its own seed');
eq(seeds, (() => { const out: number[] = []; for (let e = 0; e < 4; e++) for (let k = 0; k < TONGUES; k++) out.push(T.trueTilePlusSeed(e, k)); return out; })(), 'seeds are stable across calls');

console.log('\nthe dispatcher (what the World hook actually calls)');
function dispatch(settings: any, phase = 0) {
    const tris: number[][] = [];
    const emit = (xA: number, xB: number, xC: number, yA: number, yB: number, yC: number, colour: number, trans: number) =>
        tris.push([xA, yA, xB, yB, xC, yC, colour, trans]);
    T.trueTilePlusEffect(emit, QUAD.px, QUAD.py, QUAD.ox, QUAD.oy, settings, phase);
    return tris;
}
eq(dispatch({ enabled: false, effect: T.TRUE_TILE_PLUS_EFFECT_FLAMES, rgb: 0x000000 }).length, 0, 'master off → nothing is emitted (the key is read before any geometry)');
eq(dispatch({ enabled: true, effect: T.TRUE_TILE_PLUS_EFFECT_NONE, rgb: 0x000000 }).length, 0, "effect 'none' → nothing is emitted");
eq(dispatch({ enabled: true, effect: T.TRUE_TILE_PLUS_EFFECT_FLAMES, rgb: 0x000000 }), collect(0), 'flames → exactly trueTilePlusFlames');
eq(dispatch(S({ trueTilePlusColor: '#123456' })), collect(0, QUAD, 0x123456), 'a stored colour reaches the geometry through the dispatcher');
eq(dispatch({ enabled: true, effect: 99, rgb: 0x000000 }).length, 0, 'an unknown future effect id emits nothing rather than guessing');

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
