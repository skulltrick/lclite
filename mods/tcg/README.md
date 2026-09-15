# mods/tcg

A collectible-card minigame for playing-with-friends fun, modeled on Azderi's
**OSRS TCG** RuneLite plugin (BSD-2-Clause (c) 2026 Azderi — rarity tiers/odds,
score formula, tiering rules, pack economy and dup-sell were borrowed as
*design*, reimplemented here for the Lost City client). Credits accrue from
playing: every 1,000 xp pays 100 credits and every level-up pays 1,250 (lv2)
scaling to 25,000 (lv99+). Spend 2,500 credits on a Standard Pack from the
credits HUD (top-left of the game frame — top-right belongs to the LCLite
FAB/panel — or `::tcg` in the chatbox): five
cards flip over a full-screen reveal, tiered Common→Godly (37.34 / 32 / 16 / 8
/ 4 / 2 / 0.66%), 1% foils, a rare 1-in-3000 "apex pack" (top-3 tiers only,
5× foil odds), and duplicate pull-back offers sell at round(score)/200 credits.
The right-click album browses all 6,376 OSRS-Wiki-sourced cards with owned
counts, discovery silhouettes, rarity colors and per-tier collection progress.

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
  anchor, recomputed per tick so canvas scaling can't fight it), pack reveal
  overlay, collection album: a plain page script next to panel.js (client.ejs
  hunk). No engine coupling beyond the `window['tcg*']` API + the `tcg` key.
  Lays over the LCLite chrome (z 9600 > panel 9000) so the FAB never eats
  its clicks. **Page assets are version-keyed** (`ui.js?v=3`,
  `cards.json?v=3`): express re-validates stale cached copies and Brave
  demonstrably re-serves deleted assets past hard-refresh, so any ui.js/
  cards.json revision shipped here MUST bump BOTH `?v=` numbers (client.ejs
  hunk + core constants) — the bundled core stamp-checks `window.__lctcgUi`
  and (re)injects the version-keyed script itself if the page never got the
  ejs tag or loaded a stale copy. That's the whole anti-cache contract.
- `files/engine/public/lclite/tcg/cards.json` — 6,376-card catalog derived
  from the plugin's `Card.json` (OSRS Wiki item/monster data + image URLs,
  CC BY-SA; the plugin repo is BSD-2 for its own code). Positional rows:
  `[name, tags, imageUrl, value, level]`; quest items and name-dupes dropped.
- `patches/Client_ts.json` — 4 hunks: core import, login handoff
  (`window['tcgSetAccount'](username)`), UPDATE_STAT xp feed
  (`window['tcgOnXp'](stat, xp)`), and the `::tcg` chat command.
- `patches/bundle_ts.json` — 1 hunk: terser property reserves for the whole
  `tcg*` window surface. Required — drop it and the page can't see the core.
- `patches/client_ejs.json` — 1 hunk: `<script src="/lclite/tcg/ui.js">`.
- `tools/tcg_test.ts` — bun functional harness (33 checks: chunking, level
  curve, login settle, odds vs beta, foils, dup-sell, persistence, seed
  replay). Run from `webclient/`:
  `bun run ../lclite/mods/tcg/tools/tcg_test.ts`.

## Settings contract

localStorage key `tcg` (master, default ON), read per-gain at the core's own
hook (no hub). State: key `lcliteTcg` = `{ "<username>": save }`; the core
never writes anything else. Panel: MOD_REGISTRY entry in control-panel's
panel.js with a live credits status (positional info() indices — see
tcg_core.ts header).

## Deliberate divergences from the OSRS plugin

- Local-only: no party/trading/webhooks/Discord; no server gameplay. Kills →
  credits is the planned next pass (needs NpcType combat data on the client).
- XP baseline dedupe lives in the core's save (survives reloads world-hops
  can't), with a 5s post-login settle window that rebases silently — the
  login UPDATE_STAT burst and offline-trained saves never retro-pay.
- Collection commits at purchase, not at reveal-close (localStorage has no
  transaction; closing the tab mid-reveal must not eat bought cards).
