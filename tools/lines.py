"""Detect wall lines in a straightened map photo so a trace can use measured
coordinates. Prints vertical lines as V x y1-y2 and horizontal lines as
H y x1-x2 (plan pixels), longest first, optionally limited to a crop box.
Usage: python tools/lines.py photo.jpg [minLen=60] [x0 y0 x1 y1]
Depends on: Pillow, numpy."""
import sys
import numpy as np
from PIL import Image

def runs(mask, min_len, gap=3):
    """Yield (start, end) runs of True along a 1-D bool array, bridging gaps."""
    idx = np.flatnonzero(mask)
    if idx.size == 0:
        return []
    out, s, p = [], idx[0], idx[0]
    for i in idx[1:]:
        if i - p > gap:
            if p - s + 1 >= min_len:
                out.append((int(s), int(p)))
            s = i
        p = i
    if p - s + 1 >= min_len:
        out.append((int(s), int(p)))
    return out

def merge(lines, tol=3):
    """Merge lines whose position is within tol and whose spans overlap."""
    lines.sort()
    merged = []
    for pos, a, b in lines:
        for m in merged:
            if abs(m[0] - pos) <= tol and not (b < m[1] - tol or a > m[2] + tol):
                m[1], m[2] = min(m[1], a), max(m[2], b)
                m[3].append(pos)
                break
        else:
            merged.append([pos, a, b, [pos]])
    return [(int(round(np.median(m[3]))), m[1], m[2]) for m in merged]

def main():
    im = np.asarray(Image.open(sys.argv[1]).convert('L'), dtype=np.float32)
    min_len = int(sys.argv[2]) if len(sys.argv) > 2 else 60
    x0, y0, x1, y1 = (int(v) for v in sys.argv[3:7]) if len(sys.argv) > 6 else (0, 0, im.shape[1], im.shape[0])
    sub = im[y0:y1, x0:x1]
    # local threshold: darker than the 15x15 neighbourhood mean by 35 levels
    from PIL import ImageFilter
    blur = np.asarray(Image.fromarray(sub.astype(np.uint8)).filter(ImageFilter.BoxBlur(7)), dtype=np.float32)
    dark = (sub < blur - 35) & (sub < 150)
    v = [(x + x0, a + y0, b + y0) for x in range(dark.shape[1]) for a, b in runs(dark[:, x], min_len)]
    h = [(y + y0, a + x0, b + x0) for y in range(dark.shape[0]) for a, b in runs(dark[y, :], min_len)]
    for name, ls in (('V', merge(v)), ('H', merge(h))):
        ls.sort(key=lambda t: -(t[2] - t[1]))
        for pos, a, b in ls:
            print(f"{name} {pos} {a}-{b}")

if __name__ == '__main__':
    main()
