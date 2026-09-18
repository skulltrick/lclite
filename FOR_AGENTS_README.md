# FOR_AGENTS_README — working on lclite (read this first)

lclite = declarative overlay on Lost City repos: `tree = f(upstream@rev, mods/)`.
Hunks are minimal `{find, replace}` line arrays anchored by unique text; regen
extracts them from `git diff -U0` of the live tree. Deep context:
`docs/hunk-system-assessment.md`, `docs/archive/actions-2026-09.md`.

**Hunks are per-revision.** A mod ships one corpus per revision it supports —
`mods/<mod>/patches/<rev>/` — declared in `revs.json`, verified by
`tools/matrix.mjs`, ported by `tools/port.mjs`. Read
[docs/REVS.md](docs/REVS.md) before touching anything about revisions: it is the
authority on the model, the resolution rule and the workflows.

## Where things live (read this before running anything)

- **This repo is the overlay, on its own** — `mods/`, `tools/`, `docs/` and the
  launcher (`launcher/`, `LCLite.exe`). Nothing is cloned into it, and it is not a
  Lost City checkout: `webclient/` + `engine/` are NOT here.
- **The tree you patch is an install**: `<data>/installs/<rev>/{webclient,engine,content}`
  (data folder = `%LOCALAPPDATA%\LCLite` on Windows, `~/.local/share/lclite`
  elsewhere). The launcher makes those; its dashboard is the normal way to manage them.
- **Drive an install with `LCLITE_ROOT`** — this is the shape every loop below
  assumes now:

  ```
  LCLITE_ROOT=<install> node tools/lclite.mjs [list|apply|build|doctor|uninstall]
  LCLITE_ROOT=<install> node tools/doctor.mjs
  ```

  Without `LCLITE_ROOT` the tools look one level above this repo; with no host tree
  there, doctor exits 3 with a message saying exactly that (not a wall of "off" mods).
- **Restoring a broken overlay state**: `git checkout -- mods docs` — NOT
  `git checkout -- .`, which also reverts uncommitted tooling fixes you are mid-way
  through (it silently un-fixes regen/doctor and the next run then does the wrong
  thing). Check `git stash list` too: a stash left behind by an interrupted
  idempotency test holds the very patch JSONs you think are missing.
- **Mods are read from THIS checkout**, not from an install's `lclite/` copy: the
  launcher prefers the overlay it was launched from, so edits here take effect
  immediately (the UI labels it "from your checkout"). The install's copy is the
  fallback for a launcher that lives alone, and `root.json` still describes a host
  layout for custom servers.
- **Installs are shallow clones**, so git history isn't available inside them:
  `merge-base`/`cat-file` on a pinned commit fails there, and doctor reports that as
  a note rather than drift. `apply --check` and the hunk counts are the authority.

## Hard rules (violations have caused real incidents)
1. **Never hand-edit inside a hunk's replacement region without running
   `node tools/regen.mjs` right after.** The stale-JSON guard only warns;
   double-apply corruption (TS2300) happened twice before the guard existed.
2. **Every added code block starts with a marker line/comment `lclite:<mod>`**
   (e.g. `// lclite:camera`). Regen routes hunks by marker with 100% precision;
   the regex fallback is a legacy path and regen WARNS when it fires.
3. **`engine/public/client/client.js` is built, never patched.** Don't commit a
   modified client.js by accident; `git checkout --` it before rev pulls.
4. Source files are **CRLF** (checkout convention, autocrlf=true, LF in git
   objects). Tools must preserve them; regen trips a warning if flattened.
5. New mods read their OWN localStorage key at their own hook site, per frame.
   No settings hub, no cross-mod key reads (the old applyCameraSettings hub is gone).
6. **NEVER commit the modded state onto the tracked upstream branch** (webclient/
   engine). Regen diffs working-tree vs HEAD and pins `generated_from` to HEAD:
   a committed modded HEAD makes the diff empty → regen "proves" the tree is
   unmodded and DELETES all hunks + docs/hooks.json. The working tree stays
   dirty-by-design; only lclite/ gets commits. (README's "commit modded state
   before upgrading" step is a manual-merge fallback for drift emergencies only —
   run it, upgrade, reseat, then `git reset` back before the next regen.)
8. **A mod is all-or-nothing per revision.** If it cannot be fully re-anchored on a
   revision it does not go there partially: `port.mjs` reverts it, and the launcher lists
   it as unavailable. Half a mod is a broken mod (camera without its visibility hook,
   control-panel without its terser reserves — the latter mangles the page-facing API
   silently). Never hand-place the missing hunks of a mod you skipped.
9. **A revision's corpus has exactly one author: regen.** Never hand-write a patch JSON
   for a revision, and never hand-edit the applied lines of a ported revision without
   running regen afterwards — regen is what turns "the tree on that revision is right"
   into "that revision's corpus is right". And a revision must be declared in `revs.json`
   BEFORE regen will file a corpus under it.
10. **Update `mods/<name>/README.md` in the same commit as any behavior change.**
   It is the ONLY handoff the next agent's resume reads (design intent, what's
   in the box, the settings contract, deliberate divergences — see mods/tcg for
   the layout). A stale README is a stale map: one honest line costs less than
   the next agent's re-derivation. Mods predating the scaffold have no README —
   the first nontrivial change to one writes it.

## Loop for a TYPE B (engine) change
edit live tree (marker!) → `node tools/regen.mjs` (writes that revision's corpus) →
`node tools/lclite.mjs apply --check` (0 ✗) → `node tools/doctor.mjs` (exit 0) →
`node tools/matrix.mjs` (every declared revision still green — a new hunk on the primary
can expire a revision that inherits it) → acceptance: pristine clones + `LCLITE_ROOT`
apply must be byte-identical to the live tree (README §acceptance) →
`node tools/lclite.mjs build` → commit lclite repo (and webclient/engine commit
messages per README). Anchor drift is expected occasionally; reseat find[] against the
printed hint lines (they include fuzzy line numbers). For a revision with its OWN
corpus, the same edit needs `node tools/port.mjs <rev>` + regen afterwards — that is the
recurring cost of a non-inheriting revision, and why `inherits` is the default.

## Loop for a TYPE A (panel) change
edit `mods/control-panel/files/engine/public/lclite/panel.{js,css}` →
`LCLITE_ROOT=<install> node tools/lclite.mjs apply` (re-copies files) → browser
check. No rebuild. (Drop `LCLITE_ROOT` if you copied this repo inside a checkout.)

## Loop for a LAUNCHER change
`launcher/` is Go, stdlib only, zero modules in go.mod — keep it that way (the
whole point is one ~8 MB static binary with no runtime). `go vet` + `go build`
before committing; `go run build.go` cross-builds. The browser UI is a single
embedded file, `launcher/ui/index.html`. The launcher is a CLIENT of
`tools/lclite.mjs`: it must never grow its own copy of hunk/apply logic, only
shell out and report, so the overlay keeps exactly one implementation.
Behaviour changes ship with `launcher/README.md` updated in the same commit
(rule 7 applies to this folder too). UI changes need a browser, and a screenshot
alone is not evidence: check the DOM/state transitions too (a step indicator that
never updates, or a poll that un-ticks your boxes, looks fine in a still).

## Files
launcher/ Go launcher (main/state/actions/tools/gitops/jobs/pipeline/engine/proxy/mods + ui/index.html; build.go cross-builds) ·
tools/lclite.mjs applier/picker/build (+`doctor`, `new <mod>`, `--rev`) · tools/regen.mjs hunk extractor
(writes mods/<mod>/patches/<rev>/ + docs/hooks.json, docs/HOOKS.md for the primary) ·
doctor.mjs health report (exit 2 drift / 3 structural — also 3 when there is no host
tree here; audits EVERY corpus's pins/markers, not just the tree's) ·
matrix.mjs replays every declared revision over pristine clones (the gate on
`inherits`) · port.mjs re-anchors the primary corpus onto another revision (assisted
reseat + typecheck gate, all-or-nothing per mod) · lib.mjs shared helpers (+ the
reseater) · revs.json the revision declaration (primary + supported + inherits) ·
root.json host layout (repo dirs/remotes — edit for custom 2004-lineage servers) ·
mods/<name>/{patches/<rev>/*.json, files/, README.md}.
Commands: `node tools/lclite.mjs [apply|build|pick|list|doctor|new <mod>|uninstall] [--rev <rev>]`.

## References beyond this repo
The SERVER side of the stack is documented too: the Lost City content repo has a
RuneScript reference site — https://sysdevs.org/runescript.html (sources in the
sibling `content/` repo). Authoritative for interface/widget & modal semantics,
triggers, the 517 engine commands, the 18 config formats, NPC/zone update loops,
varps/params, and content-side companion features. When frontier client work
depends on what the server actually does (TYPE C fake entities, modal-driven
flows, anything you'd otherwise reverse-engineer from packets), look it up
there BEFORE guessing — use the site's "I need to…" index.
