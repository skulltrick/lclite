// lclite:hover-tile — the Hover tile mod's pure core: the settings parse and the
// projected-quad rasterizer. Nothing here touches the client (no Pix2D, no World, no
// DOM), so mods/hover-tile/tools/hover_tile_test.ts runs the REAL logic headlessly.
//
// Design source: RuneLite's Tile Indicators plugin, hovered-tile section. Its shipped
// defaults are effectively invisible — the plugin is off, the border colour defaults to
// fully transparent and the fill to black at ~20% — so LCLite's defaults are
// deliberately VISIBLE (a mod whose only feature is the hover marker has to show
// something the moment it is installed). The settings contract matches mods/true-tile
// (one colour + border px + fill %), so the two tile markers read the same in the panel.

/** What hoverTileDraw() needs per frame. Read from this mod's OWN localStorage keys
 *  (rule 5) — never another mod's key, and never through a settings hub. */
export interface HoverTileSettings {
    enabled: boolean;
    rgb: number;
    thick: number;
    fillA: number;
}

export const HOVER_TILE_DEFAULT_COLOR: string = '#ffffff';
export const HOVER_TILE_DEFAULT_OUTLINE: number = 2;
export const HOVER_TILE_DEFAULT_FILL: number = 20;

/** The client's reader for this mod's OWN keys. It lives here so the "own keys, read
 *  per frame at my own hook" contract (rule 5) has exactly one definition; the
 *  harness passes its own stub instead. */
export function hoverTileRead(key: string): string | null {
    return localStorage.getItem(key);
}

/** Read and validate this mod's settings. `read` is localStorage.getItem in the
 *  client and a stub in the harness. Everything is clamped HERE rather than at the
 *  call site, so a stale, hand-typed or half-written key can never paint garbage:
 *  the colour must be a 7-char '#rrggbb', the border 1..8 px, the fill 0..100 %.
 *  The master key defaults ON ('false' is the only value that disables). */
export function hoverTileSettings(read: (key: string) => string | null): HoverTileSettings {
    const enabled: boolean = read('hoverTile') !== 'false';

    let rgb: number = parseInt(HOVER_TILE_DEFAULT_COLOR.substring(1), 16);
    const hex: string | null = read('hoverTileColor');
    if (hex !== null && hex.length === 7 && hex.charCodeAt(0) === 35 /* # */) {
        const parsed: number = parseInt(hex.substring(1), 16);
        if (!isNaN(parsed)) {
            rgb = parsed;
        }
    }

    let thick: number = parseInt(read('hoverTileOutline') ?? String(HOVER_TILE_DEFAULT_OUTLINE), 10);
    if (!(thick >= 1)) {
        thick = 1;   // also catches NaN and every non-positive value
    } else if (thick > 8) {
        thick = 8;
    }

    let fillA: number = parseInt(read('hoverTileFill') ?? String(HOVER_TILE_DEFAULT_FILL), 10);
    if (!(fillA > 0)) {
        fillA = 0;
    } else if (fillA > 100) {
        fillA = 100;
    }

    return { enabled, rgb, thick, fillA };
}

/** Rasterize one projected tile quad into a 32-bit pixel buffer: an opaque border of
 *  `thick` px and, when fillA > 0, a translucent interior wash mixed in place exactly
 *  like Pix2D.hlineTrans (integer alpha of 0..256).
 *
 *  The quad is the tile's four corners projected to screen space, in ANY order and
 *  orientation (a camera-rotated tile is an arbitrary convex quad). Each edge is
 *  sign-normalized against the centroid — always inside — and s_i = len_i × the
 *  perpendicular distance in px, so `s_i < thick × len_i` is "within `thick` px of
 *  edge i" no matter how the quad is sheared or how long its edges are.
 *
 *  Convention note: a pixel exactly ON an edge counts as inside (`s >= 0`), so a
 *  projected quad of S units covers S+1 pixels across. That is inherited from the
 *  true-tile mod's proven rasterizer (the two share this math deliberately, one
 *  mod-owned copy each); it costs one pixel at the far edge of a ~40px tile, which is
 *  not visible, and it keeps the near edges flush with the floor they cover. */
export function hoverTileRaster(
    dst: Int32Array, w: number,
    clipMinX: number, clipMaxX: number, clipMinY: number, clipMaxY: number,
    px: number[], py: number[],
    rgb: number, thick: number, fillA: number
): void {
    const cxs: number = (px[0] + px[1] + px[2] + px[3]) * 0.25;
    const cys: number = (py[0] + py[1] + py[2] + py[3]) * 0.25;

    const ex: number[] = [0, 0, 0, 0];
    const ey: number[] = [0, 0, 0, 0];
    const dLim: number[] = [0, 0, 0, 0];
    let minX: number = px[0], maxX: number = px[0], minY: number = py[0], maxY: number = py[0];

    for (let i: number = 0; i < 4; i++) {
        const j: number = (i + 1) & 3;
        ex[i] = px[j] - px[i];
        ey[i] = py[j] - py[i];

        const fc: number = ex[i] * (cys - py[i]) - ey[i] * (cxs - px[i]);
        const dir: number = fc < 0 ? -1 : 1;
        ex[i] *= dir;
        ey[i] *= dir;

        dLim[i] = thick * Math.sqrt(ex[i] * ex[i] + ey[i] * ey[i]);

        if (px[i] < minX) minX = px[i];
        if (px[i] > maxX) maxX = px[i];
        if (py[i] < minY) minY = py[i];
        if (py[i] > maxY) maxY = py[i];
    }

    const bx0: number = Math.max(minX | 0, clipMinX);
    const bx1: number = Math.min((maxX + 1) | 0, clipMaxX);
    const by0: number = Math.max(minY | 0, clipMinY);
    const by1: number = Math.min((maxY + 1) | 0, clipMaxY);

    const alpha: number = (fillA * 256) / 100;   // Pix2D mix scale: 0..256
    const r0: number = ((rgb >> 16) & 0xff) * alpha;
    const g0: number = ((rgb >> 8) & 0xff) * alpha;
    const b0: number = (rgb & 0xff) * alpha;
    const inv: number = 256 - alpha;

    for (let y: number = by0; y < by1; y++) {
        for (let x: number = bx0; x < bx1; x++) {
            const s0: number = ex[0] * (y - py[0]) - ey[0] * (x - px[0]);
            if (s0 < 0) {
                continue;
            }
            const s1: number = ex[1] * (y - py[1]) - ey[1] * (x - px[1]);
            if (s1 < 0) {
                continue;
            }
            const s2: number = ex[2] * (y - py[2]) - ey[2] * (x - px[2]);
            if (s2 < 0) {
                continue;
            }
            const s3: number = ex[3] * (y - py[3]) - ey[3] * (x - px[3]);
            if (s3 < 0) {
                continue;
            }

            const off: number = x + y * w;
            if (s0 >= dLim[0] && s1 >= dLim[1] && s2 >= dLim[2] && s3 >= dLim[3]) {
                // interior: translucent fill, in-place integer mix (Pix2D.hlineTrans)
                if (fillA > 0) {
                    const pxl: number = dst[off];
                    dst[off] = (((r0 + ((pxl >> 16) & 0xff) * inv) >> 8) << 16)
                             | (((g0 + ((pxl >> 8) & 0xff) * inv) >> 8) << 8)
                             | ((b0 + (pxl & 0xff) * inv) >> 8);
                }
            } else {
                dst[off] = rgb;   // the border ring itself (opaque, any thickness)
            }
        }
    }
}
