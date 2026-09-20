#!/usr/bin/env bash
# lclite acceptance test (the strong form): fresh clones at the PINNED revs +
# apply must reproduce the live install byte-for-byte (every mod's hunks, every
# files/ payload, installed.json) — and then a CONVERGE round-trip (strip down
# to one mod, re-apply everything) must land back on those same bytes.
#
# The pins are READ FROM THE CORPUS (`mods/*/patches/<primary>/*.json` ->
# generated_from), never hardcoded here: a hardcoded pin silently tests last month's
# revisions after a re-pin, which looks exactly like a pass. Only the PRIMARY revision
# has pins of its own — every other revision is either the same bytes (it inherits) or
# has its own corpus, and `node tools/matrix.mjs` is what proves those against pristine
# clones. This script is the primary's byte-identity gate.
#
# Overrides (all optional): LCLITE_ACCEPT_REPO, LCLITE_ACCEPT_INSTALL,
# LCLITE_ACCEPT_TMP, LCLITE_ACCEPT_MOD (the one mod kept in the converge pass).
set -u
unset LCLITE_ROOT            # the harness must resolve the root as "one level above the overlay"

winpath() { (cd "$1" && pwd -W 2>/dev/null) || (cd "$1" && pwd); }

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="${LCLITE_ACCEPT_REPO:-$(winpath "$HERE/..")}"
DATA="${LOCALAPPDATA:-$HOME/.local/share}"
[ -d "$DATA/LCLite/installs/289" ] || DATA="$HOME/.local/share/lclite"
INSTALL="${LCLITE_ACCEPT_INSTALL:-$(winpath "$DATA/LCLite/installs/289")}"
TMPROOT="${LOCALAPPDATA:+$LOCALAPPDATA/Temp}"; TMPROOT="${TMPROOT:-${TMPDIR:-/tmp}}"
T="${LCLITE_ACCEPT_TMP:-$TMPROOT/lclite-accept}"
KEEP="${LCLITE_ACCEPT_MOD:-gpu}"

# the revision whose corpus this gate is about (revs.json's primary)
PRIMARY="$(node -e '
    const fs = require("fs"), path = require("path");
    try { console.log(JSON.parse(fs.readFileSync(path.join(process.argv[1], "revs.json"), "utf8")).primary); }
    catch { console.log("289"); }
' "$REPO")"
PRIMARY="${LCLITE_ACCEPT_REV:-$PRIMARY}"
echo "primary revision $PRIMARY"

# pins straight out of the corpus
pin() {
    node -e '
        const fs = require("fs"), path = require("path");
        const want = process.argv[1], root = path.join(process.argv[2], "mods");
        const rev = process.argv[3];
        for (const m of fs.readdirSync(root)) {
            // `.`/`_` prefixed folders are not mods (mods/_template is the layout
            // example): including them here would let a template pin stand in for
            // the corpus pin, which is a silent way to test the wrong commits.
            if (m.startsWith(".") || m.startsWith("_")) continue;
            const d = path.join(root, m, "patches", rev);
            if (!fs.existsSync(d)) continue;
            for (const f of fs.readdirSync(d)) {
                if (!f.endsWith(".json")) continue;
                const j = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
                if (j.generated_from && j.generated_from.repo === want) { console.log(j.generated_from.head); process.exit(0); }
            }
        }
        console.error("!! no patch JSON pins repo " + want);
        process.exit(1);
    ' "$1" "$REPO" "$PRIMARY"
}
WC_PIN="$(pin webclient)" || exit 1
EN_PIN="$(pin engine)" || exit 1

echo "repo    $REPO"
echo "install $INSTALL"
echo "pins    webclient ${WC_PIN:0:7}  engine ${EN_PIN:0:7}  (read from the corpus)"

rm -rf "$T/lclite"
mkdir -p "$T"
cd "$T" || exit 1

if [ ! -d "$T/webclient/.git" ]; then
    echo "== cloning the pinned revs =="
    git clone --quiet https://github.com/LostCityRS/Client-TS webclient || exit 1
    git clone --quiet https://github.com/LostCityRS/Engine-TS engine || exit 1
fi
echo "== checking out the pins =="
git -C webclient checkout --quiet --force "$WC_PIN" || exit 1
git -C engine checkout --quiet --force "$EN_PIN" || exit 1
git -C webclient clean -fdq
git -C engine clean -fdq
echo "webclient $(git -C webclient rev-parse --short HEAD)  engine $(git -C engine rev-parse --short HEAD)"

echo "== copying the overlay in as a sibling =="
mkdir -p "$T/lclite"
tar -C "$REPO" --exclude=.git --exclude=t --exclude=node_modules -cf - . | tar -C "$T/lclite" -xf -
[ -f "$T/lclite/tools/lclite.mjs" ] || { echo "!! the overlay copy has no tools/"; exit 1; }

echo "== apply --no-build against the pristine tree (corpus $PRIMARY) =="
cd "$T/lclite" || exit 1
node tools/lclite.mjs apply --no-build --rev "$PRIMARY" 2>&1 | tail -16
# prove it landed in the HARNESS tree, not in the live install
for f in webclient/src/client/Client.ts webclient/src/client/GameShell.ts webclient/src/gpu/GpuRenderer.ts engine/view/client.ejs; do
    [ -f "$T/$f" ] || { echo "!! $f missing from the harness tree"; exit 1; }
done
grep -q "lclite:gpu" "$T/webclient/src/client/Client.ts" || { echo "!! Client.ts hunk missing in the harness tree"; exit 1; }
grep -q "lclite:hotkeys" "$T/webclient/src/client/GameShell.ts" || { echo "!! GameShell.ts hunk missing in the harness tree"; exit 1; }
echo "harness tree carries the hunks + payloads ✔"

# every patched source + files/ payload + the manifest, byte-compared against
# the live install. Re-run after the converge pass; the second run must print
# the identical count and the identical clean result.
compare() {
    python - "$T" "$INSTALL" "$REPO" "$1" "$PRIMARY" <<'PY'
import json, glob, os, sys, filecmp
t, install, repo, label, primary = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
files = set()
for f in glob.glob(os.path.join(repo, 'mods/*/patches/%s/*.json' % primary)):
    if os.path.basename(os.path.dirname(os.path.dirname(f))).startswith(('_', '.')):
        continue                      # not a mod (mods/_template is the layout example)
    d = json.load(open(f))
    if d.get('file'):
        files.add(d['file'])
# files/ payloads are copied verbatim too (panel.js, gpu/, tcg/, hotkeys' core)
for mod in glob.glob(os.path.join(repo, 'mods/*/files')):
    if os.path.basename(os.path.dirname(mod)).startswith(('_', '.')):
        continue                      # not a mod
    for root, _dirs, names in os.walk(mod):
        for n in names:
            rel = os.path.relpath(os.path.join(root, n), mod).replace('\\', '/')
            files.add(rel)
files.add('engine/public/lclite/installed.json')
bad, checked = [], 0
for rel in sorted(files):
    a, b = os.path.join(t, rel), os.path.join(install, rel)
    if not os.path.exists(a) or not os.path.exists(b):
        bad.append((rel, 'missing in %s' % ('t/' if not os.path.exists(a) else 'install')))
        continue
    checked += 1
    if not filecmp.cmp(a, b, shallow=False):
        bad.append((rel, 'DIFFERS'))
print('[%s] compared %d files (patched sources + files/ payloads + the manifest)' % (label, checked))
if bad:
    print('MISMATCHES:')
    for rel, why in bad:
        print('  %-60s %s' % (rel, why))
    sys.exit(1)
print('[%s] ✔ every patched file, payload and installed.json is byte-identical to the live install' % label)
PY
}

echo "== byte-comparing every patched file against the live install =="
compare "apply" || { echo "acceptance FAILED"; exit 1; }

echo "== converge round-trip: keep only [$KEEP], then re-apply everything =="
node tools/lclite.mjs apply --no-build --rev "$PRIMARY" --mods "$KEEP" 2>&1 | tail -6
grep -q "lclite:$KEEP" "$T/webclient/src/client/Client.ts" || { echo "!! the kept mod's hunk is gone after the strip"; exit 1; }
node tools/lclite.mjs apply --no-build --rev "$PRIMARY" 2>&1 | tail -16
echo "== re-comparing after the round-trip (must match the first pass exactly) =="
compare "converge" || { echo "acceptance FAILED: the round-trip is not byte-stable"; exit 1; }

echo "acceptance ✔ (apply == live install, and converge round-trip byte-stable)"
