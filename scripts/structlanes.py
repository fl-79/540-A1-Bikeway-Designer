"""v3: lane counts for structure pieces from OpenStreetMap, matched by geometry (data.json → segs[].osm.ln / .owd for bridges).

osm.py matches ways to blocks by name, which fails for the bridges: the City calls a piece "CAMBIE BRIDGE", OSM "Cambie Street
Bridge" / "Cambie Street Ramp", so those pieces kept the right-of-way width (10 m for a six-lane deck, 2.9 m for a ramp).
Here every elevated block (bridge / viaduct / overpass by name, or OSM bridge=yes) takes the lanes and one-way tag of the
nearest OSM bridge way within 15 m of its midpoint whose name shares the block's street name's first word; the tool's
width rule (lanes × 3.3 m + 0.6 m shoulders) then gives each piece its real carriageway. Run after osmpaths.py:
python scripts/structlanes.py
"""
import json, pathlib, re, math
from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

root = pathlib.Path(__file__).resolve().parent.parent
dpath = root / 'data' / 'data.json'; d = json.load(open(dpath, encoding='utf-8')); O = d['origin']
T = Transformer.from_crs('EPSG:4326', 'EPSG:26910', always_xy=True)
roads = json.load(open(root / 'data' / 'raw' / 'osm_vancouver_highways.json', encoding='utf-8'))
def loc(p): x, y = T.transform(p['lon'], p['lat']); return (x - O[0], y - O[1])
ways = []
for el in roads['elements']:
    if el.get('type') != 'way' or 'geometry' not in el: continue
    t = el.get('tags', {})
    if not (t.get('bridge') and t['bridge'] != 'no'): continue
    ln = re.search(r'\d+', t.get('lanes', '') or ''); ways.append({'g': LineString([loc(p) for p in el['geometry']]), 'n': (t.get('name') or '').upper(), 'ln': int(ln.group()) if ln else 0, 'ow': t.get('oneway') in ('yes', '1', 'true', '-1'), 'rev': t.get('oneway') == '-1', 'hw': t.get('highway', '')})
tree = STRtree([w['g'] for w in ways]); print('OSM bridge ways', len(ways))
def first(n): return re.sub(r'[^A-Z0-9 ]', '', (n or '').upper()).split(' ')[0] if n else ''
n_set = n_ln = 0; rows = []
for s in d['segs']:
    osm = s.get('osm') or {}
    up = bool(osm.get('br')) or bool(re.search(r'(VIADUCT|BRIDGE|OVERPASS)$', s['n']))
    if not up: continue
    g = s['g']; L = LineString(g); mid = L.interpolate(0.5, normalized=True)
    cand = [ways[i] for i in tree.query(mid.buffer(15))]
    f = first(s['s']); cand = [w for w in cand if w['g'].distance(mid) <= 15 and (not w['n'] or first(w['n']) == f or f in w['n'].split(' '))]
    if not cand: continue
    # OSM maps a divided deck as one way per direction (the Cambie Bridge: two one-way ways, 3 lanes each, either side of the
    # City's single centreline). Sort the candidates by which side of the block they run on: ways on both sides → a two-way
    # piece whose lanes are the sum of the nearest way on each side; one side only → a one-way piece with that way's lanes
    ga, gb = g[0], g[-1]; ux, uy = gb[0] - ga[0], gb[1] - ga[1]
    def side(w):
        p = w['g'].interpolate(w['g'].project(mid)); cr = ux * (p.y - mid.y) - uy * (p.x - mid.x); return 1 if cr > 0 else -1
    def direction(w):
        a, b = w['g'].coords[0], w['g'].coords[-1]; dot = (b[0] - a[0]) * ux + (b[1] - a[1]) * uy; return (1 if dot >= 0 else -1) * (-1 if w['rev'] else 1)
    near = sorted(cand, key=lambda w: w['g'].distance(mid))
    bySide = {}
    for w in near:
        if w['g'].distance(mid) < 2.5: bySide.setdefault(0, w)          # on the centreline itself
        else: bySide.setdefault(side(w), w)
    lanes = 0; oneway = None
    # a way on the centreline itself is this piece's own carriageway (a divided deck's northbound or southbound line): its lanes
    # and direction; ways on both sides with no way on the line are the two carriageways of one City centreline
    if 0 in bySide and bySide[0]['ln']: lanes = bySide[0]['ln']; oneway = direction(bySide[0]) if bySide[0]['ow'] else None
    else:
        ws = [bySide[k] for k in (1, -1) if k in bySide] or list(bySide.values())
        if len(ws) >= 2 and all(w['ow'] for w in ws) and direction(ws[0]) != direction(ws[1]): lanes = sum(w['ln'] for w in ws); oneway = None; osm['div'] = 1   # two carriageways, opposite directions: a divided deck (median)
        elif ws: lanes = max(w['ln'] for w in ws); oneway = direction(ws[0]) if ws[0]['ow'] else None
    if lanes and not osm.get('ln'): osm['ln'] = lanes; n_ln += 1
    if oneway is not None and not osm.get('owd'): osm['owd'] = oneway; s['ow'] = True
    s['osm'] = osm; n_set += 1; rows.append((s['n'], s['ctc'], osm.get('ln'), osm.get('owd')))
print('elevated blocks matched', n_set, '| lanes set', n_ln)
for r in sorted(rows):
    if re.search(r'CAMBIE|GRANVILLE|BURRARD|VIADUCT', r[0]): print('  ', r)
dpath.write_text(json.dumps(d, separators=(',', ':')), encoding='utf-8'); print('data.json', round(dpath.stat().st_size / 1048576, 1), 'MB')
