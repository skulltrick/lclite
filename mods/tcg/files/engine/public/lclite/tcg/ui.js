/* lclite:tcg
   TCG DOM layer — credits HUD, pack reveal overlay, collection album.
   Plain page script (NOT bundled), loaded by the client.ejs hunk right after
   panel.js; the bundled core (tcg_core.ts) exposes the window['tcg*'] API with
   POSITIONAL array contracts (terser property mangling makes cross-boundary
   object literals unreadable — see tcg_core.ts header for the index maps).
   Talks to the engine ONLY through those globals + the 'tcg' localStorage key
   — no canvas DOM injection, no game-frame coupling. If the core hunk failed
   on a future rev, every entry point no-ops and the game is untouched. */
(() => {
    'use strict';

    const TIER_COLORS = ['#f5f5f5', '#2ecc71', '#3498db', '#9b59b6', '#e74c3c', '#ff6ec7', '#f2c94c'];
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = n => Math.floor(n || 0).toLocaleString('en-US');
    const masterOn = () => (localStorage.getItem('tcg') || 'true') === 'true';

    // info() indices — must match tcg_core.ts
    const I_CREDITS = 0, I_XPPOOL = 1, I_PRICE = 2, I_PACKS = 3, I_EARN_XP = 6, I_EARN_LVL = 7, I_EARN_DUP = 8,
        I_SINCE = 10, I_UNIQUE = 11, I_CATSIZ = 13, I_ACCT = 14, I_EARN_KILL = 15, I_KILLS = 16;
    // pull[] indices: [key, name, tier, foil]
    const P_KEY = 0, P_NAME = 1, P_TIER = 2, P_FOIL = 3;
    // album row[] indices: [key, name, tier, tags, img, owned, foils]
    const A_NAME = 1, A_TIER = 2, A_IMG = 4, A_OWNED = 5, A_FOILS = 6;

    let root, hud, toastEl, scrim, albumEl;
    let toastT = 0;

    const style = document.createElement('style');
    style.id = 'lctcg-style';
    style.textContent = `
/* z 9600: above #lclite-root (9000) + #lclite-tip (9500) — the reveal/album must
   never land behind the LCLite chrome; the HUD itself is anchored to the canvas
   top-LEFT by JS (tick) so it never fights the FAB at viewport top-right. */
#lctcg-root { position: fixed; inset: 0; z-index: 9600; pointer-events: none; font-family: 'Segoe UI', sans-serif; }
#lctcg-root input, #lctcg-root select, #lctcg-root button { font-family: inherit; }
.lctcg-hud { position: fixed; top: 10px; left: 10px; display: none; flex-direction: column; align-items: flex-end;
    background: rgba(22,17,10,.92); border: 1px solid #6b5a3a; border-radius: 8px; padding: 7px 12px;
    color: #ffe7a8; pointer-events: auto; cursor: pointer; user-select: none; min-width: 118px; }
.lctcg-hud .coins { font-size: 16px; font-weight: 600; letter-spacing: .3px; }
.lctcg-hud .rate { font-size: 10px; color: #7fd07f; min-height: 12px; }
.lctcg-hud .sub { font-size: 10px; color: #b8a67e; }
.lctcg-toast { position: fixed; top: 84px; left: 50%; transform: translateX(-50%); background: rgba(22,17,10,.94);
    border: 1px solid #6b5a3a; color: #ffe7a8; padding: 7px 16px; border-radius: 8px; font-size: 13px;
    opacity: 0; transition: opacity .25s; pointer-events: none; max-width: 70vw; text-align: center; }
.lctcg-toast.show { opacity: 1; }
.lctcg-scrim { position: absolute; inset: 0; background: rgba(6,5,3,.88); display: none;
    align-items: center; justify-content: center; flex-direction: column; pointer-events: auto; }
.lctcg-scrim.open { display: flex; }
.lctcg-reveal { text-align: center; }
.lctcg-reveal h2 { color: #ffe7a8; font-size: 19px; margin: 0 0 2px; font-weight: 600; }
.lctcg-reveal .apex { color: #f2c94c; text-shadow: 0 0 12px #f2c94c88; }
.lctcg-reveal .creditline { color: #b8a67e; font-size: 12px; margin-bottom: 10px; }
.lctcg-cards { display: flex; gap: 14px; margin: 16px 0; justify-content: center; }
.lctcg-card { width: 150px; border-radius: 10px; padding: 8px; background: #171310; border: 2px solid var(--tc,#fff);
    box-shadow: 0 0 16px -2px var(--tc,#fff); transition: transform .45s ease, opacity .3s ease; opacity: 0; transform: rotateY(90deg) scale(.85); }
.lctcg-card.done { opacity: 1; transform: none; }
.lctcg-card .face { position: relative; height: 140px; display: flex; align-items: center; justify-content: center;
    background: #0d0b09; border-radius: 6px; overflow: hidden; }
.lctcg-card.f .face { background: radial-gradient(circle at 30% 25%, #46506e 0%, #14151f 55%, #06070c 100%); }
.lctcg-card .face img { max-height: 126px; max-width: 126px; }
.lctcg-card .foil { position: absolute; top: 4px; right: 6px; font-size: 10px; color: #ffe7a8; text-shadow: 0 0 6px #fff; }
.lctcg-card .nm { color: #eee; font-size: 12px; margin: 7px 0 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lctcg-card .tr { font-size: 10px; font-weight: 700; color: var(--tc,#fff); text-transform: uppercase; letter-spacing: .6px; }
.lctcg-back { width: 150px; height: 204px; border-radius: 10px; border: 2px solid #6b5a3a; background:
    repeating-linear-gradient(45deg, #241c10 0 8px, #1a140b 8px 16px); color: #8a7454; display: flex;
    align-items: center; justify-content: center; font-size: 26px; }
.lctcg-sell { color: #cbb27f; font-size: 12px; min-height: 18px; margin: 4px 0; }
.lctcg-btn { background: #2b2417; color: #ffe7a8; border: 1px solid #6b5a3a; border-radius: 7px; padding: 7px 18px; cursor: pointer; font-size: 13px; margin: 3px; }
.lctcg-btn:hover { background: #3a3120; }
.lctcg-album { position: absolute; inset: 20px max(24px, 8vw); background: #14100bee; border: 1px solid #6b5a3a; border-radius: 10px;
    color: #ddd; display: none; flex-direction: column; pointer-events: auto; overflow: hidden; }
.lctcg-album.open { display: flex; }
.lctcg-album header { display: flex; gap: 8px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #2c2517; flex-wrap: wrap; }
.lctcg-album header h3 { margin: 0 10px 0 0; color: #ffe7a8; font-size: 16px; font-weight: 600; }
.lctcg-album input, .lctcg-album select { background: #221b10; color: #ffe7a8; border: 1px solid #4e3f27; border-radius: 6px; padding: 4px 8px; font-size: 12px; }
.lctcg-album .stats { font-size: 11px; color: #b8a67e; margin-left: auto; text-align: right; line-height: 1.5; }
.lctcg-grid { flex: 1; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(146px, 1fr)); gap: 10px; padding: 12px; align-content: start; }
.lctcg-cell { border-radius: 8px; border: 1.5px solid #2c2517; background: #171310; padding: 5px; position: relative; }
.lctcg-cell.disc { border-color: var(--tc,#2c2517); }
.lctcg-cell .face { height: 92px; display: flex; align-items: center; justify-content: center; background: #0d0b09; border-radius: 5px; overflow: hidden; }
.lctcg-cell .face img { max-height: 86px; max-width: 86px; }
.lctcg-cell.undis { opacity: .5; }
.lctcg-cell.undis .face img { filter: brightness(0) opacity(.4); }
.lctcg-cell .nm { font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 4px; }
.lctcg-cell .tr { font-size: 8.5px; text-transform: uppercase; letter-spacing: .4px; color: var(--tc,#b8a67e); }
.lctcg-cell .own { position: absolute; top: 3px; right: 5px; font-size: 10px; color: #ffe7a8; background: rgba(0,0,0,.65); border-radius: 4px; padding: 0 4px; }
.lctcg-tierbar { display: flex; gap: 10px; padding: 7px 14px; border-top: 1px solid #2c2517; font-size: 10.5px; flex-wrap: wrap; }
`;
    document.head.appendChild(style);

    function build() {
        window.__lctcgUi = 5;           // stamp the core checks (replace stale cached copies)
        console.log('[lclite:tcg] ui v5');
        root = document.createElement('div');
        root.id = 'lctcg-root';
        root.innerHTML = `
            <div class="lctcg-hud" id="lctcg-hud" title="TCG — click: open a Standard Pack · right-click: collection album">
                <div class="coins">◈ <span id="lctcg-credits">0</span></div>
                <div class="rate" id="lctcg-rate"></div>
                <div class="sub" id="lctcg-prog"></div>
            </div>
            <div class="lctcg-toast" id="lctcg-toast"></div>
            <div class="lctcg-scrim" id="lctcg-scrim"></div>
            <div class="lctcg-album" id="lctcg-album"></div>`;
        document.body.appendChild(root);
        hud = root.querySelector('#lctcg-hud');
        toastEl = root.querySelector('#lctcg-toast');
        scrim = root.querySelector('#lctcg-scrim');
        albumEl = root.querySelector('#lctcg-album');

        hud.addEventListener('click', e => { if (e.altKey) return; if (window.tcgOpenPack) window.tcgOpenPack(); });
        hud.addEventListener('contextmenu', e => { if (e.altKey) return; e.preventDefault(); openAlbum(); });

        window.tcgBumpToast = bumpToast;
        window.tcgShowReveal = showReveal;
        window.tcgShowAlbum = openAlbum;
        // offer the HUD to the control panel's alt-drag layer (absent panel =>
        // no drag, anchorHud keeps paying attention to the keys anyway)
        if (window.lcmAnchor && window.lcmAnchor.register) {
            window.lcmAnchor.register({ id: 'tcg-hud', el: hud, anchorKey: 'lcmTcgHudAnchor', offsetKey: 'lcmTcgHudOffset', defA: 'TL', defO: '8,8', owner: true });
        }
        addEventListener('lcm-anchor-changed', e => { if (e.detail === 'tcg-hud') anchorHud(); });
        window.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAlbum(); } });
        setInterval(tick, 500);
        tick();
    }

    function bumpToast(msg) {
        if (!toastEl) { return; }
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastT);
        toastT = setTimeout(() => toastEl.classList.remove('show'), 2800);
    }

    // ── HUD: credits, lifetime credits/h, progress to the next pack ──────────
    // default: canvas top-LEFT (8px inset) — the game frame can be any size on
    // the page, and viewport top-right belongs to the LCLite FAB. The FAB may
    // itself be alt-dragged (lcmAnchor): when it is, the HUD parks opposite the
    // FAB on the same row, so the two never overlap and both stay visible.
    // OWN placement via the lcmTcgHudAnchor/Offset keys (rule 5: we read our own
    // key at our own hook; the panel's drag layer is the only WRITER). Paused
    // mid-drag (lcm-drag) so the drag ghost doesn't fight this tick.
    let draggingHud = false;
    addEventListener('lcm-drag', e => { if (e.detail === 'tcg-hud') draggingHud = true; });
    addEventListener('lcm-drag-end', () => { draggingHud = false; });
    const ANCH9 = { TL: [0, 0], TC: [.5, 0], TR: [1, 0], ML: [0, .5], MC: [.5, .5], MR: [1, .5], BL: [0, 1], BC: [.5, 1], BR: [1, 1] };
    function anchorHud() {
        if (draggingHud) { return; }
        const c = document.getElementById('canvas');
        if (!c) { return; }
        const r = c.getBoundingClientRect();
        const A = localStorage.getItem('lcmTcgHudAnchor');
        let x, y;
        if (A && ANCH9[A]) {
            const o = (localStorage.getItem('lcmTcgHudOffset') || '0,0').split(',');
            const k = ANCH9[A];
            x = r.left + r.width * k[0] + (parseFloat(o[0]) || 0);
            y = r.top + r.height * k[1] + (parseFloat(o[1]) || 0);
        } else {
            const fab = document.getElementById('lclite-fab');
            const fr = fab && fab.getBoundingClientRect();
            const fabLeft = !!(fr && r.width && (fr.left + fr.width / 2 - r.left) < r.width / 2);
            x = r.left + (fabLeft ? r.width - hud.offsetWidth - 8 : 8);
            y = r.top + 8;
            if (fr && r.width && x < fr.right && x + hud.offsetWidth > fr.left && y < fr.bottom) {
                y = fr.bottom + 6;              // same row collides with a dragged FAB: park below it
            }
        }
        hud.style.left = Math.round(Math.max(r.left + 4, Math.min(x, r.right - hud.offsetWidth - 4))) + 'px';
        hud.style.top = Math.round(Math.max(r.top + 4, Math.min(y, r.bottom - hud.offsetHeight - 4))) + 'px';
        hud.style.right = 'auto';
    }

    function tick() {
        if (!hud || !window.tcgInfo) { return; }
        if (!masterOn()) { hud.style.display = 'none'; return; }
        let i;
        try { i = window.tcgInfo(); } catch (e) { return; }   // core not ready
        hud.style.display = 'flex';
        anchorHud();
        root.querySelector('#lctcg-credits').textContent = fmt(i[I_CREDITS]);
        const earned = i[I_EARN_XP] + i[I_EARN_LVL] + i[I_EARN_DUP] + (i[I_EARN_KILL] || 0);   // grants excluded
        const hours = Math.max(1 / 60, (Date.now() - i[I_SINCE]) / 3600000);
        root.querySelector('#lctcg-rate').textContent = earned > 0 ? '+' + fmt(earned / hours) + '/h' : '';
        const need = i[I_PRICE] - (i[I_CREDITS] % i[I_PRICE]);
        const prog = root.querySelector('#lctcg-prog');
        prog.textContent = fmt(need === i[I_PRICE] ? i[I_PRICE] : need) + ' to next pack';
        prog.title = 'unbanked xp pool: ' + fmt(i[I_XPPOOL]) + ' xp\npacks opened: ' + fmt(i[I_PACKS]) +
            '\nearned — xp: ' + fmt(i[I_EARN_XP]) + ' · levels: ' + fmt(i[I_EARN_LVL]) + ' · dup sales: ' + fmt(i[I_EARN_DUP]) +
            '\naccount: ' + i[I_ACCT];
    }

    // ── pack reveal (beta cadence: cards flip one at a time, sell after last) ─
    function showReveal(pulls, sell, apex) {
        if (!scrim) { window.tcgRevealClosed && window.tcgRevealClosed(); return; }
        const info = window.tcgInfo();
        scrim.innerHTML = `<div class="lctcg-reveal">
            <h2 class="${apex ? 'apex' : ''}">${apex ? '✦ APEX PACK ✦' : 'Standard Pack'}</h2>
            <div class="creditline">◈ ${fmt(info[I_CREDITS])} credits remaining</div>
            <div class="lctcg-cards" id="lctcg-drag">${pulls.map(() => '<div class="lctcg-back">✦</div>').join('')}</div>
            <div class="lctcg-sell" id="lctcg-sell"></div>
            <div><button class="lctcg-btn" id="lctcg-open">Open pack</button>
            <button class="lctcg-btn" id="lctcg-close" style="display:none">Done</button></div>
        </div>`;
        scrim.classList.add('open');
        const drag = scrim.querySelector('#lctcg-drag');
        scrim.querySelector('#lctcg-open').addEventListener('click', e => {
            e.target.disabled = true;
            window.tcgEnsureCatalog(() => {
                pulls.forEach((p, idx) => {
                    setTimeout(() => {
                        const c = window.tcgCardBy(p[P_KEY]);        // [name, tier, img]
                        const div = document.createElement('div');
                        div.className = 'lctcg-card' + (p[P_FOIL] ? ' f' : '');
                        div.style.setProperty('--tc', TIER_COLORS[p[P_TIER]]);
                        div.innerHTML = `<div class="face"><img src="${c && c[2] ? esc(c[2]) : ''}" alt="" onerror="this.style.display='none'">${p[P_FOIL] ? '<span class="foil">✦ FOIL</span>' : ''}</div>
                            <div class="nm" title="${esc(p[P_NAME])}">${esc(p[P_NAME])}</div>
                            <div class="tr">${esc(window.tcgTierLabel(p[P_TIER]))}</div>`;
                        if (drag.children[idx]) { drag.children[idx].replaceWith(div); }
                        requestAnimationFrame(() => requestAnimationFrame(() => div.classList.add('done')));
                        if (idx === pulls.length - 1) { setTimeout(showAfter, 700); }
                    }, 150 + idx * 500);
                });
            });
        });

        function showAfter() {
            const keys = Object.keys(sell || {});
            if (keys.length) {
                let total = 0;
                for (const k of keys) { total += sell[k]; }
                const sellEl = scrim.querySelector('#lctcg-sell');
                const btn = document.createElement('button');
                btn.className = 'lctcg-btn';
                btn.textContent = 'Sell duplicates (+' + fmt(total) + ' ◈)';
                sellEl.textContent = keys.length + ' duplicate' + (keys.length > 1 ? 's' : '') + ' in this pack: ';
                sellEl.appendChild(btn);
                btn.addEventListener('click', () => {
                    const got = window.tcgSellDuplicates(sell);
                    sellEl.textContent = got > 0 ? 'Sold for +' + fmt(got) + ' credits' : 'Nothing to sell';
                });
            }
            const closeBtn = scrim.querySelector('#lctcg-close');
            closeBtn.style.display = '';
            closeBtn.addEventListener('click', close);
        }
        function close() {
            scrim.classList.remove('open');
            scrim.innerHTML = '';
            window.tcgRevealClosed && window.tcgRevealClosed();
            tick();
        }
    }

    // ── collection album ──────────────────────────────────────────────────────
    const F = { search: '', tier: -1, cat: '', owned: false };
    function openAlbum() {
        if (!albumEl || albumEl.classList.contains('open')) { return; }
        window.tcgEnsureCatalog(renderAlbum);
    }
    function closeAlbum() { if (albumEl) { albumEl.classList.remove('open'); } }

    function renderAlbum() {
        const meta = window.tcgCatalogMeta();   // [version, cards, labels, cats, tiers]
        const i = window.tcgInfo();
        if (!meta) {
            albumEl.innerHTML = `<header><h3>Collection Album</h3><div class="stats">catalog unavailable — run <code>node tools/lclite.mjs apply</code></div></header>`;
            albumEl.classList.add('open');
            return;
        }
        albumEl.innerHTML = `
        <header>
            <h3>Collection Album</h3>
            <input id="lctcg-q" placeholder="Search…" value="${esc(F.search)}">
            <select id="lctcg-tier"><option value="-1">All rarities</option>${meta[2].map((l, t) => `<option value="${t}" ${F.tier === t ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <select id="lctcg-cat"><option value="">All categories</option>${meta[3].map(c => `<option value="${esc(c[0])}" ${F.cat === c[0] ? 'selected' : ''}>${esc(c[0])} (${fmt(c[1])})</option>`).join('')}</select>
            <label style="font-size:11px;color:#b8a67e"><input type="checkbox" id="lctcg-owned" ${F.owned ? 'checked' : ''}> owned only</label>
            <button class="lctcg-btn" id="lctcg-close">✕ Close</button>
            <div class="stats">◈ ${fmt(i[I_CREDITS])} · ${fmt(i[I_UNIQUE])} / ${fmt(meta[1])} discovered · packs ${fmt(i[I_PACKS])}<br>
            <span style="color:#6b5a3a">catalog v${esc(String(meta[0]))} · art © OSRS Wiki</span></div>
        </header>
        <div class="lctcg-grid" id="lctcg-grid"></div>
        <div class="lctcg-tierbar">${meta[4].map((t, idx) =>
            `<span style="color:${TIER_COLORS[idx]}">${t[0]}: <b>${fmt(t[2])}/${fmt(t[1])}</b></span>`).join('')}</div>`;
        const grid = albumEl.querySelector('#lctcg-grid');
        let fillT = 0;
        function fill() {
            clearTimeout(fillT);
            fillT = setTimeout(() => {
                const rows = window.tcgAlbum(F.search, F.tier, F.cat, F.owned);
                grid.innerHTML = rows.slice(0, 600).map(c => {
                    const owned = c[A_OWNED] + c[A_FOILS] > 0;
                    return `<div class="lctcg-cell ${owned ? 'disc' : 'undis'}" style="--tc:${TIER_COLORS[c[A_TIER]]}"
                        title="${esc(c[A_NAME])}${owned ? ' — ' + c[A_OWNED] + '×' + (c[A_FOILS] ? ' +' + c[A_FOILS] + ' foil' : '') : ' — not discovered'}">
                        <div class="face"><img loading="lazy" src="${esc(c[A_IMG])}" alt="" onerror="this.style.display='none'"></div>
                        <div class="nm">${esc(c[A_NAME])}</div><div class="tr">${esc(window.tcgTierLabel(c[A_TIER]))}</div>
                        ${owned ? `<div class="own">${c[A_OWNED]}${c[A_FOILS] ? ' ✦' + c[A_FOILS] : ''}</div>` : ''}</div>`;
                }).join('') + (rows.length > 600 ? `<div style="color:#6b5a3a;padding:8px">… ${fmt(rows.length - 600)} more — refine the search</div>` : '');
            }, 120);
        }
        fill();
        albumEl.classList.add('open');
        albumEl.querySelector('#lctcg-close').addEventListener('click', closeAlbum);
        albumEl.querySelector('#lctcg-q').addEventListener('input', e => { F.search = e.target.value; fill(); });
        albumEl.querySelector('#lctcg-tier').addEventListener('change', e => { F.tier = parseInt(e.target.value); fill(); });
        albumEl.querySelector('#lctcg-cat').addEventListener('change', e => { F.cat = e.target.value; fill(); });
        albumEl.querySelector('#lctcg-owned').addEventListener('change', e => { F.owned = e.target.checked; fill(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build);
    } else {
        build();
    }
})();
