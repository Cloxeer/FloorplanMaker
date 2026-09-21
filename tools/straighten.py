"""Straighten a posted-map photo: map the 4 given corners (TL, TR, BR, BL) of the
poster to an axis-aligned rectangle and write a JPEG. Same math as the app's
photo step (js/view/panels/photoStep.js), for reproducing fixtures offline.
Usage: python tools/straighten.py in.jpg out.jpg x1,y1 x2,y2 x3,y3 x4,y4
Depends on: Pillow, numpy."""
import sys, math
import numpy as np
from PIL import Image

def coeffs(src, dst):
    # PIL wants coefficients mapping OUTPUT (dst) -> INPUT (src)
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return np.linalg.solve(np.array(A, float), np.array(B, float))

def main():
    inp, out = sys.argv[1], sys.argv[2]
    q = [tuple(map(float, s.split(','))) for s in sys.argv[3:7]]
    d = lambda a, b: math.hypot(a[0]-b[0], a[1]-b[1])
    w = round((d(q[0], q[1]) + d(q[3], q[2])) / 2)
    h = round((d(q[0], q[3]) + d(q[1], q[2])) / 2)
    im = Image.open(inp).convert('RGB')
    dst = [(0, 0), (w, 0), (w, h), (0, h)]
    res = im.transform((w, h), Image.PERSPECTIVE, coeffs(q, dst), Image.BICUBIC)
    res.save(out, quality=88)
    print(out, w, h)

if __name__ == '__main__':
    main()
