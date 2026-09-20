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

- `files/engine/public/lclite/panel.js` — everything: registry, the list and the
  per-mod view, tooltips, toast, pin, the alt-drag placement layer (`window.lcmAnchor`),
  legacy bar's own hide-at-boot. Structure: `MOD_REGISTRY` (the list's rows: id/name/
  desc/master/status) + `MODS` (a mod's own settings rows: toggle/slider/color/
  select/action — an action row may carry `btn: 'Open'` for its button label,
  default "Run"). Single-toggle mods intentionally have NO settings rows (RuneLite
  law: no config => nothing to open, so clicking one toasts).
- `files/engine/public/lclite/panel.css` — the whole look; theme vars on `:root`
  (`--lcm-*`), all of them the launcher's values (see the section above).
  `--lcm-accent` is the single accent colour (gold): favorite star, checked
  switch, back chevron, FAB glow, snap dots, drag ghost, tooltip/toast edge. The old
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
- `patches/client_ejs.json` — the two tags (currently `?v=13`/`?v=30` — see below), the
  favicon `<link>` pair in the head, the `<title>` (and the `data-rev` attribute the
  panel's header chip reads — see the next bullet), and the
  canvas-sizing logic itself: `setSize()` now takes ANY decimal (clamped 0.25x..8x),
  canonicalises it into `canvasSize`, remembers the fixed scale in `canvasScale` and keeps
  the legacy dropdown in step (appending a `(custom)` option for odd values). The panel's
  **Canvas scale** slider and **Fit to window** toggle are the only UI for it, so that page
  code ships here.
- `patches/web_ts.json` — **two** hunks in the engine's web server.
  (a) one added local in the engine's `/rs2.cgi` render:
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
  (b) `startManagementWeb()` binds **loopback by default** instead of upstream's
  `0.0.0.0`. Upstream's management server has **no authentication at all** and
  `PUT /setup/config` rewrites the world's own `world.json` (ports, save profile,
  login/members settings), so on a LAN address anyone who can reach the port can
  rewrite the world's config. `MANAGEMENT_HOST=0.0.0.0` opts back in for a host who
  really means to publish it. This is the only port that changes: `app.ts`'s web
  server and `TcpServer` still bind `0.0.0.0`, so players are unaffected — verified
  by booting a world and reading `netstat`: `:80` and `:43594` on `0.0.0.0`,
  `:8898` on `127.0.0.1`. The launcher's Worlds panel refuses to list a world while
  that page answers on a LAN address, and dials the real interface addresses to
  decide (a bind probe lies on Windows — see the launcher README).
  **274 inherits this hunk** (matrix verifies the anchor matches byte-for-byte
  there); 254 has no control-panel corpus, so it is unaffected.
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

- `lclitePanelMod` — which mod's view is open ('' = the list), so reopening the
  panel returns you where you were. `lclitePanelPinned` — pin state. (The old
  `lclitePanelTab` key is deleted at boot: the tab it named no longer exists.)
- `lcmFavMods` — comma-separated favorite mod ids. Panel-owned *display* state:
  the list is favorites first, then alphabetical by name (case-insensitive
  localeCompare; favorites also sort alphabetically among themselves). Star at
  the left of each row toggles it; unfavoriting rebuilds the list so the
  mod drops back into its alphabetical slot. The lcm prefix is the panel's own
  namespace, shared with the drag layer's placement keys.
- **The core row is pinned first, always** (`CORE_ID = 'control-panel'`, applied in
  `favCmp` before the favorite comparison, so no favorite can outrank it) and it
  carries no star — there is nothing to sort it against, and a control that toasts
  "favorited" while the row does not move is worse than no control. `renderView`
  puts a `.lcm-sep` hairline right under it so LCLite itself reads as the panel
  rather than as one more plugin in the list; `applySearch` hides that line while
  every mod row below it is filtered out.
- Master switches write each mod's OWN engine key (see MODS.md "The contract").
  `master.invert: true` flips the row's MEANING, not the storage: the switch is
  a DISABLE control (checked ⇔ key 'false'). No row uses it today — "Disable
  anti-cheat" was the only one and that mod is gone (its telemetry suppression is
  unconditional in `mods/camera` now) — so it stays as the shape a future
  "Disable X" row would take.
- Per-mod gear button (right of the description, before the switch): appears
  only on mods that HAVE settings rows, and only in the list — click opens that
  mod's view (the same path as clicking the row body, just discoverable). It is
  hidden inside the mod's own view, where it would point at itself.
- Canvas sizing (the page's key, the panel's controls): `canvasSize` is THE value
  `setSize()` applies at boot — `'auto'` (fit the window) or a decimal taken as the fixed
  scale (clamped 0.25x..8x). `canvasScale` is the last FIXED scale, kept by `setSize()`
  itself so the slider can show it while `canvasSize` is `'auto'`, and so the Fit toggle
  can restore it. `canvasAutoFit` is just the toggle's own last position; the row's
  `get()` reports the derived truth (`canvasSize === 'auto'`), which is why `toggleRow`
  learned an optional `get()`/`apply()` pair. `setSize()` is the only writer of all three
  — the panel never writes them directly.

## Version-keying (stale-cache law, MODS.md "The contract")

The ejs tags carry `?v=N` (`panel.css?v=13`, `panel.js?v=30` today). ANY revision of
panel.js or panel.css shipped to a live server MUST bump N in the hunk (edit the
live client.ejs, then `node tools/regen.mjs` BEFORE `apply` — regen-before-apply or
the manifest thinks control-panel uninstalled). Brave re-serves stale plain paths
past hard refresh; the panel has no self-heal stamp for its own FILES (it IS the
page chrome, and a stale panel.js cannot replace itself), so the version key is the
only defense. The one self-heal it does carry is the tab title: `data-rev` on the
script tag lets a loaded panel.js put `LCLite - <rev>` back if the `<title>` hunk
did not apply.

## Placement API (`window.lcmAnchor`)

The panel owns the alt-drag layer, and it is the ONLY writer of the anchor keys. Two
registration shapes, both positional because object literals mangle across the
bundle→page boundary:

- `register({id, el, anchorKey, offsetKey, defA, defO})` — a DOM surface (the FAB, the
  tcg HUD). The panel positions it; it anchors to the whole client window.
- `registerCanvas([id, anchorKey, offsetKey, defA, defO, getBounds, region, overhang])` — a
  surface an owner mod paints into a canvas buffer (the xp tracker, the stat orbs). The
  panel drags a ghost box sized from `getBounds()` (a positional `[x, y, w, h]` in that
  buffer's own px, or `null` while the surface is hidden) and never positions the real
  thing: the owner re-reads its own keys per frame. `region` is optional —
  `[x, y, w, h, bufferW, bufferH]` in the canvas's 765×503 logical space, defaulting to
  the game viewport (`areaGame`, 512×334 at 4,4). The stat orbs pass the minimap widget
  (`[550, 4, 172, 156, 172, 156]`) so they drag inside the panel they are drawn on.
  The region is measured off the CANVAS ELEMENT, never the window: the page centres a
  scaled canvas inside the letterbox, so window-derived maths put every canvas ghost
  hundreds of px from its real pixels. `overhang` is optional too —
  `[left, right, top, bottom]` as distances OUTWARD in the same buffer px, for an owner that composites a
  buffer OUTSIDE the one it draws into: the stat orbs paint the sidebar's stone strip
  left of the minimap widget themselves, so they pass `[34, 0, 0, 0]` and the clamp (and
  the snap targets) follow them out. The anchor POINTS and the stored offsets stay the
  region's, so widening the overhang never shifts a saved placement.

**A canvas surface is placed LIVE.** The drag writes the anchor keys on every pointermove,
not just on release — an owner paints itself from those keys every frame, so that is what
makes the xp tracker and the orbs follow the cursor instead of jumping into place when you
let go. The move writes are unsnapped (the snap still lands on release, as it always did),
the ghost over a canvas surface is a bare dashed outline (a tinted box would sit on the
thing being placed), and Escape or a window blur cancels the drag by restoring the keys the
drag started with — unset keys back to unset, so a half-drag never leaves a placement
behind.

`lcmAnchor.reset(id)` is the one reset path for both kinds (Alt+right-click calls it;
`lcm-anchor-reset` with the id as `detail` is the event form). It returns `false` for an
unknown id, so a caller can tell "this surface does not exist right now" — e.g. a mod
that is switched off and therefore has not registered. A panel action row for another
mod's surface uses exactly this, which is why no mod ever touches `lcm*` keys itself.

## Deliberate divergences / notes

- The panel's own row lost three controls: **Hide page controls** and **Show legacy
  control bar** (the green page bar the panel replaces is now hidden unconditionally
  at boot, and the stored `lcliteLegacyBar` key is dropped so an old `'true'` cannot
  bring it back), and **Reset all lclite settings** (there is no global settings wipe
  any more — a placement is reset on the surface it belongs to: Alt+right-click, or
  that mod's own Reset row). Fullscreen moved up to sit with the other canvas
  controls, so the LCLite rows now read canvas scale → fit to window → fullscreen →
  take screenshot, and **Pixel scaling left the core entirely**: it is a GPU setting
  now (the GPU mod owns `#canvas`'s `image-rendering` — Pixelated by default while
  the GPU is on, Auto whenever it is off), and the LCLite section keeps only a
  pointer row ("Pixel scaling moved" → Open GPU) so nobody hunts for it here. The
  core row it replaces was also wrong on the page's behalf: it read "Pixelated" by
  default while the page's own `filtering` key actually booted `auto` (smooth).
- The panel talks to the engine ONLY through localStorage + the reserved
  `window.lostcityClient`/`window.lcmAnchor` API. No hub reads: every mod's
  master key is written here but read by that mod at its own hook site.
- EVERY mod's master lives on its own row, in the list and inside its view, so
  turning a mod off never requires leaving its settings; a mod whose master is
  off shows the offnote in place of its rows. (Camera's master used to ride the
  section header as well, because it gates a whole sub-tree — with no section
  header left, the row is the one place it lives.)
- A mod's view is its row PLUS its settings, with no group header: the row
  already carries the name, the star, the status line and the master, and a
  header over a single open section would just repeat the name.
- **A row with no master switch of its own is NOT the core.** The switch column
  renders the gold `core` pill only for `CORE_ID` (control-panel itself); any other
  master-less row — the synthesized row a dropped-in mod folder gets, or a mod whose
  settings are several rows with no single on/off — gets a muted `no switch` pill
  saying what is true ("on whenever it is installed"). Before that split the column
  fell through to the core pill, so every dropped-in mod claimed to be LCLite itself
  and told the player it "cannot be switched off from inside the game". The synthesized
  name comes from `cap(id)`, which had the same class of bug — a zero-width `^`
  alternative matched the empty string and capitalized nothing, so a folder called
  `demo-mod` listed as "demo Mod"; `cap` now captures the first letter in its own group
  and keeps the separator (`Demo Mod`, `Ground Items`).
- TCG/GPU rows carry a live `status()` line (positional `window.tcgInfo()`
  contract) refreshed on the panel's 400ms sync tick; TCG's reads
  `window.tcgLoggedIn()` first and says `not logged in` instead of reporting the
  `default` account's balance while the game is on its title screen.
- TCG is the first mod to grow a settings view purely for a PAGE overlay: its four
  HUD switches are keys ui.js reads at its own tick, and its two action rows call
  `window.tcgShowAlbum()` / `window.tcgOpenPack()` — the same entry points the
  HUD's right/left click uses, so hiding the box never strands the player.
- The row click-to-open behaviour predates the gear and stays (RuneLite parity);
  the gear exists because discoverability beat parity here. Inside a mod's own
  view the row's body click is a no-op — the row is that view's header, not a
  link to itself.
- Search spans the drill-down: a list row matches on its settings' names and
  descriptions too, so "outline" finds True tile; opening it carries the query
  into the view and shows only the rows that hit. That replaces the cross-mod
  settings search the Settings tab used to provide.
