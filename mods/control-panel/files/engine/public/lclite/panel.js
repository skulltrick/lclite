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
 *   MODS tab     — one row per installed mod: favorite star + name + description
 *                  + gear (jumps to its Settings section) + master switch.
 *                  Favorited mods sort to the top of the list; the rest are
 *                  alphabetical by name.
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
    // canvas scale readout: canvasSize is THE key the page reads ('auto' or a decimal);
    // while it is 'auto' the slider shows the last FIXED scale we remember (canvasScale).
    const liveScale = () => {
        const size = localStorage.getItem('canvasSize');
        if (size && size !== 'auto') { const v = parseFloat(size); if (!isNaN(v)) return v; }
        const last = parseFloat(localStorage.getItem('canvasScale'));
        return isNaN(last) ? 1 : last;
    };

    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const cap = s => String(s ?? '').replace(/(^|[-_ ]\w)/g, m => m.toUpperCase()).replace(/[-_]/g, ' ');

    // mod registry ---------------------------------------------------------
    // id = the lclite/mods/<id> folder name (matches installed.json).
    // master: {key, def} — the mod's on/off. master.invert: the row's switch is
    // a DISABLE control (checked = engine key 'false', e.g. "Disable anti-cheat").
    // null = no engine master (the panel itself). Mods absent from this list but
    // present in the manifest get
    // synthesized entries (name/desc from their settings rows; master only if the
    // mod has exactly ONE toggle row, whose key then doubles as the master).
    const MOD_REGISTRY = [
        { id: 'camera', name: 'Camera', desc: 'Wheel zoom, middle-drag rotate, chat scroll.', master: { key: 'camera', def: 'true' } },
        { id: 'gpu', name: 'GPU', desc: 'Uses your GPU; chat, interfaces, orbs and walk-clicks stay pixel-exact on the CPU.', master: { key: 'gpu', def: 'false' },
          status() {
              if (LS.get('gpu', 'false') !== 'true') return '';
              if (window.lcliteGpuError) return 'off: ' + window.lcliteGpuError;
              const s = window.lcliteGpuStats;
              if (!s || !s.frames) return 'starting…';
              return s.tris + '△ · ' + s.batches + ' calls · ' + s.ms + 'ms';
          } },
        { id: 'xp-drops', name: 'XP drops', desc: 'Customizable XP drops.', master: { key: 'xpDrops', def: 'true' } },
        { id: 'stat-orbs', name: 'Stat orbs', desc: 'HP/Prayer/Run/etc orbs by the minimap.', master: { key: 'statOrbs', def: 'false' } },
        { id: 'true-tile', name: 'True tile', desc: "Highlights player's true server tile. Customizable.", master: { key: 'trueTile', def: 'true' } },
        { id: 'tcg', name: 'TCG', desc: 'Left click opens pack, right click opens album. 1k exp = 100 credits, level ups = 1k-25k credits, kills = 1 credit per cb lvl.', master: { key: 'tcg', def: 'true' },
          status() {
              if (LS.get('tcg', 'true') !== 'true') return '';
              if (typeof window.tcgInfo !== 'function') return 'core not loaded';
              const i = window.tcgInfo();   // positional contract (see tcg_core.ts)
              return '◈ ' + i[0].toLocaleString('en-US') + ' · ' + i[11] + ' cards · ' + i[16] + ' kills';
          } },
        // inverted row: the switch is labelled DISABLE — checked means packets OFF,
        // so it mirrors the antiCheat engine key (checked ⇔ LS 'false').
        { id: 'anti-cheat', name: 'Disable anti-cheat', desc: 'Disables the client sending legacy mouse/camera/anticheat packets.', master: { key: 'antiCheat', def: 'true', invert: true } },
        { id: 'rendering', name: 'Smooth shading', desc: 'Per-pixel Gouraud instead of 4px blocks. Costs FPS.', master: { key: 'smoothShading', def: 'false' } },
        { id: 'hide-roofs', name: 'Hide roofs', desc: 'Removes roofs everywhere, not only while you stand under them. Off: the game hides them itself as you walk in.', master: { key: 'hideRoofs', def: 'false' } },
        { id: 'low-detail', name: 'Low detail', desc: 'Untextured ground applies instantly; ground decorations and half-size textures need a client refresh (F5).', master: { key: 'lowDetail', def: 'false' } },
        { id: 'shift-drop', name: 'Shift-click drop', desc: 'Hold Shift and left-click an item to drop it straight away, skipping the menu.', master: { key: 'shiftDrop', def: 'true' } },
        { id: 'hotkeys', name: 'Hotkeys', desc: 'F-key sidebar tabs, Esc closes interfaces, WASD camera with press-enter-to-chat.', master: { key: 'hotkeys', def: 'true' } },
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
        // canvas sizing: a real scale slider (the old 1x/2x/3x dropdown was the whole
        // range) plus a Fit toggle for the old "Auto". Both go through setSize(), which
        // writes canvasSize (the key the page reads) and remembers the fixed scale in
        // canvasScale, so the legacy bar's dropdown and this panel always agree.
        { id: 'canvas-scale', mod: 'control-panel', name: 'Canvas scale', desc: 'Any size from 0.5x to 4x, not just 1x/2x/3x. The legacy bar follows along.', kind: 'slider', min: 0.5, max: 4, step: 0.05, def: '1', unit: '×', get: liveScale, apply(v) { if (typeof setSize === 'function') setSize(String(v)); } },
        { id: 'canvas-autofit', mod: 'control-panel', name: 'Fit to window', desc: 'Overrides the scale slider and sizes the canvas to the window (the old Auto).', key: 'canvasAutoFit', kind: 'toggle', def: 'false', get: () => LS.get('canvasSize', '1') === 'auto', apply(on) { if (typeof setSize === 'function') setSize(on ? 'auto' : LS.get('canvasScale', '1')); } },
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
        { id: 'reset-all', mod: 'control-panel', name: 'Reset all lclite settings', desc: 'Clears every toggle/zoom/placement and reloads.', kind: 'action', run() {
            ['camera', 'wheelZoom', 'middleRotate', 'wheelScrollChat', 'cameraZoom', 'smoothShading', 'antiCheat', 'gpu', 'statOrbs', 'xpDrops', 'trueTile', 'trueTileColor', 'trueTileOutline', 'trueTileFill', 'trueTileOnlyDesync', 'lcliteLegacyBar', 'tcg', 'lclitePanelTab', 'lclitePanelPinned',
                'canvasSize', 'canvasScale', 'canvasAutoFit', 'filtering', 'hideRoofs', 'lowDetail', 'shiftDrop'].forEach(k => localStorage.removeItem(k));
            // hotkeys: wiped by prefix so every current AND future keybind resets too
            Object.keys(localStorage).filter(k => k.indexOf('hotkeys') === 0).forEach(k => localStorage.removeItem(k));
            // placement keys are namespaced lcm* (drag layer + owners): wipe by
            // prefix so every current AND future movable surface resets too
            Object.keys(localStorage).filter(k => k.startsWith('lcm')).forEach(k => localStorage.removeItem(k));
            toast('Settings cleared — reloading'); setTimeout(() => location.reload(), 500);
        } }
    ];

    // ---- Hotkeys (mods/hotkeys) ---------------------------------------------
    // Keybinds: F-key sidebar tabs, Esc closes interfaces, WASD camera. The key list
    // mirrors HOTKEYS_KEY_CHOICES and the defaults mirror HOTKEYS_TAB_DEFAULTS /
    // HOTKEYS_CAM_DEFAULTS in the engine core (webclient/src/client/Hotkeys.ts) — a
    // page script cannot import TS, so the lists are kept in step by hand.
    const HK_KEYS = ['None', 'Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
        'Tab', 'Home', 'End', 'PgUp', 'PgDn', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=',
        ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
    const hkOptions = HK_KEYS.map(k => [k, k]);
    const hkSelect = (id, name, desc, key, def) => ({ id, mod: 'hotkeys', name, desc, key, kind: 'select', def, options: hkOptions, apply(v) { LS.set(key, v); reapply(); } });
    // [row label, localStorage suffix, OSRS default] — order = HOTKEYS_TABS (tab slot order)
    const HK_TABS = [
        ['Combat', 'Combat', 'F1'], ['Skills', 'Skills', 'F2'], ['Quests', 'Quests', 'F3'], ['Inventory', 'Inventory', 'Esc'],
        ['Worn equipment', 'Worn', 'F4'], ['Prayer', 'Prayer', 'F5'], ['Spellbook', 'Magic', 'F6'],
        ['Friends', 'Friends', 'F8'], ['Ignore', 'Ignore', 'None'], ['Logout', 'Logout', 'F9'],
        ['Game options', 'Options', 'F10'], ['Player controls', 'Controls', 'None'], ['Music', 'Music', 'None']
    ];
    MODS.push(
        { id: 'hk-fkeys', mod: 'hotkeys', name: 'F-key tabs', desc: 'Bound keys open sidebar tabs. A bound letter is claimed from the chatbox unless "Press enter to chat" is on.', key: 'hotkeysFkeys', kind: 'toggle', def: 'true' },
        { id: 'hk-esc', mod: 'hotkeys', name: 'Esc closes interfaces', desc: 'Esc closes the open interface (bank, shop, dialogue) instead of only switching to the Inventory tab.', key: 'hotkeysEscClose', kind: 'toggle', def: 'true' },
        { id: 'hk-wasd', mod: 'hotkeys', name: 'WASD camera', desc: 'W/A/S/D rotate and pitch the camera, exactly like the arrow keys. Off by default.', key: 'hotkeysWasd', kind: 'toggle', def: 'false' },
        { id: 'hk-lock', mod: 'hotkeys', name: 'Press enter to chat', desc: 'The chatbox stays locked ("Press Enter to Chat...") so W/A/S/D cannot type into it; Enter opens it. Only applies while WASD camera is on.', key: 'hotkeysChatLock', kind: 'toggle', def: 'true' }
    );
    for (const [label, suffix, def] of HK_TABS) {
        MODS.push(hkSelect('hk-tab-' + suffix, label + ' tab', 'Key that opens the ' + label + ' sidebar tab.', 'hotkeysKey' + suffix, def));
    }
    MODS.push(
        hkSelect('hk-cam-up', 'Camera up', 'Key that raises the camera pitch.', 'hotkeysKeyCamUp', 'W'),
        hkSelect('hk-cam-down', 'Camera down', 'Key that lowers the camera pitch.', 'hotkeysKeyCamDown', 'S'),
        hkSelect('hk-cam-left', 'Camera left', 'Key that rotates the camera left.', 'hotkeysKeyCamLeft', 'A'),
        hkSelect('hk-cam-right', 'Camera right', 'Key that rotates the camera right.', 'hotkeysKeyCamRight', 'D')
    );

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
        // favorites first, then alphabetical by display name (Array.sort stable)
        return list.sort(favCmp);
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

    // mod-row icons: favorite star (fill rides the .on class) + settings gear
    const ICON_STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.6 9.3l6.5-.9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    const ICON_GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

    // favorites: panel-owned display state (lcm* prefix ⇒ Reset-all wipes it too)
    const FAVS = new Set(String(LS.get('lcmFavMods', '')).split(',').filter(Boolean));
    const saveFavs = () => LS.set('lcmFavMods', [...FAVS].join(','));
    // favorites first; the rest alphabetical by name (case-insensitive —
    // 'Disable anti-cheat' sorts under D, 'GPU' under G, 'XP drops' last)
    const favCmp = (a, b) =>
        (FAVS.has(b.id) ? 1 : 0) - (FAVS.has(a.id) ? 1 : 0) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

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
        const hasRows = MODS.some(f => f.mod === p.id);
        row.innerHTML = `
            <button class="lcm-fav${FAVS.has(p.id) ? ' on' : ''}" type="button" title="${FAVS.has(p.id) ? 'Unfavorite (back to default order)' : 'Favorite (pin to top of the list)'}" aria-pressed="${FAVS.has(p.id)}">${ICON_STAR}</button>
            <div class="lcm-pmain">
                <div class="lcm-pname">${esc(p.name)}${badge}${status}</div>
                <div class="lcm-pdesc">${esc(p.desc)}</div>
            </div>
            ${hasRows ? `<button class="lcm-gear" type="button" title="Open ${esc(p.name)} settings">${ICON_GEAR}</button>` : ''}`;
        const main = row.querySelector('.lcm-pmain');

        row.querySelector('.lcm-fav').addEventListener('click', () => {
            if (FAVS.has(p.id)) FAVS.delete(p.id); else FAVS.add(p.id);
            saveFavs();
            toast(FAVS.has(p.id) ? `${p.name}: favorited` : `${p.name}: unfavorited`);
            // rebuild, not in-place sort: an unfavorited mod must drop back into
            // its alphabetical slot, which a stable sort over the already-sorted
            // list can't do
            modsList = buildModList(installedSet);
            renderCurrentTab();              // both tabs share the order
        });
        const gear = row.querySelector('.lcm-gear');
        if (gear) gear.addEventListener('click', () => setTab('settings', p.id));

        if (p.master) {
            const inv = !!p.master.invert;
            const input = switchInput((LS.get(p.master.key, p.master.def) === 'true') !== inv);
            input.addEventListener('change', () => {
                LS.set(p.master.key, (input.checked !== inv) ? 'true' : 'false');
                afterWrite({ id: 'mod-master-' + p.id });
                toast(inv ? `${p.name}: ${input.checked ? 'on' : 'off'}` : `${p.name}: ${input.checked ? 'enabled' : 'disabled'}`);
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
        // optional get(): a toggle whose REAL state lives elsewhere (canvasAutoFit is
        // really "canvasSize === 'auto'"). Optional apply() runs after the write for
        // toggles that have to poke the page (setSize), not just the settings bus.
        const checked = typeof f.get === 'function' ? !!f.get() : (LS.get(f.key, f.def) === 'true');
        const row = document.createElement('div');
        row.className = 'lcm-row';
        row.dataset.name = f.name.toLowerCase() + ' ' + (f.desc || '').toLowerCase();
        row.innerHTML = `${labelHtml(f)}`;
        const input = switchInput(checked);
        input.addEventListener('change', () => {
            LS.set(f.key, input.checked ? 'true' : 'false');
            if (typeof f.apply === 'function') { try { f.apply(input.checked); } catch (e) { /* keep the panel alive */ } }
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
            // camera's master gates a whole settings tree (zoom/rotate/chat rows),
            // so it also rides the section header; other mods' masters live only
            // on their Mods-tab row (true-tile/control-panel sections read it via
            // the plugoff note instead)
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
    let installedSet = null;   // last manifest seen (rebuild target for favorite re-sorts)
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
        installedSet = installed;
        modsList = buildModList(installed);
        renderCurrentTab();
    }
    renderRows(null);
    // hide controls for mods you unchecked at install time (installer writes the manifest)
    // no-cache: a stale disk copy of installed.json would silently GHOST a fully
    // working mod from the list (Brave trap, same family as the ui.js?v= lesson)
    fetch('/lclite/installed.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(m => {
        if (m && Array.isArray(m.mods)) renderRows(new Set(m.mods));
    }).catch(() => { /* older install: keep every row */ });

    // open/close ---------------------------------------------------------------
    const open = (v) => {
        panel.classList.toggle('open', v);
        fab.classList.toggle('active', v);
        if (!v) hideTip();
        if (v) { searchEl.value = ''; renderCurrentTab(); searchEl.focus(); layoutPanel(); }
    };
    fab.addEventListener('click', () => {
        if (performance.now() < suppressClick) return;   // drag-release echo
        open(!panel.classList.contains('open'));
    });
    root.querySelector('#lcm-close').addEventListener('click', () => open(false));
    // The Hotkeys mod (mods/hotkeys) binds keys to sidebar tabs, F1 included. While it
    // does AND the game canvas holds the keyboard, that key belongs to the game — the
    // FAB still opens this panel. Only the mod's own rows are read; nothing else is.
    const hotkeysBinding = keyName => {
        if (LS.get('hotkeys', 'true') !== 'true') return false;
        if (LS.get('hotkeysFkeys', 'true') !== 'true') return false;   // tab keys off ⇒ F1 is the panel's again
        return MODS.some(f => f.mod === 'hotkeys' && String(f.id).indexOf('hk-tab-') === 0 && LS.get(f.key, f.def) === keyName);
    };
    document.addEventListener('keydown', e => {
        if (e.key === 'F1') {
            if (hotkeysBinding('F1') && document.activeElement === document.getElementById('canvas')) return;   // the game owns it
            e.preventDefault(); open(!panel.classList.contains('open'));
        }
        if (e.key === 'Escape' && panel.classList.contains('open')) open(false);
        if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName) && !panel.classList.contains('open')) { e.preventDefault(); open(true); searchEl.focus(); }
    });
    document.addEventListener('click', e => {
        if (performance.now() < suppressClick) return;   // release lands after this listener: swallow the drag-echo click too
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

    // ---- alt-drag placement (RuneLite movable overlays) ---------------------
    // Contract: the DRAG LAYER is the only writer of anchor keys; each surface's
    // OWNER mod reads its own keys at its own hook (rule 5 intact — placement is
    // settings-with-a-UI, not a settings hub). Surfaces register via
    // window.lcmAnchor.register({id, el, anchorKey, offsetKey, defA, defO});
    // a mod that loads without the panel simply has no writer and keeps its
    // default spot. Anchor = one of 9 points on the GAME CANVAS rect + a px
    // offset to the element's top-left, always clamped inside the rect, so a
    // dragged overlay can never be lost off-screen. Alt+drag moves, Alt+right-
    // click resets, Escape cancels — same gestures as RuneLite.
    const ANCH = { TL: [0, 0], TC: [.5, 0], TR: [1, 0], ML: [0, .5], MC: [.5, .5], MR: [1, .5], BL: [0, 1], BC: [.5, 1], BR: [1, 1] };
    const SPECS = [];
    const SNAP_HIT = 34;          // px from an anchor point that snaps to it
    let suppressClick = 0;        // ts until which a surface click is drag-echo

    function gameRect() {
        // RuneLite parity: DOM surfaces anchor to the WHOLE client window (the
        // browser viewport) — the black letterbox around the scaled canvas is
        // valid real estate (that's where the FAB lives by default). Canvas-
        // drawn surfaces are limited by the game buffer itself; see vpRect().
        return { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight };
    }
    function placeXY(el, x, y) {
        el.style.left = Math.round(x) + 'px';
        el.style.top = Math.round(y) + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
    }
    function clampInto(r, x, y, w, h) {
        return [
            w + 8 < r.width ? Math.max(r.left + 4, Math.min(x, r.left + r.width - w - 4)) : x,
            h + 8 < r.height ? Math.max(r.top + 4, Math.min(y, r.top + r.height - h - 4)) : y
        ];
    }
    function specPos(spec, rect) {
        const a = LS.get(spec.anchorKey, '') || spec.defA;
        const o = String(LS.get(spec.offsetKey, '') || spec.defO).split(',');
        const k = ANCH[a] || ANCH[spec.defA] || ANCH.TR;
        const r = rect || gameRect();
        const w = spec.el.offsetWidth || 44, h = spec.el.offsetHeight || 44;
        const [x, y] = clampInto(r, r.left + r.width * k[0] + (parseFloat(o[0]) || 0),
            r.top + r.height * k[1] + (parseFloat(o[1]) || 0), w, h);
        return { x, y, w, h, a };
    }
    function touched(spec) {
        return localStorage.getItem(spec.anchorKey) !== null || localStorage.getItem(spec.offsetKey) !== null;
    }
    function applySpec(spec) {
        if (spec.canvas) { return; }            // canvas surfaces have no DOM box — the OWNER draws them from the same keys (live while held)
        if (spec.owner) { return; }             // the OWNER mod positions this one (reads its own keys per rule 5); the panel only drag-tests + resets
        if (!touched(spec)) {
            if (spec.el === fab) { fab.style.left = fab.style.top = fab.style.right = fab.style.bottom = ''; }
            return;                             // pristine default: CSS (fab) / owner's own calc
        }
        const p = specPos(spec);
        placeXY(spec.el, p.x, p.y);
    }
    function layoutAll() { for (const s of SPECS) applySpec(s); layoutPanel(); }
    // The settings panel follows its FAB handle (drop down from it, up if the
    // FAB lives low; side-aligned to whichever half of the screen it sits in).
    function layoutPanel() {
        if (!touched(fabSpec)) {
            panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = '';
            return;
        }
        const f = fab.getBoundingClientRect();
        const pw = panel.offsetWidth || 420, ph = panel.offsetHeight || 320;
        let left = (f.left + f.width / 2 > innerWidth / 2) ? f.right - pw : f.left;
        left = Math.max(8, Math.min(left, innerWidth - pw - 8));
        let top = f.bottom + 8;
        if (top + ph > innerHeight - 8) top = Math.max(8, f.top - ph - 8);
        panel.style.left = Math.round(left) + 'px';
        panel.style.top = Math.round(top) + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    }

    window.lcmAnchor = {
        register(s) {
            const i = SPECS.findIndex(x => x.id === s.id);
            s.el.setAttribute('data-lcm-surface', s.id);
            if (i >= 0) SPECS[i] = s; else SPECS.push(s);   // replace-on-id: ui.js self-heal re-registers a NEW element
            applySpec(s);
            return true;
        },
        // canvas-buffer surfaces (xp tracker): registered BY THE OWNER from the
        // bundle with a POSITIONAL array (terser mangles object-literal keys —
        // same boundary law as tcg's info()). No element: the drag layer shows
        // a ghost box sized by the owner's getBounds() (positional [x,y,w,h] in
        // logical canvas units, 765x503 space) and persists anchor/offset in
        // those same logical units; the owner re-reads its own keys per frame.
        registerCanvas(a) {
            const s = { id: a[0], el: null, canvas: true, anchorKey: a[1], offsetKey: a[2], defA: a[3], defO: a[4], getBounds: a[5] };
            const i = SPECS.findIndex(x => x.id === s.id);
            if (i >= 0) SPECS[i] = s; else SPECS.push(s);
            return true;
        }
    };
    const fabSpec = { id: 'fab', el: fab, anchorKey: 'lcmFabAnchor', offsetKey: 'lcmFabOffset', defA: 'TR', defO: '-62,14' };
    window.lcmAnchor.register(fabSpec);   // NOT a bare push: register stamps data-lcm-surface (drag hit-test + alt-outline)

    // snap markers layer (body child: z 9700 rides above #lctcg-root's 9600)
    let snapLayer = null;
    function showDots(r, on) {
        if (!snapLayer && on) {
            snapLayer = document.createElement('div');
            snapLayer.id = 'lcm-snap';
            for (const name in ANCH) {
                const d = document.createElement('div');
                d.className = 'lcm-dot';
                d.dataset.anch = name;
                snapLayer.appendChild(d);
            }
            document.body.appendChild(snapLayer);
        }
        if (!snapLayer) return;
        snapLayer.classList.toggle('on', !!on);
        if (on) [...snapLayer.children].forEach(d => {
            const k = ANCH[d.dataset.anch];
            d.style.left = Math.round(r.left + r.width * k[0]) + 'px';
            d.style.top = Math.round(r.top + r.height * k[1]) + 'px';
        });
    }
    // The GAME VIEWPORT sub-rect of the canvas (areaGame occupies (4,4)-(516,338)
    // of the 765x503 logical frame; the sidebar/chat are other buffers a canvas
    // overlay cannot be dragged into). Canvas-owned surfaces snap inside THIS
    // rect, in buffer px — the owner applies the same 9-anchor math per frame.
    function vpRect() {
        const b = gameRect();
        return {
            left: b.left + b.width * (4 / 765), top: b.top + b.height * (4 / 503),
            width: b.width * (512 / 765), height: b.height * (334 / 503)
        };
    }
    function ghostBox() {
        let g = document.getElementById('lcm-ghost');
        if (!g) {
            g = document.createElement('div');
            g.id = 'lcm-ghost';
            document.body.appendChild(g);
        }
        return g;
    }

    let ds = null;   // active drag session
    function hitCanvasSpec(e) {
        if (!e.target || e.target.id !== 'canvas') return null;
        const vp = vpRect(), sx = vp.width / 512, sy = vp.height / 334;
        for (const spec of SPECS) {
            if (!spec.canvas) continue;
            let b = null;
            try { b = spec.getBounds && spec.getBounds(); } catch (err) { /* not visible */ }
            if (!b) continue;
            const r = { left: vp.left + b[0] * sx, top: vp.top + b[1] * sy, width: b[2] * sx, height: b[3] * sy };
            if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
                return { spec, r, sx, sy };
            }
        }
        return null;
    }
    document.addEventListener('pointerdown', e => {
        if (!e.altKey || e.button !== 0) return;
        let spec = null, rect = null, sx = 1, sy = 1;
        const el = e.target.closest && e.target.closest('[data-lcm-surface]');
        if (el) {
            spec = SPECS.find(s => s.el === el);
            if (!spec) return;
        } else {
            const hit = hitCanvasSpec(e);
            if (!hit) return;
            spec = hit.spec; rect = hit.r; sx = hit.sx; sy = hit.sy;
        }
        // stop game interaction with the press: capture-phase + preventDefault
        // suppresses the compat mousedown the client binds on the canvas
        e.preventDefault();
        e.stopPropagation();
        const r = rect || spec.el.getBoundingClientRect();
        const box = spec.canvas ? ghostBox() : spec.el;
        box.style.display = '';
        placeXY(box, r.left, r.top);
        if (spec.canvas) {                      // ghost only: real elements keep their CSS size
            box.style.width = Math.round(r.width) + 'px';
            box.style.height = Math.round(r.height) + 'px';
            window.lcmHeld = spec.id;           // owner keeps drawing while held
        }
        ds = {
            spec, box, w: r.width, h: r.height, sx, sy, moved: false, snap: null,
            grabX: e.clientX - r.left, grabY: e.clientY - r.top, origX: e.clientX, origY: e.clientY,
            orig: { left: spec.el ? spec.el.style.left : '', top: spec.el ? spec.el.style.top : '', right: spec.el ? spec.el.style.right : '', bottom: spec.el ? spec.el.style.bottom : '' }
        };
        showDots(spec.canvas ? vpRect() : gameRect(), true);
        window.dispatchEvent(new CustomEvent('lcm-drag', { detail: spec.id }));
        try { (spec.el || box).setPointerCapture(e.pointerId); } catch (err) { /* window listeners still fire */ }
    }, true);
    window.addEventListener('pointermove', e => {
        if (!ds) return;
        if (Math.abs(e.clientX - ds.origX) + Math.abs(e.clientY - ds.origY) > 3) ds.moved = true;
        const r = ds.spec.canvas ? vpRect() : gameRect();
        const [x, y] = clampInto(r, e.clientX - ds.grabX, e.clientY - ds.grabY, ds.w, ds.h);
        placeXY(ds.box, x, y);
        let best = null, bd = SNAP_HIT;
        for (const name in ANCH) {
            const k = ANCH[name];
            const d = Math.hypot(x - (r.left + r.width * k[0]), y - (r.top + r.height * k[1]));
            if (d < bd) { bd = d; best = name; }
        }
        ds.snap = best;
        if (snapLayer) [...snapLayer.children].forEach(d => d.classList.toggle('hot', d.dataset.anch === best));
    });
    window.addEventListener('pointerup', e => {
        if (!ds) return;
        const spec = ds.spec, box = ds.box;
        if (spec.canvas && box.parentNode) box.parentNode.removeChild(box);
        if (spec.canvas) window.lcmHeld = null;
        showDots(null, false);
        window.dispatchEvent(new CustomEvent('lcm-drag-end', { detail: spec.id }));
        if (ds.moved) {
            const r = spec.canvas ? vpRect() : gameRect();
            const x = parseFloat(box.style.left) || 0, y = parseFloat(box.style.top) || 0;
            let a = ds.snap;
            if (!a) {   // free placement: anchor named by the element centre's region
                const cx = x + ds.w / 2 - r.left, cy = y + ds.h / 2 - r.top;
                a = (cy < r.height / 3 ? 'T' : cy > r.height * 2 / 3 ? 'B' : 'M') +
                    (cx < r.width / 3 ? 'L' : cx > r.width * 2 / 3 ? 'R' : 'C');
            }
            const k = ANCH[a] || ANCH.TR;
            // canvas: store offsets in buffer px (x/sx, y/sy per-axis)
            LS.set(spec.anchorKey, a);
            LS.set(spec.offsetKey, Math.round((x - (r.left + r.width * k[0])) / ds.sx) + ',' + Math.round((y - (r.top + r.height * k[1])) / ds.sy));
            if (!spec.canvas) applySpec(spec);
            suppressClick = performance.now() + 300;
            toast(`${spec.id === 'fab' ? 'FAB' : spec.id} → ${a}`);
            window.dispatchEvent(new CustomEvent('lcm-anchor-changed', { detail: spec.id }));
        } else if (!spec.canvas && spec.el) {     // click without motion: hand the style back to its owner
            spec.el.style.left = ds.orig.left; spec.el.style.top = ds.orig.top;
            spec.el.style.right = ds.orig.right; spec.el.style.bottom = ds.orig.bottom;
            suppressClick = performance.now() + 300;
        } else if (spec.canvas) {
            suppressClick = performance.now() + 300;
        }
        layoutPanel();
        ds = null;
    }, true);
    function cancelDrag() {
        if (!ds) return;
        if (ds.spec.canvas) {
            if (ds.box.parentNode) ds.box.parentNode.removeChild(ds.box);
            window.lcmHeld = null;
        }
        if (ds.spec.el) {
            const el = ds.spec.el;
            el.style.left = ds.orig.left; el.style.top = ds.orig.top; el.style.right = ds.orig.right; el.style.bottom = ds.orig.bottom;
        }
        showDots(null, false);
        window.dispatchEvent(new CustomEvent('lcm-drag-end', { detail: ds.spec.id }));
        suppressClick = performance.now() + 300;
        ds = null;
    }
    // Alt+right-click: reset one surface to its default corner
    document.addEventListener('contextmenu', e => {
        if (!e.altKey) return;
        let spec = null;
        const el = e.target.closest && e.target.closest('[data-lcm-surface]');
        if (el) spec = SPECS.find(s => s.el === el);
        else { const hit = hitCanvasSpec(e); if (hit) spec = hit.spec; }
        if (!spec) return;
        e.preventDefault();
        e.stopPropagation();
        localStorage.removeItem(spec.anchorKey);
        localStorage.removeItem(spec.offsetKey);
        applySpec(spec);
        window.dispatchEvent(new CustomEvent('lcm-anchor-changed', { detail: spec.id }));
        layoutPanel();
        toast(`${spec.id === 'fab' ? 'FAB' : spec.id}: position reset`);
    }, true);
    // alt-hot cursor hints + escape-cancel
    window.addEventListener('keydown', e => {
        if (e.key === 'Alt' && !e.repeat) { document.body.classList.add('lcm-alt'); window.lcmAlt = true; }
        if (e.key === 'Escape' && ds) { e.stopPropagation(); cancelDrag(); }
    }, true);
    window.addEventListener('keyup', e => { if (e.key === 'Alt') { document.body.classList.remove('lcm-alt'); window.lcmAlt = false; } });
    window.addEventListener('blur', () => { document.body.classList.remove('lcm-alt'); window.lcmAlt = false; cancelDrag(); });
    window.addEventListener('resize', layoutAll);
    applySpec(fabSpec);

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
