"""Render a dialect SVG (docs/DIALECT.md) on top of its photo so a trace can be
checked by eye. Only the dialect's elements are drawn (rect, polygon, line, text,
stair/compass groups). Usage: python tools/overlay.py plan.svg photo.jpg out.png [scale]
Depends on: Pillow."""
import re, sys
from PIL import Image, ImageDraw, ImageFont

FILL = {'floor': None, 'room': (0, 90, 255, 70), 'big': (0, 160, 90, 70), 'ours': (220, 0, 120, 70),
        'core': (120, 120, 120, 90), 'void': (0, 0, 0, 110)}

def attrs(tag):
    return dict(re.findall(r'([\w-]+)="([^"]*)"', tag))

def main():
    svg, photo, out = sys.argv[1], sys.argv[2], sys.argv[3]
    scale = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
    text = open(svg, encoding='utf-8').read()
    vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', text).group(1).split()]
    im = Image.open(photo).convert('RGBA')
    W, H = int(vb[2] * scale), int(vb[3] * scale)
    im = im.resize((W, H))
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    try:
        font = ImageFont.truetype('arial.ttf', int(20 * scale))
    except Exception:
        font = ImageFont.load_default()
    S = lambda v: (float(v) - 0) * scale
    in_stair = False
    for m in re.finditer(r'<(/?)(\w+)([^>]*)>', text):
        close, name, rest = m.group(1), m.group(2), m.group(3)
        a = attrs(rest)
        cls = a.get('class', '')
        if name == 'g':
            in_stair = (not close) and cls == 'stair'
            continue
        if name == 'polygon' and cls in FILL:
            pts = [tuple(S(v) for v in p.split(',')) for p in a['points'].split()]
            if cls == 'floor':
                d.polygon(pts, outline=(255, 0, 0, 255), width=max(2, int(6 * scale)))
            else:
                d.polygon(pts, fill=FILL[cls], outline=(0, 0, 0, 200), width=max(1, int(2 * scale)))
        elif name == 'rect' and cls in FILL:
            x, y, w, h = (S(a['x']), S(a['y']), S(a['width']), S(a['height']))
            d.rectangle([x, y, x + w, y + h], fill=FILL[cls], outline=(0, 0, 0, 200), width=max(1, int(2 * scale)))
        elif name == 'line':
            x1, y1, x2, y2 = S(a['x1']), S(a['y1']), S(a['x2']), S(a['y2'])
            if cls == 'door':
                d.line([x1, y1, x2, y2], fill=(255, 255, 0, 255), width=max(3, int(10 * scale)))
            elif in_stair:
                d.line([x1, y1, x2, y2], fill=(160, 0, 200, 255), width=max(1, int(2 * scale)))
        elif name == 'text' and not close and cls in ('lbl', 'lblS', 'name', 'exit'):
            end = text.find('</text>', m.end())
            label = text[m.end():end]
            x, y = S(a['x']), S(a['y'])
            d.text((x, y), label, fill=(200, 0, 0, 255) if cls != 'exit' else (0, 140, 0, 255), font=font, anchor='mm')
    Image.alpha_composite(im, layer).convert('RGB').save(out)
    print(out, W, H)

if __name__ == '__main__':
    main()
