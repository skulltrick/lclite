// lclite:world-map — the World map mod's game-side core.
//
// WHAT THE PLAYER GETS. A second stone orb on the minimap panel, immediately left of
// mods/wiki-lookup's wiki orb: click it and an interactive world map fills the game
// window — the OSRS map, with terrain, place labels, the point-of-interest icons and
// their key, dungeon and "extra" areas, zoom, pan and a "you are here" marker.
//
// WHY THIS IS A MOD AND NOT A FEATURE PORT. The 2004 webclient ALREADY CONTAINS the
// complete world map app: `webclient/src/mapview/MapView.ts` (a standalone GameShell
// subclass, ~1960 lines: `renderWorldMap`, labels, mapfunction icons, npc/obj/multi/
// free layers, an overview minimap, an export-to-PNG key) plus its font pack
// (`WorldMapFont.ts`). It is built by `webclient/bundle.ts` (entrypoints: Client.ts,
// mapview/MapView.ts, OnDemandWorker.ts) and served by the engine's own
// `/worldmap.jag` route — and then NOTHING loads it: no page, no button, no entry
// point. It is dead code that only the map editor uses. This mod is the missing
// wiring, plus the two things the app never had (a player marker and a DOM UI around
// the canvas), and it is entirely client-side: no server route, no packet, no
// server-side data file. The map DATA is the engine's own packed `worldmap.jag`
// (`npm run build` packs it from the content maps; `src/web.ts` serves it on a dev
// world), and the map CODE is the bundle the same build already produces.
//
// THE TWO REALMS. The map app needs its own document — it grabs `#canvas` at module
// load and runs its own GameShell loop, so booting it inside the game page would
// fight the game for the canvas and the input. The mod therefore opens it in an
// IFRAME overlay (the mod's page script, lclite/worldmap/ui.js), scaled and placed
// over the game canvas, and the two realms talk over the window boundary:
//
//   game bundle  ->  page    window['worldMapPlayer']()   positional array, below
//   page         ->  game    window['worldMapToggle']()   open/close the overlay
//   page         ->  map     iframe.contentWindow.worldMapApp.ui([...])  (page-side)
//   map bundle   ->  page    window['worldMapUi'](cmd)    positional array, reserved
//
// Every one of those names is terser-RESERVED (bundle.ts, the control-panel island):
// the property mangler rewrites string-keyed reads too, so an unreserved READ is the
// silent one — it compares an unmangled name against the mangler's rename and gets
// `undefined` with no error (docs/MODS.md §The contract).
//
// This file is DOM-free and client-free except for the page bridge's own accessor, so
// mods/world-map/tools/world_map_test.ts exercises the REAL shipped logic headlessly:
// the settings parse, the orb's geometry and hit test, the globe's pixels, and the
// payload the page reads.

/** This mod's OWN settings (rule 5): read per frame at the mod's own hooks, never a
 *  hub, never another mod's key. The panel renders exactly these keys. */
export interface WorldMapSettings {
    /** Master switch. `'false'` is the only value that turns it off. */
    enabled: boolean;
    /** Draw the minimap world orb. Default ON — it is the way in. */
    button: boolean;
    /** Centre the map on the player when it opens (default ON). */
    centre: boolean;
}

/** The client's reader for this mod's OWN keys (one definition of the contract; the
 *  harness passes its own stub instead). */
export function worldMapRead(key: string): string | null {
    return localStorage.getItem(key);
}

export function worldMapSettings(read: (key: string) => string | null): WorldMapSettings {
    return {
        enabled: read('worldMap') !== 'false',
        button: read('worldMapButton') !== 'false',
        centre: read('worldMapCentre') !== 'false'
    };
}

// ---------------------------------------------------------------------------------
// the minimap world orb: geometry, hit test, and the pixels themselves
// ---------------------------------------------------------------------------------

/** The orb is drawn into the minimap WIDGET's own 172x156 space (the `areaMap`
 *  buffer, composited onto the canvas at 550,4) — the same space, and the same ride,
 *  as mods/stat-orbs' orbs and mods/wiki-lookup's orb. It is 21px, ODD so the centre
 *  lands on a pixel (r = size >> 1 = 10 fills the box edge to edge), and it sits
 *  IMMEDIATELY LEFT of the wiki orb with a 2px gap: the wiki orb's own default spot is
 *  the bottom-right corner of the map window with 3px clearance from the panel's right
 *  and bottom edges, so the pair reads as one row of orbs in the map window's corner
 *  exactly as OSRS stacks its map buttons. The map is re-blitted every frame before
 *  the composite, so neither orb can strand a pixel there. */
export const WORLD_MAP_BUTTON_SIZE: number = 21;
export const WORLD_MAP_PANEL_W: number = 172;
export const WORLD_MAP_PANEL_H: number = 156;
/** The widget's origin in the 765x503 canvas space (`areaMap.draw(550, 4)`). */
export const WORLD_MAP_ORIGIN_X: number = 550;
export const WORLD_MAP_ORIGIN_Y: number = 4;

/** The 9 anchor points, as PARALLEL ARRAYS matched by index — the panel's drag layer
 *  stores an anchor NAME in localStorage, and a runtime string must never index an
 *  object literal in bundled code (terser's property mangler renames the keys). */
export const WORLD_MAP_ANCH_NAMES: string[] = ['TL', 'TC', 'TR', 'ML', 'MC', 'MR', 'BL', 'BC', 'BR'];
export const WORLD_MAP_ANCH: number[][] = [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [0.5, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]];
/** Documentation only for the drag layer (a canvas surface's default spot IS the box
 *  below — `defA`/`defO` are never resolved for one). */
export const WORLD_MAP_ANCHOR_DEF: string = 'BR';
export const WORLD_MAP_OFFSET_DEF: string = '-47,-24';

/** The default spot: the wiki orb's own default box, one orb + a 2px gap to its left.
 *  Kept as arithmetic on the wiki orb's numbers (panel - 3px clearance - orb) so the
 *  pair stays together if either constant moves. */
export const WORLD_MAP_DEFAULT_X: number = WORLD_MAP_PANEL_W - WORLD_MAP_BUTTON_SIZE - 3 - WORLD_MAP_BUTTON_SIZE - 2;
export const WORLD_MAP_DEFAULT_Y: number = WORLD_MAP_PANEL_H - WORLD_MAP_BUTTON_SIZE - 3;

/** The orb's box [x, y, w, h] in the widget's own space, from the placement keys the
 *  panel's drag layer writes (alt+drag). Clamped FLUSH — the widget IS the boundary,
 *  so the orb can never be dragged off the panel, and the panel clamps identically.
 *  No keys stored (the normal case) = the default spot above. */
export function worldMapButtonBox(anchor: string, offset: string): number[] {
    const size: number = WORLD_MAP_BUTTON_SIZE;
    let ox: number = WORLD_MAP_DEFAULT_X;
    let oy: number = WORLD_MAP_DEFAULT_Y;

    const ai: number = WORLD_MAP_ANCH_NAMES.indexOf(anchor);
    if (ai >= 0) {
        const k: number[] = WORLD_MAP_ANCH[ai];
        const off: string[] = String(offset || '0,0').split(',');
        ox = Math.round(WORLD_MAP_PANEL_W * k[0]) + (parseInt(off[0]) || 0);
        oy = Math.round(WORLD_MAP_PANEL_H * k[1]) + (parseInt(off[1]) || 0);
    }

    ox = Math.max(0, Math.min(ox, WORLD_MAP_PANEL_W - size));
    oy = Math.max(0, Math.min(oy, WORLD_MAP_PANEL_H - size));
    return [ox, oy, size, size];
}

/** Is the point (in the widget's own space) on the orb? Half-open on the far edge, so
 *  the box is exactly 21x21 clicks. */
export function worldMapButtonHit(mx: number, my: number, box: number[]): boolean {
    return mx >= box[0] && my >= box[1] && mx < box[0] + box[2] && my < box[1] + box[3];
}

/** The orb's 7x7 mark (row-major, '1' = ink): a GLOBE — the world map's own sign, and
 *  visually distinct from the wiki orb's 'W' at a glance. The equator and the two
 *  meridians are drawn as the only interior lines, so it still reads as a sphere at
 *  7px. */
export const WORLD_MAP_GLYPH: string =
    '0011100' +
    '0111110' +
    '1101011' +
    '1111111' +
    '1101011' +
    '0111110' +
    '0011100';

/** Paint the orb straight into a frame buffer.
 *
 *  PURE on purpose: it takes the pixel array, its stride/height and the ABSOLUTE
 *  canvas position, so the shipped logic is the code the harness exercises headlessly
 *  (the client passes Pix2D.pixels). Every pixel written is OPAQUE and every pixel
 *  outside the disc is left untouched — the panel's stone is painted once at boot and
 *  never re-cleared, so an alpha blend would accumulate. Hard 1px steps, no
 *  anti-aliasing, in the mapback's own palette (rim lit upper-left, shadowed
 *  lower-right) so the orb reads as part of the 2004 interface.
 *
 *  open = the map overlay is up (the glass turns OSRS-gold and pulses on a 16-tick
 *  period, so the orb itself says whether the map is showing). hover = the mouse is
 *  over the orb. */
export function worldMapDrawButton(px: Int32Array, stride: number, height: number, x: number, y: number, size: number, open: boolean, hover: boolean, tick: number): void {
    const r: number = size >> 1;
    const rim: number = r >= 9 ? 2 : 1;
    const innerR: number = r - 1 - rim;
    const cx: number = x + r;
    const cy: number = y + r;
    const rr: number = r * r;
    const rimIn: number = (r - 1) * (r - 1);
    const ir: number = innerR * innerR;
    const pulse: boolean = open && tick % 16 < 8;

    const glass: number = open ? (pulse ? 0xd8ab5a : 0xa87f38) : 0x161310;
    const glassEdge: number = open ? (pulse ? 0x8a6a2c : 0x6b4f22) : 0x2b2721;
    const rimLit: number = open ? 0xf0dcae : (hover ? 0x968b77 : 0x7d7466);
    const rimDark: number = open ? 0x6b5222 : (hover ? 0x3d352b : 0x2a251f);

    for (let dy: number = -r; dy <= r; dy++) {
        const py: number = cy + dy;
        if (py < 0 || py >= height) {
            continue;
        }

        for (let dx: number = -r; dx <= r; dx++) {
            const pxx: number = cx + dx;
            if (pxx < 0 || pxx >= stride) {
                continue;
            }

            const d2: number = dx * dx + dy * dy;
            if (d2 > rr) {
                continue;
            }

            let colour: number;
            if (d2 > rimIn) {
                colour = 0x0a0a0a;                   // hard outer outline
            } else if (d2 > ir) {
                colour = dy < 0 ? rimLit : rimDark;  // bevelled stone rim
            } else {
                colour = Math.sqrt(d2) > innerR - 1 ? glassEdge : glass;
            }

            px[pxx + py * stride] = colour;
        }
    }

    // the globe. One pass, no outline: at 7px the strokes are 1px apart, so a
    // 4-neighbour outline fills the gaps and the mark reads as a blob — the dark glass
    // is the contrast instead.
    if (innerR >= 7 && WORLD_MAP_GLYPH.length === 49) {
        const ink: number = open ? 0xffffff : 0xf7f3e8;
        const gx: number = cx - 3;
        const gy: number = cy - 3;

        for (let j: number = 0; j < 7; j++) {
            for (let i: number = 0; i < 7; i++) {
                if (WORLD_MAP_GLYPH.charAt(j * 7 + i) === '1') {
                    worldMapPixel(px, stride, height, gx + i, gy + j, ink);
                }
            }
        }
    }
}

function worldMapPixel(px: Int32Array, stride: number, height: number, x: number, y: number, colour: number): void {
    if (x < 0 || y < 0 || x >= stride || y >= height) {
        return;
    }

    px[x + y * stride] = colour;
}

// ---------------------------------------------------------------------------------
// the page bridge
// ---------------------------------------------------------------------------------

/** The player payload the page reads every tick while the map is open.
 *
 *  A POSITIONAL ARRAY, never an object: an object literal's KEYS are renamed by the
 *  property mangler on the way across the bundle boundary, so the page would read
 *  `undefined` for every field (docs/MODS.md §The contract — the tcg HUD's bug).
 *
 *  index 0  x     world coordinate, TILES (not the client's own 128-units)
 *  index 1  z     world coordinate, tiles
 *  index 2  level 0-3 (the client's `minusedlevel`)
 *  index 3  valid 1 when a local player exists, else 0 (the page keeps its last
 *                 position and says "offline" rather than drawing a marker at 0,0)
 */
export function worldMapPlayerPayload(x: number, z: number, level: number, valid: boolean): number[] {
    return [x, z, level, valid ? 1 : 0];
}
