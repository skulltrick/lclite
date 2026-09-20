# Hunk system — architecture assessment

Date: 2026-09-15. Companion: `docs/archive/actions-2026-09.md` — the fix list; ALL tracks shipped 2026-09-15, this file is now the living architecture reference.
Audience: both the maintainer and AI agents working on lclite. Read this before
touching tools/lclite.mjs / tools/regen.mjs / any patch JSON.

## What the system is

lclite is a **declarative overlay**: `tree = f(upstream@rev, overlay)`.
Hunks are `{find:[lines], replace:[lines]}` applied by exact-match, unique-anchor
find/replace. tools/regen.mjs extracts them from `git diff -U0` islands, shrinking
context to the minimum unique window;
tools/lclite.mjs converges the tree toward a desired mod set (apply/strip, idempotent);
CI (`drift-check.yml`) dry-runs `apply --check` against pinned base revs.

Corpus (post-P0): **81 island hunks / 857 added lines / 395 anchor lines / 8 mods**, all
marker-routed — verified byte-identical from pristine clones. (Pre-P0: 44 fat-context
hunks; the completed fix plan that closed the gaps below lives in
`archive/actions-2026-09.md`.)

## What is correct (keep, do not regress)

- **The purity invariant.** Pristine rev + overlay → byte-identical working
  tree, tested in `t/`. This is the load-bearing property; everything else is
  detail.
- **Rev pinning per artifact** (`generated_from.head` in every patch JSON, CI
  asserts all JSONs agree per repo).
- **Convergent apply/strip** — deselection is real removal; desired-state, not
  imperative patching.
- **Loud failure mode** — `apply --check` exits 2 naming the drifted anchor;
  weekly cron canary means drift is discovered by CI, not by the user on rev day.
- **Per-frame self-owned key reads** (each mod reads its own localStorage key at
  its own hook) — no settings hub; a mod whose hunks fail can't kill others' toggles.
- **Manifest-driven panel** — a new mod folder appears in the panel with zero
  panel edits (installed.json → synthesized rows).
- **files/ copies for whole-new code** (gpu, panel assets): never conflict,
  remove-if-untouched on strip.

## Structural problems (root causes, ranked)

### 1. Anchors encode identity as geography  ← the big one
`find` arrays carry incidental context, not semantic anchors. Worst case:
the anti-cheat Client.ts hunk (that mod was folded into `camera` on 2026-09-20, so
this is a kept measurement) = **6 payload lines in a 130-line find array** (20:1).
camera World.ts hunks carry ~100-line context each. Every context line is a
**false dependency**: upstream can rewrite all of it without touching the hook
site, and the hunk still "drifts."

Root cause: regen starts at `git diff -U30`'s fat window and only ever *widens*
for uniqueness — it never *minimizes*. Contrast RuneLite: Mixin anchors are
identity (`Class.method`, injection position) + `@ObfuscatedName` mappings —
never text windows. We're a homegrown mixin framework anchored by coordinates.

### 2. HUNK_OWNER is a classifier where a declaration should live
Token-regex argmax over added lines is probabilistically right. Known failures
already documented: a 3v2 coin-flip hunk (CYCLELOGIC7+clearPick → camera) and a
comment-mention collision ("true-tile" in a comment scoring for the wrong mod).
Misroutes are **silent** — a hunk just changes folders between regen runs.

### 3. Working tree is hunk source of truth → two-phase commit, no transaction
The rule "regen BEFORE install after any in-region edit" is discipline holding a
hole shut. History proves the hole: TS2300 double-apply incident (twice), now
guarded by the stale-JSON 50%-sample probe — a probabilistic heuristic sitting
on top of a deterministic system. Heuristic + inference + geography = a third
kind of fuzzy, on data that should be exact.

### 4. The 61-line rule is tabu, not structure
"Keep mods' edits ≥61 pristine lines apart so -U30 hunks don't merge" works, but
it's tribal knowledge encoded in comments; violation produces merged hunks routed
by the coin-flip of #2. Nothing machine-checks it today.

### 5. gpu mod is the quiet indictment — and the answer
Where the codebase offered stable seams (prototype methods), runtime
monkey-patching beat hunks on every axis: no anchors, no regen, no 61-rule,
immune to interior rewrites. It also exposes why hunks stay load-bearing:
**terser property mangling makes a runtime plugin ABI impossible** — anything
page-side must be terser-reserved, and the reserve list itself lives in a hunk.
So "become RuneLite via JS injection" is circular at the root layer. The
consequence to draw: for NEW mods, prefer files/ code + a minimal hunk that only
adds an import/call at a stable seam; keep hunks out of method *interiors* when
a seam exists.

## Verdict on "is it correct?"

The **control plane is correct** (purity, pinning, convergence, canary CI,
graceful degradation). The **data plane is geographically anchored and
inference-routed** — right answer wrong encoding. Fixing #1–#4 does not change
what the system *is*; it changes what can silently break. See the (completed) archive/actions-2026-09.md.

## Javaclient: needed? No.
Checked 2026-09-15: `javaclient/` = 74 files of readable **deobfuscated**
Java (`jagex2.client.Client`, Gradle, source published as LostCityRS/Client-Java).
RuneLite needs Mixin because Jagex ships an obfuscated **jar**; with readable
source, injection machinery has no reason to exist — you patch source, i.e. the
same hunk model. The webclient can't get runtime plugins either way (#5).
"RuneLite for 2004Scape" is therefore **not** a javaclient question — it is
formalizing the overlay into a stable mod contract (identity anchors + hooks
registry + manifest) that third parties, other revs, and other 2004-flavored
servers can target. Javaclient remains an OPTIONAL second overlay target
(same tools/lclite.mjs, a `mods-java/` tree) for desktop players — zero urgency,
zero structural dependency. Do not block any action here on it.

## Custom 2004 server/client hookup: what actually enables it
Already true: overlay is host-root-relative (`LCLITE_ROOT`), zero deps, panel
discovers mods from installed.json. What turns "our fork's tooling" into
"anyone's tool":
- hooks registry doc per repo (agent + human entry point),
- mod scaffold command,
- stability score / machine-readable check output,
- identity-minimal anchors so ANY fork with similar code reseats cheaply.
Formal JS-side plugin SDK: NOT worth it while the terser-reserve hunk is the
seal on the contract.
