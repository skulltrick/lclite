// lclite:tile-markers
/// Tile markers — RuneLite's "Ground Markers" plugin, 2004 flavour.
///
/// This file is the mod's PURE half: the settings parse, the marker store (parse,
/// serialise, find, toggle), the menu row's label, the Shift state and the projected-quad
/// decal geometry. The engine hooks are five hunks in Client.ts (one import, the
/// Shift+right-click arm in mouseLoop(), the per-frame resolve+draw call in gameDrawMain(),
/// the menu-row dispatch at the top of doAction(), and the parked fields+methods block), so
/// a bun harness can import THIS file and test the real shipped logic headlessly — see
/// mods/tile-markers/tools/tile_markers_test.ts.
///
/// THE FEATURE: Shift+right-click a tile and the right-click menu gains a "Mark Tile" row
/// ("Unmark Tile" when that tile is already marked); the mark is made when that row is
/// clicked. Marks persist in localStorage, are drawn only on the plane they were made on
/// (RuneLite: `worldPoint.getPlane() != wv.getPlane()` -> skip), and are culled at
/// RuneLite's own MAX_DRAW_DISTANCE of 32 tiles from the player.
///
/// PARITY, and where this mod deliberately diverges from RuneLite (their
/// GroundMarkerPlugin/GroundMarkerConfig/GroundMarkerOverlay, read 2026-09-22):
///
///   * The menu row IS RuneLite's own interaction, ported: their onMenuEntryAdded appends
///     `setOption(marked ? "Unmark" : "Mark")` with `setTarget("Tile")` when Shift is held
///     AND the menu entry being built is the WALK option, and clicking the row toggles the
///     tile. This mod adds the same row under the same condition (see TM_MENU_ACTION). Two
///     mechanics differ, both forced by how this engine builds its menu: the tile comes from
///     the engine's own ground pick at the CLICK pixel rather than from a live per-frame
///     hover pick (RuneLite's `wv.getSelectedSceneTile()`), and this engine FREEZES the menu
///     once it is open (`otherOverlays()` only calls `buildMinimenu()` while `!isMenuOpen`),
///     so the row stays in the menu after Shift is released instead of vanishing with the
///     key.
///   * Their defaults are `markerColor` YELLOW, `borderWidth` 2, `fillOpacity` 50/255
///     (~20%) with the fill FIXED BLACK. This mod keeps the numbers (2 px, 20%) and adds
///     a fill colour of its own (default black = theirs), so the wash can be tinted.
///   * They can also draw markers on the minimap and export/import them (their
///     sharing manager) and label/colour a marker individually. NOT PORTED: this mod
///     draws in the world only, has no import/export, and every mark shares the mod's
///     colour. Their per-region storage is not ported either — see below.
///   * They store points per map region (`region_<id>` config keys) and re-derive world
///     coords from (regionId, regionX, regionY, plane). This mod stores ABSOLUTE world
///     tiles in one key: the region split exists so a big marker set is not rewritten
///     wholesale, which localStorage does not need.
///
/// STORAGE SHAPE. `tileMarkersMarks` is a JSON array of NUMBERS — flat triples
/// `[x, z, level, x, z, level, ...]` — never objects. That is the same positional law the
/// bundle/page boundary uses (docs/MODS.md §The contract): terser's property mangler
/// renames object-literal KEYS, so a store written as `[{x,z,level}]` could not be read
/// back by the next build. An array of numbers has no keys to mangle, and the flat shape
/// makes the per-frame walk a strided loop with no allocation.

/** Hard cap on stored marks. RuneLite has none; localStorage does, and the draw loop is
 *  per-frame — 512 tiles is far more than a player marks by hand and still cheap. */
export const TM_MAX_MARKS: number = 512;

/** RuneLite's own GroundMarkerOverlay.MAX_DRAW_DISTANCE: 32 tiles (Chebyshev — their
 *  WorldPoint.distanceTo is max(|dx|,|dz|)). Beyond it a marker is not drawn at all. */
export const TM_MAX_DISTANCE: number = 32;

/** RuneLite's `markerColor` default (java.awt.Color.YELLOW). */
export const TM_DEFAULT_COLOR: string = '#ffff00';

/** RuneLite's fill is a hardcoded `new Color(0, 0, 0, fillOpacity)` — black. */
export const TM_DEFAULT_FILL_COLOR: string = '#000000';

/** RuneLite's `borderWidth` default. */
export const TM_DEFAULT_OUTLINE: number = 2;

/** RuneLite's `fillOpacity` default is 50 of 255 = 19.6%, expressed here as a percent. */
export const TM_DEFAULT_FILL: number = 20;

/** RuneLite's own menu wording: their entry is `setOption(marked ? "Unmark" : "Mark")` with
 *  `setTarget("Tile")`, which the menu renders as one row — "Mark Tile" / "Unmark Tile". */
export const TM_MENU_MARK: string = 'Mark Tile';
export const TM_MENU_UNMARK: string = 'Unmark Tile';

/** The action id this mod stamps on its own menu row. RuneLite uses its own MenuAction enum
 *  for this; this client has one flat id space, so a plugin row needs an id that is NOT a
 *  `MiniMenuAction` value and cannot be moved by the engine's own menu sort. `buildMinimenu()`
 *  ends with a bubble sort that walks every action > 1000 DOWN toward 'Cancel' (index 0), so
 *  an id above 1000 is stable where it is put, and an id below `MiniMenuAction._PRIORITY`
 *  (2000) is never treated as a priority-wrapped engine action (doAction subtracts _PRIORITY
 *  from anything >= it). 1235 sits in that window and collides with no engine action — the
 *  engine's own ids above 1000 are CANCEL 1106, OP_OBJ6 1152, OP_HELD6 1328, OP_LOC6 1381 and
 *  OP_NPC6 1714 (webclient/src/client/MiniMenuAction.ts) — nor with wiki-lookup's own menu
 *  row, which is 1234. */
export const TM_MENU_ACTION: number = 1235;

/** This mod's OWN localStorage keys (hard rule 5: read at the mod's own hook, per frame,
 *  never another mod's key and never through a hub). They are written in FULL here rather
 *  than assembled from a prefix because the shipped bundle keeps string literals verbatim
 *  — the property mangler only renames identifiers — so grepping the deployed client.js
 *  for `"tileMarkersColor"` is the prod-side proof that the panel and the engine agree. */
export const TM_KEY_ON: string = 'tileMarkers';
export const TM_KEY_COLOR: string = 'tileMarkersColor';
export const TM_KEY_FILL_COLOR: string = 'tileMarkersFillColor';
export const TM_KEY_OUTLINE: string = 'tileMarkersOutline';
export const TM_KEY_FILL: string = 'tileMarkersFill';
export const TM_KEY_MARKS: string = 'tileMarkersMarks';

/** What the decal draw needs per frame, validated — never a raw key value. */
export interface TileMarkerSettings {
    on: boolean;
    rgb: number;
    fillRgb: number;
    thick: number;
    fillA: number;
}

/** The client's reader for this mod's OWN keys. It lives here so the "own keys, read per
 *  frame at my own hook" contract has exactly one definition; the harness passes its own
 *  stub instead (so the tests run with no DOM). */
export function tmRead(key: string): string | null {
    return localStorage.getItem(key);
}

/** '#rrggbb' -> 0xrrggbb, or `def` for anything malformed (a stale, hand-typed or
 *  half-written key can never paint garbage). */
export function tmColour(hex: string | null, def: string): number {
    if (hex !== null && hex.length === 7 && hex.charCodeAt(0) === 35 /* # */) {
        const parsed: number = parseInt(hex.substring(1), 16);
        if (!isNaN(parsed)) {
            return parsed;
        }
    }
    return parseInt(def.substring(1), 16);
}

/** Read and validate every setting the mod has. The master key defaults ON — `'false'` is
 *  the only value that disables the mod (`undefined`/junk means "never touched it") —
 *  border 1..8 px, fill 0..100 %. All clamping happens HERE rather than at the call site,
 *  which is what makes the panel and the engine agree on a bad value. */
export function tmSettings(read: (key: string) => string | null): TileMarkerSettings {
    let thick: number = parseInt(read(TM_KEY_OUTLINE) ?? String(TM_DEFAULT_OUTLINE), 10);
    if (!(thick >= 1)) {
        thick = 1;   // also catches NaN and every non-positive value
    } else if (thick > 8) {
        thick = 8;
    }

    let fillA: number = parseInt(read(TM_KEY_FILL) ?? String(TM_DEFAULT_FILL), 10);
    if (!(fillA > 0)) {
        fillA = 0;
    } else if (fillA > 100) {
        fillA = 100;
    }

    return {
        on: read(TM_KEY_ON) !== 'false',
        rgb: tmColour(read(TM_KEY_COLOR), TM_DEFAULT_COLOR),
        fillRgb: tmColour(read(TM_KEY_FILL_COLOR), TM_DEFAULT_FILL_COLOR),
        thick,
        fillA
    };
}

/** Parse the marker store. Anything that is not a flat array of whole numbers in range is
 *  DROPPED (not repaired): a truncated or hand-edited store must never paint a marker at a
 *  garbage coordinate, and a NaN tile would project to a nonsense quad. `level` is the
 *  client's own plane (0..3); x/z are world tiles (0..16383, the map's own bound). */
export function tmParseMarks(raw: string | null): number[] {
    const out: number[] = [];

    if (raw === null || raw.length === 0) {
        return out;
    }

    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return out;
    }

    if (!Array.isArray(data)) {
        return out;
    }

    for (let i: number = 0; i + 2 < data.length; i += 3) {
        const x: unknown = data[i];
        const z: unknown = data[i + 1];
        const level: unknown = data[i + 2];

        if (typeof x !== 'number' || typeof z !== 'number' || typeof level !== 'number') {
            continue;
        }
        if (!Number.isInteger(x) || !Number.isInteger(z) || !Number.isInteger(level)) {
            continue;
        }
        if (x < 0 || x > 16383 || z < 0 || z > 16383 || level < 0 || level > 3) {
            continue;
        }

        out.push(x, z, level);

        if (out.length >= TM_MAX_MARKS * 3) {
            break;
        }
    }

    return out;
}

/** Serialise the store back to its key. Always a JSON array of numbers, never objects —
 *  see STORAGE SHAPE at the top of this file. */
export function tmSerialize(marks: number[]): string {
    return JSON.stringify(marks);
}

/** Index (in the flat array) of the mark on this tile, or -1. A mark is per
 *  (x, z, level): the same tile on another plane is a DIFFERENT mark, exactly as
 *  RuneLite's `p.getZ() == worldPoint.getPlane()` filter treats it. */
export function tmFind(marks: number[], x: number, z: number, level: number): number {
    for (let i: number = 0; i + 2 < marks.length; i += 3) {
        if (marks[i] === x && marks[i + 1] === z && marks[i + 2] === level) {
            return i;
        }
    }
    return -1;
}

/** Mark this tile, or unmark it if it is already marked. Returns a NEW array (the caller
 *  writes it straight back to localStorage), preserving the order of the marks that
 *  survive — so the store only ever grows at the end, and the newest mark is the last. */
export function tmToggle(marks: number[], x: number, z: number, level: number): number[] {
    const at: number = tmFind(marks, x, z, level);

    if (at !== -1) {
        return marks.slice(0, at).concat(marks.slice(at + 3));
    }

    if (marks.length + 3 > TM_MAX_MARKS * 3) {
        return marks;   // full: refuse rather than silently evict someone's markers
    }

    return marks.concat([x, z, level]);
}

/** Within RuneLite's draw distance of the player? Chebyshev, their own metric. */
export function tmNear(dx: number, dz: number): boolean {
    return dx < TM_MAX_DISTANCE && dx > -TM_MAX_DISTANCE && dz < TM_MAX_DISTANCE && dz > -TM_MAX_DISTANCE;
}

/** The label for this mod's right-click row on the tile (x, z, level). RuneLite decides its
 *  own row's label exactly this way — `existingOpt.isPresent() ? "Unmark" : "Mark"`, looked
 *  up by (regionX, regionY, plane) — so a tile that is already marked offers to unmark it.
 *  The store is read live, which is what makes the row honest after a mark made a second
 *  earlier: the row is built from the same array the toggle writes. */
export function tmMenuLabel(marks: number[], x: number, z: number, level: number): string {
    return tmFind(marks, x, z, level) === -1 ? TM_MENU_MARK : TM_MENU_UNMARK;
}

/** Is this scene tile one the ground rasterizer can reach? The client's scene is 104x104
 *  (`BuildArea.SIZE`), and `Client.getOverlayPos()` itself refuses scene coords below 128
 *  (tile 0) — so a mark on the outermost ring of the scene draws nothing, exactly like the
 *  engine's own hint arrow out there. */
export function tmSceneTileOk(sceneTile: number): boolean {
    return sceneTile >= 1 && sceneTile <= 102;
}

// ---- the Shift key -----------------------------------------------------------------
// Shift is this mod's modifier, and the client tracks it for shift-click drop only (a
// field on the OTHER mod's hunk, so it must not be read here: it does not exist when
// shift-drop is not installed). The state is tracked off the DOM instead — the same
// pattern ground-items uses for Alt and wiki-lookup for its menu modifier. Capture phase,
// so a handler that swallows the event downstream cannot hide it; `blur` clears it,
// because Alt+Tab/Shift+Tab away never delivers the keyup.
let tmShift: boolean = false;
let tmShiftBound: boolean = false;

const tmSetShift = (down: boolean): void => {
    tmShift = down;
};

/** Install the Shift listeners once. Safe to call every frame. */
export const tmTrackShift = (): void => {
    if (tmShiftBound || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return;
    }
    tmShiftBound = true;

    const key = (e: KeyboardEvent, down: boolean): void => {
        if (e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
            tmSetShift(down);
        }
    };

    window.addEventListener('keydown', (e: KeyboardEvent) => key(e, true), true);
    window.addEventListener('keyup', (e: KeyboardEvent) => key(e, false), true);
    window.addEventListener('blur', () => tmSetShift(false));
};

/** Is Shift held right now? */
export const tmShiftHeld = (): boolean => tmShift;

/** Harness/test seam for the Shift state (the DOM listeners cannot run headlessly). */
export const tmShiftSet = (down: boolean): void => tmSetShift(down);

// ---- the decal ----------------------------------------------------------------------

/** Emit one screen-space triangle. `trans` is Pix3D's own convention — the DESTINATION
 *  weight of the mix (0 = opaque, 256 = fully transparent) — so the client's binding is
 *  literally "set Pix3D.trans, call Pix3D.flatTriangle". Keeping the renderer injected is
 *  what lets the harness run this geometry with no engine at all. */
export type TileEmit = (
    xA: number, xB: number, xC: number,
    yA: number, yB: number, yC: number,
    colour: number, trans: number
) => void;

/** Draw one projected tile quad: an opaque border ring in `rgb` plus, when `fillA > 0`, a
 *  translucent wash in `fillRgb`. The quad is the tile's four corners projected to screen
 *  space in ANY order and orientation (a camera-rotated tile is an arbitrary convex quad),
 *  and the whole thing is ten triangles at most, whatever the skew:
 *
 *   1. the wash, as the whole quad (two triangles) at `trans` = the fill's destination
 *      weight. The ring is drawn over it, so the visible fill is the inner quad — drawing
 *      it this way needs no inset polygon and can never degenerate;
 *   2. the ring, as four quads spanning one edge each, from the outer corner to the
 *      MITRED inner corner. Adjacent quads share the mitre edge, so the four tile the
 *      ring exactly: no overlap, no seam, and the border stays `thick` px wide on a
 *      sheared or zoomed quad (it is a screen-space width, not a world-space inset).
 *
 *  A tile thinner on screen than the border is thick has no valid inner quad: the ring
 *  would turn itself inside out, so the whole quad is drawn as border instead.
 *
 *  This is the same geometry true-tile's payload ships (the two mods are independent, so
 *  the copy is deliberate — a shared library would make one mod's hunk a dependency of the
 *  other's). The one difference is the second colour: RuneLite's ground-marker fill is
 *  black rather than the border colour, so the wash and the ring take different colours
 *  here. */
export function tmDecal(
    emit: TileEmit,
    px: number[], py: number[],
    rgb: number, fillRgb: number, thick: number, fillA: number
): void {
    // The quad must enclose an area: a tile seen exactly edge-on (or a collapsed
    // projection) has nothing to draw, and its mitres would be meaningless.
    if ((px[1] - px[0]) * (py[3] - py[0]) - (px[3] - px[0]) * (py[1] - py[0]) === 0) {
        return;
    }

    // Raw edge deltas, kept for the inside test, plus the INWARD unit normal of each edge.
    // Orientation is arbitrary on screen, so each edge is sign-normalized against the
    // centroid (which is always inside). The inside test is then
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
        emit(px[0], px[1], px[2], py[0], py[1], py[2], fillRgb, trans);
        emit(px[0], px[2], px[3], py[0], py[2], py[3], fillRgb, trans);
    }

    // 2. the mitred inner corners: corner i is pushed along the bisector of the two edges
    //    that meet there, by exactly `thick` perpendicular to both
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

    // every inner corner must still be INSIDE the quad, or the border has reached across
    // the tile and the ring would be inside out
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
