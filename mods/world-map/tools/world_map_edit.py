#!/usr/bin/env python3
"""mods/world-map/tools/world_map_edit.py — write the world-map hunks into a live tree.

    python mods/world-map/tools/world_map_edit.py [<install root>]

<install root> defaults to $LCLITE_ROOT (or, failing that, argv[1] is required). It is
the tree that holds webclient/ and engine/ — i.e. %LOCALAPPDATA%/LCLite/installs/<rev>.

WHY A SCRIPT. The mod patches four files and the edit sites are far apart; doing it by
hand is how a duplicated method (TS2393) or a flattened CRLF file gets committed. This
script is IDEMPOTENT BY REGION, not by exact block text: every block is delimited by
`// lclite:world-map <site>` … `// lclite:world-map end <site>` (HTML comments in the
ejs), so a rerun strips its own copy and re-inserts it, and the second run is
byte-identical to the first. Every anchor is asserted to match EXACTLY once, and the
whole file is left byte-identical in its line endings (the checkout is CRLF; patch JSONs
store LF — a whole-file text rewrite flattens it and trips doctor).

NOT part of the mod's runtime: `apply` copies files/ and inserts the patch JSONs. This
script exists to (re)build the tree state those JSONs are generated from — after a
revision port, an anchor reseat, or on a fresh clone.
"""

import os
import sys

MOD = 'world-map'
OPEN = '// lclite:' + MOD
CLOSE = '// lclite:' + MOD + ' end'
HOPEN = '<!-- lclite:' + MOD
HCLOSE = '<!-- lclite:' + MOD + ' end'

# ---------------------------------------------------------------------------------
# block bodies (the code that lands in the tree)
# ---------------------------------------------------------------------------------

CLIENT_IMPORT = [
    "import {",
    "    WORLD_MAP_ORIGIN_X, WORLD_MAP_ORIGIN_Y, worldMapButtonBox, worldMapButtonHit,",
    "    worldMapDrawButton, worldMapPlayerPayload, worldMapRead, worldMapSettings",
    "} from '#/client/WorldMap.js';",
]

CLIENT_PARKED = [
    "    /// custom (lclite \"world-map\" mod): the minimap world orb — the way into the",
    "    /// client's OWN world map app (webclient/src/mapview/MapView.ts, built to",
    "    /// out/mapview.js by `bun run bundle.ts` and loaded by nothing upstream).",
    "    ///",
    "    /// The orb is drawn into the minimap WIDGET's own buffer (the `areaMap` PixMap",
    "    /// composited onto the canvas at 550,4), exactly like mods/stat-orbs' orbs and",
    "    /// mods/wiki-lookup's orb, so it rides the interface and the gpu mod's HUD upload",
    "    /// for free. Its default spot is immediately LEFT of the wiki orb (a 2px gap); both",
    "    /// are alt-draggable through the panel's placement platform, and this orb's own",
    "    /// surface is registered as 'world-map'.",
    "    ///",
    "    /// The map itself is a DOM overlay (the mod's page script,",
    "    /// engine/public/lclite/worldmap/ui.js) holding an IFRAME, because the map app is a",
    "    /// second GameShell: it takes `#canvas` at module load and runs its own loop, so it",
    "    /// needs its own document. The two realms talk over reserved window names",
    "    /// (docs/MODS.md §The contract): the page reads window['worldMapPlayer']() for the",
    "    /// live position, and this side calls window['worldMapToggle'](centre) to open or",
    "    /// close. Both fail OPEN when the page script is missing (a stripped hunk, a stale",
    "    /// cache), so a half-updated install loses the map, never the game.",
    "    ///",
    "    /// Settings are this mod's OWN keys, read per frame at these hooks (rule 5):",
    "    ///   worldMap          on/off master (default on)",
    "    ///   worldMapButton    the minimap world orb (default on)",
    "    ///   worldMapCentre    centre the map on the player when it opens (default on)",
    "    /// The parse, the orb's geometry/pixels and the player payload live in the mod's",
    "    /// files/ payload (WorldMap.ts), so mods/world-map/tools/world_map_test.ts",
    "    /// exercises the real shipped logic headlessly — the orb's pixels included.",
    "    private worldMapApiBound: boolean = false;",
    "",
    "    /// custom: what the widget buffer currently holds of ours (box + on/off). A change",
    "    /// means abandoned pixels, which the mapback re-plot wipes.",
    "    private worldMapSig: string = '';",
    "",
    "    /// custom: the orb's live box, in the minimap widget's own 172x156 space, from the",
    "    /// placement keys the panel's drag layer writes (alt+drag; the owner reads its own",
    "    /// keys — rule 5). No keys stored = the default spot, left of the wiki orb.",
    "    private worldMapBox(): number[] {",
    "        return worldMapButtonBox(",
    "            localStorage.getItem('lcmWorldMapAnchor') || '',",
    "            localStorage.getItem('lcmWorldMapOffset') || ''",
    "        );",
    "    }",
    "",
    "    /// custom: is the canvas point (this.mouseX/mouseY space) on the orb?",
    "    private worldMapOver(mx: number, my: number, box: number[]): boolean {",
    "        return worldMapButtonHit(mx - WORLD_MAP_ORIGIN_X, my - WORLD_MAP_ORIGIN_Y, box);",
    "    }",
    "",
    "    /// custom: is the map overlay up? Asked of the DOM, which is where the state really",
    "    /// lives (the page owns the overlay, and its own Close button removes it) — so the",
    "    /// orb's highlight can never disagree with what the player sees.",
    "    private worldMapShowing(): boolean {",
    "        return typeof document !== 'undefined' && document.getElementById('lcwm-root') !== null;",
    "    }",
    "",
    "    /// custom: the orb's click hook, run at the top of the in-game loop before the",
    "    /// engine's own click handling (mouseLoop and minimapLoop included), and it CONSUMES",
    "    /// its click — so clicking the orb can never also walk the minimap or open a menu.",
    "    private worldMapLoop(): void {",
    "        if (this.mouseClickButton !== 1) {",
    "            return;",
    "        }",
    "",
    "        const settings = worldMapSettings(worldMapRead);",
    "        if (!settings.enabled || !settings.button) {",
    "            return;",
    "        }",
    "",
    "        if (!this.worldMapOver(this.mouseClickX, this.mouseClickY, this.worldMapBox())) {",
    "            return;",
    "        }",
    "",
    "        this.mouseClickButton = 0;              // the orb owns this click",
    "",
    "        const W: any = window as any;",
    "        W['worldMapToggle']?.(settings.centre ? 1 : 0);",
    "    }",
    "",
    "    /// custom: the orb's pixels. Our pixels live in the minimap WIDGET's buffer, and",
    "    /// this runs after gameDraw() has composited that buffer onto the canvas — so the",
    "    /// orb appears one frame (~16ms) after a state change, and nothing another mod draws",
    "    /// into the widget can be overwritten by us in the same frame. The mapback re-plot on",
    "    /// a real change (a moved orb, a switched-off orb) is the stale-pixel wipe every mod",
    "    /// on this panel uses: the map window and compass are transparent holes in the",
    "    /// mapback, so re-plotting it disturbs neither.",
    "    private worldMapDraw(): void {",
    "        const settings = worldMapSettings(worldMapRead);",
    "        const box: number[] = this.worldMapBox();",
    "        const on: boolean = settings.enabled && settings.button;",
    "",
    "        const sig: string = box.join(',') + ',' + (on ? '1' : '0');",
    "        const wipe: boolean = sig !== this.worldMapSig && this.worldMapSig !== '';",
    "        this.worldMapSig = sig;",
    "",
    "        const prevPixels: Int32Array = Pix2D.pixels;",
    "        const prevW: number = Pix2D.width;",
    "        const prevH: number = Pix2D.height;",
    "        this.areaMap?.setPixels();",
    "",
    "        if (wipe) {",
    "            this.mapback?.plotSprite(0, 0);",
    "        }",
    "",
    "        if (on) {",
    "            const hover: boolean = this.worldMapOver(this.mouseX, this.mouseY, box);",
    "            worldMapDrawButton(Pix2D.pixels, Pix2D.width, Pix2D.height, box[0], box[1], box[2], this.worldMapShowing(), hover, (performance.now() / 100) | 0);",
    "        }",
    "",
    "        Pix2D.setPixels(prevPixels, prevW, prevH);",
    "",
    "        this.worldMapApi();",
    "    }",
    "",
    "    /// custom: the page bridge + the placement surface, bound once. Both are cross-realm",
    "    /// names, so both are terser-reserved in bundle.ts (a bundled READ of an unreserved",
    "    /// name is the silent failure: it compares the mangled property against the plain",
    "    /// name and gets undefined with no error).",
    "    private worldMapApi(): void {",
    "        const W: any = window as any;",
    "        if (this.worldMapApiBound || !W['lcmAnchor']) {",
    "            return;",
    "        }",
    "        this.worldMapApiBound = true;",
    "",
    "        /// the page's live player readout: POSITIONAL (an object literal's keys are",
    "        /// renamed on the way across the boundary). [x, z, level, valid], world TILES.",
    "        /// The client keeps entities in SCENE coordinates, so the world tile is the",
    "        /// scene tile plus the build base — the same conversion the engine does",
    "        /// ((this.localPlayer.x >> 7) + this.mapBuildBaseX, the hint arrow's own).",
    "        W['worldMapPlayer'] = (): number[] => {",
    "            const s = worldMapSettings(worldMapRead);",
    "            if (!s.enabled || !this.localPlayer) {",
    "                return worldMapPlayerPayload(0, 0, 0, false);",
    "            }",
    "            return worldMapPlayerPayload((this.localPlayer.x >> 7) + this.mapBuildBaseX, (this.localPlayer.z >> 7) + this.mapBuildBaseZ, this.minusedlevel, true);",
    "        };",
    "",
    "        /// the placement platform's view of our live box (null while the orb is off, so",
    "        /// alt+drag can never grab an invisible surface). Region = the minimap widget",
    "        /// (areaMap at 550,4), the hard boundary the drag clamps into.",
    "        W['lcmWorldMapBounds'] = (): number[] | null => {",
    "            const s = worldMapSettings(worldMapRead);",
    "            return s.enabled && s.button ? this.worldMapBox() : null;",
    "        };",
    "        W['lcmAnchor']['registerCanvas']?.(['world-map', 'lcmWorldMapAnchor', 'lcmWorldMapOffset', 'BR', '-47,-24', () => (W['lcmWorldMapBounds'] ? W['lcmWorldMapBounds']() : null), [550, 4, 172, 156, 172, 156]]);",
    "    }",
]

CLIENT_CLICK = [
    "        /// custom (lclite \"world-map\" mod): the minimap world orb's click, consumed",
    "        /// before the engine's own click loops run (see worldMapLoop).",
    "        this.worldMapLoop();",
]

CLIENT_DRAW = [
    "        /// custom (lclite \"world-map\" mod): the minimap world orb, painted into the",
    "        /// minimap widget's own buffer after gameDraw() composited it (see worldMapDraw).",
    "        this.worldMapDraw();",
]

MAPVIEW_IMPORT = [
    "import {",
    "    WORLD_MAP_CMD_AREA, WORLD_MAP_CMD_CENTRE, WORLD_MAP_CMD_JAG, WORLD_MAP_CMD_LAYER,",
    "    WORLD_MAP_CMD_PLAYER, WORLD_MAP_CMD_STATE, WORLD_MAP_CMD_ZOOM, WORLD_MAP_JAG_URLS,",
    "    worldMapAreaAt, worldMapCommand, worldMapDrawMarker, worldMapFocusFor, worldMapMapPoint,",
    "    worldMapMarkerLabel, worldMapMarkerScreen, worldMapStatePayload",
    "} from '#/mapview/WorldMapCore.js';",
]

# the one upstream LINE this mod replaces rather than adds around: which jag to read.
# A replace site is symmetric — the strip puts the original line back — so a rerun is
# byte-identical.
MAPVIEW_JAG_OLD = "                data = await downloadUrl('/worldmap.jag');"
MAPVIEW_JAG_NEW = [
    "                /// custom (lclite \"world-map\" mod): the map data URL. The engine's own",
    "                /// /worldmap.jag route is registered INSIDE `if (Environment.node.debug)`",
    "                /// (engine/src/web.ts), so it exists on a dev world and 404s on a live",
    "                /// one; the mod's page probes WORLD_MAP_JAG_URLS and sends the index it",
    "                /// found (WORLD_MAP_CMD_JAG) before the app is booted.",
    "                data = await downloadUrl(WORLD_MAP_JAG_URLS[this.worldMapJagIndex] || WORLD_MAP_JAG_URLS[0]);",
]

MAPVIEW_PARKED = [
    "    /// custom (lclite \"world-map\" mod): the player marker and the page bridge.",
    "    ///",
    "    /// The map app is a standalone GameShell (this class) that nothing upstream loads;",
    "    /// the mod's page script boots it inside an IFRAME overlay and drives it through ONE",
    "    /// reserved entry point — `worldMapUi(cmd)` — with POSITIONAL command arrays, so the",
    "    /// page never needs to know this class's mangled method names and no object literal",
    "    /// crosses the bundle boundary (docs/MODS.md §The contract).",
    "    ///",
    "    /// The command ops and the state array's index map live in the mod's files/ payload",
    "    /// (WorldMapCore.ts), which the harness exercises headlessly — including the area",
    "    /// table, which the harness re-derives from THIS file's own reloadMain/",
    "    /// reloadDungeon/reloadExtra and asserts equal, so it cannot drift from the app.",
    "    worldMapPlayerX: number = -1;",
    "    worldMapPlayerZ: number = -1;",
    "    worldMapPlayerLevel: number = 0;",
    "    worldMapJagIndex: number = 0;",
    "    worldMapApiBound: boolean = false;",
    "",
    "    /// custom: the page's command surface. Every op answers with the current state, so",
    "    /// the page renders from the truth rather than from what it asked for.",
    "    worldMapUi(cmd: unknown): number[] {",
    "        this.worldMapBindApi();",
    "",
    "        const c = worldMapCommand(cmd);",
    "        if (!c) {",
    "            return this.worldMapState();",
    "        }",
    "",
    "        if (c.op === WORLD_MAP_CMD_PLAYER) {",
    "            const moved: boolean = c.a !== this.worldMapPlayerX || c.b !== this.worldMapPlayerZ;",
    "            this.worldMapPlayerX = c.a;",
    "            this.worldMapPlayerZ = c.b;",
    "            this.worldMapPlayerLevel = c.c;",
    "            if (moved) {",
    "                this.redraw = true;     // the marker follows the player, at the page's poll rate",
    "            }",
    "        } else if (c.op === WORLD_MAP_CMD_AREA) {",
    "            this.worldMapShowArea(c.a);",
    "        } else if (c.op === WORLD_MAP_CMD_LAYER) {",
    "            if (c.a === 0) {",
    "                MapView.shouldDrawNpcs = c.b !== 0;",
    "            } else if (c.a === 1) {",
    "                MapView.shouldDrawItems = c.b !== 0;",
    "            } else if (c.a === 2) {",
    "                MapView.shouldDrawLabels = c.b !== 0;",
    "            } else if (c.a === 3) {",
    "                MapView.shouldDrawBorders = c.b !== 0;",
    "            } else if (c.a === 4) {",
    "                MapView.shouldDrawMultimap = c.b !== 0;",
    "            } else if (c.a === 5) {",
    "                MapView.shouldDrawFreemap = c.b !== 0;",
    "            }",
    "            this.redraw = true;",
    "        } else if (c.op === WORLD_MAP_CMD_CENTRE) {",
    "            this.worldMapCentreOnPlayer();",
    "        } else if (c.op === WORLD_MAP_CMD_ZOOM) {",
    "            if (c.a === 3 || c.a === 4 || c.a === 6 || c.a === 8) {",
    "                this.targetZoom = c.a;",
    "                this.redraw = true;",
    "            }",
    "        } else if (c.op === WORLD_MAP_CMD_JAG) {",
    "            if (c.a >= 0 && c.a < WORLD_MAP_JAG_URLS.length) {",
    "                this.worldMapJagIndex = c.a;",
    "            }",
    "        }",
    "",
    "        return this.worldMapState();",
    "    }",
    "",
    "    /// custom: switch the sheet on screen. The app's own reload* methods re-run",
    "    /// maininit() (they re-read the whole jag), so they are async and idempotent per",
    "    /// area — and they are the ONLY place the area constants live, which is why the mod",
    "    /// calls them rather than setting the fields itself.",
    "    worldMapShowArea(area: number): void {",
    "        if (area === 1) {",
    "            void this.reloadDungeon();",
    "        } else if (area === 2) {",
    "            void this.reloadExtra();",
    "        } else {",
    "            void this.reloadMain();",
    "        }",
    "    }",
    "",
    "    /// custom: put the player in the middle, switching sheets first when they are not on",
    "    /// the one on screen — otherwise \"centre on me\" would silently do nothing, which is",
    "    /// exactly what it looks like when the marker is on another sheet.",
    "    worldMapCentreOnPlayer(): void {",
    "        if (this.worldMapPlayerX < 0) {",
    "            return;",
    "        }",
    "",
    "        const area: number = worldMapAreaAt(this.worldMapPlayerX, this.worldMapPlayerZ);",
    "        if (area < 0) {",
    "            return;     // no sheet holds this player (a region the world map skips)",
    "        }",
    "",
    "        if (area !== this.mapArea) {",
    "            const self = this;",
    "            this.worldMapShowArea(area);",
    "            // the reload re-runs maininit(), which resets the focus to the sheet's own",
    "            // start, so re-centre once it has settled",
    "            window.setTimeout((): void => self.worldMapCentreOnPlayer(), 250);",
    "            return;",
    "        }",
    "",
    "        const p: number[] = worldMapMapPoint(this.worldMapPlayerX, this.worldMapPlayerZ, this.mapOriginX, this.mapOriginZ, this.mapHeight);",
    "        const f: number[] = worldMapFocusFor(p[0], p[1]);",
    "        this.focusX = f[0];",
    "        this.focusZ = f[1];",
    "        this.dragFocusX = -1;",
    "        this.dragFocusZ = -1;",
    "        this.redraw = true;",
    "    }",
    "",
    "    /// custom: the state the page renders from — see worldMapStatePayload's index map.",
    "    worldMapState(): number[] {",
    "        const playerArea: number = worldMapAreaAt(this.worldMapPlayerX, this.worldMapPlayerZ);",
    "        const here: boolean = this.worldMapPlayerX >= 0 && playerArea === this.mapArea;",
    "        const layers: number[] = [",
    "            MapView.shouldDrawNpcs ? 1 : 0,",
    "            MapView.shouldDrawItems ? 1 : 0,",
    "            MapView.shouldDrawLabels ? 1 : 0,",
    "            MapView.shouldDrawBorders ? 1 : 0,",
    "            MapView.shouldDrawMultimap ? 1 : 0,",
    "            MapView.shouldDrawFreemap ? 1 : 0",
    "        ];",
    "        return worldMapStatePayload(this.mapArea, this.focusX, this.focusZ, this.zoom, layers, playerArea, here);",
    "    }",
    "",
    "    /// custom: bind the page-facing entry point ONCE, on the map's first draw. The name",
    "    /// is terser-reserved (bundle.ts) because the page reads it by name off the instance",
    "    /// the page itself constructed.",
    "    worldMapBindApi(): void {",
    "        if (this.worldMapApiBound) {",
    "            return;",
    "        }",
    "        this.worldMapApiBound = true;",
    "        (window as any)['worldMapUi'] = (cmd: unknown): number[] => this.worldMapUi(cmd);",
    "    }",
    "",
    "    /// custom: the player marker, drawn in the same pass as the map it belongs to",
    "    /// (mainredraw, right after renderWorldMap) so it lands on the ground it describes",
    "    /// rather than a frame late. Nothing is drawn when the player is on another sheet or",
    "    /// off the visible window.",
    "    worldMapMarkerDraw(): void {",
    "        this.worldMapBindApi();",
    "",
    "        if (this.worldMapPlayerX < 0 || worldMapAreaAt(this.worldMapPlayerX, this.worldMapPlayerZ) !== this.mapArea) {",
    "            return;",
    "        }",
    "",
    "        const left: number = this.focusX - ((this.sWid / this.zoom) | 0);",
    "        const top: number = this.focusZ - ((this.sHei / this.zoom) | 0);",
    "        const p: number[] = worldMapMapPoint(this.worldMapPlayerX, this.worldMapPlayerZ, this.mapOriginX, this.mapOriginZ, this.mapHeight);",
    "        const s: number[] = worldMapMarkerScreen(p[0], p[1], left, top, this.zoom, this.sWid, this.sHei);",
    "",
    "        if (!s[2]) {",
    "            return;",
    "        }",
    "",
    "        worldMapDrawMarker(Pix2D.pixels, Pix2D.width, Pix2D.height, s[0], s[1], (performance.now() / 200) | 0);",
    "",
    "        const label: (string | number)[] = worldMapMarkerLabel(s[0], s[1], this.sWid, this.worldMapPlayerLevel);",
    "        this.f12?.centreString(String(label[0]), Number(label[1]), Number(label[2]), Number(label[3]), true);",
    "    }",
]

MAPVIEW_MARKER = [
    "            /// custom (lclite \"world-map\" mod): the player marker, in the same pass as",
    "            /// the map it belongs to (see worldMapMarkerDraw).",
    "            this.worldMapMarkerDraw();",
]

CLIENT_EJS = [
    "    <!-- lclite world map: the overlay controller. It builds the full-frame overlay,",
    "         boots the map app (the deployed /lclite/worldmap/mapview.js bundle) inside an",
    "         iframe — the map app is a second GameShell and needs its own document — and",
    "         feeds it the player's live position from the bundled core's",
    "         window['worldMapPlayer'](). Version-keyed like every page asset: bump ?v= here",
    "         and VERSION in ui.js together. -->",
    "    <script src=\"/lclite/worldmap/ui.js?v=1\" defer></script>",
]

# ---------------------------------------------------------------------------------
# sites: (file, marker site name, anchor line, where, body)
# ---------------------------------------------------------------------------------

SITES = [
    (
        'webclient/src/client/Client.ts', 'client-import',
        "import ClientLocAnim from '#/dash3d/ClientLocAnim.js';", 'after', CLIENT_IMPORT,
    ),
    (
        'webclient/src/client/Client.ts', 'client-parked',
        "    private async gameLoop(): Promise<void> {", 'before', CLIENT_PARKED,
    ),
    (
        'webclient/src/client/Client.ts', 'client-click',
        "        const checkClickInput = !this.isMobile || (this.isMobile && !MobileKeyboard.isWithinCanvasKeyboard(this.mouseClickX, this.mouseClickY));",
        'before', CLIENT_CLICK,
    ),
    (
        'webclient/src/client/Client.ts', 'client-draw',
        "        this.worldUpdateNum = 0;", 'before', CLIENT_DRAW,
    ),
    (
        'webclient/src/mapview/MapView.ts', 'mapview-import',
        "import WorldMapFont from '#/mapview/WorldMapFont.js';", 'after', MAPVIEW_IMPORT,
    ),
    (
        'webclient/src/mapview/MapView.ts', 'mapview-parked',
        "    async loadWorldmap(): Promise<JagFile> {", 'before', MAPVIEW_PARKED,
    ),
    (
        'webclient/src/mapview/MapView.ts', 'mapview-marker',
        "            this.renderWorldMap(left, top, right, bottom, 0, 0, this.sWid, this.sHei);",
        'after', MAPVIEW_MARKER,
    ),
    (
        'engine/view/client.ejs', 'page',
        "    </center>", 'after', CLIENT_EJS,
    ),
]

# REPLACE sites: (file, site, the original line, the block that takes its place). The
# strip puts the original line back, so the round trip is exact.
REPLACE_SITES = [
    (
        'webclient/src/mapview/MapView.ts', 'mapview-jag',
        MAPVIEW_JAG_OLD, MAPVIEW_JAG_NEW,
    ),
]

# one-line edits: (file, old text, new text) — idempotent by presence. Both of these are
# lines inside ANOTHER mod's existing island (control-panel's), which is the house route
# for a shared file: the reserve list is one array with per-mod names on it, and the
# panel's version key is bumped by whoever edits panel.js.
LINE_EDITS = [
    (
        'engine/view/client.ejs',
        '/lclite/panel.js?v=32',
        '/lclite/panel.js?v=33',
    ),
    (
        'webclient/bundle.ts',
        "'lcmAnchor', 'registerCanvas', 'lcmXpBounds', 'lcmStatOrbsBounds', 'lcmWikiLookupBounds', 'lcmHeld', 'lcmAlt'",
        "'lcmAnchor', 'registerCanvas', 'lcmXpBounds', 'lcmStatOrbsBounds', 'lcmWikiLookupBounds', 'lcmWorldMapBounds', 'lcmHeld', 'lcmAlt', 'worldMapToggle', 'worldMapPlayer', 'worldMapUi'",
    ),
]


def read_file(path):
    with open(path, 'r', encoding='utf-8', newline='') as f:
        text = f.read()
    eol = '\r\n' if '\r\n' in text else '\n'
    return text.split(eol), eol


def write_file(path, lines, eol):
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(eol.join(lines))


def strip_site(lines, site):
    """Remove this site's own block(s). Region-based: the markers ARE the region, so a
    rerun after editing the block still finds it (an exact-text strip would not, and the
    next run would insert a second copy). The insert adds a blank line as the block's
    LAST body line, so the strip removes exactly the lines it wrote — the round trip is
    byte-identical, which is what the harness's double-run check proves."""
    open_line = OPEN + ' ' + site
    close_line = CLOSE + ' ' + site
    hopen = HOPEN + ' ' + site + ' -->'
    hclose = HCLOSE + ' ' + site + ' -->'

    out = []
    i = 0
    stripped = 0
    while i < len(lines):
        line = lines[i].strip()
        if line == open_line or line == hopen:
            end_marker = close_line if line == open_line else hclose
            j = i
            while j < len(lines) and lines[j].strip() != end_marker:
                j += 1
            if j >= len(lines):
                raise SystemExit(f'! {site}: opening marker without its closing marker')
            stripped += j - i + 1
            i = j + 1
            continue
        out.append(lines[i])
        i += 1

    return out, stripped


def find_unique(lines, anchor, site):
    hits = [i for i, l in enumerate(lines) if l == anchor]
    if len(hits) != 1:
        raise SystemExit(f'! {site}: anchor matched {len(hits)} times (expected 1): {anchor!r}')
    return hits[0]


def apply_sites(root, dry=False):
    for rel, site, anchor, where, body in SITES:
        path = os.path.join(root, rel)
        lines, eol = read_file(path)

        before = len(lines)
        lines, stripped = strip_site(lines, site)
        after = len(lines)
        if stripped:
            print(f'  {rel}: stripped {stripped} line(s) from {site} ({before} -> {after})')
            if stripped > 400:
                raise SystemExit(f'! {site}: strip removed {stripped} lines — refusing (that is not our block)')

        i = find_unique(lines, anchor, site)
        # HTML files take HTML comment markers: a `//` line outside a <script> block is
        # rendered as page text, and inside one a multi-line `<!-- -->` is an Annex-B
        # line comment (a load-time syntax error). The ejs insertion is in the body, so
        # it uses HTML comments.
        if rel.endswith('.ejs'):
            ins = ['    ' + HOPEN + ' ' + site + ' -->'] + body + ['', '    ' + HCLOSE + ' ' + site + ' -->']
        else:
            ins = [OPEN + ' ' + site] + body + ['', CLOSE + ' ' + site]
        at = i if where == 'before' else i + 1
        lines = lines[:at] + ins + lines[at:]
        print(f'  {rel}: {site} -> {len(ins)} lines {where} line {i + 1}')

        if not dry:
            write_file(path, lines, eol)

    for rel, old, new in LINE_EDITS:
        path = os.path.join(root, rel)
        text = open(path, 'r', encoding='utf-8', newline='').read()
        if new in text:
            print(f'  {rel}: line edit already present')
            continue
        if text.count(old) != 1:
            raise SystemExit(f'! {rel}: line-edit anchor matched {text.count(old)} times (expected 1)')
        if not dry:
            open(path, 'w', encoding='utf-8', newline='').write(text.replace(old, new))
        print(f'  {rel}: line edit applied')


def apply_replace_sites(root):
    for rel, site, old, body in REPLACE_SITES:
        path = os.path.join(root, rel)
        lines, eol = read_file(path)

        open_line = OPEN + ' ' + site
        close_line = CLOSE + ' ' + site

        out = []
        i = 0
        stripped = 0
        while i < len(lines):
            if lines[i].strip() == open_line:
                j = i
                while j < len(lines) and lines[j].strip() != close_line:
                    j += 1
                if j >= len(lines):
                    raise SystemExit(f'! {site}: opening marker without its closing marker')
                out.append(old)                 # restore the line the block replaced
                stripped = j - i + 1
                i = j + 1
                continue
            out.append(lines[i])
            i += 1
        lines = out

        i = find_unique(lines, old, site)
        ins = [OPEN + ' ' + site] + body + ['', CLOSE + ' ' + site]
        lines = lines[:i] + ins + lines[i + 1:]
        print(f'  {rel}: {site} -> replaced 1 line with {len(ins)}' + (f' (stripped {stripped} first)' if stripped else ''))

        write_file(path, lines, eol)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--strip':
        # strip-only mode: used when investigating a diff-alignment shift (the tool's
        # own recovery recipe) — removes every block this script writes and leaves the
        # tree pristine for that file set.
        root = sys.argv[2] if len(sys.argv) > 2 else os.environ.get('LCLITE_ROOT', '')
        if not root:
            raise SystemExit('usage: world_map_edit.py --strip <install root>')
        root = root.replace('\\', '/')
        for rel, site, anchor, where, body in SITES:
            path = os.path.join(root, rel)
            lines, eol = read_file(path)
            lines, stripped = strip_site(lines, site)
            if stripped:
                write_file(path, lines, eol)
                print(f'  {rel}: stripped {stripped} line(s) from {site}')
        for rel, site, old, body in REPLACE_SITES:
            path = os.path.join(root, rel)
            lines, eol = read_file(path)
            open_line = OPEN + ' ' + site
            close_line = CLOSE + ' ' + site
            out, i, stripped = [], 0, 0
            while i < len(lines):
                if lines[i].strip() == open_line:
                    j = i
                    while j < len(lines) and lines[j].strip() != close_line:
                        j += 1
                    out.append(old)
                    stripped = j - i + 1
                    i = j + 1
                    continue
                out.append(lines[i])
                i += 1
            if stripped:
                write_file(path, out, eol)
                print(f'  {rel}: stripped {stripped} line(s) from {site} (restored the original line)')
        for rel, old, new in LINE_EDITS:
            path = os.path.join(root, rel)
            text = open(path, 'r', encoding='utf-8', newline='').read()
            if new in text and old not in text:
                open(path, 'w', encoding='utf-8', newline='').write(text.replace(new, old))
                print(f'  {rel}: line edit reverted')
        print('stripped.')
        return

    if len(sys.argv) > 1:
        root = sys.argv[1]
    else:
        root = os.environ.get('LCLITE_ROOT', '')
    if not root:
        raise SystemExit('usage: world_map_edit.py <install root>  (or set LCLITE_ROOT)')
    root = root.replace('\\', '/')
    if not os.path.isdir(os.path.join(root, 'webclient')):
        raise SystemExit(f'! {root} has no webclient/ — that is not an install root')

    print(f'world-map: editing {root}')
    apply_sites(root)
    apply_replace_sites(root)
    print('done. now: tsc, then regen, then apply --check.')


if __name__ == '__main__':
    main()
