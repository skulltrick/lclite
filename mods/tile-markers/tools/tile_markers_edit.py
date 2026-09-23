#!/usr/bin/env python3
"""Insert the lclite:tile-markers hunks into a webclient tree.

Run it against the live install (the tree you author in), from anywhere:

    python mods/tile-markers/tools/tile_markers_edit.py                 # %LOCALAPPDATA%/LCLite/installs/289
    LCLITE_ROOT=<install> python mods/tile-markers/tools/tile_markers_edit.py

WHY A SCRIPT (not hand edits): the same reason every other mod here has one. It is
IDEMPOTENT BY REGION — it strips every block from its `// lclite:tile-markers` line to its
`// lclite:tile-markers end` line and re-inserts it, so a rerun is a byte-identical no-op
and an edited block is never duplicated (an exact-text strip silently finds nothing once
the block has changed between runs, and the next run inserts a SECOND copy — the TS2393
duplicate-method trap, which regen would then bake into the patch JSONs as the truth).

It asserts every anchor matches EXACTLY ONCE, and it preserves CRLF: the upstream sources
are CRLF (git autocrlf), patch JSONs store LF, and a text-mode rewrite that flattens the
file trips doctor/regen.

FIVE SITES, all in webclient/src/client/Client.ts:

  1. the payload import, in the dash3d import group (the payload lives in dash3d/). NOT
     after true-tile's import line: that island's 2-line context window reaches
     `const CLIENT_VERSION = 289;`, which is exactly how true-tile's own import expired
     274's `inherits` claim once.
  2. the Shift+right-click ARM, in mouseLoop() before the engine's own right-click path
     (the menu). ~33 untouched lines clear of shift-drop's insertion above it. The click is
     NOT consumed any more — the engine opens its menu and site 5's row goes into it.
  3. the per-frame resolve+draw call, in gameDrawMain() between removeSprites() and
     entityOverlays() — after renderAll (which resolves the armed ground pick) and before
     the entity overlays/interfaces composite. NOT beside true-tile's hoverTileDraw call:
     that line is 1 line from the block above it, so a second insertion there would be ONE
     diff island and regen would report MIXED MARKERS.
  4. the menu-row dispatch, at the very TOP of doAction() (right after the signature).
     doAction is the single funnel every menu click passes through, which is where
     wiki-lookup hangs its own row. The site is 9 pristine lines clear of wiki-lookup's
     doAction hunk — that hunk's `find[]` is a CONTIGUOUS 4-line pristine window
     (`""`/`let action:`/`const a:`/`const b:`), so an insertion splitting it would break
     wiki-lookup's anchor; 9 lines of clearance keeps the two islands apart and the window
     intact.
  5. the parked fields + methods, in the overlay-projection run of the class — before
     `getOverlayPosEntity()`, i.e. beside the very methods tileMarkersDraw() uses
     (getOverlayPos/getAvH). The site was CHOSEN BY MEASUREMENT, not by taste: git diff
     aligns the whole file, so a block this size parked in the wrong place re-splits
     another mod's islands and makes regen churn a patch JSON nobody touched
     (docs/MODS.md §3b). tools/tile_markers_site_search.py inserts the block at every
     candidate method boundary, runs a REAL regen for each, and reports the collateral —
     the end of the class (the obvious home) churned ground-items and true-tile, and the
     sites beside true-tile's own parked block hit MIXED MARKERS; this one is clean.
"""

import os
import re
import sys

MARK_OPEN = "// lclite:tile-markers"
MARK_CLOSE = "// lclite:tile-markers end"

IMPORT_ANCHOR = "import World from '#/dash3d/World.js';"

IMPORT_BLOCK = """// lclite:tile-markers
import type { TileMarkerSettings } from '#/dash3d/TileMarkers.js'; // custom (lclite "tile-markers" mod): the validated settings shape (type-only — verbatimModuleSyntax is on)
import { TM_KEY_MARKS, TM_MENU_ACTION, tmDecal, tmMenuLabel, tmNear, tmParseMarks, tmRead, tmSceneTileOk, tmSerialize, tmSettings, tmShiftHeld, tmToggle, tmTrackShift } from '#/dash3d/TileMarkers.js'; // custom (lclite "tile-markers" mod): settings parse, the marker store, the menu row's label/id, the Shift state and the tile-quad decal
// lclite:tile-markers end
"""

MOUSE_ANCHOR = "            if (button === 1 && (this.oneMouseButton === 1 || this.isAddFriendOption(this.menuNumEntries - 1)) && this.menuNumEntries > 2) {"

MOUSE_BLOCK = """            // lclite:tile-markers
            /// custom (lclite "tile-markers" mod): Shift+right-click ARMS the engine's own
            /// ground pick for the tile under the cursor. The click is deliberately NOT
            /// consumed: the engine opens its right-click menu below exactly as it always
            /// did, and tileMarkersFrame() adds this mod's own "Mark Tile" / "Unmark Tile"
            /// row to that menu — and re-lays it out — once the pick has resolved. See
            /// tileMarkersClick().
            this.tileMarkersClick(button);
            // lclite:tile-markers end
"""

DOACTION_ANCHOR = "    private doAction(optionId: number): void {"

DOACTION_BLOCK = """    // lclite:tile-markers
    /// custom (lclite "tile-markers" mod): this mod's own right-click row toggles the mark
    /// it was built for instead of running a game action. Every menu click funnels through
    /// doAction() — the left-click default, the open menu's row click, the touch paths — so
    /// one check covers all of them (the same funnel wiki-lookup hangs its row on). The row
    /// carries its own tile in its menuParamA/B/C, so the row and the tile it marks cannot
    /// drift apart. Hooked above the engine's own dispatch, and above the optionId guard,
    /// which tileMarkersDispatch() repeats.
    if (this.tileMarkersDispatch(optionId)) {
        return;
    }
    // lclite:tile-markers end
"""

FRAME_ANCHOR = "        this.entityOverlays();"

# Where the parked block goes. Filled in by tools/tile_markers_site_search.py: the site is
# chosen by MEASUREMENT (insert, run a real regen, see whether any other mod's patch JSON
# churns), never by taste. Overridable with PARK_ANCHOR for a re-measurement.
PARK_ANCHOR = "    private getOverlayPosEntity(entity: ClientEntity, height: number): void {"

FRAME_BLOCK = """        // lclite:tile-markers
        /// custom (lclite "tile-markers" mod): resolve the ground pick a Shift+right-click
        /// armed — World's rasterizer resolved it during the renderAll() above — then put
        /// this mod's row into the menu the engine just opened (openMenu() has already run
        /// in this frame's mouseLoop; otherOverlays() draws the menu after this), and draw
        /// the marked tiles over the scene. Before entityOverlays(), so hitbars, name plates
        /// and ground-item labels still composite over a marker.
        this.tileMarkersFrame();
        // lclite:tile-markers end
"""

PARKED_BLOCK = """    // lclite:tile-markers
    /// custom (lclite "tile-markers" mod): RuneLite "Ground Markers" parity. Shift+
    /// right-click a tile and the right-click menu gains a "Mark Tile" row ("Unmark Tile"
    /// when that tile is already marked) — exactly the row RuneLite's GroundMarkerPlugin
    /// appends while Shift is held — and the mark is made when that row is CLICKED, not by
    /// the Shift+right-click itself. The marks live in this mod's OWN localStorage key
    /// (`tileMarkersMarks`, a JSON array of flat x/z/level triples — positional, never
    /// objects: terser's property mangler renames object-literal KEYS, so a keyed store
    /// could not be read back by the next build), and are drawn over the scene as Pix3D
    /// triangles.
    ///
    /// The feature is five call sites: the import at the top of this file, the click arm in
    /// mouseLoop(), the per-frame resolve+draw call in gameDrawMain(), the row dispatch at
    /// the top of doAction(), and this block. The settings parse, the store, the row's label
    /// and the decal geometry live in the mod's files/ payload (dash3d/TileMarkers.ts), which
    /// is what lets the bun harness test the real shipped logic headlessly.
    private tileMarkersMarks: number[] = [];
    private tileMarkersRaw: string | null = null;
    private tileMarkersPending: boolean = false;

    /// custom (lclite "tile-markers" mod): the Shift+right-click. It ARMS the engine's own
    /// ground pick for the tile under the cursor and deliberately does NOT consume the click
    /// — the engine opens its right-click menu below as it always did, and
    /// tileMarkersFrame() then adds this mod's row to that menu. RuneLite's own plugin works
    /// the same way: it watches for the menu's WALK entry while Shift is held and appends a
    /// row, and the row is what marks the tile.
    ///
    /// The tile comes from the ENGINE'S OWN ground pick, not a re-implementation: the same
    /// `updateMousePicking()` the walk option dispatches (doAction -> MiniMenuAction.WALK)
    /// arms World.click with a pixel, and the ground rasterizer hit-tests it against every
    /// front-facing ground triangle as it draws — so the resolved tile is exactly the one a
    /// walk click at that pixel would use. Walls, npcs and items do not block it (the pick
    /// is the GROUND), and ground the camera cannot see can never be picked, which is the
    /// engine's own notion of visible.
    ///
    /// That resolution happens during the NEXT renderAll (this frame's, one call later), so
    /// this only ARMS the pick: tileMarkersFrame() reads it back after the draw and clears
    /// it before gameLoop()'s own walk consumption can see it — so the pick this mod makes
    /// can never walk you.
    private tileMarkersClick(button: number): void {
        if (button !== 2 || !this.ingame || !this.world) {
            return;
        }

        // this mod's OWN keys, read at its own hook (hard rule 5); off = the click is the
        // engine's and the menu opens exactly as it always did
        if (!tmSettings(tmRead).on) {
            return;
        }

        tmTrackShift();
        if (!tmShiftHeld()) {
            return;
        }

        // the game viewport only, (4,4)-(516,338) — the same rect the engine's own option
        // picking tests. There is no scene behind the sidebar, chatbox or minimap, so there
        // is no tile to mark there.
        if (this.mouseClickX <= 4 || this.mouseClickY <= 4 || this.mouseClickX >= 516 || this.mouseClickY >= 338) {
            return;
        }

        this.world.updateMousePicking(this.mouseClickX - 4, this.mouseClickY - 4);   // Pix2D buffer space, like Model.mouseX
        this.tileMarkersPending = true;
    }

    /// custom (lclite "tile-markers" mod): the menu index of the engine's own "Walk here"
    /// row, or -1. RuneLite's condition for appending its marker row is that the menu entry
    /// being built IS the walk option (`hotKeyPressed && menuAction == MenuAction.WALK`),
    /// which is what says "the cursor is over ground and no item or spell is selected for
    /// use". It is also what guarantees the row this mod appends is never the menu's TOP
    /// slot — the left-click default — because a WALK row means the menu already holds at
    /// least Cancel + Walk.
    private tileMarkersWalkRow(): number {
        for (let i: number = 0; i < this.menuNumEntries; i++) {
            if (this.menuAction[i] === MiniMenuAction.WALK) {
                return i;
            }
        }

        return -1;
    }

    /// custom (lclite "tile-markers" mod): append this mod's row to the menu the engine just
    /// opened, for the tile the armed pick resolved.
    ///
    /// The row cannot be added while the menu is being BUILT, because the tile is not known
    /// until renderAll() has resolved the pick — one call later. It cannot be added lazily
    /// while the menu is open either, because this engine freezes the menu at openMenu()
    /// (`otherOverlays()` only calls `buildMinimenu()` while `!isMenuOpen`, and drawMinimenu()
    /// paints whatever the arrays hold). The one moment that satisfies both is HERE: after
    /// the resolve, before otherOverlays() draws the menu in the same frame. openMenu() is
    /// then called again on purpose — it is what computes the menu's width/height/x/y from
    /// its option list, so re-running it is the engine's own layout with one more row, and
    /// the row hit-test in mouseLoop() reads the same arrays.
    ///
    /// The tile rides the row's own menuParamA/B/C rather than a field, so the row and the
    /// tile it marks cannot drift apart. The label is decided here, from the store as it
    /// stands now — RuneLite labels its row the same way (`existingOpt.isPresent() ?
    /// "Unmark" : "Mark"`).
    private tileMarkersMenuRow(x: number, z: number, level: number): void {
        // slot 1 = the bottom option, directly above 'Cancel'. That is where a plugin's own
        // row belongs (wiki-lookup's classic row goes there too), and it is never the top
        // slot a left click runs. TM_MENU_ACTION is > 1000, so the bubble sort at the end of
        // buildMinimenu() could not move it either — and that sort has already run, since
        // this writes into a menu that is open.
        for (let i: number = this.menuNumEntries; i > 1; i--) {
            this.menuOption[i] = this.menuOption[i - 1];
            this.menuAction[i] = this.menuAction[i - 1];
            this.menuParamA[i] = this.menuParamA[i - 1];
            this.menuParamB[i] = this.menuParamB[i - 1];
            this.menuParamC[i] = this.menuParamC[i - 1];
        }

        this.menuOption[1] = tmMenuLabel(this.tileMarkersStore(), x, z, level);
        this.menuAction[1] = TM_MENU_ACTION;
        this.menuParamA[1] = x;
        this.menuParamB[1] = z;
        this.menuParamC[1] = level;
        this.menuNumEntries++;

        this.openMenu();
    }

    /// custom (lclite "tile-markers" mod): is this menu slot this mod's own row, and if so
    /// toggle the tile the row was built for? Every menu click funnels through doAction()
    /// (the open menu's row click, the left-click default, the touch paths), so one check
    /// covers every way a row can be chosen — the same funnel wiki-lookup uses. The tile is
    /// read back off the row itself, so a stale tile can never be toggled.
    private tileMarkersDispatch(optionId: number): boolean {
        if (optionId < 0 || this.menuAction[optionId] !== TM_MENU_ACTION) {
            return false;
        }

        this.tileMarkersToggle(this.menuParamA[optionId], this.menuParamB[optionId], this.menuParamC[optionId]);
        return true;
    }

    /// custom (lclite "tile-markers" mod): the marker store, cached. localStorage is read
    /// every frame — the panel's "Clear all markers" action writes that key directly, so
    /// the engine has to notice — but the JSON is only re-parsed when the raw string
    /// actually changed (so a frame costs one string compare, not a parse).
    private tileMarkersStore(): number[] {
        const raw: string | null = localStorage.getItem(TM_KEY_MARKS);

        if (raw !== this.tileMarkersRaw) {
            this.tileMarkersRaw = raw;
            this.tileMarkersMarks = tmParseMarks(raw);
        }

        return this.tileMarkersMarks;
    }

    /// custom (lclite "tile-markers" mod): flip one tile's mark and write the store back.
    private tileMarkersToggle(x: number, z: number, level: number): void {
        const next: number[] = tmToggle(this.tileMarkersStore(), x, z, level);
        const raw: string = tmSerialize(next);

        this.tileMarkersMarks = next;
        this.tileMarkersRaw = raw;
        localStorage.setItem(TM_KEY_MARKS, raw);
    }

    /// custom (lclite "tile-markers" mod): once per frame, from gameDrawMain() after
    /// renderAll() — resolve a pending mark pick, put this mod's row into the menu the engine
    /// opened for that click, then draw the marks. All three halves are one call site on
    /// purpose: they need the same frame's ground state, and the menu row must be written
    /// after the resolve but before otherOverlays() draws the menu.
    private tileMarkersFrame(): void {
        tmTrackShift();   // install the Shift listeners once (a no-op after the first frame)

        const settings: TileMarkerSettings = tmSettings(tmRead);   // own keys, per frame, at this hook

        if (this.tileMarkersPending) {
            this.tileMarkersPending = false;

            const sceneX: number = World.groundX;
            const sceneZ: number = World.groundZ;

            World.groundX = -1;
            World.groundZ = -1;
            World.clearPick();

            // -1 = the pixel was not over any visible ground (sky, or a click during a scene
            // load): no row and no mark, and the armed pick is dropped rather than left to
            // resolve onto somebody else's click.
            if (settings.on && this.ingame && sceneX >= 0 && sceneZ >= 0) {
                // the menu the engine opened for this click, and only while it still holds
                // the world's own "Walk here" option — RuneLite's own condition for adding
                // its row, which also guarantees our row cannot become the left-click default.
                if (this.isMenuOpen && this.menuArea === 0 && this.tileMarkersWalkRow() !== -1) {
                    // scene -> world, the client's own conversion (the hint arrow's)
                    this.tileMarkersMenuRow(sceneX + this.mapBuildBaseX, sceneZ + this.mapBuildBaseZ, this.minusedlevel);
                }
            }
        }

        if (!settings.on || !this.ingame || !this.localPlayer) {
            return;
        }

        this.tileMarkersDraw(settings);
    }

    /// custom (lclite "tile-markers" mod): draw every mark on the player's plane, over the
    /// scene. Geometry goes in as Pix3D triangles because `Pix3D.trans` is BOTH the
    /// destination weight the software raster mixes with AND the per-triangle alpha the gpu
    /// mod captures, so the wash blends with the ground in either renderer; a translucent
    /// pixel written straight into the game buffer cannot (on a gpu frame that buffer is
    /// sentinel-cleared, so the mix runs against black, and the HUD overlay then paints the
    /// result opaque).
    private tileMarkersDraw(settings: TileMarkerSettings): void {
        const marks: number[] = this.tileMarkersStore();

        if (marks.length === 0 || !this.localPlayer) {
            return;
        }

        const playerX: number = (this.localPlayer.x >> 7) + this.mapBuildBaseX;
        const playerZ: number = (this.localPlayer.z >> 7) + this.mapBuildBaseZ;

        const px: number[] = [0, 0, 0, 0];
        const py: number[] = [0, 0, 0, 0];
        const cornerX: number[] = [0, 128, 128, 0];
        const cornerZ: number[] = [0, 0, 128, 128];

        const emit = (xA: number, xB: number, xC: number, yA: number, yB: number, yC: number, colour: number, trans: number): void => {
            Pix3D.trans = trans;
            Pix3D.flatTriangle(xA, xB, xC, yA, yB, yC, colour);
        };

        const savedTrans: number = Pix3D.trans;
        const savedHclip: boolean = Pix3D.hclip;
        Pix3D.hclip = true;   // hclip is the CALLER's job: a partly off-screen quad must clamp, not wrap a row

        for (let i: number = 0; i + 2 < marks.length; i += 3) {
            const x: number = marks[i];
            const z: number = marks[i + 1];
            const level: number = marks[i + 2];

            // RuneLite: a marker is drawn only on the plane it was made on
            // (`worldPoint.getPlane() != wv.getPlane()` -> skip)
            if (level !== this.minusedlevel) {
                continue;
            }

            // RuneLite's own GroundMarkerOverlay.MAX_DRAW_DISTANCE, Chebyshev like theirs
            if (!tmNear(x - playerX, z - playerZ)) {
                continue;
            }

            const sceneX: number = x - this.mapBuildBaseX;
            const sceneZ: number = z - this.mapBuildBaseZ;

            if (!tmSceneTileOk(sceneX) || !tmSceneTileOk(sceneZ)) {
                continue;   // outside the loaded scene (getOverlayPos() refuses tile 0 anyway)
            }

            const baseX: number = sceneX << 7;
            const baseZ: number = sceneZ << 7;

            let ok: boolean = true;
            for (let corner: number = 0; corner < 4; corner++) {
                // height 0: getOverlayPos() measures the ground from the PLAYER's level, with
                // the LinkBelow promotion every engine overlay uses — i.e. the surface the
                // player's feet are on for that tile, which is where a marker made on this
                // plane belongs (on a bridge deck the level-0 square IS the deck).
                this.getOverlayPos(baseX + cornerX[corner], baseZ + cornerZ[corner], 0);

                if (this.projectX <= -1) {
                    ok = false;   // behind the camera / outside the build area
                    break;
                }

                px[corner] = this.projectX;
                py[corner] = this.projectY;
            }

            if (!ok) {
                continue;
            }

            tmDecal(emit, px, py, settings.rgb, settings.fillRgb, settings.thick, settings.fillA);
        }

        Pix3D.trans = savedTrans;
        Pix3D.hclip = savedHclip;
    }
    // lclite:tile-markers end
"""


def strip_blocks(lines):
    """Remove every marker-to-end block. Returns (lines, removed count)."""
    out = []
    removed = 0
    i = 0
    while i < len(lines):
        if lines[i].strip() == MARK_OPEN:
            j = i
            while j < len(lines) and lines[j].strip() != MARK_CLOSE:
                j += 1
            if j >= len(lines):
                raise SystemExit("unterminated %s block at line %d" % (MARK_OPEN, i + 1))
            removed += j - i + 1
            i = j + 1
            continue
        out.append(lines[i])
        i += 1
    return out, removed


def insert_after(lines, anchor, block, name):
    hits = [i for i, l in enumerate(lines) if l.rstrip("\r") == anchor]
    if len(hits) != 1:
        raise SystemExit("anchor for %s matched %d times (want 1): %r" % (name, len(hits), anchor))
    at = hits[0] + 1
    return lines[:at] + block.rstrip("\n").split("\n") + lines[at:]


def insert_before(lines, anchor, block, name):
    hits = [i for i, l in enumerate(lines) if l.rstrip("\r") == anchor]
    if len(hits) != 1:
        raise SystemExit("anchor for %s matched %d times (want 1): %r" % (name, len(hits), anchor))
    at = hits[0]
    return lines[:at] + block.rstrip("\n").split("\n") + lines[at:]


def main():
    root = os.environ.get("LCLITE_ROOT")
    if not root:
        local = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~/.local/share")
        root = os.path.join(local, "LCLite", "installs", "289")
    path = os.path.join(root, "webclient", "src", "client", "Client.ts")

    if not os.path.exists(path):
        raise SystemExit("no such file: %s" % path)

    with open(path, "rb") as fh:
        data = fh.read()

    if b"\r\n" not in data:
        raise SystemExit("%s is not CRLF — refusing to edit a flattened source" % path)

    text = data.decode("utf-8")
    lines = text.split("\r\n")

    stripped, removed = strip_blocks(lines)
    if removed > 400:
        raise SystemExit("strip removed %d lines — that is not this mod's block" % removed)

    before = len(stripped)
    out = insert_after(stripped, IMPORT_ANCHOR, IMPORT_BLOCK, "import")
    out = insert_before(out, MOUSE_ANCHOR, MOUSE_BLOCK, "mouseLoop click")
    out = insert_before(out, FRAME_ANCHOR, FRAME_BLOCK, "gameDrawMain frame")
    out = insert_after(out, DOACTION_ANCHOR, DOACTION_BLOCK, "doAction dispatch")

    # The parked block. Its site is a MEASUREMENT, not a preference: `git diff -U0` aligns
    # the whole file, so a block this size can re-split another mod's islands and make regen
    # churn a patch JSON nobody touched (docs/MODS.md §3b). The default below is the site
    # tools/tile_markers_site_search.py proved clean (no collateral in mods/ after a real
    # regen); PARK_ANCHOR overrides it for a re-measurement.
    park = os.environ.get("PARK_ANCHOR", PARK_ANCHOR)
    out = insert_before(out, park, PARKED_BLOCK, "parked block")

    if sum(1 for l in out if l.strip() == MARK_OPEN) != 5:
        raise SystemExit("expected 5 inserted blocks, found %d" % sum(1 for l in out if l.strip() == MARK_OPEN))
    if sum(1 for l in out if l.strip() == MARK_CLOSE) != 5:
        raise SystemExit("expected 5 closing markers, found %d" % sum(1 for l in out if l.strip() == MARK_CLOSE))

    with open(path, "wb") as fh:
        fh.write("\r\n".join(out).encode("utf-8"))

    print("edited %s" % path)
    print("  stripped %d stale lines, %d -> %d lines (+%d)" % (removed, before, len(out), len(out) - before))
    print("  parked block before: %s" % park.strip())


if __name__ == "__main__":
    main()
