#!/usr/bin/env python3
"""One-shot edit script for the lclite stat-orbs mod (spec orb + half-step numbers).

Edits webclient/src/client/Client.ts in an APPLIED tree:
  * the mod's import hunk (new core symbols)
  * the digit font moves to the core; the run orb's bolt glyph is fixed to 7x7
  * spec-orb fields, layout, draw, resolve, click + its own canvas surface
  * drawOrbNumber rasterizes through the core's glyph bitmaps (half-step scales)

CRLF-safe (the tree is CRLF; the patch JSONs are LF). Every edit is guarded by a
sentinel so a rerun is a no-op, and every anchor must match exactly once.
"""
import sys

TREE = sys.argv[1] if len(sys.argv) > 1 else r'C:/Users/canno/AppData/Local/LCLite/installs/289'
PATH = TREE + '/webclient/src/client/Client.ts'

raw = open(PATH, 'rb').read()
crlf = raw.count(b'\r\n')
lf = raw.count(b'\n')
src = raw.decode('utf-8')
assert lf == crlf, 'file is not uniformly CRLF: %d LF vs %d CRLF' % (lf, crlf)
src = src.replace('\r\n', '\n')

edits = []      # (name, sentinel, anchor, replacement)


def edit(name, sentinel, anchor, replacement):
    edits.append((name, sentinel, anchor, replacement))


# ---- 1. imports ------------------------------------------------------------------
edit('imports', 'statOrbsSpecWeapon', """import type { OrbBook, OrbBookCell, OrbRun } from '#/client/StatOrbs.js';
import {
    ORB_ORIGIN_X, ORB_ORIGIN_Y, ORB_PANEL_H, ORB_PANEL_W, ORB_RUN_CLIENTCODE,
    statOrbsBook, statOrbsBookBox, statOrbsBookCell, statOrbsBookHit, statOrbsDigitAdvance,
    statOrbsInBox, statOrbsNumberLeft, statOrbsNumberTop, statOrbsNumberWidth, statOrbsOrbHit,
    statOrbsOrbLeft, statOrbsRun, statOrbsScale, statOrbsSettings
} from '#/client/StatOrbs.js'; // custom (lclite "stat-orbs" mod): the settings parse, the prayer-book and run-button lookup, the quick-prayer panel's geometry
""", """import type { OrbBook, OrbBookCell, OrbRun, OrbSpec } from '#/client/StatOrbs.js';
import {
    ORB_ORIGIN_X, ORB_ORIGIN_Y, ORB_PANEL_H, ORB_PANEL_W, ORB_RUN_CLIENTCODE, ORB_SPEC_EXTRA,
    statOrbsBook, statOrbsBookBox, statOrbsBookCell, statOrbsBookHit, statOrbsDigitAdvance,
    statOrbsDigitGap, statOrbsGlyph, statOrbsGlyphH, statOrbsGlyphW, statOrbsInBox,
    statOrbsNumberLeft, statOrbsNumberTop, statOrbsNumberWidth, statOrbsOrbHit, statOrbsOrbLeft,
    statOrbsRun, statOrbsScale, statOrbsSettings, statOrbsSpec, statOrbsSpecBox,
    statOrbsSpecPercent, statOrbsSpecTextScale, statOrbsSpecWeapon
} from '#/client/StatOrbs.js'; // custom (lclite "stat-orbs" mod): the settings parse, the readout font, the prayer-book / run-button / special-attack lookup, the quick-prayer panel's and the spec orb's geometry
""")

# ---- 2. the bolt glyph -----------------------------------------------------------
edit('bolt glyph', "ORB_GLYPH_RUN: string = '0001100001100001100001111111000110000110000110000'", """    static readonly ORB_GLYPH_RUN: string = '0000110000110000110000011111000011000001100000110000';""",
     """    static readonly ORB_GLYPH_RUN: string = '0001100001100001100001111111000110000110000110000';""")

# ---- 2b. the orb marks move to the core, where the harness can check them ---------
edit('glyph imports', 'ORB_GLYPH_HP, ORB_GLYPH_PRAYER, ORB_GLYPH_RUN', """    ORB_ORIGIN_X, ORB_ORIGIN_Y, ORB_PANEL_H, ORB_PANEL_W, ORB_RUN_CLIENTCODE, ORB_SPEC_EXTRA,
    statOrbsBook, statOrbsBookBox, statOrbsBookCell, statOrbsBookHit, statOrbsDigitAdvance,""",
     """    ORB_GLYPH_HP, ORB_GLYPH_PRAYER, ORB_GLYPH_RUN, ORB_ORIGIN_X, ORB_ORIGIN_Y, ORB_PANEL_H,
    ORB_PANEL_W, ORB_RUN_CLIENTCODE, ORB_SPEC_EXTRA, statOrbsBook, statOrbsBookBox,
    statOrbsBookCell, statOrbsBookHit, statOrbsDigitAdvance, statOrbsGlyphOk,""")

edit('glyph statics', 'the orb marks live in the core', """    /// custom: 7x7 orb glyphs (row-major, '1' = ink) — heart, prayer star, and the run
    /// bolt. The run mark is a LIGHTNING BOLT, not the blob it used to be: 2004 has no
    /// run icon of its own to borrow (the options tab's run button is a plain button),
    /// so the orb carries the one mark that reads as "energy" at 7x7. lclite:stat-orbs
    static readonly ORB_GLYPH_HP: string = '0110110111111111111110111110001110000010000000000';
    static readonly ORB_GLYPH_PRAYER: string = '0001000000100001111101111111011111000010000001000';
    static readonly ORB_GLYPH_RUN: string = '0001100001100001100001111111000110000110000110000';
""", """    /// custom: the orb marks (heart, prayer star, the run orb's LIGHTNING BOLT) live in
    /// the mod's pure core with the digit font, so mods/stat-orbs/tools/stat_orbs_test.ts
    /// can check them: drawOrb refuses a mark that is not a complete 7x7, and the run orb
    /// shipped for a while with a 52-character bolt that the old length test silently
    /// dropped — an EMPTY orb, with nothing anywhere to say why. lclite:stat-orbs
""")

edit('glyph call sites', 'glyph: ORB_GLYPH_HP', """            { cy: cy0, rgb: hpRgb, frac: hpFrac, value: hpCur, textRgb: hpFrac > 0.66 ? Colour.GREEN : hpFrac > 0.33 ? Colour.YELLOW : Colour.RED, glyph: Client.ORB_GLYPH_HP },
            { cy: cy0 + L.step, rgb: prRgb, frac: prFrac, value: prCur, textRgb: Colour.WHITE, glyph: Client.ORB_GLYPH_PRAYER },
            { cy: cy0 + 2 * L.step, rgb: rnRgb, frac: rnFrac, value: this.runenergy, textRgb: Colour.WHITE, glyph: Client.ORB_GLYPH_RUN }""",
     """            { cy: cy0, rgb: hpRgb, frac: hpFrac, value: hpCur, textRgb: hpFrac > 0.66 ? Colour.GREEN : hpFrac > 0.33 ? Colour.YELLOW : Colour.RED, glyph: ORB_GLYPH_HP },
            { cy: cy0 + L.step, rgb: prRgb, frac: prFrac, value: prCur, textRgb: Colour.WHITE, glyph: ORB_GLYPH_PRAYER },
            { cy: cy0 + 2 * L.step, rgb: rnRgb, frac: rnFrac, value: this.runenergy, textRgb: Colour.WHITE, glyph: ORB_GLYPH_RUN }""")

edit('glyph guard', 'statOrbsGlyphOk(glyph)', """        if (glyph.length === 49 && innerR >= 7) {""",
     """        if (statOrbsGlyphOk(glyph) && innerR >= 7) {""")

# ---- 3. spec fields --------------------------------------------------------------
edit('fields', 'private orbsSpecRoot', """    private orbsBook: OrbBook | null = null;
    private orbsRun: OrbRun | null = null;
    private orbsBookTried: boolean = false;
""", """    private orbsBook: OrbBook | null = null;
    private orbsRun: OrbRun | null = null;
    private orbsBookTried: boolean = false;
    /// custom: the special-attack bar, found in the COMBAT tab's interface (see
    /// orbsResolve). Only the bar's SHAPE is cached — whether the wielded weapon has a
    /// special attack is that bar layer's own hide flag, read live every frame, because
    /// the weapon (and with it the whole combat interface) can change on any tick.
    /// lclite:stat-orbs
    private orbsSpec: OrbSpec | null = null;
    private orbsSpecRoot: number = -1;
    private orbsSpecApiBound: boolean = false;
    /// custom: the spec orb's palette while the wielded weapon has NO special attack —
    /// monochrome, so the orb reads as "nothing to spend" and the percentage stays
    /// legible. lclite:stat-orbs
    static readonly ORB_SPEC_GREY_BG: number = 0x4a4a4a;
    static readonly ORB_SPEC_GREY_FILL: number = 0x9a9a9a;
""")

# ---- 4. orbLayout: the spec orb's own box ----------------------------------------
edit('orbLayout signature', 'specR: number } {', """    private orbLayout(): { r: number; orbLeft: number; step: number; ox: number; oy: number; boxW: number; boxH: number; numbers: string; scale: number; pie: boolean; pulse: boolean } {""",
     """    private orbLayout(): { r: number; orbLeft: number; step: number; ox: number; oy: number; boxW: number; boxH: number; numbers: string; scale: number; pie: boolean; pulse: boolean; specX: number; specY: number; specR: number } {""")

edit('orbLayout tail', 'specX: specX, specY: specY, specR: specR', """        ox = Math.max(0, Math.min(ox, 172 - boxW));
        oy = Math.max(0, Math.min(oy, 156 - boxH));
        return { r: r, orbLeft: orbLeft, step: step, ox: ox, oy: oy, boxW: boxW, boxH: boxH, numbers: numbers, scale: S.numberScale, pie: localStorage.getItem('statOrbsFill') === 'pie', pulse: localStorage.getItem('statOrbsPulse') !== 'false' };""",
     """        ox = Math.max(0, Math.min(ox, 172 - boxW));
        oy = Math.max(0, Math.min(oy, 156 - boxH));

        // The spec orb is its OWN canvas surface, with its own keys and its own reset,
        // because it deliberately sits away from the column: the panel's bottom left,
        // clear of the three orbs and of the wiki button that owns the bottom right.
        // Until it is dragged it FOLLOWS the column — the same 4px gap and the same
        // bottom edge at every size and number scale — so moving or resizing the column
        // can never land it on top of one of the three. lclite:stat-orbs
        const specR: number = r + ORB_SPEC_EXTRA;
        let specX: number = 0;
        let specY: number = 0;
        const si: number = Client.ORB_ANCH_NAMES.indexOf(localStorage.getItem('lcmStatOrbsSpecAnchor') || '');
        if (si >= 0) {
            const k: number[] = Client.ORB_ANCH[si];
            const soff: string[] = (localStorage.getItem('lcmStatOrbsSpecOffset') || '0,0').split(',');
            specX = Math.round(172 * k[0]) + (parseInt(soff[0]) || 0);
            specY = Math.round(156 * k[1]) + (parseInt(soff[1]) || 0);
            // clamped FLUSH, exactly like the column and like the panel's own drag layer
            specX = Math.max(0, Math.min(specX, 172 - 2 * specR));
            specY = Math.max(0, Math.min(specY, 156 - 2 * specR));
        } else {
            const specBox: number[] = statOrbsSpecBox(ox + orbLeft + 2 * r, oy + boxH, r);
            specX = specBox[0];
            specY = specBox[1];
        }

        return { r: r, orbLeft: orbLeft, step: step, ox: ox, oy: oy, boxW: boxW, boxH: boxH, numbers: numbers, scale: S.numberScale, pie: localStorage.getItem('statOrbsFill') === 'pie', pulse: localStorage.getItem('statOrbsPulse') !== 'false', specX: specX, specY: specY, specR: specR };""")

# ---- 5. drawStatOrbs: colours, live spec state, sig, draw, 2nd surface ------------
edit('spec colours', "Client.orbColour('statOrbsSpecColor', 0x8b1a1a)", """        const rnRgb: number = Client.orbColour('statOrbsRunColor', 0x71c8e8);
""", """        const rnRgb: number = Client.orbColour('statOrbsRunColor', 0x71c8e8);
        // the special attack orb: a RED background with a GREEN depleting fill, which is
        // the 2004 spec bar's own colour scheme — and a plain grey orb for a weapon with
        // no special attack, which still reads the energy out. lclite:stat-orbs
        const spRgb: number = Client.orbColour('statOrbsSpecColor', 0x8b1a1a);
        const spFill: number = Client.orbColour('statOrbsSpecFill', 0x3cbf2e);
""")

edit('spec live state', 'const specHas: boolean = statOrbsSpecWeapon', """        this.orbsResolve();
        const runOn: boolean = this.orbsRun !== null && this.var[this.orbsRun.varp] === 1;
""", """        this.orbsResolve();
        const runOn: boolean = this.orbsRun !== null && this.var[this.orbsRun.varp] === 1;
        // LIVE every frame: the bar layer's hide flag is the server's own answer to "does
        // this weapon have a special attack" (it hides the bar for one that does not), and
        // the varp is the energy itself — the same value the game's own bar draws.
        // lclite:stat-orbs
        const specHas: boolean = statOrbsSpecWeapon(IfType.list, this.orbsSpec);
        const specPct: number = this.orbsSpec === null ? 0 : statOrbsSpecPercent(this.var[this.orbsSpec.varp], this.orbsSpec.max);
""")

edit('spec sig', "const specSig: string = this.orbsSpec === null ? 'x'", """        const sig: string = L.ox + ',' + L.oy + ',' + L.r + ',' + L.numbers + ',' + L.scale + ',' + (L.pie ? 'p' : 'l') + ',' + hpRgb + ',' + prRgb + ',' + rnRgb + ',' + hpCur + ',' + prCur + ',' + this.runenergy + ',' + (runOn ? 1 : 0) + ',' + bookSig;""",
     """        // the spec orb's own state rides the same signature: its percentage, its weapon
        // state (which recolours it), its spot and its size all leave stale pixels behind
        // when they change. 'x' = no spec bar in this revision's interfaces, i.e. nothing
        // drawn — which must wipe too, if the orb was drawn a frame ago. lclite:stat-orbs
        const specSig: string = this.orbsSpec === null ? 'x' : (specHas ? '1' : '0') + ',' + specPct + ',' + L.specX + ',' + L.specY + ',' + L.specR + ',' + spRgb + ',' + spFill;
        const sig: string = L.ox + ',' + L.oy + ',' + L.r + ',' + L.numbers + ',' + L.scale + ',' + (L.pie ? 'p' : 'l') + ',' + hpRgb + ',' + prRgb + ',' + rnRgb + ',' + hpCur + ',' + prCur + ',' + this.runenergy + ',' + (runOn ? 1 : 0) + ',' + specSig + ',' + bookSig;""")

edit('spec draw', 'const scx: number = L.specX + L.specR;', """        // placement bridge for the panel's drag layer (positional arrays only — object
        // literals arrive key-mangled across the bundle boundary). Bound once; the box
        // stays live, and reports null while the mod is off so alt+drag cannot grab it.
        const W: any = window as any;""",
     """        // the special attack orb: a bit bigger than the others, at the panel's bottom
        // left. The percentage IS its information, so it is always drawn INSIDE it, at the
        // largest scale that still fits its glass — the 'Orb numbers' setting governs the
        // column's readouts, and a number beside this orb would land on the run orb above
        // it. lclite:stat-orbs
        if (this.orbsSpec !== null) {
            const scx: number = L.specX + L.specR;
            const scy: number = L.specY + L.specR;
            this.drawOrb(scx, scy, L.specR, specHas ? spFill : Client.ORB_SPEC_GREY_FILL, specPct / 100, L.pie, '', specHas ? spRgb : Client.ORB_SPEC_GREY_BG);
            const specText: string = String(specPct);
            const specScale: number = statOrbsSpecTextScale(L.scale, L.specR - 3);
            this.drawOrbNumber(specText, scx - (statOrbsNumberWidth(specText, specScale) >> 1), scy, Colour.WHITE, specScale);
        }

        // placement bridge for the panel's drag layer (positional arrays only — object
        // literals arrive key-mangled across the bundle boundary). Bound once; the box
        // stays live, and reports null while the mod is off so alt+drag cannot grab it.
        const W: any = window as any;""")

edit('spec surface', "['stat-orbs-spec'", """            W['lcmAnchor']['registerCanvas']?.(['stat-orbs', 'lcmStatOrbsAnchor', 'lcmStatOrbsOffset', 'TL', '0,34', () => (W['lcmStatOrbsBounds'] ? W['lcmStatOrbsBounds']() : null), [550, 4, 172, 156, 172, 156]]);""",
     """            W['lcmAnchor']['registerCanvas']?.(['stat-orbs', 'lcmStatOrbsAnchor', 'lcmStatOrbsOffset', 'TL', '0,34', () => (W['lcmStatOrbsBounds'] ? W['lcmStatOrbsBounds']() : null), [550, 4, 172, 156, 172, 156]]);
            // the spec orb is a SECOND canvas surface on the same widget buffer: its own
            // keys, so Alt+drag and its own reset row move it alone. Its bounds are a
            // closure, so the box it publishes is always the one being drawn.
            // lclite:stat-orbs
            W['lcmAnchor']['registerCanvas']?.(['stat-orbs-spec', 'lcmStatOrbsSpecAnchor', 'lcmStatOrbsSpecOffset', 'BL', '40,128', () => {
                const b = this.orbLayout();
                return this.orbsEnabled && this.orbsSpec !== null ? [b.specX, b.specY, 2 * b.specR, 2 * b.specR] : null;
            }, [550, 4, 172, 156, 172, 156]]);""")

# ---- 6. drawOrb: an optional background (the spec orb's own palette) --------------
edit('drawOrb signature', 'glyph: string, bg: number', """    private drawOrb(cx: number, cy: number, r: number, rgb: number, frac: number, pie: boolean, glyph: string): void {""",
     """    private drawOrb(cx: number, cy: number, r: number, rgb: number, frac: number, pie: boolean, glyph: string, bg: number): void {""")

edit('drawOrb glass', '} else if (bg === 0) {', """                    } else {
                        colour = d > innerR - 1.5 ? 0x2b2721 : 0x161310;
                    }""", """                    } else if (bg === 0) {
                        colour = d > innerR - 1.5 ? 0x2b2721 : 0x161310;   // the dark glass every stat orb has
                    } else {
                        // the spec orb's own background — red for a weapon with a special
                        // attack, grey for one without. Two HARD bands, like every other
                        // orb: never a gradient.
                        colour = d > innerR - 1.5 ? Client.orbShade(bg, 1.3) : Client.orbShade(bg, 0.72);
                    }""")

edit('drawOrb call', 'this.drawOrb(cx, orb.cy, L.r, rgb, orb.frac, L.pie, orb.glyph, 0);', """            this.drawOrb(cx, orb.cy, L.r, rgb, orb.frac, L.pie, orb.glyph);""",
     """            this.drawOrb(cx, orb.cy, L.r, rgb, orb.frac, L.pie, orb.glyph, 0);""")

# ---- 7. drawOrbNumber: rasterize through the core's glyph bitmaps ------------------
edit('drawOrbNumber', 'statOrbsGlyphH(s)', """    private drawOrbNumber(text: string, x: number, cy: number, rgb: number, scale: number): void {
        const s: number = statOrbsScale(scale);
        const y: number = statOrbsNumberTop(cy, s);
        for (let pass: number = 0; pass < 2; pass++) {
            const off: number = pass === 0 ? s : 0;
            const col: number = pass === 0 ? 0x000000 : rgb;
            for (let i: number = 0; i < text.length; i++) {
                const d: number = text.charCodeAt(i) - 48;
                if (d < 0 || d > 9) {
                    continue;
                }
                const bits: string = Client.ORB_DIGITS[d];
                for (let j: number = 0; j < 5; j++) {
                    for (let k: number = 0; k < 3; k++) {
                        if (bits.charAt(j * 3 + k) !== '1') {
                            continue;
                        }
                        for (let dy: number = 0; dy < s; dy++) {
                            for (let dx: number = 0; dx < s; dx++) {
                                Client.orbPixel(x + i * statOrbsDigitAdvance(s) + k * s + dx + off, y + j * s + dy + off, col);
                            }
                        }
                    }
                }
            }
        }
    }""", """    private drawOrbNumber(text: string, x: number, cy: number, rgb: number, scale: number): void {
        const s: number = statOrbsScale(scale);
        const gw: number = statOrbsGlyphW(s);
        const gh: number = statOrbsGlyphH(s);
        const adv: number = statOrbsDigitAdvance(s);
        const off: number = statOrbsDigitGap(s);       // the shadow drops one whole block
        const y: number = statOrbsNumberTop(cy, s);
        for (let pass: number = 0; pass < 2; pass++) {
            const dx0: number = pass === 0 ? off : 0;
            const dy0: number = pass === 0 ? off : 0;
            const col: number = pass === 0 ? 0x000000 : rgb;
            for (let i: number = 0; i < text.length; i++) {
                const d: number = text.charCodeAt(i) - 48;
                if (d < 0 || d > 9) {
                    continue;
                }
                const ink: Uint8Array = statOrbsGlyph(d, s);
                for (let py: number = 0; py < gh; py++) {
                    for (let px: number = 0; px < gw; px++) {
                        if (ink[py * gw + px] !== 1) {
                            continue;
                        }
                        Client.orbPixel(x + i * adv + px + dx0, y + py + dy0, col);
                    }
                }
            }
        }
    }""")

# ---- 8. orbsResolve: also find the spec bar --------------------------------------
edit('orbsResolve', 'this.orbsSpec = statOrbsSpec(IfType.list, root);', """    private orbsResolve(): void {
        if (this.orbsBook !== null && this.orbsRun !== null) {
            return;
        }

        if (IfType.list.length === 0) {
            return;
        }

        this.orbsBookTried = true;
        this.orbsBook = statOrbsBook(IfType.list);

        // the run varp is the one the cache marks clientcode 7 — the very test the server
        // makes to find it (VarPlayerType.RUN), so this cannot drift from the game's own
        // idea of which varp run energy lives in. lclite:stat-orbs
        let runVarp: number = -1;
        for (let i: number = 0; i < VarpType.list.length; i++) {
            if (VarpType.list[i] && VarpType.list[i].clientcode === ORB_RUN_CLIENTCODE) {
                runVarp = i;
                break;
            }
        }
        this.orbsRun = statOrbsRun(IfType.list, runVarp);
    }""", """    private orbsResolve(): void {
        if (IfType.list.length === 0) {
            return;
        }

        if (this.orbsBook === null || this.orbsRun === null) {
            this.orbsBookTried = true;
            this.orbsBook = statOrbsBook(IfType.list);

            // the run varp is the one the cache marks clientcode 7 — the very test the server
            // makes to find it (VarPlayerType.RUN), so this cannot drift from the game's own
            // idea of which varp run energy lives in. lclite:stat-orbs
            let runVarp: number = -1;
            for (let i: number = 0; i < VarpType.list.length; i++) {
                if (VarpType.list[i] && VarpType.list[i].clientcode === ORB_RUN_CLIENTCODE) {
                    runVarp = i;
                    break;
                }
            }
            this.orbsRun = statOrbsRun(IfType.list, runVarp);
        }

        // The special-attack bar is looked up in the COMBAT tab's own interface — tab 0,
        // the one the server swaps per weapon category (`if_settab($interface, 0)`) — and
        // re-resolved whenever THAT changes, because every category has its own bar layer
        // and only the one on screen has a live hide flag. Nothing else is cached here:
        // the weapon, and so the bar's hidden state, can change on any tick.
        // lclite:stat-orbs
        const root: number = this.sideIcon[0];
        if (root !== this.orbsSpecRoot) {
            this.orbsSpecRoot = root;
            this.orbsSpec = statOrbsSpec(IfType.list, root);
        }
    }""")

# ---- 9. orbsClickLoop: the spec orb swallows its own click ------------------------
edit('orbsClickLoop', 'statOrbsOrbHit(mx, my, L.specX + L.specR', """        if (!this.orbsPanelOpen || this.orbsBook === null) {
            return false;
        }""", """        // the spec orb is a readout, but it straddles the map window's rim exactly like
        // the column does, so it swallows its own click rather than setting a walk flag
        // under the cursor — the same reason the Hitpoints orb consumes one.
        // lclite:stat-orbs
        if (this.orbsSpec !== null && statOrbsOrbHit(mx, my, L.specX + L.specR, L.specY + L.specR, L.specR)) {
            this.mouseClickButton = 0;
            return true;
        }

        if (!this.orbsPanelOpen || this.orbsBook === null) {
            return false;
        }""")

# ---- apply -----------------------------------------------------------------------
applied, skipped = 0, 0
for name, sentinel, anchor, replacement in edits:
    if sentinel in src:
        print('  = %-22s already applied' % name)
        skipped += 1
        continue
    n = src.count(anchor)
    assert n == 1, 'anchor for %r matched %d times (want 1)' % (name, n)
    src = src.replace(anchor, replacement)
    applied += 1
    print('  + %-22s ok' % name)

# the digit font now lives in the core (StatOrbs.ts), which is where the harness can
# rasterize it — so the copy in Client.ts goes, together with its only reader.
if 'static readonly ORB_DIGITS' in src:
    start = src.index('    /// custom: 3x5 pixel digits for the orb readouts')
    end = src.index('    ];', start) + len('    ];\n')
    src = src[:start] + """    /// custom: the readout font's TABLE and its rasterizer live in the mod's pure core
    /// (StatOrbs.ts: ORB_DIGITS / statOrbsGlyph), so mods/stat-orbs/tools/stat_orbs_test.ts
    /// can rasterize a readout headlessly and compare it to these pixels. drawOrbNumber
    /// plots the bitmaps it returns. lclite:stat-orbs
""" + src[end:]
    print('  - ORB_DIGITS               moved to the core')
else:
    print('  = ORB_DIGITS               already moved')

open(PATH, 'wb').write(src.replace('\n', '\r\n').encode('utf-8'))
print('applied %d, skipped %d -> %s' % (applied, skipped, PATH))
