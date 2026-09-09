# Contributing to LCLite

LCLite is an **out-of-tree mod overlay**: mods live as anchor-based patch hunks
in `mods/` and are applied to freshly cloned [Lost City](https://github.com/LostCityRS)
repositories by `install.mjs`. The whole design exists so the overlay survives
upstream rev updates without hand-merges. Contributions must keep that property.

## Dev setup

1. Get a working Lost City checkout (run its own `start.bat` once so
   `webclient/` and `engine/` exist) — **not** committed here.
2. Clone this repo *into* that checkout so it reads
   `<lost-city>/lclite/{install.mjs, mods/…}`.
3. Node 18+ to install; [bun](https://bun.sh) to build the webclient bundle
   (the installer will tell you how if it's missing).

## Authoring a mod

Full walkthrough in [PLUGINS.md](PLUGINS.md) — TL;DR:

- **TYPE A (UI-only)**: a row in the panel's `MODS` registry
  (`mods/control-panel/files/engine/public/lclite/panel.js`) writing a
  `localStorage` key. No engine patch, no rebuild.
- **TYPE B (engine mod)**: edit the upstream TS sources in your working tree,
  test with the dev bundle, then `node regen.mjs` to re-extract your hunks
  into `mods/<name>/patches/*.json`. Register your mod's folder name + label
  in `MOD_META` (`lib.mjs`) — new folder = it appears in the installer's
  mod picker automatically.

Rules that make hunks durable:

- Keep each mod's edits **≥ 61 pristine lines apart** from other mods' edits
  in shared files (`Client.ts`!), or `git -U30` merges the hunks and regen
  mis-routes ownership.
- Never hand-edit *inside* an already-patched replacement region and then run
  `install.mjs` without running `regen.mjs` first — that's how you get
  duplicated blocks (TS2300). The stale-JSON guard helps, regen is the cure.
- `find` anchors want 3+ lines of context and must stay unique.

## Acceptance test (required for PRs touching hunks)

Pristine clones at the base revs + `node install.mjs apply` must reproduce
the patched tree **byte-for-byte**:

```
git clone https://github.com/LostCityRS/Client-TS  t/webclient
git clone https://github.com/LostCityRS/Engine-TS  t/engine
# checkout the revs printed in each mods/*/patches/*.json "generated_from"
cp -r . t/lclite && cd t && node lclite/install.mjs apply --no-build
git -C webclient diff --stat     # must show exactly your hunks, clean
```

Also prove mod independence: `node lclite/install.mjs apply --mods <yours>`
applies your mod + the two required ones and strips the rest without errors.

## Commit style

`install:` / `mods/camera:` / `panel:` / `docs:` prefixes, imperative mood,
say *why* — the diff already says *what*. One logical change per commit.

## What this repo must never contain

Game caches, map/npc/obj data, `node_modules`, built `client.js`, or the
upstream repos themselves. Only the overlay: patch JSONs, panel statics,
installer scripts, docs.
