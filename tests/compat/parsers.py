#!/usr/bin/env python3
"""tests/compat/parsers.py
A regex-based, DOM-free Python reader of the map site's SVG dialect,
mirroring tests/compat/parsers.js. Uses xml.etree only incidentally (not for
parsing, to keep parity with the described build_rooms.py / build_entrances.py
regex approach). Prints JSON with the same shape and ordering as parsers.js
when invoked as: python tests/compat/parsers.py <file.svg>
"""

import json
import re
import sys

LABEL_RE = re.compile(
    r'<text class="(lbl|lblS)"[^>]*\sx="(-?\d+(?:\.\d+)?)"[^>]*\sy="(-?\d+(?:\.\d+)?)"[^>]*>([^<]*)</text>'
)
SHAPE_RE = re.compile(r'<(rect|polygon) class="(room|big|ours|core)"([^>]*)/>')
DOOR_RE = re.compile(
    r'<line class="door" x1="(-?\d+(?:\.\d+)?)" y1="(-?\d+(?:\.\d+)?)" x2="(-?\d+(?:\.\d+)?)" y2="(-?\d+(?:\.\d+)?)"/>'
)
EXIT_RE = re.compile(
    r'<text class="exit"[^>]*?\sx="(-?\d+(?:\.\d+)?)"[^>]*?\sy="(-?\d+(?:\.\d+)?)"[^>]*>([^<]*)</text>'
)
STAIR_GROUP_RE = re.compile(r'<g class="stair">([\s\S]*?)</g>')
STAIR_LINE_RE = re.compile(
    r'<line x1="(-?\d+(?:\.\d+)?)" y1="(-?\d+(?:\.\d+)?)" x2="(-?\d+(?:\.\d+)?)" y2="(-?\d+(?:\.\d+)?)"/>'
)
FLOOR_RE = re.compile(r'<polygon class="floor" points="([^"]*)"/>')
NUMBER_RE = re.compile(r'(?:^|\s)([A-Z]?\d{3}[A-Z]?)$')


def decode_entities(s):
    return (
        s.replace('&lt;', '<')
        .replace('&gt;', '>')
        .replace('&quot;', '"')
        .replace('&apos;', "'")
        .replace('&amp;', '&')
    )


def parse_points(s):
    pts = []
    for pair in s.strip().split():
        x, y = pair.split(',')
        pts.append([float(x), float(y)])
    return pts


def parse_attr(attr_str, name):
    m = re.search(r'\s' + name + r'="([^"]*)"', attr_str)
    return m.group(1) if m else None


def rect_to_points(x, y, w, h):
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]


def point_in_polygon(pt, pts):
    px, py = pt
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def collect_shapes(svg_text):
    shapes = []
    for m in SHAPE_RE.finditer(svg_text):
        tag, cls, attr_str = m.group(1), m.group(2), m.group(3)
        if tag == 'rect':
            x = float(parse_attr(attr_str, 'x'))
            y = float(parse_attr(attr_str, 'y'))
            w = float(parse_attr(attr_str, 'width'))
            h = float(parse_attr(attr_str, 'height'))
            shapes.append({'cls': cls, 'points': rect_to_points(x, y, w, h)})
        else:
            points_str = parse_attr(attr_str, 'points') or ''
            shapes.append({'cls': cls, 'points': parse_points(points_str)})
    return shapes


def read_rooms(svg_text):
    shapes = collect_shapes(svg_text)
    rooms = []
    for m in LABEL_RE.finditer(svg_text):
        raw_text = m.group(4)
        text = decode_entities(raw_text.strip())
        num_match = NUMBER_RE.search(text)
        if not num_match:
            continue
        number = num_match.group(1)
        idx = text.rfind(number)
        name = text[:idx].strip()
        lx = float(m.group(2))
        ly = float(m.group(3))

        matched_shape = None
        for shape in shapes:
            if point_in_polygon([lx, ly], shape['points']):
                matched_shape = shape
                break
        if not matched_shape:
            continue

        rooms.append({
            'number': number,
            'name': name,
            'cls': matched_shape['cls'],
            'points': matched_shape['points'],
            'label': {'x': lx, 'y': ly},
        })

    rooms.sort(key=lambda r: r['number'])
    return rooms


def read_entrances(svg_text):
    doors = []
    for m in DOOR_RE.finditer(svg_text):
        x1, y1, x2, y2 = (float(m.group(i)) for i in (1, 2, 3, 4))
        doors.append({'x': (x1 + x2) / 2, 'y': (y1 + y2) / 2})

    exits = []
    for m in EXIT_RE.finditer(svg_text):
        x, y = float(m.group(1)), float(m.group(2))
        content = decode_entities(m.group(3).strip())
        exits.append({'x': x, 'y': y, 'kind': 'Door' if content == 'Door' else 'EXIT'})

    entrances = []
    for d in doors:
        best = None
        best_dist = float('inf')
        for e in exits:
            dist = ((e['x'] - d['x']) ** 2 + (e['y'] - d['y']) ** 2) ** 0.5
            if dist <= 100 and dist < best_dist:
                best_dist = dist
                best = e
        entrances.append({'x': d['x'], 'y': d['y'], 'kind': best['kind'] if best else 'EXIT'})

    entrances.sort(key=lambda e: (e['x'], e['y']))
    return entrances


def read_stairs(svg_text):
    stairs = []
    for gm in STAIR_GROUP_RE.finditer(svg_text):
        body = gm.group(1)
        xs = []
        ys = []
        for lm in STAIR_LINE_RE.finditer(body):
            x1, y1, x2, y2 = (float(lm.group(i)) for i in (1, 2, 3, 4))
            xs.extend([x1, x2])
            ys.extend([y1, y2])
        if xs:
            stairs.append({'x': (min(xs) + max(xs)) / 2, 'y': (min(ys) + max(ys)) / 2})
    stairs.sort(key=lambda s: (s['x'], s['y']))
    return stairs


def read_floor(svg_text):
    m = FLOOR_RE.search(svg_text)
    if not m:
        return None
    return parse_points(m.group(1))


def main():
    if len(sys.argv) < 2:
        print('usage: python tests/compat/parsers.py <file.svg>', file=sys.stderr)
        sys.exit(2)
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        svg_text = f.read()
    result = {
        'rooms': read_rooms(svg_text),
        'entrances': read_entrances(svg_text),
        'stairs': read_stairs(svg_text),
        'floor': read_floor(svg_text),
    }
    print(json.dumps(result))


if __name__ == '__main__':
    main()
