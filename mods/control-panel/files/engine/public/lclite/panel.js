/* lclite control panel — RuneLite-style settings overlay for the Lost City webclient.
 * Speaks to the engine ONLY through the stable contract:
 *   - localStorage keys        (the settings bus; each engine mod reads its OWN key
 *                               at its OWN hook site — no hub)
 *   - window.lostcityClient    (optional; applyCameraSettings() for live re-apply,
 *                               cameraZoomTarget for the zoom slider readout)
 * Degrades gracefully: if the client bundle exposes nothing, toggles still persist and
 * take effect on reload, and the legacy green control bar stays visible.
 *
 * Structure mirrors RuneLite's two surfaces in one popover:
 *   MODS tab     — one row per installed mod: name + description + master switch.
 *                  Clicking the row jumps to its section in Settings.
 *   SETTINGS tab — collapsible section per mod (only mods that HAVE sub-settings;
 *                  single-toggle mods live entirely on the Mods tab, like
 *                  RuneLite mods with no config). Sections start collapsed;
 *                  a jump or header click expands them for the page session.
 * Master switch keys: a single-toggle mod's master IS its own engine key (no new
 * state). Camera is the only multi-setting mod, so its master 'camera' is the one
 * key the engine reads cooperatively (applyCameraSettings zeroes zoom + all cam
 * flags when off).
 *
 * Rows are tagged with their mod folder (`mod:`) and hidden when the installer's
 * manifest (engine/public/lclite/installed.json) says that mod was not selected.
 * The mod list itself is derived from that manifest too; unknown-but-installed
 * mods get a synthesized row so a new mod folder still appears with zero panel
 * edits (it just has no master key until someone adds one).
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
    const cap = s => String(s ?? '').replace(/(^|[-_ ]\w)/g, m => m.toUpperCase()).replace(/[-_]/g, ' ');

    // mod registry ---------------------------------------------------------
    // id = the lclite/mods/<id> folder name (matches installed.json).
    // master: {key, def} — the mod's on/off. null = no engine master (the
    // panel itself). Mods absent from this list but present in the manifest get
    // synthesized entries (name/desc from their settings rows; master only if the
    // mod has exactly ONE toggle row, whose key then doubles as the master).
    const MOD_REGISTRY = [
        { id: 'camera', name: 'Camera', desc: 'Wheel zoom, middle-drag rotate, chat scroll. One of the first mods — it is the only mod with sub-settings.', master: { key: 'camera', def: 'true' } },
        { id: 'gpu', name: 'GPU', desc: 'Draw the 3D world on your graphics card; chat, interfaces, orbs and walk-clicks stay pixel-exact on the CPU. Falls back to software automatically on any driver error.', master: { key: 'gpu', def: 'false' },
          status() {
              if (LS.get('gpu', 'false') !== 'true') return '';
              if (window.lcliteGpuError) return 'off: ' + window.lcliteGpuError;
              const s = window.lcliteGpuStats;
              if (!s || !s.frames) return 'starting…';
              return s.tris + '△ · ' + s.batches + ' calls · ' + s.ms + 'ms';
          } },
        { id: 'xp-drops', name: 'XP drops', desc: 'OSRS-style XP drop rows over the viewport with a level-progress tracker in its top-right corner; auto-hides a few seconds after the last gain.', master: { key: 'xpDrops', def: 'true' } },
        { id: 'stat-orbs', name: 'Stat orbs', desc: 'OSRS-style HP/Prayer/Run orbs down the left of the minimap, numbers always shown.', master: { key: 'statOrbs', def: 'false' } },
        { id: 'true-tile', name: 'True tile', desc: 'Green outline on the tile the server actually has you on, instead of the walk-delayed model position. Click for color, border and fill options.', master: { key: 'trueTile', def: 'true' } },
        { id: 'anti-cheat', name: 'Anti-cheat', desc: 'Send legacy RuneScope mouse/camera/anticheat packets. Harmless to disable on private servers.', master: { key: 'antiCheat', def: 'true' } },
        { id: 'rendering', name: 'Smooth shading', desc: 'Per-pixel Gouraud instead of 4px blocks. Costs FPS.', master: { key: 'smoothShading', def: 'false' } },
        { id: 'control-panel', name: 'LCLite', desc: 'This panel and the page around it: canvas size, scaling, legacy bar, fullscreen, screenshots.', master: null }
    ];

    // settings rows -----------------------------------------------------------
    // kind: 'toggle' writes 'true'/'false'; 'action' fires; 'slider' writes a float
    // desc is the hover tooltip text (and search fodder), not visible subtext
    // NOTE: single-toggle mods (stat-orbs, xp-drops, anti-cheat, rendering, gpu)
    // intentionally have NO row here — their master switch on the Mods tab IS
    // their only setting (RuneLite: no config => no settings panel). true-tile
    // graduated: master trueTile on the Mods tab, plus the look rows below.
    const MODS = [
        { id: 'wheel-zoom', mod: 'camera', name: 'Wheel zoom', desc: 'Scroll the mouse wheel to zoom the camera.', key: 'wheelZoom', kind: 'toggle', def: 'true' },
        { id: 'middle-rotate', mod: 'camera', name: 'Middle-drag rotate', desc: 'Hold middle mouse + drag to rotate. Drag follows the mouse (OSRS style).', key: 'middleRotate', kind: 'toggle', def: 'true' },
        { id: 'wheel-scroll-chat', mod: 'camera', name: 'Wheel scrolls chat', desc: 'Mouse wheel over the chatbox scrolls history instead of zooming.', key: 'wheelScrollChat', kind: 'toggle', def: 'true' },
        { id: 'zoom', mod: 'camera', name: 'Camera zoom', desc: '0.4× close-up to 2.6× wide. Mouse wheel still works in-game.', kind: 'slider', min: 0.4, max: 2.6, step: 0.05, def: '1', unit: '×', get: liveZoom, apply(v) { LS.set('cameraZoom', String(v)); reapply(); } },
        // true-tile settings: the engine re-reads every key each frame, so all of
        // these apply live. Only the master needs no row — the Mods-tab switch is
        // trueTile itself; these are the look of the tile.
        { id: 'true-tile-color', mod: 'true-tile', name: 'Outline color', desc: 'Color of the true-tile border.', kind: 'color', key: 'trueTileColor', def: '#00ff00' },
        { id: 'true-tile-outline', mod: 'true-tile', name: 'Border thickness', desc: 'Width of the true-tile outline, in pixels.', key: 'trueTileOutline', kind: 'slider', min: 1, max: 8, step: 1, def: '1', unit: 'px' },
        { id: 'true-tile-fill', mod: 'true-tile', name: 'Fill opacity', desc: 'Translucent color wash inside the tile (OSRS fill style). 0 = outline only.', key: 'trueTileFill', kind: 'slider', min: 0, max: 100, step: 5, def: '0', unit: '%' },
        { id: 'true-tile-desync', mod: 'true-tile', name: 'Only when out of sync', desc: 'Hide the tile while your model stands on the server tile — pops up only when the tick is visibly delayed.', key: 'trueTileOnlyDesync', kind: 'toggle', def: 'false' },
        { id: 'canvas-size', mod: 'control-panel', name: 'Canvas size', desc: 'Render scale of the game canvas (same as the legacy bar).', kind: 'select', key: 'canvasSize', def: '1', options: [['1', '1x'], ['2', '2x'], ['3', '3x'], ['auto', 'Auto']], apply(v) { if (typeof setSize === 'function') setSize(v); } },
        { id: 'canvas-scaling', mod: 'control-panel', name: 'Pixel scaling', desc: 'Smooth (auto) vs crisp (pixelated) upscaling.', kind: 'select', key: 'filtering', def: 'true', get: () => (LS.get('filtering', 'true') === 'true' ? 'pixelated' : 'auto'), options: [['auto', 'Auto'], ['pixelated', 'Pixelated']], apply(v) { if (typeof setFilter === 'function') setFilter(v); } },
        { id: 'legacy-bar', mod: 'control-panel', name: 'Show legacy control bar', desc: 'The green text row under the canvas. The panel replaces it.', key: 'lcliteLegacyBar', kind: 'toggle', def: 'false', reload: false },
        { id: 'fullscreen', mod: 'control-panel', name: 'Fullscreen', desc: 'Toggle fullscreen for the game canvas.', kind: 'action', run() {
            if (document.fullscreenElement) document.exitFullscreen();
            else { const el = document.getElementById('canvas'); el && el.requestFullscreen && el.requestFullscreen(); }
        } },
        { id: 'screenshot', mod: 'control-panel', name: 'Take screenshot', desc: 'Save the current frame as PNG.', kind: 'action', run() {
            const c = document.getElementById('canvas');
            if (!c) return;
            const a = document.createElement('a');
            a.download = 'screenshot-' + Math.floor(Date.now() / 1000) + '.png';
            a.href = c.toDataURL('image/png');
            a.click();
            toast('Screenshot saved');
        } },
        { id: 'hide-controls', mod: 'control-panel', name: 'Hide page controls', desc: 'Hide the legacy bar countdown-style (F1 still opens this panel).', kind: 'action', run() {
            if (typeof hideControls === 'function') hideControls(); else toast('No legacy bar present');
        } },
        { id: 'reset-all', mod: 'control-panel', name: 'Reset all lclite settings', desc: 'Clears every toggle/zoom and reloads.', kind: 'action', run() {
            ['camera', 'wheelZoom', 'middleRotate', 'wheelScrollChat', 'cameraZoom', 'smoothShading', 'antiCheat', 'gpu', 'statOrbs', 'xpDrops', 'trueTile', 'trueTileColor', 'trueTileOutline', 'trueTileFill', 'trueTileOnlyDesync', 'lcliteLegacyBar'].forEach(k => localStorage.removeItem(k));
            toast('Settings cleared — reloading'); setTimeout(() => location.reload(), 500);
        } }
    ];

    // ---- effective mod list (registry ∪ manifest ∪ rows) ------------------
    // Built once per renderRows(manifest): known registry mods filtered to installed
    // mods first, then synthesized entries for any installed mod folder the
    // registry doesn't know, then rows' own mods as a final safety net so a new
    // TYPE A row never renders into a section that can't exist.
    function buildModList(installed) {
        const rowsOf = m => MODS.filter(f => f.mod === m);
        const list = [];
        for (const p of MOD_REGISTRY) {
            if (installed && !installed.has(p.id) && p.id !== 'control-panel') continue;
            list.push({ ...p, synthesized: false });
        }
        const known = new Set(list.map(p => p.id));
        // manifest-only mods (a folder exists but this panel build predates it)
        if (installed) for (const id of installed) {
            if (known.has(id)) continue;
            list.push(synthesizeMod(id, rowsOf(id)));
            known.add(id);
        }
        // mods referenced by rows but absent from both registry and manifest
        // (manifest unreadable => installed===null: still show every row's mod)
        for (const f of MODS) if (!known.has(f.mod || 'control-panel')) {
            const m = f.mod || 'control-panel';
            list.push(synthesizeMod(m, rowsOf(m)));
            known.add(m);
        }
        return list;
    }
    function synthesizeMod(id, rows) {
        const single = rows.length === 1 && rows[0].kind === 'toggle' ? rows[0] : null;
        return {
            id,
            name: cap(id),
            desc: rows.map(r => r.desc).filter(Boolean).join(' ') || 'Installed mod — no description.',
            master: single ? { key: single.key, def: single.def } : null,
            synthesized: true
        };
    }

    // LCLite mark: a crescent moon in Zanaris blue (the blue of the Lost City
    // quest that gives this project its name) struck by a gold bolt — "lite".
    // Mask-carved so the crescent's inner edge is a perfect arc at any size;
    // unique mask ids because the mark appears in both the FAB and the header.
    let markSeq = 0;
    const MARK = () => {
        const id = 'lcmoon-' + (++markSeq);
        return `<svg class="lclite-mark" viewBox="0 0 24 24" aria-hidden="true"><defs><mask id="${id}"><circle cx="12" cy="12" r="9.6" fill="#fff"/><circle cx="16.7" cy="9.5" r="8.2" fill="#000"/></mask></defs><circle class="mk-moon" cx="12" cy="12" r="9.6" mask="url(#${id})"/><path class="mk-bolt" d="M14.9 5 10.1 12.8h2.6L11.3 19l5.1-8.2h-2.6z"/></svg>`;
    };
    // padlock icons for the pin button (stroke-only so they inherit currentColor)
    const ICON_UNLOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a4 4 0 0 1 7.7-1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="5" y="10" width="12" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
    const ICON_LOCKED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10V8a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="5" y="10" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="14.5" r="1.4" fill="currentColor"/></svg>';

    // build DOM ---------------------------------------------------------------
    const root = document.createElement('div');
    root.id = 'lclite-root';
    root.innerHTML = `
        <div id="lclite-toast"></div>
        <div id="lclite-panel" role="dialog" aria-label="Client settings">
            <div class="lcm-head">
                ${MARK()}
                <span class="lcm-title">LCLite</span>
                <span class="lcm-lock" id="lcm-lock" role="button" tabindex="0" aria-pressed="false"></span>
                <span class="lcm-x" id="lcm-close" title="Close (F1)">✕</span>
            </div>
            <div class="lcm-tabs" role="tablist">
                <button class="lcm-tab" id="lcm-tab-mods" role="tab">Mods</button>
                <button class="lcm-tab" id="lcm-tab-settings" role="tab">Settings</button>
            </div>
            <div class="lcm-search"><input id="lcm-search" type="search" placeholder="Search…" autocomplete="off"></div>
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
    const tabModsEl = root.querySelector('#lcm-tab-mods');
    const tabSettingsEl = root.querySelector('#lcm-tab-settings');
    let toastTimer = 0;
    let currentTab = LS.get('lclitePanelTab', 'mods');
    if (currentTab === 'mods') currentTab = 'mods';   // migrated from old builds
    if (currentTab !== 'mods' && currentTab !== 'settings') currentTab = 'mods';

    function toast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        setTimeout(() => toastEl.classList.remove('show'), 1600);
    }
    const toastEl = root.querySelector('#lclite-toast');

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

    // switch markup shared by mod masters and setting toggles ----------------
    function switchInput(checked) {
        const el = document.createElement('input');
        el.type = 'checkbox';
        el.checked = checked;
        return el;
    }
    function wrapSwitch(input) {
        const label = document.createElement('label');
        label.className = 'lcm-switch';
        label.appendChild(input);
        const span = document.createElement('span');
        span.className = 'lcm-slider';
        label.appendChild(span);
        return label;
    }
    const afterWrite = f => {
        reapply();
        if (f.id === 'legacy-bar') applyLegacyBar();
    };

    // ---- MODS tab ----------------------------------------------------------
    function modRow(p) {
        const row = document.createElement('div');
        row.className = 'lcm-prow';
        row.dataset.mod = p.id;
        row.dataset.name = (p.name + ' ' + p.desc).toLowerCase();
        const badge = p.badge ? `<span class="lcm-badge">${esc(p.badge)}</span>` : '';
        const status = typeof p.status === 'function' ? '<span class="lcm-status" style="display:none"></span>' : '';
        row.innerHTML = `
            <div class="lcm-pmain">
                <div class="lcm-pname">${esc(p.name)}${badge}${status}</div>
                <div class="lcm-pdesc">${esc(p.desc)}</div>
            </div>`;
        const main = row.querySelector('.lcm-pmain');

        if (p.master) {
            const input = switchInput(LS.get(p.master.key, p.master.def) === 'true');
            input.addEventListener('change', () => {
                LS.set(p.master.key, input.checked ? 'true' : 'false');
                afterWrite({ id: 'mod-master-' + p.id });
                toast(`${p.name}: ${input.checked ? 'enabled' : 'disabled'}`);
                renderCurrentTab();          // section visibility can change
            });
            row.appendChild(wrapSwitch(input));
        } else {
            const chip = document.createElement('span');
            chip.className = 'lcm-pcore';
            chip.textContent = 'core';
            chip.title = 'LCLite itself — cannot be switched off from inside the game';
            row.appendChild(chip);
        }

        // RuneLite behaviour: clicking the mod (not its switch) opens its config
        main.addEventListener('click', () => {
            const hasRows = MODS.some(f => f.mod === p.id);
            if (!hasRows) { toast(`${p.name}: this mod has no settings`); return; }
            setTab('settings', p.id);
        });

        if (typeof p.status === 'function') {
            const st = row.querySelector('.lcm-status');
            p._sync = () => {
                const txt = p.status() || '';
                st.textContent = txt;
                st.style.display = txt ? '' : 'none';
            };
            p._sync();
        }
        return row;
    }

    // ---- SETTINGS tab ---------------------------------------------------------
    function labelHtml(f) {
        return `<div class="lcm-label"><span class="lcm-name" data-tip="${esc(f.desc)}">${esc(f.name)}</span></div>`;
    }

    function toggleRow(f) {
        const checked = LS.get(f.key, f.def) === 'true';
        const row = document.createElement('div');
        row.className = 'lcm-row';
        row.dataset.name = f.name.toLowerCase() + ' ' + (f.desc || '').toLowerCase();
        row.innerHTML = `${labelHtml(f)}`;
        const input = switchInput(checked);
        input.addEventListener('change', () => {
            LS.set(f.key, input.checked ? 'true' : 'false');
            afterWrite(f);
            toast(`${f.name}: ${input.checked ? 'on' : 'off'}`);
        });
        row.appendChild(wrapSwitch(input));
        // optional live status text (e.g. a readout) rides the panel's _sync tick
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
        const unit = f.unit || '';
        const fmt = v => (f.step >= 1 ? String(Math.round(Number(v))) : Number(v).toFixed(2)) + unit;
        const row = document.createElement('div');
        row.className = 'lcm-zoom';
        row.dataset.name = f.name.toLowerCase() + ' ' + (f.desc || '').toLowerCase();
        row.innerHTML = `
            ${labelHtml(f)}
            <div class="lcm-zrow">
                <input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${cur}">
                <span class="lcm-zval">${fmt(cur)}</span>
                <button class="lcm-zreset" title="Reset">reset</button>
            </div>`;
        const range = row.querySelector('input'), val = row.querySelector('.lcm-zval');
        // default behaviour: sliders with a `key` write it to the settings bus
        // (true-tile px/% values are plain integers — the engine re-reads per
        // frame so no reapply is even needed; call it anyway, it's a cheap wake)
        const write = typeof f.apply === 'function' ? f.apply : (v => { if (f.key) { LS.set(f.key, String(Math.round(v))); reapply(); } });
        const commit = v => { val.textContent = fmt(v); write(v); };
        range.addEventListener('input', () => commit(range.value));
        range.addEventListener('change', () => toast(`${f.name} ${fmt(range.value)}`));
        row.querySelector('.lcm-zreset').addEventListener('click', () => { range.value = f.def; commit(f.def); toast(`${f.name} reset`); });
        // keep slider synced with live engine state (camera wheel writes cameraZoom)
        f._sync = () => { const z = f.get && f.get(); if (z != null && document.activeElement !== range) { range.value = z; val.textContent = fmt(z); } };
        return row;
    }

    // color row: swatch input + hex readout; writes '#rrggbb' like RuneLite's colors
    function colorRow(f) {
        const cur = LS.get(f.key, f.def);
        const row = document.createElement('div');
        row.className = 'lcm-row';
        row.dataset.name = f.name.toLowerCase() + ' ' + (f.desc || '').toLowerCase();
        row.innerHTML = `${labelHtml(f)}
            <input type="color" class="lcm-color" value="${esc(cur)}">
            <span class="lcm-hex">${esc(cur)}</span>`;
        const inp = row.querySelector('input'), hex = row.querySelector('.lcm-hex');
        inp.addEventListener('input', () => { LS.set(f.key, inp.value); hex.textContent = inp.value; reapply(); });
        inp.addEventListener('change', () => toast(`${f.name}: ${inp.value}`));
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

    function settingsSection(p, collapsed) {
        const list = MODS.filter(f => f.mod === p.id);
        const grp = document.createElement('div');
        grp.className = 'lcm-group' + (collapsed ? ' collapsed' : '');
        grp.dataset.section = p.id;
        const masterOn = !p.master || LS.get(p.master.key, p.master.def) === 'true';
        if (!masterOn) grp.classList.add('plugoff');
        grp.innerHTML = `<div class="lcm-ghead"><span class="chev">▼</span><span class="lcm-gname">${esc(p.name)}</span></div><div class="lcm-gbody"></div>`;
        const head = grp.querySelector('.lcm-ghead');
        head.addEventListener('click', e => {
            if (e.target.closest('.lcm-switch')) return;   // the master owns the switch
            // classList.toggle returns true when the class IS now applied
            if (head.parentElement.classList.toggle('collapsed')) expandedSections.delete(p.id);
            else expandedSections.add(p.id);
        });

        if (p.master && p.id === 'camera') {
            // only camera has sub-settings, so its master rides the section header
            const input = switchInput(LS.get(p.master.key, p.master.def) === 'true');
            input.addEventListener('change', () => {
                LS.set(p.master.key, input.checked ? 'true' : 'false');
                afterWrite({ id: 'mod-master-' + p.id });
                toast(`${p.name}: ${input.checked ? 'enabled' : 'disabled'}`);
                renderCurrentTab();
            });
            head.appendChild(wrapSwitch(input));
        }

        const gbody = grp.querySelector('.lcm-gbody');
        if (!masterOn) {
            const off = document.createElement('div');
            off.className = 'lcm-offnote';
            off.textContent = 'Mod disabled — enable it to change these settings.';
            gbody.appendChild(off);
        } else {
            for (const f of list) {
                gbody.appendChild(f.kind === 'toggle' ? toggleRow(f) : f.kind === 'slider' ? sliderRow(f) : f.kind === 'select' ? selectRow(f) : f.kind === 'color' ? colorRow(f) : actionRow(f));
            }
        }
        return { grp, count: masterOn ? list.length : 0 };
    }

    // ---- tab rendering ---------------------------------------------------------
    let modsList = [];   // rebuilt by renderRows(manifest)
    // Settings sections start COLLAPSED (the Mods tab is the entry point). An
    // expansion — from clicking a mod row, clicking a section header, or from
    // typing a search that hits it — is remembered only for this page session
    // (never persisted): reload/reopen starts clean, like RuneLite's accordion.
    const expandedSections = new Set();

    function renderModsTab() {
        body.innerHTML = '';
        for (const p of modsList) body.appendChild(modRow(p));
    }

    function renderSettingsTab() {
        body.innerHTML = '';
        for (const p of modsList) {
            const rows = MODS.filter(f => f.mod === p.id);
            if (!rows.length) continue;   // RuneLite: no config => no section
            const { grp } = settingsSection(p, !expandedSections.has(p.id));
            body.appendChild(grp);
        }
    }

    function renderCurrentTab() {
        const isP = currentTab === 'mods';
        tabModsEl.classList.toggle('active', isP);
        tabSettingsEl.classList.toggle('active', !isP);
        if (isP) renderModsTab(); else renderSettingsTab();
        applySearch();
    }

    function setTab(tab, focusMod) {
        currentTab = tab;
        LS.set('lclitePanelTab', tab);
        if (focusMod) expandedSections.add(focusMod);   // survives re-renders this session
        renderCurrentTab();
        if (focusMod) {
            const sec = body.querySelector(`[data-section="${focusMod}"]`);
            if (sec) {
                sec.scrollIntoView({ block: 'nearest' });
                sec.classList.add('flash');
                setTimeout(() => sec.classList.remove('flash'), 900);
            }
        }
    }
    tabModsEl.addEventListener('click', () => setTab('mods'));
    tabSettingsEl.addEventListener('click', () => setTab('settings'));

    // header-click expansion is recorded by the section's own toggle handler
    // (no deferred bookkeeping — it must be synchronous so tab switches and
    // master-switch re-renders see the current state)

    // search filters whichever tab is showing; mods-tab sections are flat so a
    // query also expands collapsed settings sections that would otherwise hide hits
    function applySearch() {
        const q = searchEl.value.trim().toLowerCase();
        hideTip();
        if (currentTab === 'settings' && q) {
            body.querySelectorAll('.lcm-group.collapsed').forEach(g => {
                const hit = [...g.querySelectorAll('[data-name]')].some(r => r.dataset.name.includes(q));
                if (hit) g.classList.remove('collapsed'), g.dataset.auto = '1';
            });
        } else {
            body.querySelectorAll('.lcm-group[data-auto]').forEach(g => { g.classList.add('collapsed'); delete g.dataset.auto; });
        }
        body.querySelectorAll('[data-name]').forEach(el => {
            el.classList.toggle('dim', q !== '' && !el.dataset.name.includes(q));
        });
        // groups with zero visible rows disappear entirely while searching
        body.querySelectorAll('.lcm-group').forEach(g => {
            const any = [...g.querySelectorAll('[data-name]')].some(r => !r.classList.contains('dim'));
            g.classList.toggle('hideresult', q !== '' && !any);
        });
    }
    searchEl.addEventListener('input', applySearch);

    function renderRows(installed) {
        // `installed` = Set of mod folder names from /lclite/installed.json, or
        // null (manifest unreadable = pre-selection install): show everything.
        modsList = buildModList(installed);
        renderCurrentTab();
    }
    renderRows(null);
    // hide controls for mods you unchecked at install time (installer writes the manifest)
    fetch('/lclite/installed.json').then(r => r.ok ? r.json() : null).then(m => {
        if (m && Array.isArray(m.mods)) renderRows(new Set(m.mods));
    }).catch(() => { /* older install: keep every row */ });

    // open/close ---------------------------------------------------------------
    const open = (v) => {
        panel.classList.toggle('open', v);
        fab.classList.toggle('active', v);
        if (!v) hideTip();
        if (v) { searchEl.value = ''; renderCurrentTab(); searchEl.focus(); }
    };
    fab.addEventListener('click', () => open(!panel.classList.contains('open')));
    root.querySelector('#lcm-close').addEventListener('click', () => open(false));
    document.addEventListener('keydown', e => {
        if (e.key === 'F1') { e.preventDefault(); open(!panel.classList.contains('open')); }
        if (e.key === 'Escape' && panel.classList.contains('open')) open(false);
        if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName) && !panel.classList.contains('open')) { e.preventDefault(); open(true); searchEl.focus(); }
    });
    document.addEventListener('click', e => {
        if (!root.contains(e.target) && panel.classList.contains('open') && !pinned) open(false);
    });
    // stop clicks at the root host: a mod-row click re-renders the body, which
    // detaches the click target mid-bubble — the outside-click check above would
    // then see root.contains(target)=false and close the panel (the "jump closes
    // it" bug). Same protection for master switches, which re-render too.
    root.addEventListener('click', e => e.stopPropagation());

    // pin (lock) — keep the panel open through in-game clicks ------------------
    let pinned = LS.get('lclitePanelPinned', 'false') === 'true';
    const lockEl = root.querySelector('#lcm-lock');
    function renderLock() {
        lockEl.classList.toggle('active', pinned);
        lockEl.innerHTML = pinned ? ICON_LOCKED : ICON_UNLOCK;
        lockEl.title = pinned ? 'Panel pinned — stays open through game clicks (click to unpin)' : "Pin panel open (F1/outside-click won't close it)";
        lockEl.setAttribute('aria-pressed', String(pinned));
    }
    lockEl.addEventListener('click', () => {
        pinned = !pinned;
        LS.set('lclitePanelPinned', pinned ? 'true' : 'false');
        renderLock();
        toast(pinned ? 'Panel pinned open' : 'Panel unpinned');
    });
    renderLock();

    // legacy bar coordination ----------------------------------------------------
    function applyLegacyBar() {
        const legacy = document.getElementById('controls');
        if (!legacy) return;
        const show = LS.get('lcliteLegacyBar', 'false') === 'true';
        legacy.style.display = show ? '' : 'none';
    }
    applyLegacyBar();

    // live sync for sliders + mod status lines (engine wheel changes
    // cameraZoom; gpu stats tick over) — keep UI honest
    setInterval(() => {
        for (const f of MODS) f._sync && f._sync();
        for (const p of MOD_REGISTRY) p._sync && p._sync();
    }, 400);

    // expose a tiny API for future mods
    window.lclite = { register(m) { MODS.push(m); renderCurrentTab(); }, toast, reapply, client };
})();
