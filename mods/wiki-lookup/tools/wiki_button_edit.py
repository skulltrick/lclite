#!/usr/bin/env python3
"""lclite wiki-lookup: rewrite the mod's Client.ts hooks in place (idempotent by region).

Region-based, not exact-text based: each region is stripped from a known anchor to the
next known anchor and re-inserted, so a re-run is a no-op even after the block text was
edited between runs (the exact-text trap that duplicates methods). CRLF is preserved.
"""
import os
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("LCLITE_ROOT") or os.path.expandvars(r"%LOCALAPPDATA%/LCLite/installs/289")
PATH = ROOT.replace("\\", "/").rstrip("/") + "/webclient/src/client/Client.ts"

IMPORT_OLD = """    WIKI_LOOKUP_ACTION, wikiLookupLabel, wikiLookupModifierHeld, wikiLookupOpen, wikiLookupPlan,
    wikiLookupRead, wikiLookupSettings, wikiLookupTarget, wikiLookupUrl
} from '#/client/WikiLookup.js'; // custom (lclite "wiki-lookup" mod): the menu row's target parse, the wiki url, the popup fallback
"""

IMPORT_NEW = """    WIKI_LOOKUP_ACTION, WIKI_LOOKUP_ORIGIN_X, WIKI_LOOKUP_ORIGIN_Y, wikiLookupArmedPlan,
    wikiLookupButtonBox, wikiLookupButtonHit, wikiLookupDrawButton, wikiLookupLabel,
    wikiLookupLookupLabel, wikiLookupModifierHeld, wikiLookupOpen, wikiLookupPlan, wikiLookupRead,
    wikiLookupSettings, wikiLookupTarget, wikiLookupUrl
} from '#/client/WikiLookup.js'; // custom (lclite "wiki-lookup" mod): the target parse, the wiki url, the minimap button's geometry + pixels, the popup fallback
"""

BLOCK = '''    // lclite:wiki-lookup
    /// custom (lclite "wiki-lookup" mod): OSRS/RuneLite wiki lookup, in the two shapes
    /// RuneLite ships it. The MINIMAP BUTTON is the default way in: click the orb on the
    /// minimap panel (bottom-left, where OSRS and RuneLite put the wiki orb), then click
    /// any npc, object or item — world, inventory, worn, bank or shop — and its wiki page
    /// opens. While the button is armed the menu's TOP row reads "Lookup <target>", the
    /// same verb the engine builds for its own use-X-on-Y modes, so the click that runs it
    /// opens the page instead of attacking/chopping/wielding. Walking stays available: a
    /// top row with no entity name in it is left exactly as the engine built it.
    ///
    /// The classic "Wiki <target>" right-click ROW is the opt-in (default OFF, see the
    /// panel): it goes in slot 1, the bottom row directly above 'Cancel'. The TOP row is
    /// the left-click default, so a row landing there would replace the player's
    /// attack/chop/wield — RuneLite's classic wiki option is likewise never the default
    /// click. The row is stamped with WIKI_LOOKUP_ACTION (1234: not a MiniMenuAction
    /// value, and >1000 so the menu sort at the end of buildMinimenu() cannot move it —
    /// that sort only walks >1000 entries downward, and both of our neighbours fail its
    /// conditions, so the slot is stable).
    ///
    /// The name always comes off the menu the ENGINE just built (the option text the
    /// player can see), never re-resolved from the cache, so every source of an entity
    /// option is covered at once.
    ///
    /// Settings are this mod's OWN keys, read per frame at these hooks (rule 5):
    ///   wikiLookup          on/off master (default on)
    ///   wikiLookupButton    minimap wiki button (default on)
    ///   wikiLookupMenu      'off' (default) | 'always' | 'shift' | 'ctrl' | 'alt'
    ///   wikiLookupStyle     'page' (default) | 'search'
    /// The parse, the target extraction, the URL and the button's geometry/pixels live in
    /// the mod's files/ payload (WikiLookup.ts), so
    /// mods/wiki-lookup/tools/wiki_lookup_test.ts exercises the real shipped logic
    /// headlessly — the button's pixels included.
    private wikiLookupMenu(): void {
        if (this.wikiLookupArmedOn) {
            return;     // armed: wikiLookupArmedRow() owns the top slot instead
        }

        const settings = wikiLookupSettings(wikiLookupRead);
        const target = wikiLookupPlan(this.menuOption, this.menuNumEntries, settings, wikiLookupModifierHeld(settings.menu));

        if (!target) {
            return;
        }

        for (let i: number = this.menuNumEntries; i > 1; i--) {
            this.menuOption[i] = this.menuOption[i - 1];
            this.menuAction[i] = this.menuAction[i - 1];
            this.menuParamA[i] = this.menuParamA[i - 1];
            this.menuParamB[i] = this.menuParamB[i - 1];
            this.menuParamC[i] = this.menuParamC[i - 1];
        }

        this.menuOption[1] = wikiLookupLabel(target);
        this.menuAction[1] = WIKI_LOOKUP_ACTION;
        this.menuParamA[1] = 0;
        this.menuParamB[1] = 0;
        this.menuParamC[1] = 0;
        this.menuNumEntries++;
    }

    /// custom (lclite "wiki-lookup" mod): is this menu slot ours? Every menu click ends up
    /// here (mouseLoop's default-click dispatch, the open-menu row click, and the touch
    /// paths all call doAction), so one check covers every way a row can be chosen: the
    /// classic menu row, and the armed "Lookup <target>" row the button writes over the
    /// top slot. The page name comes off the row's own text — the same string the parse
    /// built it from — so the row and the lookup cannot disagree. A lookup also disarms
    /// the button: RuneLite's wiki icon deselects on use (one click, one page).
    private wikiLookupDispatch(optionId: number): boolean {
        if (this.menuAction[optionId] !== WIKI_LOOKUP_ACTION) {
            return false;
        }

        const settings = wikiLookupSettings(wikiLookupRead);
        const target = wikiLookupTarget(this.menuOption[optionId]);

        if (target) {
            wikiLookupOpen(wikiLookupUrl(target.name, settings.style), target.name);
            this.wikiLookupArmedOn = false;
        }

        return true;
    }

    /// custom: the wiki button's own state. ARMED = the lookup mode is live: the button
    /// is drawn highlighted and pulsing, and the next entity click opens a wiki page.
    /// Only the button's own click and a completed lookup change it.
    private wikiLookupArmedOn: boolean = false;
    /// custom: the alt-drag surface is registered once, on the first frame the button is
    /// drawn (the panel owns the drag layer; we only expose our live box to it).
    private wikiLookupApiBound: boolean = false;
    /// custom: what the widget buffer currently holds of ours (box + on/off). A change
    /// means abandoned pixels, which the mapback re-plot wipes.
    private wikiLookupSig: string = '';

    /// custom: the button's live box, in the minimap widget's own 172x156 space, from the
    /// placement keys the panel's drag layer writes (alt+drag; the owner reads its own
    /// keys — rule 5). No keys stored = the default spot, bottom-left.
    private wikiLookupBox(): number[] {
        return wikiLookupButtonBox(
            localStorage.getItem('lcmWikiLookupAnchor') || '',
            localStorage.getItem('lcmWikiLookupOffset') || ''
        );
    }

    /// custom: is the canvas point (this.mouseX/mouseY space) on the button?
    private wikiLookupOver(mx: number, my: number, box: number[]): boolean {
        return wikiLookupButtonHit(mx - WIKI_LOOKUP_ORIGIN_X, my - WIKI_LOOKUP_ORIGIN_Y, box);
    }

    /// custom: the button's click hook. It runs BEFORE the engine's own click loops (it is
    /// the first thing inside mainloop's checkClickInput block) and CONSUMES its click, so
    /// a click on the button can never also walk the minimap or run a menu action.
    private wikiLookupLoop(): void {
        if (!this.localPlayer) {
            this.wikiLookupArmedOn = false;     // logged out / logging in: never stay armed
            return;
        }

        if (this.mouseClickButton !== 1) {
            return;
        }

        const settings = wikiLookupSettings(wikiLookupRead);
        if (!settings.enabled || !settings.button) {
            this.wikiLookupArmedOn = false;
            return;
        }

        if (!this.wikiLookupOver(this.mouseClickX, this.mouseClickY, this.wikiLookupBox())) {
            return;
        }

        this.wikiLookupArmedOn = !this.wikiLookupArmedOn;
        this.mouseClickButton = 0;              // the button owns this click
    }

    /// custom: the armed row. Runs AFTER buildMinimenu's own sort — that is why it is a
    /// second hook site — because the sort moves every >1000 row toward 'Cancel', so an
    /// armed row written before it would sink out of the top slot and could never be the
    /// left-click default. Nothing runs after this, so the row the player clicks, and the
    /// index doAction receives, are the armed one.
    private wikiLookupArmedRow(): void {
        if (!this.wikiLookupArmedOn) {
            return;
        }

        const settings = wikiLookupSettings(wikiLookupRead);
        const target = wikiLookupArmedPlan(this.menuOption, this.menuNumEntries, settings, this.wikiLookupArmedOn);

        if (!target) {
            return;     // nothing to look up under the cursor: leave the engine's menu alone
        }

        const top: number = this.menuNumEntries - 1;
        this.menuOption[top] = wikiLookupLookupLabel(target);
        this.menuAction[top] = WIKI_LOOKUP_ACTION;
        this.menuParamA[top] = 0;
        this.menuParamB[top] = 0;
        this.menuParamC[top] = 0;
    }

    /// custom: our pixels live in the minimap WIDGET's own buffer — the one
    /// gameDraw() composites onto the canvas at (550,4) with areaMap.draw() — so this
    /// binds that buffer, paints, and hands the frame's own target back exactly as it
    /// was. It runs just after the composite (a frame's worth of latency, ~16ms, on the
    /// button's own appearance), which also means the wipe below can never cost another
    /// mod a frame: minimapDraw redraws the map, the compass and the orbs before the
    /// NEXT composite.
    private wikiLookupDraw(): void {
        const W: any = window as any;
        const settings = wikiLookupSettings(wikiLookupRead);
        const box: number[] = this.wikiLookupBox();
        const on: boolean = settings.enabled && settings.button;

        if (!on) {
            this.wikiLookupArmedOn = false;     // switched off mid-session: never stay armed
        }

        // the panel's stone is painted once at boot and only partly redrawn per frame, so
        // pixels we abandon — a moved button, a switched-off button — would stay on it.
        // Re-plotting the mapback restores the stone; its map window and compass are
        // transparent holes, so neither is disturbed.
        const sig: string = box.join(',') + ',' + (on ? '1' : '0');
        const wipe: boolean = sig !== this.wikiLookupSig && this.wikiLookupSig !== '';
        this.wikiLookupSig = sig;

        const prevPixels: Int32Array = Pix2D.pixels;
        const prevW: number = Pix2D.width;
        const prevH: number = Pix2D.height;
        this.areaMap?.setPixels();

        if (wipe) {
            this.mapback?.plotSprite(0, 0);
        }

        if (on) {
            const hover: boolean = this.wikiLookupOver(this.mouseX, this.mouseY, box);
            wikiLookupDrawButton(Pix2D.pixels, Pix2D.width, Pix2D.height, box[0], box[1], box[2], this.wikiLookupArmedOn, hover, Client.loopCycle);
        }

        Pix2D.setPixels(prevPixels, prevW, prevH);

        // placement bridge for the panel's drag layer (positional arrays only — object
        // literals arrive key-mangled across the bundle boundary). Bound once; the box
        // stays live and reports null while the button is off, so alt+drag cannot grab an
        // invisible surface. Region = the minimap widget (areaMap at 550,4), which is the
        // hard boundary the drag clamps into.
        if (!this.wikiLookupApiBound && W['lcmAnchor']) {
            this.wikiLookupApiBound = true;
            W['lcmWikiLookupBounds'] = (): number[] | null => {
                const s = wikiLookupSettings(wikiLookupRead);
                return s.enabled && s.button ? this.wikiLookupBox() : null;
            };
            W['lcmAnchor']['registerCanvas']?.(['wiki-lookup', 'lcmWikiLookupAnchor', 'lcmWikiLookupOffset', 'BL', '2,-24', () => (W['lcmWikiLookupBounds'] ? W['lcmWikiLookupBounds']() : null), [550, 4, 172, 156, 172, 156]]);
        }
    }
    // lclite:wiki-lookup
'''

ARMED_TAIL = '''                    sorted = false;
                }
            }
        }

        // lclite:wiki-lookup
        /// custom (lclite "wiki-lookup" mod): the armed lookup row, written over the
        /// menu's top slot AFTER the sort above (see wikiLookupArmedRow).
        this.wikiLookupArmedRow();
        // lclite:wiki-lookup
    }
'''

DRAW_SITE = '''        if (this.sceneState === 2) {
            this.minimapDraw();
            this.areaMap?.draw(550, 4);

            // lclite:wiki-lookup
            /// custom (lclite "wiki-lookup" mod): the minimap wiki button, drawn on top of
            /// the panel the line above just composited (see wikiLookupDraw).
            this.wikiLookupDraw();
            // lclite:wiki-lookup
        }
'''

CLICK_SITE = '''        if (checkClickInput) {
            // lclite:wiki-lookup
            /// custom (lclite "wiki-lookup" mod): the minimap button's click, consumed
            /// before the engine's own click loops run.
            this.wikiLookupLoop();
            // lclite:wiki-lookup

            this.mouseLoop();
'''


def once(text, needle, what):
    n = text.count(needle)
    if n != 1:
        print(f"ABORT: {what}: expected 1 match, found {n}")
        sys.exit(1)


raw = open(PATH, "rb").read().decode("utf-8")
assert "\r\n" in raw, "expected CRLF"
src = raw.replace("\r\n", "\n")
orig = src

# --- 1. the payload import list -------------------------------------------------
if "wikiLookupArmedPlan" in src:
    print("import list: already current")
else:
    once(src, IMPORT_OLD, "import list")
    src = src.replace(IMPORT_OLD, IMPORT_NEW, 1)
    print("import list: rewritten")

# --- 2. the parked methods/fields block (strip marker -> buildMinimenu, re-insert) ---
start = src.index("    // lclite:wiki-lookup\n    /// custom (lclite \"wiki-lookup\" mod): OSRS/RuneLite wiki lookup")
end = src.index("    // todo: order\n    private buildMinimenu(): void {")
stripped = src[start:end]
if stripped.count("    // lclite:wiki-lookup") != 2:
    print(f"ABORT: parked block has {stripped.count('    // lclite:wiki-lookup')} markers, expected 2")
    sys.exit(1)
if len(stripped.split("\n")) > 260:
    print(f"ABORT: parked block is {len(stripped.splitlines())} lines — refusing to strip")
    sys.exit(1)
src = src[:start] + BLOCK + "\n" + src[end:]
print(f"parked block: stripped {len(stripped.splitlines())} lines, inserted {len(BLOCK.splitlines())}")

# --- 3. buildMinimenu's tail: the armed row after the sort ----------------------
if "this.wikiLookupArmedRow();\n        // lclite:wiki-lookup\n    }" in src:
    print("armed row hook: already present")
else:
    tail_old = """                    sorted = false;
                }
            }
        }
    }
"""
    once(src, tail_old, "buildMinimenu tail")
    src = src.replace(tail_old, ARMED_TAIL, 1)
    print("armed row hook: inserted")

# --- 4. the draw call after the minimap widget composite ------------------------
if "this.wikiLookupDraw();" in src:
    print("draw hook: already present")
else:
    draw_old = """        if (this.sceneState === 2) {
            this.minimapDraw();
            this.areaMap?.draw(550, 4);
        }
"""
    once(src, draw_old, "areaMap composite")
    src = src.replace(draw_old, DRAW_SITE, 1)
    print("draw hook: inserted")

# --- 5. the button's click, before the engine's click loops ---------------------
if "this.wikiLookupLoop();" in src:
    print("click hook: already present")
else:
    click_old = """        if (checkClickInput) {
            this.mouseLoop();
"""
    once(src, click_old, "checkClickInput block")
    src = src.replace(click_old, CLICK_SITE, 1)
    print("click hook: inserted")

# --- write back, CRLF, only when changed ---------------------------------------
if src == orig:
    print("no change")
else:
    open(PATH, "wb").write(src.replace("\n", "\r\n").encode("utf-8"))
    print("written")

# --- assertions (call sites, not the names in prose) ----------------------------
raw_final = open(PATH, "rb").read().decode("utf-8")
if raw_final.count("\n") != raw_final.count("\r\n"):
    print("ABORT: line endings flattened")
    sys.exit(1)
final = raw_final.replace("\r\n", "\n")
checks = {
    "private wikiLookupMenu(): void {": 1,
    "this.wikiLookupMenu();": 1,
    "private wikiLookupDispatch(optionId: number): boolean {": 1,
    "if (this.wikiLookupDispatch(optionId)) {": 1,
    "private wikiLookupArmedRow(): void {": 1,
    "this.wikiLookupArmedRow();": 1,
    "private wikiLookupDraw(): void {": 1,
    "this.wikiLookupDraw();": 1,
    "private wikiLookupLoop(): void {": 1,
    "this.wikiLookupLoop();": 1,
    "private wikiLookupArmedOn: boolean = false;": 1,
    "wikiLookupArmedPlan(": 1,
    "wikiLookupDrawButton(": 1,
    "this.mapback?.plotSprite(0, 0);": 4,   # stat-orbs' boot wipe + its two, plus ours
}
bad = 0
for name, want in checks.items():
    got = final.count(name)
    if got != want:
        bad += 1
    print(f"  [{'ok ' if got == want else 'BAD'}] {name}: {got} (want {want})")
print("CRLF preserved:", raw_final.count("\r\n"), "lines:", len(final.splitlines()))
sys.exit(1 if bad else 0)