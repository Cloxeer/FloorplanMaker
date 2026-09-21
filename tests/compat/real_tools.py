"""Run the REAL BetterNMSUMaps parsers on one plan and print JSON.
Usage: python tests/compat/real_tools.py plan.svg floor
Looks for the repo in $BETTERNMSUMAPS (default D:/BetterNMSUMapTest); exits 3 if absent.
Depends on: that repo's tools/build_rooms.py, build_entrances.py, indoor_routes.py."""
import json, os, sys
from pathlib import Path

repo = Path(os.environ.get('BETTERNMSUMAPS', 'D:/BetterNMSUMapTest'))
if not (repo / 'tools' / 'build_rooms.py').exists():
    print('repo not found at', repo, file=sys.stderr)
    sys.exit(3)
sys.path.insert(0, str(repo / 'tools'))
from build_rooms import rooms_on_plan  # noqa: E402
from build_entrances import doors_on_plan  # noqa: E402

svg, floor = sys.argv[1], int(sys.argv[2])
view_box, rooms = rooms_on_plan(svg, floor)
_, doors = doors_on_plan(svg)
rooms.sort(key=lambda r: r['number'])
print(json.dumps({'viewBox': view_box, 'rooms': rooms, 'doors': doors}))
