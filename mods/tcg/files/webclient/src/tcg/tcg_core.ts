/* lclite:tcg
   TCG core — a credit / booster-pack / collection minigame for the Lost City
   webclient, modeled on Azderi's OSRS TCG RuneLite plugin (BSD-2-Clause
   (c) 2026 Azderi): same 7 rarity tiers + cumulative roll odds, level-based
   score, per-category percentile tiering with value/score tie unification,
   1/3000 apex packs, 1% foil, dup-sell at round(score)/200 (min 10), and the
   1,000xp -> 100-credit / level-up 1,250..25,000 curve (user's simplification
   of the XP half of that plugin's economy) plus kill credits = npc combat
   level (the plugin's third earning path, fed from Client.ts npc-update
   hunks — see the kill-credits section; combat-skill xp pays no chunks so
   grinding doesn't double-dip, exactly like the beta's COMBAT_SKILLS rule).
   Reimplemented for this client, not
   ported: persistence is localStorage keyed per username, the card catalog is
   `/lclite/tcg/cards.json` (art streams from the OSRS wiki CDN), and
   all visuals live in the DOM layer (mods/tcg/files/engine/public/.../ui.js).
   The credits HUD is MOVABLE: hold Alt and drag it to any of the 9 anchor
   points (control-panel's placement layer writes lcmTcgHudAnchor/Offset; the
   HUD reads its own keys per tick, dodges a relocated FAB by default, and
   pauses while the drag ghost owns it — see docs/MODS.md "Placement"). It also
   only draws while a player is logged in (tcgLoggedIn, below) and honours the
   control panel's per-part switches (tcgHud / tcgHudCredits / tcgHudRate /
   tcgHudProgress, read by ui.js at its own tick — rule 5).

   BUNDLED into client.js via one side-effect import hunk in Client.ts. Terser
   rules that shaped this file (each learned the hard way):
   - every cross-realm NAME must be reached as window['string'] AND listed in
     bundle.ts's terser reserves (the tcg hunk) — the property mangler renames
     string-literal property definitions too;
   - every cross-realm VALUE crosses as a POSITIONAL ARRAY — object literals
     returned to the page arrive with mangled keys;
   - the persisted save is likewise POSITIONAL ARRAYS + dynamic-key maps
     (numeric stat ids, card-name keys): fixed quoted keys would be mangled
     per-build and orphan everyone's collections on the next rebuild. */
(function (): void {
    const W: any = window as any;
    if (W['tcgInfo']) {
        return; // already loaded (double import guard)
    }

    // ── tunables (rates mirrored from the OSRS TCG beta) ─────────────────────
    const XP_PER_CHUNK = 1000;          // every 1,000 xp banked...
    const CREDITS_PER_CHUNK = 100;      // ...pays 100 credits
    const PACK_PRICE = 2500;            // Standard Pack (beta Packs.json)
    const PACK_SIZE = 5;
    const FOIL_CHANCE = 1;              // beta RewardTuningState default, %
    const APEX_CHANCE_DENOM = 3000;     // 1/3000 packs roll apex: top-3 tiers, 5x foil
    const APEX_FOIL_MULT = 5;
    const TOP_TIER_RATIO = 3;           // LEG/MYT/GOD pools pull score-weighted, 3:1 cheap-first
    const LEVEL_UP_FLOOR = 1250;        // level-up bonus: 1,250 at lv2 ...
    const LEVEL_UP_CAP = 25000;         // ... 25,000 at lv99 (exp curve, steepness 2.5)
    const LEVEL_UP_STEEPNESS = 2.5;
    const DUP_SELL_DIVISOR = 200;       // dup sell = max(10, round(score)/200)
    const DUP_SELL_MIN = 10;
    const SELL_MAX_PER_PACK = 4;        // sell-back offers capped per opening

    // kill credits (beta NpcKillCreditTracker parity): credits = npc combat
    // level, floor 1; a death only counts when the player ENGAGED the npc within
    // INTERACT_TIMEOUT (beta 12 game ticks; loopCycle runs ~52/s -> ~7.2s).
    const KILL_MIN_CREDITS = 1;
    const INTERACT_TIMEOUT_CYCLES = 400;
    // beta COMBAT_SKILLS: these earn credits through kills, not xp chunks.
    // (stat ids: attack0 defence1 strength2 hitpoints3 ranged4 magic6 —
    // hitpoints/prayer stay chunk-credited, matching the plugin's enum.)
    const COMBAT_XP_STATS: Record<number, boolean> = { 0: true, 1: true, 2: true, 4: true, 6: true };

    const KEY_STATE = 'lcliteTcg';      // { "username": save }
    const KEY_MASTER = 'tcg';           // this mod's master switch (its OWN key, rule 5)
    // ?v= cache key: 'force-cache' happily serves a STALE catalog forever (Brave
    // bit us exactly this way) — bump v with any cards.json format change.
    const CAT_URL = '/lclite/tcg/cards.json?v=7';
    const UI_SRC = '/lclite/tcg/ui.js?v=8';
    const UI_VER = 8;                   // ui.js stamps window.__lctcgUi; stale UI is re-fetched+replaced

    const TIER_LABELS = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Godly'];

    // ── utils ─────────────────────────────────────────────────────────────────
    function fmt(n: number): string { return Math.floor(n).toLocaleString('en-US'); }
    function clamp(n: number, lo: number, hi: number): number { return n < lo ? lo : n > hi ? hi : n; }
    function log(msg: string): void { try { console.log('[lclite:tcg] ' + msg); } catch (e) { /* empty */ } }
    function toast(msg: string): void { if (W['tcgBumpToast']) { W['tcgBumpToast'](msg); } }

    // xmur3 + sfc32 (deterministic seed → rng, for ::tcg roll <seed> replays)
    function xmur3(str: string): () => number {
        let h = 1779033703 ^ str.length;
        for (let i = 0; i < str.length; i++) {
            h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
            h = (h << 13) | (h >>> 19);
        }
        return function (): number {
            h = Math.imul(h ^ (h >>> 16), 2246822507);
            h = Math.imul(h ^ (h >>> 13), 3266489909);
            return (h ^= h >>> 16) >>> 0;
        };
    }
    function sfc32(a: number, b: number, c: number, d: number): () => number {
        return function (): number {
            a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
            let t = (a + b) | 0;
            a = b ^ (b >>> 9);
            b = (c + (c << 3)) | 0;
            c = (c << 21) | (c >>> 11);
            d = (d + 1) | 0;
            t = (t + d) | 0;
            c = (c + t) | 0;
            return (t >>> 0) / 4294967296;
        };
    }
    function seededRng(seed: string): () => number {
        const f = xmur3(seed);
        return sfc32(f(), f(), f(), f());
    }
    function cryptoRng(): () => number {
        const a = new Uint32Array(4);
        (W.crypto || W.msCrypto).getRandomValues(a);
        return sfc32(a[0], a[1], a[2], a[3]);
    }

    // ── xp table: IDENTICAL formula to Client.levelExperience (Client.ts static)
    const LEVEL_XP: number[] = [];
    (function build(): void {
        let acc = 0;
        for (let i = 0; i < 99; i++) {
            const level: number = i + 1;
            const delta: number = (level + Math.pow(2.0, level / 7.0) * 300.0) | 0;
            acc += delta;
            LEVEL_XP[i] = (acc / 4) | 0; // LEVEL_XP[i] = total xp for level i+2
        }
    })();
    function levelForXp(xp: number): number {
        let lvl = 1;
        for (let i = 0; i < 98; i++) {
            if (xp >= LEVEL_XP[i]) { lvl = i + 2; }
        }
        return lvl;
    }
    function levelUpBonus(newLevel: number): number {
        const l = clamp(newLevel, 2, 99);
        const progress = (l - 2) / 97;
        return Math.round(LEVEL_UP_FLOOR * Math.pow(LEVEL_UP_CAP / LEVEL_UP_FLOOR, Math.pow(progress, LEVEL_UP_STEEPNESS)));
    }

    // ── catalog (fetched once; tiers derived at load, RarityMath parity) ─────
    // cards.json wire shape is POSITIONAL (terser-proof, see header):
    //   top: [version, cards[]]   card: [0]name [1]tags[] [2]imageUrl [3]value [4]level
    // decorated at load (.k/.s/.r are internal-only, mangle consistently):
    //   .k name-key, .s score, .r tier 0..6
    let CAT: any = null;
    let CAT_BY_KEY: Record<string, any> = {};
    let fetching = false;
    let failedAt = -1e12;   // "never failed" — must not be 0: early in page life
                            // performance.now() < the 20s backoff window itself

    function lowValue(v: any): boolean { return !v || v <= 1; }   // beta isLowValueTierExempt
    function isMonster(c: any): boolean { return !!(c[1] && c[1].indexOf('Monster') >= 0); }
    function scoreOf(c: any): number {
        if (lowValue(c[3])) { return 0; }
        let s = c[3];
        if (c[4]) {
            const lp = c[4] * c[4] * (isMonster(c) ? 1.5 : 1); // Monster-tagged level² gets x1.5
            if (lp > s) { s = lp; }
        }
        return s;
    }
    function primaryCat(c: any): string { return (c[1] && c[1][0]) || 'Other'; }
    function tierForPercentile(p: number): number {
        if (p >= 0.98) { return 6; }
        if (p >= 0.95) { return 5; }
        if (p >= 0.90) { return 4; }
        if (p >= 0.75) { return 3; }
        if (p >= 0.50) { return 2; }
        if (p >= 0.25) { return 1; }
        return 0;
    }
    function assignTiers(cards: any[]): void {
        // beta order: per-category percentiles over the non-exempt pool, then
        // tie-unification WITHIN the category, then global lift by exact value,
        // then force exempt -> Common last.
        const byCat: Record<string, any[]> = {};
        for (const c of cards) {
            c.r = 0;
            const k = primaryCat(c);
            (byCat[k] || (byCat[k] = [])).push(c);
        }
        for (const cat in byCat) {
            const pool = byCat[cat].filter(c => !lowValue(c[3]));
            pool.sort((a: any, b: any) => a.s - b.s);
            const n = pool.length;
            pool.forEach((c: any, i: number) => { c.r = tierForPercentile(n <= 1 ? 1 : i / (n - 1)); });
            // beta unifyTiersForValueAndScoreTies: runs of EQUAL scores cannot
            // straddle a percentile cut — lift the whole run to the best tier in it
            let i = 0;
            while (i < pool.length) {
                let j = i + 1;
                while (j < pool.length && pool[j].s === pool[i].s) { j++; }
                let maxInRun = 0;
                for (let k = i; k < j; k++) { if (pool[k].r > maxInRun) { maxInRun = pool[k].r; } }
                for (let k = i; k < j; k++) { pool[k].r = maxInRun; }
                i = j;
            }
        }
        const bestByValue: Record<number, number> = {};
        for (const c of cards) {
            if (lowValue(c[3])) { continue; }
            const prev = bestByValue[c[3]];
            if (prev === undefined || c.r > prev) { bestByValue[c[3]] = c.r; }
        }
        for (const c of cards) {
            if (lowValue(c[3])) { continue; }
            const best = bestByValue[c[3]];
            if (best !== undefined && best > c.r) { c.r = best; }
        }
        for (const c of cards) { if (lowValue(c[3])) { c.r = 0; } }
    }

    function decodeCatalog(arr: any[]): any[] {
        const cards: any[] = arr[1];
        for (const c of cards) {
            c.k = c[0].toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            c.s = scoreOf(c);
        }
        assignTiers(cards);
        return cards;
    }
    function ensureCatalog(cb?: () => void): void {
        if (CAT) { if (cb) { cb(); } return; }
        const now = performance.now();
        if (fetching || (now - failedAt < 20000 && !cb)) { return; } // backoff between attempts
        fetching = true;
        fetch(CAT_URL, { cache: 'no-cache' })   // revalidate (304 keeps it cheap)
            .then(r => (r.ok ? r.json() : Promise.reject(new Error('http ' + r['status']))))
            .then((arr: any) => {
                CAT = { version: arr[0], cards: decodeCatalog(arr) };
                CAT_BY_KEY = {};
                for (const c of CAT.cards) { CAT_BY_KEY[c.k] = c; }
                fetching = false;
                log('catalog v' + CAT.version + ': ' + CAT.cards.length + ' cards');
                if (cb) { cb(); }
            })
            .catch((e: any) => {
                fetching = false;
                failedAt = performance.now();
                log('catalog load failed: ' + (e && e['message'] ? e['message'] : e));
            });
    }

    // ── per-account state (localStorage map; adopted by tcgSetAccount) ───────
    // SAVE SHAPE (positional, build-stable — see file header):
    //   [0] credits      [1] uncreditedXp  [2] prevXp {stat: totalXp}
    //   [3] prevLvl {stat: level}          [4] coll {cardKey: [nonfoil, foil]}
    //   [5] stats [xp, lvl, dup, give, packs, pulls, spent, killsC, killsN]
    //   [6] since (ms, credits/h baseline) [7] cv (catalog version last touched)
    const SV = 8;
    let ACCOUNT = 'default';
    let S: any = null;
    let loadedAccount = '';               // cache guard: S is authoritative for this account
    let settleUntil = 0;                  // login settle: rebase baselines silently, pay nothing
    let dirty = false, saveTimer: any = 0;

    function readAll(): any {
        try { return JSON.parse(W.localStorage.getItem(KEY_STATE) || '{}') || {}; } catch (e) { return {}; }
    }
    function freshSave(): any {
        return [0, 0, {}, {}, {}, [0, 0, 0, 0, 0, 0, 0], Date.now(), 0];
    }
    // S is the in-memory authority once loaded; load() is a cheap ensure, not a
    // re-read. Re-reading from disk every tick (HUD calls tcgInfo->load) would
    // clobber unsaved gains — the autosave is on a timer. Force a real (re)load
    // only when the account changes (or tcgSetAccount nulls S).
    function load(): void {
        if (S && loadedAccount === ACCOUNT) { return; }
        const all = readAll();
        S = all[ACCOUNT];
        if (!S || !Array.isArray(S) || S.length < SV) { S = freshSave(); } // old/corrupt shape -> start fresh
        loadedAccount = ACCOUNT;
        if (CAT) { S[7] = CAT.version; }
        flush();
    }
    function flush(): void {
        if (!S) { return; }
        const all = readAll();
        all[ACCOUNT] = S;
        try {
            W.localStorage.setItem(KEY_STATE, JSON.stringify(all));
            dirty = false;
        } catch (e) { log('save failed (quota?)'); }
    }
    function markDirty(): void {
        dirty = true;
        if (!saveTimer) {
            saveTimer = W.setInterval(() => { if (dirty) { flush(); } }, 5000);
        }
    }

    function addCredits(n: number, statIdx: number, reason: string): void {
        load();
        S[0] += n;
        S[5][statIdx] = (S[5][statIdx] || 0) + n;
        markDirty();
        flush();
        W['tcgHudDirty'] = true;
        if (reason) { toast(reason); }
    }

    // ── xp hook (called from the UPDATE_STAT packet site in Client.ts) ───────
    // Combat-skill xp pays NO chunks (beta parity: combat earns through kill
    // credits instead) — but its baseline/level tracking stays live so level-up
    // bonuses still fire, and switching the rule back is a one-line change.
    function onXp(stat: number, xp: number): void {
        if ((W.localStorage.getItem(KEY_MASTER) || 'true') !== 'true') { return; }
        if (!CAT) { ensureCatalog(); } // warm the catalog from the first gain too
        load();
        // login settle (beta CREDIT_AWARD_COOLDOWN + save-restore rebase): during
        // the window after tcgSetAccount, silently REBASE baselines — an offline
        // trained jump (or the burst racing the -1 guard) never retro-pays.
        const settling = Date.now() < settleUntil;
        const prev = S[2][stat];
        if (prev === undefined || settling) {
            S[2][stat] = xp;
            S[3][stat] = levelForXp(xp);
            markDirty();
            return;
        }
        if (xp < prev) {
            S[2][stat] = xp; // drain / bad packet: resync, award nothing
            markDirty();
            return;
        }
        const gained = xp - prev;
        if (gained === 0) { return; }
        S[2][stat] = xp;

        let paid = 0;
        if (!COMBAT_XP_STATS[stat]) {
            S[1] += gained;
            while (S[1] >= XP_PER_CHUNK) {
                S[1] -= XP_PER_CHUNK;
                paid += CREDITS_PER_CHUNK;
            }
        }
        const lvl = levelForXp(xp);
        const prevLvl = S[3][stat] || 1;
        let lvlBonus = 0;
        if (lvl > prevLvl) {
            for (let l = prevLvl + 1; l <= lvl; l++) { lvlBonus += levelUpBonus(l); }
            S[3][stat] = lvl;
        }
        S[0] += paid + lvlBonus;
        if (paid > 0) { S[5][0] += paid; }
        if (lvlBonus > 0) { S[5][1] += lvlBonus; }
        markDirty();
        W['tcgHudDirty'] = true;
        if (paid > 0) { toast('+' + fmt(paid) + ' credits — ' + fmt(gained) + ' xp'); }
        if (lvlBonus > 0) { toast('Level ' + lvl + '! +' + fmt(lvlBonus) + ' credits'); }
    }

    // ── kill credits (NpcKillCreditTracker parity, fed from Client.ts hunks) ─
    // The plugin marks an npc "engaged" when the local player interacts with or
    // hitsplats it, then pays combat-level credits if it dies within 12 ticks.
    // This client has no local-hitsplat ownership (hitsplats are broadcast, not
    // attributed), so the signals are:
    //   tcgEngageNpc(index)     — local player's FACEENTITY update aims at an
    //                             npc (covers melee/range/mage/cannon targeting;
    //                             one-shot kills still credit, as in beta);
    //   tcgWatchHit(index, hp, total) — every npc HITMARK/HITMARK2 update:
    //                             hp>0 && engaged refreshes the timeout (the
    //                             server-facing player during combat keeps it
    //                             warm for npcs we never targeted);
    //                             hp===0 is the death — credit if engaged and
    //                             valid. Respawn farming: a credited death
    //                             RE-STAMPS the engagement window (beta clears
    //                             engagement at death, but it also sees per-hit
    //                             hitsplat ownership; we don't — auto-retarget
    //                             on a respawned npc sends no new FACEENTITY
    //                             update, so clearing would kill the farming
    //                             loop). A re-emitted corpse can't double-pay:
    //                             KILL_REGRACE is the minimum cycle gap between
    //                             two credits on one index (~2s, below any
    //                             respawn). A death we never engaged (someone
    //                             else's kill, despawn, quest script) is
    //                             ignored.
    // Combat level: NpcType.vislevel from the cache (code 103; -1 unless the
    // def ships it — 2004-era caches often don't), else the OSRS card's level
    // by name (cards.json [4]; beta uses OSRS combat levels for its monsters),
    // else 1. Engagement maps are session-only (never saved, like beta).
    const KILL_REGRACE_CYCLES = 100;
    const engaged: Record<number, { t: number, d: number }> = {};   // index -> {last engage/hit, last credit}

    function killLevel(vislevel: number, typeName: string, totalHp: number): number {
        if (vislevel > 0 && vislevel < 32768) { return vislevel; }
        if (CAT && typeName) {
            const c = CAT_BY_KEY[typeName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()];
            if (c && c[4] > 0) { return c[4]; }
        }
        if (totalHp >= 20 && totalHp <= 32700) { return totalHp; } // last resort: full hp as level
        return KILL_MIN_CREDITS;
    }

    function onEngage(index: number, cycle: number): void {
        if ((W.localStorage.getItem(KEY_MASTER) || 'true') !== 'true') { return; }
        const e = engaged[index];
        if (e) { e.t = cycle; } else { engaged[index] = { t: cycle, d: -1e9 }; }
    }

    function onNpcHit(index: number, hp: number, total: number, cycle: number, vislevel: number, typeName: string): void {
        if ((W.localStorage.getItem(KEY_MASTER) || 'true') !== 'true') { return; }
        const e = engaged[index];
        if (hp > 0) {
            if (e) { e.t = cycle; }       // hit landed: keep the engagement warm
            return;
        }
        if (!e) { return; }               // unengaged death: other player's kill / despawn
        if (cycle - e.t > INTERACT_TIMEOUT_CYCLES) { delete engaged[index]; return; }
        if (cycle - e.d < KILL_REGRACE_CYCLES) { return; }  // same corpse re-emitting
        load();
        e.d = cycle;
        e.t = cycle;
        // settle window after login: adopt silently (a save that logged in
        // mid-combat shouldn't retro-credit whatever dies first)
        if (Date.now() < settleUntil) { return; }
        const credits = Math.max(KILL_MIN_CREDITS, killLevel(vislevel, typeName, total));
        S[0] += credits;
        S[5][7] = (S[5][7] || 0) + credits;
        S[5][8] = (S[5][8] || 0) + 1;
        markDirty();
        flush();
        W['tcgHudDirty'] = true;
        const label = typeName && typeName.length ? typeName : 'NPC';
        toast('+' + fmt(credits) + ' credits — ' + label + ' slain');
    }

    function clearEngagements(): void {
        for (const k in engaged) { delete engaged[k]; }
    }

    // ── pack roll (PackOpeningService parity minus party/webhook plumbing) ───
    function rollTier(rnd: () => number, apex: boolean): number {
        // beta cumulative cuts, low roll = rarer
        const roll = apex ? rnd() * 6.66 : rnd() * 100;
        if (roll < 0.66) { return 6; }
        if (roll < 2.66) { return 5; }
        if (roll < 6.66) { return 4; }
        if (roll < 14.66) { return 3; }
        if (roll < 30.66) { return 2; }
        if (roll < 62.66) { return 1; }
        return 0;
    }
    function pickFromTier(list: any[], tier: number, rnd: () => number): any {
        if (list.length === 1) { return list[0]; }
        if (tier < 4) { return list[(rnd() * list.length) | 0]; }
        let min = Infinity, max = -Infinity;
        for (const c of list) {
            if (c.s < min) { min = c.s; }
            if (c.s > max) { max = c.s; }
        }
        if (!(max > min)) { return list[(rnd() * list.length) | 0]; }
        const invR = 1 / TOP_TIER_RATIO;
        let total = 0;
        const weights: number[] = list.map((c: any) => {
            const t = clamp((c.s - min) / (max - min), 0, 1);
            const w = 1 + (invR - 1) * t;
            total += w;
            return w;
        });
        let r = rnd() * total, acc = 0;
        for (let i = 0; i < weights.length; i++) {
            acc += weights[i];
            if (r < acc) { return list[i]; }
        }
        return list[list.length - 1];
    }
    // pull entry = POSITIONAL [key, name, tier, foil] — crosses the window boundary
    function rollPack(rnd: () => number): any {
        const cards: any[] = CAT.cards;
        const byTier: any[][] = [];
        for (let t = 0; t < 7; t++) { byTier.push(cards.filter(c => c.r === t)); }
        const apex = Math.floor(rnd() * APEX_CHANCE_DENOM) === 0;
        const pulls: any[] = [];
        for (let i = 0; i < PACK_SIZE; i++) {
            let card: any = null;
            for (let a = 0; a < 8 && !card; a++) {
                const tier = rollTier(rnd, apex);
                const eff = apex ? Math.max(4, tier) : tier;
                const pool = byTier[eff];
                if (pool && pool.length) { card = pickFromTier(pool, eff, rnd); }
            }
            if (!card) {
                const alt = apex ? byTier[4].concat(byTier[5], byTier[6]) : cards;
                card = alt[(rnd() * alt.length) | 0];
            }
            const foilChance = FOIL_CHANCE * (apex ? APEX_FOIL_MULT : 1);
            pulls.push([card.k, card[0], card.r, rnd() * 100 < foilChance]);
        }
        if (apex && !pulls.some((p: any) => p[3])) {
            pulls[(rnd() * pulls.length) | 0][3] = true; // apex always contains a foil
        }
        return { pulls, apex };
    }

    let OPENING = false;
    function openPack(opts?: any): boolean {
        const o = opts || {};
        if (OPENING) { return false; }
        ensureCatalog(() => {
            if (!CAT) { toast('TCG catalog unavailable (run lclite apply)'); return; }
            load();
            if (S[0] < PACK_PRICE) {
                toast('Not enough credits: ' + fmt(S[0]) + ' / ' + fmt(PACK_PRICE));
                return;
            }
            const seed = o[0];                              // positional opts: [seed?]
            const rnd = typeof seed === 'string' ? seededRng(seed) : cryptoRng();
            const res = rollPack(rnd);
            S[0] -= PACK_PRICE;
            S[5][6] += PACK_PRICE;
            S[5][4]++;
            S[5][5] += res.pulls.length;

            // commit to the collection now (reveal is cosmetic — beta defers the
            // commit until the overlay closes; localStorage has no transaction,
            // closing the tab mid-reveal shouldn't lose bought cards)
            const sell: Record<string, number> = {};
            for (const p of res.pulls) {
                const e = S[4][p[0]] || (S[4][p[0]] = [0, 0]);
                const first = e[0] === 0 && e[1] === 0;
                if (p[3]) { e[1]++; } else { e[0]++; }
                if (!first && !p[3] && Object.keys(sell).length < SELL_MAX_PER_PACK && sell[p[0]] === undefined) {
                    const card = CAT_BY_KEY[p[0]];
                    const price = Math.max(DUP_SELL_MIN, Math.round(card ? card.s : 0) / DUP_SELL_DIVISOR | 0);
                    sell[p[0]] = price;
                }
            }
            flush();
            W['tcgHudDirty'] = true;
            OPENING = true;
            if (W['tcgShowReveal']) {
                W['tcgShowReveal'](res.pulls, sell, res.apex);
            } else {
                OPENING = false;
                toast('Pack opened: ' + res.pulls.map((p: any) => p[1]).join(', '));
            }
        });
        return true;
    }
    function sellDuplicates(sell: Record<string, number>): number {
        load();
        let total = 0;
        for (const k in sell) {
            const price = sell[k];
            const e = S[4][k];
            if (!e || e[0] <= 1) { continue; } // keep one copy; only sell true dupes
            e[0]--;
            total += price;
        }
        if (total > 0) {
            S[0] += total;
            S[5][2] += total;
            markDirty();
            flush();
        }
        return total;
    }

    // ── ::tcg console (invoked from the chat-input hunk; staff gate by arg) ──
    function command(args: string, staff: number): void {
        load();
        const parts = args.split(/\s+/);
        const sub = (parts[0] || 'album').toLowerCase();
        if (sub === 'album' || sub === '') {
            if (W['tcgShowAlbum']) { W['tcgShowAlbum'](); }
        } else if (sub === 'open' || sub === 'pack') {
            openPack();
        } else if (sub === 'info') {
            const i = info();
            toast('◈ ' + fmt(i[0]) + ' · packs ' + i[3] + ' · cards ' + i[11] + '/' + (i[13] ? fmt(i[13]) : '?') + ' · kills ' + fmt(i[16]) + ' · xp pool ' + i[1]);
        } else if (sub === 'give' && staff >= 2) {
            const n = clamp(parseInt(parts[1]) || 0, 1, 1000000);
            addCredits(n, 3, 'granted ' + fmt(n) + ' credits');
        } else if (sub === 'roll' && staff >= 2) {
            openPack([parts[1] || 'seed']);
        } else if (sub === 'reset') {
            const all = readAll();
            delete all[ACCOUNT];
            W.localStorage.setItem(KEY_STATE, JSON.stringify(all));
            S = null;
            load();
            toast('TCG collection reset for this account');
        } else if (sub === 'help') {
            toast('::tcg [album|open|info|reset] · staff: give <n>, roll <seed>');
        } else {
            toast('::tcg ' + sub + '? try ::tcg help');
        }
    }

    // ── read API for the DOM layer (POSITIONAL contracts, see file header) ──
    // info() -> [0]credits [1]uncreditedXp [2]packPrice [3]packsOpened [4]pulls
    //   [5]spent [6]earnedXp [7]earnedLvl [8]earnedDup [9]earnedGive [10]since
    //   [11]uniqueCards [12]catalogVersion|0 [13]catalogSize|0 [14]account
    //   [15]earnedKills [16]killCount
    function info(): any {
        load();
        return [
            S[0], S[1], PACK_PRICE, S[5][4], S[5][5], S[5][6],
            S[5][0], S[5][1], S[5][2], S[5][3] || 0, S[6],
            Object.keys(S[4]).length,
            CAT ? CAT.version : 0, CAT ? CAT.cards.length : 0,
            ACCOUNT,
            S[5][7] || 0, S[5][8] || 0
        ];
    }
    // albumRows() -> rows of [key, name, tier, tagsCsv, imageUrl, owned, foils]
    function albumRows(search: string, tier: number, cat: string, ownedOnly: boolean): any[] {
        if (!CAT) { return []; }
        load();
        let pool: any[] = CAT.cards;
        if (cat) { pool = pool.filter(c => primaryCat(c) === cat); }
        if (tier >= 0) { pool = pool.filter(c => c.r === tier); }
        if (search) {
            const q = search.toLowerCase();
            pool = pool.filter(c => c.k.indexOf(q) >= 0);
        }
        const out = pool.map(c => {
            const e = S[4][c.k] || null;
            return [c.k, c[0], c.r, (c[1] || []).join(','), c[2], e ? e[0] : 0, e ? e[1] : 0];
        });
        if (ownedOnly) {
            const owned = out.filter(o => o[5] > 0 || o[6] > 0);
            if (owned.length) { return owned; }
        }
        out.sort((a: any, b: any) =>
            ((b[5] + b[6] > 0 ? 1 : 0) - (a[5] + a[6] > 0 ? 1 : 0)) ||
            b[2] - a[2] || a[1].localeCompare(b[1]));
        return out;
    }
    // catalogMeta() -> [version, cardCount, labels[], cats[[name,count]], tiers[[label,total,owned]]]
    function catalogMeta(): any {
        if (!CAT) { return null; }
        load();
        const cats: Record<string, number> = {};
        const tiers = [0, 0, 0, 0, 0, 0, 0];
        const ownedTiers = [0, 0, 0, 0, 0, 0, 0];
        for (const c of CAT.cards) {
            const k = primaryCat(c);
            cats[k] = (cats[k] || 0) + 1;
            tiers[c.r]++;
            const e = S && S[4][c.k];
            if (e && (e[0] > 0 || e[1] > 0)) { ownedTiers[c.r]++; }
        }
        return [CAT.version, CAT.cards.length, TIER_LABELS.slice(),
            Object.keys(cats).sort().map(k => [k, cats[k]]),
            TIER_LABELS.map((label, i) => [label, tiers[i], ownedTiers[i]])];
    }

    // ── window surface (string keys: survive terser via bundle.ts reserves) ──
    W['tcgSetAccount'] = function (username: string): void {
        ACCOUNT = (username || 'default').trim().toLowerCase();
        S = null;
        clearEngagements();   // npc indices are per-world-session; never credit across accounts
        // open the settle window: the login UPDATE_STAT burst (which re-syncs all
        // 25 skills) rebases S[2]/S[3] silently instead of retro-paying xp earned
        // offline or on a previous character with this account.
        settleUntil = Date.now() + 5000;
        W['tcgHudDirty'] = true;
    };
    // Is a player actually IN THE WORLD? The HUD is a DOM overlay (ui.js) and a
    // page script cannot read the engine's own flag: page scripts are not mangled,
    // so a property read there either misses (silent wrong comparison — the terser
    // READ-mangle trap, see FOR_AGENTS) or depends on a reserve that upstream could
    // drop. Reading it HERE is mangle-proof by construction — terser renames this
    // access and Client's own `this.ingame` to the SAME name, so the two always
    // agree ('ingame' is also in the upstream reserved list today). The Client
    // instance is the one the camera mod parks on window.lostcityClient. Absent
    // object/field (camera stripped, older bundle) => report "in game", so a
    // half-updated install keeps its old always-visible HUD instead of losing it.
    W['tcgLoggedIn'] = function (): boolean {
        const c = W['lostcityClient'];
        if (!c || typeof c.ingame !== 'boolean') { return true; }
        return c.ingame;
    };
    W['tcgOnXp'] = onXp;
    W['tcgEngageNpc'] = onEngage;
    W['tcgNpcHit'] = onNpcHit;
    W['tcgOpenPack'] = openPack;
    W['tcgRevealClosed'] = function (): void { OPENING = false; };
    W['tcgSellDuplicates'] = sellDuplicates;
    W['tcgCommand'] = command;
    W['tcgInfo'] = info;
    W['tcgAlbum'] = albumRows;
    W['tcgCatalogMeta'] = catalogMeta;
    W['tcgEnsureCatalog'] = ensureCatalog;
    W['tcgCardBy'] = function (k: string): any {
        const c = CAT_BY_KEY[k];
        return c ? [c[0], c.r, c[2]] : null;   // positional: [name, tier, imageUrl]
    };
    W['tcgTierLabel'] = function (i: number): string { return TIER_LABELS[i] || '?'; };

    // ── UI-layer self-heal ───────────────────────────────────────────────────
    // ui.js normally arrives via the client.ejs hunk (before </body>). But that
    // tag lives in server-rendered HTML: a stale engine process or a cached page
    // can boot the core WITHOUT the DOM layer — HUD/clicks/album then do nothing
    // and it looks like the whole mod is dead. Worse, a cached *pre-repair*
    // ui.js can load instead (viewport-right HUD eaten by the LCLite FAB, old
    // catalog assumptions) — Brave served exactly that past hard refreshes. The
    // bundled core always survives, so it verifies the UI stamp and (re)loads
    // the version-keyed script itself when it's missing OR stale; the stamped
    // URL cache-busts any poisoned copy. The detached old #lctcg-root is simply
    // removed (its leftover setInterval writes invisible detached nodes).
    function ensureUiScript(): void {
        const stale = W['tcgBumpToast'] && W['__lctcgUi'] !== UI_VER;
        if (W['tcgBumpToast'] && !stale) { return; }
        if (stale) {
            const oldRoot = W.document.getElementById('lctcg-root');
            if (oldRoot) { oldRoot.remove(); }
        }
        const tag = 'script[data-lctcg-ui]';
        if (!document.querySelector(tag)) {
            const s = document.createElement('script');
            s.setAttribute('data-lctcg-ui', String(UI_VER));
            s.src = UI_SRC;
            (document.body || document.head).appendChild(s);
        }
    }
    W.setTimeout(ensureUiScript, 2500);

    ensureCatalog();
})();
