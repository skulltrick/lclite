import importlib.util
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('wme', os.path.join(HERE, 'world_map_edit.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
ROOT = os.environ['LCLITE_ROOT'].replace('\\', '/')
ALL_SITES = list(m.SITES)
ALL_REPLACE = list(m.REPLACE_SITES)
ALL_EDITS = list(m.LINE_EDITS)

CANDIDATES = [
    "    private async gameLoop(): Promise<void> {",
    "    private addChatOptions(_mouseX: number, mouseY: number): void {",
    "    private addPrivateChatOptions(): void {",
    "    async onDemandLoop() {",
    "    private addNpcs(alwaysontop: boolean): void {",
    "    private addProjectiles(): void {",
    "    minimapLoop(): void {",
    "    private entityOverlays(): void {",
    "    private gameDrawMain(): void {",
    "    private getSpecialArea(): void {",
]


def git(*args):
    return subprocess.run(['git', '-C', REPO, *args], capture_output=True, text=True).stdout


def strip_all():
    subprocess.run([sys.executable, os.path.join(HERE, 'world_map_edit.py'), '--strip', ROOT], capture_output=True)


def run(anchor):
    strip_all()
    m.SITES = [(r, s, anchor if s == 'client-parked' else a, w, b) for r, s, a, w, b in ALL_SITES]
    m.REPLACE_SITES = ALL_REPLACE
    m.LINE_EDITS = ALL_EDITS
    m.apply_sites(ROOT)
    m.apply_replace_sites(ROOT)
    subprocess.run(['node', 'tools/regen.mjs'], cwd=REPO, env={**os.environ, 'LCLITE_ROOT': ROOT}, capture_output=True)
    collateral = [l for l in git('status', '--short', 'mods').split('\n') if l.strip() and 'world-map' not in l]
    doctor = subprocess.run(['node', 'tools/doctor.mjs'], cwd=REPO, env={**os.environ, 'LCLITE_ROOT': ROOT}, capture_output=True, text=True)
    struct = [l for l in doctor.stdout.split('\n') if '[struct]' in l]
    return collateral, struct, doctor.returncode


print('candidate -> collateral patch JSONs / doctor')
for anchor in CANDIDATES:
    collateral, struct, code = run(anchor)
    print(f'  {anchor.strip()[:52]:54s} doctor={code} collateral={len(collateral)} struct={len(struct)}')
    for c in collateral[:6]:
        print('        ', c)
    for s in struct[:3]:
        print('        ', s.strip()[:120])

strip_all()
print('stripped.')
