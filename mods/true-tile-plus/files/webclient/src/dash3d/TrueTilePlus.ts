// lclite:true-tile-plus — the True tile+ mod's pure core: the settings parse and the
// ground-effect geometry. Nothing here touches the client (no Pix2D, no Pix3D, no World),
// so mods/true-tile-plus/tools/true_tile_plus_test.ts runs the REAL shipped logic
// headlessly.
//
// WHAT THIS IS: effects that ride the TRUE TILE — the tile the SERVER has the player on
// (the head of the local move queue), the same tile mods/true-tile outlines. The first
// effect is FLAMES: flat tongues licking outward off the tile's four borders, lying on the
// ground plane. It is deliberately standalone: this mod reads its OWN keys (rule 5) and
// works with true-tile on or off — it frames whatever square is (or is not) there.
//
// WHY THE GEOMETRY IS SHAPED THIS WAY
//
// 1. The flames are GROUND GEOMETRY, drawn on the true tile's own turn in the scene fill
//    order (World.trueTilePlusDraw, called from fill()), exactly like true-tile's square:
//    that tile's ground goes down, then the flames, then its walls and sprites — so the
//    player's own model covers them and nearer ground, walls and NPCs occlude them. That
//    is what makes them read as ON the floor rather than pasted over the scene.
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

/** What the effects need per frame. Read from this mod's OWN localStorage keys (rule 5) at
 *  its own hook site (World.trueTilePlusDraw) — never another mod's key, and never through
 *  a settings hub. */
export interface TrueTilePlusSettings {
    enabled: boolean;
    effect: number;
    rgb: number;
}

/** The effect ids. INTEGERS, not names: a runtime string must never index a table in
 *  bundled code (the terser property mangler renames object-literal KEYS, so a lookup by a
 *  value that came out of localStorage silently misses). The panel's select row writes the
 *  string; `trueTilePlusSettings` maps it to one of these. */
export const TRUE_TILE_PLUS_EFFECT_NONE: number = 0;
export const TRUE_TILE_PLUS_EFFECT_FLAMES: number = 1;

export const TRUE_TILE_PLUS_DEFAULT_COLOR: string = '#000000';
export const TRUE_TILE_PLUS_DEFAULT_EFFECT: string = 'flames';

/** Flames per tile edge. 3 reads as a ring of fire without turning the border into a
 *  solid wall of it. */
export const TRUE_TILE_PLUS_TONGUES: number = 3;

/** How far a flame reaches, in WORLD units (a tile is 128), so the flames keep their
 *  proportion to the tile as the camera zooms instead of growing with the screen. */
export const TRUE_TILE_PLUS_LENGTH_UNITS: number = 34;

/** The outward probe's world offset: half a tile out from an edge's midpoint. The payload
 *  divides the probe's screen length by this to get px-per-world-unit for that edge, so the
 *  World-side hook and this file must agree on it — hence it is exported. */
export const TRUE_TILE_PLUS_OUTER_UNITS: number = 64;

/** Below this many screen px an edge is not worth hanging fire off (a distant or edge-on
 *  tile), and a blade is capped so a grazing view cannot throw flames across the screen. */
export const TRUE_TILE_PLUS_MIN_EDGE: number = 4;
export const TRUE_TILE_PLUS_MAX_LENGTH: number = 48;

/** The root is tucked this far INSIDE the border, so a flame grows out of the tile's edge
 *  rather than floating beside it. */
export const TRUE_TILE_PLUS_ROOT_INSET: number = 1;

/** The client's reader for this mod's OWN keys. It lives here so the "own keys, read per
 *  frame at my own hook" contract (rule 5) has exactly one definition; the harness passes
 *  its own stub instead. */
export function trueTilePlusRead(key: string): string | null {
    return localStorage.getItem(key);
}

/** Read and validate this mod's settings. `read` is localStorage.getItem in the client and
 *  a stub in the harness. Everything is clamped HERE rather than at the call site, so a
 *  stale, hand-typed or half-written key can never paint garbage: the colour must be a
 *  7-char '#rrggbb', and the effect only turns off on the literal 'none'. The master key
 *  defaults ON ('false' is the only value that disables), because the effect IS the mod. */
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

    return { enabled, effect, rgb };
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

/** A deterministic [0,1) value per (edge, tongue): the flames must look hand-scattered but
 *  replay identically for the same phase, so the harness can assert a whole frame. 32-bit
 *  integer mixing (Math.imul) rather than Math.random. */
export function trueTilePlusSeed(edge: number, tongue: number): number {
    let h: number = Math.imul(edge + 1, 0x9e3779b1) ^ Math.imul(tongue + 1, 0x85ebca6b);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
}

/** How tall a tongue is right now, as a multiplier on its full reach. Two out-of-phase
 *  sines per tongue (seeded, so neighbours never pulse together) give the uneven lick of
 *  fire without a table; the range is [0.60, 1.30] by construction. */
export function trueTilePlusFlicker(phase: number, seed: number): number {
    return 0.95 + 0.22 * Math.sin(phase * 6.1 + seed * 6.283) + 0.13 * Math.sin(phase * 11.3 + seed * 12.7);
}

/** Draw the Flames effect: `TRUE_TILE_PLUS_TONGUES` blades on each of the tile's four
 *  edges, rooted on the border and reaching outward along that edge's own projected
 *  direction, all lying in the ground plane.
 *
 *  `px`/`py` are the four projected tile corners (any order — the corners are used in
 *  pairs, so an arbitrary camera yaw is fine) and `ox`/`oy` the four projected outward
 *  probes, index i belonging to the edge i → (i+1) & 3.
 *
 *  At most 12 blades = 36 triangles, and nothing at all when the mod is off (the master
 *  key is read before any geometry is built). */
export function trueTilePlusFlames(
    emit: TrueTilePlusEmit,
    px: number[], py: number[],
    ox: number[], oy: number[],
    rgb: number,
    phase: number
): void {
    // A quad seen exactly edge-on (or a collapsed projection) has no area to put a flame
    // on, and no meaningful outward direction either — the same test the tile decal uses.
    if ((px[1] - px[0]) * (py[3] - py[0]) - (px[3] - px[0]) * (py[1] - py[0]) === 0) {
        return;
    }

    for (let i: number = 0; i < 4; i++) {
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
        let reach: number = TRUE_TILE_PLUS_LENGTH_UNITS * scale;
        if (reach > TRUE_TILE_PLUS_MAX_LENGTH) {
            reach = TRUE_TILE_PLUS_MAX_LENGTH;
        } else if (reach < 2) {
            reach = 2;
        }

        const gx: number = ex / len;   // along the edge: the base's width and the lean
        const gy: number = ey / len;
        const spacing: number = len / TRUE_TILE_PLUS_TONGUES;
        let halfW: number = spacing * 0.3;
        if (halfW < 0.8) {
            halfW = 0.8;
        } else if (halfW > 9) {
            halfW = 9;
        }

        for (let k: number = 0; k < TRUE_TILE_PLUS_TONGUES; k++) {
            const seed: number = trueTilePlusSeed(i, k);
            // Evenly spaced along the edge, nudged by the tongue's own seed so the row
            // never looks printed — but never far enough to crowd its neighbour.
            const t: number = (k + 0.5) / TRUE_TILE_PLUS_TONGUES + (seed - 0.5) * (0.5 / TRUE_TILE_PLUS_TONGUES);

            // The root sits ON the border, a hair inside it, so the flame grows out of the
            // tile's edge instead of floating beside it.
            const bx: number = px[i] + ex * t - ux * TRUE_TILE_PLUS_ROOT_INSET;
            const by: number = py[i] + ey * t - uy * TRUE_TILE_PLUS_ROOT_INSET;

            const l: number = reach * trueTilePlusFlicker(phase, seed);
            const lean: number = Math.sin(phase * 3.3 + seed * 9.4) * l * 0.45;
            const waist: number = l * 0.45;
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

            emit(blx, brx, wrx, bly, bry, wry, rgb, 0);   // the base quad, in two halves
            emit(blx, wrx, wlx, bly, wry, wly, rgb, 0);
            emit(wlx, wrx, tx, wly, wry, ty, rgb, 0);     // the tapered, leaning tip
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
    phase: number
): void {
    if (!settings.enabled) {
        return;
    }

    if (settings.effect === TRUE_TILE_PLUS_EFFECT_FLAMES) {
        trueTilePlusFlames(emit, px, py, ox, oy, settings.rgb, phase);
    }
}
