---
name: "Hunk drift / rev breakage"
about: LCLite printed "anchor not found" after a Lost City update
title: "[drift] mods/<name> on <new rev>"
labels: bug, upstream-drift
---

**Lost City rev**
Which revision (e.g. 289), and how you got it: the launcher's install, or a checkout
of your own. Output of `git -C <install>/webclient rev-parse HEAD --short` (and the
same for `engine`) if you have it.

**Failing hunks**
Paste the `✗ [mod] file: anchor not found` lines from
`LCLITE_ROOT=<install> node tools/lclite.mjs apply --check`
(add `LCLITE_ROOT` only when this repo isn't sitting inside your checkout).

**Re-seated?**
If you fixed the anchors locally, attach the patch-JSON diff or open a PR —
see README "Upgrading to a newer Lost City rev".
