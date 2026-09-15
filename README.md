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
  `lclite/mods/` with small semantic patches (`{find, replace}` line arrays —
  `find` is the MINIMAL unique window around the change, not a context blob).
  Every added code block carries a `lclite:<mod>` marker comment, so hunks are
  owned by declaration, never by guesswork. On a new rev, a hunk either applies
  clean or prints exactly which anchor drifted — and *where its lines moved* —
  so reseating is minutes, not archaeology. Your settings UI and static assets
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
| `mods/true-tile/` | OSRS-style **true tile**: an outline on the tile the server actually has you on (the route head the move codes push into), not the walk-interpolated model position that trails a tick. RuneLite Tile-Marking style options — color, border thickness 1–8px, translucent fill, only-when-desynced — all read per-frame from localStorage, live with no reload. On by default |
| `mods/stat-orbs/` | HP/Prayer/Energy orbs down the lower-left of the minimap (OSRS layout), drawn into the minimap widget buffer so they ride on top of the interface; numbers always visible, ghost-wipe on toggle-off |
| `mods/anti-cheat/` | Toggle for the legacy RuneScope telemetry (mouse/camera/anticheat packets) — whole-packet suppression keeps the ISAAC keystream aligned; harmless off on private servers |
| `mods/rendering/` | Smooth (per-pixel Gouraud) vs blocky 4px shading option, saved/restored correctly through item-icon rendering |
| `mods/gpu/` | RuneLite-GPU-style **WebGPU renderer** for the 3D world: triangles captured at the `Pix3D` raster entry points (gouraud/flat/textured, incl. affine texel sampling mirroring the software raster) and replayed on the GPU in exact capture order (seq-as-depth painter's algorithm, 2 draw calls/frame); chat/HUD/interfaces keep rendering on the CPU and composite as a pixel-exact dirty-rect overlay; auto-falls back to software on any GPU error with the reason in the panel badge |
| `mods/control-panel/` | The F1 settings panel itself (FAB, search, groups), its `client.ejs` injection, and the terser property-reserves that keep the panel↔engine contract stable across builds |

Adding a new mod = new folder under `mods/` — the installer discovers it
automatically. The ideas register and the how-to live in
[PLUGINS.md](PLUGINS.md).

## Quick start

**Windows:** double-click **`install.bat`** — it lists the available mods with
checkboxes (`[X]` installed / `[ ]` off). Toggle with the number keys, Enter
installs your selection and builds. Unchecked mods are stripped back to
pristine upstream code, so rerunning the picker is also how you change your
mod set later.

**Any OS (terminal):**

```
node install.mjs                 # picker (double-click install.bat does this)
node install.mjs apply           # apply ALL mods, no build (piped/CI default)
node install.mjs apply --check   # dry-run report only
node install.mjs build           # bun bundle + copy client.js into engine/public/client/
node install.mjs list            # machine-readable: name|installed|label|desc
node install.mjs uninstall       # strip everything back toward pristine upstreams
```

This repo is an *overlay*, not a fork: clone it **into** a Lost City checkout
(run Lost City's own `start.bat` once so `webclient/` and `engine/` exist, then
`git clone <this repo> lclite/` next to them). Everything above runs from
`lclite/`, auto-detects the install one level up (`LCLITE_ROOT=<path>` to
point elsewhere), needs Node 18+, and [bun](https://bun.sh) only to build the
bundle (the installer prints how to get it and self-serves `bun install` for
missing webclient deps). After it finishes: start the server and press **F1**
in the webclient.

Mods you didn't select don't leave dead controls behind — the installer writes
`engine/public/lclite/installed.json` and the panel hides rows (and whole
groups) for mods that aren't installed.

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
3. Any hunk that fails prints the anchor line, the reason (`anchor not found` = upstream
   drifted) and ↳ hints naming the line where its most distinctive context now lives —
   open `lclite/mods/<name>/patches/<file>.json`, update the `find` array to the new
   surrounding code, rerun. Ambiguity errors (`N matches`) mean the anchor isn't
   unique — lengthen its context.
4. When the apply is clean, `node lclite/regen.mjs` snapshots any reseating you did back
   into the overlay (and refreshes `docs/HOOKS.md` + `docs/hooks.json`) and
   `git add lclite/ && git commit` — the overlay is now tracking the new rev.

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
    gpu/               one Client.ts import hunk + files/webclient/src/gpu/:
                       GpuFormat.ts (backend-neutral capture contract), GpuContext.ts
                       (WebGPU bootstrap), GpuShaders.ts (WGSL), GpuRenderer.ts
                       (capture + scene/overlay passes; monkey-patches the Pix3D
                       raster entry points + Pix2D/PixMap at load time)
                       + tools/gpu_parity_test.ts (bun; software-vs-shader parity)
    control-panel/     patches/client_ejs.json (injection) + bundle.ts (terser reserves)
                       + files/engine/public/lclite/panel.{js,css} (static assets,
                       copied verbatim into the tree)
```

Engine mods' edits in a shared file like `Client.ts` are separated by **markers**
(every added block starts with `// lclite:<mod>`) and `git -U0` islands, so regen can
never merge two mods into one hunk and `install.mjs doctor` machine-verifies no hunk's
deletions can break another's anchor (exit code 3). The old "≥61 pristine lines apart"
convention is retired — see PLUGINS.md.

## The panel (RuneLite-style)

FAB button docked **top-right** (RuneLite plugin-menu style); **F1** or click to
open; `/` opens + focuses search. Two tabs, mirroring RuneLite's two surfaces:

- **Mods** — one row per installed mod (derived from `installed.json`, so a
  new mod folder appears with zero panel edits): name, real description, and a
  **master switch**. Clicking the row jumps to its Settings section (and
  expands it — sections open collapsed by default). Single-toggle
  mods (stat orbs, xp drops, true tile, anti-cheat, rendering, gpu) live
  entirely here — their master switch *is* their engine key, no redundant
  section (RuneLite: plugin without config ⇒ no config screen).
- **Settings** — collapsible sections per mod, only for mods that HAVE sub-settings
  (currently Camera and the LCLite page section). A section expands when you
  jump to it from the Mods tab or click its header; expansion is remembered for
  the page session only — fresh loads start collapsed, no per-section persistence.
  Search filters the visible tab and hides empty sections; tooltips still feed it.

**Pin (lock) button** next to the ✕: while pinned, the panel survives in-game
clicks (outside-click close is disabled) so you can tweak settings while
playing; the ✕ and F1 still close it. Pin state persists
(`lclitePanelPinned`); last-opened tab too (`lclitePanelTab`).

Master switches: a single-toggle mod's master is its own engine key (the mod
reads its key per-frame, so master-off is instant). Camera is the only
multi-setting mod; its master key `camera` is honored live inside
`applyCameraSettings()` (off ⇒ vanilla camera, zoom back to 1×). The panel
calls `applyCameraSettings()` after every change as a cheap wake-up for mods
that don't poll (zoom slider).

The legacy green bar is hidden by default (re-enable via "Show legacy
control bar"). Brand mark on the FAB/header: a Zanaris-blue crescent moon (the
blue of the Lost City quest) cradling a gold lightning bolt — the "lite".

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

## Disclaimer

We have not been endorsed by, authorized by, or officially communicated with
the Lost City team / 2004Scape project on our efforts here.

"Lost City", "2004Scape" and their
repositories are the work of the Lost City contributors and follow their own
licenses. "RuneLite" is a trademark of the RuneLite project — the name
"LCLite" and this plugin-layer concept are homages only. No game files,
assets, or cache data are distributed with this repository; you supply your
own Lost City installation and its content packs.
