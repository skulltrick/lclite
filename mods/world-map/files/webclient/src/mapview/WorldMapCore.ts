// lclite:world-map — the World map mod's map-side core.
//
// This half runs INSIDE the map app's bundle (`webclient/src/mapview/MapView.ts` is a
// bundle entrypoint, so the mod's hunks into it ship in `out/mapview.js`). It holds
// everything the marker and the page bridge need that can be reasoned about without a
// client: the three map areas, the world->map coordinate transform, the marker's
// screen geometry and pixels, and the parse of the page's positional commands.
//
// WHY A SEPARATE FILE. The map app is upstream code and the mod only patches it at
// four small sites; keeping the logic here means mods/world-map/tools/world_map_test.ts
// exercises the REAL shipped code — including the area table, which the harness
// re-derives from MapView.ts's own `reloadMain`/`reloadDungeon`/`reloadExtra` and
// asserts equal, so the table cannot silently drift from the app it drives.
//
// THE COORDINATE SPACE. The world map's own space is 1 unit per TILE, x growing east
// like the world's, z FLIPPED (mapZ = originZ + height - worldZ) because the map draws
// north-up from the bottom edge. Each area is a window into that space:
//
//   area 0  main     x 2048..3648  z 2624..4032   the surface (the 42..62 map areas)
//   area 1  dungeon  x 2048..3648  z 9024..10432  the underground (the 142..161 map
//                                                 areas — 2004Scape authors dungeons
//                                                 as ordinary level-0 tiles far south)
//   area 2  extra    x 1792..3136  z 4032..5120   the "extra" sheet (the 69..77 areas)
//
// A player's world tile is therefore enough to pick the area: no level logic, because
// the underground is a PLACE in this world, not a level of the surface.

/** The three map areas, as PARALLEL ARRAYS matched by index (never an object literal
 *  keyed by a runtime string — the property mangler renames literal keys). The values
 *  mirror `MapView.reloadMain`/`reloadDungeon`/`reloadExtra`; the harness asserts it. */
export const WORLD_MAP_AREA_NAMES: string[] = ['Main', 'Dungeon', 'Extra'];
export const WORLD_MAP_AREA_ORIGIN_X: number[] = [32 << 6, 32 << 6, 28 << 6];
export const WORLD_MAP_AREA_ORIGIN_Z: number[] = [41 << 6, 141 << 6, 63 << 6];
export const WORLD_MAP_AREA_WIDTH: number[] = [25 << 6, 25 << 6, 21 << 6];
export const WORLD_MAP_AREA_HEIGHT: number[] = [22 << 6, 22 << 6, 17 << 6];

/** Which area holds this world tile, or -1 when none does (a player in a region the
 *  world map has no sheet for — the page then keeps the current area and the marker is
 *  simply not drawn). Tested in order, so the surface wins an overlap. */
export function worldMapAreaAt(x: number, z: number): number {
    for (let i: number = 0; i < WORLD_MAP_AREA_NAMES.length; i++) {
        if (
            x >= WORLD_MAP_AREA_ORIGIN_X[i] && x < WORLD_MAP_AREA_ORIGIN_X[i] + WORLD_MAP_AREA_WIDTH[i] &&
            z >= WORLD_MAP_AREA_ORIGIN_Z[i] && z < WORLD_MAP_AREA_ORIGIN_Z[i] + WORLD_MAP_AREA_HEIGHT[i]
        ) {
            return i;
        }
    }

    return -1;
}

/** World tile -> the map's own space, in the CURRENT area's frame. The z axis is
 *  flipped: the map draws from its bottom edge upward. */
export function worldMapMapPoint(x: number, z: number, originX: number, originZ: number, height: number): number[] {
    return [x - originX, originZ + height - z];
}

/** The marker's SCREEN position, from the map space point and the window mainredraw
 *  is rendering. `renderWorldMap(left, top, right, bottom, 0, 0, sWid, sHei)` maps the
 *  map span [left, right) onto [0, sWid) with `widthRatio = (sWid << 16) / (right -
 *  left)`, and mainredraw sets `left = focusX - (sWid / zoom)`, so the ratio is exactly
 *  `zoom / 2` screen pixels per map tile. Returns [screenX, screenY, onScreen]. */
export function worldMapMarkerScreen(mapX: number, mapY: number, left: number, top: number, zoom: number, sWid: number, sHei: number): number[] {
    const sx: number = Math.round(((mapX - left) * zoom) / 2);
    const sy: number = Math.round(((mapY - top) * zoom) / 2);
    const onScreen: boolean = sx >= 0 && sy >= 0 && sx < sWid && sy < sHei;
    return [sx, sy, onScreen ? 1 : 0];
}

/** The map's own focus point for a map-space point, so the page's "centre on me" can
 *  set `focusX`/`focusZ` to it directly. */
export function worldMapFocusFor(mapX: number, mapY: number): number[] {
    return [mapX, mapY];
}

/** The marker: a hard 1px black outline, a white ring and a red core — the OSRS map's
 *  own "you are here" reading, and unlike the map's POI icons it never blends into
 *  terrain because it is drawn opaque on top. `tick` drives a 16-tick pulse of the
 *  outer ring so the marker is findable on a dense sheet. PURE: it takes the pixel
 *  array, its stride/height and the ABSOLUTE canvas position, exactly like the orb. */
export const WORLD_MAP_MARKER_RADIUS: number = 5;

export function worldMapDrawMarker(px: Int32Array, stride: number, height: number, x: number, y: number, tick: number): void {
    const r: number = WORLD_MAP_MARKER_RADIUS;
    const pulse: boolean = tick % 16 < 8;
    const rr: number = r * r;
    const ringIn: number = (r - 1) * (r - 1);
    const body: number = (r - 2) * (r - 2);

    for (let dy: number = -r; dy <= r; dy++) {
        const py: number = y + dy;
        if (py < 0 || py >= height) {
            continue;
        }

        for (let dx: number = -r; dx <= r; dx++) {
            const pxx: number = x + dx;
            if (pxx < 0 || pxx >= stride) {
                continue;
            }

            const d2: number = dx * dx + dy * dy;
            if (d2 > rr) {
                continue;
            }

            let colour: number;
            if (d2 > ringIn) {
                colour = 0x000000;                    // hard outline
            } else if (d2 > body) {
                colour = 0xffffff;                    // white ring
            } else if (d2 > 2) {
                colour = pulse ? 0xd23b2e : 0x9c2a20; // the core, pulsing
            } else {
                colour = 0xffffff;
            }

            px[pxx + py * stride] = colour;
        }
    }
}

/** The marker's "You are here" caption through the map app's own font pack. Kept as a
 *  plan (not a draw) so the harness can assert the string and its placement without a
 *  canvas: returns [text, centreX, centreY, colour] in canvas space, for
 *  `WorldMapFont.centreString`. `level` is the client's own 0-based `minusedlevel`; the
 *  underground sheets get their level spelled out (the sheet is a PLACE in this world,
 *  so "level 2" is the only honest way to say where the player is on it). */
export function worldMapMarkerLabel(sx: number, sy: number, sWid: number, level: number): (string | number)[] {
    const text: string = level > 0 ? `You are here (level ${level + 1})` : 'You are here';
    // under the marker, clamped to the canvas so the caption of a player at the map's
    // edge is not cut in half. The map app's own fonts are ~5px per character, so the
    // caption's half-width is estimated from its length and the clamp keeps the WHOLE
    // string inside, not just its centre.
    const half: number = Math.ceil((text.length * 5) / 2);
    let cx: number = sx;
    if (cx - half < 2) {
        cx = 2 + half;
    } else if (cx + half > sWid - 2) {
        cx = sWid - 2 - half;
    }
    return [text, cx, sy + 14, 0xffffff];
}

// ---------------------------------------------------------------------------------
// the page bridge: the commands the map's own page script sends
// ---------------------------------------------------------------------------------

/** Command ops (index 0 of every command array). Numbers, not strings: a command
 *  crosses the page/bundle boundary, and a string would have to be matched against a
 *  mangled constant. */
export const WORLD_MAP_CMD_PLAYER: number = 1;   // [1, x, z, level]   world tiles
export const WORLD_MAP_CMD_AREA: number = 2;     // [2, areaIndex]
export const WORLD_MAP_CMD_LAYER: number = 3;    // [3, layerIndex, 0|1]
export const WORLD_MAP_CMD_CENTRE: number = 4;   // [4]                centre on the player
export const WORLD_MAP_CMD_STATE: number = 5;    // [5]                -> state array
export const WORLD_MAP_CMD_ZOOM: number = 6;     // [6, zoom]          3|4|6|8
export const WORLD_MAP_CMD_JAG: number = 7;      // [7, urlIndex]      which map data URL to read

/** Where the world map's DATA can come from, in preference order, as a list of
 *  SERVER PATHS — the page probes them and sends the index it found (a path is a
 *  string, and a string cannot cross the bundle boundary as a value; an INDEX can).
 *
 *  [0] `/worldmap.jag` is the engine's own route (engine/src/web.ts) and serves the
 *      jag it packed from the content maps — but it is registered INSIDE
 *      `if (Environment.node.debug)`, so it exists on a dev world (the launcher's own
 *      local world) and 404s on a production one.
 *  [1] `/client/worldmap.jag` is a plain static file under engine/public, which every
 *      world serves — and which the launcher's join bridge serves from the LOCAL
 *      install even when the game itself is on somebody else's world. `lclite.mjs
 *      build` deploys the packed jag there (copied from the install's own
 *      engine/data/pack/mapview/worldmap.jag), so a player on a live world still gets
 *      the map. */
export const WORLD_MAP_JAG_URLS: string[] = ['/worldmap.jag', '/client/worldmap.jag'];

/** The layers the page can switch, as PARALLEL ARRAYS: index -> MapView's own static
 *  flag name (for the harness, which reads them off the source) and the label the page
 *  shows. `MapView.shouldDraw*` defaults are the app's own (npcs/items/multimap/
 *  freemap off, labels on) — the mod does not change them at boot. */
export const WORLD_MAP_LAYER_NAMES: string[] = ['npc', 'item', 'labels', 'borders', 'multi', 'free'];
export const WORLD_MAP_LAYER_FLAGS: string[] = ['shouldDrawNpcs', 'shouldDrawItems', 'shouldDrawLabels', 'shouldDrawBorders', 'shouldDrawMultimap', 'shouldDrawFreemap'];

export interface WorldMapCommand {
    op: number;
    a: number;
    b: number;
    c: number;
}

/** Parse and validate a command from the page. Returns null for anything malformed —
 *  the caller then ignores it, so a half-updated page can never move the map. */
export function worldMapCommand(cmd: unknown): WorldMapCommand | null {
    if (!Array.isArray(cmd) || cmd.length === 0) {
        return null;
    }

    const op: number = Number(cmd[0]);
    if (!isFinite(op) || op < WORLD_MAP_CMD_PLAYER || op > WORLD_MAP_CMD_JAG) {
        return null;
    }

    const a: number = cmd.length > 1 ? Number(cmd[1]) : 0;
    const b: number = cmd.length > 2 ? Number(cmd[2]) : 0;
    const c: number = cmd.length > 3 ? Number(cmd[3]) : 0;

    if (!isFinite(a) || !isFinite(b) || !isFinite(c)) {
        return null;
    }

    if (op === WORLD_MAP_CMD_AREA && (a < 0 || a >= WORLD_MAP_AREA_NAMES.length)) {
        return null;
    }
    if (op === WORLD_MAP_CMD_LAYER && (a < 0 || a >= WORLD_MAP_LAYER_NAMES.length)) {
        return null;
    }

    return { op, a, b, c };
}

/** The state the page reads back (WORLD_MAP_CMD_STATE), POSITIONAL and documented:
 *  [0] area         the sheet on screen (0 main, 1 dungeon, 2 extra)
 *  [1] focusX       map-space focus, x
 *  [2] focusZ       map-space focus, z
 *  [3] zoom         3 | 4 | 6 | 8 (screen px per map tile = zoom / 2)
 *  [4..9]           layer flags, in WORLD_MAP_LAYER_NAMES order
 *  [10] playerArea  the sheet the PLAYER is on (-1 when the map has no sheet for them)
 *  [11] here        1 when the marker can be drawn in the sheet on screen
 */
export function worldMapStatePayload(area: number, focusX: number, focusZ: number, zoom: number, layers: number[], playerArea: number, here: boolean): number[] {
    return [
        area, focusX, focusZ, zoom,
        layers[0] | 0, layers[1] | 0, layers[2] | 0, layers[3] | 0, layers[4] | 0, layers[5] | 0,
        playerArea, here ? 1 : 0
    ];
}
