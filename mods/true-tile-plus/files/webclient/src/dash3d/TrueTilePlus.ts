// lclite:true-tile-plus — the True tile+ mod's pure core: the settings parse and the
// ground-effect geometry. Nothing here touches the client (no Pix2D, no Pix3D, no World),
// so mods/true-tile-plus/tools/true_tile_plus_test.ts runs the REAL shipped logic
// headlessly, and tools/true_tile_plus_preview.ts can rasterize it for eyeballing.
//
// WHAT THIS IS: effects that ride the TRUE TILE — the tile the SERVER has the player on
// (the head of the local move queue), the same tile mods/true-tile outlines. The first
// effect is FLAMES: flat tongues licking outward off the tile's four borders, lying on the
// ground plane. It is deliberately standalone: this mod reads its OWN keys (rule 5) and
// works with true-tile on or off — it frames whatever square is (or is not) there.
//
// WHY THE GEOMETRY IS SHAPED THIS WAY
//
// 1. The flames are GROUND GEOMETRY, drawn on the turn of the tile each blade LIES OVER
//    (World.trueTilePlusDraw, called from fill()) — so a blade goes down right after the
//    ground under it and before that tile's walls and sprites. That is what makes the
//    flames read as ON the floor rather than pasted over the scene.
//
//    WHY PER-NEIGHBOUR, NOT PER-TILE: the blades are rooted on the true tile's border and
//    reach OUTWARD, so each one lies over the tile NEXT DOOR. The scene is drawn
//    front-to-back outward from the camera's own tile (World.renderAll walks out from
//    World.gx/gz), so a neighbouring tile drawn after the true tile paints its ground
//    straight over any blade that reached into it. A first version drew everything on the
//    true tile's own turn and only ever showed 2-3 of the 4 edges — and WHICH edges
//    survived changed with the camera angle, because the walk is axis-aligned around the
//    camera's tile rather than a true radial sort. Drawing each edge's blades when the tile
//    they lie over is drawn is order-proof: that tile's ground is already down (so it
//    cannot cover the blade), its walls and sprites still come after it (so they can, and
//    correctly, cover the blade), and no later tile overlaps the ground the blade sits on.
//    The caller says which edges to draw with `mask`, one bit per edge.
//
// 2. Everything is computed from the tile's four PROJECTED corners plus one projected
//    OUTWARD PROBE per edge (that edge's world midpoint pushed out by
//    TRUE_TILE_PLUS_OUTER_UNITS, riding the tile's own plane). The probes are what make
//    the effect camera-proof: they hand each edge its real screen-space outward direction
//    and its own px-per-world-unit scale, so a flame stays glued to its own border, points
//    the right way and grows/shrinks with zoom — instead of being a fixed-pixel spike that
//    swings off the tile as the camera turns or zooms.
//
// 3. The probes ride the TILE'S OWN PLANE (the mean of that edge's two corner heights)
//    rather than sampling the ground beyond the tile: a flat decal that follows the tile
//    it frames can never slide down a cliff face or bury itself in a slope it does not own.
//
// 4. A flame is a THREE-TRIANGLE BLADE: a base quad that tapers to a waist, then a point
//    that leans along the edge as it flickers. One triangle would read as a spike; the
//    waist and the lean are what make it read as fire at this size. Everything is emitted
//    as integers (the rasterizer works in integer pixels) and everything is a pure function
//    of `phase`, so the harness can replay any frame exactly.
//
// 5. NO TWO FLAMES ARE ALIKE, and none of them stands still: each tongue gets its own
//    seeded size, width, waist and lean, its own place along the edge (with a slow drift,
//    so the row wanders instead of sitting pinned to its slots), its own flicker (three
//    harmonics) and its own flare envelope (a tongue surges, then dies back, on a beat of
//    its own). That is what keeps a ring of fire from reading as a printed border.

/** What the effects need per frame. Read from this mod's OWN localStorage keys (rule 5) at
 *  its own hook site (World.trueTilePlusDraw) — never another mod's key, and never through
 *  a settings hub. */
export interface TrueTilePlusSettings {
    enabled: boolean;
    effect: number;
    rgb: number;
    count: number;   // flames per tile edge
    reach: number;   // how far a flame reaches, as a % of a tile side
    speed: number;   // flicker speed multiplier (0 = frozen)
}

/** The effect ids. INTEGERS, not names: a runtime string must never index a table in
 *  bundled code (the terser property mangler renames object-literal KEYS, so a lookup by a
 *  value that came out of localStorage silently misses). The panel's select row writes the
 *  string; `trueTilePlusSettings` maps it to one of these. */
export const TRUE_TILE_PLUS_EFFECT_NONE: number = 0;
export const TRUE_TILE_PLUS_EFFECT_FLAMES: number = 1;

/** One bit per tile edge, in the corner order the caller projects them (edge i runs from
 *  corner i to corner (i + 1) & 3): 0 = the -z side, 1 = +x, 2 = +z, 3 = -x. The caller
 *  draws the edge whose blades lie over the tile it is currently drawing. */
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

/** A tile is 128 world units: the reach key is a percentage of that, so the flames keep
 *  their proportion to the tile as the camera zooms instead of growing with the screen. */
export const TRUE_TILE_PLUS_TILE_UNITS: number = 128;

/** Slider ranges, enforced HERE (not at the call site) so a stale or hand-typed key cannot
 *  paint garbage. The reach cap keeps a blade on the tile it reaches over: at 75 % of a
 *  tile it still lands well short of that tile's far edge. */
export const TRUE_TILE_PLUS_MAX_COUNT: number = 8;
export const TRUE_TILE_PLUS_MAX_REACH: number = 75;
export const TRUE_TILE_PLUS_MAX_SPEED: number = 3;

/** The outward probe's world offset: half a tile out from an edge's midpoint. The payload
 *  divides the probe's screen length by this to get px-per-world-unit for that edge, so the
 *  World-side hook and this file must agree on it — hence it is exported. */
export const TRUE_TILE_PLUS_OUTER_UNITS: number = 64;

/** Below this many screen px an edge is not worth hanging fire off (a distant or edge-on
 *  tile), and a blade's final length is capped so a grazing view or a flare cannot throw
 *  flames across the screen. */
export const TRUE_TILE_PLUS_MIN_EDGE: number = 4;
export const TRUE_TILE_PLUS_MAX_LENGTH: number = 80;

/** The root is tucked this far INSIDE the border, so a flame grows out of the tile's edge
 *  rather than floating beside it. */
export const TRUE_TILE_PLUS_ROOT_INSET: number = 1;

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

/** Read and validate this mod's settings. `read` is localStorage.getItem in the client and
 *  a stub in the harness. Everything is clamped HERE rather than at the call site, so a
 *  stale, hand-typed or half-written key can never paint garbage: the colour must be a
 *  7-char '#rrggbb', the count 1..8, the reach 4..75 % of a tile, the speed 0..3×, and the
 *  effect only turns off on the literal 'none'. The master key defaults ON ('false' is the
 *  only value that disables), because the effect IS the mod. */
export function trueTilePlusSettings(read: (key: string) => string | null): TrueTilePlusSettings {
    const enabled: boolean = read('trueTilePlus') !== 'false';

    // An unset or junk effect key means FLAMES, not "nothing": the mod exists to draw
    // something, and a select row that has never been touched has no stored value.
    const effect: number = read('trueTilePlusEffect') === 'none'
        ? TRUE_TILE_PLUS_EFFECT_NONE
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
 *  what lets the harness run this geometry with no engine at all. */
export type TrueTilePlusEmit = (
    xA: number, xB: number, xC: number,
    yA: number, yB: number, yC: number,
    colour: number, trans: number
) => void;

/** A deterministic [0,1) value per (edge, tongue, salt): the flames must look
 *  hand-scattered but replay identically for the same phase, so the harness can assert a
 *  whole frame. 32-bit integer mixing (Math.imul) rather than Math.random — two salts per
 *  tongue give it two independent streams (see trueTilePlusFlames). */
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

/** Dispatch to the armed effect. Adding an effect later is one branch here plus its
 *  geometry function and its option in the panel's select row — the World-side hook and
 *  the settings table never change. */
export function trueTilePlusEffect(
    emit: TrueTilePlusEmit,
    px: number[], py: number[],
    ox: number[], oy: number[],
    settings: TrueTilePlusSettings,
    phase: number,
    mask: number = TRUE_TILE_PLUS_EDGE_ALL
): void {
    if (!settings.enabled) {
        return;
    }

    if (settings.effect === TRUE_TILE_PLUS_EFFECT_FLAMES) {
        trueTilePlusFlames(emit, px, py, ox, oy, settings, phase, mask);
    }
}
