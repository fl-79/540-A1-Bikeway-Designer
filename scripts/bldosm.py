"""v3: heights for the buildings the 2009 LiDAR did not cover (data.json → bldb, in place).

bld2.py flags every 2015 outline with no 2009 LiDAR height (17,429 of 132,731) and gave them one rough estimate by area.
Nearly all of them are small (median footprint 58 m²): garages, sheds and laneway houses built after 2009. This step keeps
them flagged as estimates but gives them better heights:
  • outlines of 120 m² and more: OpenStreetMap, where a building there carries `height` or `building:levels`
    (levels × 3.1 m, the first floor a little taller); the OSM building with the largest overlap (≥ 30 % of the outline) is used
  • the rest, from the City of Vancouver's zoning limits for what these buildings are:
      < 70 m²      4.0 m   accessory building (garage, shed): RS zones allow 3.7 m flat-roofed / 4.6 m pitched
      70–120 m²    6.1 m   laneway house: 1½ storeys, 6.1 m (20 ft) maximum in the Laneway Housing guidelines
      120–250 m²   8.0 m   a two-storey house (RS-1 maximum 10.7 m; a typical 2-storey is 7.5–9 m)
      250–600 m²  10.7 m   the RS-1 maximum building height
      > 600 m²    13.0 m   a commercial or industrial building (as before)
Flagged buildings keep the flag (0x80) in the data; the renderers no longer colour them. Cached OSM query in
data/raw/osm_building_heights.json. Run after bld2.py, then assemble.py:  python scripts/bldosm.py
Source: OpenStreetMap contributors, ODbL, via Overpass.
"""
import json, base64, struct, pathlib, time, re, urllib.request, urllib.parse
import numpy as np
from shapely.geometry import Polygon
from shapely.strtree import STRtree
from pyproj import Transformer

root = pathlib.Path(__file__).resolve().parent.parent
dpath = root / 'data' / 'data.json'; d = json.load(open(dpath, encoding='utf-8')); O = d['origin']
T = Transformer.from_crs('EPSG:4326', 'EPSG:26910', always_xy=True)
t0 = time.time()

# ── decode the building binary: n (u8), height|flag (u8, 0x80 = estimated), n × (x u16, y u16) in whole metres ──
buf = base64.b64decode(d['bldb']); recs = []; i = 0
while i < len(buf):
    n, hf = struct.unpack_from('BB', buf, i); i += 2
    xy = np.frombuffer(buf, dtype='<u2', count=2 * n, offset=i).reshape(n, 2).astype(int); i += 4 * n
    recs.append([xy, hf & 0x7F, bool(hf & 0x80)])
flagged = [k for k, r in enumerate(recs) if r[2]]
print('buildings', len(recs), 'flagged', len(flagged), round(time.time() - t0), 's')

# ── OpenStreetMap buildings with a height or a level count, city bbox ──
BB = '49.195,-123.28,49.32,-123.02'
Q = (f'[out:json][timeout:900][bbox:{BB}];(way["building"]["building:levels"];way["building"]["height"];);out tags geom;')
MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter', 'https://z.overpass-api.de/api/interpreter',
           'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
cache = root / 'data' / 'raw' / 'osm_building_heights.json'
if cache.exists(): osm = json.load(open(cache, encoding='utf-8')); print('from cache', cache.name)
else:
    osm = None
    for url in MIRRORS:
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': Q}).encode(), headers={'User-Agent': 'vancouver-bikeway-designer/1.0 (ARCH 540 studio tool)'})
            osm = json.load(urllib.request.urlopen(req, timeout=960)); print('fetched from', url, len(osm['elements']), 'ways in', round(time.time() - t0), 's'); break
        except Exception as e: print('failed', url, e)
    if osm is None: raise SystemExit('no Overpass mirror answered; try again later')
    cache.write_text(json.dumps(osm), encoding='utf-8')

def parse_height(t):
    h = t.get('height')
    if h:
        m = re.match(r'\s*([\d.]+)\s*(m|ft|\')?', h)
        if m:
            v = float(m.group(1)); return v * 0.3048 if m.group(2) in ('ft', "'") else v
    lv = t.get('building:levels')
    if lv:
        m = re.match(r'\s*([\d.]+)', lv)
        if m: return float(m.group(1)) * 3.1 + 0.9
    return None
polys, hts = [], []
for el in osm['elements']:
    if el.get('type') != 'way' or 'geometry' not in el or len(el['geometry']) < 4: continue
    h = parse_height(el.get('tags', {}))
    if not h or h < 2 or h > 250: continue
    pts = [T.transform(p['lon'], p['lat']) for p in el['geometry']]; pts = [(x - O[0], y - O[1]) for x, y in pts]
    try: pg = Polygon(pts)
    except Exception: continue
    if not pg.is_valid: pg = pg.buffer(0)
    if pg.is_empty or pg.area < 20: continue
    polys.append(pg); hts.append(h)
tree = STRtree(polys); print('OSM buildings with a height', len(polys), round(time.time() - t0), 's')

# ── flagged outlines: OSM where large enough and matched, else the zoning table ──
def policy(area): return 4.0 if area < 70 else 6.1 if area < 120 else 8.0 if area < 250 else 10.7 if area < 600 else 13.0
n_osm = n_pol = 0; src = {'osm': 0, 'accessory': 0, 'laneway': 0, 'house': 0, 'rs1max': 0, 'large': 0}
for k in flagged:
    xy, h, fl = recs[k]; pg = Polygon(xy.astype(float)); a = pg.area; new = None
    if a >= 120:
        best = None
        for j in tree.query(pg, predicate='intersects'):
            ov = pg.intersection(polys[j]).area
            if ov >= 0.30 * a and (best is None or ov > best[0]): best = (ov, hts[j])
        if best: new = best[1]; n_osm += 1; src['osm'] += 1
    if new is None:
        new = policy(a); n_pol += 1; src['accessory' if a < 70 else 'laneway' if a < 120 else 'house' if a < 250 else 'rs1max' if a < 600 else 'large'] += 1
    recs[k][1] = int(round(max(3, min(new, 120))))
print('flagged heights: OpenStreetMap', n_osm, '| zoning table', n_pol, src, round(time.time() - t0), 's')

# ── re-encode (flag kept) ──
out = bytearray()
for xy, h, fl in recs: out += struct.pack('BB', len(xy), h | (0x80 if fl else 0)); out += xy.astype('<u2').tobytes()
d['bldb'] = base64.b64encode(bytes(out)).decode()
d['bld2'] = dict(d.get('bld2', {}), osm_heights=n_osm, policy_heights=n_pol, policy_breakdown=src,
                 source='2015 outlines (City of Vancouver); heights from the 2009 LiDAR footprints, else OpenStreetMap height / levels (≥120 m²), else the zoning limits by footprint area')
dpath.write_text(json.dumps(d, separators=(',', ':')), encoding='utf-8'); print('data.json', round(dpath.stat().st_size / 1048576, 1), 'MB')
