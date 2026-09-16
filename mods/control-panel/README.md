# mods/control-panel

The F1 settings overlay itself — the only mod that is *entirely* page-side plus
one tiny bundle-side reserve hunk. panel.js/panel.css live in `files/` and are
copied verbatim to `engine/public/lclite/` by `apply`; the hunks are just the
client.ejs `<link>`/`<script>` tags and the bundle.ts terser-reserve block for
the cross-realm names (`lostcityClient`, `lcmAnchor`, …).

## What's in the box

- `files/engine/public/lclite/panel.js` — everything: registry, both tabs,
  tooltips, toast, pin, the alt-drag placement layer (`window.lcmAnchor`),
  legacy-bar coordination. Structure: `MOD_REGISTRY` (Mods-tab rows: id/name/
  desc/master/status) + `MODS` (Settings-tab rows: toggle/slider/color/select/
  action). Single-toggle mods intentionally have NO settings rows (RuneLite law:
  no config => no section).
- `files/engine/public/lclite/panel.css` — the whole look; theme vars on `:root`
  (`--lcm-*`), gold `--lcm-gold` is the favorite-star color.
- `patches/client_ejs.json` — the two tags (currently `?v=3` — see below).
- `patches/bundle_ts.json` — terser reserves for names the panel reads off the
  bundle. If panel.js starts reading a NEW engine-side window property, it must
  be added there or it arrives mangled.

## Settings contract (keys the panel owns)

- `lclitePanelTab` — last-open tab. `lclitePanelPinned` — pin state.
- `lcmFavMods` — comma-separated favorite mod ids. Panel-owned *display* state:
  the list is favorites first, then alphabetical by name (case-insensitive
  localeCompare; favorites also sort alphabetically among themselves). Star at
  the left of each Mods row toggles it; unfavoriting rebuilds the list so the
  mod drops back into its alphabetical slot. The `lcm` prefix means "Reset all
  lclite settings" wipes it along with placement keys.
- Master switches write each mod's OWN engine key (see MODS.md "The contract").
  `master.invert: true` flips the row's MEANING, not the storage: the switch is
  a DISABLE control (checked ⇔ key 'false'). Only "Disable anti-cheat" uses it
  (key stays `antiCheat` — the engine reads it; checked ON = packets OFF).
- Per-mod gear button (right of the description, before the switch): appears
  only on mods that HAVE settings rows; click jumps to the expanded section in
  Settings (same path as clicking the row body, just discoverable).

## Version-keying (stale-cache law, MODS.md "The contract")

The ejs tags carry `?v=N`. ANY revision of panel.js or panel.css shipped to a
live server MUST bump N in the hunk (edit the live client.ejs, then
`node tools/regen.mjs` BEFORE `apply` — regen-before-apply or the manifest
thinks control-panel uninstalled). Brave re-serves stale plain paths past hard
refresh; the panel has no self-heal stamp (it IS the page chrome), so the
version key is the only defense.

## Deliberate divergences / notes

- The panel talks to the engine ONLY through localStorage + the reserved
  `window.lostcityClient`/`window.lcmAnchor` API. No hub reads: every mod's
  master key is written here but read by that mod at its own hook site.
- camera's master also rides its Settings section header because it gates a
  whole sub-tree; other sections just grey out (plugoff) when their Mods-tab
  master is off.
- TCG/anti-cheat Mods-tab rows carry a live `status()` line (positional
  `window.tcgInfo()` contract) refreshed on the panel's 400ms sync tick.
- The row click-to-settings behaviour predates the gear and stays (RuneLite
  parity); the gear exists because discoverability beat parity here.
