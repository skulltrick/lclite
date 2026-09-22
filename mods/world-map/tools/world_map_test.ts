// lclite:world-map functional test — runs the REAL cores headlessly:
//
//   bun run mods/world-map/tools/world_map_test.ts          (from the overlay repo)
//   LCLITE_ROOT=<install> bun run mods/world-map/tools/world_map_test.ts
//
// With LCLITE_ROOT set it tests the copies inside an applied tree (what the game and
// the map app actually bundle) AND reads the tree's own webclient/src/mapview/MapView.ts
// to prove the mod's assumptions about that upstream file still hold; it prints which
// files it loaded either way.
//
// Covers what a browser cannot tell us cheaply:
//  1. the settings parse (master, orb, centre) — the master and the orb default ON and
//     only the literal 'false' turns either off;
//  2. the orb's geometry: the default spot is IMMEDIATELY LEFT of mods/wiki-lookup's own
//     default spot with a 2px gap (recomputed here from the wiki orb's numbers), the
//     placement keys the panel's drag layer writes, clamping, and the 21x21 hit test;
//  3. the orb's PIXELS: nothing painted outside the box, no pixel written as 0 (a hole in
//     the panel stone), the globe glyph, and idle / hover / open / pulse all different;
//  4. the page payload (a POSITIONAL array — an object literal's keys are renamed by the
//     property mangler on the way across the bundle boundary);
//  5. the map app's AREA TABLE, re-derived from MapView.ts's own reloadMain /
//     reloadDungeon / reloadExtra and asserted equal, so the mod's world->sheet mapping
//     cannot drift from the app it drives;
//  6. the world->map coordinate transform (the z axis is flipped) and the marker's screen
//     geometry at each zoom (screen px per map tile = zoom / 2, straight out of
//     renderWorldMap's own widthRatio);
//  7. the marker's pixels and its caption (including the level suffix and the clamp);
//  8. the page bridge's command parse (positional, validated) and the state array's
//     documented index map.
import fs from 'node:fs';
import path from 'node:path';

const LCLITE = path.resolve(import.meta.dir, '../../..');
const ROOT = process.env.LCLITE_ROOT;

const CLIENT_PAYLOAD = path.join(LCLITE, 'mods/world-map/files/webclient/src/client/WorldMap.ts');
const MAP_PAYLOAD = path.join(LCLITE, 'mods/world-map/files/webclient/src/mapview/WorldMapCore.ts');
const CLIENT_CORE = ROOT ? path.join(ROOT, 'webclient/src/client/WorldMap.ts') : CLIENT_PAYLOAD;
const MAP_CORE = ROOT ? path.join(ROOT, 'webclient/src/mapview/WorldMapCore.ts') : MAP_PAYLOAD;
const MAPVIEW_SRC = ROOT ? path.join(ROOT, 'webclient/src/mapview/MapView.ts') : null;

const load = (p: string) => import(new URL('file://' + p.replace(/\\/g, '/')).href);

console.log('\nworld-map test');
console.log('  client core: ' + CLIENT_CORE + (ROOT ? '' : '  (payload; no LCLITE_ROOT)'));
console.log('  map core   : ' + MAP_CORE);
console.log('  MapView.ts : ' + (MAPVIEW_SRC ?? '(no LCLITE_ROOT — upstream cross-checks skipped)'));

const WM: any = await load(CLIENT_CORE);
const WC: any = await load(MAP_CORE);
const MAPVIEW: string | null = MAPVIEW_SRC && fs.existsSync(MAPVIEW_SRC) ? fs.readFileSync(MAPVIEW_SRC, 'utf-8') : null;

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra?: any) {
    if (cond) { pass++; console.log('  ✓ ' + msg); }
    else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}
const eq = (a: any, b: any, msg: string) => ok(a === b, msg + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')');
const near = (a: number, b: number, tol: number, msg: string) => ok(Math.abs(a - b) <= tol, msg + ' (' + a + ' ~ ' + b + ')');

// ---------------------------------------------------------------------------------
// 1. settings
// ---------------------------------------------------------------------------------
{
    const read = (m: Record<string, string>) => (k: string) => (k in m ? m[k] : null);
    const def = WM.worldMapSettings(read({}));
    eq(def.enabled, true, 'master defaults ON');
    eq(def.button, true, 'the orb defaults ON');
    eq(def.centre, true, 'centre-on-open defaults ON');

    eq(WM.worldMapSettings(read({ worldMap: 'false' })).enabled, false, "only the literal 'false' turns the master off");
    eq(WM.worldMapSettings(read({ worldMap: 'FALSE' })).enabled, true, 'a shouty FALSE does not (the client writes lowercase)');
    eq(WM.worldMapSettings(read({ worldMapButton: 'false' })).button, false, 'the orb can be switched off on its own');
    eq(WM.worldMapSettings(read({ worldMapCentre: 'false' })).centre, false, 'and so can centring');
    eq(WM.worldMapSettings(read({ worldMap: 'yes' })).enabled, true, 'any other value reads as ON');
    eq(WM.worldMapSettings(read({ worldMap: 'false' })).button, true, 'one key never turns another off');
}

// ---------------------------------------------------------------------------------
// 2. the orb's geometry
// ---------------------------------------------------------------------------------
const SIZE = WM.WORLD_MAP_BUTTON_SIZE;
const PW = WM.WORLD_MAP_PANEL_W;
const PH = WM.WORLD_MAP_PANEL_H;
{
    eq(SIZE, 21, 'the orb is 21px (ODD: the centre lands on a pixel)');
    eq(SIZE % 2, 1, 'and therefore odd');
    eq(WM.WORLD_MAP_ORIGIN_X, 550, 'the widget sits at canvas x 550');
    eq(WM.WORLD_MAP_ORIGIN_Y, 4, 'and canvas y 4');

    const box = WM.worldMapButtonBox('', '');
    // mods/wiki-lookup's own default: 3px clearance from the panel's right edge, same
    // bottom edge, 21px wide (its README + its harness pin the same numbers)
    const wikiLeft = PW - SIZE - 3;
    const wikiTop = PH - SIZE - 3;
    eq(box[1], wikiTop, 'the orb sits on the wiki orb’s own row (same top)');
    eq(box[0] + SIZE + 2, wikiLeft, 'with exactly a 2px gap to its left');
    ok(box[0] >= 0 && box[1] >= 0 && box[0] + SIZE <= PW && box[1] + SIZE <= PH, 'and inside the panel');

    eq(WM.worldMapButtonBox('TL', '0,0').slice(0, 2).join(','), '0,0', 'the TL anchor places the orb at the panel’s origin');
    // The BR anchor is the panel's CORNER plus the offset, so -3,-3 is the corner 3px in
    // and then clamped FLUSH (151,135) — the same clamp the wiki orb's own box has. The
    // 3px-inset spot is the DEFAULT (no keys stored), which is why the documented def
    // pair is -47,-3: that lands exactly on it, so the panel's documentation and the
    // box agree.
    eq(WM.worldMapButtonBox('BR', '-3,-3').slice(0, 2).join(','), String(PW - SIZE) + ',' + String(PH - SIZE), 'BR + -3,-3 clamps flush to the panel corner');
    eq(WM.worldMapButtonBox('BR', WM.WORLD_MAP_OFFSET_DEF).slice(0, 2).join(','), box.slice(0, 2).join(','), 'and the documented def pair lands on the default spot');
    eq(WM.worldMapButtonBox('MC', '0,0')[0], Math.round(PW * 0.5), 'the MC anchor resolves through the parallel anchor arrays');
    eq(WM.worldMapButtonBox('nope', '5,5').slice(0, 2).join(','), box.slice(0, 2).join(','), 'an unknown anchor falls back to the default spot, not to garbage');
    eq(WM.worldMapButtonBox('TL', 'garbage')[0], 0, 'a garbage offset reads as 0');
    eq(WM.worldMapButtonBox('BR', '9999,9999')[0], PW - SIZE, 'and the box clamps flush to the panel');
    eq(WM.worldMapButtonBox('TL', '-9999,-9999')[1], 0, 'on both axes');

    ok(WM.worldMapButtonHit(box[0], box[1], box), 'the hit test takes the top-left pixel');
    ok(WM.worldMapButtonHit(box[0] + SIZE - 1, box[1] + SIZE - 1, box), 'and the bottom-right one');
    ok(!WM.worldMapButtonHit(box[0] - 1, box[1], box), 'one pixel left is outside');
    ok(!WM.worldMapButtonHit(box[0], box[1] + SIZE, box), 'one pixel below is outside');
    ok(!WM.worldMapButtonHit(box[0] + SIZE, box[1], box), 'the far edge is half-open (exactly 21x21 clicks)');
    eq(WM.WORLD_MAP_ANCH_NAMES.length, WM.WORLD_MAP_ANCH.length, 'the anchor names and offsets are parallel arrays');
}

// ---------------------------------------------------------------------------------
// 3. the orb's pixels
// ---------------------------------------------------------------------------------
const SENT = 0x123456;
function freshPanel() {
    const px = new Int32Array(PW * PH);
    px.fill(SENT);
    return px;
}
function pixelsOutside(px: Int32Array, box: number[], sent: number) {
    const out: number[] = [];
    for (let y = 0; y < PH; y++) {
        for (let x = 0; x < PW; x++) {
            const inBox = x >= box[0] && x < box[0] + box[2] && y >= box[1] && y < box[1] + box[3];
            if (!inBox && px[x + y * PW] !== sent) out.push(x, y);
        }
    }
    return out;
}
{
    const box = WM.worldMapButtonBox('', '');
    const idle = freshPanel();
    WM.worldMapDrawButton(idle, PW, PH, box[0], box[1], box[2], false, false, 0);

    eq(pixelsOutside(idle, box, SENT).length, 0, 'nothing is painted outside the orb’s box');
    const painted = idle.filter((c: number) => c !== SENT);
    ok(painted.every((c: number) => c !== 0), 'no pixel is written as 0 (0 is a hole in the panel stone)');
    ok(painted.every((c: number) => c > 0), 'every written pixel is a positive opaque colour');
    eq(painted.length, 317, 'the disc + rim fill 317 of the 441 box pixels (the square corners stay stone)');

    const hover = freshPanel();
    WM.worldMapDrawButton(hover, PW, PH, box[0], box[1], box[2], false, true, 0);
    let hoverDiff = 0;
    for (let i = 0; i < idle.length; i++) if (idle[i] !== hover[i]) hoverDiff++;
    ok(hoverDiff > 20, 'hover repaints the rim (' + hoverDiff + ' pixels)');

    const openA = freshPanel();
    WM.worldMapDrawButton(openA, PW, PH, box[0], box[1], box[2], true, false, 0);
    let openDiff = 0;
    for (let i = 0; i < idle.length; i++) if (idle[i] !== openA[i]) openDiff++;
    ok(openDiff > 200, 'the open state repaints the glass and the rim (' + openDiff + ' pixels)');

    const openB = freshPanel();
    WM.worldMapDrawButton(openB, PW, PH, box[0], box[1], box[2], true, false, 8);
    let pulseDiff = 0;
    for (let i = 0; i < openA.length; i++) if (openA[i] !== openB[i]) pulseDiff++;
    ok(pulseDiff > 80, 'and pulses on a 16-tick period (' + pulseDiff + ' glass pixels between tick 0 and 8)');
    const openC = freshPanel();
    WM.worldMapDrawButton(openC, PW, PH, box[0], box[1], box[2], true, false, 16);
    eq(openA.join(','), openC.join(','), 'tick 16 is tick 0 again (period 16)');

    eq(WM.WORLD_MAP_GLYPH.length, 49, 'the glyph is a 7x7 table (a 52-char table drew nothing in stat-orbs once)');
    ok(/^[01]+$/.test(WM.WORLD_MAP_GLYPH), 'and holds only ink/no-ink digits');
    const ink = WM.WORLD_MAP_GLYPH.split('').filter((c: string) => c === '1').length;
    ok(ink >= 24 && ink <= 40, 'the globe fills the disc without becoming a blob (' + ink + ' of 49 ink)');
    eq(WM.WORLD_MAP_GLYPH[0], '0', 'its corners are empty (it reads as a sphere, not a square)');
    eq(WM.WORLD_MAP_GLYPH[24], '1', 'its centre is inked');

    const glyphInk = idle.filter((c: number) => c === 0xf7f3e8).length;
    eq(glyphInk, ink, 'every glyph pixel is painted in the idle ink colour');

    // a 7px-wide glyph must not be drawn into a glass too small for it
    const tiny = freshPanel();
    WM.worldMapDrawButton(tiny, PW, PH, 0, 0, 7, false, false, 0);
    eq(tiny.filter((c: number) => c === 0xf7f3e8).length, 0, 'a too-small glass gets no glyph (guarded on innerR >= 7)');

    // and the clip: an orb dragged half off the panel must not write out of bounds
    const clipped = freshPanel();
    WM.worldMapDrawButton(clipped, PW, PH, -6, -6, SIZE, false, false, 0);
    ok(true, 'drawing at a negative origin does not throw');
    eq(pixelsOutside(clipped, [-6, -6, SIZE, SIZE], SENT).length, 0, 'and paints nothing outside its (clipped) box');
}

// ---------------------------------------------------------------------------------
// 4. the page payload
// ---------------------------------------------------------------------------------
{
    const p = WM.worldMapPlayerPayload(3222, 3222, 0, true);
    ok(Array.isArray(p), 'the payload is an ARRAY (an object literal’s keys mangle across the boundary)');
    eq(p.length, 4, 'with 4 slots');
    eq(p[0], 3222, 'x in slot 0');
    eq(p[1], 3222, 'z in slot 1');
    eq(p[2], 0, 'level in slot 2');
    eq(p[3], 1, 'and a 1/0 valid flag in slot 3');
    eq(WM.worldMapPlayerPayload(0, 0, 0, false)[3], 0, 'an invalid read is a 0 flag, never undefined');
    ok(p.every((v: number) => typeof v === 'number' && isFinite(v)), 'every slot is a finite number (nothing to mangle)');
}

// ---------------------------------------------------------------------------------
// 5. the map app's area table, re-derived from MapView.ts
// ---------------------------------------------------------------------------------
function reloadConstants(name: string): { originX: number; originZ: number; width: number; height: number } | null {
    if (!MAPVIEW) return null;
    const start = MAPVIEW.indexOf('async ' + name + '(');
    if (start < 0) return null;
    const block = MAPVIEW.slice(start, start + 1200);
    const num = (key: string): number => {
        const m = new RegExp('this\\.' + key + ' = ([^;]+);').exec(block);
        if (!m) throw new Error('no ' + key + ' in ' + name);
        // eslint-disable-next-line no-eval
        return eval(m[1]);
    };
    return { originX: num('mapOriginX'), originZ: num('mapOriginZ'), width: num('mapWidth'), height: num('mapHeight') };
}
{
    eq(WC.WORLD_MAP_AREA_NAMES.length, 3, 'three sheets: main, dungeon, extra');
    ok(WC.WORLD_MAP_AREA_ORIGIN_X.length === 3 && WC.WORLD_MAP_AREA_ORIGIN_Z.length === 3, 'with parallel origin arrays');
    ok(WC.WORLD_MAP_AREA_WIDTH.length === 3 && WC.WORLD_MAP_AREA_HEIGHT.length === 3, 'and parallel size arrays');

    const pairs = [['reloadMain', 0], ['reloadDungeon', 1], ['reloadExtra', 2]] as [string, number][];
    for (const [fn, i] of pairs) {
        const c = reloadConstants(fn);
        if (!c) {
            ok(false, 'MapView.ts has ' + fn + ' (needed to re-derive the area table)');
            continue;
        }
        eq(WC.WORLD_MAP_AREA_ORIGIN_X[i], c.originX, fn + ': the mod’s originX matches MapView’s own');
        eq(WC.WORLD_MAP_AREA_ORIGIN_Z[i], c.originZ, fn + ': originZ matches');
        eq(WC.WORLD_MAP_AREA_WIDTH[i], c.width, fn + ': width matches');
        eq(WC.WORLD_MAP_AREA_HEIGHT[i], c.height, fn + ': height matches');
    }
    if (!MAPVIEW) {
        console.log('  · MapView.ts cross-checks skipped (no LCLITE_ROOT): the area table is only asserted for shape');
    }
}

// ---------------------------------------------------------------------------------
// 6. world -> map coordinates, and the marker's screen geometry
// ---------------------------------------------------------------------------------
{
    // Lumbridge (3222, 3222) is on the main sheet; the map's z axis is FLIPPED
    eq(WC.worldMapAreaAt(3222, 3222), 0, 'Lumbridge is on the main sheet');
    eq(WC.worldMapAreaAt(3222, 9600), 1, 'a z of ~9600 (the underground) is the dungeon sheet');
    eq(WC.worldMapAreaAt(2200, 4500), 2, 'and the southern extra sheet is its own');
    eq(WC.worldMapAreaAt(54, 50), -1, 'Tutorial Island’s cutscene region is on NO sheet (no marker, no centre)');
    eq(WC.worldMapAreaAt(WC.WORLD_MAP_AREA_ORIGIN_X[0], WC.WORLD_MAP_AREA_ORIGIN_Z[0]), 0, 'the main sheet includes its own top-left corner tile');
    eq(WC.worldMapAreaAt(WC.WORLD_MAP_AREA_ORIGIN_X[0] + WC.WORLD_MAP_AREA_WIDTH[0], 3000), -1, 'and excludes the tile past its right edge');

    const p = WC.worldMapMapPoint(3222, 3222, WC.WORLD_MAP_AREA_ORIGIN_X[0], WC.WORLD_MAP_AREA_ORIGIN_Z[0], WC.WORLD_MAP_AREA_HEIGHT[0]);
    eq(p[0], 3222 - 2048, 'map x = world x - originX');
    eq(p[1], 2624 + 1408 - 3222, 'map z = originZ + height - world z (the flip)');
    ok(p[0] >= 0 && p[1] >= 0 && p[0] < WC.WORLD_MAP_AREA_WIDTH[0] && p[1] < WC.WORLD_MAP_AREA_HEIGHT[0], 'and the result is inside the sheet');

    // mainredraw: left = focusX - (sWid / zoom), and renderWorldMap maps the span onto
    // sWid with widthRatio = (sWid << 16) / (right - left) -> screen px per map tile = zoom / 2
    const sWid = 765, sHei = 503, zoom = 4, focusX = 1152, focusZ = 832;
    const left = focusX - ((sWid / zoom) | 0);
    const top = focusZ - ((sHei / zoom) | 0);
    const s = WC.worldMapMarkerScreen(focusX, focusZ, left, top, zoom, sWid, sHei);
    eq(s[0], sWid >> 1, 'the focus point lands at the centre of the canvas (x)');
    // the window is (sWid / zoom) | 0 wide, so at 503/4 the vertical half is 125 and the
    // focus lands 1px above the geometric middle — the app's own arithmetic, not ours
    eq(s[1], 250, 'and within a pixel of the centre on y (the window truncates 503/4 to 125)');
    eq(s[2], 1, 'and is on screen');
    const s2 = WC.worldMapMarkerScreen(focusX + 10, focusZ, left, top, zoom, sWid, sHei);
    eq(s2[0] - s[0], 20, 'zoom 4 = 2 screen px per map tile (10 tiles -> 20 px)');
    const left8 = focusX - ((sWid / 8) | 0);
    const a8 = WC.worldMapMarkerScreen(focusX, focusZ, left8, top, 8, sWid, sHei);
    const b8 = WC.worldMapMarkerScreen(focusX + 10, focusZ, left8, top, 8, sWid, sHei);
    eq(b8[0] - a8[0], 40, 'zoom 8 = 4 screen px per map tile');
    const off = WC.worldMapMarkerScreen(left - 50, top - 50, left, top, zoom, sWid, sHei);
    eq(off[2], 0, 'a point outside the window reports off-screen (nothing is drawn)');
    const f = WC.worldMapFocusFor(p[0], p[1]);
    eq(f[0] + ',' + f[1], p[0] + ',' + p[1], 'the focus for a map point is that point (mainredraw centres on focusX/focusZ)');
}

// ---------------------------------------------------------------------------------
// 7. the marker's pixels and its caption
// ---------------------------------------------------------------------------------
{
    const px = new Int32Array(80 * 80);
    px.fill(SENT);
    const cx = 40, cy = 40;
    WC.worldMapDrawMarker(px, 80, 80, cx, cy, 0);

    const drawn = px.filter((c: number) => c !== SENT);
    ok(drawn.length > 60 && drawn.length < 100, 'the marker inks a compact disc (' + drawn.length + ' px)');
    ok(drawn.every((c: number) => c === 0x000000 || c === 0xffffff || c === 0x9c2a20 || c === 0xd23b2e), 'in its own four colours only');
    eq(px[cx + cy * 80], 0xffffff, 'its centre is white (findable at any zoom)');
    eq(px[cx + (cy - 5) * 80], 0x000000, 'and its outer ring is the hard black outline');

    let outside = 0;
    for (let y = 0; y < 80; y++) {
        for (let x = 0; x < 80; x++) {
            const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
            if (d2 > WC.WORLD_MAP_MARKER_RADIUS * WC.WORLD_MAP_MARKER_RADIUS && px[x + y * 80] !== SENT) outside++;
        }
    }
    eq(outside, 0, 'nothing is painted outside the marker radius');
    ok(px.every((c: number) => c !== 0 || true), 'and every written pixel is opaque (no alpha on a once-painted surface)');

    const pulse = new Int32Array(80 * 80);
    pulse.fill(SENT);
    WC.worldMapDrawMarker(pulse, 80, 80, cx, cy, 8);
    let diff = 0;
    for (let i = 0; i < px.length; i++) if (px[i] !== pulse[i]) diff++;
    ok(diff > 10, 'the core pulses on a 16-tick period (' + diff + ' px)');

    const label = WC.worldMapMarkerLabel(cx, cy, 765, 0);
    eq(label[0], 'You are here', 'the caption on the surface says what it is');
    eq(label[3], 0xffffff, 'in white');
    eq(label[2], cy + 14, 'placed under the marker (so it never covers it)');
    const deep = WC.worldMapMarkerLabel(cx, cy, 765, 2);
    ok(String(deep[0]).indexOf('level 3') >= 0, 'underground it names the level (0-based 2 -> “level 3”)');
    const edge = WC.worldMapMarkerLabel(3, cy, 765, 0);
    ok(Number(edge[1]) > 3, 'the caption is clamped inside the canvas at the left edge');
    const edge2 = WC.worldMapMarkerLabel(762, cy, 765, 0);
    ok(Number(edge2[1]) < 762, 'and at the right edge');
}

// ---------------------------------------------------------------------------------
// 8. the page bridge: commands and the state array
// ---------------------------------------------------------------------------------
{
    const cmds: [number[], string][] = [
        [[WC.WORLD_MAP_CMD_PLAYER, 3222, 3222, 0], 'player'],
        [[WC.WORLD_MAP_CMD_AREA, 1], 'area'],
        [[WC.WORLD_MAP_CMD_LAYER, 0, 1], 'layer'],
        [[WC.WORLD_MAP_CMD_CENTRE], 'centre'],
        [[WC.WORLD_MAP_CMD_STATE], 'state'],
        [[WC.WORLD_MAP_CMD_ZOOM, 8], 'zoom'],
        [[WC.WORLD_MAP_CMD_JAG, 1], 'jag']
    ];
    for (const [cmd, name] of cmds) {
        const c = WC.worldMapCommand(cmd);
        ok(c !== null && c.op === cmd[0], 'the ' + name + ' command parses');
    }

    const p = WC.worldMapCommand([WC.WORLD_MAP_CMD_PLAYER, 3222, 3218, 2]);
    eq(p.a, 3222, 'player x reaches a');
    eq(p.b, 3218, 'player z reaches b');
    eq(p.c, 2, 'player level reaches c');

    ok(WC.worldMapCommand(null) === null, 'null is not a command');
    ok(WC.worldMapCommand('player') === null, 'nor is a string');
    ok(WC.worldMapCommand([]) === null, 'nor an empty array');
    ok(WC.worldMapCommand([0]) === null, 'op 0 is out of range');
    ok(WC.worldMapCommand([99]) === null, 'and so is an unknown op');
    ok(WC.worldMapCommand([WC.WORLD_MAP_CMD_AREA, 3]) === null, 'an area index past the sheets is refused (the page cannot move the map to nowhere)');
    ok(WC.worldMapCommand([WC.WORLD_MAP_CMD_LAYER, 9, 1]) === null, 'and so is an unknown layer');
    ok(WC.worldMapCommand([WC.WORLD_MAP_CMD_ZOOM, NaN]) === null, 'NaN is refused');
    ok(WC.worldMapCommand([WC.WORLD_MAP_CMD_CENTRE]) !== null, 'a command with no arguments is fine');

    const state = WC.worldMapStatePayload(0, 1152, 832, 4, [1, 0, 1, 0, 1, 0], 1, false);
    eq(state.length, 12, 'the state array has its 12 documented slots');
    eq(state[0], 0, '[0] the sheet on screen');
    eq(state[1], 1152, '[1] focusX');
    eq(state[2], 832, '[2] focusZ');
    eq(state[3], 4, '[3] zoom');
    eq(state.slice(4, 10).join(','), '1,0,1,0,1,0', '[4..9] the six layer flags, in LAYER_NAMES order');
    eq(state[10], 1, '[10] the sheet the PLAYER is on');
    eq(state[11], 0, '[11] and whether the marker can be drawn here');

    eq(WC.WORLD_MAP_LAYER_NAMES.length, 6, 'six layers are switchable');
    eq(WC.WORLD_MAP_LAYER_NAMES.length, WC.WORLD_MAP_LAYER_FLAGS.length, 'names and MapView flag names are parallel arrays');
    eq(WC.WORLD_MAP_JAG_URLS[0], '/worldmap.jag', 'the map data is read from the engine’s own route first');
    eq(WC.WORLD_MAP_JAG_URLS[1], '/client/worldmap.jag', 'and from the deployed static copy second (a live world has no debug route)');
}

// ---------------------------------------------------------------------------------
// 9. the upstream assumptions, read out of MapView.ts itself
// ---------------------------------------------------------------------------------
if (MAPVIEW) {
    for (const flag of WC.WORLD_MAP_LAYER_FLAGS) {
        ok(MAPVIEW.indexOf('static ' + flag + ': boolean') >= 0, 'MapView still declares static ' + flag);
    }
    ok(MAPVIEW.indexOf("data = await downloadUrl(WORLD_MAP_JAG_URLS[this.worldMapJagIndex]") >= 0, 'loadWorldmap reads the URL the page chose (the mod’s replace hunk is in place)');
    ok(MAPVIEW.indexOf('worldMapUi(cmd: unknown)') >= 0, 'the page’s ONE reserved entry point exists');
    ok(MAPVIEW.indexOf('this.worldMapMarkerDraw();') >= 0, 'and the marker is drawn in mainredraw, in the map’s own pass');
    ok(MAPVIEW.indexOf("(window as any)['worldMapUi']") >= 0, 'the entry point is bound on window for the page');
    ok(MAPVIEW.indexOf('worldMapPlayerX: number = -1') >= 0, 'the player state starts unknown (-1), so nothing is drawn before the first update');
} else {
    console.log('  · upstream checks skipped (set LCLITE_ROOT to a patched install to run them)');
}

// ---------------------------------------------------------------------------------
// an ASCII render, so a human can eyeball the shapes without the game
// ---------------------------------------------------------------------------------
{
    const box = WM.worldMapButtonBox('', '');
    const px = freshPanel();
    WM.worldMapDrawButton(px, PW, PH, box[0], box[1], box[2], false, false, 0);
    let art = '';
    for (let y = box[1] - 1; y < box[1] + box[3] + 1; y++) {
        let line = '';
        for (let x = box[0] - 1; x < box[0] + box[2] + 1; x++) {
            const c = px[x + y * PW];
            line += c === SENT ? '.' : (c === 0x0a0a0a ? '#' : (c === 0xf7f3e8 ? '@' : (c === 0x161310 ? ' ' : (c === 0x2b2721 ? ':' : (c === 0x7d7466 ? '+' : '/')))));
        }
        art += '\n    ' + line;
    }
    console.log('\nthe idle world orb, as pixels (box ' + box.join(',') + ', panel ' + PW + 'x' + PH + '):' + art);

    const mpx = new Int32Array(15 * 15);
    mpx.fill(SENT);
    WC.worldMapDrawMarker(mpx, 15, 15, 7, 7, 0);
    let mart = '';
    for (let y = 0; y < 15; y++) {
        let line = '';
        for (let x = 0; x < 15; x++) {
            const c = mpx[x + y * 15];
            line += c === SENT ? '.' : (c === 0x000000 ? '#' : (c === 0xffffff ? '@' : (c === 0x9c2a20 ? 'o' : '*')));
        }
        mart += '\n    ' + line;
    }
    console.log('\nthe player marker, as pixels:' + mart + '\n');
}

console.log(`${fail === 0 ? '✓ all green' : '✗ FAILURES'}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
