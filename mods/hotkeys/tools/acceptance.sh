#!/usr/bin/env bash
# lclite acceptance test (the strong form): fresh clones at the pinned revs +
# apply must reproduce the live install byte-for-byte, hotkeys mod included.
set -u
unset LCLITE_ROOT            # the harness must resolve the root as "one level above the overlay"
REPO="C:/Users/canno/Projects/Hermes-Projects/lclite"
INSTALL="C:/Users/canno/AppData/Local/LCLite/installs/289"
T="$LOCALAPPDATA/Temp/lclite-accept"
WC_PIN="a52b321a9f42530f3dd2f1a02cd335c955791a12"
EN_PIN="0c7cf6555d0cf92d2348999b2fd27c6ceff5ffbf"

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
echo "webclient $(git -C webclient rev-parse --short HEAD)  engine $(git -C engine rev-parse --short HEAD)"

echo "== copying the overlay in as a sibling =="
mkdir -p "$T/lclite"
tar -C "$REPO" --exclude=.git --exclude=t --exclude=node_modules -cf - . | tar -C "$T/lclite" -xf -
[ -d "$T/lclite/mods/hotkeys" ] || { echo "!! hotkeys mod missing from the copy"; exit 1; }

echo "== apply --no-build against the pristine tree =="
cd "$T/lclite" || exit 1
node tools/lclite.mjs apply --no-build 2>&1 | tail -16
# prove it landed in the HARNESS tree, not in the live install
[ -f "$T/webclient/src/client/Hotkeys.ts" ] || { echo "!! Hotkeys.ts not copied into the harness tree"; exit 1; }
grep -q "lclite:hotkeys" "$T/webclient/src/client/Client.ts" || { echo "!! Client.ts hunk missing in the harness tree"; exit 1; }
grep -q "lclite:hotkeys" "$T/webclient/src/client/GameShell.ts" || { echo "!! GameShell.ts hunk missing in the harness tree"; exit 1; }
echo "harness tree carries the hotkeys hunks + payload ✔"

echo "== byte-comparing every patched file against the live install =="
python - "$T" "$INSTALL" "$REPO" <<'PY'
import json, glob, os, sys, filecmp
t, install, repo = sys.argv[1], sys.argv[2], sys.argv[3]
files = set()
for f in glob.glob(os.path.join(repo, 'mods/*/patches/*.json')):
    d = json.load(open(f))
    if d.get('file'):
        files.add(d['file'])
# files/ payloads are copied verbatim too (panel.js, gpu/, tcg/, hotkeys' core)
for mod in glob.glob(os.path.join(repo, 'mods/*/files')):
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
print('compared %d files (patched sources + files/ payloads + the manifest)' % checked)
if bad:
    print('MISMATCHES:')
    for rel, why in bad:
        print('  %-60s %s' % (rel, why))
    sys.exit(1)
print('✔ every patched file, payload and installed.json is byte-identical to the live install')
PY
echo "acceptance exit=$?"
