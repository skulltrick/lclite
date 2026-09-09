# LCLite — a RuneLite-style plugin layer for the Lost City webclient

**LCLite** brings the RuneLite idea to 2004Scape / Lost City: a growing
collection of quality-of-life mods (OSRS-style XP tracker, camera overhaul, a
settings panel…) layered on top of the vanilla webclient — **without forking it**.

The goal is *build-agnostic*: Lost City keeps shipping new revs, new content, and new
cache packs, and you should be able to hop to the latest build and have every LCLite
mod ride along with you. Nothing is hand-merged into upstream code.

## How it works

RuneLite injects plugins into a running client; a compiled TypeScript bundle can't be
hot-swapped like that, so LCLite adapts the concept: your engine mods live
**out-of-tree** in `lclite/` as *anchor-based patch hunks* that are applied to freshly
cloned upstreams and rebuilt:

```
upstream clone (pristine)  +  lclite overlay  →  node lclite/install.mjs  →  modded, playable client
```

- **Hunks are the durable artifact.** Each mod owns a folder under
  `lclite/mods/` with small semantic patches (`{find, replace}` line arrays with
  3+ context lines). On a new rev, a hunk either applies clean or prints exactly
  which anchor drifted — reseat the anchor, done. Your settings UI and static assets
  are plain files, copied verbatim, so they never conflict.
- **The panel is the plugin surface.** A RuneLite-style popover (F1) renders every
  mod as a toggle/slider; the settings bus is `localStorage` keys and the engine
  contract is `window.lostcityClient.applyCameraSettings()` — boring, stable names
  that survive minification *and* revs. A UI-only plugin (TYPE A) needs zero engine
  changes; anything that touches the client (TYPE B) is a TS hunk + a panel row.
  See [PLUGINS.md](PLUGINS.md) for the full developer guide.
- **Mods degrade gracefully.** If a hunk can't be reseated on some future rev,
  only that mod goes quiet — the panel, the rest of the client, and every other
  mod keep working. Cache-dependent bits (e.g. the XP tracker's skill icons) fall
  back when the pack doesn't carry them.

## Mods shipped today

Each lives in its own folder under `mods/` — the installer discovers them, and a
rev-drift or removal in one can never take another down:

| Folder | What it adds |
|---|---|
| `mods/camera/` | OSRS-style wheel zoom (0.4–2.6×, eased), middle-drag rotate, one-shot ground pick, live visibility probe, viewRadius/farPlane scaling with zoom, chatbox wheel-scroll |
| `mods/xp-drops/` | OSRS-style XP drop rows (skill icon + `+N`) and a tan level-progress tracker in the viewport's top-right — burst-largest-gainer tracking, auto-hide after the last gain, drawn *under* interfaces so a right click never blanks it |
| `mods/stat-orbs/` | HP/Prayer/Energy orbs down the lower-left of the minimap (OSRS layout), drawn into the minimap widget buffer so they ride on top of the interface; numbers always visible, ghost-wipe on toggle-off |
| `mods/anti-cheat/` | Toggle for the legacy RuneScope telemetry (mouse/camera/anticheat packets) — whole-packet suppression keeps the ISAAC keystream aligned; harmless off on private servers |
| `mods/rendering/` | Smooth (per-pixel Gouraud) vs blocky 4px shading option, saved/restored correctly through item-icon rendering |
| `mods/control-panel/` | The F1 settings panel itself (FAB, search, groups), its `client.ejs` injection, and the terser property-reserves that keep the panel↔engine contract stable across builds |

Adding a new mod = new folder under `mods/` — the installer discovers it
automatically. The ideas register and the how-to live in
[PLUGINS.md](PLUGINS.md).

## Quick start (rev-agnostic; generated against 289)

```
node lclite/install.mjs                 # apply all hunks to webclient/ + engine/, then build+deploy
node lclite/install.mjs apply --check   # dry-run report only
node lclite/install.mjs build           # bun bundle + copy client.js into engine/public/client/
```

## Upgrading to a newer Lost City rev

**Before updating, commit your modded state in each repo** so nothing is lost:

```
git -C webclient add -A && git -C webclient commit -m "lclite: camera + xp-drops + panel"
git -C engine add view && git -C engine commit -m "lclite: panel injection"     # NOT public/client/
```

`engine/public/client/client.js` is git-tracked upstream — don't commit your built copy or
`git pull` will conflict on it. If it ever blocks a pull: `git checkout -- engine/public/client/client.js`
then update, then `node lclite/install.mjs` rebuilds it.

Then:

1. `start.bat` → *change-version* (wipes engine/webclient/content/javaclient and clones the new rev —
   `lclite/` at the root survives this, which is exactly why it lives here),
   or `git pull` inside each repo for the same rev line.
2. `node lclite/install.mjs` — clean apply → done, build, play.
3. Any hunk that fails prints the anchor line and reason (`anchor not found` = upstream
   drifted). Open `lclite/mods/<name>/patches/<file>.json`, fix the `find` array to the
   new surrounding code (3+ lines of context), rerun. Ambiguity errors (`N matches`) mean
   the anchor isn't unique — lengthen its context.
4. When the apply is clean, `node lclite/regen.mjs` snapshots any reseating you did back
   into the overlay and `git add lclite/ && git commit` — the overlay is now tracking
   the new rev.

**The acceptance test for any of this**: pristine clones at the new rev + `install apply`
must reproduce your working tree byte-for-byte. (`t/` holds throwaway clones for exactly
this.)

## Adding a new mod

1. Work in the live tree (`webclient/src/...`), test fast with the dev bundle.
2. `node lclite/regen.mjs` after adding the file to the `MODS` map (new mod =
   new folder with patch JSONs + optional `files/`; hunks in shared files like
   `Client.ts` are routed to the owning mod automatically).
3. Expose a panel row (TYPE A) for its settings key if users should toggle it.
4. Keep hunks small and semantic — they're the durable artifact, not the build output.

Full walkthrough with hook-site tables and the panel/engine contract:
[PLUGINS.md](PLUGINS.md).

## Layout

```
lclite/
  install.mjs          applier + builder (node, zero deps)
  regen.mjs            re-extracts hunks from your working tree (run AFTER you edit the
                       engine sources, before committing the overlay); HUNK_OWNER rules
                       route hunks in shared files (Client.ts!) to their owning mod
  PLUGINS.md           developer guide: TYPE A (UI) vs TYPE B (engine) plugins,
                       the settings contract, ideas register
  mods/
    camera/            Client/GameShell/World/Pix3D/Model hunks: wheel zoom, rotate,
                       ground pick, visibility + far-plane plumbing (zoom-owned)
    xp-drops/          Client.ts hunks: XP rows + tan tracker panel (top-right, auto-hide)
    stat-orbs/         Client.ts hunks: HP/Prayer/Energy orbs on the minimap widget
    anti-cheat/        Client.ts hunks: telemetry gates at every packet emission site
    rendering/         ObjType.ts hunks: smooth-shading save/restore for item icons
    control-panel/     patches/client_ejs.json (injection) + bundle.ts (terser reserves)
                       + files/engine/public/lclite/panel.{js,css} (static assets,
                       copied verbatim into the tree)
```

Engine mods whose hunks share `Client.ts` keep their code in **isolated regions**
(fields + methods parked ≥61 pristine lines from other mods' edits) so regen can
never merge two mods into one hunk — see PLUGINS.md for why 61.

## The panel (RuneLite-style)

FAB button docked **top-right** (RuneLite plugin-menu style); **F1** or click to open;
`/` opens + focuses search. Groups: Camera / Display / Interface / Rendering /
Compatibility. One-line rows — each setting's description is a hover **tooltip**
(left of the panel, below the row on narrow windows) instead of per-row subtext, and
tooltips still feed the search box. Toggles + a live zoom slider synced to in-game
wheel zoom. The legacy green bar is hidden by default (re-enable via "Show legacy
control bar"). Brand mark on the FAB/header: a Zanaris-blue crescent moon (the blue
of the Lost City quest) cradling a gold lightning bolt — the "lite".

## Notes / invariants

- Never patch `engine/public/client/client.js` — it's built, not hand-edited.
- IDLE_TIMER / NO_TIMEOUT packets are never suppressed by the anti-cheat toggle.
- Anti-cheat suppression skips whole packet blocks (opcode+payload) to keep the ISAAC
  opcode-mask keystream aligned — partial skips would desync and disconnect.
- Zoom is capped 0.4–2.6: the 289 engine has no skybox and a 63-tile (8064px) build-area
  load radius; past that the data horizon enters frame.
- Overlay draw order: anything in the game buffer must be drawn *before*
  `otherOverlays()` so interfaces (modals, the right-click menu) paint over it —
  that's what keeps the XP tracker from ever floating on top of an interface.
