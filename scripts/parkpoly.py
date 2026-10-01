"""v3: park boundaries (data.json → parkpoly) from the City's parks-polygon-representation dataset.

The map used to shade parks from the *parks* point dataset (a circle per park sized by its hectares), which put green discs
over streets and blocks. This script downloads the polygon representation of every park from Vancouver Open Data (cached in
data/raw/parks-polygon.geojson), converts each ring to the tool's local metres (UTM 10N minus data.json's origin), simplifies
it to 1.5 m and stores the rings so the map can shade the real park outline. Run, then scripts/assemble.py:
    python scripts/parkpoly.py
"""
import json, pathlib, urllib.request
from pyproj import Transformer
from shapely.geometry import shape

root = pathlib.Path(__file__).resolve().parent.parent
raw = root / 'data' / 'raw' / 'parks-polygon.geojson'
URL = 'https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/parks-polygon-representation/exports/geojson?limit=-1'
if not raw.exists():
    print('downloading', URL); raw.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(URL, timeout=120) as r: raw.write_bytes(r.read())
gj = json.load(open(raw, encoding='utf-8'))
dpath = root / 'data' / 'data.json'; d = json.load(open(dpath, encoding='utf-8')); O = d['origin']
T = Transformer.from_crs('EPSG:4326', 'EPSG:26910', always_xy=True)
def loc(lon, lat): x, y = T.transform(lon, lat); return [round(x - O[0]), round(y - O[1])]
out = []; n_ring = 0
for f in gj['features']:
    g = f.get('geometry');
    if not g: continue
    geom = shape(g)
    polys = list(geom.geoms) if geom.geom_type == 'MultiPolygon' else [geom]
    name = (f.get('properties') or {}).get('park_name') or (f.get('properties') or {}).get('name') or ''
    for pg in polys:
        pg = pg.simplify(0.000015, preserve_topology=True)   # ~1.5 m in degrees at this latitude
        rings = [list(pg.exterior.coords)] + [list(r.coords) for r in pg.interiors]
        rr = [[loc(x, y) for x, y in ring] for ring in rings]
        rr = [r for r in rr if len(r) >= 4]
        if not rr: continue
        out.append({'n': name, 'r': rr}); n_ring += len(rr)
d['parkpoly'] = out
dpath.write_text(json.dumps(d, separators=(',', ':')), encoding='utf-8')
print('parks', len(gj['features']), 'polygons', len(out), 'rings', n_ring, '| data.json', round(dpath.stat().st_size / 1048576, 1), 'MB')
