// lclite:ground-items
/// Ground item labels — RuneLite's "Ground Items" plugin, 2004 flavour.
///
/// This file is the mod's PURE half: settings parse, the high-alch value, the label
/// text, the shown/hidden list edits, the +/- box hit test and the Alt state. The
/// engine hooks are four hunks in Client.ts (one import, the fields+methods block, the
/// draw call at the end of entityOverlays(), the click consume at the top of
/// mouseLoop()), so a bun harness can import THIS file and test the real shipped logic
/// headlessly — see mods/ground-items/tools/ground_items_test.ts.
///
/// HIGH ALCH VALUE. The client has no GE prices (2004), so the only honest "price" is
/// what the server actually pays for the item. Lost City's own alchemy does
/// `max(scale(6, 10, oc_cost($item)), 1)` (content/scripts/skill_magic/scripts/spells/
/// alchemy.rs2) — 0.6 x the obj config's cost, minimum 1 — and the client's
/// `ObjType.cost` is the same number the server reads, so giHaValue() below is the
/// exact coin payout rather than an approximation of one.
///
/// The three constants that are RuneLite's own numbers (their GroundItemsOverlay):
/// MAX_DISTANCE 2500 local units, OFFSET_Z 20, STRING_GAP 15, RECTANGLE_SIZE 8. They
/// are kept identical so a label sits where a RuneLite player expects it.

/** RuneLite's own label cutoff: 2500 local units (128 units = one tile, so ~19.5 tiles).
 *  RuneLite draws labels for every item inside it — walls and roofs do not hide one. */
export const GI_MAX_DISTANCE: number = 2500;

/** World units above the tile the label floats at (RuneLite's OFFSET_Z). */
export const GI_OFFSET_Z: number = 20;

/** Pixels between two labels stacked on the same tile (RuneLite's STRING_GAP). */
export const GI_STRING_GAP: number = 15;

/** Side of the Alt-held +/- list boxes (RuneLite's RECTANGLE_SIZE). */
export const GI_BOX: number = 8;

/** Labels drawn for items sharing one tile, and the hard cap on boxes collected in a
 *  frame. RuneLite stacks every item on a tile; a cap keeps one absurd pile from
 *  eating the frame (and the hit-test array). */
export const GI_MAX_STACK: number = 5;
export const GI_MAX_BOXES: number = 1024;

/** Label classes, in the order giClassify() ranks them. */
export const GI_HIDDEN: number = 0;
export const GI_SHOWN: number = 1;
export const GI_LISTED: number = 2;

/** The high alch payout for an item, exactly as the server computes it. */
export const giHaValue = (cost: number): number => {
    const c: number = cost > 0 ? cost : 0;
    const v: number = ((c * 6) / 10) | 0;
    return v > 1 ? v : 1;
};

/** 250 -> "250", 12345 -> "12.3K", 1_500_000 -> "1.5M". RuneLite's QuantityFormatter
 *  shape, with the K/M switch at 10K/1M so a 1.5m stack reads as "1.5M" rather than
 *  their "1500K" (their own thresholds only reach M at 10m). */
export const giStackSize = (n: number): string => {
    if (n >= 1000000) {
        return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (n >= 10000) {
        return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return String(n);
};

/** '#rrggbb' -> 0xrrggbb, or `def` for anything malformed (a stale key cannot paint). */
export const giColour = (hex: string | null, def: number): number => {
    if (hex !== null && hex.length === 7 && hex.charCodeAt(0) === 35 /* # */) {
        const parsed: number = parseInt(hex.substring(1), 16);
        if (!isNaN(parsed)) {
            return parsed;
        }
    }
    return def;
};

/** Split a comma-separated name list, keeping the player's own capitalisation. */
export const giSplit = (csv: string | null): string[] => {
    const out: string[] = [];
    for (const part of (csv ?? '').split(',')) {
        const name: string = part.trim();
        if (name.length > 0) {
            out.push(name);
        }
    }
    return out;
};

/** Is `name` on this list? Case-insensitive, like RuneLite's ItemList. */
export const giListHas = (csv: string | null, name: string | null): boolean => {
    if (!name) {
        return false;
    }
    const want: string = name.toLowerCase();
    for (const entry of giSplit(csv)) {
        if (entry.toLowerCase() === want) {
            return true;
        }
    }
    return false;
};

/** Add `name` to (or drop it from) a list, returning the new CSV. Matching is
 *  case-insensitive (so an entry can never be duplicated by casing) and the name is
 *  stored exactly as it was passed — which, from the game, is the obj config's own
 *  name, so the panel's text row reads the way the game spells it. */
export const giListEdit = (csv: string | null, name: string | null, add: boolean): string => {
    const key: string = (name ?? '').trim();
    if (key.length === 0) {
        return csv ?? '';
    }
    const want: string = key.toLowerCase();
    const out: string[] = giSplit(csv).filter(entry => entry.toLowerCase() !== want);
    if (add) {
        out.push(key);
    }
    return out.join(', ');
};

/** Which of the three label classes this item is in:
 *   GI_HIDDEN — on the hidden list: no label unless Alt is held.
 *   GI_LISTED — on the shown list: labelled in the highlight colour.
 *   GI_SHOWN  — above the value threshold, or the threshold is off (0 = label every
 *               item that is not hidden). */
export const giClassify = (name: string | null, ha: number, shownCsv: string | null, hiddenCsv: string | null, minValue: number): number => {
    if (giListHas(hiddenCsv, name)) {
        return GI_HIDDEN;
    }
    if (giListHas(shownCsv, name)) {
        return GI_LISTED;
    }
    if (minValue <= 0 || ha > minValue) {
        return GI_SHOWN;
    }
    return GI_HIDDEN;
};

/** The label itself: RuneLite's own shape — name, stack size, then the value. */
export const giLabel = (name: string, count: number, ha: number, showValue: boolean): string => {
    let out: string = name;
    if (count > 1) {
        out += ' (' + giStackSize(count) + ')';
    }
    if (showValue && ha > 1) {
        out += ' (' + giStackSize(ha) + ' gp)';
    }
    return out;
};

/** Within RuneLite's label distance of the player? (deltas in local units) */
export const giDistanceOk = (dx: number, dz: number): boolean => dx * dx + dz * dz <= GI_MAX_DISTANCE * GI_MAX_DISTANCE;

/** Topmost box under the cursor, or -1. Later boxes win: they were drawn last, so they
 *  are the ones the player can see. */
export const giHit = (xs: Int32Array, ys: Int32Array, ws: Int32Array, hs: Int32Array, count: number, x: number, y: number): number => {
    for (let i: number = count - 1; i >= 0; i--) {
        if (x >= xs[i] && x < xs[i] + ws[i] && y >= ys[i] && y < ys[i] + hs[i]) {
            return i;
        }
    }
    return -1;
};

/** This mod's own localStorage keys, read per frame at the mod's own hook (hard rule 5).
 *  `read` is a function so the harness can drive it without a DOM. */
export const giSettings = (read: (key: string) => string | null) => {
    let minValue: number = parseInt(read('groundItemsValue') ?? '0', 10);
    if (!(minValue >= 0)) {
        minValue = 0;
    } else if (minValue > 1000000) {
        minValue = 1000000;
    }

    return {
        on: read('groundItems') !== 'false',
        minValue,
        showValue: read('groundItemsShowValue') === 'true',
        shownCsv: read('groundItemsShown') ?? '',
        hiddenCsv: read('groundItemsHidden') ?? '',
        color: giColour(read('groundItemsColor'), 0xffffff),
        highlightColor: giColour(read('groundItemsHighlightColor'), 0xff9040),
        hiddenColor: giColour(read('groundItemsHiddenColor'), 0x808080)
    };
};

// ---- the Alt key ------------------------------------------------------------------
// Alt is the mod's modifier, and the engine never looks at it (GameShell has no altKey
// use), so the state is tracked here off the DOM — the same pattern wiki-lookup's menu
// modifier uses. Capture phase, so a handler that swallows the event downstream cannot
// hide it; `blur` clears it, because Alt+Tab never delivers the keyup.
let giAlt: boolean = false;
let giAltBound: boolean = false;

const giSetAlt = (down: boolean): void => {
    giAlt = down;
};

/** Install the Alt listeners once. Safe to call every frame. */
export const giTrackAlt = (): void => {
    if (giAltBound || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return;
    }
    giAltBound = true;

    const key = (e: KeyboardEvent, down: boolean): void => {
        if (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight') {
            giSetAlt(down);
        }
    };

    window.addEventListener('keydown', (e: KeyboardEvent) => key(e, true), true);
    window.addEventListener('keyup', (e: KeyboardEvent) => key(e, false), true);
    window.addEventListener('blur', () => giSetAlt(false));
};

/** Is Alt held right now? While it is, every item is labelled (hidden ones dimmed) and
 *  the +/- boxes appear — RuneLite's own "hold the hotkey to curate" mode. */
export const giAltHeld = (): boolean => giAlt;

/** Harness/test seam for the Alt state. */
export const giAltSet = (down: boolean): void => giSetAlt(down);
