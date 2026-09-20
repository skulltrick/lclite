// example-mod/ui.js — this mod's page script.
//
// A files/ payload is copied VERBATIM into the tree by `apply`:
//
//     mods/example-mod/files/engine/public/lclite/example-mod/ui.js
//         -> <install>/engine/public/lclite/example-mod/ui.js
//
// ...and the <script> tag the mod's own hunk adds to engine/view/client.ejs
// (patches/289/client_ejs.json) loads it from the page. No TypeScript, no bundle
// rebuild: a page script is a file the page asks for.
//
// Anything here runs in the PAGE's realm, next to panel.js, so it can use the DOM,
// localStorage and window.lostcityClient freely. It is NOT bundled, which means
// (a) console.log works even in a production build (a bundled mod's logs are
// stripped) and (b) it must not import anything from the client bundle.
(() => {
    'use strict';

    // Self-stamp. The version in the <script src="...?v=1"> tag and this number are
    // the same version: bump BOTH in the same commit. Browsers — Brave demonstrably
    // — re-serve a stale disk copy of a plain path past a hard refresh, so a stamp
    // is how a later version detects a stale copy (docs/MODS.md §version-keying).
    const VERSION = 1;
    window.__exampleModUi = VERSION;

    // The engine's own revision reaches the page on the control panel's script tag
    // (data-rev, from the `revision` local in src/web.ts). Treat an absent value as
    // "no gate" — never as revision 0 — because that tag can be missing on a stale
    // engine or a stripped hunk.
    const rev = (document.querySelector('script[data-rev]') || { dataset: {} }).dataset.rev || '';

    console.log(`[example-mod] ui.js v${VERSION} loaded${rev ? ` on revision ${rev}` : ''}`);

    // ---- your mod goes here -------------------------------------------------
    // Settings are ONE localStorage key of your own (camelCase, mod-prefixed),
    // read at YOUR hook site — never another mod's key, never a shared hub
    // (FOR_AGENTS_README.md rule 5). This mod's key: exampleMod
    //
    // A page script can only change the page (DOM, canvas CSS, panel chrome). To
    // change what the CLIENT does — drawing, input, packets — you need a hunk in
    // the TypeScript sources plus a rebuild; that is the other lane, and
    // docs/MAKING-A-MOD.md walks through it.
})();
