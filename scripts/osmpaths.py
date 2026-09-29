"""v2: OpenStreetMap paths, turnaround loops and plazas (data.json → paths, loops, plazas; osm.ly on street blocks).

The City's bikeways layer has a few vertices per block and no levels, so off-street routes come out angular, and it knows
nothing of the short public connectors that carry a bike on where a street stops (0 Smithe St → the Cambie Bridge deck).
OSM maps these at 2–15 m vertex spacing, with bridge / layer tags. Fetched once for the city bbox (cached in data/raw/):

  paths   highway=cycleway, and path / footway / pedestrian / track with bicycle=yes|designated|permissive; not
          access=private|no. Kept: geometry (simplified to 0.5 m), name, designated, bridge, layer, oneway.
  loops   closed residential / unclassified / living_street / service rings < 250 m around, and junction=roundabout|circular:
          the turnaround circles at the end of dead-end streets (0 Smithe's loop around the pandas sculpture).
  plazas  area highway=pedestrian (public squares) — drawn as paving, and a public place a connector may cross.
Also adds `ly` (OSM layer, bridge-tagged ways only) to each block's `osm` record from the road cache, for the bridge decks in 3D.
Run after osm.py and bwattrs.py, before assemble.py:  python scripts/osmpaths.py
"""
import json, math, pathlib, urllib.request, urllib.parse, time, re
from pyproj import Transformer
from shapely.geometry import LineString

root = pathlib.Path(__file__).resolve().parent.parent
dpath = root / 'data' / 'data.json'; d = json.load(open(dpath, encoding='utf-8')); O = d['origin']
T = Transformer.from_crs('EPSG:4326', 'EPSG:26910', always_xy=True)
BB = '49.195,-123.28,49.32,-123.02'
Q = (f'[out:json][timeout:600][bbox:{BB}];('
     'way["highway"="cycleway"];'
     'way["highway"~"^(path|footway|pedestrian|track|bridleway)$"]["bicycle"~"^(yes|designated|permissive)$"];'
     'way["highway"="pedestrian"]["area"="yes"];'
     'way["junction"~"^(roundabout|circular)$"];'
     'way["highway"~"^(residential|unclassified|living_street|service)$"](if:is_closed());'
     ');out tags geom;')
MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter', 'https://z.overpass-api.de/api/interpreter',
           'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
cache = root / 'data' / 'raw' / 'osm_paths_loops.json'
if cache.exists(): osm = json.load(open(cache, encoding='utf-8')); print('from cache', cache.name)
else:
    osm = None
    for attempt in range(2):
        for url in MIRRORS:
            t0 = time.time()
            try:
                req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': Q}).encode(), headers={'User-Agent': 'vancouver-bikeway-designer/1.0 (ARCH 540 studio tool)'})
                osm = json.load(urllib.request.urlopen(req, timeout=660)); print('fetched from', url, len(osm['elements']), 'ways in', round(time.time() - t0), 's'); break
            except Exception as e: print('failed', url, e)
        if osm: break
    if osm is None: raise SystemExit('no Overpass mirror answered; try again later')
    cache.write_text(json.dumps(osm), encoding='utf-8')

def loc(p): x, y = T.transform(p['lon'], p['lat']); return (x - O[0], y - O[1])
def simp(pts, tol): return [[round(x, 1), round(y, 1)] for x, y in LineString(pts).simplify(tol).coords] if len(pts) > 2 else [[round(x, 1), round(y, 1)] for x, y in pts]
private = lambda t: t.get('access') in ('private', 'no') or t.get('bicycle') == 'no'
paths, loops, plazas = [], [], []
for el in osm['elements']:
    if el.get('type') != 'way' or len(el.get('geometry', [])) < 2: continue
    t = el.get('tags', {}); pts = [loc(p) for p in el['geometry']]; closed = el['geometry'][0] == el['geometry'][-1] and len(pts) > 3
    hw = t.get('highway', '')
    if hw == 'pedestrian' and t.get('area') == 'yes':
        if not private(t): plazas.append(simp(pts, 0.5))
        continue
    # turnaround loops: roundabouts / circular junctions, and closed public street rings. Service rings are parking aisles,
    # driveways and loading loops (57 + 50 + 32 in the city) — they sit at the end of many streets but are not turnarounds, so
    # they are kept only when tagged as a roundabout or a turning loop
    is_loop = closed and (t.get('junction') in ('roundabout', 'circular') or hw in ('residential', 'unclassified', 'living_street')
                          or (hw == 'service' and t.get('service') == 'turning_loop'))
    if is_loop:
        L = LineString(pts).length
        if L < 250 and not private(t): loops.append({'g': simp(pts, 0.3), 'len': round(L), 'ln': int(re.search(r'\d+', t.get('lanes', '1')).group()) if re.search(r'\d+', t.get('lanes', '1')) else 1, 'n': t.get('name'), 'hw': hw + ('/' + t['junction'] if t.get('junction') else '')})
        continue
    if closed and hw == 'service': continue
    if private(t) or hw in ('residential', 'unclassified', 'living_street', 'service'): continue
    rec = {'g': simp(pts, 0.5), 'k': 'cw' if hw == 'cycleway' else 'path'}
    if t.get('name'): rec['n'] = t['name'][:60]
    if t.get('bicycle') == 'designated' or hw == 'cycleway': rec['des'] = 1
    if t.get('bridge') and t['bridge'] != 'no': rec['br'] = 1
    ly = re.search(r'-?\d+', t.get('layer', '') or '');
    if ly and int(ly.group()) != 0 and (rec.get('br') or int(ly.group()) < 0): rec['ly'] = int(ly.group())   # a level only with a structure (or below ground)
    if t.get('oneway') in ('yes', '1', 'true'): rec['ow'] = 1
    if t.get('footway') in ('sidewalk', 'crossing'): continue          # sidewalks and crossings are part of the street, not a route of their own
    paths.append(rec)
# cul-de-sac bulbs: OSM maps most of them as a single node, highway=turning_circle (a paved circle, ~18 m across) or
# highway=turning_loop (a loop round an island, ~24 m). Each becomes a ring of that diameter so the tool can draw and use it.
tcache = root / 'data' / 'raw' / 'osm_turning.json'
if tcache.exists(): tosm = json.load(open(tcache, encoding='utf-8')); print('turning circles from cache')
else:
    TQ = f'[out:json][timeout:300][bbox:{BB}];node["highway"~"^(turning_circle|turning_loop)$"];out;'
    tosm = None
    for url in MIRRORS:
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': TQ}).encode(), headers={'User-Agent': 'vancouver-bikeway-designer/1.0 (ARCH 540 studio tool)'})
            tosm = json.load(urllib.request.urlopen(req, timeout=330)); print('turning circles from', url, len(tosm['elements'])); break
        except Exception as e: print('failed', url, e)
    if tosm: tcache.write_text(json.dumps(tosm), encoding='utf-8')
n_tc = 0
if tosm:
    for el in tosm['elements']:
        if el.get('type') != 'node': continue
        x, y = loc(el); tg = el.get('tags', {}); loop_ = tg.get('highway') == 'turning_loop'; r = 12.0 if loop_ else 9.0
        ring = [[round(x + r * math.cos(a), 1), round(y + r * math.sin(a), 1)] for a in [i * math.pi / 8 for i in range(16)]]; ring.append(ring[0])
        loops.append({'g': ring, 'len': round(2 * math.pi * r), 'ln': 1, 'n': None, 'hw': 'turning_loop' if loop_ else 'turning_circle', 'bulb': True}); n_tc += 1
print('turning circles / loops added as rings:', n_tc)
d['paths'] = paths; d['loops'] = loops; d['plazas'] = plazas
print('paths', len(paths), '| of which cycleways', sum(1 for p in paths if p['k'] == 'cw'), '| bridge/layer', sum(1 for p in paths if p.get('br') or p.get('ly')),
      '| loops', len(loops), '| plazas', len(plazas))

# the OSM layer of each street block, from the road cache matched in osm.py (bridge decks stand at 6 m per layer in 3D)
roads = json.load(open(root / 'data' / 'raw' / 'osm_vancouver_highways.json', encoding='utf-8'))
ABBR = {'WEST': 'W', 'EAST': 'E', 'NORTH': 'N', 'SOUTH': 'S', 'AVENUE': 'AV', 'STREET': 'ST', 'DRIVE': 'DR', 'ROAD': 'RD', 'BOULEVARD': 'BLVD', 'PLACE': 'PL', 'CRESCENT': 'CRES', 'HIGHWAY': 'HWY'}
norm = lambda n: ' '.join(ABBR.get(w, w) for w in re.sub(r'[^A-Z0-9 ]', '', (n or '').upper()).split())
CELL = 100; grid = {}; ways = []
for el in roads['elements']:
    if el.get('type') != 'way' or 'geometry' not in el: continue
    tg = el.get('tags', {}); ly = re.search(r'-?\d+', tg.get('layer', '') or '')
    # only a way tagged bridge=* is a structure; layer>0 alone is drawing order (Adanac St over the Cassiar tunnel, the 11 m
    # layer=1 stub of Main St at Alexander St) and must not lift a street — that made at-grade junctions read as dead ends
    if not (tg.get('bridge') and tg['bridge'] != 'no'): continue
    pts = [loc(p) for p in el['geometry']]; wi = len(ways); ways.append((norm(tg.get('name')), pts, int(ly.group()) if ly else 1, tg.get('highway', '')))
    for i in range(1, len(pts)):
        (x0, y0), (x1, y1) = pts[i - 1], pts[i]
        for cx in range(int(min(x0, x1) // CELL), int(max(x0, x1) // CELL) + 1):
            for cy in range(int(min(y0, y1) // CELL), int(max(y0, y1) // CELL) + 1): grid.setdefault((cx, cy), []).append((wi, i))
def sd(px, py, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dy * dy or 1e-9; t = max(0, min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2)); return math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy))
n_ly = 0
# a block is on a deck only when the elevated OSM way is ITS OWN road (same name, or the block's street name inside the way's
# name — "GRANVILLE BRIDGE" ↔ "Granville Street Bridge"; an unnamed link/ramp way counts within 4 m). A street passing under a
# bridge, or running beside one, is not lifted by the bridge above it.
for s in d['segs']:
    g = s['g']; hits = []; bname = norm(s['s']); bfirst = bname.split(' ')[0] if bname else ''
    for qi, q in enumerate((g[0], g[len(g) // 2], g[-1])):   # a block is on a deck if its middle is, and each end is judged too (ramps)
        best = None
        for i in range(-1, 2):
            for j in range(-1, 2):
                for wi, k in grid.get((int(q[0] // CELL) + i, int(q[1] // CELL) + j), []):
                    wname = ways[wi][0]; dd = sd(q[0], q[1], ways[wi][1][k - 1], ways[wi][1][k])
                    # an unnamed elevated way (a ramp link) counts only at mid-block and only right on the line: at a block's END it is
                    # usually the structure a street passes under, which must not lift that street
                    own = (wname and (wname == bname or (bfirst and bfirst in wname.split(' ')))) or (not wname and qi == 1 and dd < 2)
                    if own and dd < 8 and (best is None or dd < best): best = dd; lv = ways[wi][2]
        hits.append(lv if best is not None else 0)
    if hits[1]:
        s.setdefault('osm', {})['ly'] = hits[1]; s['osm']['lyE'] = [hits[0], hits[2]]; n_ly += 1
    elif s.get('osm'): s['osm'].pop('ly', None); s['osm'].pop('lyE', None)
print('blocks on a bridge deck (OSM layer ≥ 1 at mid-block):', n_ly)
d['osmpaths'] = {'paths': len(paths), 'loops': len(loops), 'plazas': len(plazas), 'deck_blocks': n_ly, 'source': 'OpenStreetMap contributors, ODbL, via Overpass'}
dpath.write_text(json.dumps(d, separators=(',', ':')), encoding='utf-8'); print('data.json', round(dpath.stat().st_size / 1048576, 1), 'MB')
