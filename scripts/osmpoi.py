"""v3: OpenStreetMap points of interest (data.json → poi, bikeinfra).

  poi        destinations for the bike score's "destinations" component, in the Walk Score categories (grocery, restaurants,
             shopping, coffee, banks, parks, schools, books, entertainment) — nodes, and the centroid of ways / area features
  bikeinfra  the bike-infrastructure map layer: bicycle parking (with capacity), repair stations, bike shops, bike-share
             stations (Mobi), and drinking water (a cyclist's stop)
Fetched once for the city bbox (cached in data/raw/osm_poi.json). Run before score.py:  python scripts/osmpoi.py
Source: OpenStreetMap contributors, ODbL, via Overpass.
"""
import json, pathlib, urllib.request, urllib.parse, time
from pyproj import Transformer

root = pathlib.Path(__file__).resolve().parent.parent
dpath = root / 'data' / 'data.json'; d = json.load(open(dpath, encoding='utf-8')); O = d['origin']
T = Transformer.from_crs('EPSG:4326', 'EPSG:26910', always_xy=True)
BB = '49.195,-123.28,49.32,-123.02'
Q = (f'[out:json][timeout:600][bbox:{BB}];('
     'nwr["shop"];'
     'nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|bank|school|college|university|library|pharmacy|cinema|theatre|community_centre|'
     'bicycle_parking|bicycle_repair_station|bicycle_rental|drinking_water|marketplace|kindergarten)$"];'
     'nwr["leisure"~"^(park|playground|sports_centre|fitness_centre|swimming_pool|garden)$"]["name"];'
     ');out tags center;')
MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter', 'https://z.overpass-api.de/api/interpreter',
           'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
cache = root / 'data' / 'raw' / 'osm_poi.json'
if cache.exists(): osm = json.load(open(cache, encoding='utf-8')); print('from cache', cache.name)
else:
    osm = None
    for attempt in range(2):
        for url in MIRRORS:
            t0 = time.time()
            try:
                req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': Q}).encode(), headers={'User-Agent': 'vancouver-bikeway-designer/1.0 (ARCH 540 studio tool)'})
                osm = json.load(urllib.request.urlopen(req, timeout=660)); print('fetched from', url, len(osm['elements']), 'elements in', round(time.time() - t0), 's'); break
            except Exception as e: print('failed', url, e)
        if osm: break
    if osm is None: raise SystemExit('no Overpass mirror answered; try again later')
    cache.write_text(json.dumps(osm), encoding='utf-8')

def loc(el):
    p = el if el.get('type') == 'node' else el.get('center')
    if not p: return None
    x, y = T.transform(p['lon'], p['lat']); return [round(x - O[0]), round(y - O[1])]
B = d['bounds']
def inside(p): return p and B[0] - 200 <= p[0] <= B[2] + 200 and B[1] - 200 <= p[1] <= B[3] + 200

# Walk Score categories (weights are applied in score.py): g grocery · r restaurants/bars · s shopping · c coffee · b banks ·
# p parks · e schools · k books · n entertainment
def category(t):
    shop, am, le = t.get('shop', ''), t.get('amenity', ''), t.get('leisure', '')
    if shop in ('supermarket', 'grocery', 'greengrocer', 'convenience', 'bakery', 'butcher', 'seafood', 'deli', 'health_food') or am == 'marketplace': return 'g'
    if am in ('restaurant', 'fast_food', 'bar', 'pub'): return 'r'
    if am == 'cafe' or shop in ('coffee', 'tea'): return 'c'
    if am == 'bank': return 'b'
    if le in ('park', 'playground', 'garden'): return 'p'
    if am in ('school', 'college', 'university', 'kindergarten'): return 'e'
    if shop == 'books' or am == 'library': return 'k'
    if am in ('cinema', 'theatre', 'community_centre') or le in ('sports_centre', 'fitness_centre', 'swimming_pool'): return 'n'
    if shop and shop not in ('bicycle', 'vacant', 'yes', 'no'): return 's'
    return None
poi, infra = [], []
for el in osm['elements']:
    t = el.get('tags', {}); p = loc(el)
    if not inside(p): continue
    am, shop = t.get('amenity', ''), t.get('shop', '')
    if am == 'bicycle_parking':
        cap = t.get('capacity', ''); cap = int(''.join(ch for ch in cap if ch.isdigit()) or 0) if cap else 0
        infra.append({'k': 'park', 'p': p, 'cap': cap, 'cov': 1 if t.get('covered') in ('yes', 'true') or t.get('bicycle_parking') in ('shed', 'lockers', 'building') else 0}); continue
    if am == 'bicycle_repair_station': infra.append({'k': 'repair', 'p': p, 'n': t.get('name', '')[:40]}); continue
    if shop == 'bicycle': infra.append({'k': 'shop', 'p': p, 'n': t.get('name', '')[:40]}); continue
    if am == 'bicycle_rental': infra.append({'k': 'share', 'p': p, 'n': (t.get('name') or t.get('network') or '')[:40]}); continue
    if am == 'drinking_water': infra.append({'k': 'water', 'p': p}); continue
    c = category(t)
    if c: poi.append({'c': c, 'p': p, 'n': t.get('name', '')[:40]})
d['poi'] = poi; d['bikeinfra'] = infra
from collections import Counter
print('destinations', len(poi), dict(Counter(x['c'] for x in poi))); print('bike infrastructure', len(infra), dict(Counter(x['k'] for x in infra)))
d['osmpoi'] = {'poi': len(poi), 'bikeinfra': len(infra), 'source': 'OpenStreetMap contributors, ODbL, via Overpass'}
dpath.write_text(json.dumps(d, separators=(',', ':')), encoding='utf-8'); print('data.json', round(dpath.stat().st_size / 1048576, 1), 'MB')
