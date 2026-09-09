---
name: "Hunk drift / rev breakage"
about: install.mjs printed "anchor not found" after a Lost City update
title: "[drift] mods/<name> on <new rev>"
labels: bug, upstream-drift
---

**Lost City rev**
Output of `git -C webclient rev-parse HEAD --short` / same for `engine`.

**Failing hunks**
Paste the `✗ [mod] file: anchor not found` lines from
`node install.mjs apply --check`.

**Re-seated?**
If you fixed the anchors locally, attach the patch-JSON diff or open a PR —
see README "Upgrading to a newer Lost City rev".
