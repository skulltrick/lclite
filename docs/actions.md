# Hunk system — action plan

Date: 2026-09-15. Why: see `hunk-system-assessment.md`. Goal: **fast agent +
human workflow** and **cheap integration onto any new Lost City build**.
Rule of thumb: prefer deterministic over inferential; every rule must be
machine-checked by `apply --check` + CI so tribal knowledge (61-line rule,
regen-before-install ordering) retires.

Not planned, deliberately: a formal plugin SDK / registry over the top, a TS
AST-aware applier, any javaclient work, and **TS-converting the tools**
(see below) — all deferred or rejected until rev-day data says otherwise.

### Rejected 2026-09-15: converting install/regen/lib/panel to TypeScript
- `node install.mjs` zero-deps on Node 18+ *is* the integration story for
  "any new build, any user's machine"; TS forces a compile step in the tool
  that installs, or pins users to bun/tsx. panel.js's whole TYPE-A speed win
  is "edit, re-copy, no rebuild" — a static the browser eats directly.
- None of the past incidents (TS2300 double-apply, HUNK_OWNER misroutes,
  slider no-op, anchor drift) are type errors — tsc would have caught zero.
- Where types DO pay without conversion (adopt with P1): one `.d.ts`/JSDoc
  schema per shared data shape (patch JSON, hooks.json, installed.json,
  root manifest) + `// @ts-check` on the three tool files + a CI step
  `tsc --noEmit --allowJs --checkJs lclite/*.mjs`. Plain .mjs ships; the
  agent/editor sees types. ~1 hour, no runtime change.

---

## P0 — Determinism (kills the two silent failure modes)

### A1. Ownership markers at hook sites → regen reads them, not guesses
- Convention: the FIRST added line of every mod's edit block carries
  `// lclite:<mod-name>` (or `// lclite:<mod> ...` with a note). Example:
  `private drawStatOrbs(): void { // lclite:stat-orbs`.
- `regen.mjs`: if any added line of a hunk contains a marker, the hunk belongs
  to the marked mod — 100% precision. `HUNK_OWNER` regexes demote to fallback
  (warn loudly when used: `[regen] hunk X has no marker, routed by score to Y`).
- Add markers to the existing 830 added lines in ONE sweep (they're comments:
  byte-diffs vs the acceptance tree only until the next regen re-snapshots —
  do markers + regen in the same commit).
- Effect: fixes assessment #2, and makes #3 near-impossible (regen no longer
  needs to *find* which mod a region belongs to).

### A2. Minimize `find` arrays (geography → smallest unique identity)
- `regen.mjs`: after extracting the -U30 window, SHRINK context from both ends
  while the region stays unique (occ==1) in the pristine file. Floor: keep
  ≥3 lines each side only as tiebreaker, not as a rule — the true stop
  condition is uniqueness, not length.
- Add `overlap`/`distance` metadata per hunk to the patch JSON (see A4) so CI
  can diff the quality trend.
- Effect: fixes #1. The 130-line anti-cheat anchor should collapse to ~10.
  Fewer false deps = less rev-day reseating, smaller patch JSONs = faster agent
  reads. Re-measure corpus after: context lines per payload line is the KPI.

### A3. Machine-check the 61-line rule (and hunk overlap) in `apply --check`
- During a check-run, compute each hunk's region in the pristine file and
  assert pairwise non-overlap per file; emit `OVERLAP camera↔anti-cheat @Client.ts`
  style failures that feed exit code 2.
- Effect: #4 becomes a CI error instead of a coin-flip; a new agent can put two
  mods 20 lines apart and get told, not silently merged.

**Acceptance for all P0:** pristine t/ clones + `install apply` still
byte-identical to the live tree (existing harness); `apply --check` green on CI;
regen idempotent (run regen twice → `git diff` on lclite/ empty).

---

## P1 — Workflow speed (the mission: agent-first)

### B1. `lclite doctor` command
One command, structured output, no guessing:
- per-mod: installed | hunks ok/drifted/ambiguous | pinned rev vs actual HEAD
- per-file: overlap verdict, marker coverage (% hunks with owner marker)
- corpus stats (hunks, added lines, median anchor size) + exit code contract
  (0 clean / 2 drift / 3 overlap or marker gap). Add to CI as the report step.

### B2. `lclite new <mod-name>` scaffold
Creates `mods/<name>/{patches/,files/}`, a stub README block, a MOD_META entry,
and prints the 5-step recipe (edit live tree with marker → regen → install →
t/ proof → panel row if TYPE A). New mod = one command, not a wiki hunt.

### B3. Agent onboarding docs
- `lclite/docs/HOOKS.md` — per repo: where the stable seams live (file, method,
  what Pix2D/Pix3D are bound to there, which mods already live nearby). The
  PLUGINS.md hook-site table graduates into a maintained machine-readable
  `hooks.json` (file → method → consumers) that `doctor` validates against the
  actual tree.
- `AGENTS.md` at lclite/ root: 30-line pointer — read assessment, run doctor,
  regen before install, markers mandatory, acceptance test command verbatim.

### B4. Reseat assistance
When `apply` reports `anchor not found`, print a context diff: the hunk's first
2 + last 2 find lines, fuzzy-located in the new upstream file (line numbers +
nearest-matching region shown, e.g. via simple longest-common-substring probe),
plus the exact JSON path to edit. Rev-day reseating becomes a 2-minute job
instead of a manual search — this is where integration onto new builds actually
gets faster.

---

## P2 — Surface for other builds/servers (only after P0+P1 land)

### C1. Repo manifest instead of hardcoded preflight
`root.json`: `{ "repos": [{ "dir": "webclient", "remote": "...", "rev_key": ... }] }`
— install/regen read it. Same rev as making lclite droppable onto another
2004Scape-lineage server's client with a two-line manifest edit. (engine already
tolerates absence; formalize the pattern.)

### C2. Published mod contract (the "RuneLite-ness", done right)
A third-party mod = folder + hunks with markers + optional files/ + optional
PLUGINS registry row. No new abstraction; the contract IS the overlay layout.
Document it in PLUGINS.md as "authoring for distribution" (namespaced LS keys,
`lclite:<mod>` marker mandatory, degrade-graceful checklist). A mods repo that
isn't ours then installs with zero lclite-source changes.

### C3. Deferred, trigger-based
- **Javaclient overlay** (`mods-java/`, same tool): if desktop players ever ask.
- **TS-AST-aware applier** (anchor = `Class.method`, splice at function
  boundary): revisit if rev-day reseating still dominates maintenance AFTER
  A2 shrinks anchors — measure, don't assume.
- **Formal runtime plugin SDK**: rejected while terser reserves make it
  circular; reopen only if upstream ships an unmangled/dev bundle contract.

---

## Order of attack (suggested session plan)
1. A2 + A3 in regen/install (pure tooling, no content churn) → prove with t/.
2. A1 marker sweep + regen re-snapshot + fallback-warning in one commit.
3. B1 + B3 (doctor + docs) — immediate agent-payoff, uses A3's checks.
4. B4, B2 as fast follow-ups; C-track when someone other than us installs it.

## KPI (measure now and after P0)
- median `find` length per payload line (today's worst: 20:1)
- hunks with deterministic owner marker (target 100%)
- rev-day: manual reseatings per Lost City rev (target → ~0 false drifts)
- time from fresh clone → playable modded client (should stay one command)
