"""Merge block segments that the public-streets layer splits mid-block (almost always at a laneway crossing).

A design block must run from intersection to intersection: a bike lane that stops half-way along a block, at a lane,
connects to nothing. The street layer, however, breaks ~5,900 blocks where a laneway crosses. This step chains
same-street segments that meet at a node with no crossing street and exactly two segments (degree 2), and merges their
records: geometry, length, hundred-block name, trees, meters, laneway openings, bus stops, racks, buildings, existing
bikeway, connections, end intersections, flags and OSM tags. Run after osm.py, before assemble.py:

    python scripts/merge.py

Pure JSON, no GIS dependencies. Keeps a copy of the input at data/raw/data_before_merge.json.
"""
import json, math, pathlib, re, shutil, collections

root = pathlib.Path(__file__).resolve().parent.parent
dpath = root / 'data' / 'data.json'
d = json.load(open(dpath, encoding='utf-8')); segs = d['segs']
bak = root / 'data' / 'raw' / 'data_before_merge.json'
if not bak.exists(): bak.parent.mkdir(parents=True, exist_ok=True); shutil.copy(dpath, bak)

# ---- same neighbour test as endNeighbours() in 02_core.js ----
def key(p): return (round(p[0] / 12), round(p[1] / 12))
def chord(s):
    a, b = s['g'][0], s['g'][-1]; L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
    return ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
def build_index(segs):
    idx = collections.defaultdict(list)
    for s in segs:
        for k, p in ((0, s['g'][0]), (1, s['g'][-1])): idx[key(p)].append((s, k))
    return idx
def neighbours(idx, s, k):
    p = s['g'][-1] if k else s['g'][0]; u = chord(s); cx, cy = key(p); cross, cont = [], []
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for o, ok in idx.get((cx + i, cy + j), []):
                if o is s: continue
                q = o['g'][-1] if ok else o['g'][0]
                if math.hypot(q[0] - p[0], q[1] - p[1]) > 14: continue
                v = chord(o)
                (cross if (o['s'] != s['s'] and abs(u[0] * v[0] + u[1] * v[1]) < 0.8) else cont).append((o, ok))
    return cross, cont

def find_joins(segs):
    """A's far end (k=1) joins B's near end (k=0) when: no crossing street there, B is the only other segment, same street name."""
    idx = build_index(segs); nxt = {}
    for s in segs:
        cross, cont = neighbours(idx, s, 1)
        if cross or len(cont) != 1: continue
        o, ok = cont[0]
        if o['s'] != s['s'] or ok != 0: continue          # ok must be B's start: both segments run S→N / W→E
        bcross, bcont = neighbours(idx, o, 0)
        if bcross or len(bcont) != 1 or bcont[0][0] is not s: continue
        nxt[id(s)] = o
    return nxt

USE_RANK = {'Arterial': 4, 'Secondary Arterial': 3, 'Collector': 2, 'Residential': 1}
def hb(n):
    m = re.match(r'^(\d+)(?:-(\d+))? (.+)$', n)
    return (int(m.group(1)), int(m.group(2) or m.group(1)), m.group(3)) if m else (None, None, n)
def merge_name(a, b):
    a0, a1, an = hb(a); b0, b1, bn = hb(b)
    if a0 is None or b0 is None or an != bn: return a
    lo, hi = min(a0, b0), max(a1, b1)
    return f'{lo} {an}' if lo == hi else f'{lo}-{hi} {an}'
def wmean(pairs):
    tot = sum(w for _, w in pairs) or 1
    return round(sum(v * w for v, w in pairs) / tot, 1)

def merge(a, b):
    m = dict(a); la, lb = a['len'], b['len']; L = la + lb
    m['g'] = a['g'] + b['g'][1:]; m['len'] = L; m['n'] = merge_name(a['n'], b['n'])
    if USE_RANK.get(b['u'], 0) > USE_RANK.get(a['u'], 0): m['u'] = b['u']
    row = a['row'] if abs(a['row'] - b['row']) < 2 else wmean([(a['row'], la), (b['row'], lb)])
    m['row'] = row; m['ctc'] = round(row - 7.2, 1); m['spd'] = max(a['spd'], b['spd'])
    if not a.get('bw') and b.get('bw'): m['bw'] = b['bw']
    if a.get('cn') or b.get('cn'):
        m['cn'] = [(a.get('cn') or [[], []])[0], (b.get('cn') or [[], []])[1]]
    m['ix'] = [a.get('ix', [None, None])[0], b.get('ix', [None, None])[1]]
    for f in ('bus', 'truck', 'ow'):
        if a.get(f) or b.get(f): m[f] = True
    if a.get('tr') or b.get('tr'):
        tr = {}
        for sd in ('L', 'R'):
            ta, tb = (a.get('tr') or {}).get(sd), (b.get('tr') or {}).get(sd)
            if ta and tb:
                n = ta['n'] + tb['n']
                tr[sd] = {'n': n, 'sp': round(L / n, 1), 'h': wmean([(ta['h'] or 0, ta['n']), (tb['h'] or 0, tb['n'])]), 'd': wmean([(ta['d'] or 0, ta['n']), (tb['d'] or 0, tb['n'])]),
                          'name': (ta if ta['n'] >= tb['n'] else tb).get('name')}
            elif ta or tb:
                t = dict(ta or tb); t['sp'] = round(L / t['n'], 1); tr[sd] = t
        m['tr'] = tr
    if a.get('pm') or b.get('pm'):
        pa, pb = a.get('pm') or {'L': 0, 'R': 0}, b.get('pm') or {'L': 0, 'R': 0}; m['pm'] = {'L': pa['L'] + pb['L'], 'R': pa['R'] + pb['R']}
    if a.get('rk') or b.get('rk'):
        ra, rb = a.get('rk') or {'L': 0, 'R': 0}, b.get('rk') or {'L': 0, 'R': 0}; m['rk'] = {'L': ra['L'] + rb['L'], 'R': ra['R'] + rb['R']}
    if a.get('ln') or b.get('ln'):
        la_, lb_ = a.get('ln') or {'L': [], 'R': []}, b.get('ln') or {'L': [], 'R': []}
        m['ln'] = {sd: la_.get(sd, []) + [round(p + la, 1) for p in lb_.get(sd, [])] for sd in ('L', 'R')}
    if a.get('bst') or b.get('bst'):
        ba, bb = a.get('bst') or {'L': [], 'R': []}, b.get('bst') or {'L': [], 'R': []}
        m['bst'] = {sd: ba.get(sd, []) + [[round(p + la, 1), nm] for p, nm in bb.get(sd, [])] for sd in ('L', 'R')}
    if a.get('bl') or b.get('bl'):
        bl = {}
        for sd in ('L', 'R'):
            xa, xb = (a.get('bl') or {}).get(sd), (b.get('bl') or {}).get(sd)
            if xa and xb: bl[sd] = {'n': xa['n'] + xb['n'], 'sb': wmean([(xa['sb'], xa['n']), (xb['sb'], xb['n'])]), 'cov': wmean([(xa['cov'], la), (xb['cov'], lb)]), 'h': max(xa['h'], xb['h'])}
            elif xa or xb: bl[sd] = dict(xa or xb)
        m['bl'] = bl
    if a.get('osm') or b.get('osm'):
        o = dict(b.get('osm') or {}); o.update(a.get('osm') or {}); m['osm'] = o
    return m

# merge to a fixed point: a join can only become eligible once its neighbours have been merged (a short stub absorbed, a chain
# closed), so repeat until a pass finds nothing
out = list(segs); merged_chains = 0; merged_segs = 0; n_in = len(segs)
for _ in range(10):
    nxt = find_joins(out)
    if not nxt: break
    prev = {id(o) for o in nxt.values()}; seen = set(); nxt_out = []
    for s in out:
        if id(s) in prev or id(s) in seen: continue      # chain heads only
        cur = s; parts = 1
        while id(cur) in nxt:
            o = nxt[id(cur)]; seen.add(id(o)); cur = merge(cur, o); parts += 1
        if parts > 1: merged_chains += 1; merged_segs += parts
        nxt_out.append(cur)
    out = nxt_out
segs = [None] * n_in   # only the count is reported below
def dedupe(ps):   # a laneway at a join was recorded by both halves: keep one opening per 3 m
    o = []
    for p in sorted(ps):
        if not o or p - o[-1] > 3: o.append(p)
    return o
for s in out:
    if s.get('ln'): s['ln'] = {sd: dedupe(v) for sd, v in s['ln'].items()}
for i, s in enumerate(out): s['i'] = i
d['segs'] = out
d['merge'] = {'input_segments': len(segs), 'output_blocks': len(out), 'chains_merged': merged_chains, 'segments_absorbed': merged_segs}
print(f'{len(segs)} segments → {len(out)} blocks: {merged_chains} chains merged from {merged_segs} segments')
dpath.write_text(json.dumps(d, separators=(',', ':')), encoding='utf-8'); print('data.json', round(dpath.stat().st_size / 1048576, 1), 'MB')
