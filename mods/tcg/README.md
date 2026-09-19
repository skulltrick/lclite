# mods/tcg

A collectible-card minigame for playing-with-friends fun, modeled on Azderi's
**OSRS TCG** RuneLite plugin (BSD-2-Clause (c) 2026 Azderi — rarity tiers/odds,
score formula, tiering rules, pack economy and dup-sell were borrowed as
*design*, reimplemented here for the Lost City client). Credits accrue from
playing: every 1,000 **non-combat** xp pays 100 credits, every level-up pays
1,250 (lv2) scaling to 25,000 (lv99+), and killing an attackable monster pays
credits equal to its combat level (Varrock guard 21c — the beta's third earning
path; the five combat skills earn via kills, not chunks, exactly like the
plugin's COMBAT_SKILLS rule). Spend 2,500 credits on a Standard Pack from the
credits HUD (top-left of the game frame — top-right belongs to the LCLite
FAB/panel — or `::tcg` in the chatbox): five
cards flip over a full-screen reveal, tiered Common→Godly (37.34 / 32 / 16 / 8
/ 4 / 2 / 0.66%), 1% foils, a rare 1-in-3000 "apex pack" (top-3 tiers only,
5× foil odds), and duplicate pull-back offers sell at round(score)/200 credits.
The right-click album browses all 6,376 OSRS-Wiki-sourced cards with owned
counts, discovery silhouettes, rarity colors and per-tier collection progress —
**cut to the revision you are playing**: only cards released on or before the
build's own date can drop (1,388 of them at 289, 2005-01-17), and duplicates can
be sold straight from the album.

## The revision gate (why 289 shows 1,388 cards, not 6,376)

Every card carries its wiki RELEASE DATE, and `cards.json` also carries the Lost
City roadmap's revision → date map (`289: 2005-01-17`, `274: 2004-11-24`,
`254: 2004-09-07`, …). At load the core reads the ENGINE'S OWN REVISION off the
page — the `revision` local `client.ejs` is rendered with, stamped as `data-rev`
on this mod's own script tag — looks the date up, and keeps only cards released
on or before it. So a 289 install cannot roll a Slayer card (2005-01-26) while a
future 291 install picks it up with **no code change at all**.

- **Absent `data-rev` ⇒ no gate.** A stale engine, a stripped ejs hunk or a
  revision the map does not know yet leaves the whole catalog in play (the
  pre-gate behaviour) instead of silently emptying the album.
- **Undated cards are excluded** and counted in the album's gate tooltip. 6,331
  of the 6,376 cards are dated; the 45 that are not are OSRS-era items the wikis
  give no release date for (dose-suffixed potions like "Guam potion", 2024 fish,
  Sailing content).
- **Rarity is relative to the revision**: tiers are percentiles within each
  category, so a 289 card's tier is its rarity among 289 cards.
- **Kill credits read the UNGATED table** — a monster the gate drops from the
  album (undated, or dated by a later wiki page for the same name) still pays its
  combat level when killed.
- **`info()[11]` counts only in-revision cards**, so a collection saved before
  the gate (or on another revision) keeps its out-of-revision entries in
  localStorage but does not report them as discovered.

### Adapting to a new revision

```
node mods/tcg/tools/catalog_dates.mjs     # refills any missing dates + re-reads the roadmap
```
then bump the two `?v=` keys (`CAT_URL` in `tcg_core.ts` and the `ui.js` tag in
the ejs hunk) and run `regen` → `apply` → `build`. No card re-fetch is needed for
a revision bump: the cutoff map is the only revision-shaped data, and the new
revision's cards were already in the catalog with their dates. The tool also
prints the per-revision card counts, so you can sanity-check the new number
before shipping (`--refresh` re-queries every card, `--check` writes nothing).

Where the dates come from: the OSRS wiki first (the wiki the card names and art
come from), then `runescape.wiki` for names it does not date. Lookups are batched
(`titles=`, 50 per request, `rvsection=0`), a name whose page differs only in
case/punctuation is recovered with `prefixsearch`, and a REDIRECT target is only
accepted when its words are a subset of the card's name ("Lit candle" → "Candle"
✓, "Black ring" → "Onyx ring" ✗). Only the earliest date on a multi-variant page
(`release1..releaseN`) is kept — the first appearance is what matters here.

**How the filter was validated** (2026-09-18): cross-checked against the item and
npc names actually packed in the 289 install (4,089 items, 1,596 npcs — 2004
spellings like `Adamnt warhammer`, `Antipoison(3)`, `Babydragon bones`). Of those
5,685 packed entities only 23 fall outside the gate, and nearly all of them are
modern name-variants of content that IS in ("Nightshade" vs "Cave nightshade",
"Agility arena ticket", "Mourner") or OSRS-era placeholder names in the packed
data ("Dragonfire shield", "Blood talisman"). Spot checks at the boundary line
up: "Dragon platelegs" (2005-01-17) is in, every Slayer item (2005-01-26) is out.

## Selling duplicates from the album

Every card with a spare copy grows a `⇄ sell 1 (+N)` button in the album (one
delegated listener on the grid — 600 cells re-render on every keystroke), and the
header carries a confirmed **Sell all duplicates (+N ◈)** action that quotes the
total first. Both go through the same rule the pack reveal's pull-back offer has
always used: **the last copy of a card is never sellable and foils are never
sold**; the price is the beta's `max(10, round(score)/200)`. A sale updates the
cell in place (no re-render, no scroll jump) and re-derives the header's credits,
discovered count and per-tier progress. `::tcg sell` does the same from chat.

## What's in the box

- `files/webclient/src/tcg/tcg_core.ts` — the economy engine: xp→credit
  chunking, the level-up curve, catalog decode + RarityMath-parity tiering,
  pack rolls, dup sell, per-account localStorage saves. **Bundled** into
  client.js through ONE side-effect import hunk in Client.ts (gpu pattern).
  Crosses the terser boundary only through `window['string']` names (reserved
  in bundle.ts, see its hunk) and POSITIONAL arrays (object literals arrive
  property-mangled; saves likewise use array shapes so rebuilds never orphan
  collections).
- `files/engine/public/lclite/tcg/ui.js` — credits HUD (canvas top-left
  anchor by default, recomputed per tick so canvas scaling can't fight it;
  ALT-DRAGGABLE via the control panel's placement layer — reads its own
  `lcmTcgHudAnchor`/`Offset` keys, parks opposite a relocated FAB), pack
  reveal overlay, collection album: a plain page script next to panel.js
  (client.ejs hunk). No engine coupling beyond the `window['tcg*']` API + the
  `tcg` key. Lays over the LCLite chrome (z 9600 > panel 9000) so the FAB never
  eats its clicks. **The HUD is gated** (master `tcg` → logged in → `tcgHud` →
  each line's own key; see "HUD visibility" below) and the control panel carries
  its switches plus two actions that reach the album and a pack without the HUD.
  **Page assets are version-keyed** (currently `ui.js?v=9` /
  `cards.json?v=8`): express re-validates stale cached copies and Brave
  demonstrably re-serves deleted assets past hard-refresh, so any ui.js/
  cards.json revision shipped here MUST bump BOTH `?v=` numbers (client.ejs
  hunk + core constants) — the bundled core stamp-checks `window.__lctcgUi`
  and (re)injects the version-keyed script itself if the page never got the
  ejs tag or loaded a stale copy. **The injection probe keys on
  `script[data-lctcg-ui]`, so the ejs tag MUST carry that attribute AND ui.js
  self-stamps via `document.currentScript`** — a plain `<script src>` tag
  looked "missing" to the self-heal and the core injected a second copy (v6
  double-boot bug). That's the whole anti-cache contract. The tag also carries
  `data-rev` (the engine's revision local) — see the revision gate above.
- `files/engine/public/lclite/tcg/cards.json` — 6,376-card catalog derived
  from the plugin's `Card.json` (OSRS Wiki item/monster data + image URLs,
  CC BY-SA; the plugin repo is BSD-2 for its own code). Positional rows:
  `[name, tags, imageUrl, value, level, released]` — `released` is a YYYYMMDD
  wiki release date (0 = undated, gated out of every revision); the file's
  third top-level element is the roadmap's `{ "<rev>": YYYYMMDD }` cutoff map.
  Quest items and name-dupes dropped.
- `tools/catalog_dates.mjs` — the only thing that writes cards.json: fills
  missing release dates from the wikis, re-reads the roadmap cutoff map, prints
  the per-revision card counts. Node, no deps; `--refresh` re-queries every
  card, `--check` writes nothing, `--no-roadmap` keeps the existing map.
- `patches/Client_ts.json` — 7 hunks: core import, login handoff
  (`window['tcgSetAccount'](username)`), UPDATE_STAT xp feed
  (`window['tcgOnXp'](stat, xp)`), the `::tcg` chat command, and three kill
  hunks: local-player FACEENTITY → `tcgEngageNpc(index, cycle)` (targets an
  npc = engaged, beta InteractingChanged parity) and both npc hitsplat updates
  (HITMARK/HITMARK2) → `tcgNpcHit(index, hp, total, cycle, vislevel, name)`
  (hp 0 = the death the core credits).
- `patches/bundle_ts.json` — 1 hunk: terser property reserves for the whole
  `tcg*` window surface. Required — drop it and the page can't see the core.
- `patches/client_ejs.json` — 1 hunk: `<script src="/lclite/tcg/ui.js">` plus the
  `data-rev` stamp the revision gate reads.
- `tools/tcg_test.ts` — bun functional harness (75 checks: chunking, non-combat
  rule, level curve, kill credits incl. timeout/re-grace/settle, login settle,
  odds vs beta, foils, dup-sell, persistence, seed replay, the revision gate
  incl. boundary/undated/ungated-kill cases, and album selling). Run it from this
  overlay: `bun run mods/tcg/tools/tcg_test.ts` — it prints the tree it picked
  (this overlay's own `files/` payload by default, i.e. exactly what you are
  editing; `LCLITE_ROOT=<install> bun run mods/tcg/tools/tcg_test.ts` tests the
  applied tree in that install instead). The install's own `lclite/` copy is a
  snapshot from install time — never point the harness at that.
  `TCG_TEST_REV=none` runs the ungated phase (70 checks), proving that a page
  without the `data-rev` tag leaves the whole catalog in play.

## HUD visibility (the gate chain)

The credits box draws only when EVERY one of these holds — read per tick at
ui.js's own hook, so a switch takes effect on the next tick with no reload:

| key | default | meaning |
|---|---|---|
| `tcg` | on | the mod's master switch (also gates the whole economy) |
| — | — | **logged in** — the engine's own `Client.ingame`, no key |
| `tcgHud` | on | the box itself (credits + rate + progress) |
| `tcgHudCredits` | on | the `◈ N` credits line |
| `tcgHudRate` | on | the green `+N/h` line |
| `tcgHudProgress` | on | the `N to next pack` line |

All three line switches off hides the box as a whole — an empty rounded
rectangle is not a state anyone wants. The panel's **Collection album** and
**Open a pack** action rows are the way in when the box is hidden (or when you
just want the album without a right-click).

**Logged in** is not a localStorage key: the core exposes
`window.tcgLoggedIn()`, which reads `Client.ingame` from INSIDE the bundle.
That is deliberate — a page script cannot read a bundled property safely
(unmangled name vs. the mangler's rename = a silent wrong answer, the read-side
of the terser trap), and `ingame` is the client's own truth, so logout,
disconnect, `lostCon` and a failed login all hide the HUD for free with no new
`Client.ts` hunk to reseat on rev day. Before this gate the box sat on the login
screen reporting the `default` account's balance; the panel's TCG row says
`not logged in` for the same reason. Absent accessor (stale bundle, camera
stripped so there is no `window.lostcityClient`) ⇒ the gate reports "in game",
i.e. the HUD behaves exactly as it did before the gate existed rather than
disappearing.

## Settings contract

localStorage key `tcg` (master, default ON), read per-gain at the core's own
hook (no hub). The HUD's four switches above are read by ui.js at its own tick
and written by the control panel. State: key `lcliteTcg` = `{ "<username>": save }`;
the core never writes anything else. Panel: MOD_REGISTRY entry in
control-panel's panel.js with a live credits status (positional info() indices —
see tcg_core.ts header) plus the mod's own settings view (4 HUD toggles + 2
actions).

Window surface for the album (all positional, all reserved in bundle.ts):
`tcgAlbum()` rows are `[key, name, tier, tags, img, owned, foils, price, dupes]`,
`tcgSellSummary()` is `[credits, cards, kinds]`, and `tcgSellCard(key, n)` /
`tcgSellAllDupes()` return the credits gained (0 = nothing sold).
`tcgCatalogMeta()` grew `[5]rev [6]cutoff [7]cards before the gate [8]dated
later [9]undated`; `info()[11]` is now "owned AND in this revision".

## Deliberate divergences from the OSRS plugin

- Local-only: no party/trading/webhooks/Discord; no server gameplay.
- Kills are credited CLIENT-side (the plugin is too, but it gets true
  hitsplat ownership + `ActorDeath`; this client broadcasts hitsplats without
  attribution), so engagement = "local player faced the npc, then it died
  within ~7.2s (12 beta ticks ≈ 400 loopCycles)". Consequences: assisting a
  kill someone else finishes still credits (friendlier than the beta), and the
  payout rides the same trust level as the xp hook (localStorage, not
  attested). Combat level source: `NpcType.vislevel` → OSRS card level by name
  → full-hp proxy → 1 (2004 caches rarely ship vislevel; the card table is the
  same one the beta's economy is built on).
- XP baseline dedupe lives in the core's save (survives reloads world-hops
  can't), with a 5s post-login settle window that rebases silently — the
  login UPDATE_STAT burst and offline-trained saves never retro-pay (kills
  during the window are silently dropped too).
- Collection commits at purchase, not at reveal-close (localStorage has no
  transaction; closing the tab mid-reveal must not eat bought cards).
