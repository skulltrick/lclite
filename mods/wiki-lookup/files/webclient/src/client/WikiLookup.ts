// lclite:wiki-lookup — the Wiki lookup mod's pure core plus its page-side helpers.
// The parsing/URL/decision half is DOM-free and client-free, so
// mods/wiki-lookup/tools/wiki_lookup_test.ts runs the REAL shipped logic headlessly;
// only the modifier tracker and the blocked-popup card touch the page.
//
// Design source: RuneLite's Wiki plugin (runelite-client .../plugins/wiki/). Its
// classic form adds a `Wiki <target>` option to the right-click menu; its modern form
// is the wiki-orb "Lookup" mode, which resolves a page through
// `Special:Lookup?type=&id=&name=&x=&y=&plane=` — an OSRS *id* lookup. This rev has no
// room for an orb widget, and its cache ids are the 2004 ones (OSRS renumbered
// everything), so an id-based lookup would land on the wrong page. LCLite therefore
// looks the page up BY NAME, which is what the classic plugin did and what actually
// holds between the two games: item, NPC and object names are the same words in
// 2004Scape and OSRS for the overwhelming majority of entities.
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

/** The menu action id this mod stamps on its own entry. It must be > 1000 so the
 *  engine's own menu sort (buildMinimenu's bubble pass moves >1000 entries toward the
 *  bottom) leaves the entry where it is put, and it must not collide with any
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

/** This mod's OWN settings (rule 5). Read per frame at the mod's own hook; the panel
 *  renders exactly these keys. */
export interface WikiLookupSettings {
    enabled: boolean;
    /** 'page' = the exact page for the name (RuneLite classic); 'search' = the wiki's
     *  search results, which always land somewhere. */
    style: string;
    /** 'none' | 'shift' | 'ctrl' | 'alt' — when set, the menu entry only exists while
     *  that key is held, so a player who wants a clean menu keeps one. */
    modifier: string;
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

/** Read and validate this mod's settings. The master defaults ON ('false' is the only
 *  value that disables); every other value is clamped here so a stale, hand-typed or
 *  half-written key can never produce a bad URL or a dead menu row. */
export function wikiLookupSettings(read: (key: string) => string | null): WikiLookupSettings {
    const style: string = read('wikiLookupStyle') === 'search' ? 'search' : 'page';

    const raw: string | null = read('wikiLookupModifier');
    let modifier: string = 'none';
    if (raw === 'shift' || raw === 'ctrl' || raw === 'alt') {
        modifier = raw;
    }

    return { enabled: read('wikiLookup') !== 'false', style, modifier };
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

/** The row's own text: 'Wiki Goblin', with the target colour the engine used. The
 *  dispatch re-parses this very string, so the label and the lookup can never
 *  disagree. */
export function wikiLookupLabel(target: WikiLookupTarget): string {
    return 'Wiki ' + target.tag + target.name;
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

/** Where this mod's entry goes in the menu the engine just built: the row directly
 *  above 'Cancel' (index 1), never the top row. The top row IS the left-click
 *  default, so anything landing there would replace the player's attack/chop/wield —
 *  RuneLite's wiki option is likewise never the default click. One entry, derived
 *  from the top row's target, or null. */
export function wikiLookupPlan(options: string[], count: number, settings: WikiLookupSettings, modifierHeld: boolean): WikiLookupTarget | null {
    if (!settings.enabled) {
        return null;
    }

    if (settings.modifier !== 'none' && !modifierHeld) {
        return null;
    }

    // index 0 is 'Cancel' and the arrays hold 500 slots: below 2 there is nothing to
    // look up, and the insertion shifts every slot up by one.
    if (count < 2 || count > 499) {
        return null;
    }

    return wikiLookupTarget(options[count - 1]);
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

/** Is the configured modifier down right now? 'none' means "always". */
export function wikiLookupModifierHeld(modifier: string): boolean {
    if (modifier === 'shift') {
        return WIKI_LOOKUP_HELD.shift;
    }
    if (modifier === 'ctrl') {
        return WIKI_LOOKUP_HELD.ctrl;
    }
    if (modifier === 'alt') {
        return WIKI_LOOKUP_HELD.alt;
    }
    return true;
}

/** Open the page. The click that selects our menu row is dispatched from the game
 *  loop, a few milliseconds after the DOM event, which is inside the browser's
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
