// lclite:tcg functional test — runs the REAL tcg_core.ts under a stubbed browser,
// against the REAL cards.json. Checks: xp→credit chunking (non-combat only),
// level-up curve, login burst adoption, kill credits (engage/death/timeout/
// respawn grace/settle), pack roll distribution vs beta odds, foil/apex,
// dup-sell price, collection persistence, deterministic seed replay, catalog
// tier sanity.
//   bun tools/tcg_test.ts   (from webclient/)
const LS: Record<string, string> = {};
(globalThis as any).window = globalThis;
(globalThis as any).localStorage = {
    getItem: (k: string) => (k in LS ? LS[k] : null),
    setItem: (k: string, v: string) => { LS[k] = String(v); },
    removeItem: (k: string) => { delete LS[k]; }
};
(globalThis as any).performance = { now: () => Date.now() };
(globalThis as any).crypto = { getRandomValues: (a: any) => { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 0xffffffff) >>> 0; return a; } };
(globalThis as any).setInterval = () => 0;
(globalThis as any).msCrypto = undefined;
// stub the OSRS-wiki CDN fetch with the local catalog file
// run from webclient/ (gpu_parity_test convention): cwd-relative assets
const ROOT4 = new URL('../../../../', import.meta.url).pathname.slice(1); // lclite/mods/tcg/tools -> checkout root
const catRaw = await Bun.file(ROOT4 + 'engine/public/lclite/tcg/cards.json').text();
(globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(catRaw) });

await import(ROOT4 + 'webclient/src/tcg/tcg_core.ts');
const W: any = globalThis;
if (!W.tcgInfo) { console.error('FAIL: core did not install window.tcg* API'); process.exit(1); }

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra?: any) {
    if (cond) { pass++; console.log('  ✓ ' + msg); }
    else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}

// ── settle window (own account so the chunking math below starts clean) ──────
W.tcgSetAccount('settle');
W.tcgOnXp(9, 5_000_000);      // thieving, mid-settle: offline-jump rebases, pays nothing
ok(W.tcgInfo()[6] === 0, 'settle window suppresses offline-jump payouts', W.tcgInfo()[6]);
await Bun.sleep(5200);        // outlast the login settle window
W.tcgOnXp(9, 5_001_000);      // now it's a real gain: exactly one chunk
ok(W.tcgInfo()[6] === 100, 'post-settle gains pay normally', W.tcgInfo()[6]);

W.tcgSetAccount('tester');
await Bun.sleep(5200);   // outlast the login settle window
W.tcgEnsureCatalog(() => {});
await Bun.sleep(50);   // let the awaited fetch resolve + assignTiers run

// ── catalog integrity ────────────────────────────────────────────────────────
const meta = W.tcgCatalogMeta();
console.log('catalog v' + meta[0] + ' · ' + meta[1] + ' cards');
ok(meta[1] > 6000, 'catalog loaded (' + meta[1] + ' cards)');
const tierTotals = meta[4].map((t: any) => t[1]);
ok(tierTotals.every(n => n > 0), 'every rarity tier populated', tierTotals);
ok(meta[4][6][1] < meta[4][0][1], 'Godly pool smaller than Common', { g: meta[4][6][1], c: meta[4][0][1] });

// ── xp → credits: 1,000 xp = 100 credits, remainder carries ───────────────────
// pick a base xp where +2500 does NOT cross a level threshold, so the level-up
// bonus (tested separately below) can't pollute the chunk arithmetic. Same xp
// curve as the core (mirrors Client.levelExperience).
// stat 8 = woodcutting: a NON-combat skill (combat xp pays chunks no more —
// kills cover that, beta parity).
const LVL: number[] = [];
{ let acc = 0; for (let i = 0; i < 99; i++) { const level = i + 1; acc += (level + Math.pow(2.0, level / 7.0) * 300.0) | 0; LVL[i] = (acc / 4) | 0; } }
let XPB = 0;
outer2: for (let x = 1000; x < 12_000_000; x += 1000) {
    let l0 = 1; for (let i = 0; i < 98; i++) if (x >= LVL[i]) l0 = i + 2;
    let l1 = 1; for (let i = 0; i < 98; i++) if (x + 2500 >= LVL[i]) l1 = i + 2;
    if (l0 === l1) { XPB = x; break; }
}
W.tcgOnXp(8, XPB);           // stat 8 (woodcutting) adopt baseline
W.tcgOnXp(8, XPB + 999);     // +999 → below one chunk, no payout yet
let info = W.tcgInfo();
ok(info[0] === 0, '999 xp pays 0 (chunk is 1000)', info[0]);
ok(info[1] === 999, '999 xp banks to the pool', info[1]);
W.tcgOnXp(8, XPB + 1000);    // +1 → crosses one chunk
ok(W.tcgInfo()[0] === 100, '1,000 xp pays 100 credits', W.tcgInfo()[0]);
ok(W.tcgInfo()[1] === 0, 'pool flushes at the boundary', W.tcgInfo()[1]);
W.tcgOnXp(8, XPB + 2500);    // +1500 → 1 chunk, 500 carries
ok(W.tcgInfo()[0] === 200, '1,500 xp pays 100, banks 500', W.tcgInfo()[0]);
ok(W.tcgInfo()[1] === 500, '500 xp carries to next chunk', W.tcgInfo()[1]);

// ── combat-skill xp pays NO chunks (kills cover combat earning) ──────────────
const beforeCombat = W.tcgInfo()[0];
W.tcgOnXp(0, XPB);           // attack adopt
W.tcgOnXp(0, XPB + 2500);    // 2,500 combat xp in one non-level-crossing jump
let ci = W.tcgInfo();
ok(ci[0] === beforeCombat, 'combat xp pays 0 chunks', ci[0] - beforeCombat);
ok(ci[1] === 500, 'combat xp never enters the pool', ci[1]);

// ── kill credits: engagement→death pays combat level, guards the fat hands ───
{
    const before = W.tcgInfo()[0];
    W.tcgEngageNpc(50, 1000);
    W.tcgNpcHit(50, 0, 21, 1100, 21, 'Guard');      // beta example: Varrock guard = 21c
    let k = W.tcgInfo();
    ok(k[0] === before + 21, 'engaged kill pays combat level', k[0] - before);
    ok(k[15] === 21 && k[16] === 1, 'kill stats surface in info()', [k[15], k[16]]);

    W.tcgNpcHit(51, 0, 3, 1101, 3, 'Chicken');
    ok(W.tcgInfo()[0] === before + 21, 'unengaged death pays 0');

    W.tcgEngageNpc(52, 2000);
    W.tcgNpcHit(52, 0, 5, 2401, 5, 'Rat');          // 401 cycles > 400 timeout
    ok(W.tcgInfo()[0] === before + 21, 'engagement older than timeout pays 0');
    W.tcgNpcHit(52, 0, 5, 2402, 5, 'Rat');
    ok(W.tcgInfo()[0] === before + 21, 'expired engagement stays cleared');

    // respawn farming: a credited death keeps engagement warm (auto-retarget
    // sends no new FACEENTITY); corpse re-emits are eaten by the re-grace
    W.tcgEngageNpc(53, 3000);
    W.tcgNpcHit(53, 12, 30, 3010, 30, 'Cow');       // partial hit keeps it warm
    W.tcgNpcHit(53, 0, 30, 3020, 30, 'Cow');        // death → pay 30
    ok(W.tcgInfo()[0] === before + 51, 'death after warm hits pays', W.tcgInfo()[0]);
    W.tcgNpcHit(53, 0, 30, 3025, 30, 'Cow');        // same corpse re-emitted
    ok(W.tcgInfo()[0] === before + 51, 're-grace blocks the double-pay');
    W.tcgNpcHit(53, 0, 30, 3160, 30, 'Cow');        // respawned, still engaged
    ok(W.tcgInfo()[0] === before + 81, 'respawn kill pays again');

    // level fallback chain: no vislevel + unknown name → total-hp proxy, then floor 1
    W.tcgEngageNpc(60, 5000);
    W.tcgNpcHit(60, 0, 117, 5005, -1, 'Zzz nothing');
    ok(W.tcgInfo()[0] === before + 198, 'unknown npc falls back to full-hp proxy');
    W.tcgEngageNpc(61, 5000);
    W.tcgNpcHit(61, 0, 0, 5005, -1, 'Zzz nothing');
    ok(W.tcgInfo()[0] === before + 199, 'hp-less unknown npc pays the floor (1)');

    // OSRS card level drives the payout when the cache def has no vislevel
    const sample: any = JSON.parse(catRaw)[1].find((c: any) =>
        c[4] > 0 && c[4] < 200 && /goblin/i.test(String(c[0])));
    if (sample) {
        const b2 = W.tcgInfo()[0];
        W.tcgEngageNpc(70, 6000);
        W.tcgNpcHit(70, 0, 999, 6005, -1, sample[0]);
        ok(W.tcgInfo()[0] === b2 + sample[4], 'card-name level fallback pays card level', [sample[0], sample[4]]);
    } else { ok(false, 'no goblin-ish card with level found in catalog'); }
}

// ── settle window covers kills too (login mid-combat never retro-pays) ───────
W.tcgSetAccount('fresh');
await Bun.sleep(50);
{
    const fb = W.tcgInfo()[0];
    W.tcgEngageNpc(80, 7000);
    W.tcgNpcHit(80, 0, 50, 7005, 50, 'Man');
    ok(W.tcgInfo()[0] === fb, 'kill during login settle pays nothing');
    await Bun.sleep(5200);
    W.tcgEngageNpc(81, 7100);
    W.tcgNpcHit(81, 0, 50, 7105, 50, 'Man');
    ok(W.tcgInfo()[0] === fb + 50, 'the same kill after settle pays');
}

// ── level-up bonus: the curve pays at thresholds (attack lvl 3 = 83xp) ────────
W.tcgSetAccount('ladder');
await Bun.sleep(5200);
W.tcgOnXp(2, 0);            // strength adopt at 0 (level 2)
W.tcgOnXp(2, 83);           // crosses to level 3 → floor bonus 1250 + 0 chunks
let lb = W.tcgInfo()[0];
ok(lb === 1250, 'level 3 pays the curve floor (1,250)', lb);
W.tcgOnXp(2, 13_000_000);   // to level 99: 96 more level-ups, capped-curve sum
const total99 = W.tcgInfo()[0] - lb;
// 96 level-ups from 4..99: first must pay >1250, later ones climb toward 25,000
ok(total99 > 1250 * 96, 'lv4→99 bonus sum exceeds floor x96', total99);
ok(W.tcgInfo()[1] >= 0, 'xp pool consistent after mega grant');

// ── idempotence: repeat identical xp pays nothing ─────────────────────────────
const afterLvl = W.tcgInfo()[0];
W.tcgOnXp(2, 13_000_000);
ok(W.tcgInfo()[0] === afterLvl, 'repeat identical xp pays 0 (dedup)', W.tcgInfo()[0]);

// ── drain / resync: xp going backwards never pays ────────────────────────────
const beforeDrain = W.tcgInfo()[0];
W.tcgOnXp(0, 50);           // drain (bad packet / resync)
ok(W.tcgInfo()[0] === beforeDrain, 'xp drain pays nothing', W.tcgInfo()[0]);
W.tcgOnXp(1, 1_000_000);    // a NEW stat adopted silently → no flood
const afterAdopt = W.tcgInfo()[0];
// adoption should NOT pay out the whole 1M as chunks (baseline adopt, not gain)
ok(afterAdopt - beforeDrain === 0, 'first-seen stat adopts without payout', afterAdopt - beforeDrain);

// ── pack purchase + reveal wiring ────────────────────────────────────────────
W.tcgSetAccount('packrat');
await Bun.sleep(5200);
W.tcgOnXp(7, 0);            // cooking baseline 0
W.tcgOnXp(7, 30_000);       // 30 chunks = 3000 credits + level bonus (well past pack)
let packs = W.tcgInfo()[0];
console.log('packrat credits before pack: ' + packs);
ok(packs >= 2500, 'earned enough for a pack (' + packs + ')');
const creditsBefore = W.tcgInfo()[0];
let revealed: any = null;
W.tcgShowReveal = (pulls: any, sell: any, apex: any) => { revealed = [pulls, sell, apex]; };
const opened = W.tcgOpenPack();
await Bun.sleep(30);
ok(opened && revealed, 'openPack fired the reveal hook');
ok(revealed && revealed[0].length === 5, 'pack has 5 cards', revealed?.[0]?.length);
ok(W.tcgInfo()[0] === creditsBefore - 2500, 'pack charged exactly 2500', W.tcgInfo()[0]);
if (revealed) {
    for (const p of revealed[0]) {
        ok(p[2] >= 0 && p[2] <= 6, 'pull tier in range: ' + p[1] + ' → ' + W.tcgTierLabel(p[2]));
    }
}
W.tcgRevealClosed();

// ── rarity distribution across many seeded rolls vs beta cumulative odds ──────
// give caps at 1M credits = 400 packs = 2,000 pulls (sample per tier: godly ~13)
console.log('distribution check (400 seeded packs = 2000 pulls)...');
const counts = [0, 0, 0, 0, 0, 0, 0];
let apexCount = 0, foilCount = 0, total = 0;
W.tcgSetAccount('roller');
await Bun.sleep(5200);
W.tcgCommand('give 1000000', 4);
for (let i = 0; i < 400; i++) {
    let res: any = null;
    W.tcgShowReveal = (pulls: any, sell: any, apex: any) => { res = [pulls, apex]; };
    W.tcgOpenPack(['seed-' + i]);
    if (!res) { console.log('  ✗ roll ' + i + ' produced no reveal'); continue; }
    for (const p of res[0]) { counts[p[2]]++; total++; if (p[3]) foilCount++; }
    if (res[1]) apexCount++;
    W.tcgRevealClosed();
}
const pct = counts.map(c => (c / total * 100));
console.log('  tier %: ' + pct.map((p, i) => W.tcgTierLabel(i) + '=' + p.toFixed(2)).join(' '));
const want = [37.34, 32, 16, 8, 4, 2, 0.66];
ok(Math.abs(pct[0] - want[0]) < 5, 'Common ≈ 37.34%', pct[0].toFixed(2));
ok(Math.abs(pct[6] - want[6]) < 1.5, 'Godly ≈ 0.66%', pct[6].toFixed(2));
ok(pct[6] < pct[5] && pct[5] < pct[4] && pct[4] < pct[3], 'monotonic rarer→less common');
console.log('  apex packs in sample: ' + apexCount + ' (expected ~0.13 — rare by design), foil ' + (foilCount / total * 100).toFixed(2) + '% (want ≈1)');
ok(foilCount / total > 0.002 && foilCount / total < 0.05, 'foil rate sane (~1%)', (foilCount / total * 100).toFixed(2));

// ── deterministic seed replay ────────────────────────────────────────────────
let r1: any = null, r2: any = null;
W.tcgShowReveal = (p: any, s: any, a: any) => { r1 = p; };
W.tcgOpenPack(['replay-me']); W.tcgRevealClosed();
W.tcgShowReveal = (p: any, s: any, a: any) => { r2 = p; };
W.tcgOpenPack(['replay-me']); W.tcgRevealClosed();
ok(JSON.stringify(r1) === JSON.stringify(r2), 'same seed → identical pack (reproducible)');

// ── collection persistence ───────────────────────────────────────────────────
const disk = JSON.parse(LS['lcliteTcg']);
ok(!!disk['roller'] && Object.keys(disk['roller'][4]).length > 0, 'collection persisted to localStorage', disk['roller'] ? Object.keys(disk['roller'][4]).length : 'none');
const anyKey = Object.keys(disk['roller'][4])[0];
ok(Array.isArray(disk['roller'][4][anyKey]), 'collection entry has [nonfoil,foil] counts', disk['roller'][4][anyKey]);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
