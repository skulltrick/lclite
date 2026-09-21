// lclite:stat-orbs — the minimap data orbs' PURE core: this mod's own settings, the
// readout font (table and rasterizer), the structural lookup of the prayer book, the
// run/walk buttons and the special-attack bar in the loaded interface list, and the
// quick-prayer panel's and the spec orb's geometry and hit tests.
//
// Nothing here touches the DOM, client state or Pix2D, so
// mods/stat-orbs/tools/stat_orbs_test.ts runs the REAL shipped logic headlessly (the
// panel's grid, its hit test, the glyph raster and every lookup are what that harness
// exercises). `apply` copies this file verbatim; one import hunk in Client.ts pulls it
// into the bundle.
//
// Why look the prayers up instead of hardcoding component ids: component ids are
// assigned by the interface packer, so they are a revision-specific accident. What is
// STABLE is the shape of the interface — fifteen toggle buttons whose scripts push
// fifteen consecutive varps, each with a graphic/activegraphic icon centred in its own
// box — and that is exactly what statOrbsBook() matches. Same story for the run
// buttons: the varp the cache marks `clientcode=7` is the one the server itself calls
// VarPlayerType.RUN, so the pair of SELECT buttons pushing it is the run/walk pair. And
// the special-attack bar is the run of `gt` segments reading one varp with rising
// thresholds, whose layer the server hides for a weapon without a special attack.

/** The widget the orbs (and the quick-prayer panel) are painted into: areaMap, 172x156,
 *  composited onto the canvas at 550,4 — the same buffer the minimap itself rides. */
export const ORB_PANEL_W: number = 172;
export const ORB_PANEL_H: number = 156;
/** That widget's origin in the 765x503 canvas space (`this.areaMap?.draw(550, 4)`). */
export const ORB_ORIGIN_X: number = 550;
export const ORB_ORIGIN_Y: number = 4;
/** The sidebar's OWN stone strip left of that widget: canvas x 516..549, exactly the
 *  widget's height. The client paints its background sprites at 516 (`backvmid1`), and the
 *  widget is composited over them at 550 — so this strip is free stone, and it is the one
 *  piece of the sidebar a dragged orb column can hang into. Pixels outside the widget
 *  buffer cannot exist IN it, so the strip is a second buffer this mod composites itself
 *  (see `orbsStripFrame` in Client.ts): its background is copied straight out of the
 *  sidebar's own `backvmid1` pixels, which makes it pixel-identical to the stone already
 *  on the canvas. ORB_STRIP_W is therefore also how far a box may overhang the widget's
 *  left edge — the same number the drag layer is told (registerCanvas' 8th element). */
export const ORB_STRIP_W: number = 34;
export const ORB_STRIP_H: number = ORB_PANEL_H;
export const ORB_STRIP_X: number = ORB_ORIGIN_X - ORB_STRIP_W;

// ---- the readout font ------------------------------------------------------------
/** The 3x5 pixel digits, row-major, '1' = ink — the WHOLE-step font (1x, 2x, 3x; the half
 *  steps draw ORB_DIGITS_HALF). No 2004 font fits beside an orb (p12 digits are 6px wide
 *  plus a shadow), and a tiny font is what OSRS itself draws its orb numbers in — the
 *  scale setting is what makes "tiny" a choice. The table lives in this PURE core (not in
 *  Client.ts) so the harness can rasterize a readout headlessly and compare it to the
 *  pixels the client draws. */
export const ORB_DIGITS: string[] = [
    '111101101101111', // 0
    '010110010010111', // 1
    '111001111100111', // 2
    '111001111001111', // 3
    '101101111001001', // 4
    '111100111001111', // 5
    '111100111101111', // 6
    '111001001010010', // 7
    '111101111101111', // 8
    '111101111001111'  // 9
];
/** The font's own grid: 3x5 ink and a 1px gap, all at scale 1. Everything below is these
 *  three numbers times the scale, so the digits can never drift from the table. */
export const ORB_DIGIT_W: number = 3;
export const ORB_DIGIT_H: number = 5;
export const ORB_DIGIT_GAP: number = 1;

// ---- the orbs' own marks ---------------------------------------------------------
/** The marks are authored ONCE at this size and drawn at the largest odd size the orb's
 *  glass can carry (see statOrbsMarkSize) — 15px at the shipped orb size, which is 2.1x
 *  the 7x7 mark this mod shipped first. At 7px a heart, a star and a bolt are three
 *  blobs that read as the same smudge, which is exactly what was wrong with them.
 *
 *  The art is hand-drawn in the 2004 idiom: hard pixels, no anti-aliasing, and a
 *  silhouette that keeps clear of the corners, because the glass it sits in is a CIRCLE.
 *  The prayer mark is a redraw of the game's OWN prayer icon — 2004's Prayer skill icon
 *  (`staticons,4` in the media jag) is a concave four-pointed star, so the orb carries
 *  the game's own symbol rather than an invented one. The run mark is the BOOT every
 *  RuneScape player reads as "run energy"; a lightning bolt was never that.
 *
 *  They live here with the digit font, and for the same reason: the client only inks a
 *  mark that is a COMPLETE square of the master's own size (see statOrbsGlyphOk), and the
 *  run orb shipped for a while with a 52-character bolt that the old length test silently
 *  refused — an empty orb, with nothing anywhere to say why. The harness checks them. */
export const ORB_MARK_SIZE: number = 15;
/** The smallest mark worth drawing: below this the art is a smudge again, so the orb goes
 *  without one. Nothing in the shipped 20-28px orb range reaches it. */
export const ORB_MARK_MIN: number = 11;

export const ORB_GLYPH_HP: string =
    '001110000011100' +      // the two lobes, one pixel of gap between them
    '011111000111110' +
    '011111101111110' +
    '011111111111110' +
    '011111111111110' +
    '011111111111110' +
    '011111111111110' +
    '011111111111110' +
    '001111111111100' +
    '001111111111100' +
    '000111111111000' +
    '000011111110000' +
    '000001111100000' +
    '000000111000000' +
    '000000010000000';      // the point
export const ORB_GLYPH_PRAYER: string =
    '000000010000000' +      // the top point
    '000000111000000' +
    '000000111000000' +
    '000001111100000' +
    '000011111110000' +
    '001111111111100' +      // the arms flare out late, which is what makes it concave
    '011111111111110' +
    '111111111111111' +      // the bar, on the centre row
    '011111111111110' +
    '001111111111100' +
    '000011111110000' +
    '000001111100000' +
    '000000111000000' +
    '000000111000000' +
    '000000010000000';
export const ORB_GLYPH_RUN: string =
    '000111000000000' +      // the boot: the shaft (ankle) on the left,
    '000111000000000' +
    '000111000000000' +
    '000111000000000' +
    '000111000000000' +
    '000111100000000' +
    '000111110000000' +
    '000111111000000' +      // the instep, then the foot reaching right,
    '001111111100000' +
    '001111111110000' +
    '011111111111000' +
    '011111111111100' +
    '011111111111110' +      // and the sole
    '011111111111110' +
    '011111111111110';

/** Is `glyph` a complete ORB_MARK_SIZE x ORB_MARK_SIZE mark of 0/1? `drawOrb` inks nothing
 *  else — a mark of the wrong length is not a smaller mark, it is no mark at all. */
export function statOrbsGlyphOk(glyph: string): boolean {
    if (glyph.length !== ORB_MARK_SIZE * ORB_MARK_SIZE) {
        return false;
    }

    for (let i: number = 0; i < glyph.length; i++) {
        const c: string = glyph.charAt(i);
        if (c !== '0' && c !== '1') {
            return false;
        }
    }

    return true;
}

/** The side of the mark a glass of radius `innerR` can carry: the largest ODD size whose
 *  1px outline still lands on glass, capped at the master's own size. 0 = no mark at all
 *  (the outline is what makes a mark legible over both the liquid and the dark glass, so
 *  a mark that cannot have one is not drawn). */
export function statOrbsMarkSize(innerR: number): number {
    if (!(innerR >= 1)) {
        return 0;
    }

    let size: number = Math.min(ORB_MARK_SIZE, 2 * innerR - 1);
    if (size % 2 === 0) {
        size--;
    }

    return size >= ORB_MARK_MIN ? size : 0;
}

/** Which MASTER column/row a mark drawn at `size` samples. Symmetric nearest-neighbour —
 *  `floor((d + 0.5) * MASTER / size)` — so a 13px mark is the 15px art with the two
 *  outermost columns dropped from BOTH sides at once; the naive `d * MASTER / size` drops
 *  them from one side only and quietly breaks the mark's own symmetry. */
export function statOrbsMarkSource(size: number, d: number): number {
    if (size >= ORB_MARK_SIZE) {
        return d;
    }

    return ((d * ORB_MARK_SIZE + (ORB_MARK_SIZE >> 1)) / size) | 0;
}

/** One pixel of `mark` as drawn at `size` — the exact ink `drawOrb` plots. */
export function statOrbsMarkPixel(mark: string, size: number, i: number, j: number): boolean {
    return mark.charAt(statOrbsMarkSource(size, j) * ORB_MARK_SIZE + statOrbsMarkSource(size, i)) === '1';
}

/** The widest readout the column's inset reserves room for (three digits: "100"). */
export const ORB_NUMBER_COLS: number = 3;
export const ORB_NUMBER_SCALE_MIN: number = 1;
export const ORB_NUMBER_SCALE_MAX: number = 3;
/** The readout scales in HALF steps — 1, 1.5, 2, 2.5, 3. Whole steps made the first two
 *  settings a doubling, which is a very sharp jump for the smallest readouts. */
export const ORB_NUMBER_SCALE_STEP: number = 0.5;
/** How many half steps the range holds (5: 1 .. 3). */
export const ORB_NUMBER_SCALE_STEPS: number = Math.round((ORB_NUMBER_SCALE_MAX - ORB_NUMBER_SCALE_MIN) / ORB_NUMBER_SCALE_STEP) + 1;
/** The gap between a 'left' readout and the orb's rim. */
export const ORB_NUMBER_GAP: number = 3;

// ---- interface ids the lookups match on (copied from webclient's own enums) -------
export const ORB_TYPE_GRAPHIC: number = 5;       // ComponentType.TYPE_GRAPHIC
export const ORB_BUTTON_TOGGLE: number = 4;      // ButtonType.BUTTON_TOGGLE
export const ORB_BUTTON_SELECT: number = 5;      // ButtonType.BUTTON_SELECT
/** The interface-script opcode `pushvar`: script 0 of every toggle/select button starts
 *  with it, and its operand is the varp that button drives. */
export const ORB_OP_PUSHVAR: number = 5;
/** The cache's marker for the run-energy varp (`[option_run] clientcode=7`) — the same
 *  test the server makes to find it (VarPlayerType.RUN). */
export const ORB_RUN_CLIENTCODE: number = 7;
/** 2004's prayer book: fifteen prayers in the tab's own 3x5 grid. */
export const ORB_BOOK_SIZE: number = 15;

/** The structural subset of webclient's IfType that these lookups read. */
export interface OrbCom {
    id: number;
    layerId: number;
    type: number;
    buttonType: number;
    x: number;
    y: number;
    scripts: (ArrayLike<number> | null)[] | null;
    /** Per-script comparators (the client's own encoding: 2 = `lt`, 3 = `gt`, 4 = `ne`,
     *  anything else `eq`) — how the special-attack bar's thresholds are matched. */
    scriptComparator: ArrayLike<number> | null;
    scriptOperand: ArrayLike<number> | null;
    /** An interface's own tree: a layer's children, which is how the spec bar is reached
     *  from the combat tab's root. */
    children: ArrayLike<number> | null;
    /** `if_sethide` — the server hides a spec bar's whole layer for a weapon without a
     *  special attack, so this flag is the game's own answer to "does this weapon have
     *  one?". Only a LAYER component carries it (the client's parse reads it inside the
     *  TYPE_LAYER branch), which is why the lookup below has to find the layer that
     *  actually CONTAINS the bar's segments. */
    hide: boolean;
    /** A text component's ACTIVE text (`activetext=`): the game swaps to it while the
     *  component's own comparator script is true, which is how the spec bar's own label
     *  says "the special attack is armed". */
    text2: string | null;
    /** `option=` on a BUTTON_OK component — what the client's own right-click menu offers
     *  and therefore what makes a component clickable at all. */
    buttonText: string | null;
    graphic: unknown | null;
    graphic2: unknown | null;
}

export interface OrbSettings {
    /** 1-3 in half steps: how large the HP/Prayer/Run readouts are drawn. */
    numberScale: number;
    /** Click the run energy orb to toggle run on/off (the options tab's own button). */
    runClick: boolean;
    /** Click the prayer orb to open the prayer book over the minimap. */
    prayerPanel: boolean;
    /** Click the special attack orb to arm/disarm the special attack (the combat tab's
     *  own spec bar click). */
    specClick: boolean;
}

/** This mod's OWN keys (rule 5), read per frame at its own hook and clamped here so a
 *  stale, hand-typed or half-written key can never produce a broken layout. The scale is
 *  a FLOAT: it moves in half steps, so parseInt would silently pin every half step to the
 *  whole one below it. */
export function statOrbsSettings(read: (key: string) => string | null): OrbSettings {
    return {
        numberScale: statOrbsScale(parseFloat(read('statOrbsNumberScale') || '') || ORB_NUMBER_SCALE_MIN),
        runClick: read('statOrbsRunClick') !== 'false',
        prayerPanel: read('statOrbsPrayerPanel') !== 'false',
        specClick: read('statOrbsSpecClick') !== 'false'
    };
}

/** Clamp a scale to the supported 1-3, snapped to the nearest HALF step (1, 1.5, 2, 2.5,
 *  3). A stale or hand-typed key lands on a scale the font can actually draw, and the
 *  half steps are what make the range feel like a size rather than three sizes. */
export function statOrbsScale(scale: number): number {
    if (!(scale >= ORB_NUMBER_SCALE_MIN)) {
        return ORB_NUMBER_SCALE_MIN;
    }

    if (scale > ORB_NUMBER_SCALE_MAX) {
        return ORB_NUMBER_SCALE_MAX;
    }

    return Math.round(scale / ORB_NUMBER_SCALE_STEP) * ORB_NUMBER_SCALE_STEP;
}

/** The HALF-step font: 4x7, the same blocky idiom as the digits above, and ONE pixel of
 *  stroke — which is the whole reason it exists. Scaling the 3x5 font by 1.5 puts every
 *  stroke on a 1.5px boundary, and the only hard answers there are 1px (the strokes break
 *  up and the weights go uneven) or 2px (a bold font that reads as 2x — the very jump the
 *  half step is meant to sit between). So a half step draws THIS font at a whole multiple
 *  instead: 1.5x is 4x7, 2.5x is 8x14. Every glyph stays square and hard-edged. */
export const ORB_DIGIT_HALF_W: number = 4;
export const ORB_DIGIT_HALF_H: number = 7;
export const ORB_DIGITS_HALF: string[] = [
    '1111100110011001100110011111', // 0
    '0100110001000100010001001111', // 1
    '1111000100011111100010001111', // 2
    '1111000100011111000100011111', // 3
    '1001100110011111000100010001', // 4
    '1111100010001111000100011111', // 5
    '1111100010001111100110011111', // 6
    '1111000100010010010001000100', // 7
    '1111100110011111100110011111', // 8
    '1111100110011111000100011111'  // 9
];
/** The font a scale draws from, and the WHOLE multiple it is drawn at. */
interface OrbFont {
    digits: string[];
    w: number;
    h: number;
    mult: number;
}

function orbFont(scale: number): OrbFont {
    const s: number = statOrbsScale(scale);
    const mult: number = Math.floor(s);
    if (s - mult >= ORB_NUMBER_SCALE_STEP / 2) {
        return { digits: ORB_DIGITS_HALF, w: ORB_DIGIT_HALF_W, h: ORB_DIGIT_HALF_H, mult: mult };
    }

    return { digits: ORB_DIGITS, w: ORB_DIGIT_W, h: ORB_DIGIT_H, mult: mult };
}

/** A glyph's INK box at `scale`: the font's own box times the whole multiple it draws at.
 *  The sizes run 3x5, 4x7, 6x10, 8x14, 9x15 across 1x … 3x — each one bigger than the
 *  last, and each one on the pixel grid. */
export function statOrbsGlyphW(scale: number): number {
    const f: OrbFont = orbFont(scale);
    return f.w * f.mult;
}

export function statOrbsGlyphH(scale: number): number {
    const f: OrbFont = orbFont(scale);
    return f.h * f.mult;
}

/** The gap between two digits — and the drop of a readout's shadow, which is one whole
 *  font pixel, so it scales with the multiple (1px at 1x, 3px at 3x). */
export function statOrbsDigitGap(scale: number): number {
    return orbFont(scale).mult;
}

/** One digit's advance at `scale` (the ink plus the inter-digit gap). */
export function statOrbsDigitAdvance(scale: number): number {
    return statOrbsGlyphW(scale) + statOrbsDigitGap(scale);
}

/** A whole readout's pixel width at `scale`: `len` digits of ink, minus the trailing
 *  gap. Empty text is 0 wide, which is what a hidden readout needs. */
export function statOrbsNumberWidth(text: string, scale: number): number {
    if (text.length <= 0) {
        return 0;
    }

    return text.length * statOrbsDigitAdvance(scale) - statOrbsDigitGap(scale);
}

/** The top row of a readout drawn vertically centred on cy. */
export function statOrbsNumberTop(cy: number, scale: number): number {
    return cy - (statOrbsGlyphH(scale) >> 1);
}

/** The rasterized glyphs, built once per (digit, scale) and reused: the readouts are
 *  redrawn every frame. */
const ORB_GLYPH_CACHE: (Uint8Array | null)[] = new Array(ORB_DIGITS.length * ORB_NUMBER_SCALE_STEPS).fill(null);

/** Which step of the range a clamped scale is, as an index into the cache. */
export function statOrbsScaleIndex(scale: number): number {
    return Math.round((statOrbsScale(scale) - ORB_NUMBER_SCALE_MIN) / ORB_NUMBER_SCALE_STEP);
}

/** Rasterize one digit at `scale` into a `statOrbsGlyphW x statOrbsGlyphH` bitmap of 0/1,
 *  row-major — exactly the pixels `drawOrbNumber` plots: every font pixel becomes a
 *  `mult x mult` square of ink, so the digits stay square and on the pixel grid at every
 *  size, half steps included. */
export function statOrbsGlyph(digit: number, scale: number): Uint8Array {
    const s: number = statOrbsScale(scale);
    const index: number = digit * ORB_NUMBER_SCALE_STEPS + statOrbsScaleIndex(s);
    const cached: Uint8Array | null = ORB_GLYPH_CACHE[index];
    if (cached) {
        return cached;
    }

    const f: OrbFont = orbFont(s);
    const w: number = f.w * f.mult;
    const h: number = f.h * f.mult;
    const ink: Uint8Array = new Uint8Array(w * h);
    const bits: string = digit >= 0 && digit < f.digits.length ? f.digits[digit] : '';
    for (let j: number = 0; j < f.h; j++) {
        for (let i: number = 0; i < f.w; i++) {
            if (bits.charAt(j * f.w + i) !== '1') {
                continue;
            }

            for (let dy: number = 0; dy < f.mult; dy++) {
                for (let dx: number = 0; dx < f.mult; dx++) {
                    ink[(j * f.mult + dy) * w + i * f.mult + dx] = 1;
                }
            }
        }
    }

    ORB_GLYPH_CACHE[index] = ink;
    return ink;
}

/** Where a 'left' readout starts: hard against the orb's rim, `ORB_NUMBER_GAP` clear. */
export function statOrbsNumberLeft(cx: number, r: number, text: string, scale: number): number {
    return cx - r - ORB_NUMBER_GAP - statOrbsNumberWidth(text, scale);
}

/** The orb column's left inset. 'left' readouts reserve the room three scaled digits
 *  need (14px at scale 1 — the shipped default); with the readouts inside the orbs or
 *  hidden there is no text beside them, so the orbs hug the frame edge instead. */
export function statOrbsOrbLeft(numbers: string, scale: number): number {
    if (numbers !== 'left') {
        return 3;
    }

    return ORB_NUMBER_GAP + statOrbsNumberWidth('000', scale);
}

/** The orb column's and the spec orb's live geometry — what `orbLayout()` computes every
 *  frame in Client.ts from this mod's own keys (rule 5). Declared here so the two drawing
 *  passes (the widget buffer and the stone strip) and the placement maths all speak of
 *  one shape. */
export interface OrbLayout {
    /** Orb radius (size / 2). */
    r: number;
    /** The column's left inset: the room a 'left' readout needs, else 3. */
    orbLeft: number;
    /** The vertical pitch between two orbs (60 - r). */
    step: number;
    /** The column's box origin — negative ox means it hangs into the stone strip. */
    ox: number;
    oy: number;
    /** The column's box: the readouts plus the orbs. */
    boxW: number;
    boxH: number;
    numbers: string;
    scale: number;
    pie: boolean;
    pulse: boolean;
    specX: number;
    specY: number;
    specR: number;
}

/** Clamp a box's left edge into the widget, ALLOWING it to overhang the widget's left
 *  edge by the sidebar's stone strip — the orbs are painted into the widget buffer, and
 *  the strip is the mod's own second buffer, so `-ORB_STRIP_W` is the real wall (the drag
 *  layer is told the same number, so the ghost and the drawn orbs agree). Vertically the
 *  widget IS the boundary: the strip is exactly its height. */
export function statOrbsClampX(x: number, boxW: number): number {
    return Math.max(-ORB_STRIP_W, Math.min(x, ORB_PANEL_W - boxW));
}

export function statOrbsClampY(y: number, boxH: number): number {
    return Math.max(0, Math.min(y, ORB_PANEL_H - boxH));
}

/** Does anything reach into the stone strip at these positions? That is what decides
 *  whether the strip buffer is painted at all — and it must be asked every frame, or a
 *  column dragged back out of the strip would leave its pixels on the stone. */
export function statOrbsInStrip(ox: number, specX: number): boolean {
    return ox < 0 || specX < 0;
}

// ---- the structural lookups ------------------------------------------------------
/** The varp a button's script 0 pushes, or -1 when script 0 is not a `pushvar`. */
function orbScriptVar(com: OrbCom, script: number): number {
    if (!com.scripts || script >= com.scripts.length) {
        return -1;
    }

    const ops: ArrayLike<number> | null = com.scripts[script];
    if (!ops || ops.length < 2 || ops[0] !== ORB_OP_PUSHVAR) {
        return -1;
    }

    return ops[1];
}

/** Reading order of the tab's own grid: top row first, then left to right. */
function orbRowMajor(a: OrbCom, b: OrbCom): number {
    return a.y !== b.y ? a.y - b.y : a.x - b.x;
}

export interface OrbBookCell {
    /** The toggle component the click is sent for (an IF_BUTTON packet). */
    click: number;
    /** The varp that button drives. The panel flips it optimistically, exactly as the
     *  client's own TOGGLE_BUTTON path does; every prayer trigger ends with a
     *  `%prayerN = %prayerN;` resync, so a refusal (no points, level too low) or a
     *  conflicting-prayer shutdown corrects itself on the next tick. */
    varp: number;
    /** The 30x30 icon component: `graphic` unlit, `graphic2` lit (its own script is the
     *  level requirement, which the client's getIfActive() already evaluates). */
    icon: OrbCom;
}

export interface OrbBook {
    layer: number;
    cells: OrbBookCell[];
}

/** Find the prayer book, STRUCTURALLY: the layer holding ORB_BOOK_SIZE toggle buttons
 *  whose script 0 pushes ORB_BOOK_SIZE CONSECUTIVE varps, each with a
 *  graphic+activegraphic icon centred inside its own box.
 *
 *  Cells come back in BOOK ORDER — the tab's 3x5 grid read row-major, so Thick Skin is
 *  cell 0 and Protect from Melee is cell 14, which is also the order the prayeroff /
 *  prayeron frames use. Returns null when this revision's interfaces do not match, and
 *  the caller then simply never offers the panel. */
export function statOrbsBook(list: (OrbCom | null | undefined)[]): OrbBook | null {
    const byLayer: Map<number, OrbCom[]> = new Map();
    for (let i: number = 0; i < list.length; i++) {
        const com = list[i];
        if (!com || com.buttonType !== ORB_BUTTON_TOGGLE || orbScriptVar(com, 0) < 0) {
            continue;
        }

        let group = byLayer.get(com.layerId);
        if (!group) {
            group = [];
            byLayer.set(com.layerId, group);
        }

        group.push(com);
    }

    const layers: number[] = Array.from(byLayer.keys());
    for (let l: number = 0; l < layers.length; l++) {
        const layer: number = layers[l];
        const group: OrbCom[] | undefined = byLayer.get(layer);
        if (!group || group.length !== ORB_BOOK_SIZE) {
            continue;
        }

        const toggles: OrbCom[] = group.slice().sort(orbRowMajor);
        const first: number = orbScriptVar(toggles[0], 0);

        let consecutive: boolean = true;
        for (let i: number = 1; i < toggles.length; i++) {
            if (orbScriptVar(toggles[i], 0) !== first + i) {
                consecutive = false;
                break;
            }
        }

        if (!consecutive) {
            continue;
        }

        const icons: OrbCom[] = [];
        for (let i: number = 0; i < list.length; i++) {
            const com = list[i];
            if (com && com.layerId === layer && com.type === ORB_TYPE_GRAPHIC && com.graphic && com.graphic2) {
                icons.push(com);
            }
        }

        if (icons.length !== ORB_BOOK_SIZE) {
            continue;
        }

        icons.sort(orbRowMajor);

        const cells: OrbBookCell[] = [];
        for (let i: number = 0; i < ORB_BOOK_SIZE; i++) {
            const toggle: OrbCom = toggles[i];
            const icon: OrbCom = icons[i];
            // The icon is 30x30 centred inside its 34x34 toggle box. A pairing that is
            // not is a different interface that merely looks like the book — refuse it
            // rather than draw the wrong icon over the wrong prayer.
            if (Math.abs(icon.x - (toggle.x + 2)) > 4 || Math.abs(icon.y - (toggle.y + 2)) > 4) {
                cells.length = 0;
                break;
            }

            cells.push({ click: toggle.id, varp: orbScriptVar(toggle, 0), icon });
        }

        if (cells.length === ORB_BOOK_SIZE) {
            return { layer, cells };
        }
    }

    return null;
}

export interface OrbRun {
    varp: number;
    /** The component that selects walking, and the one that selects running. Clicking
     *  one is exactly what the player's own click in the options tab sends. */
    off: number;
    on: number;
}

/** Find the player-controls run/walk buttons: the SELECT pair whose script 0 pushes the
 *  run varp. Both buttons live in the controls tab, which the server keeps in
 *  `player.tabs` from login, so an IF_BUTTON for either is accepted no matter which
 *  tab the player is looking at. */
export function statOrbsRun(list: (OrbCom | null | undefined)[], runVarp: number): OrbRun | null {
    if (runVarp < 0) {
        return null;
    }

    let off: number = -1;
    let on: number = -1;
    for (let i: number = 0; i < list.length; i++) {
        const com = list[i];
        if (!com || com.buttonType !== ORB_BUTTON_SELECT || orbScriptVar(com, 0) !== runVarp) {
            continue;
        }

        if (!com.scriptOperand || com.scriptOperand.length < 1) {
            continue;
        }

        if (com.scriptOperand[0] === 0) {
            off = com.id;
        } else if (com.scriptOperand[0] === 1) {
            on = com.id;
        }
    }

    return off >= 0 && on >= 0 ? { varp: runVarp, off, on } : null;
}

// ---- the special-attack orb ------------------------------------------------------
/** The interface-script comparator the spec bar's segments read with — `gt`, in the
 *  client's own getIfActive encoding (3 = "show while the varp is greater than the
 *  operand"). */
export const ORB_CMP_GT: number = 3;
/** How many segments a run of `gt` components needs before it is the bar rather than a
 *  coincidence. 2004 draws ten of them, one per 10% of the energy. */
export const ORB_SPEC_MIN_SEGMENTS: number = 2;
/** How far the interface walk may run before giving up: a malformed or cyclic list must
 *  never hang the frame. */
export const ORB_SPEC_WALK_MAX: number = 4096;
/** The spec orb is "a bit bigger" than the others: +2px of radius, so it reads as the one
 *  orb that is not part of the column. */
export const ORB_SPEC_EXTRA: number = 2;
/** How clear of the column's own right edge the spec orb's default spot sits. */
export const ORB_SPEC_GAP: number = 4;
/** The component types the bar's own two parts are (webclient's ComponentType.TYPE_TEXT
 *  and ButtonType.BUTTON_OK): the bar's clickable rect is a BUTTON_OK component and its
 *  label is a TEXT one. */
export const ORB_TYPE_TEXT: number = 4;
export const ORB_BUTTON_OK: number = 1;

export interface OrbSpec {
    /** The varp the bar's segments read — 2004Scape's `sa_energy`. */
    varp: number;
    /** Full energy, from the bar's own top threshold plus one — the thresholds are
     *  exclusive (`gt,999` is the bar at full), so this is 1000 in 2004Scape
     *  (`^sa_max_energy`), derived from the interface rather than hardcoded. */
    max: number;
    /** The LAYER component the server hides for a weapon without a special attack — the
     *  layer the bar's segments were actually declared under, NOT their `layerId` (which
     *  is the interface's root: see statOrbsSpec). */
    layer: number;
    /** The bar's own clickable rect — the `[specbar]` component whose
     *  `option=Use @gre@Special Attack` the player clicks in the combat tab. Sending an
     *  IF_BUTTON for it is EXACTLY what that click sends, which is what makes the orb a
     *  real special-attack button rather than a second, parallel control. -1 when this
     *  revision's bar has no such rect. */
    click: number;
    /** The varp the bar's own ACTIVE TEXT reads (`script1op1=pushvar,sa_attack` with
     *  `script1=gt,0`) — the game's own "the special attack is armed" flag, and the very
     *  value its own label turns yellow on. -1 when the bar has no active text. */
    armed: number;
    /** The operand of that `gt`: the flag is on while the varp is ABOVE it. */
    armedMin: number;
}

/** Find the special-attack bar in the COMBAT tab's interface, STRUCTURALLY.
 *
 *  The bar is the one layer holding a run of segments that each read the SAME varp with a
 *  `gt` comparator and evenly rising thresholds (`script1=gt,99` … `gt,999`) — that is how
 *  2004 draws it: ten model components, each shown while the energy is above its own
 *  threshold. The varp they push IS the energy varp, and the highest threshold plus one is
 *  the maximum, so nothing here is hardcoded: a revision that renumbers the interface, or
 *  a server that rescales the energy, still resolves.
 *
 *  `root` is the combat tab's own interface component (`sideIcon[0]`, which the server
 *  swaps by weapon category), and only THAT interface is searched — every other category's
 *  spec bar keeps whatever hidden state it had when it was last on screen, so a stale one
 *  must never be mistaken for the wielded weapon's. Returns null when this revision's
 *  interfaces do not match, and the caller then simply never offers the orb.
 *
 *  THE LAYER IS THE SEGMENTS' PARENT, NOT THEIR `layerId`. The interface packer writes the
 *  interface's own ROOT id into every component's layer slot (`layerId`), and a `layer=`
 *  line only MOVES a component into a named layer's `children` — so `layerId` is the TAB,
 *  and reading `hide` off it answers "is the combat tab hidden", i.e. always no. That was
 *  this mod's bug: the orb read red for every weapon, special attack or not. The component
 *  `if_sethide($specbar_layer, …)` actually targets is the one that CONTAINS the segments,
 *  which only the tree walk can tell us, so the walk records each component's parent. */
export function statOrbsSpec(list: (OrbCom | null | undefined)[], root: number): OrbSpec | null {
    if (!(root >= 0) || root >= list.length) {
        return null;
    }

    // walk the interface's own tree, remembering each component's PARENT
    const parent: number[] = [];
    const seen: number[] = [root];
    const stack: number[] = [root];
    parent[root] = -1;
    let guard: number = 0;
    while (stack.length > 0 && guard++ < ORB_SPEC_WALK_MAX) {
        const owner: number = stack.pop() as number;
        const com = list[owner];
        if (!com || !com.children) {
            continue;
        }

        for (let i: number = 0; i < com.children.length; i++) {
            const id: number = com.children[i];
            if (!(id >= 0) || id >= list.length || seen.indexOf(id) >= 0) {
                continue;
            }

            seen.push(id);
            parent[id] = owner;
            stack.push(id);
        }
    }

    // group the segments by the varp they push AND the layer that holds them: one bar is
    // one varp inside one layer
    const varps: number[] = [];
    const layers: number[] = [];
    const ops: number[][] = [];
    for (let s: number = 0; s < seen.length; s++) {
        const id: number = seen[s];
        const com = list[id];
        if (!com || !com.scriptComparator || com.scriptComparator[0] !== ORB_CMP_GT) {
            continue;
        }

        const varp: number = orbScriptVar(com, 0);
        if (varp < 0) {
            continue;
        }

        const layer: number = parent[id] === undefined ? -1 : parent[id];
        if (layer < 0) {
            continue;                       // the root itself is nobody's segment
        }

        let g: number = -1;
        for (let i: number = 0; i < varps.length; i++) {
            if (varps[i] === varp && layers[i] === layer) {
                g = i;
                break;
            }
        }

        if (g < 0) {
            varps.push(varp);
            layers.push(layer);
            ops.push([]);
            g = varps.length - 1;
        }

        ops[g].push(com.scriptOperand ? com.scriptOperand[0] : 0);
    }

    // The FULLEST bar wins: a shorter run of `gt` segments elsewhere in the same
    // interface (another bar on another varp) is not the special-attack bar, and the one
    // 2004 draws has ten of them.
    let best: number = -1;
    for (let g: number = 0; g < varps.length; g++) {
        const thresholds: number[] = ops[g];
        if (thresholds.length < ORB_SPEC_MIN_SEGMENTS) {
            continue;
        }

        thresholds.sort((a: number, b: number) => a - b);

        // evenly spaced and strictly rising, or this is not a bar
        let step: number = 0;
        let even: boolean = true;
        for (let i: number = 1; i < thresholds.length; i++) {
            const d: number = thresholds[i] - thresholds[i - 1];
            if (d <= 0 || (step !== 0 && d !== step)) {
                even = false;
                break;
            }
            step = step === 0 ? d : step;
        }

        if (!even || step <= 0 || !list[layers[g]]) {
            continue;
        }

        if (best < 0 || thresholds.length > ops[best].length) {
            best = g;
        }
    }

    if (best < 0) {
        return null;
    }

    // The top threshold is EXCLUSIVE — a segment is shown while the energy is greater than
    // its own threshold, so `gt,999` is the bar at full — which makes the top threshold
    // plus one the maximum (1000 in 2004Scape, `^sa_max_energy`). Taking the step size
    // instead would read 1099 and cost the readout a tenth of its range.
    const bestOps: number[] = ops[best];
    const layer: number = layers[best];
    const flag: number[] = orbSpecFlag(list, layer, varps[best]);
    return {
        varp: varps[best],
        max: bestOps[bestOps.length - 1] + 1,
        layer: layer,
        click: orbSpecButton(list, layer),
        armed: flag[0],
        armedMin: flag[1]
    };
}

/** The bar layer's own clickable rect: its BUTTON_OK child that carries an option. The
 *  client's right-click menu only offers a button with a `buttonText` (that is where the
 *  packer puts `option=`), so that is the component a player can actually click — and
 *  therefore the one an IF_BUTTON for this orb must name. -1 when there is none. */
function orbSpecButton(list: (OrbCom | null | undefined)[], layer: number): number {
    const com = list[layer];
    if (!com || !com.children) {
        return -1;
    }

    for (let i: number = 0; i < com.children.length; i++) {
        const child = list[com.children[i]];
        if (child && child.buttonType === ORB_BUTTON_OK && child.buttonText !== null && child.buttonText.length > 0) {
            return child.id;
        }
    }

    return -1;
}

/** The bar layer's own "armed" flag, as `[varp, operand]`: the TEXT child whose active
 *  text swaps while a varp is above a threshold (`script1=gt,0`). That is the game's own
 *  test — the same one that turns the bar's label yellow — so this can never drift from
 *  what the bar itself shows. `[-1, 0]` when the bar has no such text. */
function orbSpecFlag(list: (OrbCom | null | undefined)[], layer: number, energyVarp: number): number[] {
    const com = list[layer];
    if (!com || !com.children) {
        return [-1, 0];
    }

    for (let i: number = 0; i < com.children.length; i++) {
        const child = list[com.children[i]];
        if (!child || child.type !== ORB_TYPE_TEXT || child.text2 === null) {
            continue;
        }

        if (!child.scriptComparator || child.scriptComparator[0] !== ORB_CMP_GT) {
            continue;
        }

        const varp: number = orbScriptVar(child, 0);
        if (varp < 0 || varp === energyVarp) {
            continue;
        }

        return [varp, child.scriptOperand && child.scriptOperand.length > 0 ? child.scriptOperand[0] : 0];
    }

    return [-1, 0];
}

/** Does the wielded weapon have a special attack? The server hides the whole bar's layer
 *  for one that does not (`if_sethide($specbar_layer, …)` on every weapon category), so
 *  this is the game's own answer — read LIVE, because the weapon can change on any tick
 *  and the flag moves with it. The client skips a hidden layer and its children in
 *  drawInterface, so a bar this refuses is a bar the player cannot see either. */
export function statOrbsSpecWeapon(list: (OrbCom | null | undefined)[], spec: OrbSpec | null): boolean {
    if (spec === null) {
        return false;
    }

    const com = list[spec.layer];
    return com !== undefined && com !== null && !com.hide;
}

/** Is the special attack ARMED — will the next attack spend the energy? The bar's own
 *  active text answers it, so the caller hands in that varp's value straight out of the
 *  client's own `var[]` and this makes the same comparison `getIfActive` does. */
export function statOrbsSpecArmed(value: number, spec: OrbSpec | null): boolean {
    return spec !== null && spec.armed >= 0 && value > spec.armedMin;
}

/** The bar's energy as a whole percent (0-100), off the varp's raw value. */
export function statOrbsSpecPercent(value: number, max: number): number {
    if (!(max > 0) || !(value > 0)) {
        return 0;
    }

    const pct: number = Math.round((value * 100) / max);
    return pct > 100 ? 100 : pct;
}

/** The radius of an orb's GLASS, for an orb of radius `r`: inside the 1px hard outline and
 *  the metal rim (2px from 18px orbs up, 1px below that). This is the disc every mark is
 *  clipped to and the ring the spec orb's "armed" highlight is drawn on, so `drawOrb` and
 *  its callers cannot disagree about where the glass ends. */
export function statOrbsGlassRadius(r: number): number {
    return r - 1 - (r >= 9 ? 2 : 1);
}

/** The spec orb's default box [x, y, w, h] in the widget's own pixels: the panel's BOTTOM
 *  LEFT, clear of the orb column (and of the wiki button, which owns the bottom right).
 *  It is bottom-aligned with the column, so it sits in the free stone below the map
 *  circle's left rim rather than across the other three orbs. Its own placement keys
 *  override this, exactly like the column's. */
export function statOrbsSpecBox(columnRight: number, columnBottom: number, r: number): number[] {
    const rs: number = r + ORB_SPEC_EXTRA;
    const size: number = 2 * rs;
    let x: number = columnRight + ORB_SPEC_GAP;
    let y: number = columnBottom - size;
    x = Math.max(0, Math.min(x, ORB_PANEL_W - size));
    y = Math.max(0, Math.min(y, ORB_PANEL_H - size));
    return [x, y, size, size];
}

/** The largest readout scale whose three digits still fit INSIDE the spec orb's glass.
 *  The percentage is the orb's whole information, so it is always drawn inside — and at a
 *  whole 2x it would be 22px across in a 20px glass and sit on the rim. */
export function statOrbsSpecTextScale(scale: number, innerR: number): number {
    let s: number = statOrbsScale(scale);
    while (s > ORB_NUMBER_SCALE_MIN && statOrbsNumberWidth('100', s) > innerR * 2) {
        s -= ORB_NUMBER_SCALE_STEP;
    }

    return s;
}

// ---- the quick-prayer panel ------------------------------------------------------
/** The book's own layout, turned back the right way up: the prayer tab is three columns
 *  by five rows, and the panel is the same grid at the same 30x30 icon size — one
 *  column of 31px cells wider than 3x30 because the icons are 1px apart. It is TALL
 *  rather than wide because the orb column owns the panel's left edge and the widget is
 *  only 172px across: a 5-across grid would either cover the orbs or shrink the icons. */
export const ORB_BOOK_COLS: number = 3;
export const ORB_BOOK_ROWS: number = 5;
export const ORB_BOOK_PITCH: number = 31;
export const ORB_BOOK_W: number = ORB_BOOK_COLS * ORB_BOOK_PITCH + 2;    // 95
export const ORB_BOOK_H: number = ORB_BOOK_ROWS * ORB_BOOK_PITCH + 1;    // 156

/** The panel's box [x, y, w, h] in the widget's own pixels. It opens immediately right
 *  of the orb column and slides right as the readouts grow, clamped FLUSH inside the
 *  widget (the widget IS the boundary — a canvas surface can never leave it). */
export function statOrbsBookBox(orbRight: number): number[] {
    let x: number = orbRight + 3;
    if (x > ORB_PANEL_W - ORB_BOOK_W) {
        x = ORB_PANEL_W - ORB_BOOK_W;
    }

    if (x < 2) {
        x = 2;
    }

    return [x, 0, ORB_BOOK_W, ORB_BOOK_H];
}

/** The top-left pixel of cell `i`'s icon, in the widget's own space. */
export function statOrbsBookCell(box: number[], i: number): number[] {
    return [box[0] + 1 + (i % ORB_BOOK_COLS) * ORB_BOOK_PITCH, box[1] + 1 + ((i / ORB_BOOK_COLS) | 0) * ORB_BOOK_PITCH];
}

/** Is the point inside the box? Half-open on the far edges, so boxes tile exactly. */
export function statOrbsInBox(mx: number, my: number, box: number[]): boolean {
    return mx >= box[0] && my >= box[1] && mx < box[0] + box[2] && my < box[1] + box[3];
}

/** Which cell of the book is under the point, or -1 for "not on a prayer" — which the
 *  caller reads as "a click elsewhere on the panel closes it". */
export function statOrbsBookHit(mx: number, my: number, box: number[]): number {
    if (!statOrbsInBox(mx, my, box)) {
        return -1;
    }

    const col: number = Math.floor((mx - box[0] - 1) / ORB_BOOK_PITCH);
    const row: number = Math.floor((my - box[1] - 1) / ORB_BOOK_PITCH);
    if (col < 0 || col >= ORB_BOOK_COLS || row < 0 || row >= ORB_BOOK_ROWS) {
        return -1;
    }

    return row * ORB_BOOK_COLS + col;
}

/** Is the point on the circular orb centred at (cx, cy)? The orbs are discs, so their
 *  clickable area is a disc too. */
export function statOrbsOrbHit(mx: number, my: number, cx: number, cy: number, r: number): boolean {
    const dx: number = mx - cx;
    const dy: number = my - cy;
    return dx * dx + dy * dy <= r * r;
}
