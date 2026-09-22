/* lclite control panel — RuneLite-style settings overlay for the Lost City webclient.
 * Speaks to the engine ONLY through the stable contract:
 *   - localStorage keys        (the settings bus; each engine mod reads its OWN key
 *                               at its OWN hook site — no hub)
 *   - window.lostcityClient    (optional; applyCameraSettings() for live re-apply,
 *                               cameraZoomTarget for the zoom slider readout)
 * Degrades gracefully: if the client bundle exposes nothing, toggles still persist and
 * take effect on reload, and the legacy green control bar stays visible.
 *
 * Structure — ONE mod at a time, RuneLite's plugin-list-then-config shape:
 *   THE LIST  — one row per installed mod: favorite star + name + description
 *               + gear + master switch. The panel's OWN row (LCLite itself, the
 *               "core" row) is pinned first and set off from the rest by a
 *               hairline; the mods below it are favorites first, then
 *               alphabetical by name. Typing in the search box filters the
 *               list (a mod row matches on its settings' names too, so a query
 *               for "outline" still finds the mod that owns it).
 *   A MOD     — click a row (or its gear) and the panel shows THAT mod alone: its
 *               own row (identity, star, master switch, live status) with its
 *               settings under it, nothing else. The header swaps the logo for a
 *               back chevron and titles itself with the mod; Esc backs out too.
 *               Single-toggle mods have no settings, so clicking them toasts
 *               instead (RuneLite: no config => nothing to open).
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
    // `cap` is for a mod id the panel has NO registry entry for (the synthesized row a
    // dropped-in mod folder gets). The first character needs its OWN capture group: a
    // zero-width `^` alternative matches the empty string and capitalizes nothing, so
    // every synthesized row read "demo Mod" instead of "Demo Mod".
    const cap = s => String(s ?? '').replace(/(^|[-_ ])(\w)/g, (_, sep, c) => sep + c.toUpperCase()).replace(/[-_]/g, ' ');

    // the engine's revision, handed over by the ejs script tag (data-rev, set from
    // the engine's own config). The server writes the same value into <title>, so
    // this is only for the header chip and for repairing the title if that hunk
    // ever fails to apply on a new rev — absent => both features stand down.
    const REV = String((document.currentScript && document.currentScript.dataset && document.currentScript.dataset.rev) || '');

    // mod registry ---------------------------------------------------------
    // id = the lclite/mods/<id> folder name (matches installed.json).
    // master: {key, def} — the mod's on/off. master.invert: the row's switch is
    // a DISABLE control (checked = engine key 'false') for a row whose NAME is the
    // thing being switched off; no row needs it today (anti-cheat was the only
    // one), kept so a future "Disable X" row has the shape. null = no engine
    // master (the panel itself). Mods absent from this list but
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
        { id: 'stat-orbs', name: 'Stat orbs', desc: 'HP/Prayer/Run data orbs on the minimap panel, plus a special attack orb. Click the run orb to toggle run, the prayer orb for the prayer book, the special orb to arm your special attack. Alt+drag to move them.', master: { key: 'statOrbs', def: 'false' } },
        { id: 'true-tile', name: 'True tile', desc: "Marks the tile the server has you on, the tile your mouse is over, and the tile you're walking to. Customizable.", master: { key: 'trueTile', def: 'true' } },
        { id: 'true-tile-plus', name: 'True tile+', desc: 'Ground effects on your true tile: flat flames licking off its border, or a ripple wave sweeping out of it.', master: { key: 'trueTilePlus', def: 'true' } },
        { id: 'tcg', name: 'TCG', desc: 'Left click opens pack, right click opens album. 1k exp = 100 credits, level ups = 1k-25k credits, kills = 1 credit per cb lvl.', master: { key: 'tcg', def: 'true' },
          status() {
              if (LS.get('tcg', 'true') !== 'true') return '';
              // logged out: the row would otherwise report the 'default' save's
              // balance, which is not this player's (the HUD hides for the same
              // reason — see tcg_core.ts tcgLoggedIn)
              if (typeof window.tcgLoggedIn === 'function' && window.tcgLoggedIn() === false) return 'not logged in';
              if (typeof window.tcgInfo !== 'function') return 'core not loaded';
              const i = window.tcgInfo();   // positional contract (see tcg_core.ts)
              return '◈ ' + i[0].toLocaleString('en-US') + ' · ' + i[11] + ' cards · ' + i[16] + ' kills';
          } },
        // NOT inverted: the name is the action ("Disable profanity filter"), so
        // checked = the filter is off = the key's own 'true' — the hide-roofs shape.
        { id: 'no-censor', name: 'Disable profanity filter', desc: "Chat is not censored: your own messages, other players' and private messages alike.", master: { key: 'noCensor', def: 'true' } },
        { id: 'hide-roofs', name: 'Hide roofs', desc: 'Removes roofs everywhere, not only while you stand under them. Off: the game hides them itself as you walk in.', master: { key: 'hideRoofs', def: 'false' } },
        { id: 'low-detail', name: 'Low detail', desc: 'Untextured ground applies instantly; ground decorations and half-size textures need a client refresh (F5).', master: { key: 'lowDetail', def: 'false' } },
        { id: 'shift-drop', name: 'Shift-click drop', desc: 'Hold Shift and left-click an item to drop it straight away, skipping the menu.', master: { key: 'shiftDrop', def: 'true' } },
        { id: 'hotkeys', name: 'Hotkeys', desc: 'F-key sidebar tabs, Esc closes interfaces, Space and 1-5 drive dialogues, WASD camera with press-enter-to-chat.', master: { key: 'hotkeys', def: 'true' } },
        { id: 'wiki-lookup', name: 'Wiki lookup', desc: 'A wiki button on the minimap: click it, then click any NPC, object or item to open its OSRS wiki page. Optionally also a Wiki row in every right-click menu.', master: { key: 'wikiLookup', def: 'true' } },
        { id: 'ground-items', name: 'Ground item labels', desc: 'Labels on the items lying on the ground. Hold Alt to see every item and click the - / + boxes to hide or show one.', master: { key: 'groundItems', def: 'true' } },
        { id: 'world-map', name: 'World map', desc: 'A globe button beside the wiki orb: click it and an interactive map of the world fills the window — terrain, place labels, POI icons, monster and item spawns, dungeon and extra sheets, and a you-are-here marker.', master: { key: 'worldMap', def: 'true' },
          status() {
              if (LS.get('worldMap', 'true') !== 'true') return '';
              // the page script owns the overlay; without it the orb is a dead click, so
              // say so rather than showing a healthy row (guarded — the panel is also
              // loaded by builds whose mod set differs)
              if (typeof window.worldMapToggle !== 'function') return 'page script missing';
              return document.getElementById('lcwm-root') ? 'open' : '';
          } },
        { id: 'control-panel', name: 'LCLite', desc: 'This panel and the page around it: canvas size, fullscreen, screenshots.', master: null }
    ];

    // The panel's OWN row (mods/control-panel) is the LCLite core: it cannot be
    // switched off, it is not a plugin you pick from a list, and it configures the
    // page the other mods live on — so it ignores the favorite sort, carries no
    // star, and is pinned to the top with a hairline under it (favCmp + renderView).
    const CORE_ID = 'control-panel';

    // settings rows -----------------------------------------------------------
    // kind: 'toggle' writes 'true'/'false'; 'action' fires; 'slider' writes a float;
    // 'text' writes the raw string (an item-name list) on commit
    // desc is the hover tooltip text (and search fodder), not visible subtext
    // NOTE: single-toggle mods (xp-drops, no-censor, hide-roofs,
    // low-detail, shift-drop) intentionally have NO row here — their master switch
    // on their list row IS their only setting (RuneLite: no config => nothing to
    // open). true-tile, stat-orbs and gpu graduated: master on the row, plus their
    // own rows below.
    const MODS = [
        { id: 'wheel-zoom', mod: 'camera', name: 'Wheel zoom', desc: 'Scroll the mouse wheel to zoom the camera.', key: 'wheelZoom', kind: 'toggle', def: 'true' },
        { id: 'middle-rotate', mod: 'camera', name: 'Middle-drag rotate', desc: 'Hold middle mouse + drag to rotate. Drag follows the mouse (OSRS style).', key: 'middleRotate', kind: 'toggle', def: 'true' },
        { id: 'wheel-scroll-chat', mod: 'camera', name: 'Wheel scrolls chat', desc: 'Mouse wheel over the chatbox scrolls history instead of zooming.', key: 'wheelScrollChat', kind: 'toggle', def: 'true' },
        { id: 'zoom', mod: 'camera', name: 'Camera zoom', desc: '0.4× close-up to 2.6× wide. Mouse wheel still works in-game.', kind: 'slider', min: 0.4, max: 2.6, step: 0.05, def: '1', unit: '×', get: liveZoom, apply(v) { LS.set('cameraZoom', String(v)); reapply(); } },
        // gpu: the mod's ONE setting, and it is a GPU concern now. The mod owns
        // #canvas's inline image-rendering — it reads this key every frame at its own
        // hook (rule 5) and its overlay canvas copies the same style, so the game rect
        // scales exactly like the sidebar, chatbox and minimap beside it. The LCLite
        // row lost the control: with the GPU off there is nothing to configure here
        // (the section shows the off note), and the mod puts the canvas back to Auto
        // itself. Default is Pixelated — the page stylesheet's own look for #canvas,
        // and what this setting is FOR: crisp upscaling at any canvas size.
        { id: 'gpu-pixel-scaling', mod: 'gpu', name: 'Pixel scaling', desc: 'Pixelated keeps the upscaled canvas crisp (recommended); Auto smooths it. Applied by the GPU mod — with the GPU off, scaling is Auto.', kind: 'select', key: 'gpuPixelScaling', def: 'pixelated', options: [['pixelated', 'Pixelated (recommended)'], ['auto', 'Auto']], apply(v) { LS.set('gpuPixelScaling', v); } },
        // true-tile: the mod's THREE markers, one section each — RuneLite's own Tile
        // Indicators shape ("Current tile" / "Hovered tile" / "Destination tile"). The
        // mod's row switch above (`trueTile`) gates the whole mod; each marker's first row
        // is its OWN switch, and those keys are the ones the standalone mods used, so
        // nobody's settings reset when the hovered tile moved in here. Every row is
        // re-read by the engine each frame at its own hook, so all of them apply live.
        { id: 'true-tile-sec-true', mod: 'true-tile', name: 'True tile', desc: 'The tile the SERVER has you on — it pulls ahead of your character by up to a tick while you run, which is the whole point.', kind: 'section' },
        { id: 'true-tile-color', mod: 'true-tile', name: 'Outline color', desc: 'Color of the true-tile border.', kind: 'color', key: 'trueTileColor', def: '#00ff00' },
        { id: 'true-tile-outline', mod: 'true-tile', name: 'Border thickness', desc: 'Width of the true-tile outline, in pixels.', key: 'trueTileOutline', kind: 'slider', min: 1, max: 8, step: 1, def: '1', unit: 'px' },
        { id: 'true-tile-fill', mod: 'true-tile', name: 'Fill opacity', desc: 'Translucent color wash inside the tile (OSRS fill style). 0 = outline only.', key: 'trueTileFill', kind: 'slider', min: 0, max: 100, step: 5, def: '0', unit: '%' },
        { id: 'true-tile-desync', mod: 'true-tile', name: 'Only when out of sync', desc: 'Hide the tile while your model stands on the server tile — pops up only when the tick is visibly delayed.', key: 'trueTileOnlyDesync', kind: 'toggle', def: 'false' },
        { id: 'true-tile-sec-hover', mod: 'true-tile', name: 'Hovered tile', desc: 'The tile your mouse is over, resolved by the engine’s own ground pick — the same test a walk click uses.', kind: 'section' },
        { id: 'true-tile-hover', mod: 'true-tile', name: 'Highlight hovered tile', desc: 'Draw the square on the tile the cursor is pointing at. Off: no outline follows the mouse.', key: 'hoverTile', kind: 'toggle', def: 'true' },
        { id: 'true-tile-hover-color', mod: 'true-tile', name: 'Outline color', desc: 'Color of the hovered-tile border.', kind: 'color', key: 'hoverTileColor', def: '#ffffff' },
        { id: 'true-tile-hover-outline', mod: 'true-tile', name: 'Border thickness', desc: 'Width of the hovered-tile outline, in pixels.', key: 'hoverTileOutline', kind: 'slider', min: 1, max: 8, step: 1, def: '2', unit: 'px' },
        { id: 'true-tile-hover-fill', mod: 'true-tile', name: 'Fill opacity', desc: 'Translucent color wash inside the hovered tile (OSRS fill style). 0 = outline only.', key: 'hoverTileFill', kind: 'slider', min: 0, max: 100, step: 5, def: '20', unit: '%' },
        { id: 'true-tile-sec-dest', mod: 'true-tile', name: 'Destination tile', desc: 'The tile you clicked to walk to. It stays lit until the true tile reaches it.', kind: 'section' },
        { id: 'true-tile-dest', mod: 'true-tile', name: 'Highlight destination tile', desc: 'Draw the square on the tile you are walking to, until your true tile gets there.', key: 'destTile', kind: 'toggle', def: 'true' },
        { id: 'true-tile-dest-color', mod: 'true-tile', name: 'Outline color', desc: 'Color of the destination-tile border.', kind: 'color', key: 'destTileColor', def: '#808080' },
        { id: 'true-tile-dest-outline', mod: 'true-tile', name: 'Border thickness', desc: 'Width of the destination-tile outline, in pixels.', key: 'destTileOutline', kind: 'slider', min: 1, max: 8, step: 1, def: '2', unit: 'px' },
        { id: 'true-tile-dest-fill', mod: 'true-tile', name: 'Fill opacity', desc: 'Translucent color wash inside the destination tile (OSRS fill style). 0 = outline only.', key: 'destTileFill', kind: 'slider', min: 0, max: 100, step: 5, def: '20', unit: '%' },
        // true-tile-plus: ground effects on the same true tile, with its OWN keys (rule 5 —
        // it never reads true-tile's). Every row here is re-read by the engine every frame at
        // its own hook, so a change lands on the next frame; the rows are shared by BOTH
        // effects (flames and wave), which is why none of them names one.
        { id: 'true-tile-plus-effect', mod: 'true-tile-plus', name: 'Ground effect', desc: 'Which effect rides your true tile. More effects land in this list as they ship.', kind: 'select', key: 'trueTilePlusEffect', def: 'flames', options: [['flames', 'Flames'], ['wave', 'Wave'], ['none', 'None']], apply(v) { LS.set('trueTilePlusEffect', v); } },
        { id: 'true-tile-plus-color', mod: 'true-tile-plus', name: 'Effect color', desc: 'Color of the ground effect. Black reads as black fire (or a dark ripple) on most ground.', kind: 'color', key: 'trueTilePlusColor', def: '#000000' },
        { id: 'true-tile-plus-count', mod: 'true-tile-plus', name: 'Elements per edge', desc: 'How many elements ride each side of the tile: flame tongues, or ripples in the wave train.', key: 'trueTilePlusCount', kind: 'slider', min: 1, max: 8, step: 1, def: '4' },
        { id: 'true-tile-plus-reach', mod: 'true-tile-plus', name: 'Effect reach', desc: 'How far an element reaches out from the tile, as a share of a tile side — it scales with the camera, so it keeps its size on the tile. The wave wants more than the flames do: try 50-75% for the full shockwave.', key: 'trueTilePlusReach', kind: 'slider', min: 4, max: 75, step: 1, def: '23', unit: '%' },
        // the speed slider's step is a fraction, so it writes its raw value (the default
        // slider write rounds to an integer, which would pin every setting to 0 or 1)
        { id: 'true-tile-plus-speed', mod: 'true-tile-plus', name: 'Effect speed', desc: 'How fast the effect animates — the flames dance, the ripples sweep. 0 freezes it.', key: 'trueTilePlusSpeed', kind: 'slider', min: 0, max: 3, step: 0.25, def: '1', unit: '×', apply(v) { LS.set('trueTilePlusSpeed', String(v)); } },
        // stat-orbs: the orbs are canvas-drawn into the minimap widget buffer, so the
        // engine re-reads every one of these per frame at its own hook (rule 5) — all of
        // them apply live, size included. The placement keys (lcmStatOrbs*) belong to the
        // drag layer, so the reset row below asks IT to clear them (never a 2nd writer).
        { id: 'orbs-size', mod: 'stat-orbs', name: 'Orb size', desc: 'Diameter of each data orb. The column re-spreads to fill the panel strip.', key: 'statOrbsSize', kind: 'slider', min: 20, max: 28, step: 2, def: '22', unit: 'px' },
        { id: 'orbs-number-size', mod: 'stat-orbs', name: 'Number size', desc: 'How large the HP/Prayer/Run readouts are drawn, in HALF steps (1x, 1.5x … 3x). Bigger digits need more of the panel strip, so the orb column shifts further right, over the map.', key: 'statOrbsNumberScale', kind: 'slider', min: 1, max: 3, step: 0.5, def: '1', unit: 'x', apply(v) { LS.set('statOrbsNumberScale', String(v)); } },
        { id: 'orbs-numbers', mod: 'stat-orbs', name: 'Orb numbers', desc: 'Where the HP/Prayer/Run readouts go: to the left of each orb (OSRS), inside the orb, or hidden.', kind: 'select', key: 'statOrbsNumbers', def: 'left', options: [['left', 'Left of orb'], ['inside', 'Inside orb'], ['hidden', 'Hidden']], apply(v) { LS.set('statOrbsNumbers', v); } },
        { id: 'orbs-fill', mod: 'stat-orbs', name: 'Fill style', desc: 'Liquid level (OSRS: drains downward as the stat falls) or a clockwise pie sweep from the top.', kind: 'select', key: 'statOrbsFill', def: 'liquid', options: [['liquid', 'Liquid level'], ['pie', 'Pie sweep']], apply(v) { LS.set('statOrbsFill', v); } },
        { id: 'orbs-pulse', mod: 'stat-orbs', name: 'Low HP warning', desc: 'Flash the Hitpoints orb while you are below a quarter health (OSRS behaviour).', key: 'statOrbsPulse', kind: 'toggle', def: 'true' },
        { id: 'orbs-run-click', mod: 'stat-orbs', name: 'Run orb toggles run', desc: 'Click the Run energy orb to turn run on or off — the same click the options tab sends. The orb glass lightens while run is on.', key: 'statOrbsRunClick', kind: 'toggle', def: 'true' },
        { id: 'orbs-spec-click', mod: 'stat-orbs', name: 'Special orb arms the attack', desc: 'Click the special attack orb to arm or disarm your special attack — the same click the combat tab’s own special attack bar sends. The orb gets a gold rim and a yellow readout while it is armed, so you can see the state at a glance.', key: 'statOrbsSpecClick', kind: 'toggle', def: 'true' },
        { id: 'orbs-prayer-panel', mod: 'stat-orbs', name: 'Prayer book on the orb', desc: 'Click the Prayer orb to open the prayer book over the minimap: all fifteen prayers, drawn with the icons the game already has. Click a prayer to toggle it; click the orb or the panel again to close.', key: 'statOrbsPrayerPanel', kind: 'toggle', def: 'true' },
        { id: 'orbs-hp-color', mod: 'stat-orbs', name: 'Hitpoints color', desc: 'Liquid color of the Hitpoints orb.', kind: 'color', key: 'statOrbsHpColor', def: '#e82623' },
        { id: 'orbs-prayer-color', mod: 'stat-orbs', name: 'Prayer color', desc: 'Liquid color of the Prayer orb.', kind: 'color', key: 'statOrbsPrayerColor', def: '#d9a318' },
        { id: 'orbs-run-color', mod: 'stat-orbs', name: 'Run energy color', desc: 'Liquid color of the Run energy orb.', kind: 'color', key: 'statOrbsRunColor', def: '#71c8e8' },
        // the special attack orb: its own two colours, because the whole point of it is
        // the RED background + GREEN fill of the game's own special attack bar. It goes
        // grey by itself while the wielded weapon has no special attack, so these two are
        // the colours of the weapon that HAS one.
        { id: 'orbs-spec-color', mod: 'stat-orbs', name: 'Special attack color', desc: 'Background color of the special attack orb — red, so the green fill reads as the game’s own special attack bar.', kind: 'color', key: 'statOrbsSpecColor', def: '#8b1a1a' },
        { id: 'orbs-spec-fill', mod: 'stat-orbs', name: 'Special attack fill', desc: 'Fill color of the special attack orb: the part that drains as you spend special attacks, and refills as the energy regenerates.', kind: 'color', key: 'statOrbsSpecFill', def: '#3cbf2e' },
        { id: 'orbs-reset', mod: 'stat-orbs', name: 'Reset position', desc: 'Put the orbs back in their default spot down the minimap panel. Same as Alt+right-click on them.', kind: 'action', btn: 'Reset', run() {
            if (window.lcmAnchor && typeof window.lcmAnchor.reset === 'function') window.lcmAnchor.reset('stat-orbs');
            else toast('LCLite panel not loaded');
        } },
        // the spec orb is a SEPARATE canvas surface (it sits away from the column on
        // purpose), so it has its own keys and therefore its own reset
        { id: 'orbs-spec-reset', mod: 'stat-orbs', name: 'Reset special orb position', desc: 'Put the special attack orb back in its default spot at the minimap panel’s bottom left. Same as Alt+right-click on it.', kind: 'action', btn: 'Reset', run() {
            if (window.lcmAnchor && typeof window.lcmAnchor.reset === 'function') window.lcmAnchor.reset('stat-orbs-spec');
            else toast('LCLite panel not loaded');
        } },
        // canvas sizing: a real scale slider (the old 1x/2x/3x dropdown was the whole
        // range) plus a Fit toggle for the old "Auto". Both go through setSize(), which
        // writes canvasSize (the key the page reads) and remembers the fixed scale in
        // canvasScale, so the page's own legacy dropdown (hidden — the panel replaces
        // that bar) stays in step.
        { id: 'canvas-scale', mod: 'control-panel', name: 'Canvas scale', desc: 'Any size from 0.5x to 4x, not just 1x/2x/3x.', kind: 'slider', min: 0.5, max: 4, step: 0.05, def: '1', unit: '×', get: liveScale, apply(v) { if (typeof setSize === 'function') setSize(String(v)); } },
        { id: 'canvas-autofit', mod: 'control-panel', name: 'Fit to window', desc: 'Overrides the scale slider and sizes the canvas to the window (the old Auto).', key: 'canvasAutoFit', kind: 'toggle', def: 'false', get: () => LS.get('canvasSize', '1') === 'auto', apply(on) { if (typeof setSize === 'function') setSize(on ? 'auto' : LS.get('canvasScale', '1')); } },
        { id: 'fullscreen', mod: 'control-panel', name: 'Fullscreen', desc: 'Toggle fullscreen for the game canvas.', kind: 'action', run() {
            if (document.fullscreenElement) document.exitFullscreen();
            else { const el = document.getElementById('canvas'); el && el.requestFullscreen && el.requestFullscreen(); }
        } },
        { id: 'canvas-scaling-note', mod: 'control-panel', name: 'Pixel scaling moved', desc: 'Pixel scaling is a GPU setting now: open the GPU mod to choose Pixelated (default) or Auto. With the GPU off, the canvas scales Auto.', kind: 'action', btn: 'Open GPU', run() {
            openModView('gpu');
        } },
        { id: 'screenshot', mod: 'control-panel', name: 'Take screenshot', desc: 'Save the current frame as PNG.', kind: 'action', run() {
            const c = document.getElementById('canvas');
            if (!c) return;
            const a = document.createElement('a');
            a.download = 'screenshot-' + Math.floor(Date.now() / 1000) + '.png';
            a.href = c.toDataURL('image/png');
            a.click();
            toast('Screenshot saved');
        } }
    ];

    // ---- TCG (mods/tcg) ------------------------------------------------------
    // The HUD is a PAGE overlay (ui.js), so its switches are plain localStorage
    // keys this panel writes and that layer reads at its own tick — no engine
    // round trip, no hub (rule 5). The two actions are the same entry points the
    // HUD's own left/right click uses, which is how a player who hid the box (or
    // never had it in view) still reaches packs and the album.
    // Guarded like every page-side call: a stale bundle or a failed ui.js hunk
    // leaves the button working but toasting why nothing happened.
    MODS.push(
        { id: 'tcg-hud', mod: 'tcg', name: 'Show credits HUD', desc: 'The in-game box with your credits, credits per hour and progress to the next pack.', key: 'tcgHud', kind: 'toggle', def: 'true' },
        { id: 'tcg-hud-credits', mod: 'tcg', name: 'Show credits', desc: 'The ◈ credits line in the HUD.', key: 'tcgHudCredits', kind: 'toggle', def: 'true' },
        { id: 'tcg-hud-rate', mod: 'tcg', name: 'Show credits per hour', desc: 'The green +N/h earning-rate line in the HUD.', key: 'tcgHudRate', kind: 'toggle', def: 'true' },
        { id: 'tcg-hud-progress', mod: 'tcg', name: 'Show credits to next pack', desc: 'The "N to next pack" line in the HUD. Hiding all three lines hides the box.', key: 'tcgHudProgress', kind: 'toggle', def: 'true' },
        { id: 'tcg-album', mod: 'tcg', name: 'Collection album', desc: 'Browse the cards you have discovered. The same view as right-clicking the HUD.', kind: 'action', btn: 'Open', run() {
            if (typeof window.tcgShowAlbum === 'function') { window.tcgShowAlbum(); }
            else { toast('TCG page layer not loaded (lclite apply)'); }
        } },
        { id: 'tcg-pack', mod: 'tcg', name: 'Open a pack', desc: 'Spends 2,500 credits on a Standard Pack and reveals five cards. Same as clicking the HUD.', kind: 'action', btn: 'Open', run() {
            if (typeof window.tcgOpenPack === 'function') { window.tcgOpenPack(); }
            else { toast('TCG engine not loaded (rebuild needed)'); }
        } }
    );

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
        { id: 'hk-space', mod: 'hotkeys', name: 'Space continues dialogue', desc: 'Space advances a dialogue — the same click its "Click here to continue" button sends — instead of typing a space. A live chat line still wins.', key: 'hotkeysSpace', kind: 'toggle', def: 'true' },
        { id: 'hk-numbers', mod: 'hotkeys', name: 'Number keys pick options', desc: 'With a "Select an Option" dialogue open, 1-5 choose that option, exactly as clicking it would. Numbers stay free for sidebar-tab bindings while no dialogue is up.', key: 'hotkeysNumbers', kind: 'toggle', def: 'true' },
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

    // ---- Wiki lookup (mods/wiki-lookup) -------------------------------------
    // The engine re-reads its OWN keys every frame at its own hooks (the minimap button's
    // draw + click loop, buildMinimenu), so every row here applies live — no reload, and
    // the master switch on the mod's row IS wikiLookup. The URL is built here too (a page
    // script cannot import the bundle's TS payload), which is why the search action
    // repeats the wiki's base url: keep it in step with WIKI_LOOKUP_ORIGIN in
    // mods/wiki-lookup/files/webclient/src/client/WikiLookup.ts. The placement keys
    // (lcmWikiLookup*) belong to the drag layer, so the reset row below asks IT to clear
    // them (never a 2nd writer).
    MODS.push(
        { id: 'wiki-lookup-button', mod: 'wiki-lookup', name: 'Minimap wiki button', desc: 'The wiki orb at the bottom-right of the minimap panel. Click it, then click any NPC, object or item — world, inventory, worn, bank or shop — and its wiki page opens. It highlights while armed; clicking it again (or using it) turns it off. Alt+drag moves it.', key: 'wikiLookupButton', kind: 'toggle', def: 'true' },
        { id: 'wiki-lookup-menu', mod: 'wiki-lookup', name: 'Right-click menu row', desc: 'The classic RuneLite form: a \'Wiki <target>\' row in the right-click menu, on the bottom line above Cancel. Off by default — the minimap button is the usual way in.', kind: 'select', key: 'wikiLookupMenu', def: 'off', options: [['off', 'Off'], ['always', 'Always'], ['shift', 'Hold Shift'], ['ctrl', 'Hold Ctrl'], ['alt', 'Hold Alt']], apply(v) { LS.set('wikiLookupMenu', v); } },
        { id: 'wiki-lookup-style', mod: 'wiki-lookup', name: 'Lookup style', desc: 'Direct page (the exact page for the name, RuneLite\'s classic behaviour) or the wiki\'s search results, which always land somewhere.', kind: 'select', key: 'wikiLookupStyle', def: 'page', options: [['page', 'Direct page'], ['search', 'Wiki search']], apply(v) { LS.set('wikiLookupStyle', v); } },
        { id: 'wiki-lookup-reset', mod: 'wiki-lookup', name: 'Reset button position', desc: 'Put the minimap wiki button back at the bottom-right of the panel. Same as Alt+right-click on it.', kind: 'action', btn: 'Reset', run() {
            if (window.lcmAnchor && typeof window.lcmAnchor.reset === 'function') window.lcmAnchor.reset('wiki-lookup');
            else toast('LCLite panel not loaded');
        } },
        { id: 'wiki-lookup-search', mod: 'wiki-lookup', name: 'Search the wiki', desc: 'Type anything — a quest, a skill, a guide — and open the OSRS wiki search in a new tab. The stand-in for the wiki button\'s own Search option.', kind: 'action', btn: 'Open', run() {
            const q = window.prompt('Search the OSRS wiki for:', '');
            if (!q) { return; }
            window.open('https://oldschool.runescape.wiki/w/Special:Search?search=' + encodeURIComponent(q) + '&utm_source=lclite', '_blank');
            toast('Wiki search opened');
        } },

        // world-map (mods/world-map) — the client's own world map app, made reachable.
        // The rows are the orb's two switches, the way in without the orb, and the
        // placement reset (the drag layer is the only writer of the lcm* keys, so the
        // row asks IT to clear them — never the keys themselves).
        { id: 'world-map-button', mod: 'world-map', name: 'Minimap world button', desc: 'The globe orb on the minimap panel, immediately left of the wiki orb. Click it and the world map opens over the game; click it again (or Esc, or the map\'s own close button) and it goes away. Alt+drag moves it.', key: 'worldMapButton', kind: 'toggle', def: 'true' },
        { id: 'world-map-centre', mod: 'world-map', name: 'Centre on me when it opens', desc: 'Open the map centred on your character — switching to the dungeon sheet when that is where you are. Off: the map opens wherever you last left it.', key: 'worldMapCentre', kind: 'toggle', def: 'true' },
        { id: 'world-map-open', mod: 'world-map', name: 'Open the world map', desc: 'The orb\'s click, from here: opens the map (centred on you if that setting is on) or closes it if it is already open.', kind: 'action', btn: 'Open', run() {
            if (typeof window.worldMapToggle === 'function') window.worldMapToggle(LS.get('worldMapCentre', 'true') === 'true' ? 1 : 0);
            else toast('World map page script not loaded');
        } },
        { id: 'world-map-reset', mod: 'world-map', name: 'Reset button position', desc: 'Put the world orb back beside the wiki orb, bottom-right of the minimap panel. Same as Alt+right-click on it.', kind: 'action', btn: 'Reset', run() {
            if (window.lcmAnchor && typeof window.lcmAnchor.reset === 'function') window.lcmAnchor.reset('world-map');
            else toast('LCLite panel not loaded');
        } },

        // ground-items (mods/ground-items) — RuneLite's Ground Items, 2004 flavour.
        // The two name lists are free text: they are also written by Alt+clicking an
        // item in game, so the rows show (and accept) the very same comma-separated
        // string the engine reads at its own per-frame hook.
        { id: 'ground-items-value', mod: 'ground-items', name: 'Min high alch value', desc: 'Only label items whose high alch value is above this. 0 labels every item that is not on the hidden list.', key: 'groundItemsValue', kind: 'slider', min: 0, max: 1000000, step: 1000, def: '0', unit: ' gp' },
        { id: 'ground-items-shown', mod: 'ground-items', name: 'Shown items', desc: 'Item names to always label, comma separated — they get the shown-item colour. Alt+click an item in game to add it here.', key: 'groundItemsShown', kind: 'text', def: '', placeholder: 'Dragon bones, Ranarr weed' },
        { id: 'ground-items-hidden', mod: 'ground-items', name: 'Hidden items', desc: 'Item names to never label, comma separated. Alt+click the - box in game to add one (a right-click on a label does the same).', key: 'groundItemsHidden', kind: 'text', def: '', placeholder: 'Bones, Ashes, Coins' },
        { id: 'ground-items-show-value', mod: 'ground-items', name: 'Show high alch value', desc: 'Append the high alch value to each label, e.g. "Rune platebody (39K gp)".', key: 'groundItemsShowValue', kind: 'toggle', def: 'false' },
        { id: 'ground-items-color', mod: 'ground-items', name: 'Label color', desc: 'Colour of a normal label.', kind: 'color', key: 'groundItemsColor', def: '#ffffff' },
        { id: 'ground-items-listed-color', mod: 'ground-items', name: 'Shown-item color', desc: 'Colour of an item on your Shown items list.', kind: 'color', key: 'groundItemsHighlightColor', def: '#ff9040' },
        { id: 'ground-items-hidden-color', mod: 'ground-items', name: 'Hidden-item color', desc: 'Colour of a hidden item while Alt is held (it is the only time a hidden item is labelled).', kind: 'color', key: 'groundItemsHiddenColor', def: '#808080' }
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
        // mods referenced by rows but absent from both registry and manifest —
        // ONLY when the manifest is unreadable (installed===null), where showing
        // every row's mod is the safe fallback. With a READABLE manifest this net
        // must not run: it re-adds a mod the installer deliberately left out, so a
        // stripped mod kept a live-looking row whose switch did nothing.
        if (!installed) for (const f of MODS) if (!known.has(f.mod || 'control-panel')) {
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

    // LCLite mark: THE LAUNCHER'S OWN LOGO — a gold-gradient crescent (one disc cut
    // out of another by a mask, so the inner edge is a perfect arc at any size) plus
    // the three-star cluster. Geometry and colours are identical to logo() in
    // launcher/ui/index.html and to files/engine/public/favicon.svg; change the art
    // in all three or in none. Fills are inline (a gradient needs a per-instance id)
    // and deliberately literal, not theme vars: a logo is not a theme colour.
    // BOTH ids must be unique — the mark renders twice (FAB + header) and a duplicate
    // id would make the second copy lose its mask and gradient.
    let markSeq = 0;
    const MARK = () => {
        const id = 'lcmark' + (++markSeq);
        return `<svg class="lclite-mark" viewBox="0 0 48 48" aria-hidden="true"><defs>`
            + `<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1">`
            + `<stop offset="0" stop-color="#f7e2ac"/><stop offset="0.55" stop-color="#e6bb63"/><stop offset="1" stop-color="#b8862c"/>`
            + `</linearGradient>`
            + `<mask id="${id}m"><rect width="48" height="48" fill="#fff"/><circle cx="31" cy="17" r="15.5" fill="#000"/></mask>`
            + `</defs>`
            + `<circle class="mk-moon" cx="23" cy="24" r="17" fill="url(#${id}g)" mask="url(#${id}m)"/>`
            + `<path class="mk-star" d="M33 22.5l1.5 3.4 3.4 1.5-3.4 1.5-1.5 3.4-1.5-3.4-3.4-1.5 3.4-1.5z" fill="#fff3d0" opacity=".92"/>`
            + `<circle cx="41" cy="15" r="1.5" fill="#fff3d0" opacity=".75"/>`
            + `<circle cx="37" cy="33" r="1.1" fill="#fff3d0" opacity=".6"/>`
            + `</svg>`;
    };
    // padlock icons for the pin button (stroke-only so they inherit currentColor)
    const ICON_UNLOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a4 4 0 0 1 7.7-1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="5" y="10" width="12" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
    const ICON_LOCKED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10V8a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="5" y="10" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="14.5" r="1.4" fill="currentColor"/></svg>';

    // mod-row icons: favorite star (fill rides the .on class) + settings gear
    const ICON_STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.6 9.3l6.5-.9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    const ICON_GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

    // favorites: panel-owned display state (the lcm* prefix is the panel's own
    // namespace — the drag layer's placement keys live in it too)
    const FAVS = new Set(String(LS.get('lcmFavMods', '')).split(',').filter(Boolean));
    const saveFavs = () => LS.set('lcmFavMods', [...FAVS].join(','));
    // the CORE row is always first (it is not a plugin: it cannot be switched off and
    // it has nothing to sort against — see CORE_ID); below it, favorites first, then
    // alphabetical by name (case-insensitive — 'Disable profanity filter' sorts
    // under D, 'GPU' under G, 'XP drops' last)
    const favCmp = (a, b) =>
        (b.id === CORE_ID ? 1 : 0) - (a.id === CORE_ID ? 1 : 0) ||
        (FAVS.has(b.id) ? 1 : 0) - (FAVS.has(a.id) ? 1 : 0) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

    // build DOM ---------------------------------------------------------------
    const root = document.createElement('div');
    root.id = 'lclite-root';
    root.innerHTML = `
        <div id="lclite-toast"></div>
        <div id="lclite-panel" role="dialog" aria-label="Client settings">
            <div class="lcm-head" id="lcm-head">
                <span class="lcm-back" id="lcm-back" role="button" tabindex="0" title="Back to the mod list (Esc)">‹</span>
                ${MARK()}
                <span class="lcm-title" id="lcm-title">LCLite</span>
                <span class="lcm-rev" title="The Lost City revision this install runs"${REV ? '' : ' hidden'}>${esc(REV)}</span>
                <span class="lcm-lock" id="lcm-lock" role="button" tabindex="0" aria-pressed="false"></span>
                <span class="lcm-x" id="lcm-close" title="Close (F1)">✕</span>
            </div>
            <div class="lcm-search"><input id="lcm-search" type="search" placeholder="Search…" autocomplete="off"></div>
            <div class="lcm-body" id="lcm-body"></div>
        </div>
        <div id="lclite-fab" title="Client settings (F1)">
            ${MARK()}
        </div>
        <div id="lclite-tip" role="tooltip"></div>`;
    document.body.appendChild(root);

    // the tab title is written server-side (client.ejs) from this same revision; if
    // that hunk ever fails to apply on a new rev, the tab is stuck on upstream's
    // "2004Scape Game" — so the panel puts the product name back.
    if (REV && document.title.indexOf('LCLite') === -1) { document.title = `LCLite - ${REV}`; }

    const panel = root.querySelector('#lclite-panel');
    const fab = root.querySelector('#lclite-fab');
    const body = root.querySelector('#lcm-body');
    const searchEl = root.querySelector('#lcm-search');
    const headEl = root.querySelector('#lcm-head');
    const titleEl = root.querySelector('#lcm-title');
    const backEl = root.querySelector('#lcm-back');
    let toastTimer = 0;
    // The panel shows ONE mod at a time (see renderView): '' = the mod list, otherwise
    // the id of the mod whose settings are open. Persisted like the old tab was, so
    // reopening the panel returns you where you were. Builds before the drill-down
    // persisted which TAB was open; nothing reads that any more, so drop it.
    localStorage.removeItem('lclitePanelTab');
    let openMod = String(LS.get('lclitePanelMod', ''));

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
    // ---- MODS tab ----------------------------------------------------------
    function modRow(p, detail) {
        const row = document.createElement('div');
        row.className = 'lcm-prow' + (detail ? ' detail' : '');
        row.dataset.mod = p.id;
        // the row's search text carries its SETTINGS too, so typing a setting name
        // ("outline", "zoom") still finds the mod that owns it — there is no
        // cross-mod settings list to search any more, only the drill-down
        row.dataset.name = (p.name + ' ' + p.desc + ' ' +
            MODS.filter(f => f.mod === p.id).map(f => f.name + ' ' + (f.desc || '')).join(' ')).toLowerCase();
        const badge = p.badge ? `<span class="lcm-badge">${esc(p.badge)}</span>` : '';
        const status = typeof p.status === 'function' ? '<span class="lcm-status" style="display:none"></span>' : '';
        const hasRows = MODS.some(f => f.mod === p.id);
        // the core row carries no star: it is pinned first by construction, so there is
        // nothing for a favorite to do (a dead control that toasts "favorited" is worse
        // than none). The spacer keeps its name column aligned with the mods below.
        const star = p.id === CORE_ID
            ? '<span class="lcm-favgap" aria-hidden="true"></span>'
            : `<button class="lcm-fav${FAVS.has(p.id) ? ' on' : ''}" type="button" title="${FAVS.has(p.id) ? 'Unfavorite (back to default order)' : 'Favorite (pin to top of the list)'}" aria-pressed="${FAVS.has(p.id)}">${ICON_STAR}</button>`;
        row.innerHTML = `
            ${star}
            <div class="lcm-pmain">
                <div class="lcm-pname">${esc(p.name)}${badge}${status}</div>
                <div class="lcm-pdesc">${esc(p.desc)}</div>
            </div>
            ${hasRows && !detail ? `<button class="lcm-gear" type="button" title="Open ${esc(p.name)} settings">${ICON_GEAR}</button>` : ''}`;
        const main = row.querySelector('.lcm-pmain');

        const fav = row.querySelector('.lcm-fav');
        if (fav) fav.addEventListener('click', () => {
            if (FAVS.has(p.id)) FAVS.delete(p.id); else FAVS.add(p.id);
            saveFavs();
            toast(FAVS.has(p.id) ? `${p.name}: favorited` : `${p.name}: unfavorited`);
            // rebuild, not in-place sort: an unfavorited mod must drop back into
            // its alphabetical slot, which a stable sort over the already-sorted
            // list can't do
            modsList = buildModList(installedSet);
            renderView();                    // the list (and this view) re-sorts
        });
        const gear = row.querySelector('.lcm-gear');
        if (gear) gear.addEventListener('click', () => openModView(p.id));

        if (p.master) {
            const inv = !!p.master.invert;
            const input = switchInput((LS.get(p.master.key, p.master.def) === 'true') !== inv);
            input.addEventListener('change', () => {
                LS.set(p.master.key, (input.checked !== inv) ? 'true' : 'false');
                reapply();
                toast(inv ? `${p.name}: ${input.checked ? 'on' : 'off'}` : `${p.name}: ${input.checked ? 'enabled' : 'disabled'}`);
                renderView();                // section visibility can change
            });
            row.appendChild(wrapSwitch(input));
        } else if (p.id === CORE_ID) {
            const chip = document.createElement('span');
            chip.className = 'lcm-pcore';
            chip.textContent = 'core';
            chip.title = 'LCLite itself — cannot be switched off from inside the game';
            row.appendChild(chip);
        } else {
            // A mod with NO master switch — a dropped-in mod folder whose row was
            // synthesized from installed.json, or one whose settings are several rows
            // with no single on/off. Say exactly that, in a muted chip: this column
            // used to fall through to the CORE pill, so every new mod claimed to BE
            // LCLite itself ("cannot be switched off from inside the game").
            const chip = document.createElement('span');
            chip.className = 'lcm-pnone';
            chip.textContent = 'no switch';
            chip.title = 'This mod has no on/off switch of its own — it is on whenever it is installed'
                + (hasRows ? '; its settings are in its own view' : '');
            row.appendChild(chip);
        }

        // RuneLite behaviour: clicking the mod (not its switch) opens its config. In
        // the mod's OWN view (detail) the row is its header, so a click there is a
        // no-op rather than reopening what you are already looking at.
        main.addEventListener('click', () => {
            if (detail) return;
            if (!hasRows) { toast(`${p.name}: this mod has no settings`); return; }
            openModView(p.id);
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
            reapply();
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
        // optional btn: some actions read better than "Run" (TCG's two doorways
        // into its own UI both say "Open")
        row.innerHTML = `${labelHtml(f)}
            <button class="lcm-zreset">${esc(f.btn || 'Run')}</button>`;
        row.querySelector('button').addEventListener('click', () => f.run());
        return row;
    }

    // text row: a free-text settings value (ground-items' two item-name lists). Writes
    // the RAW string on `change` (Enter/blur) rather than per keystroke, so the engine
    // never reads a half-typed list — and a re-render cannot eat a keystroke, because
    // the value is only read when the field is committed. The engine trims and
    // case-folds the names itself.
    function textRow(f) {
        const cur = LS.get(f.key, f.def);
        const row = document.createElement('div');
        row.className = 'lcm-row';
        row.dataset.name = f.name.toLowerCase() + ' ' + (f.desc || '').toLowerCase();
        row.innerHTML = `${labelHtml(f)}
            <input type="text" class="lcm-text" value="${esc(cur)}" placeholder="${esc(f.placeholder || '')}" spellcheck="false" autocomplete="off">`;
        const inp = row.querySelector('input');
        inp.addEventListener('change', () => {
            LS.set(f.key, inp.value);
            reapply();
            toast(`${f.name}: ${inp.value.trim() || 'empty'}`);
        });
        return row;
    }

    // A section header INSIDE one mod's settings — true-tile's three markers, the one
    // mod whose rows are three features rather than one feature's look. It is not a row:
    // no control, no key, nothing written. It carries data-name like a row does, so the
    // search dims (and so hides) it with the settings underneath it, and its desc rides
    // the shared tooltip.
    function sectionRow(f) {
        const el = document.createElement('div');
        el.className = 'lcm-sechead';
        el.dataset.name = f.name.toLowerCase() + ' ' + (f.desc || '').toLowerCase();
        const label = document.createElement('span');
        label.className = 'lcm-name';
        label.dataset.tip = f.desc || '';
        label.textContent = f.name;
        const line = document.createElement('i');
        line.className = 'lcm-scline';
        el.appendChild(label);
        el.appendChild(line);
        return el;
    }

    // One mod's settings. No header and no collapse: the panel shows a single mod at a
    // time, so there is nothing to collapse it against — the mod's own row directly
    // above it carries the name, the favorite star and the master switch. (Camera's
    // master used to ride this header because it gates a whole sub-tree; every mod's
    // master lives on its row now, which is what the row above provides.)
    function settingsSection(p) {
        const list = MODS.filter(f => f.mod === p.id);
        const grp = document.createElement('div');
        grp.className = 'lcm-group';
        grp.dataset.section = p.id;
        const gbody = document.createElement('div');
        gbody.className = 'lcm-gbody';
        const masterOn = !p.master || LS.get(p.master.key, p.master.def) === 'true';
        if (!masterOn) {
            const off = document.createElement('div');
            off.className = 'lcm-offnote';
            off.textContent = 'Mod disabled — enable it to change these settings.';
            gbody.appendChild(off);
        } else {
            for (const f of list) {
                gbody.appendChild(f.kind === 'section' ? sectionRow(f) : f.kind === 'toggle' ? toggleRow(f) : f.kind === 'slider' ? sliderRow(f) : f.kind === 'select' ? selectRow(f) : f.kind === 'color' ? colorRow(f) : f.kind === 'text' ? textRow(f) : actionRow(f));
            }
        }
        grp.appendChild(gbody);
        return grp;
    }

    // ---- view rendering --------------------------------------------------------
    let modsList = [];   // rebuilt by renderRows(manifest)
    let installedSet = null;   // last manifest seen (rebuild target for favorite re-sorts)

    // The list, or the one mod you clicked. That mod's own row comes along (identity,
    // favorite star, master switch, live status) with its settings directly under it:
    // the old Settings tab rendered every section at once, which is what this replaces.
    function renderView() {
        let p = openMod ? modsList.find(m => m.id === openMod) : null;
        // a persisted id can go stale (mod uninstalled, or its rows went away): fall
        // back to the list instead of opening an empty panel
        if (openMod && (!p || !MODS.some(f => f.mod === openMod))) { openMod = ''; p = null; }
        headEl.classList.toggle('detail', !!p);
        titleEl.textContent = p ? p.name : 'LCLite';
        searchEl.placeholder = p ? `Search ${p.name}…` : 'Search…';
        body.innerHTML = '';
        if (p) {
            body.appendChild(modRow(p, true));
            body.appendChild(settingsSection(p));
        } else {
            // the core row is pinned first (favCmp); a hairline sets it off from the
            // mods it configures, so it reads as the panel itself rather than as one
            // more plugin in the list
            let sepDone = false;
            for (const m of modsList) {
                body.appendChild(modRow(m));
                if (!sepDone && m.id === CORE_ID && modsList.length > 1) {
                    const sep = document.createElement('div');
                    sep.className = 'lcm-sep';
                    sep.setAttribute('role', 'separator');
                    body.appendChild(sep);
                    sepDone = true;
                }
            }
        }
        applySearch();
    }

    // Open a mod's settings ('' = back to the list). The only writer of the persisted
    // view key.
    function openModView(id) {
        openMod = String(id || '');
        LS.set('lclitePanelMod', openMod);
        renderView();
        body.scrollTop = 0;
        layoutPanel();
    }
    backEl.addEventListener('click', () => openModView(''));

    // Search filters whatever is on screen: mod rows in the list, the open mod's own
    // rows in a mod's view. A mod row also matches on its settings' names (see modRow),
    // so typing a setting still finds the mod that owns it — and opening that mod then
    // shows only the rows that hit, because the query carries over.
    function applySearch() {
        const q = searchEl.value.trim().toLowerCase();
        hideTip();
        body.querySelectorAll('[data-name]').forEach(el => {
            el.classList.toggle('dim', q !== '' && !el.dataset.name.includes(q));
        });
        // groups with zero visible rows disappear entirely while searching
        body.querySelectorAll('.lcm-group').forEach(g => {
            const any = [...g.querySelectorAll('[data-name]')].some(r => !r.classList.contains('dim'));
            g.classList.toggle('hideresult', q !== '' && !any);
        });
        // the hairline under the core row only earns its line while a mod row below it
        // is still visible — a query that hides them all would leave it floating over
        // nothing
        body.querySelectorAll('.lcm-sep').forEach(sep => {
            let any = false;
            for (let n = sep.nextElementSibling; n; n = n.nextElementSibling) {
                if (n.classList.contains('lcm-prow') && !n.classList.contains('dim')) { any = true; break; }
            }
            sep.classList.toggle('hideresult', !any);
        });
    }
    searchEl.addEventListener('input', applySearch);

    function renderRows(installed) {
        // `installed` = Set of mod folder names from /lclite/installed.json, or
        // null (manifest unreadable = pre-selection install): show everything.
        installedSet = installed;
        modsList = buildModList(installed);
        renderView();
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
        if (v) { searchEl.value = ''; renderView(); searchEl.focus(); layoutPanel(); }
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
        if (e.key === 'Escape' && panel.classList.contains('open')) {
            if (openMod) openModView('');   // back out of a mod's settings first
            else open(false);
        }
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
    // default spot. Anchor = one of 9 points on the surface's REGION rect + a px
    // offset to the element's top-left, always clamped inside the rect, so a
    // dragged overlay can never be lost off-screen. DOM surfaces anchor to the
    // client window; canvas surfaces anchor to their own BUFFER (see regionRect).
    // Alt+drag moves, Alt+right-click resets, Escape cancels — same gestures as
    // RuneLite; lcmAnchor.reset(id) is the same reset for anything that is not a
    // pointer gesture (a panel row, another mod's ui.js).
    const ANCH = { TL: [0, 0], TC: [.5, 0], TR: [1, 0], ML: [0, .5], MC: [.5, .5], MR: [1, .5], BL: [0, 1], BC: [.5, 1], BR: [1, 1] };
    const SPECS = [];
    const SNAP_HIT = 34;          // px from an anchor point that snaps to it
    let suppressClick = 0;        // ts until which a surface click is drag-echo

    function gameRect() {
        // RuneLite parity: DOM surfaces anchor to the WHOLE client window (the
        // browser viewport) — the black letterbox around the scaled canvas is
        // valid real estate (that's where the FAB lives by default). Canvas-
        // drawn surfaces are limited by the game buffer itself; see regionRect().
        return { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight };
    }
    function placeXY(el, x, y) {
        el.style.left = Math.round(x) + 'px';
        el.style.top = Math.round(y) + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
    }
    function clampInto(r, x, y, w, h, m = 4) {
        // m = the margin a surface keeps from its region's edge. DOM surfaces keep 4px
        // so a dragged panel/FAB never sits flush against the viewport edge; canvas
        // surfaces are clamped FLUSH (m = 0) because their region IS the buffer they
        // draw into — flush placement is a legitimate look there (orbs hugging the
        // frame), and the owner clamps with the same margin.
        return [
            w + 2 * m < r.width ? Math.max(r.left + m, Math.min(x, r.left + r.width - w - m)) : x,
            h + 2 * m < r.height ? Math.max(r.top + m, Math.min(y, r.top + r.height - h - m)) : y
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
        // canvas-buffer surfaces (xp tracker, stat orbs): registered BY THE OWNER from the
        // bundle with a POSITIONAL array (terser mangles object-literal keys — same
        // boundary law as tcg's info()). No element: the drag layer shows a ghost box
        // sized by the owner's getBounds() (positional [x,y,w,h] in that buffer's OWN
        // px) and persists anchor/offset in those same units; the owner re-reads its own
        // keys per frame. a[6] is OPTIONAL and selects the buffer the surface lives in:
        // [x, y, w, h, bufferW, bufferH] in the canvas's 765x503 logical space (see
        // regionRect) — omit it for the game viewport (areaGame), pass it for anything
        // else (stat-orbs uses the minimap widget, areaMap at 550,4). a[7] is OPTIONAL
        // too: the OVERHANG [left, right, top, bottom] in the same buffer's px, as
        // DISTANCES OUTWARD (34 on the left = the box may hang 34px out of the region),
        // for a surface whose owner composites a buffer OUTSIDE the one it draws into
        // (the stat orbs paint the sidebar's stone strip left of the minimap widget
        // themselves, so the column may hang 34px out of the widget). It widens the
        // drag's clamp and the snap points ONLY — the anchor points and the stored
        // offsets stay the region's, so no saved placement shifts.
        registerCanvas(a) {
            const s = { id: a[0], el: null, canvas: true, anchorKey: a[1], offsetKey: a[2], defA: a[3], defO: a[4], getBounds: a[5], region: a[6] || null, overhang: a[7] || null };
            const i = SPECS.findIndex(x => x.id === s.id);
            if (i >= 0) SPECS[i] = s; else SPECS.push(s);
            return true;
        },
        // Put ONE surface back in its default spot. The drag layer is the only writer of
        // the anchor keys, so this is the sanctioned way for anyone else (a panel action
        // row, another mod's ui.js) to reset one: Alt+right-click in-game does the same.
        // Also reachable by dispatching `lcm-anchor-reset` with the surface id as detail.
        reset(id) {
            return resetSurface(id);
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
    // The GAME CANVAS rect — NOT the window. The page sizes the canvas to a scale of its
    // fixed 765x503 logical frame and centres it, so the black letterbox around it is
    // real estate the canvas cannot draw into; a canvas surface's region must therefore
    // be measured off the element itself. (Measuring it off the window put every canvas
    // ghost hundreds of px from its real pixels — the letterbox is that wide.)
    function canvasRect() {
        const el = document.getElementById('canvas');
        if (el) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return r;
        }
        return gameRect();   // pre-boot page (no canvas yet): window fallback
    }
    // A canvas surface's REGION = which BUFFER it draws into, as [x, y, w, h] in the
    // canvas's own 765x503 logical space, plus that buffer's pixel size [bw, bh].
    // Default = the game viewport (areaGame: 512x334 at 4,4) — the normal home of a
    // canvas overlay. stat-orbs passes the minimap widget instead (areaMap: 172x156 at
    // 550,4), and THAT buffer is its hard boundary. sx/sy convert buffer px <-> css px
    // per axis, and the owner applies the same 9-anchor math to its own keys.
    const VP_REGION = [4, 4, 512, 334, 512, 334];
    function regionRect(spec) {
        const c = canvasRect();
        const g = (spec && spec.region) || VP_REGION;
        const width = c.width * (g[2] / 765), height = c.height * (g[3] / 503);
        return {
            left: c.left + c.width * (g[0] / 765), top: c.top + c.height * (g[1] / 503),
            width: width, height: height, sx: width / g[4], sy: height / g[5]
        };
    }
    // The DRAGGABLE rect: the region, grown by the surface's own overhang (a[7] of
    // registerCanvas, in that buffer's px — DISTANCES OUTWARD, so 34 on the left means
    // "the box may hang 34px left of the region"). A mod may paint OUTSIDE the buffer it
    // draws into (stat-orbs composites the sidebar's stone strip left of the minimap
    // widget itself), so its box is allowed that far past the region. The ANCHOR POINTS
    // and the stored offsets stay the REGION's (see storePlacement) — this only widens
    // the clamp and moves the snap targets, so no saved placement shifts meaning.
    function dragRect(spec) {
        const r = regionRect(spec);
        const o = spec && spec.overhang;
        if (!o) return r;
        return {
            left: r.left - o[0] * r.sx, top: r.top - o[2] * r.sy,
            width: r.width + (o[0] + o[1]) * r.sx, height: r.height + (o[2] + o[3]) * r.sy,
            sx: r.sx, sy: r.sy
        };
    }
    // Store a placement from a box position. The ANCHOR is named against the draggable
    // rect (so the outermost reach of an overhanging surface is itself a snap point)
    // while the OFFSET is measured against the surface's own REGION — the owning mod
    // mirrors exactly this maths from the same keys, so the two must not drift.
    function storePlacement(spec, x, y, w, h, snap) {
        const r = spec.canvas ? regionRect(spec) : gameRect();
        const d = spec.canvas ? dragRect(spec) : r;
        let a = snap;
        if (!a) {   // free placement: anchor named by the box centre's drag rect
            const cx = x + w / 2 - d.left, cy = y + h / 2 - d.top;
            a = (cy < d.height / 3 ? 'T' : cy > d.height * 2 / 3 ? 'B' : 'M') +
                (cx < d.width / 3 ? 'L' : cx > d.width * 2 / 3 ? 'R' : 'C');
        }
        const k = ANCH[a] || ANCH.TR;
        const sx = spec.canvas ? r.sx : 1, sy = spec.canvas ? r.sy : 1;
        // canvas: store offsets in buffer px (x/sx, y/sy per-axis)
        LS.set(spec.anchorKey, a);
        LS.set(spec.offsetKey, Math.round((x - (r.left + r.width * k[0])) / sx) + ',' + Math.round((y - (r.top + r.height * k[1])) / sy));
        return a;
    }
    // Undo the live writes a cancelled drag made (Escape, window blur): a surface the
    // user did not place must be exactly where it was, keys included — an unset key has
    // to go back to UNSET, or the owner would read a placement nobody asked for.
    function restorePlacement(spec, keys) {
        if (!keys) return;
        if (keys.a === null) localStorage.removeItem(spec.anchorKey); else LS.set(spec.anchorKey, keys.a);
        if (keys.o === null) localStorage.removeItem(spec.offsetKey); else LS.set(spec.offsetKey, keys.o);
        window.dispatchEvent(new CustomEvent('lcm-anchor-changed', { detail: spec.id }));
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
        for (const spec of SPECS) {
            if (!spec.canvas) continue;
            let b = null;
            try { b = spec.getBounds && spec.getBounds(); } catch (err) { /* not visible */ }
            if (!b) continue;
            const vp = regionRect(spec);   // each canvas surface has its OWN buffer
            const r = { left: vp.left + b[0] * vp.sx, top: vp.top + b[1] * vp.sy, width: b[2] * vp.sx, height: b[3] * vp.sy };
            // explicit left+width (not r.right): these are plain objects, so a .right
            // read was always undefined and the hit test could never match at all
            if (e.clientX >= r.left && e.clientX <= r.left + r.width && e.clientY >= r.top && e.clientY <= r.top + r.height) {
                return { spec, r, sx: vp.sx, sy: vp.sy };
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
            box.classList.add('hollow');        // the surface itself moves under it — outline only
            window.lcmHeld = spec.id;           // owner keeps drawing while held
        }
        ds = {
            spec, box, w: r.width, h: r.height, sx, sy, moved: false, snap: null,
            grabX: e.clientX - r.left, grabY: e.clientY - r.top, origX: e.clientX, origY: e.clientY,
            // canvas surfaces are placed LIVE as the pointer moves (their owner draws from
            // these keys every frame), so the values they had before the drag are kept to
            // put back on a cancel — null = the key was UNSET.
            keys: spec.canvas ? { a: localStorage.getItem(spec.anchorKey), o: localStorage.getItem(spec.offsetKey) } : null,
            lastX: NaN, lastY: NaN,
            orig: { left: spec.el ? spec.el.style.left : '', top: spec.el ? spec.el.style.top : '', right: spec.el ? spec.el.style.right : '', bottom: spec.el ? spec.el.style.bottom : '' }
        };
        showDots(spec.canvas ? dragRect(spec) : gameRect(), true);
        window.dispatchEvent(new CustomEvent('lcm-drag', { detail: spec.id }));
        try { (spec.el || box).setPointerCapture(e.pointerId); } catch (err) { /* window listeners still fire */ }
    }, true);
    window.addEventListener('pointermove', e => {
        if (!ds) return;
        if (Math.abs(e.clientX - ds.origX) + Math.abs(e.clientY - ds.origY) > 3) ds.moved = true;
        const r = ds.spec.canvas ? dragRect(ds.spec) : gameRect();
        const [x, y] = clampInto(r, e.clientX - ds.grabX, e.clientY - ds.grabY, ds.w, ds.h, ds.spec.canvas ? 0 : 4);
        placeXY(ds.box, x, y);
        let best = null, bd = SNAP_HIT;
        for (const name in ANCH) {
            const k = ANCH[name];
            const d = Math.hypot(x - (r.left + r.width * k[0]), y - (r.top + r.height * k[1]));
            if (d < bd) { bd = d; best = name; }
        }
        ds.snap = best;
        if (snapLayer) [...snapLayer.children].forEach(d => d.classList.toggle('hot', d.dataset.anch === best));
        // LIVE placement for canvas surfaces: their owner draws itself from these keys
        // every frame, so writing them as the pointer moves is what makes the orbs (and
        // the xp tracker) FOLLOW the cursor instead of jumping into place on release.
        // Written as-is (unsnapped): the snap lands on release, like it always has.
        if (ds.moved && ds.spec.canvas && (x !== ds.lastX || y !== ds.lastY)) {
            ds.lastX = x; ds.lastY = y;
            storePlacement(ds.spec, x, y, ds.w, ds.h, null);
        }
    });
    window.addEventListener('pointerup', e => {
        if (!ds) return;
        const spec = ds.spec, box = ds.box;
        if (spec.canvas && box.parentNode) box.parentNode.removeChild(box);
        if (spec.canvas) window.lcmHeld = null;
        showDots(null, false);
        window.dispatchEvent(new CustomEvent('lcm-drag-end', { detail: spec.id }));
        if (ds.moved) {
            const x = parseFloat(box.style.left) || 0, y = parseFloat(box.style.top) || 0;
            const a = storePlacement(spec, x, y, ds.w, ds.h, ds.snap);
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
            restorePlacement(ds.spec, ds.keys);   // undo the live writes
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
    // Reset a surface to its default spot (the drag layer owns the keys — see the
    // lcmAnchor.reset doc above). Returns false for an unknown id so a caller can tell
    // "the panel has no such surface" (e.g. the mod is switched off / not installed).
    function resetSurface(id) {
        const spec = SPECS.find(s => s.id === id);
        if (!spec) return false;
        localStorage.removeItem(spec.anchorKey);
        localStorage.removeItem(spec.offsetKey);
        applySpec(spec);
        window.dispatchEvent(new CustomEvent('lcm-anchor-changed', { detail: spec.id }));
        layoutPanel();
        toast(`${spec.id === 'fab' ? 'FAB' : spec.id}: position reset`);
        return true;
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
        resetSurface(spec.id);
    }, true);
    // ...and the same thing over an event, for a page-side mod that has no reference
    // to this object (the panel's own rows call lcmAnchor.reset(id) directly).
    window.addEventListener('lcm-anchor-reset', e => { resetSurface(e.detail); });
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
    // The page's own green control row (#controls) is REPLACED by this panel: it is
    // hidden at boot, and the panel no longer offers a switch for it — the stored key
    // is dropped so an old 'true' cannot bring the bar back under the panel.
    function applyLegacyBar() {
        const legacy = document.getElementById('controls');
        if (!legacy) return;
        legacy.style.display = 'none';
    }
    localStorage.removeItem('lcliteLegacyBar');
    applyLegacyBar();

    // live sync for sliders + mod status lines (engine wheel changes
    // cameraZoom; gpu stats tick over) — keep UI honest
    setInterval(() => {
        for (const f of MODS) f._sync && f._sync();
        for (const p of MOD_REGISTRY) p._sync && p._sync();
    }, 400);

    // expose a tiny API for future mods
    window.lclite = { register(m) { MODS.push(m); renderView(); }, toast, reapply, client };
})();