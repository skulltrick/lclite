/* lclite:rotten-potato
   The Rotten Potato — a staff/developer command palette. Homage to the item
   Jagex handed its moderators: a potato that opens a menu of admin commands.
   This one is client-side, and it runs the commands the world ALREADY has
   (engine commands and the content repo's ::~ debug procs) rather than adding
   any of its own.

   HOW A CLICK BECOMES A COMMAND — two halves, and both matter:
     1. THIS layer writes the command BODY (no '::' prefix, e.g. 'give rune_axe 5')
        into the reserved window slot `rottenPotatoCmd`, then dispatches a
        synthetic Enter at the game canvas (GameShell.onkeydown -> the engine's
        own key queue).
     2. The ENGINE-side hunk (mods/rotten-potato/patches/289/Client_ts.json) reads
        that slot where the chatbox would have typed, fills the engine's OWN
        chat input with '::' + body and lets the engine's own Enter-send path run.
        So ::fpson, ::tcg, the colour prefixes and the CLIENT_CHEAT packet are all
        the engine's, not a copy of them.
   Why not just type the command with synthetic keystrokes (a page-only mod)?
   Because the engine refuses to type into the chatbox while a chat modal is open
   (`else if (this.chatModalId === -1)`), which is exactly the state a quest dev
   is in — and `give`/`setstat`/`advancestat` work fine server-side with a
   dialogue up. See the mod's README for the full reasoning.

   SENDING TWO ENTERS, on purpose: with the hotkeys mod's "Press Enter to Chat"
   lock on, the first Enter flips its typing state and the second flips it back,
   so WASD camera keeps working after a palette command. With the lock off the
   second Enter finds an empty chat line and is a no-op. Neither Enter is claimed
   by hotkeys (it only sets its own flag), so both reach the engine.

   Settings are this mod's OWN localStorage keys, read here (rule 5):
     rottenPotato            master switch (the panel's row; default on)
     rottenPotatoButton      show the potato button (default on)
     rottenPotatoCloseOnRun  close the palette after a command (default off)
     rottenPotatoFavs        starred command ids, CSV
     rottenPotatoRecent      last commands run, CSV
     rottenPotatoLast        the last command line (the panel row's status)
     lcmRottenPotato*Anchor/Offset, lcmRottenPotatoButton*Anchor/Offset
                             placement — WRITTEN by the panel's alt-drag layer
                             only, READ here (the tcg HUD pattern).
   It never reads another mod's key. */
import {
    VERSION, CATEGORIES, COMMANDS, SKILLS, byId,
    commandLine, parseRaw, searchCommands, csvList, csvAdd, csvToggle
} from './core.js?v=1';

const LS = {
    get(k, d) { const v = localStorage.getItem(k); return v === null ? d : v; },
    set(k, v) { localStorage.setItem(k, v); }
};
const on = (k, d) => LS.get(k, d ? 'true' : 'false') === 'true';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let root, btn, panel, tabsEl, listEl, searchEl, statusEl;
let tab = 'fav';
let query = '';
let open = false;
let dragging = false;

const ANCH9 = { TL: [0, 0], TC: [.5, 0], TR: [1, 0], ML: [0, .5], MC: [.5, .5], MR: [1, .5], BL: [0, 1], BC: [.5, 1], BR: [1, 1] };

/* ---- the engine's own "am I in game" answer (advisory: the engine-side hunk is
   the authority — it drops an armed command when `this.ingame` is false). The
   property survives minification because 'ingame' is already in bundle.ts's terser
   reserve list; a missing one reads as "unknown", never as "logged out". */
function inGame() {
    const lc = window.lostcityClient;
    if (!lc || typeof lc.ingame !== 'boolean') { return null; }
    return lc.ingame;
}

function status(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = 'rp-status' + (kind ? ' rp-' + kind : '');
}

/* ---- sending -------------------------------------------------------------- */
function dispatchEnter(canvas) {
    try {
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    } catch (e) { /* empty */ }
}

function send(line) {
    const canvas = document.getElementById('canvas');
    if (!canvas) { status('the game canvas is not on the page yet', 'warn'); return false; }
    if (inGame() === false) { status('log in first — the palette types commands into the game chat', 'warn'); return false; }

    const body = String(line || '').replace(/^::/, '');
    if (body === '') { return false; }
    if (body.length > 77) { status('too long for the chat line (77 chars max)', 'warn'); return false; }

    window['rottenPotatoCmd'] = body;       // reserved slot, read by the engine hunk
    dispatchEnter(canvas);
    dispatchEnter(canvas);

    const full = '::' + body;
    LS.set('rottenPotatoLast', full);
    const id = idForLine(full);
    if (id) { LS.set('rottenPotatoRecent', csvAdd(LS.get('rottenPotatoRecent', ''), id, 8)); }
    status('sent ' + full);
    if (on('rottenPotatoCloseOnRun', false)) { close(); }

    // the engine consumes the slot within a tick of the Enter (it clears it). Still
    // armed after that = the key never reached the game (a paused tab, a canvas that
    // is not the game's): clear it ourselves so the widened guard cannot linger, and
    // say so instead of leaving a silent no-op.
    window.setTimeout(() => {
        if (window['rottenPotatoCmd'] === body) {
            window['rottenPotatoCmd'] = null;
            status('not delivered — is the game in front? ' + full, 'warn');
        }
    }, 500);
    return true;
}

function idForLine(full) {
    const body = full.replace(/^::/, '').split(' ')[0];
    for (let i = 0; i < COMMANDS.length; i++) {
        if (COMMANDS[i].cmd === body) { return COMMANDS[i].id; }
    }
    return '';
}

/* ---- placement (owner side of the alt-drag platform) ---------------------- */
function place(el, anchorKey, offsetKey, fallback) {
    const a = LS.get(anchorKey, '');
    let x, y;
    if (a && ANCH9[a]) {
        const o = LS.get(offsetKey, '0,0').split(',');
        const k = ANCH9[a];
        x = innerWidth * k[0] + (parseFloat(o[0]) || 0);
        y = innerHeight * k[1] + (parseFloat(o[1]) || 0);
    } else {
        const p = fallback ? fallback() : null;
        if (!p) { return; }
        x = p.x;
        y = p.y;
    }
    const w = el.offsetWidth || 40, h = el.offsetHeight || 40;
    el.style.left = Math.round(Math.max(4, Math.min(x, innerWidth - w - 4))) + 'px';
    el.style.top = Math.round(Math.max(4, Math.min(y, innerHeight - h - 4))) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
}

function placeButton() {
    // default: viewport top-LEFT — top-right belongs to the LCLite FAB
    place(btn, 'lcmRottenPotatoButtonAnchor', 'lcmRottenPotatoButtonOffset', () => ({ x: 18, y: 16 }));
}

function placePanel() {
    // default: centred over the game canvas, a little below its top edge
    place(panel, 'lcmRottenPotatoAnchor', 'lcmRottenPotatoOffset', () => {
        const w = panel.offsetWidth || 440;
        const c = document.getElementById('canvas');
        if (!c) { return { x: (innerWidth - w) / 2, y: 90 }; }
        const r = c.getBoundingClientRect();
        return { x: r.left + (r.width - w) / 2, y: r.top + 24 };
    });
}

function layout() {
    if (dragging) { return; }
    placeButton();
    if (open) { placePanel(); }
}

function register() {
    if (!window.lcmAnchor || typeof window.lcmAnchor.register !== 'function') { return false; }
    window.lcmAnchor.register({ id: 'rottenPotatoButton', el: btn, anchorKey: 'lcmRottenPotatoButtonAnchor', offsetKey: 'lcmRottenPotatoButtonOffset', defA: 'TL', defO: '18,16', owner: true });
    window.lcmAnchor.register({ id: 'rottenPotato', el: panel, anchorKey: 'lcmRottenPotatoAnchor', offsetKey: 'lcmRottenPotatoOffset', defA: 'MC', defO: '0,-140', owner: true });
    return true;
}

/* ---- rendering ------------------------------------------------------------ */
function visibleCommands() {
    if (tab === 'fav') {
        const ids = csvList(LS.get('rottenPotatoFavs', ''));
        const favs = ids.map(byId).filter(Boolean);
        const seen = new Set(favs.map((c) => c.id));
        const recents = csvList(LS.get('rottenPotatoRecent', '')).map(byId).filter((c) => c && !seen.has(c.id));
        return { favs, recents };
    }
    return searchCommands(COMMANDS, query, tab === 'all' ? null : tab);
}

function renderTabs() {
    const defs = [{ id: 'fav', label: '★ Favourites' }]
        .concat(CATEGORIES.map((c) => ({ id: c.id, label: c.label })))
        .concat([{ id: 'raw', label: 'Raw' }]);
    tabsEl.innerHTML = defs.map((d) =>
        `<button class="rp-tab${d.id === tab ? ' on' : ''}" data-tab="${d.id}">${esc(d.label)}</button>`).join('');
}

function argControl(c, i, values) {
    const v = values[i] === undefined ? (c.def === undefined ? '' : String(c.def)) : String(values[i]);
    if (c.kind === 'skill') {
        return `<select data-arg="${i}">${SKILLS.map((s) => `<option value="${s}"${s === v ? ' selected' : ''}>${s}</option>`).join('')}</select>`;
    }
    if (c.kind === 'select') {
        return `<select data-arg="${i}">${(c.options || []).map((o) => `<option value="${esc(o[0])}"${o[0] === v ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
    }
    if (c.kind === 'number') {
        const min = c.min === undefined ? '' : ` min="${c.min}"`;
        const max = c.max === undefined ? '' : ` max="${c.max}"`;
        return `<input data-arg="${i}" type="number"${min}${max} value="${esc(v)}" placeholder="${esc(c.def === undefined ? '' : String(c.def))}">`;
    }
    const hint = c.kind === 'item' ? 'item name (rune_axe)' : c.kind === 'name' ? 'config name' : c.kind === 'coord' ? 'level,mapX,mapZ,tileX,tileZ' : c.kind === 'player' ? 'player name' : 'text';
    return `<input data-arg="${i}" type="text" value="${esc(v)}" placeholder="${esc(c.ph || hint)}">`;
}

function rowHtml(c, values, isOpen) {
    const args = c.args || [];
    const star = csvList(LS.get('rottenPotatoFavs', '')).indexOf(c.id) !== -1 ? '★' : '☆';
    let html = `<div class="rp-row" data-id="${esc(c.id)}">`
        + `<button class="rp-star" data-star="${esc(c.id)}" title="Pin to favourites">${star}</button>`
        + `<div class="rp-main"><div class="rp-label">${esc(c.label)}</div>`
        + `<div class="rp-sub"><code>::${esc(c.cmd)}${args.length ? ' ' + args.map((a) => '&lt;' + esc(a.name) + '&gt;').join(' ') : ''}</code>`
        + `${c.note ? ` <span class="rp-note">${esc(c.note)}</span>` : ''}</div></div></div>`;
    if (args.length && isOpen) {
        html += `<div class="rp-form" data-form="${esc(c.id)}">`
            + args.map((a, i) => `<label class="rp-field"><span>${esc(a.name)}</span>${argControl(a, i, values || [])}</label>`).join('')
            + `<div class="rp-runrow"><code class="rp-preview">${esc(commandLine(c, values || []))}</code>`
            + `<button class="rp-run" data-run="${esc(c.id)}">Run</button></div></div>`;
    }
    return html;
}

const expanded = {};        // id -> arg values (its presence = "this form is open")

function formValues(form) {
    const vals = [];
    form.querySelectorAll('input, select').forEach((x, i) => { vals[i] = x.value; });
    return vals;
}

function renderList() {
    if (tab === 'raw') {
        listEl.innerHTML = `<div class="rp-raw">
            <p>Anything the catalogue does not cover. Spell it the way <code>::~help</code> does:
            <code>~maxme</code> is a debug proc, <code>give rune_axe 5</code> is an engine command.
            A pasted <code>::…</code> works too.</p>
            <div class="rp-runrow"><input id="rp-raw-input" type="text" placeholder="give rune_axe 5">
            <button class="rp-run" id="rp-raw-run">Run</button></div>
            <p class="rp-dim">The line goes into the game's own chat line, so the server answers exactly
            as it would if you had typed it.</p></div>`;
        const input = listEl.querySelector('#rp-raw-input');
        const go = () => { const line = parseRaw(input.value); if (line) { send(line); } };
        listEl.querySelector('#rp-raw-run').addEventListener('click', go);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
        input.focus();
        return;
    }

    let html = '';
    if (tab === 'fav') {
        const v = visibleCommands();
        html += v.favs.length
            ? v.favs.map((c) => rowHtml(c, expanded[c.id], !!expanded[c.id])).join('')
            : `<p class="rp-dim">No favourites yet — click the ☆ beside any command to pin it here.</p>`;
        if (v.recents.length) {
            html += `<div class="rp-head">Recent</div>` + v.recents.map((c) => rowHtml(c, expanded[c.id], !!expanded[c.id])).join('');
        }
    } else {
        const list = visibleCommands();
        html = list.length ? list.map((c) => rowHtml(c, expanded[c.id], !!expanded[c.id])).join('')
            : `<p class="rp-dim">Nothing matches &ldquo;${esc(query)}&rdquo;.</p>`;
    }
    listEl.innerHTML = html;

    listEl.querySelectorAll('.rp-star').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        LS.set('rottenPotatoFavs', csvToggle(LS.get('rottenPotatoFavs', ''), b.dataset.star));
        renderList();
    }));

    listEl.querySelectorAll('.rp-row').forEach((r) => r.addEventListener('click', () => {
        const c = byId(r.dataset.id);
        if (!c) { return; }
        if (!(c.args || []).length) { send(commandLine(c, [])); return; }
        if (expanded[c.id]) { delete expanded[c.id]; } else { expanded[c.id] = []; }
        renderList();
        const form = listEl.querySelector(`[data-form="${c.id}"]`);
        const first = form && form.querySelector('input, select');
        if (first) { first.focus(); }
    }));

    listEl.querySelectorAll('.rp-form').forEach((form) => {
        const c = byId(form.dataset.form);
        form.querySelectorAll('input, select').forEach((el) => {
            const sync = () => {
                const vals = formValues(form);
                expanded[c.id] = vals;
                form.querySelector('.rp-preview').textContent = commandLine(c, vals);
            };
            el.addEventListener('input', sync);
            el.addEventListener('change', sync);
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); send(commandLine(c, formValues(form))); }
            });
        });
    });

    listEl.querySelectorAll('.rp-run').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const c = byId(b.dataset.run);
        send(commandLine(c, formValues(b.closest('.rp-form'))));
    }));
}

/* ---- open/close ----------------------------------------------------------- */
function show() {
    open = true;
    panel.style.display = 'flex';
    renderTabs();
    renderList();
    placePanel();
    const last = LS.get('rottenPotatoLast', '');
    status(last ? 'last: ' + last : 'Pick a command — the search box filters as you type.', '');
    searchEl.focus();
}

function close() {
    open = false;
    panel.style.display = 'none';
    statusEl.textContent = '';
}

function toggle() { if (open) { close(); } else { show(); } }

// the panel's own rows (control-panel) open the palette through this page-side name:
// no reserve needed, it never crosses into the bundle
window.rottenPotatoOpen = show;
window.rottenPotatoToggle = toggle;

/* ---- build ---------------------------------------------------------------- */
function build() {
    window.__lcRottenPotatoUi = VERSION;
    try { if (document.currentScript) { document.currentScript.setAttribute('data-rp-ui', String(VERSION)); } } catch (e) { /* empty */ }

    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/lclite/rotten-potato/ui.css?v=' + VERSION;
    document.head.appendChild(css);

    root = document.createElement('div');
    root.id = 'rp-root';
    root.innerHTML = `
        <div id="rp-btn" title="Rotten Potato — staff &amp; developer commands (alt+drag to move)">
            <span class="rp-sprout"></span><span class="rp-potato"></span>
        </div>
        <div id="rp-panel" role="dialog" aria-label="Rotten Potato command palette">
            <header class="rp-bar">
                <span class="rp-title">Rotten Potato</span>
                <span class="rp-tagline">staff &amp; dev commands</span>
                <input id="rp-search" type="text" placeholder="search — give, tele, quest, xp…" autocomplete="off">
                <button id="rp-close" title="Close (Esc)">✕</button>
            </header>
            <nav id="rp-tabs"></nav>
            <div id="rp-list"></div>
            <footer id="rp-status" class="rp-status"></footer>
        </div>`;
    document.body.appendChild(root);

    btn = root.querySelector('#rp-btn');
    panel = root.querySelector('#rp-panel');
    tabsEl = root.querySelector('#rp-tabs');
    listEl = root.querySelector('#rp-list');
    searchEl = root.querySelector('#rp-search');
    statusEl = root.querySelector('#rp-status');

    btn.addEventListener('click', (e) => { if (e.altKey) { return; } toggle(); });
    root.querySelector('#rp-close').addEventListener('click', close);
    tabsEl.addEventListener('click', (e) => {
        const b = e.target.closest('.rp-tab');
        if (!b) { return; }
        tab = b.dataset.tab;
        renderTabs();
        renderList();
    });
    searchEl.addEventListener('input', () => {
        query = searchEl.value;
        if (tab === 'fav' || tab === 'raw') { tab = 'all'; renderTabs(); }
        renderList();
    });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { close(); } });
    addEventListener('resize', layout);
    addEventListener('lcm-anchor-changed', layout);
    addEventListener('lcm-anchor-reset', layout);
    addEventListener('lcm-drag', (e) => { if (e.detail === 'rottenPotato' || e.detail === 'rottenPotatoButton') { dragging = true; } });
    addEventListener('lcm-drag-end', () => { dragging = false; layout(); });

    // the button's visibility is its own key (the panel's row switch); the panel
    // follows the master, so switching the mod off in F1 hides both
    const sync = () => {
        const master = on('rottenPotato', true);
        const want = master && on('rottenPotatoButton', true);
        btn.style.display = want ? 'flex' : 'none';
        if (!master || !want) { close(); }
        layout();
    };
    setInterval(sync, 500);
    sync();

    // the placement platform is panel.js (a defer script that may execute after this
    // module): register now if it is up, and keep trying briefly if it is not
    if (!register()) {
        let tries = 0;
        const t = setInterval(() => {
            if (register() || ++tries > 20) { clearInterval(t); layout(); }
        }, 250);
    }
    layout();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
} else {
    build();
}
