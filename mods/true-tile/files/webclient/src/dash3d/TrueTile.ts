// lclite:true-tile — the True tile mod's pure core: the settings parse for its three
// markers and the projected-quad decal geometry all three share. Nothing here touches
// the client (no Pix2D, no Pix3D, no World), so mods/true-tile/tools/true_tile_test.ts
// runs the REAL logic headlessly and can diff the emitted triangles against the
// per-pixel rasterizer this mod shipped before it moved onto the scene's own triangle
// path.
//
// THE THREE MARKERS — RuneLite's Tile Indicators, one section of the mod's panel view
// each, and each with its OWN localStorage keys and its own enable switch (rule 5):
//
//   trueTile*   the tile the SERVER has the player on (routeX/routeZ[0], the head of
//               the local move queue). Drawn by World.fill() as ground geometry on that
//               tile's own turn, so everything drawn after it covers it — the player's
//               model above all (RuneLite's true tile reads the same way: the square is
//               on the floor UNDER the character).
//   hoverTile*  the tile the mouse is over, resolved by the ENGINE'S OWN ground pick
//               (the World.click machinery a walk click uses), drawn OVER the scene
//               after renderAll — a cursor highlight, deliberately not occluded.
//   destTile*   the tile the player is walking to, which the engine already tracks as
//               its own destination flag (Client.minimapFlagX/Z, the tile the minimap
//               draws its flag on). Drawn like the true tile, and dropped the moment the
//               true tile is on it.
//
// The mod's row switch (`trueTile`) gates all three; a marker's own key turns just that
// marker off, so the hovered tile and the destination tile can each be silenced without
// losing the true tile. The hovered and destination keys are the ones their standalone
// mods used, so nobody's settings reset when they moved in here.
//
// WHY TRIANGLES (the 2026-09-18 rework): the decal is drawn as GROUND GEOMETRY on its
// tile's own turn in the scene fill order, so everything the engine draws after it —
// the player's model above all — covers it. That is only possible through Pix3D, and it
// also fixes the fill: `Pix3D.trans` is the destination weight the software raster mixes
// with AND the alpha the gpu mod captures per triangle, so the translucent wash blends
// with the ground in BOTH renderers. The old in-place Pix2D blend could not: on a gpu
// frame the game buffer holds no ground pixels (it is sentinel-cleared and the world is
// drawn on the GPU), so the mix ran against black and the HUD overlay then painted the
// result opaque — the "darker green that lightens as you raise the fill" bug.

/** What the true-tile decal needs per frame. Read from this mod's OWN localStorage keys
 *  (rule 5) at its own hook site (World.trueTileDecal) — never another mod's key, and
 *  never through a settings hub. */
export interface TrueTileSettings {
    enabled: boolean;
    rgb: number;
    thick: number;
    fillA: number;
    onlyDesync: boolean;
}

/** What hoverTileDraw() needs per frame. Read from this mod's OWN keys (rule 5) at its
 *  own hook site (Client.hoverTileDraw). */
export interface HoverTileSettings {
    enabled: boolean;
    rgb: number;
    thick: number;
    fillA: number;
}

/** What the destination decal needs per frame. Read from this mod's OWN keys (rule 5)
 *  at its own hook site (World.destTileDecal). */
export interface DestTileSettings {
    enabled: boolean;
    rgb: number;
    thick: number;
    fillA: number;
}

export const TRUE_TILE_DEFAULT_COLOR: string = '#00ff00';
export const TRUE_TILE_DEFAULT_OUTLINE: number = 1;
export const TRUE_TILE_DEFAULT_FILL: number = 0;
/** Visible, like the other two: RuneLite ships the hovered tile with a fully transparent
 *  border colour, and a marker nobody can see is a marker nobody knows is installed. */
export const HOVER_TILE_DEFAULT_COLOR: string = '#ffffff';
export const HOVER_TILE_DEFAULT_OUTLINE: number = 2;
export const HOVER_TILE_DEFAULT_FILL: number = 20;
/** RuneLite's own destination defaults, translated to this mod's contract: GRAY at 2px
 *  with a light wash (theirs is a black 50-alpha fill; this mod washes the border colour
 *  instead, so the three markers read the same in the panel). */
export const DEST_TILE_DEFAULT_COLOR: string = '#808080';
export const DEST_TILE_DEFAULT_OUTLINE: number = 2;
export const DEST_TILE_DEFAULT_FILL: number = 20;

/** The client's readers for this mod's OWN keys. They live here so the "own keys, read
 *  per frame at my own hook" contract (rule 5) has exactly one definition per marker;
 *  the harness passes its own stub instead. */
export function trueTileRead(key: string): string | null {
    return localStorage.getItem(key);
}

export function hoverTileRead(key: string): string | null {
    return localStorage.getItem(key);
}

export function destTileRead(key: string): string | null {
    return localStorage.getItem(key);
}

/** The shared validation behind the three parsers below: a 7-char '#rrggbb' or the
 *  marker's default, a border of 1..8 px, a fill of 0..100 %. Everything is clamped
 *  HERE rather than at the call site, so a stale, hand-typed or half-written key can
 *  never paint garbage. The keys are passed in FULL rather than assembled from a prefix
 *  on purpose: the shipped bundle keeps string literals verbatim (the terser property
 *  mangler only renames identifiers), so `grep '"hoverTileColor"'` on the deployed
 *  client.js is the prod-side proof that the panel and the engine agree on a key. */
function readLook(read: (key: string) => string | null, keys: { color: string; outline: string; fill: string }, defColor: string, defOutline: number, defFill: number): { rgb: number; thick: number; fillA: number } {
    let rgb: number = parseInt(defColor.substring(1), 16);
    const hex: string | null = read(keys.color);
    if (hex !== null && hex.length === 7 && hex.charCodeAt(0) === 35 /* # */) {
        const parsed: number = parseInt(hex.substring(1), 16);
        if (!isNaN(parsed)) {
            rgb = parsed;
        }
    }

    let thick: number = parseInt(read(keys.outline) ?? String(defOutline), 10);
    if (!(thick >= 1)) {
        thick = 1;   // also catches NaN and every non-positive value
    } else if (thick > 8) {
        thick = 8;
    }

    let fillA: number = parseInt(read(keys.fill) ?? String(defFill), 10);
    if (!(fillA > 0)) {
        fillA = 0;
    } else if (fillA > 100) {
        fillA = 100;
    }

    return { rgb, thick, fillA };
}

/** Read and validate the true tile's settings. The master key defaults ON ('false' is
 *  the only value that disables), and `onlyDesync` is the RuneLite "hidden" behaviour
 *  (draw only while the model tile and the server tile disagree), off by default so the
 *  square is always visible. */
export function trueTileSettings(read: (key: string) => string | null): TrueTileSettings {
    return { enabled: read('trueTile') !== 'false', onlyDesync: read('trueTileOnlyDesync') === 'true', ...readLook(read, { color: 'trueTileColor', outline: 'trueTileOutline', fill: 'trueTileFill' }, TRUE_TILE_DEFAULT_COLOR, TRUE_TILE_DEFAULT_OUTLINE, TRUE_TILE_DEFAULT_FILL) };
}

/** Read and validate the hovered tile's settings. `hoverTile` is this marker's own
 *  switch (it was the standalone mod's master, so it keeps its key). */
export function hoverTileSettings(read: (key: string) => string | null): HoverTileSettings {
    return { enabled: read('hoverTile') !== 'false', ...readLook(read, { color: 'hoverTileColor', outline: 'hoverTileOutline', fill: 'hoverTileFill' }, HOVER_TILE_DEFAULT_COLOR, HOVER_TILE_DEFAULT_OUTLINE, HOVER_TILE_DEFAULT_FILL) };
}

/** Read and validate the destination tile's settings. `destTile` is this marker's own
 *  switch; the marker is on by default, like RuneLite's own "Highlight destination
 *  tile". */
export function destTileSettings(read: (key: string) => string | null): DestTileSettings {
    return { enabled: read('destTile') !== 'false', ...readLook(read, { color: 'destTileColor', outline: 'destTileOutline', fill: 'destTileFill' }, DEST_TILE_DEFAULT_COLOR, DEST_TILE_DEFAULT_OUTLINE, DEST_TILE_DEFAULT_FILL) };
}

/** Emit one screen-space triangle. `trans` is Pix3D's own convention — the DESTINATION
 *  weight of the mix (0 = opaque, 256 = fully transparent) — so the client's binding is
 *  literally "set Pix3D.trans, call Pix3D.flatTriangle". Keeping the renderer injected
 *  is what lets the harness run this geometry with no engine at all. */
export type TileEmit = (
    xA: number, xB: number, xC: number,
    yA: number, yB: number, yC: number,
    colour: number, trans: number
) => void;

/** Draw one projected tile quad as an opaque border ring plus, when `fillA > 0`, a
 *  translucent interior wash. ONE copy of this geometry serves all three markers (the
 *  hovered and destination squares were the standalone hover-tile mod's own copy until
 *  it moved in here).
 *
 *  The quad is the tile's four corners projected to screen space, in ANY order and
 *  orientation (a camera-rotated tile is an arbitrary convex quad). Ten triangles at
 *  most, whatever the skew:
 *
 *  1. the wash, as the whole quad (two triangles) at `trans` = the fill's destination
 *     weight. The ring below is drawn over it, so the visible fill is the inner quad —
 *     drawing it this way needs no inset polygon and can never degenerate;
 *  2. the ring, as four quads spanning one edge each, from the outer corner to the
 *     MITRED inner corner. Adjacent quads share the mitre edge, so the four tile the
 *     ring exactly: no overlap, no seam, and the union is the same pixel set the
 *     per-pixel edge-function rasterizer this mod used to ship painted.
 *
 *  A tile that is thinner on screen than the border is thick has no valid inner quad:
 *  the ring would turn itself inside out, so the whole quad is drawn as border instead
 *  — exactly the pixels the old rasterizer covered there (`s_i < thick * len_i` for
 *  some edge is the entire quad once the border reaches across it). */
export function tileDecal(
    emit: TileEmit,
    px: number[], py: number[],
    rgb: number, thick: number, fillA: number
): void {
    // The quad must enclose an area: a tile seen exactly edge-on (or a collapsed
    // projection) has nothing to draw, and its mitres would be meaningless.
    if ((px[1] - px[0]) * (py[3] - py[0]) - (px[3] - px[0]) * (py[1] - py[0]) === 0) {
        return;
    }

    // Raw edge deltas, kept for the inside test, plus the INWARD unit normal of each
    // edge. Orientation is arbitrary on screen, so each edge is sign-normalized against
    // the centroid (which is always inside) — the same flip the edge-function
    // rasterizer did. The inside test is then
    //     s_i = ex_i * (y - py_i) - ey_i * (x - px_i) >= 0
    // for either winding, and (-ey_i, ex_i) — s_i's own gradient, so pointing at
    // increasing s_i, i.e. inward — is that edge's inward normal.
    const ex: number[] = [0, 0, 0, 0];
    const ey: number[] = [0, 0, 0, 0];
    const nx: number[] = [0, 0, 0, 0];
    const ny: number[] = [0, 0, 0, 0];
    const cxs: number = (px[0] + px[1] + px[2] + px[3]) * 0.25;
    const cys: number = (py[0] + py[1] + py[2] + py[3]) * 0.25;

    for (let i: number = 0; i < 4; i++) {
        const j: number = (i + 1) & 3;
        const rawX: number = px[j] - px[i];
        const rawY: number = py[j] - py[i];

        const len: number = Math.sqrt(rawX * rawX + rawY * rawY);
        if (!(len > 0)) {
            return;   // a collapsed edge: this quad has no area to draw
        }

        const dir: number = rawX * (cys - py[i]) - rawY * (cxs - px[i]) < 0 ? -1 : 1;
        ex[i] = rawX * dir;
        ey[i] = rawY * dir;

        nx[i] = -ey[i] / len;
        ny[i] = ex[i] / len;
    }

    // 1. the translucent wash over the whole quad (the ring covers its border)
    if (fillA > 0) {
        const trans: number = 256 - Math.round((fillA * 256) / 100);
        emit(px[0], px[1], px[2], py[0], py[1], py[2], rgb, trans);
        emit(px[0], px[2], px[3], py[0], py[2], py[3], rgb, trans);
    }

    // 2. the mitred inner corners: corner i is pushed along the bisector of the two
    //    edges that meet there, by exactly `thick` perpendicular to both
    const ix: number[] = [0, 0, 0, 0];
    const iy: number[] = [0, 0, 0, 0];
    let ring: boolean = true;

    for (let i: number = 0; i < 4; i++) {
        const a: number = (i + 3) & 3;   // the edge that ENDS at corner i
        const denom: number = 1 + (nx[a] * nx[i] + ny[a] * ny[i]);

        if (!(denom > 0.001)) {
            ring = false;   // a 180-degree corner: nothing sensible to mitre
            break;
        }

        ix[i] = Math.round(px[i] + ((nx[a] + nx[i]) / denom) * thick);
        iy[i] = Math.round(py[i] + ((ny[a] + ny[i]) / denom) * thick);
    }

    // every inner corner must still be INSIDE the quad, or the border has reached
    // across the tile and the ring would be inside out
    for (let k: number = 0; ring && k < 4; k++) {
        for (let i: number = 0; i < 4; i++) {
            if (ex[i] * (iy[k] - py[i]) - ey[i] * (ix[k] - px[i]) < 0) {
                ring = false;
                break;
            }
        }
    }

    if (!ring) {
        emit(px[0], px[1], px[2], py[0], py[1], py[2], rgb, 0);
        emit(px[0], px[2], px[3], py[0], py[2], py[3], rgb, 0);
        return;
    }

    for (let i: number = 0; i < 4; i++) {
        const j: number = (i + 1) & 3;
        emit(px[i], px[j], ix[j], py[i], py[j], iy[j], rgb, 0);
        emit(px[i], ix[j], ix[i], py[i], iy[j], iy[i], rgb, 0);
    }
}
