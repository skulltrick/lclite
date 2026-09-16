/* mods/control-panel/tools/canvas_size_test.mjs — page-side harness for setSize().
 *
 * The canvas-size control is the one piece of the panel that is not a registry row:
 * it is page code (engine/view/client.ejs, patched by this mod), and it now accepts
 * ANY decimal scale, so it is worth machine-checking rather than eyeballing.
 *
 * Runs the REAL setSize() out of the patched client.ejs against a stub DOM +
 * localStorage and asserts the contract the panel and the legacy bar both rely on:
 *   legacy '1'/'2'/'3' behave exactly as before, decimals work, values are clamped to
 *   0.25x..8x and canonicalised into canvasSize, canvasScale remembers the fixed
 *   scale, and the legacy dropdown is kept in step (adding a custom option for odd
 *   values so it never loses its selection).
 *
 * Usage:  node mods/control-panel/tools/canvas_size_test.mjs [LCLITE_ROOT]
 *         LCLITE_ROOT=<install> node mods/control-panel/tools/canvas_size_test.mjs
 * Exit code 0 = all checks passed.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || process.env.LCLITE_ROOT || path.join(process.env.LOCALAPPDATA ?? '', 'LCLite', 'installs', '289');
const ejs = path.join(root, 'engine', 'view', 'client.ejs');

if (!fs.existsSync(ejs)) {
    console.error(`no client.ejs at ${ejs}\npass LCLITE_ROOT (or the install path) as argv[2]`);
    process.exit(2);
}

const src = fs.readFileSync(ejs, 'utf-8');
const blocks = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const js = blocks.find(b => b.includes('function setSize')) ?? '';
if (!js) {
    console.error('setSize() not found in client.ejs — is the control-panel mod applied?');
    process.exit(2);
}
if (/(^|\s)<!--/.test(js) && /<!--[^\n]*$[\s\S]*?[^\n]*-->/.test(js)) {
    // annex-B: only a line STARTING with <!-- is a comment, so a multi-line one is a
    // syntax error that a browser reports at load — catch it here instead
    console.error('client.ejs script contains a multi-line <!-- --> comment (annex-B line comment) — use // comments');
    process.exit(2);
}

// ---- stub DOM ---------------------------------------------------------------
const store = new Map();
const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
};
class Opt {
    constructor(value = '', text = '') { this.value = value; this.textContent = text; this.attrs = {}; }
    setAttribute(k, v) { this.attrs[k] = v; }
}
class El {
    constructor(id) { this.id = id; this.style = {}; this.attrs = {}; this.textContent = ''; this.options = []; }
    setAttribute(k, v) { this.attrs[k] = v; }
    querySelector(sel) {
        return /option\[data-lcm-custom\]/.test(sel) ? (this.options.find(o => o.attrs['data-lcm-custom']) ?? null) : null;
    }
    appendChild(o) { this.options.push(o); return o; }
    addEventListener() {}
}
const els = {
    canvas: new El('canvas'),
    controls: new El('controls'),
    'hide-message': new El('hide-message'),
    'count-down': new El('count-down'),
    size: new El('size'),
    filtering: new El('filtering'),
    game: new El('game'),
};
els.controls.style.display = 'none';
els['hide-message'].style.display = 'none';
for (const [v, t] of [['1', '1x Size'], ['2', '2x Size'], ['3', '3x Size'], ['auto', 'Auto Sizing']]) els.size.options.push(new Opt(v, t));

const document = {
    getElementById: id => els[id] ?? null,
    createElement: () => new Opt(),
    addEventListener() {},
    documentElement: new El('html'),
    fullscreenElement: null,
};
const window = { innerWidth: 1600, innerHeight: 900, addEventListener() {} };

new Function('document', 'window', 'localStorage', 'navigator', js + '\n;globalThis.__setSize = setSize;')(
    document, window, localStorage, { userAgent: 'node' }
);
const setSize = globalThis.__setSize;

// ---- assertions -------------------------------------------------------------
let pass = 0;
const failures = [];
const eq = (label, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return; }
    failures.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const custom = () => els.size.options.find(o => o.attrs['data-lcm-custom']);

setSize('1');
eq('1x width', els.canvas.style.width, '765px');
eq('1x height', els.canvas.style.height, '503px');
eq('1x canvasSize', localStorage.getItem('canvasSize'), '1');
eq('1x canvasScale', localStorage.getItem('canvasScale'), '1');
eq('1x maxWidth is released', els.canvas.style.maxWidth, 'none');

setSize('2');
eq('legacy 2x width', els.canvas.style.width, '1530px');
eq('legacy 2x canvasSize', localStorage.getItem('canvasSize'), '2');
setSize('3');
eq('legacy 3x height', els.canvas.style.height, '1509px');

setSize('1.35');
eq('decimal width', els.canvas.style.width, '1032.75px');
eq('decimal canvasSize', localStorage.getItem('canvasSize'), '1.35');
eq('decimal canvasScale', localStorage.getItem('canvasScale'), '1.35');
eq('dropdown follows the decimal', els.size.value, '1.35');
eq('dropdown gained one custom option', els.size.options.filter(o => o.attrs['data-lcm-custom']).length, 1);
eq('custom option label', custom().textContent, '1.35x (custom)');

setSize('1');
eq('back to 1x selects the real option again', els.size.value, '1');
setSize('2.4');
eq('custom option is reused', els.size.options.filter(o => o.attrs['data-lcm-custom']).length, 1);
eq('custom option relabelled', custom().textContent, '2.4x (custom)');

setSize('99');
eq('clamped high width', els.canvas.style.width, `${765 * 8}px`);
eq('clamped high stored', localStorage.getItem('canvasSize'), '8');
setSize('0.01');
eq('clamped low width', els.canvas.style.width, `${765 * 0.25}px`);
eq('clamped low stored', localStorage.getItem('canvasSize'), '0.25');

setSize('auto');
eq('auto canvasSize', localStorage.getItem('canvasSize'), 'auto');
eq('auto keeps the remembered fixed scale', localStorage.getItem('canvasScale'), '0.25');
eq('auto fits height (1600x900)', els.canvas.style.width, `${765 * (900 / 503)}px`);
eq('auto maxHeight', els.canvas.style.maxHeight, '900px');
eq('auto dropdown', els.size.value, 'auto');

setSize(null);
eq('no-arg call reads the legacy dropdown', localStorage.getItem('canvasSize'), 'auto');

setSize('garbage');
eq('unknown value falls back to 1x', els.canvas.style.width, '765px');
eq('unknown value stored canonically', localStorage.getItem('canvasSize'), '1');

for (const f of failures) console.log(`FAIL ${f}`);
console.log(`\n${pass} passed, ${failures.length} failed${failures.length ? '' : ' — setSize() contract intact'}`);
process.exit(failures.length ? 1 : 0);
