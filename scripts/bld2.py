"""v3: the building layer, rebuilt (data.json → bldb). Replaces bld.py.

Why: bld.py kept the 2009 LiDAR footprints (one or more rectangles per building, with heights) AND every 2015 outline whose
centroid fell outside a 2009 rectangle — so an L-shaped or set-back building appeared twice, stacked (2,832 buildings had
their centroid inside another footprint); it clipped footprints against the roadway with the raw right-of-way values (some
of them wrong by a factor of two, which cut buildings into slivers and skewed quads); and it thinned outlines with more
than 14 vertices by dropping every k-th vertex, which distorts an outline.

Now: the 2015 outlines (digitised building outlines, 154k) are the geometry — one polygon per building, nothing stacked.
Heights come from the 2009 LiDAR layer: the area-weighted mean of the 2009 pieces that overlap the outline (the tallest piece
when the overlap is small), else an estimate from the floor area (flagged). Outlines are simplified with topology preserved
(1.0 m, then 1.5 / 2.5 / 4 m only if an outline still has more than 60 vertices). The roadway clip is kept only where a
footprint crosses the curb line by a little (a digitising overlap): a footprint that would lose more than 30 % of its area
to the roadway buffer is a right-of-way error, and is left whole; a clipped remnant thinner than 3 m is dropped.
Run from the repo root (raw exports in ../2 Vancouver Open Data/):  python scripts/bld2.py   then assemble.py
"""
import json, base64, struct, time, pathlib, sys
import numpy as np
from shapely.geometry import shape, LineString, Polygon, MultiPolygon
from shapely.strtree import STRtree
from shapely.ops import unary_union
from pyproj import Transformer

t0 = time.time(); root = pathlib.Path(__file__).resolve().parent.parent; RAW = root.parent / '2 Vancouver Open Data'
dpath = root / 'data' / 'data.json'; d = json.load(open(dpath, encoding='utf-8')); O = np.array(d['origin']); B = d['bounds']
T = Transformer.from_crs('EPSG:4326', 'EPSG:26910', always_xy=True)

def poly_of(g):
    if g is None: return None
    if g.geom_type == 'MultiPolygon': g = max(g.geoms, key=lambda p: p.area)
    return g if g.geom_type == 'Polygon' else None

# ── 2015 outlines (WGS84) → UTM 10N ──
f15 = json.load(open(RAW / 'building-footprints-2015.geojson', encoding='utf-8'))['features']
def tf(coords): return [[list(T.transform(x, y)) for x, y in ring] for ring in coords]
out15 = []
for f in f15:
    g = f.get('geometry')
    if not g: continue
    if g['type'] == 'Polygon': p = Polygon(tf(g['coordinates'])[0])
    elif g['type'] == 'MultiPolygon': p = max((Polygon(tf(pc)[0]) for pc in g['coordinates']), key=lambda q: q.area)
    else: continue
    if not p.is_valid: p = p.buffer(0); p = poly_of(p)
    if p is None or p.area < 45: continue
    out15.append(p)
print('2015 outlines', len(out15), 'of', len(f15), round(time.time() - t0), 's')

# ── 2009 LiDAR pieces with heights ──
f09 = json.load(open(RAW / 'building-footprints-2009.geojson', encoding='utf-8'))['features']
g09, h09 = [], []
for f in f09:
    p = poly_of(shape(f['geometry'])) if f.get('geometry') else None
    if p is None: continue
    h = f['properties'].get('hgt_agl')
    try: h = float(h)
    except (TypeError, ValueError): h = 0.0
    g09.append(p); h09.append(h)
h09 = np.array(h09); tree09 = STRtree(g09); print('2009 pieces', len(g09), round(time.time() - t0), 's')

# ── heights: area-weighted mean of the 2009 pieces overlapping each outline ──
heights = np.zeros(len(out15)); flagged = np.ones(len(out15), bool)
for i, p in enumerate(out15):
    idx = tree09.query(p, predicate='intersects')
    if not len(idx): continue
    ws, hs = [], []
    for j in idx:
        a = p.intersection(g09[j]).area
        if a < 4 or h09[j] <= 0: continue
        ws.append(a); hs.append(h09[j])
    if not ws: continue
    ws = np.array(ws); hs = np.array(hs)
    heights[i] = (ws * hs).sum() / ws.sum() if ws.sum() > 0.25 * p.area else hs.max()
    flagged[i] = False
print('heights from LiDAR:', int((~flagged).sum()), '| estimated (new since 2009, or no LiDAR):', int(flagged.sum()), round(time.time() - t0), 's')

# ── roadway clip, conservative ──
pav = [LineString([(x + O[0], y + O[1]) for x, y in s['g']]).buffer(max((s['row'] - 7.2) / 2, 1.5), resolution=4) for s in d['segs'] if len(s['g']) > 1]
treeP = STRtree(pav); clipped = dropped = kept_whole = 0
def thin(p): r = p.minimum_rotated_rectangle; c = list(r.exterior.coords); s1 = LineString(c[0:2]).length; s2 = LineString(c[1:3]).length; return min(s1, s2) < 3
for i, p in enumerate(out15):
    idx = treeP.query(p, predicate='intersects')
    if not len(idx): continue
    road = unary_union([pav[j] for j in idx]); inter = p.intersection(road).area
    if inter < 2: continue
    if inter > 0.30 * p.area: kept_whole += 1; continue        # the right-of-way value is the suspect, not the building
    q = poly_of(p.difference(road))
    if q is None or q.area < 30 or thin(q): dropped += 1; out15[i] = None; continue
    out15[i] = q; clipped += 1
print('roadway clip: trimmed', clipped, '| dropped (sliver / inside the roadway)', dropped, '| left whole (right-of-way conflict)', kept_whole, round(time.time() - t0), 's')

# ── encode: n (u8), height|flag (u8, 0x80 = estimated), n × (x u16, y u16) in whole metres from the origin ──
def ring(p):
    for tol in (1.0, 1.5, 2.5, 4.0):
        q = p.simplify(tol, preserve_topology=True); q = poly_of(q) or p
        c = np.asarray(q.exterior.coords)[:-1]
        if len(c) <= 60: return c
    return np.asarray(p.minimum_rotated_rectangle.exterior.coords)[:-1]
recs = []; nv = []
for i, p in enumerate(out15):
    if p is None: continue
    c = ring(p); xy = np.clip(np.round(c - O), 0, 65535).astype(np.uint16)
    if len(xy) < 3: continue
    q = Polygon(xy.astype(float))                             # what will actually be drawn, after rounding to whole metres
    if not q.is_valid or q.area < 20 or thin(q): continue      # collapsed to a line or a sliver: not a building

    h = int(round(heights[i])) if not flagged[i] else (6 if p.area < 220 else (9 if p.area < 600 else 13))
    recs.append((xy, max(3, min(h, 120)), bool(flagged[i]))); nv.append(len(xy))
buf = bytearray()
for xy, h, fl in recs: buf += struct.pack('BB', len(xy), h | (0x80 if fl else 0)); buf += xy.astype('<u2').tobytes()
d['bldb'] = base64.b64encode(bytes(buf)).decode()
d['bld2'] = {'buildings': len(recs), 'lidar_heights': int((~flagged).sum()), 'estimated_heights': int(flagged.sum()), 'clipped': clipped, 'dropped': dropped, 'kept_whole': kept_whole,
             'vertices_median': float(np.median(nv)), 'vertices_max': int(max(nv)), 'source': '2015 outlines (City of Vancouver), heights from 2009 LiDAR footprints'}
print('buildings', len(recs), '| vertices median', np.median(nv), 'p90', np.percentile(nv, 90), 'max', max(nv), '| binary', len(buf) // 1024, 'KB', round(time.time() - t0), 's')
dpath.write_text(json.dumps(d, separators=(',', ':')), encoding='utf-8'); print('data.json', round(dpath.stat().st_size / 1048576, 1), 'MB')
