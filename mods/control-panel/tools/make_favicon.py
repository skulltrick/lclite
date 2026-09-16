#!/usr/bin/env python3
"""mods/control-panel/tools/make_favicon.py — regenerate the LCLite tab icon.

The launcher draws the LCLite mark as an inline SVG (launcher/ui/index.html,
logo()): a crescent cut from one disc by another, gold diagonal gradient, plus a
four-point sparkle and two dots. A browser tab cannot use that function, so the
same geometry ships twice:

  files/engine/public/favicon.svg   hand-kept, byte-for-byte the launcher's mark
                                    (this script does NOT write it — it is the
                                    readable source; keep the numbers in step)
  files/engine/public/favicon.ico   16/32/48px raster, GENERATED here, for the
                                    bare /favicon.ico request and older browsers

Only Pillow is needed. Supersampled 8x, then LANCZOS, so the crescent edge is
antialiased at 16px instead of stair-stepped.

Usage:  python mods/control-panel/tools/make_favicon.py [outdir]
"""
import math
import os
import sys
import tempfile

from PIL import Image, ImageDraw

UNITS = 48          # svg viewBox
SS = 8              # supersample factor
GOLD = [(0.00, (247, 226, 172)), (0.55, (230, 187, 99)), (1.00, (184, 134, 44))]
SPARK = (255, 243, 208)
OUT = (sys.argv[1] if len(sys.argv) > 1 else None) or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'files', 'engine', 'public')


def gradient(t):
    t = min(1.0, max(0.0, t))
    for i in range(len(GOLD) - 1):
        t0, c0 = GOLD[i]
        t1, c1 = GOLD[i + 1]
        if t0 <= t <= t1:
            f = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
            return tuple(round(c0[k] + (c1[k] - c0[k]) * f) for k in range(3))
    return GOLD[-1][1]


def main():
    size = UNITS * SS
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    px = img.load()

    # crescent: inside disc(23,24,r17), outside disc(31,17,r15.5)  [svg numbers]
    for y in range(size):
        uy = (y + 0.5) / SS
        for x in range(size):
            ux = (x + 0.5) / SS
            if math.hypot(ux - 23, uy - 24) <= 17 and math.hypot(ux - 31, uy - 17) > 15.5:
                r, g, b = gradient((ux + uy) / (2 * UNITS))
                px[x, y] = (r, g, b, 255)

    # sparkles go on their OWN layer and get alpha_composited, so the dot that sits
    # on the gold crescent blends like the SVG's opacity instead of punching a hole
    # (ImageDraw REPLACES pixels; it does not blend).
    sparkles = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(sparkles)

    def s(v):  # svg units -> supersampled pixels
        return v * SS

    # four-point sparkle: M33 22.5 l1.5 3.4 3.4 1.5 -3.4 1.5 -1.5 3.4 -1.5 -3.4 -3.4 -1.5 3.4 -1.5 z
    pts = [(33, 22.5), (34.5, 25.9), (37.9, 27.4), (34.5, 28.9), (33, 32.3),
           (31.5, 28.9), (28.1, 27.4), (31.5, 25.9)]
    d.polygon([(s(a), s(b)) for a, b in pts], fill=SPARK + (int(0.92 * 255),))
    d.ellipse([s(41 - 1.5), s(15 - 1.5), s(41 + 1.5), s(15 + 1.5)], fill=SPARK + (int(0.75 * 255),))
    d.ellipse([s(37 - 1.1), s(33 - 1.1), s(37 + 1.1), s(33 + 1.1)], fill=SPARK + (int(0.60 * 255),))
    img = Image.alpha_composite(img, sparkles)

    out = os.path.abspath(os.path.join(OUT, 'favicon.ico'))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.resize((48, 48), Image.LANCZOS).save(out, format='ICO',
                                             sizes=[(16, 16), (32, 32), (48, 48)])
    print('wrote', out)

    # a 16px preview for eyeballing (NOT shipped, NOT in git: regenerated on demand)
    prev = os.path.join(tempfile.gettempdir(), 'lclite_favicon_16px_preview.png')
    img.resize((16, 16), Image.LANCZOS).resize((256, 256), Image.NEAREST).save(prev)
    print('wrote', prev, '(16px, scaled 16x for review)')


if __name__ == '__main__':
    main()
