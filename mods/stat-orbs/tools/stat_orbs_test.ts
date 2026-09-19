// lclite:stat-orbs functional test — runs the REAL core (files/webclient/src/client/
// StatOrbs.ts, the same file `apply` copies into the tree) headlessly:
//
//   bun run mods/stat-orbs/tools/stat_orbs_test.ts        (from anywhere)
//
// Set LCLITE_ROOT=<install> to test the copy inside an applied tree; it prints which
// file it loaded either way.
//
// Covers what a browser cannot tell us cheaply:
//  1. the settings parse/clamp table (number scale, run click, prayer panel);
//  2. the readout geometry at every scale — the digit advance, a readout's width, the
//     column's left inset (14px at 1x is the SHIPPED default and must not move), the
//     centred top row, and where a 'left' readout starts;
//  3. the prayer-book lookup against a fixture built to 289's OWN prayer.if geometry
//     (fifteen 34x34 toggles on the tab's 3x5 grid pushing prayer0..prayer14, each with
//     a 30x30 graphic+activegraphic icon at +2,+2, plus the tab's decoy graphic that has
//     no activegraphic) — book order, varps, click ids, and every way it must refuse
//     (a layer with non-consecutive varps, a missing icon, a misaligned icon);
//  4. the run-button lookup against 289's OWN controls.if geometry (the auto-retaliate
//     pair and the run pair, both SELECT buttons pushing a varp) — it must pick the run
//     pair off the varp alone and never the retaliate pair;
//  5. the panel's box (beside the orb column, sliding right as the readouts grow,
//     clamped flush inside the 172x156 widget), its fifteen cell positions, and its hit
//     test — every cell's own centre maps back to that cell, the frame is not a cell, and
//     nothing outside the box is ever a hit.
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

// ---- 1. settings -----------------------------------------------------------------
console.log('\nsettings:');
{
    const read = (map: Record<string, string>) => (k: string) => (k in map ? map[k] : null);

    eq(S.statOrbsSettings(read({})), { numberScale: 1, runClick: true, prayerPanel: true }, 'defaults: 1x, run click on, panel on');
    eq(S.statOrbsSettings(read({ statOrbsNumberScale: '3' })).numberScale, 3, "scale '3'");
    eq(S.statOrbsSettings(read({ statOrbsNumberScale: '2.0' })).numberScale, 2, 'a slider float parses to its integer');
    eq(S.statOrbsSettings(read({ statOrbsNumberScale: '9' })).numberScale, 3, 'a hand-typed 9 clamps to 3');
    eq(S.statOrbsSettings(read({ statOrbsNumberScale: '0' })).numberScale, 1, 'a hand-typed 0 clamps to 1');
    eq(S.statOrbsSettings(read({ statOrbsNumberScale: 'banana' })).numberScale, 1, 'garbage falls back to 1');
    eq(S.statOrbsSettings(read({ statOrbsNumberScale: '-4' })).numberScale, 1, 'a negative clamps to 1');
    eq(S.statOrbsSettings(read({ statOrbsRunClick: 'false' })).runClick, false, 'run click off');
    eq(S.statOrbsSettings(read({ statOrbsPrayerPanel: 'false' })).prayerPanel, false, 'panel off');
    eq(S.statOrbsSettings(read({ statOrbsRunClick: 'yes' })).runClick, true, "anything but 'false' is on");
    eq([S.statOrbsScale(0), S.statOrbsScale(1), S.statOrbsScale(2.7), S.statOrbsScale(4), S.statOrbsScale(NaN)],
        [1, 1, 2, 3, 1], 'statOrbsScale clamps and truncates');
}

// ---- 2. readout geometry ---------------------------------------------------------
console.log('\nreadout geometry:');
{
    eq([1, 2, 3].map((s) => S.statOrbsDigitAdvance(s)), [4, 8, 12], 'a digit advances 4/8/12px');
    eq(S.statOrbsNumberWidth('', 1), 0, 'an empty readout is 0 wide (a hidden number)');
    eq(S.statOrbsNumberWidth('7', 1), 3, 'one digit is 3px of ink');
    eq(S.statOrbsNumberWidth('88', 1), 7, 'two digits are 7px of ink');
    eq(S.statOrbsNumberWidth('100', 1), 11, 'three digits are 11px of ink');
    eq([1, 2, 3].map((s) => S.statOrbsNumberWidth('100', s)), [11, 22, 33], 'the widest readout at each scale');
    // the shipped default: 'left' at 1x must still reserve exactly the old 14px, or every
    // existing screenshot and the drag layer's stored offsets would shift
    eq([1, 2, 3].map((s) => S.statOrbsOrbLeft('left', s)), [14, 25, 36], "the column's inset at 1x/2x/3x");
    eq([S.statOrbsOrbLeft('inside', 3), S.statOrbsOrbLeft('hidden', 3)], [3, 3], 'inside/hidden readouts leave the orbs at the frame edge');
    eq([1, 2, 3].map((s) => S.statOrbsNumberTop(100, s)), [98, 95, 93], 'a readout is centred on the orb at every scale');
    // at the layout's OWN centre for each scale — orbLeft grows with the scale, so the
    // readout always starts clear of the widget's left edge
    const leftAt = [1, 2, 3].map((s) => S.statOrbsNumberLeft(s === 1 ? 25 : s === 2 ? 36 : 47, 11, '88', s));
    eq(leftAt, [4, 8, 12], "'left' starts hard against the rim, at every scale");
    ok(leftAt.every((x: number) => x >= 0), 'and a two-digit readout never runs off the widget at any scale');
    // the shipped default must be untouched: at 1x this is the OLD expression, digit for digit
    eq(S.statOrbsNumberLeft(25, 11, '88', 1), 25 - 11 - 3 - (2 * 4 - 1), 'the 1x readout lands exactly where it always has');
    // the readout must never be wider than the room the column reserved for it
    ok([1, 2, 3].every((s) => S.statOrbsNumberWidth('100', s) <= S.statOrbsOrbLeft('left', s)),
        'three digits always fit the reserved strip at every scale');
}

// ---- the 289 interface fixtures --------------------------------------------------
/** One component in the shape webclient's IfType hands us. */
function com(o: any): any {
    return {
        id: 0, layerId: 0, type: 0, buttonType: 0, x: 0, y: 0,
        scripts: null, scriptOperand: null, graphic: null, graphic2: null, ...o
    };
}
const PUSHVAR = 5, TOGGLE = 4, SELECT = 5, GRAPHIC = 5;

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

// ---- 3. the prayer book lookup ---------------------------------------------------
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

// ---- 4. the run-button lookup ----------------------------------------------------
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

// ---- 5. the panel's box, cells and hit test --------------------------------------
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
