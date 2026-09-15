## What changed
<!-- one logical change per commit; say WHY -->

## Mod / area
`mods/<name>` / installer / panel / docs

## Acceptance test
- [ ] `node tools/lclite.mjs apply --no-build` on pristine clones at base revs: clean apply
- [ ] patched tree byte-identical to my working tree (or this PR *is* the reseat)
- [ ] `node tools/lclite.mjs apply --mods <touched-mods>` converges (strips the rest, no ✗)
- [ ] ran `node tools/regen.mjs` after any in-hunk hand-edit; hunks in shared files stay ≥61 pristine lines apart

## Notes for review
<!-- anchor reseats, HUNK_OWNER routing, new MOD_META entries, panel keys -->
