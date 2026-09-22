#!/usr/bin/env python3
"""Measure where the lclite:tile-markers parked block can go without churning another mod.

THE PROBLEM (docs/MODS.md §3b, "a big parked block moves the DIFF"): `git diff -U0` aligns
the whole file, so inserting a large block can re-split ANOTHER mod's islands into fragments
with no marker line — regen then files those fragments differently, `git status --short
mods/` names a patch JSON nobody touched, and doctor can exit 3. Sites are NOT guessable:
this tool inserts the block at every candidate method boundary, runs a REAL regen for each,
and reports the collateral. The chosen site (edit.py's PARK_ANCHOR) is therefore a
measurement, not a guess.

    python mods/tile-markers/tools/tile_markers_site_search.py            # sweep every candidate
    python mods/tile-markers/tools/tile_markers_site_search.py --one '<anchor line>'

What the sweep found on 2026-09-22 (289 corpus, 142 hunks): the obvious home — the end of
the class — churns ground-items AND true-tile; the boundaries beside true-tile's own parked
block (checkMinimap) and camera's (addPlayers) report MIXED MARKERS; the overlay-projection
run before `getOverlayPosEntity()` is clean, and that is where the block lives.
"""

import os
import re
import subprocess
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(TOOLS)))
INSTALL = os.environ.get("LCLITE_ROOT") or os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.expanduser("~/.local/share")), "LCLite", "installs", "289"
)
CLIENT = os.path.join(INSTALL, "webclient", "src", "client", "Client.ts")
EDIT = os.path.join(TOOLS, "tile_markers_edit.py")

# our own intentional changes — never counted as collateral
EXPECTED = ("mods/tile-markers", "tools/regen.mjs", "docs/hooks.json", "docs/HOOKS.md")

METHOD = re.compile(r"^    (?:private|protected|public|override|static)[\w ]*\b\w+\(")


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=REPO, shell=True, capture_output=True, text=True, **kw)


def restore():
    run("git checkout -- mods docs/hooks.json docs/HOOKS.md")


def collateral():
    out = run("git status --short").stdout
    bad = []
    for line in out.splitlines():
        path = line[3:].strip().strip('"')
        if any(path.startswith(e) for e in EXPECTED):
            continue
        bad.append(path)
    return bad


def clean_gaps():
    """Regions of Client.ts with NO other mod's edit, from the tree's own diff."""
    diff = run("git -C %s diff -U0 -- src/client/Client.ts" % os.path.join(INSTALL, "webclient")).stdout
    spans = sorted((int(m.group(1)), int(m.group(1)) + int(m.group(2) or 1) - 1)
                   for m in re.finditer(r"^@@ -\S+ \+(\d+)(?:,(\d+))? @@", diff, re.M))
    merged = []
    for s, e in spans:
        if merged and s <= merged[-1][1] + 1:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    gaps = []
    prev = 1
    for s, e in merged:
        gaps.append((prev, s - 1))
        prev = e + 1
    gaps.append((prev, 10 ** 9))
    return gaps


def candidates(min_gap=24):
    """Method declarations at least `min_gap` lines clear of every other mod's edit."""
    with open(CLIENT, "rb") as fh:
        lines = fh.read().decode("utf-8").split("\r\n")
    gaps = clean_gaps()
    out = []
    for i, line in enumerate(lines):
        if not METHOD.match(line) or i == 0 or lines[i - 1].strip() != "":
            continue
        if not any(lo + min_gap <= i + 1 <= hi - min_gap for lo, hi in gaps):
            continue
        out.append(line)
    return out


def probe(anchor):
    restore()
    env = {**os.environ, "LCLITE_ROOT": INSTALL, "PARK_ANCHOR": anchor}
    r = run("python %s" % EDIT, env=env)
    if r.returncode != 0:
        return ["EDIT FAILED: " + (r.stdout + r.stderr).strip().splitlines()[-1:][0]]
    r = run("node tools/regen.mjs", env={**os.environ, "LCLITE_ROOT": INSTALL})
    if r.returncode != 0:
        tail = (r.stdout + r.stderr).strip().splitlines()
        return ["REGEN EXIT %d: %s" % (r.returncode, tail[-1] if tail else "")]
    warn = [w.strip() for w in r.stdout.splitlines() if re.search(r"MIXED|AMBIGUOUS|no marker", w)]
    return collateral() + ["WARN " + w for w in warn]


def main():
    if "--one" in sys.argv:
        anchor = sys.argv[sys.argv.index("--one") + 1]
        print("%s\n  -> %s" % (anchor, probe(anchor) or "CLEAN"))
        restore()
        return

    cands = candidates()
    print("%d candidate method boundaries (>=24 lines clear of every other mod's edit)\n" % len(cands))

    clean = []
    for n, anchor in enumerate(cands, 1):
        bad = probe(anchor)
        if not bad:
            clean.append(anchor)
        print("%3d/%-3d %-64s %s" % (n, len(cands), anchor.strip()[:64], "CLEAN" if not bad else bad))
        restore()

    print("\n%d/%d sites are clean:" % (len(clean), len(cands)))
    for anchor in clean:
        print("   " + anchor.strip())
    restore()


if __name__ == "__main__":
    main()
