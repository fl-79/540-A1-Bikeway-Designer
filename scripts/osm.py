"""OpenStreetMap enrichment: lanes, one-way direction and posted speed per block.

CoV Open Data publishes no lane counts and flags one-way streets without a direction; OSM has `lanes` on ~7,400 of
Vancouver's ~17,900 street ways and `oneway` with the way's drawing direction. `width` exists on only ~46 ways, so
carriageway widths still come from the right-of-way layer. Run after enrich.py (needs data.json), before assemble.py:

    pip install pyproj
    python scripts/osm.py

The Overpass response is cached in data/raw/osm_vancouver_highways.json (~25 MB, not in the repo).
"""
import json, urllib.request, urllib.parse, re, math, pathlib, time, datetime
from pyproj import Transformer

root = pathlib.Path(__file__).resolve().parent.parent
dpath = root / 'data' / 'data.json'
d = json.load(open(dpath, encoding='utf-8')); O = d['origin']; segs = d['segs']

# bounding box of the City of Vancouver (south, west, north, east); a bbox query is far cheaper for Overpass than an area query
Q = ('[out:json][timeout:240][bbox:49.195,-123.28,49.32,-123.02];'
     'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"];out tags geom;')
MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter']
cache = root / 'data' / 'raw' / 'osm_vancouver_highways.json'
if cache.exists():
    osm = json.load(open(cache, encoding='utf-8')); print('OSM from cache', cache.name)
else:
    osm = None
    for url in MIRRORS:
        t0 = time.time()
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': Q}).encode(),
                                         headers={'User-Agent': 'vancouver-bikeway-designer/1.0 (ARCH 540 studio tool)'})
            osm = json.load(urllib.request.urlopen(req, timeout=300)); print('OSM fetched from', url, len(osm['elements']), 'ways in', round(time.time() - t0), 's'); break
        except Exception as e:
            print('failed', url, e)
    if osm is None: raise SystemExit('all Overpass mirrors failed; try again later')
    cache.parent.mkdir(parents=True, exist_ok=True); cache.write_text(json.dumps(osm), encoding='utf-8')

T = Transformer.from_crs('EPSG:4326', 'EPSG:26910', always_xy=True)
ABBR = {'WEST': 'W', 'EAST': 'E', 'NORTH': 'N', 'SOUTH': 'S', 'SOUTHWEST': 'SW', 'NORTHWEST': 'NW', 'SOUTHEAST': 'SE', 'NORTHEAST': 'NE',
        'AVENUE': 'AV', 'STREET': 'ST', 'DRIVE': 'DR', 'ROAD': 'RD', 'BOULEVARD': 'BLVD', 'PLACE': 'PL', 'CRESCENT': 'CRES', 'HIGHWAY': 'HWY',
        'COURT': 'CRT', 'TERRACE': 'TERR', 'DIVERSION': 'DIV', 'PARKWAY': 'PKWY', 'SQUARE': 'SQ', 'GARDENS': 'GDNS', 'CIRCLE': 'CIR'}
def norm(n): return ' '.join(ABBR.get(w, w) for w in re.sub(r'[^A-Z0-9 ]', '', (n or '').upper()).split())

# OSM way segments in a 100 m grid (local metres)
CELL = 100; grid = {}
ways = []
for el in osm['elements']:
    if el.get('type') != 'way' or 'geometry' not in el: continue
    pts = [T.transform(p['lon'], p['lat']) for p in el['geometry']]
    pts = [(x - O[0], y - O[1]) for x, y in pts]
    w = {'tags': el.get('tags', {}), 'name': norm(el.get('tags', {}).get('name')), 'pts': pts}
    wi = len(ways); ways.append(w)
    for i in range(1, len(pts)):
        (x0, y0), (x1, y1) = pts[i - 1], pts[i]
        for cx in range(int(min(x0, x1) // CELL), int(max(x0, x1) // CELL) + 1):
            for cy in range(int(min(y0, y1) // CELL), int(max(y0, y1) // CELL) + 1):
                grid.setdefault((cx, cy), []).append((wi, i))

def seg_dist(px, py, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dy * dy or 1e-9
    t = max(0.0, min(1.0, ((px - a[0]) * dx + (py - a[1]) * dy) / L2))
    return math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy))

def to_int(v):
    m = re.search(r'\d+', str(v or '')); return int(m.group()) if m else None

n_match = n_lanes = n_ow = n_spd = n_cw = 0
for s in segs:
    g = s['g']; mid = g[len(g) // 2]; fwd = (g[-1][0] - g[0][0], g[-1][1] - g[0][1])
    cx, cy = int(mid[0] // CELL), int(mid[1] // CELL)
    best = None
    for i in range(-1, 2):
        for j in range(-1, 2):
            for wi, k in grid.get((cx + i, cy + j), []):
                w = ways[wi]; a, b = w['pts'][k - 1], w['pts'][k]
                dd = seg_dist(mid[0], mid[1], a, b)
                same = w['name'] and w['name'] == norm(s['s'])
                if dd > (30 if same else 10): continue
                score = dd - (100 if same else 0)
                if best is None or score < best[0]: best = (score, wi, k)
    if best is None: continue
    w = ways[best[1]]; k = best[2]; tags = w['tags']; rec = {}
    ln = to_int(tags.get('lanes'))
    if ln: rec['ln'] = min(ln, 8); n_lanes += 1
    ow = tags.get('oneway')
    if ow in ('yes', '-1', 'true', '1'):
        a, b = w['pts'][k - 1], w['pts'][k]; dot = (b[0] - a[0]) * fwd[0] + (b[1] - a[1]) * fwd[1]
        sgn = 1 if dot >= 0 else -1
        rec['owd'] = sgn if ow != '-1' else -sgn; n_ow += 1        # +1: travel in the block's +z (north/east) direction
    sp = to_int(tags.get('maxspeed'))
    if sp: rec['spd'] = sp; n_spd += 1
    if tags.get('highway'): rec['hw'] = tags['highway']
    # v2: which side of the street the bike facility is on. OSM tags cycleway:left / :right relative to the way's drawing
    # direction; they are turned into the block's frame (L = west/north = left of the S→N / W→E direction, R = east/south).
    # Values: separate (mapped as its own way, i.e. a protected lane) · track · lane · shared_lane · share_busway · no.
    a, b = w['pts'][k - 1], w['pts'][k]; with_block = ((b[0] - a[0]) * fwd[0] + (b[1] - a[1]) * fwd[1]) >= 0
    both = tags.get('cycleway:both') or tags.get('cycleway')
    left, right = tags.get('cycleway:left') or both, tags.get('cycleway:right') or both
    if left or right:
        cw = {}
        if left: cw['L' if with_block else 'R'] = left
        if right: cw['R' if with_block else 'L'] = right
        for side_tag, side in (('left', 'L' if with_block else 'R'), ('right', 'R' if with_block else 'L')):
            if tags.get(f'cycleway:{side_tag}:oneway') == 'no': cw[side + '2'] = True     # a two-way track on that side
        rec['cw'] = cw; n_cw += 1
    if tags.get('bridge') and tags.get('bridge') != 'no': rec['br'] = 1                    # elevated structure (viaduct, bridge)
    if rec: s['osm'] = rec; n_match += 1
    else: s.pop('osm', None)

d['osm'] = {'fetched': d.get('osm', {}).get('fetched') or datetime.date.today().isoformat(), 'ways': len(ways), 'blocks': n_match, 'lanes': n_lanes, 'oneway_dir': n_ow, 'maxspeed': n_spd, 'cycleway_side': n_cw,
            'source': 'OpenStreetMap contributors, ODbL; via Overpass API'}
print('blocks matched', n_match, '| lanes', n_lanes, '| one-way direction', n_ow, '| maxspeed', n_spd, '| cycleway side', n_cw, '| one-way flagged in CoV data', sum(1 for s in segs if s.get('ow')))
fac = [s for s in segs if s.get('bw') and s['bw'].get('t') in ('Protected Bike Lanes', 'Painted Lanes')]
print('blocks with a painted/protected facility', len(fac), '| of which OSM gives a side', sum(1 for s in fac if s.get('osm', {}).get('cw')))
dpath.write_text(json.dumps(d, separators=(',', ':')), encoding='utf-8'); print('data.json', round(dpath.stat().st_size / 1048576, 1), 'MB')
