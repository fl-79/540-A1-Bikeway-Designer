"""v3: the bike-score grid (data.json → score).

Bike Score (Walk Score, developed with UBC Cycling in Cities; Winters, Teschke, Brauer, Fuller 2016) rates a place 0–100 from
four equally weighted parts: bike lanes, hills, destinations + road connectivity, and bike-commute mode share. The tool
reproduces the first three on a 100 m grid over the city; mode share (census) does not respond to a design, so it is left out
and the other three are weighted equally (each one third). What each part means here:

  lane   nearby bikeway length, weighted by type — off-street path and protected lane 3, painted lane 1.5, local-street
         bikeway 1, sharrows 0 (Bike Score: paths 2× lanes, 3× shared; sharrows excluded) — with a linear distance decay to
         zero at 1,000 m. Scaled by the square root of the value relative to the mean of the top 2 % of cells (Bike Score:
         "an average of the highest scores"; the square root gives diminishing returns, so a first lane near a place counts
         more than a tenth). The raw value is stored so a proposal's new lanes can be added on the fly in the tool.
  hill   the steepest grade within 200 m, from the City's 1 m contours (20 m grid, smoothed over 100 m): 2 % → 100,
         10 % → 0, linear between.
  dest   the Walk Score amenity score: the Walk Score category weights (grocery 3; restaurants 10 slots
         .75 .45 .25 .25 .225 .225 .225 .225 .2 .2; shopping 5 slots .5 .45 .4 .35 .3; coffee 1.25 .75; banks, parks,
         schools, books, entertainment 1 each; 15 in total), nearest amenities first, with full credit to 400 m and none
         beyond 1,600 m (Walk Score's own thresholds; Bike Score's modification is unpublished, and bicycle-scale distances
         saturate a city this dense), less the Walk Score connectivity penalty (up to 5 % for fewer than 60 intersections/km²
         within 800 m, up to 5 % for blocks over 150 m).
Cells with no street within 150 m (water, port, parks' interiors, outside the city) carry no score.
Run after osmpoi.py, before assemble.py:  python scripts/score.py
"""
import json, pathlib, base64, math, time
import numpy as np
from scipy.spatial import cKDTree
from scipy.ndimage import maximum_filter

t0 = time.time(); root = pathlib.Path(__file__).resolve().parent.parent
dpath = root / 'data' / 'data.json'; d = json.load(open(dpath, encoding='utf-8')); B = d['bounds']
CELL = 100; x0, y0 = B[0] - 50, B[1] - 50; nx = int(math.ceil((B[2] - x0) / CELL)) + 1; ny = int(math.ceil((B[3] - y0) / CELL)) + 1
cx = x0 + (np.arange(nx) + 0.5) * CELL; cy = y0 + (np.arange(ny) + 0.5) * CELL
CX, CY = np.meshgrid(cx, cy); C = np.c_[CX.ravel(), CY.ravel()]; N = len(C)
print('grid', nx, 'x', ny, '=', N, 'cells')

# ── mask: a street within 150 m ──
def sample(g, step):
    out = []; g = np.asarray(g, float)
    for i in range(1, len(g)):
        a, b = g[i - 1], g[i]; L = math.hypot(*(b - a));
        n = max(1, int(L / step)); t = (np.arange(n) + 0.5) / n; out.append(a + (b - a) * t[:, None])
    return np.vstack(out) if out else np.zeros((0, 2))
segpts = np.vstack([sample(s['g'], 25) for s in d['segs']]); segtree = cKDTree(segpts)
dist, _ = segtree.query(C, k=1); mask = dist < 150
print('cells with a street within 150 m:', int(mask.sum()), round(time.time() - t0), 's')

# ── hill: steepest grade within 200 m ──
t = d['terr']; z = np.frombuffer(base64.b64decode(t['z']), dtype='<i2').reshape(t['ny'], t['nx']).astype(float) / 10
nodata = z == 0                                                           # no contour within 140 m: water, outside the city
zf = z.copy(); zf[nodata] = np.nan
# the 20 m grid is interpolated from contour vertices, so it carries 0.5–1 m noise: smooth over 3 × 3 cells (60 m) before
# taking the grade (central differences over 40 m), and ignore cells beside the no-data edge (a false cliff at the shore)
from scipy.ndimage import uniform_filter
num = uniform_filter(np.nan_to_num(zf), 5, mode='nearest'); den = uniform_filter((~nodata).astype(float), 5, mode='nearest')   # 5 × 5 = 100 m: the grade a cyclist feels, not a 20 m bump
zs = np.where(den > 0.99, num / np.maximum(den, 1e-9), np.nan)
dzy, dzx = np.gradient(zs, t['c']); slope = np.nan_to_num(np.hypot(dzx, dzy))   # rise/run; NaN (edges, water) → 0
r = int(200 / t['c']); yy, xx = np.mgrid[-r:r + 1, -r:r + 1]; disc = (xx * xx + yy * yy) <= r * r
smax = maximum_filter(slope, footprint=disc, mode='nearest')
ix = np.clip(((C[:, 0] - t['x0']) / t['c']).round().astype(int), 0, t['nx'] - 1); iy = np.clip(((C[:, 1] - t['y0']) / t['c']).round().astype(int), 0, t['ny'] - 1)
g = smax[iy, ix] * 100
hill = np.clip((10 - g) / 8, 0, 1) * 100
print('hill: median steepest grade within 200 m', round(float(np.median(g[mask])), 1), '%', round(time.time() - t0), 's')

# ── destinations (Walk Score categories at bike scale) + connectivity ──
WS = {'g': [3], 'r': [.75, .45, .25, .25, .225, .225, .225, .225, .2, .2], 's': [.5, .45, .4, .35, .3], 'c': [1.25, .75], 'b': [1], 'p': [1], 'e': [1], 'k': [1], 'n': [1]}
D0, D1 = 400, 1600                                # Walk Score's own thresholds (full credit to 400 m, none beyond 1.6 km): Bike Score's modification is unpublished, and bike-scale distances saturate a city this dense
def decay(dd): return np.where(dd <= D0, 1, np.where(dd >= D1, 0, (np.clip(D1 - dd, 0, None) / (D1 - D0)) ** 1.5))
dest = np.zeros(N)
by = {}
for p in d['poi']: by.setdefault(p['c'], []).append(p['p'])
for c, w in WS.items():
    pts = np.array(by.get(c, []), float)
    if not len(pts): continue
    k = min(len(w), len(pts)); dd, _ = cKDTree(pts).query(C, k=k); dd = dd.reshape(N, k)
    dest += (decay(dd) * np.array(w[:k])).sum(1)
dest = dest / 15 * 100
# connectivity: nodes where ≥ 3 block ends meet (12 m cells), intersections per km² within 800 m; average block length within 800 m
ends = {}
for s in d['segs']:
    for p in (s['g'][0], s['g'][-1]): ends.setdefault((round(p[0] / 12), round(p[1] / 12)), []).append(p)
nodes = np.array([np.mean(v, 0) for v in ends.values() if len(v) >= 3]); ntree = cKDTree(nodes)
cnt = np.array([len(x) for x in ntree.query_ball_point(C, 800)]); dens = cnt / (math.pi * 0.8 ** 2)
mids = np.array([np.mean(s['g'], 0) for s in d['segs']]); lens = np.array([s['len'] for s in d['segs']], float); mtree = cKDTree(mids)
avg = np.array([lens[ix].mean() if len(ix) else 200 for ix in mtree.query_ball_point(C, 800)])
pen = 0.05 * np.clip(1 - dens / 60, 0, 1) + 0.05 * np.clip((avg - 150) / 150, 0, 1)   # Vancouver's grid: ~60 intersections/km², 100–170 m blocks
dest = dest * (1 - pen)
print('destinations: median', round(float(np.median(dest[mask])), 1), '| intersections/km² median', round(float(np.median(dens[mask])), 0), round(time.time() - t0), 's')

# ── bike lanes: weighted length within 1 km, linear decay ──
def bw_weight(b):
    sub = b.get('sub') or ''; t_ = b.get('t', '')
    if b.get('st') == 'Off-street' or sub in ('OSS', 'OSB') or t_ == 'Protected Bike Lanes': return 3.0
    if t_ == 'Painted Lanes': return 1.5
    if t_ == 'Local Street': return 1.0
    return 0.0                                    # sharrows
STEP = 25; lp = []; lw = []
for b in d['bw']:
    w = bw_weight(b)
    if w <= 0: continue
    pts = sample(b['g'], STEP); lp.append(pts); lw.append(np.full(len(pts), w * STEP))
for p in d.get('paths', []):                      # OSM cycleways not already in the City layer (the tool drops City pieces an OSM path covers)
    if p.get('k') != 'cw': continue
    pts = sample(p['g'], STEP); lp.append(pts); lw.append(np.full(len(pts), 3.0 * STEP))
LP = np.vstack(lp); LW = np.concatenate(lw); ltree = cKDTree(LP)
raw = np.zeros(N)
for i, ix in enumerate(ltree.query_ball_point(C, 1000)):
    if not ix: continue
    dd = np.hypot(*(LP[ix] - C[i]).T); raw[i] = (LW[ix] * (1 - dd / 1000)).sum()
top = np.sort(raw[mask])[-max(1, int(mask.sum() * 0.02)):]; K = float(top.mean())
# square-root scaling: the first kilometre of lanes near a place matters more than the tenth (diminishing returns), and
# a linear scale against downtown's dense network left most of the city near zero
lane = np.clip(np.sqrt(raw / K), 0, 1) * 100
print('bike lanes: samples', len(LP), '| normaliser K =', round(K), '| median score', round(float(np.median(lane[mask])), 1), round(time.time() - t0), 's')

total = (lane + hill + dest) / 3
print('overall: median', round(float(np.median(total[mask])), 1), '| bands', {b: int(((total[mask] >= lo) & (total[mask] < hi)).sum()) for b, (lo, hi) in {'0-49': (0, 50), '50-69': (50, 70), '70-89': (70, 90), '90-100': (90, 101)}.items()})
u8 = lambda a: base64.b64encode(np.clip(np.round(a), 0, 255).astype(np.uint8).tobytes()).decode()
d['score'] = {'x0': x0, 'y0': y0, 'c': CELL, 'nx': nx, 'ny': ny, 'K': K, 'step': STEP,
              'mask': u8(mask * 1), 'hill': u8(hill), 'dest': u8(dest), 'lane': base64.b64encode(raw.astype('<f4').tobytes()).decode(),
              'nodes': len(nodes), 'weights': {'path': 3, 'protected': 3, 'painted': 1.5, 'local': 1, 'shared': 0}, 'source': 'Bike Score methodology (Walk Score / UBC Cycling in Cities), components lane · hill · destinations, equal weights'}
dpath.write_text(json.dumps(d, separators=(',', ':')), encoding='utf-8'); print('data.json', round(dpath.stat().st_size / 1048576, 1), 'MB', round(time.time() - t0), 's')
