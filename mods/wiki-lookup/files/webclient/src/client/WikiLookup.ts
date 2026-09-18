// lclite:wiki-lookup — the Wiki lookup mod's pure core plus its page-side helpers.
// The parsing/URL/geometry/decision half is DOM-free and client-free, so
// mods/wiki-lookup/tools/wiki_lookup_test.ts runs the REAL shipped logic headlessly;
// only the modifier tracker and the blocked-popup card touch the page.
//
// Design source: RuneLite's Wiki plugin (runelite-client .../plugins/wiki/). Its
// classic form adds a `Wiki <target>` option to the right-click menu; its modern form
// is the minimap wiki button, which puts the client into a LOOKUP MODE: the icon lights
// up, the entity under the cursor gets `Lookup` as its left-click verb, and the click
// opens that entity's wiki page (one-shot — the icon deselects after the lookup).
// LCLite ships BOTH, the button as the default way in and the menu row as an opt-in:
//
//   * the minimap button (default ON) — click it, then click any npc, object or item
//     (world, inventory, worn, bank, shop). While armed the menu's TOP row reads
//     `Lookup <target>`; that row IS the left-click default, so the click opens the
//     page instead of attacking/chopping/wielding. Walking is untouched.
//   * the `Wiki <target>` right-click row (default OFF) — the classic RuneLite form,
//     for players who want a wiki option sitting in every valid right-click menu.
//
// Where the target comes from: the TOP entry of the menu the engine just built — the
// same entry a left click would run, i.e. RuneLite's own rule (it reads the top menu
// entry, not the entity under the cursor). Nothing here re-resolves the entity: the
// option string the player can SEE is the source of truth, exactly as mods/shift-drop
// matches the visible "Drop " label. The client tags the target name with a colour
// code, and the tag identifies the entity kind:
//     '@cya@' -> a loc (object)      'Chop down @cya@Tree'
//     '@yel@' -> an NPC              'Attack @yel@Goblin@yel@ (level-2)'
//     '@lre@' -> an item             'Wield @lre@Rune scimitar'
// Players, chat/friend options and 'Walk here' all use '@whi@', so they are excluded
// by construction — no player, no chat line, ever gets a wiki page.
//
// The wiki is the OSRS one on purpose: 2004Scape and OSRS share item, NPC and object
// *names* for the overwhelming majority of entities, so the OSRS page is the right page
// for almost everything a player will look up. Cache *ids* are not shared (OSRS
// renumbered everything after 2004), which is why this mod looks up by name and never
// sends an id.

/** The menu action id this mod stamps on its own entries (the menu row, and the armed
 *  `Lookup <target>` row the button writes over the top slot). It must be > 1000 so the
 *  engine's own menu sort (buildMinimenu's bubble pass moves >1000 entries toward
 *  'Cancel') leaves the menu row where it is put, and it must not collide with any
 *  MiniMenuAction value (the harness asserts that against the enum's own numbers). */
export const WIKI_LOOKUP_ACTION: number = 1234;

/** Oldschool RuneScape wiki, and the attribution RuneLite itself sends. */
export const WIKI_LOOKUP_ORIGIN: string = 'https://oldschool.runescape.wiki';
export const WIKI_LOOKUP_UTM: string = 'lclite';

/** Target colour tags and their entity kinds, as PARALLEL ARRAYS matched by index —
 *  the house rule for anything a runtime string could index (terser's property
 *  mangler renames object-literal KEYS, so a keyed table silently misses). */
export const WIKI_LOOKUP_TAGS: string[] = ['@cya@', '@yel@', '@lre@'];
export const WIKI_LOOKUP_KINDS: string[] = ['object', 'npc', 'item'];

/** This mod's OWN settings (rule 5). Read per frame at the mod's own hooks; the panel
 *  renders exactly these keys. */
export interface WikiLookupSettings {
    enabled: boolean;
    /** Draw the minimap wiki button. Default ON — it is the way in. */
    button: boolean;
    /** 'off' (default) | 'always' | 'shift' | 'ctrl' | 'alt' — whether the classic
     *  `Wiki <target>` right-click row exists, and when. OFF by default: the row is the
     *  opt-in, the button is the feature (OSRS/RuneLite players reach for the orb). */
    menu: string;
    /** 'page' = the exact page for the name (RuneLite classic); 'search' = the wiki's
     *  search results, which always land somewhere. */
    style: string;
}

export interface WikiLookupTarget {
    name: string;
    kind: string;
    tag: string;
}

/** The client's reader for this mod's OWN keys (one definition of the contract; the
 *  harness passes its own stub instead). */
export function wikiLookupRead(key: string): string | null {
    return localStorage.getItem(key);
}

/** Read and validate this mod's settings. The master and the button default ON ('false'
 *  is the only value that turns either off); the menu row defaults OFF and every value
 *  is clamped here, so a stale, hand-typed or half-written key can never produce a bad
 *  URL, a dead row or an invisible button. */
export function wikiLookupSettings(read: (key: string) => string | null): WikiLookupSettings {
    const style: string = read('wikiLookupStyle') === 'search' ? 'search' : 'page';

    const raw: string | null = read('wikiLookupMenu');
    let menu: string = 'off';
    if (raw === 'always' || raw === 'shift' || raw === 'ctrl' || raw === 'alt') {
        menu = raw;
    }

    return {
        enabled: read('wikiLookup') !== 'false',
        button: read('wikiLookupButton') !== 'false',
        menu,
        style
    };
}

/** Pull the wiki target out of a built menu option, or null when that option has no
 *  entity name in it (Walk here, Cancel, a player, a chat line, a plain button).
 *  Takes the text after the FIRST target colour tag, then drops the client's own
 *  extra tags and the ' (level-NN)' combat suffix it appends to NPC and player
 *  tooltips. */
export function wikiLookupTarget(option: string): WikiLookupTarget | null {
    if (!option) {
        return null;
    }

    let tagIndex: number = -1;
    let at: number = -1;
    for (let i: number = 0; i < WIKI_LOOKUP_TAGS.length; i++) {
        const found: number = option.indexOf(WIKI_LOOKUP_TAGS[i]);
        if (found !== -1 && (at === -1 || found < at)) {
            at = found;
            tagIndex = i;
        }
    }

    if (at === -1) {
        return null;
    }

    let name: string = option.substring(at + WIKI_LOOKUP_TAGS[tagIndex].length);
    name = name.replace(/@[a-z0-9]{3,6}@/g, '');      // the NPC combat-level colour, any leftover tag
    name = name.replace(/\s*\(level-\d+\)\s*$/, '');  // 'Goblin (level-2)' -> 'Goblin'
    name = name.trim();

    if (name.length === 0) {
        return null;
    }

    return { name, kind: WIKI_LOOKUP_KINDS[tagIndex], tag: WIKI_LOOKUP_TAGS[tagIndex] };
}

/** The menu row's own text: 'Wiki Goblin', with the target colour the engine used. The
 *  dispatch re-parses this very string, so the label and the lookup can never
 *  disagree. */
export function wikiLookupLabel(target: WikiLookupTarget): string {
    return 'Wiki ' + target.tag + target.name;
}

/** The ARMED row's text: 'Lookup Goblin' — RuneLite's target verb for the wiki icon,
 *  and the same string the engine builds for its own use-X-on-Y modes. Written over
 *  the menu's top slot, which is what a left click runs. */
export function wikiLookupLookupLabel(target: WikiLookupTarget): string {
    return 'Lookup ' + target.tag + target.name;
}

/** The page to open. Names are looked up as written (the wiki capitalises a lowercase
 *  first letter itself); the search form is the fallback for names 2004 and OSRS do
 *  not share. */
export function wikiLookupUrl(name: string, style: string): string {
    const clean: string = name.replace(/\s+/g, ' ').trim();

    if (style === 'search') {
        return WIKI_LOOKUP_ORIGIN + '/w/Special:Search?search=' + encodeURIComponent(clean) + '&utm_source=' + WIKI_LOOKUP_UTM;
    }

    return WIKI_LOOKUP_ORIGIN + '/w/' + encodeURIComponent(clean.replace(/ /g, '_')) + '?utm_source=' + WIKI_LOOKUP_UTM;
}

/** Where the CLASSIC row goes in the menu the engine just built: the row directly
 *  above 'Cancel' (index 1), never the top row. The top row IS the left-click
 *  default, so anything landing there would replace the player's attack/chop/wield —
 *  RuneLite's classic wiki option is likewise never the default click. One entry,
 *  derived from the top row's target, or null. */
export function wikiLookupPlan(options: string[], count: number, settings: WikiLookupSettings, modifierHeld: boolean): WikiLookupTarget | null {
    if (!settings.enabled || settings.menu === 'off') {
        return null;
    }

    if (settings.menu !== 'always' && !modifierHeld) {
        return null;
    }

    // index 0 is 'Cancel' and the arrays hold 500 slots: below 2 there is nothing to
    // look up, and the insertion shifts every slot up by one.
    if (count < 2 || count > 499) {
        return null;
    }

    return wikiLookupTarget(options[count - 1]);
}

/** The ARMED plan: which target the button's lookup mode puts on the menu's TOP row,
 *  or null when there is nothing to look up under the cursor (empty ground, a player,
 *  a chat line, a plain interface button) — the click then behaves exactly as it
 *  normally would, so walking and talking stay available while armed.
 *
 *  This is the one place that WRITES a top slot: the armed row replaces the engine's
 *  own top entry (it does not shift the arrays), and the client calls it AFTER
 *  buildMinimenu's sort — a >1000 row placed before that sort would be moved down
 *  toward 'Cancel' and could never be the left-click default. */
export function wikiLookupArmedPlan(options: string[], count: number, settings: WikiLookupSettings, armed: boolean): WikiLookupTarget | null {
    // the button is the only thing that can arm the mode, so a hidden button disarms it
    // here too — a player who switches the button off mid-session cannot be left with a
    // left click that opens wiki pages and no orb to click it off again.
    if (!settings.enabled || !settings.button || !armed) {
        return null;
    }

    if (count < 2) {
        return null;   // 'Cancel' alone is not a menu
    }

    return wikiLookupTarget(options[count - 1]);
}

// ---------------------------------------------------------------------------------
// the minimap wiki button: geometry, hit test, and the pixels themselves
// ---------------------------------------------------------------------------------

/** The button is drawn into the minimap WIDGET's own 172x156 space (the areaMap
 *  buffer, composited at canvas 550,4) — the same space, and the same ride, as
 *  mods/stat-orbs' data orbs. The panel's left stone strip is 25px wide and the
 *  compass owns y < 33, so the button is a 21px stone-rimmed orb tucked into the
 *  BOTTOM-LEFT of the panel: exactly where OSRS and RuneLite put the wiki orb, and
 *  clear of the map window itself. The size is ODD on purpose: r = size >> 1 = 10 puts
 *  the centre on a pixel and the disc then fills the box edge to edge (a 20px box with
 *  r=10 spilled one pixel past it, which the pixel test caught). */
export const WIKI_LOOKUP_BUTTON_SIZE: number = 21;
export const WIKI_LOOKUP_PANEL_W: number = 172;
export const WIKI_LOOKUP_PANEL_H: number = 156;
/** The widget's origin in the 765x503 canvas space (areaMap.draw(550, 4)). */
export const WIKI_LOOKUP_ORIGIN_X: number = 550;
export const WIKI_LOOKUP_ORIGIN_Y: number = 4;

/** The 9 anchor points, as PARALLEL ARRAYS matched by index: the panel's drag layer
 *  stores an anchor NAME in localStorage, and a runtime string must never index an
 *  object literal in bundled code (terser's property mangler renames the keys). */
export const WIKI_LOOKUP_ANCH_NAMES: string[] = ['TL', 'TC', 'TR', 'ML', 'MC', 'MR', 'BL', 'BC', 'BR'];
export const WIKI_LOOKUP_ANCH: number[][] = [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [0.5, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]];
/** Default placement: bottom-left, 2px in from the panel's left edge and 24px up from
 *  its bottom (so the orb is not flush against the panel's frame). */
export const WIKI_LOOKUP_ANCHOR_DEF: string = 'BL';
export const WIKI_LOOKUP_OFFSET_DEF: string = '2,-24';

/** The button's box [x, y, w, h] in the widget's own space, from the placement keys the
 *  panel's drag layer writes (alt+drag). Clamped FLUSH — the widget IS the boundary, so
 *  the button can never be dragged off the panel — and the panel clamps identically.
 *  No keys stored (the normal case) = the default spot above. */
export function wikiLookupButtonBox(anchor: string, offset: string): number[] {
    const size: number = WIKI_LOOKUP_BUTTON_SIZE;
    let ox: number = 2;
    let oy: number = WIKI_LOOKUP_PANEL_H - 24;

    const ai: number = WIKI_LOOKUP_ANCH_NAMES.indexOf(anchor);
    if (ai >= 0) {
        const k: number[] = WIKI_LOOKUP_ANCH[ai];
        const off: string[] = String(offset || '0,0').split(',');
        ox = Math.round(WIKI_LOOKUP_PANEL_W * k[0]) + (parseInt(off[0]) || 0);
        oy = Math.round(WIKI_LOOKUP_PANEL_H * k[1]) + (parseInt(off[1]) || 0);
    }

    ox = Math.max(0, Math.min(ox, WIKI_LOOKUP_PANEL_W - size));
    oy = Math.max(0, Math.min(oy, WIKI_LOOKUP_PANEL_H - size));
    return [ox, oy, size, size];
}

/** Is the point (in the widget's own space) on the button? Half-open on the far edge,
 *  so the box is exactly 20x20 clicks. */
export function wikiLookupButtonHit(mx: number, my: number, box: number[]): boolean {
    return mx >= box[0] && my >= box[1] && mx < box[0] + box[2] && my < box[1] + box[3];
}

/** The button's 7x7 mark (row-major, '1' = ink): the wiki's own 'W', the same glyph
 *  contract stat-orbs uses for its orbs. It fills the 7px glass disc exactly. */
export const WIKI_LOOKUP_GLYPH_W: string =
    '1001001' +
    '1001001' +
    '1001001' +
    '0101010' +
    '0101010' +
    '0010100' +
    '0010100';

/** Paint the button straight into a frame buffer.
 *
 *  PURE on purpose: it takes the pixel array, its stride/height and the ABSOLUTE canvas
 *  position, so the shipped logic is the code the harness exercises headlessly (the
 *  client passes Pix2D.pixels). Every pixel written is OPAQUE and every pixel outside
 *  the disc is left untouched — the panel's stone is painted once at boot and never
 *  re-cleared, so an alpha blend would accumulate. Hard 1px steps, no anti-aliasing, in
 *  the mapback's own palette (rim lit upper-left, shadowed lower-right) so the button
 *  reads as part of the 2004 interface.
 *
 *  armed = the lookup mode is live: the glass turns OSRS-blue and pulses (tick), so a
 *  player can always tell why their left click is opening wiki pages. hover = the mouse
 *  is over the button. */
export function wikiLookupDrawButton(px: Int32Array, stride: number, height: number, x: number, y: number, size: number, armed: boolean, hover: boolean, tick: number): void {
    const r: number = size >> 1;
    const rim: number = r >= 9 ? 2 : 1;              // stone frame thickness
    const innerR: number = r - 1 - rim;              // radius of the glass
    const cx: number = x + r;
    const cy: number = y + r;
    const rr: number = r * r;
    const rimIn: number = (r - 1) * (r - 1);
    const ir: number = innerR * innerR;
    const pulse: boolean = armed && tick % 16 < 8;

    const glass: number = armed ? (pulse ? 0x5a92d0 : 0x3f6d9e) : 0x161310;
    const glassEdge: number = armed ? (pulse ? 0x2f5a86 : 0x24405c) : 0x2b2721;
    const rimLit: number = armed ? 0xbcd2e6 : (hover ? 0x968b77 : 0x7d7466);
    const rimDark: number = armed ? 0x35506d : (hover ? 0x3d352b : 0x2a251f);

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

    // the 'W'. One pass, no outline: at 7px the strokes are 1px apart, so a 4-neighbour
    // outline fills the gaps between them and the mark reads as a blob (measured on the
    // ASCII render) — the dark glass is the contrast instead.
    if (innerR >= 7 && WIKI_LOOKUP_GLYPH_W.length === 49) {
        const ink: number = armed ? 0xffffff : 0xf7f3e8;
        const gx: number = cx - 3;
        const gy: number = cy - 3;

        for (let j: number = 0; j < 7; j++) {
            for (let i: number = 0; i < 7; i++) {
                if (WIKI_LOOKUP_GLYPH_W.charAt(j * 7 + i) === '1') {
                    wikiLookupPixel(px, stride, height, gx + i, gy + j, ink);
                }
            }
        }
    }
}

function wikiLookupPixel(px: Int32Array, stride: number, height: number, x: number, y: number, colour: number): void {
    if (x < 0 || y < 0 || x >= stride || y >= height) {
        return;
    }

    px[x + y * stride] = colour;
}

// ---------------------------------------------------------------------------------
// page side: modifier tracking + the blocked-popup card
// ---------------------------------------------------------------------------------

const WIKI_LOOKUP_HELD = { shift: false, ctrl: false, alt: false };

/** Track the modifier keys ourselves, from the PAGE, so the mod needs no engine key
 *  hook (GameShell's key handlers belong to mods/hotkeys). Key events reach the
 *  window from the canvas, so a capture-phase listener sees them first. */
function wikiLookupTrackModifiers(): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return;
    }

    const set = (e: KeyboardEvent, down: boolean): void => {
        if (e.key === 'Shift') {
            WIKI_LOOKUP_HELD.shift = down;
        } else if (e.key === 'Control') {
            WIKI_LOOKUP_HELD.ctrl = down;
        } else if (e.key === 'Alt') {
            WIKI_LOOKUP_HELD.alt = down;
        }
    };

    window.addEventListener('keydown', (e: KeyboardEvent) => set(e, true), true);
    window.addEventListener('keyup', (e: KeyboardEvent) => set(e, false), true);
    // a keyup while the page is unfocused is never delivered: forget the state rather
    // than keep a modifier stuck down
    window.addEventListener('blur', () => {
        WIKI_LOOKUP_HELD.shift = false;
        WIKI_LOOKUP_HELD.ctrl = false;
        WIKI_LOOKUP_HELD.alt = false;
    });
}

wikiLookupTrackModifiers();

/** Is the configured menu key down right now? 'always' and 'off' never depend on a
 *  key (the plan refuses 'off' before it gets here). */
export function wikiLookupModifierHeld(menu: string): boolean {
    if (menu === 'shift') {
        return WIKI_LOOKUP_HELD.shift;
    }
    if (menu === 'ctrl') {
        return WIKI_LOOKUP_HELD.ctrl;
    }
    if (menu === 'alt') {
        return WIKI_LOOKUP_HELD.alt;
    }
    return true;
}

/** Open the page. The click that selects our row is dispatched from the game loop, a
 *  few milliseconds after the DOM event, which is inside the browser's
 *  transient-activation window — so a new tab normally opens. If a stricter browser
 *  (or a popup blocker) refuses it, fall back to a card with a real link: the feature
 *  degrades to one extra click instead of doing nothing. */
export function wikiLookupOpen(url: string, name: string): boolean {
    let opened: Window | null = null;
    try {
        opened = window.open(url, '_blank');
    } catch {
        opened = null;
    }

    if (opened) {
        try {
            opened.opener = null;   // never hand the game page to the wiki tab
        } catch {
            // cross-origin: the assignment is refused, and that is fine
        }
        return true;
    }

    wikiLookupCard(url, name);
    return false;
}

const WIKI_LOOKUP_CARD_ID: string = 'lcwiki-card';
let wikiLookupCardTimer: number = 0;

/** The blocked-popup fallback. Lives in the viewport's top-left (the FAB owns the
 *  top-right), above the panel, and never touches the canvas. */
function wikiLookupCard(url: string, name: string): void {
    if (typeof document === 'undefined' || !document.body) {
        return;
    }

    let card: HTMLElement | null = document.getElementById(WIKI_LOOKUP_CARD_ID);
    if (!card) {
        card = document.createElement('div');
        card.id = WIKI_LOOKUP_CARD_ID;
        card.style.cssText = 'position:fixed;top:12px;left:12px;z-index:9400;max-width:320px;'
            + 'padding:8px 10px;background:#1c1a16;border:1px solid #4d4233;border-radius:3px;'
            + 'font:12px/1.4 sans-serif;color:#e8e0cc;box-shadow:0 2px 10px rgba(0,0,0,.5)';

        const title = document.createElement('div');
        title.style.cssText = 'display:flex;gap:8px;align-items:baseline;margin-bottom:4px';
        title.appendChild(wikiLookupText('Wiki lookup', 'font-weight:bold;color:#ffd166'));
        const close = document.createElement('span');
        close.textContent = '\u00d7';
        close.title = 'Dismiss';
        close.style.cssText = 'margin-left:auto;cursor:pointer;color:#9b9184;padding:0 2px';
        close.addEventListener('click', () => wikiLookupCardHide());
        title.appendChild(close);
        card.appendChild(title);

        const who = document.createElement('div');
        who.id = WIKI_LOOKUP_CARD_ID + '-name';
        who.style.cssText = 'margin-bottom:4px;color:#fff';
        card.appendChild(who);

        const note = document.createElement('div');
        note.textContent = 'Your browser blocked the new tab \u2014 open it here:';
        note.style.cssText = 'margin-bottom:4px;color:#9b9184';
        card.appendChild(note);

        const link = document.createElement('a');
        link.id = WIKI_LOOKUP_CARD_ID + '-link';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.cssText = 'color:#7fd1ff;word-break:break-all';
        card.appendChild(link);

        document.body.appendChild(card);
    }

    const who: HTMLElement | null = document.getElementById(WIKI_LOOKUP_CARD_ID + '-name');
    if (who) {
        who.textContent = name;
    }

    const link: HTMLAnchorElement | null = document.getElementById(WIKI_LOOKUP_CARD_ID + '-link') as HTMLAnchorElement | null;
    if (link) {
        link.href = url;
        link.textContent = url;
    }

    if (wikiLookupCardTimer) {
        window.clearTimeout(wikiLookupCardTimer);
    }
    wikiLookupCardTimer = window.setTimeout(() => wikiLookupCardHide(), 20000);
}

function wikiLookupCardHide(): void {
    const card: HTMLElement | null = document.getElementById(WIKI_LOOKUP_CARD_ID);
    if (card) {
        card.remove();
    }
}

function wikiLookupText(text: string, css: string): HTMLElement {
    const el = document.createElement('span');
    el.textContent = text;
    el.style.cssText = css;
    return el;
}