/* lclite control panel — floating settings overlay for the Lost City webclient.
 * Speaks to the engine ONLY through the stable contract:
 *   - localStorage keys        (the settings bus, read by the client at boot & on apply)
 *   - window.lostcityClient    (optional; applyCameraSettings() for live re-apply,
 *                               cameraZoomTarget for the zoom slider readout)
 * Degrades gracefully: if the client bundle exposes nothing, toggles still persist and
 * take effect on reload, and the legacy green control bar stays visible.
 *
 * Layout notes (RuneLite-style): the FAB docks top-right and the panel drops down from
 * it; row descriptions are hover tooltips (#lclite-tip, fed by [data-tip]) instead of
 * per-row subtext so every row stays one line tall. Descriptions are still searchable.
 * Rows are tagged with their mod folder (`mod:`) and hidden when the installer's
 * manifest (engine/public/lclite/installed.json) says that mod was not selected.
 */
(() => {
    'use strict';

    const LS = {
        get(k, d) { const v = localStorage.getItem(k); return v === null ? d : v; },
        set(k, v) { localStorage.setItem(k, v); }
    };

    // engine contract helpers ------------------------------------------------
    const client = () => (window.lostcityClient && typeof window.lostcityClient.applyCameraSettings === 'function') ? window.lostcityClient : null;
    const reapply = () => { const c = client(); if (c) { try { c.applyCameraSettings(); } catch (e) { /* ignore */ } } };
    const liveZoom = () => {
        // engine field (only readable in dev/unmangled builds) falls back to the
        // localStorage bus, which the prod client writes on every wheel step
        const c = client();
        const z = c && (c.cameraZoomTarget ?? c.cameraZoom);
        if (typeof z === 'number') return z;
        const v = parseFloat(localStorage.getItem('cameraZoom'));
        return isNaN(v) ? null : v;
    };

    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // mod registry -----------------------------------------------------------
    // kind: 'toggle' writes 'true'/'false'; 'action' fires; 'slider' writes a float
    // desc is the hover tooltip text (and search fodder), not visible subtext
    const MODS = [
        { id: 'wheel-zoom', mod: 'camera', group: 'Camera', name: 'Wheel zoom', desc: 'Scroll the mouse wheel to zoom the camera.', key: 'wheelZoom', kind: 'toggle', def: 'true' },
        { id: 'middle-rotate', mod: 'camera', group: 'Camera', name: 'Middle-drag rotate', desc: 'Hold middle mouse + drag to rotate. Drag follows the mouse (OSRS style).', key: 'middleRotate', kind: 'toggle', def: 'true' },
        { id: 'wheel-scroll-chat', mod: 'camera', group: 'Camera', name: 'Wheel scrolls chat', desc: 'Mouse wheel over the chatbox scrolls history instead of zooming.', key: 'wheelScrollChat', kind: 'toggle', def: 'true' },
        { id: 'zoom', mod: 'camera', group: 'Camera', name: 'Camera zoom', desc: '0.4× close-up to 2.6× wide. Mouse wheel still works in-game.', kind: 'slider', min: 0.4, max: 2.6, step: 0.05, def: '1', get: liveZoom, apply(v) { LS.set('cameraZoom', String(v)); reapply(); } },
        { id: 'canvas-size', mod: 'control-panel', group: 'Display', name: 'Canvas size', desc: 'Render scale of the game canvas (same as the legacy bar).', kind: 'select', key: 'canvasSize', def: '1', options: [['1', '1x'], ['2', '2x'], ['3', '3x'], ['auto', 'Auto']], apply(v) { if (typeof setSize === 'function') setSize(v); } },
        { id: 'canvas-scaling', mod: 'control-panel', group: 'Display', name: 'Pixel scaling', desc: 'Smooth (auto) vs crisp (pixelated) upscaling.', kind: 'select', key: 'filtering', def: 'true', get: () => (LS.get('filtering', 'true') === 'true' ? 'pixelated' : 'auto'), options: [['auto', 'Auto'], ['pixelated', 'Pixelated']], apply(v) { if (typeof setFilter === 'function') setFilter(v); } },
        { id: 'stat-orbs', mod: 'stat-orbs', group: 'Interface', name: 'Stat orbs', desc: 'OSRS-style HP/Prayer/Run orbs down the left of the minimap, numbers always shown.', key: 'statOrbs', kind: 'toggle', def: 'false' },
        { id: 'xp-drops', mod: 'xp-drops', group: 'Interface', name: 'XP drops', desc: 'OSRS-style XP drop rows over the viewport with a level-progress tracker in its top-right corner; auto-hides a few seconds after the last gain.', key: 'xpDrops', kind: 'toggle', def: 'true' },
        { id: 'smooth-shading', mod: 'rendering', group: 'Rendering', name: 'Smooth shading', desc: 'Per-pixel Gouraud instead of 4px blocks. Costs FPS.', key: 'smoothShading', kind: 'toggle', def: 'false' },
        { id: 'gpu', mod: 'gpu', group: 'Rendering', name: 'GPU rendering', desc: 'Draw the 3D world on your graphics card (WebGPU, RuneLite-GPU style). Terrain, walls and models batch to the GPU; chat, interfaces, orbs and walk-clicks stay pixel-exact on the CPU. Falls back to software automatically on any driver error.', kind: 'toggle', def: 'false', key: 'gpu',
          status() {
              if (LS.get('gpu', 'false') !== 'true') return '';
              if (window.lcliteGpuError) return 'off: ' + window.lcliteGpuError;
              const s = window.lcliteGpuStats;
              if (!s || !s.frames) return 'starting…';
              return s.tris + '△ · ' + s.batches + ' calls · ' + s.ms + 'ms';
          } },
        { id: 'anti-cheat', mod: 'anti-cheat', group: 'Compatibility', name: 'Anti-cheat telemetry', desc: 'Send legacy RuneScope mouse/camera/anticheat packets. Harmless to disable on private servers.', key: 'antiCheat', kind: 'toggle', def: 'true' },
        { id: 'legacy-bar', mod: 'control-panel', group: 'Compatibility', name: 'Show legacy control bar', desc: 'The green text row under the canvas. The panel replaces it.', key: 'lcliteLegacyBar', kind: 'toggle', def: 'false', reload: false },
        { id: 'fullscreen', mod: 'control-panel', group: 'Compatibility', name: 'Fullscreen', desc: 'Toggle fullscreen for the game canvas.', kind: 'action', run() {
            if (document.fullscreenElement) document.exitFullscreen();
            else { const el = document.getElementById('canvas'); el && el.requestFullscreen && el.requestFullscreen(); }
        } },
        { id: 'screenshot', mod: 'control-panel', group: 'Compatibility', name: 'Take screenshot', desc: 'Save the current frame as PNG.', kind: 'action', run() {
            const c = document.getElementById('canvas');
            if (!c) return;
            const a = document.createElement('a');
            a.download = 'screenshot-' + Math.floor(Date.now() / 1000) + '.png';
            a.href = c.toDataURL('image/png');
            a.click();
            toast('Screenshot saved');
        } },
        { id: 'hide-controls', mod: 'control-panel', group: 'Display', name: 'Hide page controls', desc: 'Hide the legacy bar countdown-style (F1 still opens this panel).', kind: 'action', run() {
            if (typeof hideControls === 'function') hideControls(); else toast('No legacy bar present');
        } },
        { id: 'reset-all', mod: 'control-panel', group: 'Compatibility', name: 'Reset all lclite settings', desc: 'Clears every toggle/zoom and reloads.', kind: 'action', run() {
            ['wheelZoom','middleRotate','wheelScrollChat','cameraZoom','smoothShading','antiCheat','lcliteLegacyBar'].forEach(k => localStorage.removeItem(k));
            toast('Settings cleared — reloading'); setTimeout(() => location.reload(), 500);
        } }
    ];

    const GROUPS = ['Camera', 'Display', 'Interface', 'Rendering', 'Compatibility'];

    // LCLite mark: a crescent moon in Zanaris blue (the blue of the Lost City
    // quest that gives this project its name) struck by a gold bolt — "lite".
    // Mask-carved so the crescent's inner edge is a perfect arc at any size;
    // unique mask ids because the mark appears in both the FAB and the header.
    let markSeq = 0;
    const MARK = () => {
        const id = 'lcmoon-' + (++markSeq);
        return `<svg class="lclite-mark" viewBox="0 0 24 24" aria-hidden="true"><defs><mask id="${id}"><circle cx="12" cy="12" r="9.6" fill="#fff"/><circle cx="16.7" cy="9.5" r="8.2" fill="#000"/></mask></defs><circle class="mk-moon" cx="12" cy="12" r="9.6" mask="url(#${id})"/><path class="mk-bolt" d="M14.9 5 10.1 12.8h2.6L11.3 19l5.1-8.2h-2.6z"/></svg>`;
    };

    // build DOM ---------------------------------------------------------------
    const root = document.createElement('div');
    root.id = 'lclite-root';
    root.innerHTML = `
        <div id="lclite-toast"></div>
        <div id="lclite-panel" role="dialog" aria-label="Client settings">
            <div class="lcm-head">
                ${MARK()}
                <span class="lcm-title">LCLite</span>
                <span class="lcm-x" id="lcm-close" title="Close (F1)">✕</span>
            </div>
            <div class="lcm-search"><input id="lcm-search" type="search" placeholder="Search settings…" autocomplete="off"></div>
            <div class="lcm-body" id="lcm-body"></div>
        </div>
        <div id="lclite-fab" title="Client settings (F1)">
            ${MARK()}
        </div>
        <div id="lclite-tip" role="tooltip"></div>`;
    document.body.appendChild(root);

    const panel = root.querySelector('#lclite-panel');
    const fab = root.querySelector('#lclite-fab');
    const body = root.querySelector('#lcm-body');
    const searchEl = root.querySelector('#lcm-search');
    const toastEl = root.querySelector('#lclite-toast');
    let toastTimer = 0;

    function toast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
    }

    // hover tooltips -----------------------------------------------------------
    // One shared tooltip node, anchored left of the row (RuneLite-style); flips
    // below the row on narrow viewports. 120ms dwell so sweeping the mouse down
    // the list doesn't flicker every hint.
    const tipEl = root.querySelector('#lclite-tip');
    let tipTimer = 0, tipTarget = null;

    function showTip(el) {
        tipEl.textContent = el.dataset.tip;
        const r = el.getBoundingClientRect();
        const t = tipEl.getBoundingClientRect();
        let top = Math.max(8, Math.min(r.top + r.height / 2 - t.height / 2, innerHeight - t.height - 8));
        let left = r.left - t.width - 10;
        if (left < 8) {                       // no room beside the panel — drop below
            left = Math.max(8, Math.min(r.left, innerWidth - t.width - 8));
            top = Math.min(r.bottom + 6, innerHeight - t.height - 8);
        }
        tipEl.style.left = left + 'px';
        tipEl.style.top = top + 'px';
        tipEl.classList.add('show');
    }
    function hideTip() { clearTimeout(tipTimer); tipTarget = null; tipEl.classList.remove('show'); }

    // listen on document, not root: root itself is pointer-events:none, so moves
    // that leave the panel (onto the page) would otherwise never fire and the
    // tooltip would stick around forever
    document.addEventListener('mousemove', e => {
        const el = e.target.closest ? e.target.closest('[data-tip]') : null;
        const hit = el && root.contains(el) ? el : null;
        if (hit === tipTarget) return;
        clearTimeout(tipTimer);
        if (!hit) { hideTip(); return; }
        tipTarget = hit;
        tipTimer = setTimeout(() => { if (tipTarget === hit) showTip(hit); }, 120);
    });
    document.addEventListener('mouseleave', hideTip);
    window.addEventListener('scroll', hideTip, true);
    window.addEventListener('resize', hideTip);

    function labelHtml(f) {
        const badge = f.id === 'anti-cheat' ? '<span class="lcm-badge">289+</span>' : '';
        return `<div class="lcm-label"><span class="lcm-name" data-tip="${esc(f.desc)}">${esc(f.name)}${badge}</span></div>`;
    }

    function toggleRow(f) {
        const checked = LS.get(f.key, f.def) === 'true';
        const row = document.createElement('div');
        row.className = 'lcm-row';
        row.dataset.name = f.name.toLowerCase() + ' ' + (f.desc || '').toLowerCase();
        row.innerHTML = `
            ${labelHtml(f)}
            <label class="lcm-switch"><input type="checkbox" ${checked ? 'checked' : ''}><span class="lcm-slider"></span></label>`;
        row.querySelector('input').addEventListener('change', e => {
            LS.set(f.key, e.target.checked ? 'true' : 'false');
            reapply();
            if (f.id === 'legacy-bar') applyLegacyBar();
            toast(`${f.name}: ${e.target.checked ? 'on' : 'off'}`);
        });
        // optional live status text (e.g. the GPU row's "N△ · Xms" readout);
        // rides the panel's existing 400ms _sync tick. Degrades silently.
        if (typeof f.status === 'function') {
            const st = document.createElement('span');
            st.className = 'lcm-status';
            row.querySelector('.lcm-label').appendChild(st);
            f._sync = () => {
                const txt = f.status() || '';
                st.textContent = txt;
                st.style.display = txt ? '' : 'none';
            };
            f._sync();
        }
        return row;
    }

    function sliderRow(f) {
        const cur = f.get && f.get() != null ? f.get() : parseFloat(LS.get(f.key, f.def)) || f.def;
        const row = document.createElement('div');
        row.className = 'lcm-zoom';
        row.dataset.name = f.name.toLowerCase() + ' ' + (f.desc || '').toLowerCase();
        row.innerHTML = `
            ${labelHtml(f)}
            <div class="lcm-zrow">
                <input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${cur}">
                <span class="lcm-zval">${Number(cur).toFixed(2)}×</span>
                <button class="lcm-zreset" title="Reset zoom">1×</button>
            </div>`;
        const range = row.querySelector('input'), val = row.querySelector('.lcm-zval');
        const commit = v => { val.textContent = Number(v).toFixed(2) + '×'; f.apply(v); };
        range.addEventListener('input', () => commit(range.value));
        range.addEventListener('change', () => toast(`Camera zoom ${Number(range.value).toFixed(2)}×`));
        row.querySelector('.lcm-zreset').addEventListener('click', () => { range.value = 1; commit(1); toast('Camera zoom reset'); });
        // keep slider synced with in-game wheel zoom
        f._sync = () => { const z = f.get && f.get(); if (z != null && document.activeElement !== range) { range.value = z; val.textContent = Number(z).toFixed(2) + '×'; } };
        return row;
    }

    function selectRow(f) {
        const cur = (f.get && f.get()) || LS.get(f.key, f.def) || f.def;
        const row = document.createElement('div');
        row.className = 'lcm-row';
        row.dataset.name = (f.name + ' ' + (f.desc || '')).toLowerCase();
        const opts = f.options.map(o => `<option value="${o[0]}" ${o[0] === cur ? 'selected' : ''}>${o[1]}</option>`).join('');
        row.innerHTML = `${labelHtml(f)}<select class="lcm-zreset" style="padding:4px 6px">${opts}</select>`;
        row.querySelector('select').addEventListener('change', e => { f.apply(e.target.value); toast(`${f.name}: ${e.target.selectedOptions[0].textContent}`); });
        return row;
    }

    function actionRow(f) {
        const row = document.createElement('div');
        row.className = 'lcm-row';
        row.dataset.name = f.name.toLowerCase() + ' ' + (f.desc || '').toLowerCase();
        row.innerHTML = `${labelHtml(f)}
            <button class="lcm-zreset">Run</button>`;
        row.querySelector('button').addEventListener('click', () => f.run());
        return row;
    }

    function renderRows(installed) {
        // `installed` = Set of mod folder names from /lclite/installed.json, or
        // null (manifest unreadable = pre-selection install): show everything.
        body.innerHTML = '';
        for (const g of GROUPS) {
            const list = MODS.filter(f => f.group === g && (!f.mod || !installed || installed.has(f.mod)));
            if (!list.length) continue;               // every row of this group stripped at install
            const grp = document.createElement('div');
            grp.className = 'lcm-group';
            grp.innerHTML = `<div class="lcm-ghead"><span class="chev">▼</span>${g}</div><div class="lcm-gbody"></div>`;
            grp.querySelector('.lcm-ghead').addEventListener('click', () => grp.classList.toggle('collapsed'));
            const gbody = grp.querySelector('.lcm-gbody');
            for (const f of list) {
                gbody.appendChild(f.kind === 'toggle' ? toggleRow(f) : f.kind === 'slider' ? sliderRow(f) : f.kind === 'select' ? selectRow(f) : actionRow(f));
            }
            body.appendChild(grp);
        }
    }
    renderRows(null);
    // hide controls for mods you unchecked at install time (installer writes the manifest)
    fetch('/lclite/installed.json').then(r => r.ok ? r.json() : null).then(m => {
        if (m && Array.isArray(m.mods)) renderRows(new Set(m.mods));
    }).catch(() => { /* older install: keep every row */ });

    searchEl.addEventListener('input', () => {
        hideTip();
        const q = searchEl.value.trim().toLowerCase();
        body.querySelectorAll('[data-name]').forEach(el => {
            el.classList.toggle('dim', q !== '' && !el.dataset.name.includes(q));
        });
    });

    // open/close ---------------------------------------------------------------
    const open = (v) => {
        panel.classList.toggle('open', v);
        fab.classList.toggle('active', v);
        if (!v) hideTip();
        if (v) { searchEl.value = ''; searchEl.dispatchEvent(new Event('input')); searchEl.focus(); }
    };
    fab.addEventListener('click', () => open(!panel.classList.contains('open')));
    root.querySelector('#lcm-close').addEventListener('click', () => open(false));
    document.addEventListener('keydown', e => {
        if (e.key === 'F1') { e.preventDefault(); open(!panel.classList.contains('open')); }
        if (e.key === 'Escape' && panel.classList.contains('open')) open(false);
        if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName) && !panel.classList.contains('open')) { e.preventDefault(); open(true); searchEl.focus(); }
    });
    document.addEventListener('click', e => {
        if (!root.contains(e.target) && panel.classList.contains('open')) open(false);
    });

    // legacy bar coordination ----------------------------------------------------
    function applyLegacyBar() {
        const legacy = document.getElementById('controls');
        if (!legacy) return;
        const show = LS.get('lcliteLegacyBar', 'false') === 'true';
        legacy.style.display = show ? '' : 'none';
    }
    applyLegacyBar();

    // live sync for sliders (engine wheel changes cameraZoom; keep UI honest)
    setInterval(() => { for (const f of MODS) f._sync && f._sync(); }, 400);

    // expose a tiny API for future mods
    window.lclite = { register(m) { MODS.push(m); }, toast, reapply, client };
})();
