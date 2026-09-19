// lclite:hotkeys — the Hotkeys mod's pure core: key tables + the one decision
// function that turns a keydown into an action. Nothing here touches the client,
// so mods/hotkeys/tools/hotkeys_test.ts exercises the real logic headlessly.
//
// Design sources: OSRS's own default shortcut keys (F1 combat … F12 music, Esc =
// inventory / close interface, Space = continue, 1-5 = dialogue options) and
// RuneLite's Key Remapping plugin (WASD camera with "Press Enter to Chat", F-key
// remap standing down while a text input owns the keyboard). Divergences from OSRS
// are deliberate and listed in the mod README.

/** Sidebar slots, index = the tab number the server uses (`if_settab`, content
 *  `scripts/general/configs/tabs.constant`). `[id, label]`: the id is the
 *  localStorage suffix ('hotkeysKey' + id), the label is what the panel shows.
 *  Slot 7 is never set by this rev, so it has no id/label and gets no panel row. */
export const HOTKEYS_TABS: string[][] = [
    ['Combat', 'Combat'], ['Skills', 'Skills'], ['Quests', 'Quests'], ['Inventory', 'Inventory'],
    ['Worn', 'Worn equipment'], ['Prayer', 'Prayer'], ['Magic', 'Spellbook'],
    ['', ''], ['Friends', 'Friends'], ['Ignore', 'Ignore'], ['Logout', 'Logout'],
    ['Options', 'Game options'], ['Controls', 'Player controls'], ['Music', 'Music']
];

/** Every key the panel offers, in panel order. These strings are exactly what the
 *  panel writes to localStorage; 'None' means unbound. Mirrored by HK_KEYS in
 *  mods/control-panel/.../panel.js (a page script cannot import this file). */
export const HOTKEYS_KEY_CHOICES: string[] = [
    'None', 'Esc',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
    'Tab', 'Home', 'End', 'PgUp', 'PgDn',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=',
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'
];

/** The number-row keys a "Select an Option" dialogue claims, in option order. This
 *  rev's dialogues offer at most five (content `interface_chat/interfaces/multi2..5`),
 *  and the count doubles as the option-row ceiling in hotkeysOptionRows(). */
export const HOTKEYS_OPTION_KEYS: string[] = ['1', '2', '3', '4', '5'];

/** localStorage keys this mod reads — its OWN keys only (hard rule 5). */
export const HOTKEYS_KEYS = {
    on: 'hotkeys',
    fkeys: 'hotkeysFkeys',
    escClose: 'hotkeysEscClose',
    space: 'hotkeysSpace',
    numbers: 'hotkeysNumbers',
    wasd: 'hotkeysWasd',
    lock: 'hotkeysChatLock',
    tabPrefix: 'hotkeysKey',
    camUp: 'hotkeysKeyCamUp',
    camDown: 'hotkeysKeyCamDown',
    camLeft: 'hotkeysKeyCamLeft',
    camRight: 'hotkeysKeyCamRight'
};

/** The tab bindings' localStorage key for a tab slot ('' for an unnamed slot). */
export function hotkeysTabKey(index: number): string {
    const row = HOTKEYS_TABS[index];
    if (!row || !row[0]) {
        return '';
    }
    return HOTKEYS_KEYS.tabPrefix + row[0];
}

/** OSRS's own default bindings, per slot (`HOTKEYS_TABS` order): F1 combat …
 *  F12 music, Esc inventory. Slots OSRS fills with tabs this rev does not have
 *  (clan chat F7, account management — here the Logout tab takes F9 — emotes
 *  F11) stay free, and F12 is left free on purpose: the browser owns F11/F12
 *  (fullscreen, devtools) and a page cannot block them. */
export const HOTKEYS_TAB_DEFAULTS: string[] = [
    'F1', 'F2', 'F3', 'Esc', 'F4', 'F5', 'F6',
    'None', 'F8', 'None', 'F9', 'F10', 'None', 'None'
];

/** Default camera keys — RuneLite's WASD remap. */
export const HOTKEYS_CAM_DEFAULTS = { up: 'W', down: 'S', left: 'A', right: 'D' };

/** Component button types this mod has to tell apart (the engine's ButtonType,
 *  webclient/src/config/IfType.ts). Spelled out here so this core keeps importing
 *  nothing at all — hotkeys_test.ts asserts the two agree. */
export const HOTKEYS_BUTTON_OK = 1;
export const HOTKEYS_BUTTON_CONTINUE = 6;

/** One direct child of the open chat interface, as the client hands it over: only
 *  what the option/continue decision needs, so the policy stays testable headlessly. */
export type HotkeysRow = {
    /** the component id a click is sent for */
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    /** the component's own text ('' when the component is not a button) */
    text: string;
    /** the component's buttonType (HOTKEYS_BUTTON_*; -1/0 = not a button) */
    button: number;
};

/** The open dialogue's "Click here to continue" button, or null.
 *
 *  The client stops offering this row once the click is in flight (`resumedPauseButton`
 *  — the button then reads "Please wait..."), and the caller checks that flag before
 *  asking, so one keypress is one page. A dialogue with options has no continue button;
 *  Space is then a no-op, as it is in OSRS. */
export function hotkeysContinueRow(rows: HotkeysRow[]): HotkeysRow | null {
    for (let i: number = 0; i < rows.length; i++) {
        if (rows[i].button === HOTKEYS_BUTTON_CONTINUE && rows[i].text !== '') {
            return rows[i];
        }
    }
    return null;
}

/** The open dialogue's numbered option list, top to bottom — [] when the open
 *  interface is not one.
 *
 *  A numbered list is ONE COLUMN of plain buttons: 2..5 of them, each on its own line
 *  (distinct y, boxes that do not overlap the row above), all sharing a left edge. The
 *  shape is the test, not an interface id, because the interfaces that merely look
 *  similar in this rev are exactly the ones a number key must keep its hands off: the
 *  smithing/crafting menus (skill_multi*) stack four buttons on ONE line per item and
 *  put the items side by side, and the item-select menus (multiobj*) are a row of
 *  equal-y cells. Both are refused by the per-line rule. */
export function hotkeysOptionRows(rows: HotkeysRow[]): HotkeysRow[] {
    const list: HotkeysRow[] = [];

    for (let i: number = 0; i < rows.length; i++) {
        if (rows[i].button === HOTKEYS_BUTTON_OK && rows[i].text !== '') {
            list.push(rows[i]);
        }
    }

    if (list.length < 2 || list.length > HOTKEYS_OPTION_KEYS.length) {
        return [];
    }

    list.sort((a: HotkeysRow, b: HotkeysRow) => a.y - b.y || a.x - b.x);

    for (let i: number = 1; i < list.length; i++) {
        const prev: HotkeysRow = list[i - 1];
        if (list[i].x !== prev.x || list[i].y < prev.y + prev.height) {
            return [];      // a grid or a stack of overlays, not a numbered list
        }
    }

    return list;
}

/** Build the settings object from a key/value getter (localStorage in the client,
 *  a plain object in the harness). Defaults live here, so the panel and the
 *  engine can never disagree about what "unset" means. */
export function hotkeysReadSettings(get: (key: string, def: string) => string): HotkeysSettings {
    const tabs: string[] = [];
    for (let i: number = 0; i < HOTKEYS_TABS.length; i++) {
        const key = hotkeysTabKey(i);
        tabs[i] = key ? get(key, HOTKEYS_TAB_DEFAULTS[i] ?? 'None') : 'None';
    }
    return {
        on: get(HOTKEYS_KEYS.on, 'true') === 'true',
        fkeys: get(HOTKEYS_KEYS.fkeys, 'true') === 'true',
        escClose: get(HOTKEYS_KEYS.escClose, 'true') === 'true',
        space: get(HOTKEYS_KEYS.space, 'true') === 'true',
        numbers: get(HOTKEYS_KEYS.numbers, 'true') === 'true',
        wasd: get(HOTKEYS_KEYS.wasd, 'false') === 'true',
        lock: get(HOTKEYS_KEYS.lock, 'true') === 'true',
        tabs,
        camUp: get(HOTKEYS_KEYS.camUp, HOTKEYS_CAM_DEFAULTS.up),
        camDown: get(HOTKEYS_KEYS.camDown, HOTKEYS_CAM_DEFAULTS.down),
        camLeft: get(HOTKEYS_KEYS.camLeft, HOTKEYS_CAM_DEFAULTS.left),
        camRight: get(HOTKEYS_KEYS.camRight, HOTKEYS_CAM_DEFAULTS.right)
    };
}

export type HotkeysSettings = {
    on: boolean;
    fkeys: boolean;
    escClose: boolean;
    /** Space advances the open dialogue (the continue button's own click) */
    space: boolean;
    /** the number row picks an option in the open dialogue */
    numbers: boolean;
    wasd: boolean;
    lock: boolean;
    /** 14 bindings, index = tab slot (HOTKEYS_TABS). */
    tabs: string[];
    camUp: string;
    camDown: string;
    camLeft: string;
    camRight: string;
};

export type HotkeysContext = {
    /** normalised key name — see hotkeysKeyName() */
    key: string;
    /** the engine would put this key's character into the chatbox (e.key.length === 1) */
    printable: boolean;
    /** Ctrl/Alt/Meta held: never claim (browser shortcuts, copy/paste, the alt-drag layer) */
    modified: boolean;
    settings: HotkeysSettings;
    /** the mod's chat-lock state: true = the chatbox is open for typing */
    typing: boolean;
    /** current length of the chat input line */
    chatLen: number;
    /** a main/side/chat interface is open (Esc has something to close) */
    modalOpen: boolean;
    /** an input dialogue / social / report-abuse box owns the keyboard */
    textInputOpen: boolean;
    /** the player is logged in (the login screen's fields must keep their keys) */
    inGame: boolean;
    /** the open main modal is the character-design screen (Esc must not close it) */
    designScreen: boolean;
    /** the open dialogue still has something to advance — its own continue button, or
     *  the tutorial's "Click to continue" line */
    dialogueContinue: boolean;
    /** how many numbered options the open dialogue offers (0 = not a numbered list) */
    dialogueOptions: number;
};

export const HOTKEYS_PASS = 0;
/** swallow the key, do nothing (the chatbox is locked) */
export const HOTKEYS_CLAIM = 1;
/** swallow + switch the sidebar tab in `tab` */
export const HOTKEYS_TAB = 2;
/** swallow + close the open interface (the client's own close-modal path) */
export const HOTKEYS_CLOSE = 3;
/** swallow + discard the half-typed chat line */
export const HOTKEYS_CLEAR_CHAT = 4;
/** swallow + drive a camera direction in `dir` (1 left, 2 right, 3 up, 4 down) */
export const HOTKEYS_CAMERA = 5;
/** swallow + advance the open dialogue (the same click its continue button sends) */
export const HOTKEYS_CONTINUE = 6;
/** swallow + choose option `option` of the open dialogue (1-based) */
export const HOTKEYS_OPTION = 7;

export type HotkeysResult = {
    action: number;
    tab: number;
    dir: number;
    /** which dialogue option this key chooses (1-based; 0 = none) */
    option: number;
    /** the lock state after this key */
    typing: boolean;
};

/** 'Escape' → 'Esc' etc., so localStorage holds short, readable bindings. Letters
 *  upper-case so a binding survives Shift. Everything else keeps its DOM name
 *  ('F1', 'Tab', 'Home', 'PgUp', 'Enter', 'Backspace', '-'). */
export function hotkeysKeyName(key: string): string {
    if (key === 'Escape') {
        return 'Esc';
    }
    if (key === 'PageUp') {
        return 'PgUp';
    }
    if (key === 'PageDown') {
        return 'PgDn';
    }
    if (key.length === 1) {
        return key.toUpperCase();
    }
    return key;
}

function bound(key: string): boolean {
    return key !== '' && key !== 'None';
}

/**
 * The whole mod's behaviour, in one pure function.
 *
 * Order matters: a locked chatbox swallows characters, Esc empties the chat line
 * before it closes anything, the open dialogue's own keys (Space, the number row) beat
 * both the chat lock and the tab bindings, tab keys yield to an active chat line when
 * the bound key would otherwise type, and the camera only ever gets keys the chatbox
 * isn't using.
 */
export function hotkeysDecide(c: HotkeysContext): HotkeysResult {
    const s = c.settings;
    const out: HotkeysResult = { action: HOTKEYS_PASS, tab: -1, dir: 0, option: 0, typing: c.typing };

    // mod off ⇒ forget the lock state so re-enabling starts locked; modified keys,
    // modal text inputs and the login screen are never ours
    if (!s.on) {
        out.typing = false;
        return out;
    }
    if (c.modified || c.textInputOpen || !c.inGame) {
        return out;
    }

    const locked = s.lock && s.wasd; // "Press Enter to Chat..." is live
    const typing = locked ? c.typing : c.chatLen > 0; // are keys going into the chatbox?
    out.typing = locked ? c.typing : false;

    // 1. a locked chatbox opens on Enter / ':' (RuneLite also unlocks on '/', but
    //    LCLite's own panel shortcut owns that key)
    if (locked && !c.typing && (c.key === 'Enter' || c.key === ':')) {
        out.typing = true;
        return out;
    }

    // 2. typing: Enter sends (and re-locks), Esc leaves the mode, a backspace that
    //    empties the line re-locks
    if (locked && c.typing) {
        if (c.key === 'Enter') {
            out.typing = false;
            return out;
        }
        if (c.key === 'Esc') {
            out.action = HOTKEYS_CLEAR_CHAT; // leave typing mode and drop what was typed
            out.typing = false;
            return out;
        }
        if (c.key === 'Backspace' && c.chatLen <= 1) {
            out.typing = false;
            return out;
        }
    }

    // 3. Esc: discard the half-typed line, else close the open interface, else a
    //    bound tab (Esc is the default Inventory key, as in OSRS). The character
    //    design screen is exempt: it has no close button, and the tutorial cannot
    //    continue without it.
    if (c.key === 'Esc') {
        if (c.chatLen > 0) {
            out.action = HOTKEYS_CLEAR_CHAT;
            out.typing = false;
            return out;
        }
        if (s.escClose && c.modalOpen && !c.designScreen) {
            out.action = HOTKEYS_CLOSE;
            return out;
        }
    }

    // 4. the open dialogue's own keys: Space advances it, the number row picks an
    //    option. Both are printable, so they stand down while a chat line is live — and
    //    they are checked BEFORE the tab keys, so a digit bound to a sidebar tab still
    //    picks the option while a dialogue is up, and opens the tab once it is gone.
    if (!typing) {
        if (s.space && c.key === ' ' && c.dialogueContinue) {
            out.action = HOTKEYS_CONTINUE;
            return out;
        }

        if (s.numbers && c.dialogueOptions > 0) {
            const option: number = HOTKEYS_OPTION_KEYS.indexOf(c.key);
            if (option !== -1 && option < c.dialogueOptions) {
                out.action = HOTKEYS_OPTION;
                out.option = option + 1;
                return out;
            }
        }
    }

    // 5. sidebar tab keys — a printable binding stands down while the chat line is live
    if (s.fkeys) {
        const tab = s.tabs.indexOf(c.key);
        if (tab !== -1 && (!c.printable || !typing)) {
            out.action = HOTKEYS_TAB;
            out.tab = tab;
            return out;
        }
    }

    // 6. camera keys (WASD by default). A bound camera key beats the chat lock —
    //    that is the whole point of the lock, so it is checked before the swallow.
    if (s.wasd && !typing) {
        if (bound(s.camUp) && c.key === s.camUp) {
            out.action = HOTKEYS_CAMERA;
            out.dir = 3;
            return out;
        }
        if (bound(s.camDown) && c.key === s.camDown) {
            out.action = HOTKEYS_CAMERA;
            out.dir = 4;
            return out;
        }
        if (bound(s.camLeft) && c.key === s.camLeft) {
            out.action = HOTKEYS_CAMERA;
            out.dir = 1;
            return out;
        }
        if (bound(s.camRight) && c.key === s.camRight) {
            out.action = HOTKEYS_CAMERA;
            out.dir = 2;
            return out;
        }
    }

    // 7. nothing bound claimed it: a locked chatbox swallows every other printable
    //    key (that is what "locked" means — no half-typed letters in the background)
    if (locked && !c.typing && c.printable) {
        out.action = HOTKEYS_CLAIM;
        return out;
    }

    return out;
}

/** Cheap per-frame read for the chatbox prompt: is "Press Enter to Chat..." live?
 *  Reads only the three keys the prompt depends on (the draw hook runs every frame). */
export function hotkeysLocked(get: (key: string, def: string) => string, typing: boolean): boolean {
    if (typing) {
        return false;
    }
    return get(HOTKEYS_KEYS.on, 'true') === 'true' && get(HOTKEYS_KEYS.wasd, 'false') === 'true' && get(HOTKEYS_KEYS.lock, 'true') === 'true';
}

/** The release side of a held camera key: the camera direction a key drives
 *  (1 left, 2 right, 3 up, 4 down; 0 = none). */
export function hotkeysCameraDir(key: string, s: HotkeysSettings): number {
    if (!s.on || !s.wasd) {
        return 0;
    }
    if (bound(s.camUp) && key === s.camUp) {
        return 3;
    }
    if (bound(s.camDown) && key === s.camDown) {
        return 4;
    }
    if (bound(s.camLeft) && key === s.camLeft) {
        return 1;
    }
    if (bound(s.camRight) && key === s.camRight) {
        return 2;
    }
    return 0;
}
