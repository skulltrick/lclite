import importlib.util
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('wme', os.path.join(HERE, 'world_map_edit.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

ROOT = os.environ['LCLITE_ROOT'].replace('\\', '/')
WC = os.path.join(ROOT, 'webclient')
ALL_SITES = list(m.SITES)
PARKED_BODY = [s for s in ALL_SITES if s[1] == 'client-parked'][0][4]


def measure():
    out = subprocess.run(['git', '-C', WC, 'diff', '-U0', '--no-color', '--', 'src/client/Client.ts'], capture_output=True, text=True).stdout
    islands = []
    cur = None
    for line in out.split('\n'):
        if line.startswith('@@'):
            cur = []
            islands.append(cur)
        elif cur is not None and line.startswith('+') and not line.startswith('+++'):
            cur.append(line[1:])
    markerless = [isl for isl in islands if not any('lclite:' in a for a in isl)]
    return len(islands), len(markerless)


def strip_all():
    subprocess.run([sys.executable, os.path.join(HERE, 'world_map_edit.py'), '--strip', ROOT], capture_output=True)


# every method boundary in the pristine file
head = subprocess.run(['git', '-C', WC, 'show', 'HEAD:src/client/Client.ts'], capture_output=True, text=True).stdout.split('\n')
cands = [l for l in head if re.match(r'^    (private |protected |public )?(async )?[a-zA-Z_][a-zA-Z0-9_]*\(', l) and not l.rstrip().endswith(';')]
cands = list(dict.fromkeys(cands))
print(f'{len(cands)} candidate anchors; baseline:', end=' ')
strip_all()
print(measure())

results = []
for anchor in cands:
    strip_all()
    m.SITES = [('webclient/src/client/Client.ts', 'client-parked', anchor, 'before', PARKED_BODY)]
    m.REPLACE_SITES = []
    m.LINE_EDITS = []
    try:
        m.apply_sites(ROOT)
    except SystemExit:
        continue
    n, bad = measure()
    results.append((bad, n, anchor))

results.sort()
print('best sites (markerless, islands, anchor):')
for bad, n, anchor in results[:14]:
    print(f'   markerless={bad:2d} islands={n:3d}  {anchor.strip()[:70]}')
strip_all()
print('stripped.')
