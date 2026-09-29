"""Context outside the city boundary for the map: the regional coastline and the Fraser's arms.

Sources (OpenStreetMap via Overpass, cached under data/raw/):
  natural=coastline over the whole region (Howe Sound → Burrard Inlet → Point Grey → Sturgeon Bank → the delta). The ways are
  merged into continuous chains; every chain longer than 3 km is closed off far to the east and becomes a land polygon
  (`landOut`). OSM draws coastline with land on the left, so Burrard Inlet, English Bay, the North Arm mouth and the Middle
  Arm come out as water simply because the chain runs around them. Islands in the sea are closed rings and become land too.
  natural=water relations for the North and South Arms of the Fraser: outer rings → `water`, inner rings (Mitchell Island …)
  → `islands`; they are painted over the land polygons so the river arms read at their surveyed extent.
Run after merge.py, before assemble.py:  pip install shapely pyproj ; python scripts/coast.py
"""
import json, pathlib, urllib.request, urllib.parse
from pyproj import Transformer
from shapely.geometry import LineString, Polygon, MultiLineString
from shapely.ops import unary_union, polygonize, linemerge

root = pathlib.Path(__file__).resolve().parent.parent
dpath = root / 'data' / 'data.json'; d = json.load(open(dpath, encoding='utf-8')); O = d['origin']; B = d['bounds']
T = Transformer.from_crs('EPSG:4326', 'EPSG:26910', always_xy=True)
def loc(lon, lat):
    x, y = T.transform(lon, lat); return (x - O[0], y - O[1])
MIRRORS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter']
def overpass(query, cache_name):
    cache = root / 'data' / 'raw' / cache_name
    if cache.exists(): return json.load(open(cache, encoding='utf-8'))
    for url in MIRRORS:
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': query}).encode(), headers={'User-Agent': 'vancouver-bikeway-designer/1.0'})
            res = json.load(urllib.request.urlopen(req, timeout=240)); print(cache_name, 'from', url, len(res['elements']), 'elements')
            cache.parent.mkdir(parents=True, exist_ok=True); cache.write_text(json.dumps(res), encoding='utf-8'); return res
        except Exception as e: print('failed', url, e)
    raise SystemExit('no Overpass mirror reachable')

# ---- 1. regional coastline → land polygons ----
osm = overpass('[out:json][timeout:180][bbox:49.02,-123.45,49.45,-122.70];way["natural"="coastline"];out geom;', 'osm_coastline_region.json')
ways = [LineString([loc(p['lon'], p['lat']) for p in el['geometry']]) for el in osm['elements'] if el.get('type') == 'way' and len(el.get('geometry', [])) > 1]
merged = linemerge(unary_union(ways)); chains = list(merged.geoms) if isinstance(merged, MultiLineString) else [merged]
EAST = 80000
land, coast = [], []
for c in sorted(chains, key=lambda q: -q.length):
    if c.length < 3000: continue
    cs = list(c.simplify(6).coords); coast.append(cs)
    if c.is_ring or (abs(cs[0][0] - cs[-1][0]) < 20 and abs(cs[0][1] - cs[-1][1]) < 20):
        p = Polygon(cs).buffer(0)                                   # an island
    else:
        p = Polygon(cs + [(EAST, cs[-1][1]), (EAST, cs[0][1])]).buffer(0)   # mainland: close far to the east
    if p.area > 1e5: land.append(p)
print('coastline chains', len(chains), '→ land polygons', len(land), 'longest chain km', round(max(q.length for q in chains) / 1000, 1))

# ---- 2. the Fraser's arms → water polygons and their islands ----
osmw = overpass('[out:json][timeout:180][bbox:49.05,-123.35,49.30,-122.70];rel["natural"="water"]["water"="river"];out geom;', 'osm_fraser_rivers.json')
outers, inners = [], []
for el in osmw['elements']:
    if el.get('type') != 'relation': continue
    for m in el.get('members', []):
        if m.get('type') != 'way' or len(m.get('geometry', [])) < 2: continue
        (inners if m.get('role') == 'inner' else outers).append(LineString([loc(p['lon'], p['lat']) for p in m['geometry']]))
water = [p.simplify(3) for p in polygonize(unary_union(outers)) if p.area > 2e4]
islands = [p.simplify(3) for p in polygonize(unary_union(inners)) if p.area > 2e4]
print('river water polygons', len(water), 'islands', len(islands), 'km2', round(sum(p.area for p in water) / 1e6, 1))

def rings(p):
    ps = list(p.geoms) if p.geom_type == 'MultiPolygon' else [p]
    return [[[round(x), round(y)] for x, y in q.exterior.coords] for q in ps]
d['landOut'] = [r for p in land for r in rings(p)]
d['coast'] = [[[round(x), round(y)] for x, y in cs] for cs in coast]
d['water'] = [r for p in water for r in rings(p)]
d['islands'] = [r for p in islands for r in rings(p)]
d['context'] = {'source': 'OpenStreetMap contributors, ODbL, via Overpass', 'land_polygons': len(d['landOut']), 'water_polygons': len(d['water'])}
dpath.write_text(json.dumps(d, separators=(',', ':')), encoding='utf-8'); print('data.json', round(dpath.stat().st_size / 1048576, 1), 'MB')
