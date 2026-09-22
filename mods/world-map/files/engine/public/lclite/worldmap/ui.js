// lclite:world-map — the overlay controller (a PAGE script, not bundled).
//
// `apply` copies this file into <install>/engine/public/lclite/worldmap/ui.js and the
// mod's client.ejs hunk loads it:
//
//     <script src="/lclite/worldmap/ui.js?v=1" defer></script>
//
// WHAT IT DOES. It builds the full-frame overlay the minimap world orb opens: a fixed
// div sized to the game canvas, holding an IFRAME (map.html) that runs the client's own
// world map app. It owns everything about the overlay's life — build, place, scale,
// focus, close — and it is the ONLY writer of the DOM state the bundled core reads back
// (the orb's own highlight asks for #lcwm-root, so the orb and the overlay can never
// disagree about whether the map is showing).
//
// THE TWO BRIDGES.
//   * to the GAME bundle: it reads window['worldMapPlayer']() — a POSITIONAL array
//     [x, z, level, valid] in world tiles, exposed by the mod's Client.ts hunk and
//     terser-reserved in bundle.ts (an unreserved cross-realm name is silently
//     undefined). Nothing here reads any other client field.
//   * to the MAP app: it postMessages the position to the iframe, and the iframe's own
//     page script drives the app through ONE reserved entry point (worldMapUi). The
//     page/bundle boundary never carries an object literal, because the property
//     mangler renames literal keys (docs/MODS.md §The contract).
//
// FAIL-OPEN: every piece is optional. With the page script missing the orb does
// nothing; with the map bundle or the map data missing the overlay says so in words and
// the game is untouched.

(() => {
    'use strict';

    // Self-stamp: this number and the <script src="...?v=1"> tag in client.ejs are the
    // same version. Browsers (Brave demonstrably) re-serve a stale disk copy of a plain
    // path past a hard refresh, so the stamp is how a later version detects a stale copy
    // — and it also version-keys the two files this one loads (map.html, mapview.js).
    const VERSION = 1;
    window.__lcwmUi = VERSION;

    const ROOT_ID = 'lcwm-root';
    const FRAME_ID = 'lcwm-frame';
    const CARD_ID = 'lcwm-card';
    const GAME_W = 765;
    const GAME_H = 503;
    // Above the game canvas, BELOW the LCLite chrome: the FAB is 9500 and the tcg HUD is
    // 9600, so the panel and the FAB stay clickable over the map (that is how a player
    // changes a setting or closes things without losing their place on the map).
    const Z = 9400;

    let pollTimer = 0;
    let readyTimer = 0;
    let lastPlayer = '';
    let observer = null;
    // a fresh open centres once the map page reports ready (the iframe cannot take the
    // command before its app exists); an open overlay centres immediately
    let pendingCentre = false;

    function canvasEl() {
        return document.getElementById('canvas');
    }

    function rootEl() {
        return document.getElementById(ROOT_ID);
    }

    function frameEl() {
        return document.getElementById(FRAME_ID);
    }

    function isOpen() {
        return rootEl() !== null;
    }

    // ---- placement --------------------------------------------------------------
    // The overlay is the game canvas, exactly: same rect, same scale, same pixels. The
    // iframe is a fixed 765x503 document scaled by CSS, so the map is drawn at the
    // canvas's own scale and rides the panel's scale slider and the browser's zoom.
    function place() {
        const root = rootEl();
        const canvas = canvasEl();
        if (!root || !canvas) {
            return;
        }

        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return;
        }

        root.style.left = rect.left + 'px';
        root.style.top = rect.top + 'px';
        root.style.width = rect.width + 'px';
        root.style.height = rect.height + 'px';

        const frame = frameEl();
        if (frame) {
            const scale = rect.width / GAME_W;
            frame.style.transform = 'scale(' + scale + ')';
            frame.style.transformOrigin = '0 0';
        }
    }

    function card(text, withClose) {
        let el = document.getElementById(CARD_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = CARD_ID;
            el.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;'
                + 'justify-content:center;gap:10px;padding:0 40px;box-sizing:border-box;text-align:center;'
                + 'background:#12100e;font:13px/1.5 system-ui,\'Segoe UI\',sans-serif;color:#e8e0cc';
            const root = rootEl();
            if (root) {
                root.appendChild(el);
            }
        }

        el.textContent = text;

        if (withClose && !document.getElementById(CARD_ID + '-close')) {
            const btn = document.createElement('button');
            btn.id = CARD_ID + '-close';
            btn.textContent = 'Close';
            btn.style.cssText = 'font:inherit;color:inherit;background:#1c1a16;border:1px solid #4d4233;'
                + 'border-radius:2px;padding:4px 12px;cursor:pointer';
            btn.addEventListener('click', () => close());
            el.appendChild(btn);
        }
    }

    function cardHide() {
        const el = document.getElementById(CARD_ID);
        if (el) {
            el.remove();
        }
    }

    // ---- the live player ----------------------------------------------------------
    // Read from the game bundle once per tick, sent to the iframe only when it changes
    // (the map app redraws the world map on every accepted position, and that is real
    // work — 4Hz while standing still would be pure waste).
    function pollPlayer() {
        const frame = frameEl();
        const read = window['worldMapPlayer'];
        if (!frame || !frame.contentWindow || typeof read !== 'function') {
            return;
        }

        let p;
        try {
            p = read();
        } catch (_e) {
            return;
        }

        if (!Array.isArray(p) || p.length < 4) {
            return;
        }

        const key = p.join(',');
        if (key === lastPlayer) {
            return;
        }
        lastPlayer = key;

        try {
            frame.contentWindow.postMessage({ lcwm: 'player', p }, location.origin);
        } catch (_e) {
            // the frame is gone; the close path cleans up
        }
    }

    // ---- open / close -------------------------------------------------------------
    function open(centre) {
        if (isOpen() || !document.body) {
            if (centre && isOpen()) {
                const frame = frameEl();
                if (frame && frame.contentWindow) {
                    frame.contentWindow.postMessage({ lcwm: 'centre' }, location.origin);
                }
            }
            return;
        }

        pendingCentre = centre === true;

        const root = document.createElement('div');
        root.id = ROOT_ID;
        root.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:' + Z
            + ';overflow:hidden;background:#000;box-shadow:0 0 0 1px #4d4233';
        // the overlay owns every click inside it: the game underneath must not also see
        // them (a click on the map is not a walk)
        root.addEventListener('mousedown', (e) => e.stopPropagation());
        root.addEventListener('mouseup', (e) => e.stopPropagation());
        root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

        const frame = document.createElement('iframe');
        frame.id = FRAME_ID;
        frame.setAttribute('title', 'World map');
        frame.setAttribute('allow', '');
        frame.style.cssText = 'width:' + GAME_W + 'px;height:' + GAME_H + 'px;border:0;display:block;background:#000';
        frame.src = '/lclite/worldmap/map.html?v=' + VERSION;
        root.appendChild(frame);

        document.body.appendChild(root);
        place();

        card('Opening the world map\u2026', true);
        readyTimer = window.setTimeout(() => {
            // the map page always loads (it is a static payload file), so silence means
            // it never got as far as its own ready message
            if (isOpen() && !lastPlayer && document.getElementById(CARD_ID)) {
                card('The world map did not start. Check the browser console, then close this and try again.', true);
            }
        }, 8000);

        pollTimer = window.setInterval(pollPlayer, 250);
        pollPlayer();

        // the game page must not keep the keyboard while the map is up: the map's own
        // keys (zoom, key, overview) live in the iframe's document
        window.setTimeout(() => {
            const f = frameEl();
            if (f) {
                try {
                    f.focus();
                    if (f.contentWindow) {
                        f.contentWindow.focus();
                    }
                } catch (_e) {
                    // focus is a courtesy; the map works without it
                }
            }
        }, 300);

        if (typeof ResizeObserver === 'function') {
            observer = new ResizeObserver(() => place());
            const canvas = canvasEl();
            if (canvas) {
                observer.observe(canvas);
            }
        }
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
    }

    function close() {
        const root = rootEl();
        if (root) {
            root.remove();
        }

        if (pollTimer) {
            window.clearInterval(pollTimer);
            pollTimer = 0;
        }
        if (readyTimer) {
            window.clearTimeout(readyTimer);
            readyTimer = 0;
        }
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        window.removeEventListener('scroll', place, true);
        window.removeEventListener('resize', place);
        lastPlayer = '';
    }

    function toggle(centre) {
        if (isOpen()) {
            close();
        } else {
            open(centre);
        }
    }

    // ---- the game bundle's entry points (both reserved in bundle.ts) --------------
    window['worldMapToggle'] = (centre) => toggle(centre === 1);
    window['worldMapOpen'] = (centre) => open(centre === 1);
    window['worldMapClose'] = () => close();

    // ---- the map page's own messages ---------------------------------------------
    window.addEventListener('message', (e) => {
        if (e.origin !== location.origin) {
            return;
        }

        const d = e.data || {};
        if (d.lcwm === 'close') {
            close();
        } else if (d.lcwm === 'ready') {
            if (readyTimer) {
                window.clearTimeout(readyTimer);
                readyTimer = 0;
            }
            cardHide();
            place();
            if (pendingCentre) {
                pendingCentre = false;
                const frame = frameEl();
                if (frame && frame.contentWindow) {
                    frame.contentWindow.postMessage({ lcwm: 'centre' }, location.origin);
                }
            }
            pollPlayer();
        } else if (d.lcwm === 'error') {
            // the map page draws its own card; the parent only stops waiting for ready
            if (readyTimer) {
                window.clearTimeout(readyTimer);
                readyTimer = 0;
            }
        }
    });

    // Esc closes from the parent's side too (the map page sends its own on Escape)
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) {
            close();
        }
    }, true);

    console.log('[world-map] ui.js v' + VERSION + ' loaded');
})();
