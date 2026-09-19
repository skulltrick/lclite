// lclite:stat-orbs functional test — runs the REAL core (files/webclient/src/client/
// StatOrbs.ts, the same file `apply` copies into the tree) headlessly:
//
//   bun run mods/stat-orbs/tools/stat_orbs_test.ts        (from anywhere)
//
// Set LCLITE_ROOT=<install> to test the copy inside an applied tree; it prints which
// file it loaded either way.
//
// Covers what a browser cannot tell us cheaply:
//  1. the settings parse/clamp table (number scale, run click, prayer panel) and the
//     HALF-STEP scale ladder (1, 1.5, 2, 2.5, 3 — nothing else);
//  2. the readout geometry at every scale — the digit advance, a readout's width, the
//     column's left inset (14px at 1x is the SHIPPED default and must not move), the
//     centred top row, where a 'left' readout starts, and that the ladder only ever
//     grows: a half step has to sit BETWEEN its neighbours, not next to them;
//  3. the readout font itself: the 1x/2x/3x rasters are the 3x5 table block for block
//     (the shipped look, digit for digit), the half steps are the 4x7 table, and the
//     orb marks are all complete 7x7s — a mark of the wrong length is silently not
//     drawn at all, which is how the run orb shipped with an empty middle;
//  4. the prayer-book lookup against a fixture built to 289's OWN prayer.if geometry
//     (fifteen 34x34 toggles on the tab's 3x5 grid pushing prayer0..prayer14, each with
//     a 30x30 graphic+activegraphic icon at +2,+2, plus the tab's decoy graphic that has
//     no activegraphic) — book order, varps, click ids, and every way it must refuse
//     (a layer with non-consecutive varps, a missing icon, a misaligned icon);
//  5. the run-button lookup against 289's OWN controls.if geometry (the auto-retaliate
//     pair and the run pair, both SELECT buttons pushing a varp) — it must pick the run
//     pair off the varp alone and never the retaliate pair;
//  6. the special-attack bar against a fixture built to 289's OWN combat_axe.if geometry
//     (a specbar layer holding ten model segments, each reading the sa_energy varp with
//     `gt,99` … `gt,999`) — the varp, the maximum energy off the bar's own top
//     threshold, the layer the server hides for a weapon without a special attack, and
//     the refusals (uneven thresholds, one segment, a non-pushvar script, no tree);
//  7. the panel's box (beside the orb column, sliding right as the readouts grow,
//     clamped flush inside the 172x156 widget), its fifteen cell positions, its hit
//     test, and the spec orb's own box, hit test and inside-number scale.
import path from 'node:path';

const LCLITE = path.resolve(import.meta.dir, '../../..');
const PAYLOAD = path.join(LCLITE, 'mods/stat-orbs/files/webclient/src/client/StatOrbs.ts');
const CORE = process.env.LCLITE_ROOT
    ? path.join(process.env.LCLITE_ROOT, 'webclient/src/client/StatOrbs.ts')
    : PAYLOAD;

console.log('\nstat-orbs test — core: ' + CORE);
const S: any = await import(new URL('file://' + CORE.replace(/\\/g, '/')).href);

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra?: any) {
    if (cond) { pass++; console.log('  ✓ ' + msg); }
    else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}
function eq(got: any, want: any, msg: string) { ok(JSON.stringify(got) === JSON.stringify(want), msg, { got, want }); }

const SCALES = [1, 1.5, 2, 2.5, 3];

// ---- 1. settings -----------------------------------------------------------------
console.log('\nsettings:');
{
    const read = (map: Record<string, string>) => (k: string) => (k in map ? map[k] : null);

    eq(S.statOrbsSettings(read({})), { numberScale: 1, runClick: true, prayerPanel: true }, 'defaults: 1x, run click on, panel on');
    eq(S.statOrbsSettings(read({ statOrbsNumberScale: '3' })).numberScale, 3, "scale '3'");
    eq(S.statOrbsSettings(read({ statOrbsNumberScale: '2.0' })).numberScale, 2, 'a slider float parses to its half step');
    eq(S.statOrbsSettings(read({ statOrbsNumberScale: '1.5' })).numberScale, 1.5, 'and 1.5 is a scale of its own');
    eq(S.statOrbsSettings(read({ statOrbsNumberScale: '9' })).numberScale, 3, 'a hand-typed 9 clamps to 3');
    eq(S.statOrbsSettings(read({ statOrbsNumberScale: '0' })).numberScale, 1, 'a hand-typed 0 clamps to 1');
    eq(S.statOrbsSettings(read({ statOrbsNumberScale: 'banana' })).numberScale, 1, 'garbage falls back to 1');
    eq(S.statOrbsSettings(read({ statOrbsNumberScale: '-4' })).numberScale, 1, 'a negative clamps to 1');
    eq(S.statOrbsSettings(read({ statOrbsRunClick: 'false' })).runClick, false, 'run click off');
    eq(S.statOrbsSettings(read({ statOrbsPrayerPanel: 'false' })).prayerPanel, false, 'panel off');
    eq(S.statOrbsSettings(read({ statOrbsRunClick: 'yes' })).runClick, true, "anything but 'false' is on");
    // the scale is a HALF-step ladder: the old 1 -> 2 jump was the whole range in one
    // notch, which is the jump this exists to soften
    eq([S.statOrbsScale(0), S.statOrbsScale(1), S.statOrbsScale(2.7), S.statOrbsScale(4), S.statOrbsScale(NaN)],
        [1, 1, 2.5, 3, 1], 'statOrbsScale clamps and lands on a half step');
    eq(SCALES.map((s: number) => S.statOrbsScale(s)), SCALES, 'every supported scale round-trips');
    eq([1.2, 1.25, 1.75, 2.3].map((v: number) => S.statOrbsScale(v)), [1, 1.5, 2, 2.5], 'an off-ladder key snaps to the nearest half step');
}

// ---- 2. readout geometry ---------------------------------------------------------
console.log('\nreadout geometry:');
{
    // the shipped default: 'left' at 1x must still reserve exactly the old 14px, or every
    // existing screenshot and the drag layer's stored offsets would shift
    eq(SCALES.map((s: number) => S.statOrbsOrbLeft('left', s)), [14, 17, 25, 31, 36], "the column's inset at 1x/1.5x/2x/2.5x/3x");
    eq([1, 2, 3].map((s: number) => S.statOrbsOrbLeft('left', s)), [14, 25, 36], 'and the three whole steps are untouched');
    eq([S.statOrbsOrbLeft('inside', 3), S.statOrbsOrbLeft('hidden', 3)], [3, 3], 'inside/hidden readouts leave the orbs at the frame edge');
    eq([1, 2, 3].map((s: number) => S.statOrbsDigitAdvance(s)), [4, 8, 12], 'a whole-step digit advances 4/8/12px');
    eq(SCALES.map((s: number) => S.statOrbsDigitAdvance(s)), [4, 5, 8, 10, 12], 'and the half steps land between them');
    eq(S.statOrbsNumberWidth('', 1), 0, 'an empty readout is 0 wide (a hidden number)');
    eq(S.statOrbsNumberWidth('7', 1), 3, 'one digit is 3px of ink');
    eq(S.statOrbsNumberWidth('88', 1), 7, 'two digits are 7px of ink');
    eq(S.statOrbsNumberWidth('100', 1), 11, 'three digits are 11px of ink');
    eq([1, 2, 3].map((s: number) => S.statOrbsNumberWidth('100', s)), [11, 22, 33], 'the widest readout at each whole step');
    eq([1, 2, 3].map((s: number) => S.statOrbsNumberTop(100, s)), [98, 95, 93], 'a readout is centred on the orb at every whole step');
    // at the layout's OWN centre for each scale — orbLeft grows with the scale, so the
    // readout always starts clear of the widget's left edge
    const leftAt = [1, 2, 3].map((s: number) => S.statOrbsNumberLeft(s === 1 ? 25 : s === 2 ? 36 : 47, 11, '88', s));
    eq(leftAt, [4, 8, 12], "'left' starts hard against the rim, at every whole step");
    ok(leftAt.every((x: number) => x >= 0), 'and a two-digit readout never runs off the widget at any scale');
    // the shipped default must be untouched: at 1x this is the OLD expression, digit for digit
    eq(S.statOrbsNumberLeft(25, 11, '88', 1), 25 - 11 - 3 - (2 * 4 - 1), 'the 1x readout lands exactly where it always has');
    // the readout must never be wider than the room the column reserved for it
    ok(SCALES.every((s: number) => S.statOrbsNumberWidth('100', s) <= S.statOrbsOrbLeft('left', s)),
        'three digits always fit the reserved strip at every scale');
    // the ladder only grows: a half step has to sit BETWEEN its neighbours
    ok(SCALES.every((s: number, i: number) => i === 0 || S.statOrbsGlyphW(s) >= S.statOrbsGlyphW(SCALES[i - 1])),
        'the glyph box never shrinks as the scale grows (width)');
    ok(SCALES.every((s: number, i: number) => i === 0 || S.statOrbsGlyphH(s) > S.statOrbsGlyphH(SCALES[i - 1])),
        'the glyph box never shrinks as the scale grows (height)');
    ok(SCALES.every((s: number, i: number) => i === 0 || S.statOrbsDigitAdvance(s) > S.statOrbsDigitAdvance(SCALES[i - 1])),
        'and every step of the ladder is a wider advance than the one before');
}

// ---- 3. the readout font ---------------------------------------------------------
console.log('\nreadout font:');
{
    const raster = (d: number, s: number) => {
        const w = S.statOrbsGlyphW(s), h = S.statOrbsGlyphH(s), ink = S.statOrbsGlyph(d, s);
        const rows: string[] = [];
        for (let y = 0; y < h; y++) {
            let row = '';
            for (let x = 0; x < w; x++) { row += ink[y * w + x] === 1 ? '1' : '0'; }
            rows.push(row);
        }
        return rows;
    };
    const block = (bits: string, fw: number, fh: number, mult: number) => {
        const rows: string[] = [];
        for (let j = 0; j < fh; j++) {
            let row = '';
            for (let i = 0; i < fw; i++) { row += (bits.charAt(j * fw + i) === '1' ? '1' : '0').repeat(mult); }
            for (let m = 0; m < mult; m++) { rows.push(row); }
        }
        return rows;
    };

    eq([1, 2, 3].map((s: number) => [S.statOrbsGlyphW(s), S.statOrbsGlyphH(s)]), [[3, 5], [6, 10], [9, 15]], 'the whole steps are the 3x5 font at 1x/2x/3x');
    eq([[1.5], [2.5]].flat().map((s: number) => [S.statOrbsGlyphW(s), S.statOrbsGlyphH(s)]), [[4, 7], [8, 14]], 'the half steps are the 4x7 font at 1x/2x');
    // the shipped look, digit for digit: a whole step IS the font table, block for block
    let wholeOk = true;
    for (const s of [1, 2, 3]) {
        for (let d = 0; d <= 9; d++) {
            if (JSON.stringify(raster(d, s)) !== JSON.stringify(block(S.ORB_DIGITS[d], 3, 5, s))) { wholeOk = false; }
        }
    }
    ok(wholeOk, '1x/2x/3x rasterize the 3x5 table exactly, block for block (the shipped digits)');
    let halfOk = true;
    for (const s of [1.5, 2.5]) {
        for (let d = 0; d <= 9; d++) {
            if (JSON.stringify(raster(d, s)) !== JSON.stringify(block(S.ORB_DIGITS_HALF[d], 4, 7, S.statOrbsGlyphW(s) / 4))) { halfOk = false; }
        }
    }
    ok(halfOk, 'and 1.5x/2.5x rasterize the 4x7 half-step table the same way');
    // every raster is 0/1 only and exactly the box the geometry promised
    let shapeOk = true;
    for (const s of SCALES) {
        for (let d = 0; d <= 9; d++) {
            const ink = S.statOrbsGlyph(d, s);
            if (ink.length !== S.statOrbsGlyphW(s) * S.statOrbsGlyphH(s)) { shapeOk = false; }
            for (const v of ink) { if (v !== 0 && v !== 1) { shapeOk = false; } }
        }
    }
    ok(shapeOk, 'every glyph raster is exactly its box, of 0s and 1s');
    // the half-step font has to be a THIN font: a 1.5x readout that came out with 2px
    // strokes would read as 2x, which is the jump this whole size exists to soften
    const stroke = (rows: string[]) => {
        // the widest run of ink in the top row of '1' is its flag; count the thinnest
        // vertical stroke instead: the left edge of '0'
        let thin = 99;
        for (const row of rows) {
            for (const run of row.split('0').filter((r: string) => r.length > 0)) { thin = Math.min(thin, run.length); }
        }
        return thin;
    };
    eq(SCALES.map((s: number) => stroke(raster(0, s))), [1, 1, 2, 2, 3], 'the stroke weight steps 1/1/2/2/3 across the ladder');
    ok(S.statOrbsGlyph(0, 1).length === 15 && raster(0, 1)[0] === '111', 'the 1x zero is still the 3px-wide shipped glyph');

    // the orb marks: drawOrb inks a mark only when it is a COMPLETE 7x7, so a table entry
    // of the wrong length is not a smaller mark — it is an empty orb, with no error
    eq([S.ORB_GLYPH_HP.length, S.ORB_GLYPH_PRAYER.length, S.ORB_GLYPH_RUN.length], [49, 49, 49], 'all three orb marks are 7x7');
    ok([S.ORB_GLYPH_HP, S.ORB_GLYPH_PRAYER, S.ORB_GLYPH_RUN].every((g: string) => S.statOrbsGlyphOk(g)), 'and every one of them passes the mark test drawOrb uses');
    ok(!S.statOrbsGlyphOk(S.ORB_GLYPH_RUN + '0') && !S.statOrbsGlyphOk(S.ORB_GLYPH_RUN.substring(1)),
        'a mark one character off 7x7 is refused — the bug that shipped an empty run orb');
    ok(!S.statOrbsGlyphOk('0'.repeat(49)) === false && S.statOrbsGlyphOk('0'.repeat(49)) === true, 'a blank 7x7 is still a valid mark (it is simply nothing to draw)');
    ok(!S.statOrbsGlyphOk('2'.repeat(49)), 'and a mark of non-pixels is refused');
    // the run mark is a bolt: ink in every row, and its bar is the widest row
    const bolt = [0, 1, 2, 3, 4, 5, 6].map((r: number) => S.ORB_GLYPH_RUN.substring(r * 7, r * 7 + 7));
    ok(bolt.every((r: string) => r.indexOf('1') >= 0), 'the run orb\u2019s bolt has ink in all seven rows');
    const widths = bolt.map((r: string) => r.split('').filter((c: string) => c === '1').length);
    eq(widths.indexOf(Math.max(...widths)), 3, 'and its bar is the middle row, as a lightning bolt\u2019s is');
}

// ---- the 289 interface fixtures --------------------------------------------------
/** One component in the shape webclient's IfType hands us. */
function com(o: any): any {
    return {
        id: 0, layerId: 0, type: 0, buttonType: 0, x: 0, y: 0,
        scripts: null, scriptComparator: null, scriptOperand: null, children: null, hide: false,
        graphic: null, graphic2: null, ...o
    };
}
const PUSHVAR = 5, TOGGLE = 4, SELECT = 5, GRAPHIC = 5, MODEL = 6, LAYER = 0, GT = 3;

/** 289's prayer tab: prayer_thickskin..prayer_protectfrommelee at the tab's own 3x5
 *  grid coordinates, pushing prayer0..prayer14 (varps 83..97), each with its icon
 *  component at +2,+2 carrying prayeroff (graphic) and prayeron (activegraphic). */
function prayerTab(layer: number, firstVarp: number, iconCount: number = 15, iconOffset: number = 2) {
    const list: any[] = [];
    const COLS = [19, 79, 139], ROWS = [6, 42, 78, 114, 150];
    for (let i = 0; i < 15; i++) {
        const x = COLS[i % 3], y = ROWS[(i / 3) | 0];
        list.push(com({ id: 100 + i, layerId: layer, type: GRAPHIC, buttonType: TOGGLE, x, y, scripts: [[PUSHVAR, firstVarp + i]], scriptOperand: [1] }));
        if (i < iconCount) {
            list.push(com({ id: 200 + i, layerId: layer, type: GRAPHIC, x: x + iconOffset, y: y + iconOffset, graphic: {}, graphic2: {}, scripts: [[9, 5]] }));
        }
    }
    // the tab's decoy: the little prayer icon in its header has a graphic but no
    // activegraphic, so it is not one of the fifteen
    list.push(com({ id: 999, layerId: layer, type: GRAPHIC, x: 83, y: 192, graphic: {}, graphic2: null, scripts: [] }));
    return list;
}

/** 289's controls tab: the auto-retaliate pair and the run pair, both SELECT buttons
 *  whose script 0 pushes their own varp, with the operand being the state they select. */
function controlsTab(layer: number, retaliateVarp: number, runVarp: number) {
    return [
        com({ id: 402, layerId: layer, type: GRAPHIC, buttonType: SELECT, x: 53, y: 108, scripts: [[PUSHVAR, retaliateVarp]], scriptOperand: [0] }),
        com({ id: 403, layerId: layer, type: GRAPHIC, buttonType: SELECT, x: 101, y: 108, scripts: [[PUSHVAR, retaliateVarp]], scriptOperand: [1] }),
        com({ id: 404, layerId: layer, type: GRAPHIC, buttonType: SELECT, x: 9, y: 44, scripts: [[PUSHVAR, runVarp]], scriptOperand: [0] }),
        com({ id: 405, layerId: layer, type: GRAPHIC, buttonType: SELECT, x: 53, y: 44, scripts: [[PUSHVAR, runVarp]], scriptOperand: [1] }),
        // the tab's energy readout: a component whose script pushes runenergy, not a varp
        com({ id: 401, layerId: layer, type: 4, buttonType: 0, x: 129, y: 40, scripts: [[11]], scriptOperand: [0] })
    ];
}

/** A combat tab as 289's combat_axe.if is shaped: a root layer whose specbar layer holds
 *  ten MODEL segments, each shown while the energy varp is above its own threshold
 *  (`script1=gt,99` … `gt,999`), plus the bar's own rect and its two border graphics.
 *
 *  Returned the way the client hands us its list: indexed BY COMPONENT ID (IfType.list is
 *  sparse), because the lookup walks the interface's own tree from the tab's root. */
function combatTab(root: number, specLayer: number, energyVarp: number, thresholds: number[] = [99, 199, 299, 399, 499, 599, 699, 799, 899, 999], hidden: boolean = false) {
    const list: any[] = [];
    const segs: number[] = [];
    for (let i = 0; i < thresholds.length; i++) {
        const id = specLayer + 1 + i;
        segs.push(id);
        list[id] = com({
            id, layerId: specLayer, type: MODEL, x: 3 + i * 14, y: 8, width: 146, height: 9,
            scripts: [[PUSHVAR, energyVarp]], scriptComparator: [GT], scriptOperand: [thresholds[i]]
        });
    }
    list[specLayer] = com({ id: specLayer, layerId: root, type: LAYER, x: 17, y: 231, children: segs, hide: hidden });
    list[specLayer - 1] = com({ id: specLayer - 1, layerId: specLayer, type: 3, x: 0, y: 1, scripts: [], scriptOperand: [] });   // the bar's own rect
    list[root] = com({ id: root, layerId: root, type: LAYER, children: [specLayer - 1, specLayer] });
    // the tab's own bits: the weapon preview and its name
    list[root + 1] = com({ id: root + 1, layerId: root, type: MODEL, x: 5, y: 8 });
    list[root + 2] = com({ id: root + 2, layerId: root, type: 4, x: 82, y: 216, scripts: [[9, 5]] });
    return list;
}

// ---- 4. the prayer book lookup ---------------------------------------------------
console.log('\nprayer book lookup:');
{
    const list = [...prayerTab(1, 83), ...controlsTab(2, 172, 173), null, undefined];
    const book = S.statOrbsBook(list);
    ok(book !== null, 'the 289 prayer tab resolves');
    eq(book.layer, 1, 'and it is the prayer layer');
    eq(book.cells.length, 15, 'fifteen prayers');
    eq(book.cells.map((c: any) => c.varp), [83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97], 'varps in book order (prayer0..prayer14)');
    eq(book.cells.map((c: any) => c.click), [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114], 'click ids in book order');
    eq(book.cells.map((c: any) => c.icon.id), [200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214], 'each prayer got its OWN icon');
    // book order is the tab's reading order: cell 0 top-left, cell 14 bottom-right
    eq([book.cells[0].icon.x, book.cells[0].icon.y], [21, 8], 'cell 0 is Thick Skin (top-left icon)');
    eq([book.cells[12].icon.x, book.cells[12].icon.y], [21, 152], 'cell 12 is Protect from Magic (bottom-left)');
    eq([book.cells[14].icon.x, book.cells[14].icon.y], [141, 152], 'cell 14 is Protect from Melee (bottom-right)');

    ok(S.statOrbsBook([...controlsTab(2, 172, 173)]) === null, 'the controls tab alone is never a book (its buttons are SELECT, not TOGGLE)');
    ok(S.statOrbsBook([]) === null, 'an empty list is null');
    ok(S.statOrbsBook([null, undefined]) === null, 'a list of holes is null');

    // non-consecutive varps: the same fifteen toggles, but a gap in the middle
    const gapped = prayerTab(1, 83);
    (gapped.find((c: any) => c.id === 107) as any).scripts = [[PUSHVAR, 200]];
    ok(S.statOrbsBook(gapped) === null, 'fifteen toggles over NON-consecutive varps are refused');

    // a missing icon: fourteen icons is not a book
    ok(S.statOrbsBook(prayerTab(1, 83, 14)) === null, 'fourteen icons is refused');

    // a misaligned icon: the pairing is geometric, so an icon that is not centred in its
    // own button means this is some other interface that merely looks like the book
    ok(S.statOrbsBook(prayerTab(1, 83, 15, 12)) === null, 'icons that are not centred in their buttons are refused');

    // and the same fifteen prayers at DIFFERENT component ids (a revision that renumbered
    // the interface) must still resolve — ids are never matched on
    const renumbered = prayerTab(1, 83).map((c: any) => ({ ...c, id: c.id + 5000 }));
    const book2 = S.statOrbsBook(renumbered);
    ok(book2 !== null && book2.cells[0].click === 5100 && book2.cells[14].click === 5114,
        'the same tab at shifted component ids still resolves (nothing is hardcoded)');

    // 289's REAL ids, read out of content/pack/interface.pack: the prayer interface is
    // component 5608, its fifteen toggles are 5609..5623, and its fifteen
    // graphic+activegraphic icons are 5629..5643 — both ranges consecutive inside the one
    // layer, which is the shape this lookup is built on.
    const real = prayerTab(5608, 83).map((c: any, i: number) => ({ ...c, id: c.id >= 200 ? 5629 + (c.id - 200) : 5609 + (c.id - 100) }));
    const realBook = S.statOrbsBook(real);
    ok(realBook !== null && realBook.layer === 5608, 'the real 289 prayer layer (5608) resolves');
    eq(realBook === null ? [] : realBook.cells.map((c: any) => c.click), [5609, 5610, 5611, 5612, 5613, 5614, 5615, 5616, 5617, 5618, 5619, 5620, 5621, 5622, 5623],
        'and its click ids are the real 5609..5623');
    eq(realBook === null ? [] : realBook.cells.map((c: any) => c.icon.id), [5629, 5630, 5631, 5632, 5633, 5634, 5635, 5636, 5637, 5638, 5639, 5640, 5641, 5642, 5643],
        'paired with the real icon ids 5629..5643');
}

// ---- 5. the run-button lookup ----------------------------------------------------
console.log('\nrun button lookup:');
{
    const list = [...prayerTab(1, 83), ...controlsTab(2, 172, 173)];
    const run = S.statOrbsRun(list, 173);
    ok(run !== null, 'the run pair resolves off the run varp');
    eq(run, { varp: 173, off: 404, on: 405 }, 'off/on are the pair pushing the run varp');
    ok(S.statOrbsRun(list, 172).on === 403, 'the retaliate varp resolves to the retaliate pair instead');
    ok(S.statOrbsRun(list, -1) === null, 'no run varp in the cache = no run buttons');
    ok(S.statOrbsRun(list, 999) === null, 'a varp no button pushes = null');
    ok(S.statOrbsRun([], 173) === null, 'an empty list = null');
    // the run readout component pushes a VALUE (runenergy), not a varp: it must never be
    // mistaken for a button
    ok(!list.filter((c: any) => c && c.buttonType === SELECT).some((c: any) => c.scripts[0][0] !== PUSHVAR),
        'no SELECT button in the fixture pushes anything but a varp');

    // 289's REAL controls ids (interface 147): com_2/com_3 are the retaliate pair (150,
    // 151) and com_4/com_5 are the walk/run pair (152, 153), with option_run = varp 173
    // (content/pack/varp.pack) — the varp the cache marks clientcode 7.
    const real = [
        com({ id: 150, layerId: 147, type: GRAPHIC, buttonType: SELECT, x: 53, y: 108, scripts: [[PUSHVAR, 172]], scriptOperand: [0] }),
        com({ id: 151, layerId: 147, type: GRAPHIC, buttonType: SELECT, x: 101, y: 108, scripts: [[PUSHVAR, 172]], scriptOperand: [1] }),
        com({ id: 152, layerId: 147, type: GRAPHIC, buttonType: SELECT, x: 9, y: 44, scripts: [[PUSHVAR, 173]], scriptOperand: [0] }),
        com({ id: 153, layerId: 147, type: GRAPHIC, buttonType: SELECT, x: 53, y: 44, scripts: [[PUSHVAR, 173]], scriptOperand: [1] }),
        com({ id: 148, layerId: 147, type: 4, buttonType: 0, x: 129, y: 40, scripts: [[11]], scriptOperand: [0] })
    ];
    eq(S.statOrbsRun(real, 173), { varp: 173, off: 152, on: 153 }, 'the real 289 run pair (152 walk / 153 run) resolves off varp 173');
    eq(S.statOrbsRun(real, 172), { varp: 172, off: 150, on: 151 }, 'and varp 172 resolves to the retaliate pair instead');
}

// ---- 6. the special-attack bar ---------------------------------------------------
console.log('\nspecial attack bar:');
{
    // the spec layer sits WELL clear of the root's own bits (root+1, root+2): the
    // client's list is indexed by component id, so overlapping ids would silently
    // overwrite one another
    const ROOT = 7000, SPEC = 7100, VARP = 330;
    const list = combatTab(ROOT, SPEC, VARP);
    const spec = S.statOrbsSpec(list, ROOT);
    ok(spec !== null, "289's combat tab resolves its spec bar");
    eq(spec, { varp: VARP, max: 1000, layer: SPEC }, 'the varp, the bar\u2019s own maximum (the top threshold 999 is exclusive, so full is 1000), and the layer the server hides');
    ok(S.statOrbsSpecWeapon(list, spec), 'a weapon WITH a special attack: the bar\u2019s layer is not hidden');
    // the server hides that layer for a weapon without one (`if_sethide($specbar_layer, …)`)
    const bare = combatTab(ROOT, SPEC, VARP, undefined, true);
    ok(!S.statOrbsSpecWeapon(bare, S.statOrbsSpec(bare, ROOT)), 'a weapon WITHOUT one: the same bar, hidden');
    ok(!S.statOrbsSpecWeapon(list, null), 'and no bar at all is never a special attack');
    // the flag is read LIVE, so the same resolved bar answers both ways
    ok(S.statOrbsSpecWeapon(list, spec) !== S.statOrbsSpecWeapon(bare, spec), 'the same bar answers for both weapons (the flag is read, not cached)');

    // nothing is hardcoded: the same bar at other component ids, another varp, and a
    // server that rescales its energy all resolve
    const moved = combatTab(9000, 9100, 512);
    eq(S.statOrbsSpec(moved, 9000), { varp: 512, max: 1000, layer: 9100 }, 'the same bar at shifted component ids and another varp still resolves');
    const coarse = combatTab(ROOT, SPEC, VARP, [9, 19, 29, 39, 49, 59, 69, 79, 89, 99]);
    eq(S.statOrbsSpec(coarse, ROOT).max, 100, 'a bar of ten 10-point steps is a maximum of 100 (the scale comes off the bar)');

    // ...and every way it must refuse
    const uneven = combatTab(ROOT, SPEC, VARP, [99, 199, 299, 399, 499, 599, 699, 799, 899, 1200]);
    ok(S.statOrbsSpec(uneven, ROOT) === null, 'thresholds that are not evenly spaced are refused');
    const one = combatTab(ROOT, SPEC, VARP, [99]);
    ok(S.statOrbsSpec(one, ROOT) === null, 'a single segment is refused');
    const noPush = combatTab(ROOT, SPEC, VARP);
    noPush[SPEC + 1].scripts = [[11]];
    ok(S.statOrbsSpec(noPush, ROOT) !== null && S.statOrbsSpec(noPush, ROOT).layer === SPEC,
        'a segment that pushes a VALUE instead of a varp is not a segment (the rest of the bar still resolves)');
    // an equal-comparator bar is the prayer tab's shape, not the spec bar's
    const eqBar = combatTab(ROOT, SPEC, VARP);
    for (const c of eqBar) { if (c && c.scriptComparator) { c.scriptComparator = [1]; } }
    ok(S.statOrbsSpec(eqBar, ROOT) === null, 'a bar of `eq` segments is not the spec bar (only `gt` thresholds are)');
    ok(S.statOrbsSpec(list, -1) === null, 'no combat interface (tab 0 unset) = null');
    ok(S.statOrbsSpec(list, 99999) === null, 'an interface id outside the list = null');
    ok(S.statOrbsSpec([], ROOT) === null, 'an empty list = null');
    ok(S.statOrbsSpec([...prayerTab(1, 83), ...controlsTab(2, 172, 173)], 1) === null, 'the prayer tab holds no spec bar');
    // a decoy bar of two segments INSIDE the same interface must never beat the real
    // ten-segment bar (another bar on another varp is not the special-attack bar)
    const decoy = combatTab(ROOT, SPEC, VARP);
    decoy[7999] = com({ id: 7999, layerId: ROOT, type: LAYER, children: [7997, 7998] });
    decoy[7997] = com({ id: 7997, layerId: 7999, type: MODEL, scripts: [[PUSHVAR, 999]], scriptComparator: [GT], scriptOperand: [49] });
    decoy[7998] = com({ id: 7998, layerId: 7999, type: MODEL, scripts: [[PUSHVAR, 999]], scriptComparator: [GT], scriptOperand: [149] });
    decoy[ROOT].children.push(7999);
    eq(S.statOrbsSpec(decoy, ROOT), { varp: VARP, max: 1000, layer: SPEC }, 'the fuller bar wins when the same interface holds a shorter one');

    // the percentage: the orb's whole readout
    eq([0, 1, 250, 999, 1000, 1200, -5].map((v: number) => S.statOrbsSpecPercent(v, 1000)), [0, 0, 25, 100, 100, 100, 0], 'the energy varp reads out as a whole percent, clamped to 100');
    eq([0, 5, 50, 95, 100].map((v: number) => S.statOrbsSpecPercent(v, 100)), [0, 5, 50, 95, 100], 'and the same maths holds for a 100-point bar');
    eq(S.statOrbsSpecPercent(500, 0), 0, 'a bar with no maximum reads 0, never a divide by zero');
}

// ---- 7. the panel's box, cells and hit test --------------------------------------
console.log('\npanel geometry:');
{
    const W = S.ORB_PANEL_W, H = S.ORB_PANEL_H;
    eq([S.ORB_BOOK_COLS, S.ORB_BOOK_ROWS], [3, 5], 'the book is the prayer tab’s own 3x5 grid');
    eq([S.ORB_BOOK_W, S.ORB_BOOK_H], [95, 156], 'and 95x156 in the widget’s pixels');

    // the default orb column: orbRight = orbLeft(14) + 2r(22) = 36
    const box = S.statOrbsBookBox(36);
    eq(box, [39, 0, 95, 156], 'the default panel sits immediately right of the orb column');
    ok(box[0] > 36, 'and clears the orbs, so a click on an orb is never a click on a cell');
    ok(box[0] + box[2] <= W && box[1] + box[3] <= H, 'the panel is inside the widget');

    eq(S.statOrbsBookBox(50)[0], 53, '3x readouts push the panel right (orbRight + 3)');
    eq(S.statOrbsBookBox(W)[0], W - 95, 'and it clamps FLUSH against the widget’s right edge');
    eq(S.statOrbsBookBox(-50)[0], 2, 'and never past its own left edge');
    // past the clamp the panel stops moving, which is the case where the orb column has
    // been dragged over it — the orbs are drawn on top there, so nothing is lost
    eq(S.statOrbsBookBox(W)[0], S.statOrbsBookBox(W + 40)[0], 'a column dragged further right cannot push it off the widget');

    const cells = [];
    for (let i = 0; i < 15; i++) { cells.push(S.statOrbsBookCell(box, i)); }
    eq(cells[0], [40, 1], 'cell 0 is the top-left icon');
    eq(cells[2], [102, 1], 'cell 2 closes the top row');
    eq(cells[3], [40, 32], 'cell 3 opens the second row');
    eq(cells[14], [102, 125], 'cell 14 is the bottom-right icon');
    ok(cells.every((c: number[]) => c[0] >= box[0] && c[1] >= box[1] && c[0] + 30 <= box[0] + box[2] && c[1] + 30 <= box[1] + box[3]),
        'all fifteen icons sit inside the panel’s frame');

    // every cell's own centre must map back to that cell — this is what makes a click
    // land on the prayer the player aimed at
    let hits = 0;
    for (let i = 0; i < 15; i++) {
        const c = cells[i];
        if (S.statOrbsBookHit(c[0] + 15, c[1] + 15, box) === i) { hits++; }
    }
    eq(hits, 15, 'every cell’s centre hits its own cell');

    eq(S.statOrbsBookHit(box[0] + 1, box[1] + 1, box), 0, 'the first pixel inside the frame is cell 0');
    eq(S.statOrbsBookHit(box[0] + 1, box[1], box), -1, 'the frame itself is not a cell (it closes the book)');
    eq(S.statOrbsBookHit(box[0] + 1 + 2 * 31 + 29, box[1] + 1, box), 2, 'the last pixel of the top row’s icons is cell 2');
    eq(S.statOrbsBookHit(box[0] + box[2] - 1, box[1] + 1, box), -1, 'the 2px of frame margin right of the last column is not a cell');
    eq(S.statOrbsBookHit(box[0] - 1, 80, box), -1, 'left of the panel is not a hit');
    eq(S.statOrbsBookHit(box[0] + box[2], 80, box), -1, 'right of the panel is not a hit');
    eq(S.statOrbsBookHit(80, box[1] + box[3], box), -1, 'below the panel is not a hit');
    eq(S.statOrbsBookHit(20, 20, box), -1, 'and the orb column is never a hit');

    ok(S.statOrbsInBox(39, 0, box) && !S.statOrbsInBox(38, 0, box) && !S.statOrbsInBox(134, 0, box),
        'the box is half-open on its far edges, so boxes tile exactly');
}

// ---- 8. the special attack orb's own box ----------------------------------------
console.log('\nspecial attack orb:');
{
    // the shipped default: a 22px column at 1x, so its right edge is 36 and its bottom
    // 154 — the spec orb is 2px bigger than the orbs and sits 4px clear, bottom-aligned
    eq(S.ORB_SPEC_EXTRA, 2, 'the spec orb is 2px of radius bigger than the others');
    const sb = S.statOrbsSpecBox(36, 154, 11);
    eq(sb, [40, 128, 26, 26], 'its default box is the panel\u2019s bottom left, clear of the column');
    ok(sb[0] >= 36 + 4, 'and it clears the column\u2019s own right edge');
    ok(sb[1] + sb[3] <= S.ORB_PANEL_H, 'it sits inside the widget');
    // it must not land on the wiki button, which owns the bottom RIGHT corner
    const wiki = [S.ORB_PANEL_W - 21 - 3, S.ORB_PANEL_H - 21 - 3, 21, 21];
    ok(sb[0] + sb[2] <= wiki[0], 'and never touches the wiki button in the bottom right');
    // the box follows the column: bigger orbs, bigger readouts, still clear of it
    for (const [right, bottom, r] of [[36, 154, 11], [40, 154, 12], [46, 154, 14], [50, 154, 14]]) {
        const b = S.statOrbsSpecBox(right, bottom, r);
        ok(b[0] >= right + 4 && b[1] + b[3] <= bottom && b[0] + b[2] <= S.ORB_PANEL_W,
            'the spec orb follows the column at ' + r + 'px radius / column right ' + right);
    }
    // a column dragged into the corner cannot push it off the widget
    const corner = S.statOrbsSpecBox(S.ORB_PANEL_W, S.ORB_PANEL_H, 14);
    ok(corner[0] >= 0 && corner[0] + corner[2] <= S.ORB_PANEL_W && corner[1] >= 0 && corner[1] + corner[3] <= S.ORB_PANEL_H,
        'and a column dragged to the corner clamps it inside the widget');

    // the orb is a disc, so its clickable area is a disc too — and it is its own surface
    const cx = sb[0] + sb[2] / 2, cy = sb[1] + sb[3] / 2, sr = sb[2] / 2;
    ok(S.statOrbsOrbHit(cx, cy, cx, cy, sr), 'its centre is a hit');
    ok(!S.statOrbsOrbHit(cx + sr + 1, cy, cx, cy, sr), 'and one pixel past its rim is not');
    ok(!S.statOrbsOrbHit(25, 143, cx, cy, sr), 'the run orb above it is never a hit on it (they do not overlap)');

    // the percentage is drawn INSIDE the orb at the largest scale that still fits its
    // glass: 20px across at the shipped size, so 1.5x (19px for "100") and not 2x (22px)
    eq([1, 1.5, 2, 2.5, 3].map((s: number) => S.statOrbsSpecTextScale(s, 10)), [1, 1.5, 1.5, 1.5, 1.5],
        'the inside readout drops to the largest scale that fits a 20px glass');
    eq([1, 1.5, 2, 2.5, 3].map((s: number) => S.statOrbsSpecTextScale(s, 13)), [1, 1.5, 2, 2, 2],
        'and a 26px glass (the 28px orb) fits 2x');
    ok([10, 13].every((inner: number) => S.statOrbsNumberWidth('100', S.statOrbsSpecTextScale(3, inner)) <= inner * 2),
        'whatever it picks, three digits still fit inside the glass');
    eq(S.statOrbsSpecTextScale(1, 4), 1, 'and a tiny orb never drops below 1x');
}

// ---- the orbs' own click test ----------------------------------------------------
console.log('\norb hit test:');
{
    // the default column: orbLeft 14, r 11, orbs centred at x 25 and y 45/94/143
    const L = { orbLeft: 14, r: 11, step: 49, ox: 0, oy: 34 };
    const cx = L.ox + L.orbLeft + L.r;
    eq([0, 1, 2].map((i) => L.oy + L.r + i * L.step), [45, 94, 143], 'the three orb centres');
    ok(S.statOrbsOrbHit(cx, 94, cx, 94, L.r), 'the prayer orb’s centre is a hit');
    ok(S.statOrbsOrbHit(cx + 11, 94, cx, 94, L.r), 'its rim is a hit (a disc, not a box)');
    ok(!S.statOrbsOrbHit(cx + 12, 94, cx, 94, L.r), 'one pixel past the rim is not');
    ok(!S.statOrbsOrbHit(cx + 8, 94 + 8, cx, 94, L.r), 'and a corner inside the bounding box is not (the orbs are round)');
    ok(!S.statOrbsOrbHit(cx, 94 - 49, cx, 94, L.r), 'the orbs do not overlap: the HP orb’s centre is not on the prayer orb');
    ok(!S.statOrbsOrbHit(cx - 14, 94, cx, 94, L.r), 'the readout beside an orb is not part of it');
}

console.log('\n' + (fail === 0 ? '✔ green' : '✗ ' + fail + ' failed') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail === 0 ? 0 : 1);
