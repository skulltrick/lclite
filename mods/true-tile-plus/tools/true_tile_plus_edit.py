#!/usr/bin/env python3
# lclite:true-tile-plus — the tree edit script for mods/true-tile-plus.
#
#   python mods/true-tile-plus/tools/true_tile_plus_edit.py
#   LCLITE_ROOT=C:/path/to/install python .../true_tile_plus_edit.py
#
# It makes FOUR edits, all of them marker-paired (`// lclite:true-tile-plus` …
# `// lclite:true-tile-plus:end`) so a rerun is a no-op: the strip removes marker-to-marker
# plus exactly the one blank line the insert added — the symmetric inverse of what it
# inserts. An exact-text strip would silently find nothing once the block has been edited
# between runs, and the next run would insert a SECOND copy (TS2303 duplicates that regen
# then bakes into the patch JSONs as the truth).
#
#   webclient/src/client/Client.ts   — the arm call in gameDrawMain()
#   webclient/src/dash3d/World.ts    — the payload import, the parked state/methods, and the
#                                      fill() call that paints each edge's flames on the turn
#                                      of the neighbour tile they lie over
#
# The strip runs ONCE per file, before any insert: per-edit stripping would have each edit
# remove the blocks the previous one just inserted.
#
# CRLF: the upstream sources are CRLF (autocrlf=true) and patch JSONs store LF, so each file
# is read as bytes, normalized to LF for the edits, and written back with the EOL it had —
# a plain text rewrite flattens the file and trips doctor's LF-only warning.
import os
import re
from textwrap import dedent

ROOT = os.environ.get('LCLITE_ROOT', r'C:\Users\canno\AppData\Local\LCLite\installs\289')
CLIENT = os.path.join(ROOT, 'webclient/src/client/Client.ts')
WORLD = os.path.join(ROOT, 'webclient/src/dash3d/World.ts')

# marker-to-marker strip, swallowing the one blank line the inserts add after the closing
# marker (the import insert adds none, hence the optional group)
STRIP = re.compile(r'^[ \t]*// lclite:true-tile-plus\n(?:[^\n]*\n)*?[^\n]*// lclite:true-tile-plus:end\n(?:\n)?', re.M)

CLIENT_BLOCK = dedent('''\
        // lclite:true-tile-plus
        /// custom (lclite "true-tile-plus" mod): hand World the true tile — the head of the
        /// local move queue (routeX/routeZ[0]), the same tile mods/true-tile outlines — so
        /// the ground effects can be drawn on the turn of the tiles their flames reach over
        /// (World.trueTilePlusDraw, from fill()). Only the tile and the level cross over: the
        /// effect's settings and geometry live in the mod's files/ payload and are read
        /// World-side, at that hook (rule 5). Armed up here rather than beside the other arms
        /// because a hunk's edit site must stay >=3 untouched lines clear of its neighbours',
        /// and true-tile's arm and hover-tile's sit inside the camera-shake block below.
        if (this.localPlayer) {
            World.trueTilePlusArm(this.localPlayer.routeX[0], this.localPlayer.routeZ[0], this.minusedlevel);
        }
        // lclite:true-tile-plus:end

''')

WORLD_IMPORT_BLOCK = dedent('''\
    // lclite:true-tile-plus
    import { TRUE_TILE_PLUS_OUTER_UNITS, trueTilePlusEffect, trueTilePlusRead, trueTilePlusSettings } from '#/dash3d/TrueTilePlus.js'; // custom (lclite "true-tile-plus" mod): ground-effect geometry + settings parse
    // lclite:true-tile-plus:end
''')

WORLD_PARKED_BLOCK = dedent('''\
    // lclite:true-tile-plus
    /// custom (lclite "true-tile-plus" mod): the ground effects' World-side state and draw.
    /// Client.gameDrawMain arms the true tile once per frame (before renderAll); fill() then
    /// calls the draw for EVERY tile, and the draw paints the edge whose flames lie over the
    /// tile being drawn — right after that tile's ground, before its walls and sprites.
    ///
    /// That per-neighbour placement is the whole fix for "only 2-3 edges ever show": a flame
    /// is rooted on the true tile's border and reaches OUTWARD, so it lies over the tile next
    /// door, and renderAll draws the scene back-to-front as an axis-aligned square-ring walk
    /// around the CAMERA's own tile (dx/dz from -viewRadius to 0: outermost ring first, the
    /// camera's own tile last) rather than by true depth — so a neighbouring tile that comes
    /// later in that walk painted its ground straight over any blade that reached into it,
    /// and which of the 4 edges survived changed with the camera's yaw. Drawn on the
    /// neighbour's own turn, a blade cannot be covered by the ground it sits on, its walls
    /// and sprites still cover it correctly, and no later tile overlaps the ground it burns
    /// on.
    ///
    /// The effect geometry and settings live in the mod's files/ payload
    /// (dash3d/TrueTilePlus.ts); this mod reads its OWN keys at this hook (rule 5).
    private static ttpArmed: boolean = false;
    private static ttpX: number = -1;
    private static ttpZ: number = -1;
    private static ttpLevel: number = 0;
    private static ttpProjected: boolean = false;
    private static ttpPx: number[] = [0, 0, 0, 0];
    private static ttpPy: number[] = [0, 0, 0, 0];
    private static ttpOx: number[] = [0, 0, 0, 0];
    private static ttpOy: number[] = [0, 0, 0, 0];

    /// Arm the effects for this frame's render. Called from Client.gameDrawMain() before
    /// renderAll, so the projection below uses the camera the scene is drawn with.
    static trueTilePlusArm(tileX: number, tileZ: number, level: number): void {
        this.ttpArmed = true;
        this.ttpX = tileX;
        this.ttpZ = tileZ;
        this.ttpLevel = level;
        this.ttpProjected = false;
    }

    /// Which edge's flames lie over this tile, as one of the armed tile's four neighbours?
    /// -1 = this tile is not one of them. Edge i runs from corner i to corner (i + 1) & 3:
    /// 0 = the -z side, 1 = +x, 2 = +z, 3 = -x — the same order the payload masks with.
    private static ttpFacingEdge(tileX: number, tileZ: number): number {
        if (tileX === World.ttpX) {
            if (tileZ === World.ttpZ - 1) {
                return 0;
            }
            if (tileZ === World.ttpZ + 1) {
                return 2;
            }
        } else if (tileZ === World.ttpZ) {
            if (tileX === World.ttpX + 1) {
                return 1;
            }
            if (tileX === World.ttpX - 1) {
                return 3;
            }
        }

        return -1;
    }

    /// Project one world point to the game buffer. `false` = the point is behind the
    /// camera, which makes the caller skip the whole frame (what every overlay does).
    private static ttpProject(px: number[], py: number[], i: number, wx: number, wy: number, wz: number): boolean {
        let dx: number = wx - World.cx;
        let dy: number = wy - World.cy;
        let dz: number = wz - World.cz;

        let tmp: number = (dz * World.cameraSinY + dx * World.cameraCosY) >> 16;
        dz = (dz * World.cameraCosY - dx * World.cameraSinY) >> 16;
        dx = tmp;

        tmp = (dy * World.cameraCosX - dz * World.cameraSinX) >> 16;
        dz = (dy * World.cameraSinX + dz * World.cameraCosX) >> 16;
        dy = tmp;

        if (dz < 50) {
            return false;
        }

        px[i] = Pix3D.originX + (((dx << 9) / dz) | 0);
        py[i] = Pix3D.originY + (((dy << 9) / dz) | 0);
        return true;
    }

    /// The flames that reach over THIS tile, drawn from fill() once this tile's ground is
    /// down. Four neighbours match in a frame (in whatever order renderAll reaches them), so
    /// unlike the tile decal there is nothing to disarm — the eight projections are computed
    /// once and cached instead, since the camera cannot change mid-pass.
    private trueTilePlusDraw(tileX: number, tileZ: number, level: number): void {
        if (!World.ttpArmed || level !== World.ttpLevel) {
            return;
        }

        const edge: number = World.ttpFacingEdge(tileX, tileZ);
        if (edge < 0) {
            return;
        }

        const settings = trueTilePlusSettings(trueTilePlusRead);   // this mod's OWN keys, at its own hook
        if (!settings.enabled) {
            return;
        }

        if (!World.ttpProjected) {
            World.ttpProjected = true;

            // The four ground corners of the ARMED tile, plus one OUTWARD PROBE per edge: the
            // edge's world midpoint pushed out along the tile's own plane. The probes are
            // what give the payload a real outward direction and px-per-world-unit scale per
            // edge, so a flame stays glued to its own border at any yaw, pitch or zoom.
            const x0: number = World.ttpX << 7;
            const z0: number = World.ttpZ << 7;
            const wx: number[] = [0, 0, 0, 0];
            const wz: number[] = [0, 0, 0, 0];
            const wy: number[] = [0, 0, 0, 0];

            for (let i: number = 0; i < 4; i++) {
                const x: number = i === 1 || i === 2 ? x0 + 128 : x0;
                const z: number = i === 2 || i === 3 ? z0 + 128 : z0;

                wx[i] = x;
                wz[i] = z;
                wy[i] = this.groundh[level][x >> 7][z >> 7];
            }

            for (let i: number = 0; i < 4; i++) {
                const j: number = (i + 1) & 3;

                // the edge's outward world direction, measured from the tile's own centre, so
                // it is axis-aligned and exact (a tile is a square in world space)
                const mx: number = (wx[i] + wx[j]) * 0.5;
                const mz: number = (wz[i] + wz[j]) * 0.5;
                const nx: number = mx - (x0 + 64);
                const nz: number = mz - (z0 + 64);
                const nlen: number = Math.sqrt(nx * nx + nz * nz);
                if (!(nlen > 0)) {
                    return;
                }

                // The probe rides the TILE'S OWN PLANE — the mean of this edge's two corner
                // heights — rather than sampling the ground beyond the tile: a flat decal
                // that follows the tile it frames can never slide down a cliff face.
                const ax: number = mx + (nx / nlen) * TRUE_TILE_PLUS_OUTER_UNITS;
                const az: number = mz + (nz / nlen) * TRUE_TILE_PLUS_OUTER_UNITS;
                const ay: number = (wy[i] + wy[j]) * 0.5;

                if (!World.ttpProject(World.ttpPx, World.ttpPy, i, wx[i], wy[i], wz[i])) {
                    return;   // a corner is behind the camera: skip the frame, like every overlay
                }

                if (!World.ttpProject(World.ttpOx, World.ttpOy, i, ax, ay, az)) {
                    return;
                }
            }
        }

        // The mod's own Pix3D binding: `trans` is the mix's DESTINATION weight (0 = opaque)
        // and both the software raster and the gpu mod's capture honour it. hclip is the
        // caller's job — the ground draws set it the same way — so a partly off-screen blade
        // clamps to the buffer instead of wrapping a row.
        const savedTrans: number = Pix3D.trans;
        const savedHclip: boolean = Pix3D.hclip;
        Pix3D.hclip = true;
        trueTilePlusEffect((xA: number, xB: number, xC: number, yA: number, yB: number, yC: number, colour: number, trans: number): void => {
            Pix3D.trans = trans;
            Pix3D.flatTriangle(xA, xB, xC, yA, yB, yC, colour);
        }, World.ttpPx, World.ttpPy, World.ttpOx, World.ttpOy, settings, Date.now() / 1000, 1 << edge);
        Pix3D.trans = savedTrans;
        Pix3D.hclip = savedHclip;
    }
    // lclite:true-tile-plus:end

''')

WORLD_FILL_BLOCK = dedent('''\
                // lclite:true-tile-plus
                if (tileDrawn) {
                    this.trueTilePlusDraw(tileX, tileZ, level); // custom (lclite "true-tile-plus") — the edge whose flames lie over THIS tile, so the ground under them is already down
                }
                // lclite:true-tile-plus:end

''')


def read(path):
    with open(path, 'rb') as f:
        raw = f.read()
    text = raw.decode('utf-8')
    eol = '\r\n' if '\r\n' in text else '\n'
    return text.replace('\r\n', '\n'), eol


def write(path, text, eol):
    with open(path, 'wb') as f:
        f.write(text.replace('\n', eol).encode('utf-8'))


def strip_all(path):
    """Remove every block of this mod, leaving the pristine text the inserts expect."""
    text, eol = read(path)
    before = len(text)
    stripped = STRIP.sub('', text)
    if stripped != text:
        removed = before - len(stripped)
        assert removed < 40000, f'strip removed {removed} chars from {path} — refusing to write'
        print(f'  stripped a previous run: -{removed} chars')
        write(path, stripped, eol)
    else:
        stripped = text
    assert '// lclite:true-tile-plus' not in stripped, f'a marker survived the strip in {path}'
    return eol


def splice(path, anchor, mode, block):
    """anchor count must be 1; mode = 'before' | 'after' | 'replace'."""
    text, eol = read(path)
    n = text.count(anchor)
    assert n == 1, f'anchor matched {n}x in {os.path.basename(path)}:\n{anchor!r}'
    if mode == 'before':
        text = text.replace(anchor, block + anchor)
    elif mode == 'after':
        text = text.replace(anchor, anchor + block)
    else:
        text = text.replace(anchor, block)
    write(path, text, eol)
    print(f'  {os.path.basename(path)}: {mode} ok, {text.count("// lclite:true-tile-plus")} marker lines')


print(f'true-tile-plus edit — tree: {ROOT}')
for p in (CLIENT, WORLD):
    strip_all(p)

# 1. Client.ts: the arm call, before the camera-shake loop in gameDrawMain(). The nearest
#    other mod island is camera's camFollow block ~18 lines above; true-tile's own arm and
#    hover-tile's are inside the camera-shake block below it.
splice(CLIENT,
       '        for (let axis: number = 0; axis < 5; axis++) {\n',
       'before',
       CLIENT_BLOCK)

# 2. World.ts: the payload import, in the pristine dash3d import group (true-tile's import
#    sits after the `import type PointNormal` lines at the end of that group, 10+ lines away).
splice(WORLD,
       "import Wall from '#/dash3d/Wall.js';\n",
       'after',
       WORLD_IMPORT_BLOCK)

# 3. World.ts: the parked state + methods, in the pristine run between the small accessors
#    and shareLight() (~84 lines clear of true-tile's parked block after removeSprites()).
splice(WORLD,
       '    shareLight(ambient: number, contrast: number, lightSrcX: number, lightSrcY: number, lightSrcZ: number): void {\n',
       'before',
       WORLD_PARKED_BLOCK)

# 4. World.ts: the draw call in fill(), once this tile's ground is down. `let frontWallTypes`
#    is the unique half of the window — `const wall: Wall | null = tile.wall;` alone appears
#    5x in the file, and the lines between it and true-tile's island are the clearance.
FILL_ANCHOR = '                let frontWallTypes: number = 0;\n\n                const wall: Wall | null = tile.wall;\n'
splice(WORLD,
       FILL_ANCHOR,
       'replace',
       '                let frontWallTypes: number = 0;\n\n' + WORLD_FILL_BLOCK + '                const wall: Wall | null = tile.wall;\n')

print('done — now: tsc, then regen (regen BEFORE apply, always)')
