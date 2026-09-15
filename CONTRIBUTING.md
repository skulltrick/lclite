# Contributing to LCLite

LCLite is an **out-of-tree mod overlay**: mods live as identity-anchored patch
hunks in `mods/` and are applied to freshly cloned
[Lost City](https://github.com/LostCityRS) repositories by
`tools/lclite.mjs`. The whole design exists so the overlay survives upstream
rev updates without hand-merges. Contributions must keep that property —
`tree = f(upstream@rev, overlay)` is the invariant; everything else is detail.

## Dev setup

1. A working Lost City checkout (its `start.bat` once, so `webclient/` and
   `engine/` exist) — **not** committed here.
2. Clone this repo *into* it as `lclite/`.
3. Node 18+ to install; [bun](https://bun.sh) only to build the webclient
   bundle (the installer prints how to get it and self-serves `bun install`).

Layout: player-facing entry `LCLite.bat` → everything else in
[`tools/`](tools) (installer, regen, doctor, shared lib). Authoring guide for
mods of every kind: [docs/MODS.md](docs/MODS.md).

## Authoring a mod

- **TYPE A (UI-only)** — a panel row writing a `localStorage` key. No engine
  patch, no rebuild: `node tools/lclite.mjs apply` re-copies the statics.
- **TYPE B (engine mod)** — edit the upstream TS sources in your working tree,
  **start every added block with a `lclite:<mod>` marker comment**, then
  `node tools/regen.mjs` extracts the hunks into `mods/<name>/patches/*.json`.
- **TYPE C (visual entities)** — model overrides / fake NPCs: files/ code + a
  minimal import hunk; hook-site blueprint in docs/MODS.md.

Rules that keep hunks durable:

- Marker-first ownership (regen routes by `lclite:<mod>`, warns on unmarked
  hunks). Keep a mod's blocks ≥3 untouched lines apart — the old ≥61-line
  isolation rule is retired; `node tools/lclite.mjs doctor` (exit 3) now
  machine-verifies no hunk's deletions can break a sibling's anchor.
- Never hand-edit inside an already-patched region without regenerating right
  after. `engine/public/client/client.js` is built, never hand-patched or
  committed.
- Never commit the modded state on the tracked upstream branch — regen diffs
  the working tree against HEAD and pins `generated_from`; a committed modded
  HEAD makes the overlay think there's nothing to apply.

## Acceptance test (required for PRs touching hunks)

Pristine clones at the base revs + apply must reproduce the patched tree
**byte-for-byte**:

```
git clone https://github.com/LostCityRS/Client-TS  t/webclient
git clone https://github.com/LostCityRS/Engine-TS  t/engine
# checkout the revs printed in mods/*/patches/*.json "generated_from"
cp -r . t/lclite && cd t && node lclite/tools/lclite.mjs apply --no-build
git -C webclient diff --stat     # must show exactly your hunks, clean
node lclite/tools/lclite.mjs doctor   # exit 0 = structural checks pass
```

Also prove independence: `node tools/lclite.mjs apply --mods <yours>` applies
your mod + the required ones and strips the rest without errors.

## Commit style

`install:` / `mods/camera:` / `panel:` / `docs:` prefixes, imperative mood,
say *why* — the diff already says *what*. One logical change per commit.

## What this repo must never contain

Game caches, map/npc/obj data, `node_modules`, built `client.js`, or the
upstream repos themselves. Only the overlay: patch JSONs, panel statics,
tool scripts, docs.

## AI agents

Working on LCLite from an AI session? [`FOR_AGENTS_README.md`](FOR_AGENTS_README.md)
first — hard rules, loops, and the files that machine-check them. It pairs
with the architecture dossier in [docs/hunk-system-assessment.md](docs/hunk-system-assessment.md).

Starting a fresh agent on a new mod? Paste it this brief (swap in your idea;
it bootstraps any competent model onto this machine's discipline):

```
You are building a mod for LCLite, the out-of-tree mod overlay for the
Lost City / 2004Scape Build-289 webclient. The mod to build: <IDEA — one paragraph, what a player should notice>.

Repo: <path-to>/Build-289/lclite (git: skulltrick/lclite, branch main). The game checkout is one level up:
webclient/ and engine/ are upstream repos — NEVER commit modded state there.

Boot in this order before touching anything:
1. Read FOR_AGENTS_README.md (hard rules), then docs/MODS.md (TYPE A/B/C guide).
2. cd lclite && node tools/lclite.mjs doctor   — exit 0 is your baseline; if not, stop and report.
3. node tools/lclite.mjs new <mod-name>        — scaffold + recipe.

Discipline (non-negotiable):
- Every added code block starts with a `lclite:<mod>` marker comment.
- After ANY source edit: node tools/regen.mjs BEFORE node tools/lclite.mjs apply.
- Preserve CRLF on file writes; text-mode whole-file rewrites silently flatten and corrupt the overlay.
- engine/public/client/client.js is built, never hand-edited.
- Dev-test with the dev bundle (window.lostcityClient.<field> is probeable there).

Done means ALL of: doctor exit 0 · apply --check 0 fails · the t/ pristine
harness reproduces your tree byte-identical across all patched files
(§Acceptance above) · tsc --noEmit clean · tools/lclite.mjs build succeeds ·
lclite committed + pushed.

When finished, report: what you built, what you verified (real outputs, not
claims), what you're unsure of, and a short "what to check in-game" list —
I test gameplay myself. If something must be aborted or redone, say so
directly; honest aborts are welcome, heroics are not.
```
