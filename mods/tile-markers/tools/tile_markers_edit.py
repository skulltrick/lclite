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

FOUR SITES, all in webclient/src/client/Client.ts:

  1. the payload import, in the dash3d import group (the payload lives in dash3d/). NOT
     after true-tile's import line: that island's 2-line context window reaches
     `const CLIENT_VERSION = 289;`, which is exactly how true-tile's own import expired
     274's `inherits` claim once.
  2. the Shift+right-click consume, in mouseLoop() before the engine's own right-click
     path (the menu). ~33 untouched lines clear of shift-drop's insertion above it.
  3. the per-frame resolve+draw call, in gameDrawMain() between removeSprites() and
     entityOverlays() — after renderAll (which resolves the armed ground pick) and before
     the entity overlays/interfaces composite. NOT beside true-tile's hoverTileDraw call:
     that line is 1 line from the block above it, so a second insertion there would be ONE
     diff island and regen would report MIXED MARKERS.
  4. the parked fields + methods, in the overlay-projection run of the class — before
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
import { TM_KEY_MARKS, tmDecal, tmNear, tmParseMarks, tmRead, tmSceneTileOk, tmSerialize, tmSettings, tmShiftHeld, tmToggle, tmTrackShift } from '#/dash3d/TileMarkers.js'; // custom (lclite "tile-markers" mod): settings parse, the marker store, the Shift state and the tile-quad decal
// lclite:tile-markers end
"""

MOUSE_ANCHOR = "            if (button === 1 && (this.oneMouseButton === 1 || this.isAddFriendOption(this.menuNumEntries - 1)) && this.menuNumEntries > 2) {"

MOUSE_BLOCK = """            // lclite:tile-markers
            /// custom (lclite "tile-markers" mod): Shift+right-click marks (or unmarks) the
            /// tile under the cursor and CONSUMES the click, so the menu never opens — see
            /// tileMarkersClick(). Runs before the engine's own right-click path below (the
            /// oneMouseButton promotion and the openMenu() dispatch).
            if (this.tileMarkersClick(button)) {
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
        /// armed — World's rasterizer resolved it during the renderAll() above — and draw
        /// the marked tiles over the scene. Before entityOverlays(), so hitbars, name
        /// plates and ground-item labels still composite over a marker.
        this.tileMarkersFrame();
        // lclite:tile-markers end
"""

PARKED_BLOCK = """    // lclite:tile-markers
    /// custom (lclite "tile-markers" mod): RuneLite "Ground Markers" parity — Shift+
    /// right-click a tile to mark it, Shift+right-click it again to unmark it. The marks
    /// live in this mod's OWN localStorage key (`tileMarkersMarks`, a JSON array of flat
    /// x/z/level triples — positional, never objects: terser's property mangler renames
    /// object-literal KEYS, so a keyed store could not be read back by the next build),
    /// and are drawn over the scene as Pix3D triangles.
    ///
    /// The whole feature is four call sites: the import at the top of this file, the click
    /// consume in mouseLoop(), the per-frame call in gameDrawMain(), and this block. The
    /// settings parse, the store and the decal geometry live in the mod's files/ payload
    /// (dash3d/TileMarkers.ts), which is what lets the bun harness test the real shipped
    /// logic headlessly.
    private tileMarkersMarks: number[] = [];
    private tileMarkersRaw: string | null = null;
    private tileMarkersPending: boolean = false;

    /// custom (lclite "tile-markers" mod): the Shift+right-click. True = the click was OURS
    /// and has been consumed (the shift-drop / wiki-lookup idiom: clear mouseClickButton,
    /// return from mouseLoop).
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
    /// it before gameLoop()'s own walk consumption can see it — the mark never walks you.
    private tileMarkersClick(button: number): boolean {
        if (button !== 2 || !this.ingame || !this.world) {
            return false;
        }

        // this mod's OWN keys, read at its own hook (hard rule 5); off = the click is the
        // engine's and the menu opens exactly as it always did
        if (!tmSettings(tmRead).on) {
            return false;
        }

        tmTrackShift();
        if (!tmShiftHeld()) {
            return false;
        }

        // the game viewport only, (4,4)-(516,338) — the same rect the engine's own option
        // picking tests. There is no scene behind the sidebar, chatbox or minimap, so there
        // is no tile to mark there.
        if (this.mouseClickX <= 4 || this.mouseClickY <= 4 || this.mouseClickX >= 516 || this.mouseClickY >= 338) {
            return false;
        }

        this.world.updateMousePicking(this.mouseClickX - 4, this.mouseClickY - 4);   // Pix2D buffer space, like Model.mouseX
        this.tileMarkersPending = true;
        this.mouseClickButton = 0;   // the click is ours, not the menu's
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
    /// renderAll() — resolve a pending mark pick, then draw the marks. The two halves are
    /// one call site on purpose: both need the same frame's ground state.
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
            // load): no mark, and the armed pick is dropped rather than left to resolve onto
            // somebody else's click.
            if (settings.on && this.ingame && sceneX >= 0 && sceneZ >= 0) {
                // scene -> world, the client's own conversion (the hint arrow's)
                this.tileMarkersToggle(sceneX + this.mapBuildBaseX, sceneZ + this.mapBuildBaseZ, this.minusedlevel);
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

    # The parked block. Its site is a MEASUREMENT, not a preference: `git diff -U0` aligns
    # the whole file, so a block this size can re-split another mod's islands and make regen
    # churn a patch JSON nobody touched (docs/MODS.md §3b). The default below is the site
    # tools/tile_markers_site_search.py proved clean (no collateral in mods/ after a real
    # regen); PARK_ANCHOR overrides it for a re-measurement.
    park = os.environ.get("PARK_ANCHOR", PARK_ANCHOR)
    out = insert_before(out, park, PARKED_BLOCK, "parked block")

    if sum(1 for l in out if l.strip() == MARK_OPEN) != 4:
        raise SystemExit("expected 4 inserted blocks, found %d" % sum(1 for l in out if l.strip() == MARK_OPEN))
    if sum(1 for l in out if l.strip() == MARK_CLOSE) != 4:
        raise SystemExit("expected 4 closing markers, found %d" % sum(1 for l in out if l.strip() == MARK_CLOSE))

    with open(path, "wb") as fh:
        fh.write("\r\n".join(out).encode("utf-8"))

    print("edited %s" % path)
    print("  stripped %d stale lines, %d -> %d lines (+%d)" % (removed, before, len(out), len(out) - before))
    print("  parked block before: %s" % park.strip())


if __name__ == "__main__":
    main()
