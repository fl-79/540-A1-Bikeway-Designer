"""v2: attach the bikeways layer's attributes to each block's existing facility (data.json → segs[].bw).

build.py keeps only type / direction / AAA per block. The design cases in v2 (new · upgrade · make permanent · review ·
off-street) need the subtype, years and flags, so each block with a facility is matched back to its bikeways feature:
same bikeway_type, preferably the same street, nearest within 12 m of the block line (shapely; the layer is in UTM 10N).

Adds to bw:  sub (subtype code) · yr (year built) · up (upgrade year) · aaaSeg · snow · route · note (short)
Run after merge.py, before assemble.py:   python scripts/bwattrs.py
"""
import json, pathlib, collections
from shapely.geometry import LineString, MultiLineString, shape

root = pathlib.Path(__file__).resolve().parent.parent
dpath = root / 'data' / 'data.json'; d = json.load(open(dpath, encoding='utf-8')); O = d['origin']; segs = d['segs']
g = json.load(open(root.parent / '2 Vancouver Open Data' / 'bikeways.geojson', encoding='utf-8'))

feats = []
for f in g['features']:
    geom = f.get('geometry'); p = f['properties']
    if not geom or p.get('status') != 'Active': continue
    cs = geom['coordinates']; lines = [cs] if geom['type'] == 'LineString' else cs if geom['type'] == 'MultiLineString' else []
    if not lines: continue
    shp = MultiLineString([[(x - O[0], y - O[1]) for x, y in l] for l in lines])
    feats.append((shp, p, (p.get('street_name') or '').upper().split(' ')[0]))
# coarse grid for candidates
CELL = 200; grid = collections.defaultdict(list)
for i, (shp, p, first) in enumerate(feats):
    b = shp.bounds
    for cx in range(int(b[0] // CELL), int(b[2] // CELL) + 1):
        for cy in range(int(b[1] // CELL), int(b[3] // CELL) + 1): grid[(cx, cy)].append(i)

def clean(v):
    return None if v in (None, '', 'None', 'nan') else v
n = 0; subs = collections.Counter()
for s in segs:
    bw = s.get('bw')
    if not bw: continue
    line = LineString(s['g']); b = line.bounds; cand = set()
    for cx in range(int(b[0] // CELL) - 1, int(b[2] // CELL) + 2):
        for cy in range(int(b[1] // CELL) - 1, int(b[3] // CELL) + 2): cand.update(grid.get((cx, cy), []))
    first = s['s'].split(' ')[0]; best = None
    for i in cand:
        shp, p, f0 = feats[i]
        if p.get('bikeway_type') != bw['t']: continue
        dist = shp.distance(line)
        if dist > 12: continue
        score = dist - (100 if f0 == first else 0)
        if best is None or score < best[0]: best = (score, p)
    if best is None: continue
    p = best[1]
    bw['sub'] = clean(p.get('subtype')); bw['yr'] = clean(p.get('year_of_construction')); bw['up'] = clean(p.get('upgrade_year'))
    bw['aaaSeg'] = str(p.get('aaa_segment')) == 'YES'; bw['snow'] = str(p.get('snow_removal')) == 'Yes'
    bw['route'] = clean(p.get('bike_route_name')); note = clean(p.get('notes')) or clean(p.get('construction_note'))
    if note: bw['note'] = str(note)[:90]
    n += 1; subs[bw['sub']] += 1
print('facilities enriched', n, 'of', sum(1 for s in segs if s.get('bw')), '| subtypes', dict(subs))

# v2: the bikeway features drawn on the map carry their attributes too, so every facility (including the off-street ones
# that coincide with no street block: seawall, greenways) can be clicked for information. Same geometry as build.py.
bwg = []
for shp, p, first in feats:
    for l in shp.geoms:
        c = list(l.simplify(1.5).coords)
        rec = {'t': str(p.get('bikeway_type')), 'd': str(p.get('bikeway_direction')), 'a': str(p.get('aaa_network')) == 'YES',
               'g': [[round(x), round(y)] for x, y in c], 'n': clean(p.get('street_name')), 'r': clean(p.get('bike_route_name')),
               'sub': clean(p.get('subtype')), 'yr': clean(p.get('year_of_construction')), 'up': clean(p.get('upgrade_year')),
               'seg': str(p.get('aaa_segment')) == 'YES', 'snow': str(p.get('snow_removal')) == 'Yes', 'st': clean(p.get('street_segment_type')),
               'surf': clean(p.get('surface_type')), 'spd': clean(p.get('speed_limit')), 'wn': clean(p.get('w_n_bound_type')), 'es': clean(p.get('e_s_bound_type')),
               'len': round(l.length)}
        note = clean(p.get('notes')) or clean(p.get('construction_note'))
        if note: rec['note'] = str(note)[:120]
        bwg.append({k: v for k, v in rec.items() if v not in (None, False, 'None')})
d['bw'] = bwg; print('bikeway features', len(bwg))
d['bwattrs'] = {'enriched': n, 'subtypes': dict(subs), 'features': len(bwg)}
dpath.write_text(json.dumps(d, separators=(',', ':')), encoding='utf-8'); print('data.json', round(dpath.stat().st_size / 1048576, 1), 'MB')
