// lclite:stat-orbs — the minimap data orbs' PURE core: this mod's own settings, the
// structural lookup of the prayer book and the run buttons in the loaded interface
// list, and the quick-prayer panel's geometry and hit tests.
//
// Nothing here touches the DOM, client state or Pix2D, so
// mods/stat-orbs/tools/stat_orbs_test.ts runs the REAL shipped logic headlessly (the
// panel's grid, its hit test and both lookups are what that harness exercises). `apply`
// copies this file verbatim; one import hunk in Client.ts pulls it into the bundle.
//
// Why look the prayers up instead of hardcoding component ids: component ids are
// assigned by the interface packer, so they are a revision-specific accident. What is
// STABLE is the shape of the interface — fifteen toggle buttons whose scripts push
// fifteen consecutive varps, each with a graphic/activegraphic icon centred in its own
// box — and that is exactly what statOrbsBook() matches. Same story for the run
// buttons: the varp the cache marks `clientcode=7` is the one the server itself calls
// VarPlayerType.RUN, so the pair of SELECT buttons pushing it is the run/walk pair.

/** The widget the orbs (and the quick-prayer panel) are painted into: areaMap, 172x156,
 *  composited onto the canvas at 550,4 — the same buffer the minimap itself rides. */
export const ORB_PANEL_W: number = 172;
export const ORB_PANEL_H: number = 156;
/** That widget's origin in the 765x503 canvas space (`this.areaMap?.draw(550, 4)`). */
export const ORB_ORIGIN_X: number = 550;
export const ORB_ORIGIN_Y: number = 4;

// ---- the readout font ------------------------------------------------------------
/** The 3x5 pixel digits, drawn at an integer SCALE. No 2004 font fits beside an orb
 *  (p12 digits are 6px wide plus a shadow), and a tiny font is what OSRS itself draws
 *  its orb numbers in — the scale setting is what makes "tiny" a choice. */
export const ORB_DIGIT_ADVANCE: number = 4;      // 3px ink + a 1px gap, per scale step
export const ORB_DIGIT_H: number = 5;
/** The widest readout the column's inset reserves room for (three digits: "100"). */
export const ORB_NUMBER_COLS: number = 3;
export const ORB_NUMBER_SCALE_MIN: number = 1;
export const ORB_NUMBER_SCALE_MAX: number = 3;
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
    scriptOperand: ArrayLike<number> | null;
    graphic: unknown | null;
    graphic2: unknown | null;
}

export interface OrbSettings {
    /** 1-3: how large the HP/Prayer/Run readouts are drawn. */
    numberScale: number;
    /** Click the run energy orb to toggle run on/off (the options tab's own button). */
    runClick: boolean;
    /** Click the prayer orb to open the prayer book over the minimap. */
    prayerPanel: boolean;
}

/** This mod's OWN keys (rule 5), read per frame at its own hook and clamped here so a
 *  stale, hand-typed or half-written key can never produce a broken layout. */
export function statOrbsSettings(read: (key: string) => string | null): OrbSettings {
    return {
        numberScale: statOrbsScale(parseInt(read('statOrbsNumberScale') || '') || ORB_NUMBER_SCALE_MIN),
        runClick: read('statOrbsRunClick') !== 'false',
        prayerPanel: read('statOrbsPrayerPanel') !== 'false'
    };
}

/** Clamp a scale to the supported 1-3. */
export function statOrbsScale(scale: number): number {
    if (!(scale >= ORB_NUMBER_SCALE_MIN)) {
        return ORB_NUMBER_SCALE_MIN;
    }

    if (scale > ORB_NUMBER_SCALE_MAX) {
        return ORB_NUMBER_SCALE_MAX;
    }

    return scale | 0;
}

/** One digit's advance at `scale` (the ink plus the inter-digit gap). */
export function statOrbsDigitAdvance(scale: number): number {
    return ORB_DIGIT_ADVANCE * statOrbsScale(scale);
}

/** A whole readout's pixel width at `scale`: `len` digits of ink, minus the trailing
 *  gap. Empty text is 0 wide, which is what a hidden readout needs. */
export function statOrbsNumberWidth(text: string, scale: number): number {
    if (text.length <= 0) {
        return 0;
    }

    return text.length * statOrbsDigitAdvance(scale) - statOrbsScale(scale);
}

/** The top row of a readout drawn vertically centred on cy. */
export function statOrbsNumberTop(cy: number, scale: number): number {
    return cy - ((ORB_DIGIT_H * statOrbsScale(scale)) >> 1);
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
