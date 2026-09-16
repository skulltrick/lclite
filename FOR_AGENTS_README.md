# FOR_AGENTS_README — working on lclite (read this first)

lclite = declarative overlay on Lost City repos: `tree = f(upstream@rev, mods/)`.
Hunks are minimal `{find, replace}` line arrays anchored by unique text; regen
extracts them from `git diff -U0` of the live tree. Deep context:
`docs/hunk-system-assessment.md`, `docs/archive/actions-2026-09.md`.

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
7. **Update `mods/<name>/README.md` in the same commit as any behavior change.**
   It is the ONLY handoff the next agent's resume reads (design intent, what's
   in the box, the settings contract, deliberate divergences — see mods/tcg for
   the layout). A stale README is a stale map: one honest line costs less than
   the next agent's re-derivation. Mods predating the scaffold have no README —
   the first nontrivial change to one writes it.

## Loop for a TYPE B (engine) change
edit live tree (marker!) → `node tools/regen.mjs` → `node tools/lclite.mjs apply --check`
(0 ✗) → `node tools/doctor.mjs` (exit 0) → acceptance: pristine `t/` clones +
`LCLITE_ROOT` apply must be byte-identical to the live tree (README §acceptance)
→ `node tools/lclite.mjs build` → commit lclite repo (and webclient/engine
commit messages per README) . Anchor drift is expected occasionally; reseat
find[] against the printed hint lines (they include fuzzy line numbers).

## Loop for a TYPE A (panel) change
edit `mods/control-panel/files/engine/public/lclite/panel.{js,css}` →
`node tools/lclite.mjs apply` (re-copies files) → browser check. No rebuild.

## Files
tools/lclite.mjs applier/picker/build (+`doctor`, `new <mod>`) · tools/regen.mjs hunk extractor
(+docs/hooks.json, docs/HOOKS.md) · doctor.mjs health report (exit 2 drift / 3
structural) · lib.mjs shared helpers · root.json host layout (repo dirs/remotes —
edit for custom 2004-lineage servers) · mods/<name>/{patches/*.json, files/, README.md}.
Commands: `node tools/lclite.mjs [apply|build|pick|list|doctor|new <mod>|uninstall]`.

## References beyond this repo
The SERVER side of the stack is documented too: the Lost City content repo has a
RuneScript reference site — https://sysdevs.org/runescript.html (sources in the
sibling `content/` repo). Authoritative for interface/widget & modal semantics,
triggers, the 517 engine commands, the 18 config formats, NPC/zone update loops,
varps/params, and content-side companion features. When frontier client work
depends on what the server actually does (TYPE C fake entities, modal-driven
flows, anything you'd otherwise reverse-engineer from packets), look it up
there BEFORE guessing — use the site's "I need to…" index.
