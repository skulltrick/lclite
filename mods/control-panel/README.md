# mods/control-panel

The F1 settings overlay itself — the only mod that is *entirely* page-side plus
two tiny engine-side hunks (the bundle.ts terser reserves and the `revision` local
the page title reads). panel.js/panel.css live in `files/` and are
copied verbatim to `engine/public/lclite/` by `apply`; the hunks are the
client.ejs `<link>`/`<script>` tags + `<title>`, engine/src/web.ts's `revision`
local, and the bundle.ts terser-reserve block for
the cross-realm names (`lostcityClient`, `lcmAnchor`, …).

## The look is the LAUNCHER'S (do not invent a second theme)

The panel is the same product as the window players press Play in, so its palette
is not a design decision made here: every value on `:root` and every control
recipe (button, input, scrollbar, tag, toast) is lifted from
`launcher/ui/index.html` — warm near-black surfaces, ONE gold accent
(`--lcm-accent` = the launcher's `--accent`), cream text. When the launcher's
theme changes, change panel.css in the same commit, or the two drift into two
products. The exception is the **logo mark**, which is copied art rather than a
theme colour (see the favicon bullet) — its fills stay literal in panel.js.

## What's in the box

- `files/engine/public/lclite/panel.js` — everything: registry, both tabs,
  tooltips, toast, pin, the alt-drag placement layer (`window.lcmAnchor`),
  legacy-bar coordination. Structure: `MOD_REGISTRY` (Mods-tab rows: id/name/
  desc/master/status) + `MODS` (Settings-tab rows: toggle/slider/color/select/
  action). Single-toggle mods intentionally have NO settings rows (RuneLite law:
  no config => no section).
- `files/engine/public/lclite/panel.css` — the whole look; theme vars on `:root`
  (`--lcm-*`), all of them the launcher's values (see the section above).
  `--lcm-accent` is the single accent colour (gold): favorite star, active tab,
  checked switch, FAB glow, snap dots, drag ghost, tooltip/toast edge. The old
  Zanaris-blue `--lcm-moon*` / bolt-mark vars are GONE — the mark is the
  launcher's gold moon now, and one accent beats two.
- `files/engine/public/favicon.svg` + `favicon.ico` — the browser-tab icon: the
  launcher's own mark (gold crescent + sparkle cluster, `#f7e2ac`→`#e6bb63`→`#b8862c`),
  shipped as page assets so a tab shows the LCLite moon instead of a 404. The ejs head
  hunk carries the `<link rel="icon">` pair (`?v=1` version-keyed like every page asset);
  the `.ico` additionally answers the bare `/favicon.ico` request browsers make when a
  page has no icon link at all. `tools/make_favicon.py` rasterizes the `.ico` from the
  same geometry as the svg (Pillow, 8x supersampled, 16/32/48 sizes) — change the art in
  BOTH (svg by hand, ico by re-running the tool) and bump the `?v=`.
  The panel's own mark (FAB + header, `MARK()` in panel.js) is the SAME art at the same
  48-unit viewBox, inlined with per-instance mask/gradient ids — three copies of one
  logo, so change all three together or none.
- `patches/client_ejs.json` — the two tags (currently `?v=7`/`?v=9` — see below), the
  favicon `<link>` pair in the head, the `<title>` (and the `data-rev` attribute the
  panel's header chip reads — see the next bullet), and the
  canvas-sizing logic itself: `setSize()` now takes ANY decimal (clamped 0.25x..8x),
  canonicalises it into `canvasSize`, remembers the fixed scale in `canvasScale` and keeps
  the legacy dropdown in step (appending a `(custom)` option for odd values). The panel's
  **Canvas scale** slider and **Fit to window** toggle are the only UI for it, so that page
  code ships here.
- `patches/web_ts.json` — one added local in the engine's `/rs2.cgi` render:
  `revision: Environment.engine.revision`. The page `<title>` reads it as
  `LCLite - <rev>`, so a tab names the install it belongs to without the
  overlay templating anything at apply time, and the ejs script tag passes the same
  value as `data-rev` for the panel's header chip (plus a title self-heal in case this
  hunk ever fails to apply on a new rev). `engine.revision` comes from world.json /
  `ENGINE_REVISION` — the engine's own number, which every Lost City branch sets to its
  own revision (274 → 274, 289 → 289), so other installs are right for free.
  **Both reads are GUARDED** (`typeof revision === 'number' ? … : ''`), because the
  ejs hunk and this one live in different files and fail independently: an unguarded
  local 500s the entire page (verified — ejs throws ReferenceError) when only the
  web.ts anchor moves, while the guard renders `LCLite` and an empty `data-rev` (chip
  hidden) until someone reseats the anchor. Never "simplify" those back to a bare
  `<%= revision %>`.
- `tools/canvas_size_test.mjs` — harness for the above (legacy 1x/2x/3x unchanged,
  decimals, clamping, canonicalisation, dropdown sync). Mod-logic changes to sizing must
  keep it green:
  `LCLITE_ROOT=<install> node mods/control-panel/tools/canvas_size_test.mjs`.
- `tools/make_favicon.py` — regenerates `files/engine/public/favicon.ico` from the
  launcher's mark geometry (see the favicon bullet above); needs Pillow, and drops a
  16px preview in the OS temp dir for eyeballing.
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
- Canvas sizing (the page's key, the panel's controls): `canvasSize` is THE value
  `setSize()` applies at boot — `'auto'` (fit the window) or a decimal taken as the fixed
  scale (clamped 0.25x..8x). `canvasScale` is the last FIXED scale, kept by `setSize()`
  itself so the slider can show it while `canvasSize` is `'auto'`, and so the Fit toggle
  can restore it. `canvasAutoFit` is just the toggle's own last position; the row's
  `get()` reports the derived truth (`canvasSize === 'auto'`), which is why `toggleRow`
  learned an optional `get()`/`apply()` pair. `setSize()` is the only writer of all three
  — the panel never writes them directly.

## Version-keying (stale-cache law, MODS.md "The contract")

The ejs tags carry `?v=N` (`panel.css?v=8`, `panel.js?v=9` today). ANY revision of
panel.js or panel.css shipped to a live server MUST bump N in the hunk (edit the
live client.ejs, then `node tools/regen.mjs` BEFORE `apply` — regen-before-apply or
the manifest thinks control-panel uninstalled). Brave re-serves stale plain paths
past hard refresh; the panel has no self-heal stamp for its own FILES (it IS the
page chrome, and a stale panel.js cannot replace itself), so the version key is the
only defense. The one self-heal it does carry is the tab title: `data-rev` on the
script tag lets a loaded panel.js put `LCLite - <rev>` back if the `<title>` hunk
did not apply.

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
