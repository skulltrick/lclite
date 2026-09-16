# Contributing to LCLite

LCLite is an **out-of-tree mod overlay**: mods live as identity-anchored patch
hunks in `mods/` and are applied to freshly cloned
[Lost City](https://github.com/LostCityRS) repositories by
`tools/lclite.mjs`. The whole design exists so the overlay survives upstream
rev updates without hand-merges. Contributions must keep that property —
`tree = f(upstream@rev, overlay)` is the invariant; everything else is detail.

## regen refusals (read before regenerating)

`regen.mjs` extracts hunks from the tree at `LCLITE_ROOT` and rewrites
`mods/*/patches/`. Three states make that impossible, and it stops rather than
writing nonsense:

| State | Exit | What it means |
|---|---|---|
| no host tree at `LCLITE_ROOT` (or none set, overlay on its own) | 3 | nothing to diff — point it at an install |
| the tracked branch's HEAD already carries `lclite:` markers | 3 | modded state committed on the branch (rule 6) — `git reset --mixed HEAD~1` keeping the tree, then regen |
| a tree with no modded lines (pristine, or already stripped) | 2 | wrong tree — nothing written, nothing deleted |

Stale patch JSONs whose file no longer has hunks are **reported, not deleted**;
add `--prune` when you actually want them gone (a convergent
`apply --mods <one>` strips the others, which looks identical from inside regen).

## Dev setup

1. **The repo on its own** — it no longer lives inside a Lost City checkout.
   It holds the overlay (`mods/`, `tools/`, `docs/`) *and* the launcher
   (`launcher/`, `LCLite.exe`).
2. **A tree to patch.** The launcher installs revisions into its data folder:

   ```
   %LOCALAPPDATA%\LCLite\installs\<rev>\   webclient/  engine/  content/  lclite/
   ```

   That folder is your live tree. Copying this repo in as `lclite/` (the layout
   LCLite grew up in) still works and needs no `LCLITE_ROOT`; otherwise point the
   tools at it:

   ```
   LCLITE_ROOT="%LOCALAPPDATA%\LCLite\installs\289" node tools/lclite.mjs apply
   ```

   Either way the overlay you edit is *this* checkout: the launcher prefers the
   copy it was launched from over each install's cloned copy, so mod edits land
   immediately. (The UI says which one it used: "from your checkout".)
3. Node 18+ to install; [bun](https://bun.sh) only to build the webclient
   bundle (the installer prints how to get it and self-serves `bun install`).

Layout: player-facing entry `LCLite.bat` → everything else in
[`tools/`](tools) (installer, regen, doctor, shared lib). Authoring guide for
mods of every kind: [docs/MODS.md](docs/MODS.md).

## Authoring a mod

- **TYPE A (UI-only)** — a panel row writing a `localStorage` key. No engine
  patch, no rebuild: `node tools/lclite.mjs apply` re-copies the statics.
- **TYPE B (engine mod)** — edit the upstream TS sources in your working tree
  (`LCLITE_ROOT` if you're not standing in one), **start every added block with a
  `lclite:<mod>` marker comment**, then `node tools/regen.mjs` extracts the hunks
  into `mods/<name>/patches/*.json`.
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

Fast form — against a real install (every anchor must be found, doctor healthy):

```
LCLITE_ROOT=<install> node tools/lclite.mjs apply --check   # ✗0 on every mod
LCLITE_ROOT=<install> node tools/doctor.mjs                 # exit 0
```

Strong form — pristine clones at the base revs + apply must reproduce the patched
tree **byte-for-byte** (this is what CI proves):

```
mkdir t && cd t
git clone https://github.com/LostCityRS/Client-TS  webclient
git clone https://github.com/LostCityRS/Engine-TS  engine
git -C webclient checkout <head from mods/*/patches/*.json generated_from>
git -C engine    checkout <head from mods/*/patches/*.json generated_from>
cp -r .. lclite && cd lclite          # the overlay copy, tools included
node tools/lclite.mjs apply --no-build # t/ is the host root (one level up)
git -C ../webclient diff --stat        # must show exactly your hunks, clean
LCLITE_ROOT=.. node tools/doctor.mjs   # exit 0 = structural checks pass
```

A `t/` host root is the same shape an install has, so anything CI can prove there
holds for the launcher's installs too. `doctor` treats a pin that is merely older
than HEAD as a note (the launcher clones branch tips) and a shallow clone it can't
compare as a note as well — the hunk counts are the authority.

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
Lost City / 2004Scape webclient (the 289 lineage; installs can be any revision).
The mod to build: <IDEA — one paragraph, what a player should notice>.

Repo: <path-to>/lclite (git: skulltrick/lclite, branch main) — the overlay and the
launcher, standalone. The tree to patch is an install: %LOCALAPPDATA%\LCLite\installs\<rev>\
(webclient/ + engine/ + content/ are upstream repos — NEVER commit modded state there).

Boot in this order before touching anything:
1. Read FOR_AGENTS_README.md (hard rules), then docs/MODS.md (TYPE A/B/C guide).
2. LCLITE_ROOT=<install> node tools/doctor.mjs  — exit 0 is your baseline; if not, stop and report.
3. node tools/lclite.mjs new <mod-name>        — scaffold + recipe (this repo).

Discipline (non-negotiable):
- Every added code block starts with a `lclite:<mod>` marker comment.
- After ANY source edit: node tools/regen.mjs BEFORE node tools/lclite.mjs apply.
- Preserve CRLF on file writes; text-mode whole-file rewrites silently flatten and corrupt the overlay.
- engine/public/client/client.js is built, never hand-edited.
- Dev-test with the dev bundle (window.lostcityClient.<field> is probeable there).
- mods/<mod>/README.md is updated in the same commit as any behavior change (rule 7).

Done means ALL of: doctor exit 0 · apply --check 0 fails · the t/ pristine
harness reproduces your tree byte-identical across all patched files
(§Acceptance above) · tsc --noEmit clean · tools/lclite.mjs build succeeds ·
lclite committed + pushed.

When finished, report: what you built, what you verified (real outputs, not
claims), what you're unsure of, and a short "what to check in-game" list —
I test gameplay myself. If something must be aborted or redone, say so
directly; honest aborts are welcome, heroics are not.
```
