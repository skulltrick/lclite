# Revisions — how LCLite mods work on more than one Lost City revision

LCLite is an overlay: it patches the Lost City client's TypeScript by matching anchor
text, because Lost City does not take outside patches and we are not going to fork it.
That has one consequence worth stating plainly: **an anchor is a statement about one
specific revision's source code.** Lost City edits a line inside an anchor and the hunk
stops applying, even though the mod still belongs exactly there.

So LCLite keeps **one corpus of hunks per revision**, and this document is how that
works: what the pieces are, how to add a revision, how to update one, and what the
tooling guarantees.

## The model

```
revs.json                       ← the declaration: which revisions, and where each
                                   one's hunks come from
mods/<mod>/patches/<rev>/*.json ← that revision's corpus for that mod
mods/<mod>/files/**             ← payload files (page assets, whole source files):
                                   revision-independent, copied verbatim everywhere
```

Three ideas, and everything else follows from them:

**1. One primary revision.** `revs.json.primary` is where mods are *authored*: the tree
you edit, the corpus you regenerate, the thing `docs/MODS.md` is about. Every other
revision is **ported from** it. There is exactly one place a mod is written, which is
what keeps the maintenance bill flat.

**2. A revision either inherits or has its own corpus.** Resolution, per mod, per
revision:

| # | condition | result |
|---|---|---|
| 1 | `mods/<mod>/patches/<rev>/` exists | that corpus |
| 2 | `revs.json` says `<rev>` `inherits` from `X` | X's corpus |
| 3 | neither | the mod is **not available** on that revision |

Inheritance is the cheap case and it is the common one: `274` declares
`"inherits": "289"` because every one of the 104 anchors in the primary corpus still
matches 274's source byte-for-byte. That costs nothing to maintain and automatically
follows any improvement to the primary corpus. The moment that stops being true,
`node tools/matrix.mjs` says so — **the claim is verified, not assumed.**

**3. A mod is all-or-nothing per revision.** If a mod cannot be fully re-anchored on a
revision, it does not go there *partially*. Half a mod is not a narrower mod, it is a
broken one: camera without its visibility-cache hook, control-panel without its terser
reserves (which mangle the page-facing API silently). `port.mjs` reverts an incomplete
mod, and the launcher shows it as "not on this revision".

## The tools

| command | what it does |
|---|---|
| `node tools/lclite.mjs apply --check` | dry-run the corpus for the tree's revision; `✗0` or the failing anchors |
| `node tools/doctor.mjs` | health: **every** corpus's pins/markers/hunks, plus the tree in front of it |
| `node tools/matrix.mjs` | replays every declared revision over pristine shallow clones — the gate on `inherits` |
| `node tools/port.mjs <rev>` | re-anchors the primary corpus onto a revision's tree (assisted reseat + typecheck gate) |
| `node tools/regen.mjs` | snapshots the applied tree as **that revision's** corpus — the only author of a corpus |
| `bash tools/acceptance.sh` | the primary's byte-identity gate (pristine clones reproduce the live install exactly) |

Everything resolves its revision from the tree's own git branch, so
`LCLITE_ROOT=<install> node tools/doctor.mjs` needs no extra argument. `--rev <rev>`
overrides for a detached tree (CI).

## Workflow: add a revision

```bash
# 1. install it in the launcher (Installs → pick the revision). It installs vanilla,
#    because the overlay does not declare it yet.
# 2. declare it, so regen is allowed to file a corpus under it:
#    revs.json → supported["254"] = { "note": "…" }     (no `inherits` — it needs its own)
# 3. port the corpus onto it. This finds the launcher's install by itself:
node tools/port.mjs 254
# 4. snapshot what actually landed as that revision's corpus:
LCLITE_ROOT=<install> node tools/regen.mjs
# 5. prove it:
LCLITE_ROOT=<install> node tools/lclite.mjs apply --check   # ✗0
node tools/matrix.mjs                                        # every declared rev green
# 6. build and boot it — a corpus that applies is not yet a mod that works:
LCLITE_ROOT=<install> node tools/lclite.mjs build
```

`port.mjs` reports every hunk it re-anchored, every hunk it could not place (with the
anchor text and where that text went), and every mod it had to drop because the ported
code **did not typecheck** on that revision. Those three lists are the actual work of
supporting a revision, and none of them is guesswork.

### What "portable" really means

Two different things can go wrong, and they need different answers:

* **The anchor moved.** Upstream rewrote code inside the block. `port.mjs` reseats it:
  it re-finds the block in the new source, rebuilds *both* sides so
  `replace = find + the mod's own lines` still holds, and refuses unless the rebuilt
  anchor is unique and the payload survives. Usually automatic.
* **The code the mod hooks is gone, or the symbols it calls are gone.** `p1Enc` on
  `Packet` and `Client.loopCycle` both exist at 289 and neither exists at 254. No
  anchor can see that — which is why the port runs a typecheck gate and drops a mod
  whose ported code does not compile. Fixing one of these is real work on that
  revision: write the equivalent against that revision's API, hand-edit the tree, and
  `regen` a revision-specific hunk for it.

## Workflow: update a revision

**Upstream moved inside an anchor on the primary.** Normal rev-day: `apply --check`
prints the failing anchors with `↳` hints, reseat them in the primary corpus, `regen`,
`doctor` 0, `matrix` green.

**Upstream moved inside an anchor on a ported revision** (matrix says
`INHERITANCE EXPIRED` or `STALE CORPUS`):

```bash
node tools/port.mjs <rev>                 # re-anchor, drop what will not compile
LCLITE_ROOT=<install> node tools/regen.mjs
node tools/matrix.mjs                     # green again
```

**Improve a mod.** Edit it on the primary, `regen` the primary corpus, then:

* if the revision **inherits** — nothing to do, it follows automatically. `matrix`
  re-verifies that the new hunks still anchor there.
* if the revision **has its own corpus** — run `port.mjs <rev>` + `regen` for it. That
  is the one recurring cost of a revision with its own corpus, and the reason
  inheritance is the default: it is the only configuration that costs nothing to keep
  current.

**A revision needs one hunk fixed by hand.** Edit the live tree of that revision (keep
the `// lclite:<mod>` marker on every added block), then `regen` with `LCLITE_ROOT` on
it. Per-mod, the revision's own corpus then wins over what it would have inherited —
so the rest of that mod's hunks keep following the primary.

## Invariants (what the tools enforce)

* **The declaration and the corpus agree.** A declared revision with no corpus and
  nothing inherited, a corpus for an undeclared revision, an `inherits` naming a
  revision that does not exist, or a pre-revision-layout patch file: `doctor` exits 3.
* **One pin per corpus per repo.** Every patch JSON in a corpus records
  `generated_from.{repo,head}`, and they must agree — a corpus half-regenerated from a
  different tree is structural, not a warning.
* **Markers are 100%.** Every hunk's added lines carry `// lclite:<mod>`; without it,
  routing falls back to regexes, which is how a hunk ends up in the wrong mod's corpus.
* **`regen` refuses an undeclared revision.** A corpus for a revision nothing declares
  is a corpus nothing reads, so the declaration comes first.
* **`docs/hooks.json` + `docs/HOOKS.md` describe the primary only.** They document where
  mods are *authored*; letting a ported revision's regen overwrite them would quietly
  turn the reference doc into a description of a port.
* **No half-mods, ever.** `port.mjs` reverts an incomplete mod; the launcher lists it as
  unavailable rather than offering a toggle that does nothing.

## Status today

| revision | how it gets its hunks | mods | notes |
|---|---|---|---|
| **289** | primary — the corpus in `mods/*/patches/289/` | 16 | the reference: everything is authored here |
| **274** | inherits 289 | 16 | every anchor matches 274 byte-for-byte, so it costs zero extra maintenance |
| **254** | own corpus in `mods/*/patches/254/` | 6 | upstream rewrote code inside 41 of the 104 anchors the corpus had at the last port; 5 mods need revision-specific work |

`254`'s five unavailable mods, and why — the honest list:

| mod | why it is not on 254 yet |
|---|---|
| `control-panel` | its terser-reserve hunk anchors on 289's reserve list, and 254 has no `engine/src/web.ts` at all (the page's `revision` local is not there to patch) |
| `camera` | 254 has no `World.visBacking` / `visBackingDirty` — the visibility cache the zoom-out hook maintains was added upstream after 254. The legacy-telemetry suppression lives in this mod too (folded in 2026-09-20), so 254 does not have that either |
| `xp-drops` | 254 has no `Client.statBaseLevel` / `statXP` / `readbit` — the level-tracking hooks the drop math reads |
| `stat-orbs` | the minimap/`areaMap` draw path the orbs attach to was restructured |
| `hotkeys` | 254 has no `import Skill from '#/client/Skill.js'` in `Client.ts`, the block the keybind hooks sit beside |

None of those is an anchor that needs nudging: the code each mod hooks does not exist at
254. Supporting them means writing the equivalent against 254's own structures — a
revision-specific job, and the port report says so rather than pretending.

### Worked example: the mods that ported after a hand-fix

`anti-cheat` is gone now — its telemetry suppression was folded into `camera` on
2026-09-20 and its 254 corpus was deleted with it — but it is kept in this example
because the two-error shape is what makes the lesson: it and `tcg` re-anchored
perfectly on 254 and still did not compile there:

```
tcg        src/client/Client.ts(8977,88): error TS2339: Property 'loopCycle' does not exist on type 'typeof Client'.
anti-cheat src/client/Client.ts(2461,26): error TS2339: Property 'p1Enc' does not exist on type 'Packet'.
```

289 made `Client.loopCycle` static and renamed `Packet.p1Isaac` to `Packet.p1Enc`; 254 has
neither. Both are one-line, revision-specific differences in the mod's own code, so the
fix belongs in **254's corpus**:

```bash
node tools/port.mjs 254 --mods tcg --partial   # apply it for inspection
#   Client.loopCycle -> this.loopCycle      (254 keeps loopCycle per instance)
#   anti-cheat's fix was the same shape: this.out.p1Enc( -> this.out.pIsaac(
#   (254's name for the ISAAC-masked opcode) — its corpus went with the mod
cd <install>/webclient && ./node_modules/.bin/tsc --noEmit -p tsconfig.json   # clean
LCLITE_ROOT=<install> node tools/regen.mjs                # snapshot 254's own hunks
```

That is the whole loop, and the result is a corpus that is 289-correct for eleven mods and
254-correct for these two — which is exactly what "a corpus per revision" buys.

## See also

* `docs/MODS.md` — how to author a mod (types, contract, hook sites, registries).
* `FOR_AGENTS_README.md` — the hard rules (markers, regen-before-apply, CRLF, rule 6).
* `docs/HOOKS.md` — the generated per-hunk map for the primary revision.
