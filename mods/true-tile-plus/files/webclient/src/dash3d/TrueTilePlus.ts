// lclite:true-tile-plus — the True tile+ mod's pure core: the settings parse and the
// ground-effect geometry. Nothing here touches the client (no Pix2D, no Pix3D, no World),
// so mods/true-tile-plus/tools/true_tile_plus_test.ts runs the REAL shipped logic
// headlessly, and tools/true_tile_plus_preview.ts can rasterize it for eyeballing.
//
// WHAT THIS IS: effects that ride the TRUE TILE — the tile the SERVER has the player on
// (the head of the local move queue), the same tile mods/true-tile outlines. Two effects:
//
//   FLAMES — flat tongues licking outward off the tile's four borders, lying on the ground
//   plane. Fixed in shape, alive in flicker: each tongue has its own size, its own place
//   along the border, its own flicker and its own flare.
//
//   WAVE — a train of ripples sweeping OUTWARD off the tile's four borders, like the rings
//   a stone leaves in water. The four borders' bands form ONE ring, mitred closed at the
//   corners; the crest undulates along the border, and the undulation is continuous around
//   the square (its phase is a function of the perimeter, not of one edge); each ripple
//   trails a translucent swell behind it, and every ripple is born on the border and
//   dissolves at the reach.
//
// Both are deliberately standalone: this mod reads its OWN keys (rule 5) and works with
// true-tile on or off — it frames whatever square is (or is not) there.
//
// WHY THE GEOMETRY IS SHAPED THIS WAY
//
// 1. The geometry is GROUND GEOMETRY, drawn on the turn of the tile each piece LIES OVER
//    (World.trueTilePlusDraw, called from fill()) — so a piece goes down right after the
//    ground under it and before that tile's walls and sprites. That is what makes the
//    effect read as ON the floor rather than pasted over the scene.
//
//    WHY PER-NEIGHBOUR, NOT PER-TILE: every piece is rooted on the true tile's border and
//    reaches OUTWARD, so each one lies over the tile NEXT DOOR. renderAll draws the scene
//    back-to-front, but as an axis-aligned square-ring walk around the CAMERA's own tile
//    (dx/dz from -viewRadius to 0: the outermost ring first, the camera's own tile last) —
//    not a sort by true depth. A neighbouring tile that comes later in that walk therefore
//    paints its ground straight over anything that reached into it, and WHICH neighbour
//    that is changes with the camera's yaw. A first version drew everything on the true
//    tile's own turn and only ever showed 2-3 of the 4 edges for exactly that reason.
//    Drawing each edge's geometry when the tile it lies over is drawn is order-proof: that
//    tile's ground is already down (so it cannot cover the geometry), its walls and sprites
//    still come after it (so they can, and correctly, cover it), and no later tile overlaps
//    the ground it sits on. The caller says which edges to draw with `mask`, one bit per
//    edge. The same law has a second half: geometry must never reach INWARD past the
//    border, because the true tile is a different tile drawn on its own turn and its ground
//    could paint over anything that spilled onto it.
//
// 2. Everything is computed from the tile's four PROJECTED corners plus one projected
//    OUTWARD PROBE per edge (that edge's world midpoint pushed out by
//    TRUE_TILE_PLUS_OUTER_UNITS, riding the tile's own plane). The probes are what make
//    the effects camera-proof: they hand each edge its real screen-space outward direction
//    and its own px-per-world-unit scale, so geometry stays glued to its own border, points
//    the right way and grows/shrinks with zoom — instead of being a fixed-pixel shape that
//    swings off the tile as the camera turns or zooms.
//
// 3. The probes ride the TILE'S OWN PLANE (the mean of that edge's two corner heights)
//    rather than sampling the ground beyond the tile: a flat decal that follows the tile
//    it frames can never slide down a cliff face or bury itself in a slope it does not own.
//
// 4. A flame is a THREE-TRIANGLE BLADE: a base quad that tapers to a waist, then a point
//    that leans along the edge as it flickers. One triangle would read as a spike; the
//    waist and the lean are what make it read as fire at this size. A ripple is a SEGMENTED
//    BAND: a strip of quads along the border whose ends are pushed in and out by the
//    undulation, with a solid crest in front and a translucent swell behind it — plus a
//    MITER trapezoid at each end, which the tile owning that corner draws, so the four bands
//    close into one ring. Everything is emitted as integers (the rasterizer works in integer
//    pixels), a triangle that collapses to zero area is dropped rather than emitted, and
//    everything is a pure function of `phase`, so the harness can replay any frame exactly.
//
// 5. NO TWO FLAMES ARE ALIKE, and none of them stands still: each tongue gets its own
//    seeded size, width, waist and lean, its own place along the edge (with a slow drift,
//    so the row wanders instead of sitting pinned to its slots), its own flicker (three
//    harmonics) and its own flare envelope (a tongue surges, then dies back, on a beat of
//    its own). That is what keeps a ring of fire from reading as a printed border. The wave
//    gets the same treatment in its own dimensions: each ripple has its own undulation phase,
//    its own waviness, its own crest weight and its own life (born thin on the border,
//    dissolving at the reach). What it does NOT get is its own travel rate or a wandering
//    slot: the train's spacing is exact, because a train that bunches can leave the tile with
//    no ripple at all — and a wave that blinks out is worse than a regular one. The
//    wavelength is the reach itself, with a floor, so the effect stays readable whether the
//    reach is a sliver or most of a tile.

/** What the effects need per frame. Read from this mod's OWN localStorage keys (rule 5) at
 *  its own hook site (World.trueTilePlusDraw) — never another mod's key, and never through
 *  a settings hub. */
export interface TrueTilePlusSettings {
    enabled: boolean;
    effect: number;
    rgb: number;
    count: number;   // elements per tile edge: flame tongues, or ripples in the wave train
    reach: number;   // how far an element reaches, as a % of a tile side
    speed: number;   // animation speed multiplier (0 = frozen)
}

/** The effect ids. INTEGERS, not names: a runtime string must never index a table in
 *  bundled code (the terser property mangler renames object-literal KEYS, so a lookup by a
 *  value that came out of localStorage silently misses). The panel's select row writes the
 *  string; `trueTilePlusSettings` maps it to one of these. */
export const TRUE_TILE_PLUS_EFFECT_NONE: number = 0;
export const TRUE_TILE_PLUS_EFFECT_FLAMES: number = 1;
export const TRUE_TILE_PLUS_EFFECT_WAVE: number = 2;

/** One bit per tile edge, in the corner order the caller projects them (edge i runs from
 *  corner i to corner (i + 1) & 3): 0 = the -z side, 1 = +x, 2 = +z, 3 = -x. The caller
 *  draws the edge whose geometry lies over the tile it is currently drawing. */
export const TRUE_TILE_PLUS_EDGE_Z0: number = 1;
export const TRUE_TILE_PLUS_EDGE_X1: number = 2;
export const TRUE_TILE_PLUS_EDGE_Z1: number = 4;
export const TRUE_TILE_PLUS_EDGE_X0: number = 8;
export const TRUE_TILE_PLUS_EDGE_ALL: number = 15;

export const TRUE_TILE_PLUS_DEFAULT_COLOR: string = '#000000';
export const TRUE_TILE_PLUS_DEFAULT_EFFECT: string = 'flames';
export const TRUE_TILE_PLUS_DEFAULT_COUNT: number = 4;
export const TRUE_TILE_PLUS_DEFAULT_REACH: number = 23;
export const TRUE_TILE_PLUS_DEFAULT_SPEED: number = 1;

/** A tile is 128 world units: the reach key is a percentage of that, so an element keeps
 *  its proportion to the tile as the camera zooms instead of growing with the screen. */
export const TRUE_TILE_PLUS_TILE_UNITS: number = 128;

/** Slider ranges, enforced HERE (not at the call site) so a stale or hand-typed key cannot
 *  paint garbage. The reach cap keeps an element on the tile it reaches over: at 75 % of a
 *  tile it still lands well short of that tile's far edge. */
export const TRUE_TILE_PLUS_MAX_COUNT: number = 8;
export const TRUE_TILE_PLUS_MAX_REACH: number = 75;
export const TRUE_TILE_PLUS_MAX_SPEED: number = 3;

/** The outward probe's world offset: half a tile out from an edge's midpoint. The payload
 *  divides the probe's screen length by this to get px-per-world-unit for that edge, so the
 *  World-side hook and this file must agree on it — hence it is exported. */
export const TRUE_TILE_PLUS_OUTER_UNITS: number = 64;

/** Below this many screen px an edge is not worth hanging an effect off (a distant or
 *  edge-on tile), and a flame's final length is capped so a grazing view or a flare cannot
 *  throw tongues across the screen. */
export const TRUE_TILE_PLUS_MIN_EDGE: number = 4;
export const TRUE_TILE_PLUS_MAX_LENGTH: number = 80;

/** The root is tucked this far INSIDE the border, so a flame grows out of the tile's edge
 *  rather than floating beside it. */
export const TRUE_TILE_PLUS_ROOT_INSET: number = 1;

/** WAVE — the ripple train's tunables. Every length is a SHARE of the ripple spacing (the
 *  train's wavelength divided by the ripple count), which is what keeps the effect in
 *  proportion whether the reach is a sliver or most of a tile, and at any camera zoom. */
export const TRUE_TILE_PLUS_WAVE_RIPPLES: number = 2;         // undulations per border side (4 sides = 8 around the square)
export const TRUE_TILE_PLUS_WAVE_TRAVEL_RATE: number = 0.55;  // sweeps per second at speed 1
export const TRUE_TILE_PLUS_WAVE_RIPPLE_RATE: number = 2.6;   // rad/s the undulation travels along the perimeter
export const TRUE_TILE_PLUS_WAVE_BAND_PHASE: number = 0.85;   // rad of undulation offset between neighbouring ripples
export const TRUE_TILE_PLUS_WAVE_MIN_GAP: number = 7;         // px floor on the wavelength, so a short reach still reads
export const TRUE_TILE_PLUS_WAVE_CREST: number = 0.50;        // crest thickness, as a share of the spacing
export const TRUE_TILE_PLUS_WAVE_SWELL: number = 0.85;        // trailing swell length, as a share of the spacing
export const TRUE_TILE_PLUS_WAVE_AMP: number = 0.45;          // undulation amplitude, as a share of the spacing
export const TRUE_TILE_PLUS_WAVE_MAX_CREST: number = 14;      // px caps, so a grazing camera cannot smear the effect
export const TRUE_TILE_PLUS_WAVE_MAX_SWELL: number = 26;
export const TRUE_TILE_PLUS_WAVE_MAX_AMP: number = 12;
export const TRUE_TILE_PLUS_WAVE_ALPHA: number = 128;         // peak alpha of the trailing swell, of 255
export const TRUE_TILE_PLUS_WAVE_CREST_ALPHA: number = 255;   // peak alpha of the crest — it fades as it travels, like the swell
export const TRUE_TILE_PLUS_WAVE_MITER_SEGMENTS: number = 3;  // quads in a corner miter (it waves too, see trueTilePlusWave)
export const TRUE_TILE_PLUS_WAVE_MIN_ENV: number = 0.05;      // below this a ripple is not worth drawing
export const TRUE_TILE_PLUS_WAVE_MIN_PX: number = 0.5;        // px floor on the crest's half-thickness and the swell

/** The client's reader for this mod's OWN keys. It lives here so the "own keys, read per
 *  frame at my own hook" contract (rule 5) has exactly one definition; the harness passes
 *  its own stub instead. */
export function trueTilePlusRead(key: string): string | null {
    return localStorage.getItem(key);
}

/** Clamp an integer key to a range, falling back to `def` when the key is unset or junk —
 *  the one place every numeric setting is validated. */
function ttpNumber(read: (key: string) => string | null, key: string, def: number, min: number, max: number): number {
    const raw: string | null = read(key);
    let v: number = raw === null ? def : parseInt(raw, 10);
    if (isNaN(v)) {
        v = def;
    }
    if (v < min) {
        return min;
    }
    return v > max ? max : v;
}

/** The fractional part, always in [0,1) — the wave's train position wraps with it. */
function ttpFraction(v: number): number {
    return v - Math.floor(v);
}

/** Read and validate this mod's settings. `read` is localStorage.getItem in the client and
 *  a stub in the harness. Everything is clamped HERE rather than at the call site, so a
 *  stale, hand-typed or half-written key can never paint garbage: the colour must be a
 *  7-char '#rrggbb', the count 1..8, the reach 4..75 % of a tile, the speed 0..3×, and the
 *  effect only turns off on the literal 'none'. The master key defaults ON ('false' is the
 *  only value that disables), because the effect IS the mod. */
export function trueTilePlusSettings(read: (key: string) => string | null): TrueTilePlusSettings {
    const enabled: boolean = read('trueTilePlus') !== 'false';

    // An unset or junk effect key means FLAMES, not "nothing": the mod exists to draw
    // something, and a select row that has never been touched has no stored value. (Junk
    // must not fall through to 'wave' either — the first effect is the safe default.)
    const effectKey: string | null = read('trueTilePlusEffect');
    const effect: number = effectKey === 'none'
        ? TRUE_TILE_PLUS_EFFECT_NONE
        : effectKey === 'wave'
            ? TRUE_TILE_PLUS_EFFECT_WAVE
            : TRUE_TILE_PLUS_EFFECT_FLAMES;

    let rgb: number = parseInt(TRUE_TILE_PLUS_DEFAULT_COLOR.substring(1), 16);
    const hex: string | null = read('trueTilePlusColor');
    if (hex !== null && hex.length === 7 && hex.charCodeAt(0) === 35 /* # */) {
        const parsed: number = parseInt(hex.substring(1), 16);
        if (!isNaN(parsed)) {
            rgb = parsed;
        }
    }

    // The speed slider writes a fraction (0.25 steps), so it is read as a float — the one
    // setting that is not an integer. Junk/negative → frozen, not the default: a stored
    // value that cannot be honoured must never silently speed the effect up.
    const rawSpeed: string | null = read('trueTilePlusSpeed');
    let speed: number = rawSpeed === null ? TRUE_TILE_PLUS_DEFAULT_SPEED : parseFloat(rawSpeed);
    if (isNaN(speed) || speed < 0) {
        speed = 0;
    } else if (speed > TRUE_TILE_PLUS_MAX_SPEED) {
        speed = TRUE_TILE_PLUS_MAX_SPEED;
    }

    return {
        enabled,
        effect,
        rgb,
        count: ttpNumber(read, 'trueTilePlusCount', TRUE_TILE_PLUS_DEFAULT_COUNT, 1, TRUE_TILE_PLUS_MAX_COUNT),
        reach: ttpNumber(read, 'trueTilePlusReach', TRUE_TILE_PLUS_DEFAULT_REACH, 4, TRUE_TILE_PLUS_MAX_REACH),
        speed
    };
}

/** Emit one screen-space triangle. `trans` is Pix3D's own convention — the DESTINATION
 *  weight of the mix (0 = opaque, 256 = fully transparent) — so the client's binding is
 *  literally "set Pix3D.trans, call Pix3D.flatTriangle". Keeping the renderer injected is
 *  what lets the harness run this geometry with no engine at all. It is also the ONE way a
 *  translucent ground effect may be drawn: a Pix2D blend into the game buffer mixes against
 *  a sentinel-cleared buffer on a gpu frame, while Pix3D.trans is both the software
 *  raster's destination weight and the per-triangle alpha the gpu mod captures. */
export type TrueTilePlusEmit = (
    xA: number, xB: number, xC: number,
    yA: number, yB: number, yC: number,
    colour: number, trans: number
) => void;

/** A deterministic [0,1) value per (edge, tongue, salt): the flames must look
 *  hand-scattered but replay identically for the same phase, so the harness can assert a
 *  whole frame. 32-bit integer mixing (Math.imul) rather than Math.random — two salts per
 *  tongue give it two independent streams (see trueTilePlusFlames). The wave reuses it with
 *  edge 0 for every ripple, because the four edges are ONE ring (see trueTilePlusWave). */
export function trueTilePlusSeed(edge: number, tongue: number, salt: number = 0): number {
    let h: number = Math.imul(edge + 1, 0x9e3779b1) ^ Math.imul(tongue + 1, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    h = Math.imul(h, 0x27d4eb2f);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

/** How tall a tongue is right now, as a multiplier on its own size. Three harmonics with
 *  per-tongue phase offsets (two driven by s1, one by s2) so neighbours never pulse
 *  together and no two tongues trace the same curve. Range [0.53, 1.31] by construction. */
export function trueTilePlusFlicker(phase: number, s1: number, s2: number): number {
    return 0.92
        + 0.20 * Math.sin(phase * 6.1 + s1 * 6.283)
        + 0.12 * Math.sin(phase * 11.3 + s2 * 12.7)
        + 0.07 * Math.sin(phase * 2.3 + s1 * 3.7);
}

/** The slow surge: a tongue rises to a peak and dies back on a beat of its own, which is
 *  what stops a row of equal-height flames from reading as a comb. Range [1, 1.30]. */
export function trueTilePlusFlare(phase: number, s2: number): number {
    const beat: number = Math.sin(phase * 0.9 + s2 * 6.283);
    return 1 + 0.30 * (beat > 0 ? beat * beat * beat : 0);
}

/** Draw the Flames effect: `settings.count` blades on each edge selected by `mask`, rooted
 *  on that edge's border and reaching outward along the edge's own projected direction, all
 *  lying in the ground plane.
 *
 *  `px`/`py` are the four projected tile corners (edge i runs from corner i to corner
 *  (i + 1) & 3) and `ox`/`oy` the four projected outward probes, index i belonging to edge
 *  i. `mask` is the set of edges to draw — the caller passes the one whose blades lie over
 *  the tile it is drawing, so the flames land on the ground they burn.
 *
 *  At most 8 tongues x 4 edges = 32 blades = 96 triangles, and nothing at all when the mod
 *  is off (the master key is read before any geometry is built). */
export function trueTilePlusFlames(
    emit: TrueTilePlusEmit,
    px: number[], py: number[],
    ox: number[], oy: number[],
    settings: TrueTilePlusSettings,
    phase: number,
    mask: number = TRUE_TILE_PLUS_EDGE_ALL
): void {
    // A quad seen exactly edge-on (or a collapsed projection) has no area to put a flame
    // on, and no meaningful outward direction either — the same test the tile decal uses.
    if ((px[1] - px[0]) * (py[3] - py[0]) - (px[3] - px[0]) * (py[1] - py[0]) === 0) {
        return;
    }

    const count: number = settings.count;
    const reachUnits: number = (settings.reach * TRUE_TILE_PLUS_TILE_UNITS) / 100;
    const t: number = phase * settings.speed;   // the one place the speed slider acts

    for (let i: number = 0; i < 4; i++) {
        if ((mask & (1 << i)) === 0) {
            continue;
        }

        const j: number = (i + 1) & 3;

        const ex: number = px[j] - px[i];
        const ey: number = py[j] - py[i];
        const len: number = Math.sqrt(ex * ex + ey * ey);
        if (!(len >= TRUE_TILE_PLUS_MIN_EDGE)) {
            continue;   // too small on screen to hang fire off
        }

        // This edge's outward direction and its scale, both straight off the projected
        // probe: no camera math is duplicated here, so the flames follow the ground plane
        // the corners came from, at any yaw, pitch or zoom.
        const mx: number = (px[i] + px[j]) * 0.5;
        const my: number = (py[i] + py[j]) * 0.5;
        let ux: number = ox[i] - mx;
        let uy: number = oy[i] - my;
        const ulen: number = Math.sqrt(ux * ux + uy * uy);
        if (!(ulen > 0.5)) {
            continue;   // a collapsed probe: no outward direction to speak of
        }
        ux /= ulen;
        uy /= ulen;

        const scale: number = ulen / TRUE_TILE_PLUS_OUTER_UNITS;   // px per world unit here
        const gx: number = ex / len;   // along the edge: the base's width and the lean
        const gy: number = ey / len;
        const spacing: number = len / count;

        for (let k: number = 0; k < count; k++) {
            // Two independent seeds per tongue: s1 drives its size, beat and lean phase, s2
            // its width, waist and place along the edge. Neither is random at runtime —
            // same phase, same frame, every time.
            const s1: number = trueTilePlusSeed(i, k, 0);
            const s2: number = trueTilePlusSeed(i, k, 1);

            // Each tongue is its own size and shape: tall thin licks beside short fat ones,
            // so the row never reads as a printed border.
            const sizeF: number = 0.60 + 0.65 * s1;              // 0.60 .. 1.25
            const widthF: number = 1.35 - 0.55 * s1 + 0.30 * s2; // 0.50 .. 1.65 (fatter when shorter)
            const waistF: number = 0.34 + 0.26 * s2;             // 0.34 .. 0.60
            const leanAmp: number = 0.20 + 0.55 * s2;            // 0.20 .. 0.75

            // Evenly spaced, then nudged by the tongue's own seed AND slowly drifted along
            // the edge, so the row wanders instead of sitting pinned to its slots.
            const drift: number = Math.sin(t * 0.55 + s1 * 6.283) * (0.20 / count);
            const jitter: number = (s2 - 0.5) * (0.55 / count);
            const at: number = (k + 0.5) / count + drift + jitter;

            // The root sits ON the border, a hair inside it, so the flame grows out of the
            // tile's edge instead of floating beside it.
            const bx: number = px[i] + ex * at - ux * TRUE_TILE_PLUS_ROOT_INSET;
            const by: number = py[i] + ey * at - uy * TRUE_TILE_PLUS_ROOT_INSET;

            let l: number = reachUnits * scale * sizeF * trueTilePlusFlicker(t, s1, s2) * trueTilePlusFlare(t, s2);
            if (l > TRUE_TILE_PLUS_MAX_LENGTH) {
                l = TRUE_TILE_PLUS_MAX_LENGTH;
            } else if (l < 2) {
                l = 2;
            }

            const lean: number = Math.sin(t * 3.3 + s1 * 9.4) * l * leanAmp;
            const waist: number = l * waistF;
            let halfW: number = spacing * 0.30 * widthF;
            if (halfW < 0.8) {
                halfW = 0.8;
            } else if (halfW > 10) {
                halfW = 10;
            }
            const waistW: number = halfW * 0.5;

            // base → waist → leaning tip
            const blx: number = Math.round(bx - gx * halfW);
            const bly: number = Math.round(by - gy * halfW);
            const brx: number = Math.round(bx + gx * halfW);
            const bry: number = Math.round(by + gy * halfW);
            const wlx: number = Math.round(bx + ux * waist - gx * waistW);
            const wly: number = Math.round(by + uy * waist - gy * waistW);
            const wrx: number = Math.round(bx + ux * waist + gx * waistW);
            const wry: number = Math.round(by + uy * waist + gy * waistW);
            const tx: number = Math.round(bx + ux * l + gx * lean);
            const ty: number = Math.round(by + uy * l + gy * lean);

            emit(blx, brx, wrx, bly, bry, wry, settings.rgb, 0);   // the base quad, in two halves
            emit(blx, wrx, wlx, bly, wry, wly, settings.rgb, 0);
            emit(wlx, wrx, tx, wly, wry, ty, settings.rgb, 0);     // the tapered, leaning tip
        }
    }
}

/** How many quads one ripple is built from along a border. The undulation is 2 cycles per
 *  border, so this is ~7 samples per cycle — coarse enough to stay cheap, fine enough that a
 *  crest does not read as a polyline (at 8 it visibly did: 8px straight runs at game zoom).
 *  Fewer quads when the train holds more ripples, so the triangle budget stays bounded
 *  (worst case 8 ripples x 10 quads x 4 triangles = 320 per border, and one border's worth is
 *  drawn per tile turn). */
export function trueTilePlusWaveSegments(count: number): number {
    return count <= 4 ? 14 : count <= 6 ? 12 : 10;
}

/** A ripple's life, as a multiplier: 0 on the border, up fast, then a long decay to 0 at
 *  the reach. It is the ONE envelope the crest's thickness, the swell's length and alpha
 *  and the undulation's amplitude all scale by, so a ripple is born thin on the border,
 *  swells, and dissolves at the end of its travel. Range (0, 1] inside (0,1), exactly 0 at
 *  both ends — nothing pops in or out. */
export function trueTilePlusWaveEnv(u: number): number {
    if (!(u > 0) || u >= 1) {
        return 0;
    }
    return Math.sin(Math.PI * Math.pow(u, 0.7));
}

/** Draw the Wave effect: a train of `settings.count` ripples sweeping outward from the tile,
 *  each one a solid crest with a translucent swell trailing behind it (toward the tile), all
 *  lying in the ground plane. The four borders' bands are ONE ring: a band runs corner to
 *  corner, and the ring's corners are closed by the MITERS — the stub of band that reaches
 *  past a border's end, which the caller draws on the tile that owns that corner.
 *
 *  Arguments are the flames' own (`px`/`py` the projected corners, `ox`/`oy` the projected
 *  outward probes), plus:
 *   - `mask`: the borders whose BAND lies over the tile being drawn, one bit per border,
 *     exactly as the flames use it, and
 *   - `corner`: the corner whose MITERS lie over it (-1 for none).
 *  A tile is one or the other: an orthogonal neighbour owns a border's band, a diagonal
 *  neighbour owns the two miters that meet at the corner they share. Splitting it that way is
 *  what makes the ring order-proof — every pixel is drawn exactly once, on the tile whose
 *  ground is already down and which no later tile overlaps. A band that reached into the
 *  diagonal tile from the orthogonal one could not be trusted instead: renderAll reaches a
 *  tile's neighbours in an order that changes with where the camera is, so "who covers whom"
 *  cannot be assumed (measured: with the true tile left-and-backward of the camera, the
 *  diagonal neighbour is drawn LAST, and it wipes what the two orthogonal ones put there).
 *
 *  THE TRAIN: ripple b sits at radius `frac(t * TRUE_TILE_PLUS_WAVE_TRAVEL_RATE + b / count)
 *  * wavelength`, so the train marches outward in step and every ripple is born on the border
 *  and dies at the reach. The wavelength is the reach ITSELF with a floor
 *  (TRUE_TILE_PLUS_WAVE_MIN_GAP, itself capped at half the reach): a short reach then shows
 *  fewer ripples — the rest are still inside the tile and are culled — instead of packing
 *  every ripple into a sliver where none of them could be seen. The spacing is EXACT (no
 *  per-ripple rate, no wandering slot): a bunched train can leave the tile with no ripple at
 *  all, and the variety is bought instead from properties that cannot collide — the undulation
 *  phase, each ripple's waviness and its crest weight. The seeds are keyed on the RIPPLE only
 *  (edge 0), because the four borders are one ring and a ripple must be at the same radius on
 *  all four sides.
 *
 *  THE UNDULATION: the crest's radius is pushed in and out by a sine whose phase is a function
 *  of the PERIMETER — p = (border + a) / 4, sampled per quad end — never of the border alone,
 *  so border i's a=1 end and border (i+1)'s a=0 end (the same corner) agree exactly and the
 *  ripple wraps the square continuously instead of breaking into four straight sides. The crest
 *  is thicker where the undulation pushes it out, so the wave has shoulders.
 *
 *  THE MITER: the ring's corner is the ripple's radius OUT and the same distance ALONG, so the
 *  miter is exactly that long. Its radii come from the CORNER's own perimeter position, so the
 *  two borders' ripples arrive there at the same radius and the joint has no step; in between
 *  it keeps undulating, decaying to the corner's value, so a long reach gets a wavy corner
 *  rather than a dead-straight L. It is a picture-frame joint in three quads.
 *
 *  THE FADE: the crest fades as it travels, exactly like the swell — a ripple is solid when it
 *  is born on the border and a ghost by the time it reaches the end of its travel. That is
 *  what stops a growing ring from reading as a scaled outline, and it is the same mechanism
 *  the swell uses (Pix3D.trans), so it blends in the software raster and the gpu pass alike.
 *
 *  At most 8 ripples x 14 quads x 4 triangles = 448 triangles per border band (320 in the
 *  worst case, at the denser counts), ~100 per corner tile, and nothing at all when the mod is
 *  off or the effect is not 'wave'. */
export function trueTilePlusWave(
    emit: TrueTilePlusEmit,
    px: number[], py: number[],
    ox: number[], oy: number[],
    settings: TrueTilePlusSettings,
    phase: number,
    mask: number = TRUE_TILE_PLUS_EDGE_ALL,
    corner: number = -1
): void {
    // A quad seen exactly edge-on (or a collapsed projection) has no area to put a ripple on,
    // and no meaningful outward direction either — the same test the flames make.
    if ((px[1] - px[0]) * (py[3] - py[0]) - (px[3] - px[0]) * (py[1] - py[0]) === 0) {
        return;
    }

    const count: number = settings.count;
    const reachUnits: number = (settings.reach * TRUE_TILE_PLUS_TILE_UNITS) / 100;
    const t: number = phase * settings.speed;   // the one place the speed slider acts
    const segs: number = trueTilePlusWaveSegments(count);
    const rgb: number = settings.rgb;

    // A collapsed triangle is a silent no-op, and a ripple's thin ends CAN collapse (its
    // thickness is a share of the envelope, and the envelope reaches zero on the border).
    // Dropping them here is what keeps the "no degenerate triangle" contract the flames
    // already hold to, whatever the zoom and whatever the settings.
    const tri = (xA: number, yA: number, xB: number, yB: number, xC: number, yC: number, trans: number): void => {
        if ((xB - xA) * (yC - yA) - (xC - xA) * (yB - yA) === 0) {
            return;
        }
        emit(xA, xB, xC, yA, yB, yC, rgb, trans);
    };

    for (let i: number = 0; i < 4; i++) {
        // Which piece of THIS border's band lies over the tile being drawn? A band over its own
        // footprint (an orthogonal neighbour), or a miter at one of its ends (a diagonal
        // neighbour, which owns the corner the two miters there meet at).
        const whole: boolean = (mask & (1 << i)) !== 0;
        const miterEnd: boolean = corner === ((i + 1) & 3);
        const miterStart: boolean = corner === i;
        if (!whole && !miterEnd && !miterStart) {
            continue;
        }

        const j: number = (i + 1) & 3;

        const ex: number = px[j] - px[i];
        const ey: number = py[j] - py[i];
        const len: number = Math.sqrt(ex * ex + ey * ey);
        if (!(len >= TRUE_TILE_PLUS_MIN_EDGE)) {
            continue;   // too small on screen to hang a ripple off
        }

        const mx: number = (px[i] + px[j]) * 0.5;
        const my: number = (py[i] + py[j]) * 0.5;
        let ux: number = ox[i] - mx;
        let uy: number = oy[i] - my;
        const ulen: number = Math.sqrt(ux * ux + uy * uy);
        if (!(ulen > 0.5)) {
            continue;   // a collapsed probe: no outward direction to speak of
        }
        ux /= ulen;
        uy /= ulen;

        const scale: number = ulen / TRUE_TILE_PLUS_OUTER_UNITS;   // px per world unit here

        // How far a ripple travels, in px. Capped at the border's own screen length: the
        // ripples lie over the tile next door, so a stretched outward scale (a grazing camera)
        // must not push them past it. Under a pixel there is no room for a ripple.
        let travel: number = reachUnits * scale;
        if (travel > len) {
            travel = len;
        }
        if (!(travel >= 1)) {
            continue;
        }

        // The floor is itself capped at half the travel, so the reach always holds a ripple or
        // two however short it is.
        const floorGap: number = travel * 0.5 < TRUE_TILE_PLUS_WAVE_MIN_GAP
            ? travel * 0.5
            : TRUE_TILE_PLUS_WAVE_MIN_GAP;
        const period: number = travel > count * floorGap ? travel : count * floorGap;
        const gap: number = period / count;

        let crest: number = gap * TRUE_TILE_PLUS_WAVE_CREST;
        if (crest < 1) {
            crest = 1;
        } else if (crest > TRUE_TILE_PLUS_WAVE_MAX_CREST) {
            crest = TRUE_TILE_PLUS_WAVE_MAX_CREST;
        }
        let swell: number = gap * TRUE_TILE_PLUS_WAVE_SWELL;
        if (swell < 1) {
            swell = 1;
        } else if (swell > TRUE_TILE_PLUS_WAVE_MAX_SWELL) {
            swell = TRUE_TILE_PLUS_WAVE_MAX_SWELL;
        }
        let amp: number = gap * TRUE_TILE_PLUS_WAVE_AMP;
        if (amp < 1) {
            amp = 1;
        } else if (amp > TRUE_TILE_PLUS_WAVE_MAX_AMP) {
            amp = TRUE_TILE_PLUS_WAVE_MAX_AMP;
        }

        // The undulation's phase per unit of `border + a`: a full RIPPLES cycles per side, so
        // it is continuous at every corner (see the header).
        const rippleK: number = Math.PI * 2 * TRUE_TILE_PLUS_WAVE_RIPPLES;

        // A world unit of outward reach is also a world unit ALONG the border, and a border is
        // TRUE_TILE_PLUS_TILE_UNITS of them long — so this turns a px radius (measured with the
        // outward scale) into the along-fraction a miter is measured in.
        const alongPerRadius: number = 1 / (scale * TRUE_TILE_PLUS_TILE_UNITS);

        // One ripple's band over the along-range [aFrom, aTo], `n` quads deep. `a` counts in
        // border lengths: 0 = this border's start corner, 1 = its end corner, beyond = past it.
        const band = (aFrom: number, aTo: number, n: number, r: number, bandPhase: number, ampNow: number, crestHalf: number, swellLen: number, swellTrans: number, crestTrans: number): void => {
            for (let s: number = 0; s < n; s++) {
                const a0: number = aFrom + ((aTo - aFrom) * s) / n;
                const a1: number = aFrom + ((aTo - aFrom) * (s + 1)) / n;

                const w0: number = Math.sin((i + a0) * rippleK + bandPhase);
                const w1: number = Math.sin((i + a1) * rippleK + bandPhase);

                // The centreline is clamped to the reach: the undulation must not wobble the
                // ripple past the distance the reach slider promises. It costs nothing — the
                // envelope has already faded a ripple to nothing by the time it gets there.
                let c0: number = r + w0 * ampNow;
                let c1: number = r + w1 * ampNow;
                if (c0 > travel) {
                    c0 = travel;
                }
                if (c1 > travel) {
                    c1 = travel;
                }

                const h0: number = crestHalf * (0.62 + 0.38 * (w0 * 0.5 + 0.5));
                const h1: number = crestHalf * (0.62 + 0.38 * (w1 * 0.5 + 0.5));

                // Radii never go negative. The true tile is a DIFFERENT tile, drawn on its own
                // turn, so anything that spilled inward onto it could be painted over by that
                // tile's own ground — the other half of the reason the mask exists.
                let in0: number = c0 - h0;
                let out0: number = c0 + h0;
                let in1: number = c1 - h1;
                let out1: number = c1 + h1;
                if (in0 < 0) {
                    in0 = 0;
                }
                if (out0 < 0) {
                    out0 = 0;
                }
                if (in1 < 0) {
                    in1 = 0;
                }
                if (out1 < 0) {
                    out1 = 0;
                }
                let sw0: number = in0 - swellLen;
                let sw1: number = in1 - swellLen;
                if (sw0 < 0) {
                    sw0 = 0;
                }
                if (sw1 < 0) {
                    sw1 = 0;
                }

                const ix0: number = Math.round(px[i] + ex * a0 + ux * in0);
                const iy0: number = Math.round(py[i] + ey * a0 + uy * in0);
                const ix1: number = Math.round(px[i] + ex * a1 + ux * in1);
                const iy1: number = Math.round(py[i] + ey * a1 + uy * in1);
                const ox0: number = Math.round(px[i] + ex * a0 + ux * out0);
                const oy0: number = Math.round(py[i] + ey * a0 + uy * out0);
                const ox1: number = Math.round(px[i] + ex * a1 + ux * out1);
                const oy1: number = Math.round(py[i] + ey * a1 + uy * out1);
                const sx0: number = Math.round(px[i] + ex * a0 + ux * sw0);
                const sy0: number = Math.round(py[i] + ey * a0 + uy * sw0);
                const sx1: number = Math.round(px[i] + ex * a1 + ux * sw1);
                const sy1: number = Math.round(py[i] + ey * a1 + uy * sw1);

                // The swell goes down first, so the crest sits on top of its own tail.
                tri(sx0, sy0, sx1, sy1, ix1, iy1, swellTrans);
                tri(sx0, sy0, ix1, iy1, ix0, iy0, swellTrans);
                tri(ix0, iy0, ix1, iy1, ox1, oy1, crestTrans);
                tri(ix0, iy0, ox1, oy1, ox0, oy0, crestTrans);
            }
        };

        // One miter: the stub of band that closes the ring's corner, drawn on the tile that
        // owns the corner. It starts at the border's own end with the radii the band arrives
        // with, and ends at the ring's corner with the CORNER's radii — the two borders' miters
        // meet there at the same radius, which is what closes the joint. In between it keeps
        // undulating (decaying to the corner's value), so the corner is a wave rather than a
        // straight bar: at a long reach a constant-radius miter is a dead-straight 40px L.
        const miter = (aNear: number, dir: number, rIn: number, eIn: number, rOut: number, eOut: number, wc: number, ampNow: number, bandPhase: number, trans: number): void => {
            for (let s: number = 0; s < TRUE_TILE_PLUS_WAVE_MITER_SEGMENTS; s++) {
                const t0: number = s / TRUE_TILE_PLUS_WAVE_MITER_SEGMENTS;
                const t1: number = (s + 1) / TRUE_TILE_PLUS_WAVE_MITER_SEGMENTS;
                const aI0: number = aNear + dir * eIn * t0;
                const aI1: number = aNear + dir * eIn * t1;
                const aO0: number = aNear + dir * eOut * t0;
                const aO1: number = aNear + dir * eOut * t1;

                let in0: number = rIn + (Math.sin((i + aI0) * rippleK + bandPhase) - wc) * ampNow * (1 - t0);
                let in1: number = rIn + (Math.sin((i + aI1) * rippleK + bandPhase) - wc) * ampNow * (1 - t1);
                let out0: number = rOut + (Math.sin((i + aO0) * rippleK + bandPhase) - wc) * ampNow * (1 - t0);
                let out1: number = rOut + (Math.sin((i + aO1) * rippleK + bandPhase) - wc) * ampNow * (1 - t1);
                if (in0 < 0) {
                    in0 = 0;
                }
                if (in1 < 0) {
                    in1 = 0;
                }
                if (out0 < 0) {
                    out0 = 0;
                }
                if (out1 < 0) {
                    out1 = 0;
                }

                const ix0: number = Math.round(px[i] + ex * aI0 + ux * in0);
                const iy0: number = Math.round(py[i] + ey * aI0 + uy * in0);
                const ix1: number = Math.round(px[i] + ex * aI1 + ux * in1);
                const iy1: number = Math.round(py[i] + ey * aI1 + uy * in1);
                const ox0: number = Math.round(px[i] + ex * aO0 + ux * out0);
                const oy0: number = Math.round(py[i] + ey * aO0 + uy * out0);
                const ox1: number = Math.round(px[i] + ex * aO1 + ux * out1);
                const oy1: number = Math.round(py[i] + ey * aO1 + uy * out1);

                tri(ix0, iy0, ix1, iy1, ox1, oy1, trans);
                tri(ix0, iy0, ox1, oy1, ox0, oy0, trans);
            }
        };

        for (let b: number = 0; b < count; b++) {
            // One seed pair per RIPPLE, never per (border, ripple): the four borders are one
            // ring, so a ripple has to be at the same radius on all four sides.
            const s1: number = trueTilePlusSeed(0, b, 2);
            const s2: number = trueTilePlusSeed(0, b, 3);

            // Each ripple's own character — some are wavier, some bolder — but NOT its own
            // travel rate or a wandering slot: the spacing has to stay EXACT, or the train can
            // bunch and leave the tile with no ripple at all (measured: a jittered train did
            // exactly that). So the individuality lives in properties that cannot collide.
            const ampF: number = 0.75 + 0.50 * s1;     // 0.75 .. 1.25: how wavy this ripple is
            const crestF: number = 0.85 + 0.30 * s2;   // 0.85 .. 1.15: how bold its crest is
            const at: number = ttpFraction(t * TRUE_TILE_PLUS_WAVE_TRAVEL_RATE + b / count);
            const r: number = at * period;        // px out from the border
            const ur: number = r / travel;        // ... as a share of the reach
            if (!(ur < 1)) {
                continue;   // still inside the tile (the wavelength can exceed the reach), or past the reach
            }

            const env: number = trueTilePlusWaveEnv(ur);
            if (!(env >= TRUE_TILE_PLUS_WAVE_MIN_ENV)) {
                continue;
            }

            const bandPhase: number = t * TRUE_TILE_PLUS_WAVE_RIPPLE_RATE + b * TRUE_TILE_PLUS_WAVE_BAND_PHASE;
            const ampNow: number = amp * ampF * env;
            let crestHalf: number = crest * crestF * env * 0.5;
            if (crestHalf < TRUE_TILE_PLUS_WAVE_MIN_PX) {
                crestHalf = TRUE_TILE_PLUS_WAVE_MIN_PX;
            }
            let swellLen: number = swell * env;
            if (swellLen < TRUE_TILE_PLUS_WAVE_MIN_PX) {
                swellLen = TRUE_TILE_PLUS_WAVE_MIN_PX;
            }
            const swellTrans: number = 256 - Math.round(TRUE_TILE_PLUS_WAVE_ALPHA * env);
            const crestTrans: number = 256 - Math.round(TRUE_TILE_PLUS_WAVE_CREST_ALPHA * env);

            if (whole) {
                band(0, 1, segs, r, bandPhase, ampNow, crestHalf, swellLen, swellTrans, crestTrans);
            }

            if (miterEnd || miterStart) {
                // The corner's own radius and thickness: the same numbers the band arrives with
                // at that end, which is what closes the joint.
                const wc: number = Math.sin((miterEnd ? i + 1 : i) * rippleK + bandPhase);
                let rc: number = r + wc * ampNow;
                if (rc > travel) {
                    rc = travel;
                }
                const hc: number = crestHalf * (0.62 + 0.38 * (wc * 0.5 + 0.5));

                let eIn: number = (rc - hc) * alongPerRadius;
                let eOut: number = (rc + hc) * alongPerRadius;
                let eSwell: number = (rc - hc - swellLen) * alongPerRadius;
                if (eIn < 0) {
                    eIn = 0;
                }
                if (eOut < 0) {
                    eOut = 0;
                }
                if (eSwell < 0) {
                    eSwell = 0;
                }

                const dir: number = miterEnd ? 1 : -1;
                const aNear: number = miterEnd ? 1 : 0;
                miter(aNear, dir, rc - hc, eIn, rc + hc, eOut, wc, ampNow, bandPhase, crestTrans);
                // The swell's stub stops at ITS OWN corner (eSwell on both boundaries): run it
                // to the crest's corner instead and the two miters of a corner overlap in an
                // S-by-S square, which double-blends into a dark blotch on every corner.
                miter(aNear, dir, rc - hc - swellLen, eSwell, rc - hc, eSwell, wc, ampNow, bandPhase, swellTrans);
            }
        }
    }
}

/** Dispatch to the armed effect. Adding an effect later is one branch here plus its
 *  geometry function and its option in the panel's select row — the World-side hook and
 *  the settings table never change. */
export function trueTilePlusEffect(
    emit: TrueTilePlusEmit,
    px: number[], py: number[],
    ox: number[], oy: number[],
    settings: TrueTilePlusSettings,
    phase: number,
    mask: number = TRUE_TILE_PLUS_EDGE_ALL,
    corner: number = -1
): void {
    if (!settings.enabled) {
        return;
    }

    if (settings.effect === TRUE_TILE_PLUS_EFFECT_FLAMES) {
        trueTilePlusFlames(emit, px, py, ox, oy, settings, phase, mask);
    } else if (settings.effect === TRUE_TILE_PLUS_EFFECT_WAVE) {
        trueTilePlusWave(emit, px, py, ox, oy, settings, phase, mask, corner);
    }
}
