"""v4: ICBC reported crashes (2021-2025) matched to the tool's intersections and blocks.

Source: ICBC's public Tableau workbook "ICBC Reported Crashes" (https://public.tableau.com/workbooks/ICBCReportedCrashes.twb),
whose embedded Hyper extract ("2021-2025 public data set", data as of 31 Mar 2026) was exported for MUNICIPALITY_NAME = VANCOUVER
to ../2 Vancouver Open Data/icbc-reported-crashes-vancouver-2021-2025.csv. ICBC Open Data Licence.

ICBC geocodes a crash to the intersection, or to the MIDDLE OF THE BLOCK for a mid-block crash, and only where the report gave
enough location detail (LATITUDE / LONGITUDE blank otherwise). So: an intersection crash is matched to the nearest street node
(where block ends meet, the same 12 m grouping as END_INDEX in 02_core.js) within 40 m; a mid-block crash to the nearest block
centreline within 30 m. Counts are kept per node and per block: total crashes, cyclist-involved, cyclist-involved with injury or
fatality ("casualty"), pedestrian-involved. Only nodes / blocks with a cyclist or pedestrian crash are stored.

Pure Python (no geopandas): the WGS84 -> UTM 10N conversion is the same series as fromLatLon in 04e_layers.js.
Run from the repo root after the other data scripts, before assemble.py:   python scripts/icbc.py
"""
import csv, json, math, pathlib, collections, sys, time
root = pathlib.Path(__file__).resolve().parent.parent
SRC = root.parent / '2 Vancouver Open Data' / 'icbc-reported-crashes-vancouver-2021-2025.csv'
DJ = root / 'data' / 'data.json'
t0 = time.time()

def to_utm(lat, lon):
    a = 6378137.0; f = 1 / 298.257223563; k0 = 0.9996; e2 = f * (2 - f); ep2 = e2 / (1 - e2); lon0 = -123.0
    phi = math.radians(lat); lam = math.radians(lon - lon0)
    N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2); T = math.tan(phi) ** 2; C = ep2 * math.cos(phi) ** 2; A = math.cos(phi) * lam
    M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * phi)
             + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * math.sin(6 * phi))
    E = 500000 + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120)
    Nn = k0 * (M + N * math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720))
    return E, Nn

d = json.load(open(DJ, encoding='utf-8')); O = d['origin']; segs = d['segs']
print('data.json loaded', round(time.time() - t0, 1), 's;', len(segs), 'blocks')

# ── street nodes: block ends grouped on a 12 m grid, as END_INDEX does in the page ──
nodes = {}   # key -> [sumx, sumy, n, {names}]
for s in segs:
    for p, k in ((s['g'][0], 0), (s['g'][-1], 1)):
        key = (round(p[0] / 12), round(p[1] / 12))
        nd = nodes.setdefault(key, [0.0, 0.0, 0, set()])
        nd[0] += p[0]; nd[1] += p[1]; nd[2] += 1
        ix = (s.get('ix') or [None, None])[k]
        if ix and ix.get('x'): nd[3].add(ix['x'])
NODES = [{'key': k, 'p': [v[0] / v[2], v[1] / v[2]], 'names': v[3]} for k, v in nodes.items()]
ngrid = collections.defaultdict(list)
for i, nd in enumerate(NODES): ngrid[(int(nd['p'][0] // 50), int(nd['p'][1] // 50))].append(i)
def nearest_node(x, y, maxd):
    cx, cy = int(x // 50), int(y // 50); best = None; bd = maxd
    for i in range(-1, 2):
        for j in range(-1, 2):
            for n in ngrid.get((cx + i, cy + j), ()):
                p = NODES[n]['p']; dd = math.hypot(p[0] - x, p[1] - y)
                if dd < bd: bd = dd; best = n
    return best

# ── block centrelines on a 100 m grid for the mid-block crashes ──
sgrid = collections.defaultdict(list)
for s in segs:
    cells = set((int(p[0] // 100), int(p[1] // 100)) for p in s['g'])
    for c in cells: sgrid[c].append(s['i'])
def dseg(px, py, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dy * dy or 1.0
    t = max(0.0, min(1.0, ((px - a[0]) * dx + (py - a[1]) * dy) / L2))
    return math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy))
def nearest_block(x, y, maxd):
    cx, cy = int(x // 100), int(y // 100); best = None; bd = maxd
    for i in range(-1, 2):
        for j in range(-1, 2):
            for si in sgrid.get((cx + i, cy + j), ()):
                g = segs[si]['g']
                for k in range(1, len(g)):
                    dd = dseg(x, y, g[k - 1], g[k])
                    if dd < bd: bd = dd; best = si
    return best

# ── the crashes ──
Y = lambda v: (v or '').strip().upper() == 'Y'
ncount = collections.defaultdict(lambda: [0, 0, 0, 0])   # node index -> [total, cyclist, cyclist casualty, pedestrian]
nname = collections.defaultdict(collections.Counter)
bcount = collections.defaultdict(lambda: [0, 0, 0, 0])   # block id -> same
rows = geo = cyc = matched_ix = matched_mb = unmatched = 0; years = set()
with open(SRC, encoding='utf-8', newline='') as f:
    for r in csv.DictReader(f):
        rows += 1
        try: n = int(r['TOTAL_CRASHES'] or 1)
        except ValueError: n = 1
        lat, lon = r.get('LATITUDE'), r.get('LONGITUDE')
        if not lat or not lon: continue
        geo += 1; years.add(r.get('DATE_OF_LOSS_YEAR'))
        c = Y(r.get('CYCLIST_FLAG')); p = Y(r.get('PEDESTRIAN_FLAG')); cas = (r.get('CRASH_SEVERITY') or '').upper().startswith('CASUALTY')
        if c: cyc += n
        E, N = to_utm(float(lat), float(lon)); x, y = E - O[0], N - O[1]
        vec = [n, n if c else 0, n if (c and cas) else 0, n if p else 0]
        tgt = None
        if Y(r.get('INTERSECTION_CRASH')) or not Y(r.get('MID_BLOCK_CRASH')):
            k = nearest_node(x, y, 40)
            if k is not None:
                tgt = ncount[k]; matched_ix += 1
                if r.get('ROAD_LOCATION_DESCRIPTION'): nname[k][r['ROAD_LOCATION_DESCRIPTION']] += n
        if tgt is None:
            si = nearest_block(x, y, 30)
            if si is not None: tgt = bcount[si]; matched_mb += 1
        if tgt is None: unmatched += 1; continue
        for q in range(4): tgt[q] += vec[q]
print('rows', rows, 'geocoded', geo, 'cyclist crashes', cyc, '| matched to intersections', matched_ix, 'to blocks', matched_mb, 'unmatched', unmatched, round(time.time() - t0, 1), 's')

# ── store: nodes / blocks with a cyclist or pedestrian crash ──
out_nodes = []
for k, v in ncount.items():
    if v[1] == 0 and v[3] == 0: continue
    nd = NODES[k]; nm = nname[k].most_common(1)[0][0] if nname[k] else (next(iter(nd['names'])) if nd['names'] else '')
    out_nodes.append([round(nd['p'][0]), round(nd['p'][1]), v[0], v[1], v[2], v[3], nm[:60]])
out_blocks = {str(si): v for si, v in bcount.items() if v[1] or v[3]}
yrs = sorted(y for y in years if y)
d['crash'] = {'src': 'ICBC Reported Crashes, Tableau Public workbook (public.tableau.com/app/profile/icbc), data as of 31 Mar 2026; ICBC Open Data Licence',
              'years': (yrs[0] + '-' + yrs[-1]) if yrs else '', 'fields': 'nodes: [x, y, all crashes, cyclist, cyclist injury or fatality, pedestrian, location]; blocks: {id: [same four counts]} for mid-block crashes',
              'n': {'rows': rows, 'geocoded': geo, 'cyclist': cyc, 'ix': matched_ix, 'mid': matched_mb, 'unmatched': unmatched},
              'nodes': out_nodes, 'blocks': out_blocks}
print('nodes with a cyclist or pedestrian crash', len(out_nodes), '| blocks with a mid-block one', len(out_blocks))
top = sorted(out_nodes, key=lambda v: -v[3])[:6]; print('worst for cyclists:', [(v[6], v[3]) for v in top])
js = json.dumps(d, separators=(',', ':')); open(DJ, 'w', encoding='utf-8').write(js); print('JSON', len(js) // 1024 // 1024, 'MB', round(time.time() - t0, 1), 's')
