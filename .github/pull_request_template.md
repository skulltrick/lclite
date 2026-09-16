## What changed
<!-- one logical change per commit; say WHY -->

## Mod / area
`mods/<name>` / installer / panel / docs

## Acceptance test
- [ ] `LCLITE_ROOT=<install> node tools/lclite.mjs apply --check` → ✗0 on every mod
- [ ] `LCLITE_ROOT=<install> node tools/doctor.mjs` → exit 0
- [ ] `apply --no-build` on pristine clones at the base revs reproduces my tree
      byte-for-byte (or this PR *is* the reseat — see CONTRIBUTING §acceptance)
- [ ] `node tools/lclite.mjs apply --mods <touched-mods>` converges (strips the rest, no ✗)
- [ ] ran `node tools/regen.mjs` after any in-hunk hand-edit; edit sites stay
      ≥3 untouched lines apart (the ≥61-line isolation rule is retired)

## Notes for review
<!-- anchor reseats, HUNK_OWNER routing, new MOD_META entries, panel keys -->
