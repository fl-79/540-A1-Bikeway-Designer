import geopandas as gpd, numpy as np, json, re, warnings, time
from shapely.ops import unary_union, polygonize, linemerge
from shapely.geometry import Point
warnings.filterwarnings('ignore'); t0=time.time()
U='/mnt/user-data/uploads/'; UTM=26910
d=json.load(open('data.json')); O=np.array(d['origin']); segs=d['segs']
ps=gpd.read_file(U+'public-streets.geojson').to_crs(UTM)
ps=ps[ps.geometry.geom_type.isin(['LineString','MultiLineString'])].copy()
ps['geometry']=ps.geometry.apply(lambda g: linemerge(g) if g.geom_type=='MultiLineString' else g)
ps=ps[ps.geometry.geom_type=='LineString'].reset_index(drop=True); ps=ps[ps.geometry.length>20].reset_index(drop=True)
assert len(ps)==len(segs)
geoms=list(ps.geometry)
def fwd_of(i):
    c=np.array(geoms[i].coords); ns=abs(c[-1][1]-c[0][1])>=abs(c[-1][0]-c[0][0]); return 1 if ((c[-1][1]-c[0][1])>=0 if ns else (c[-1][0]-c[0][0])>=0) else -1
def lbl_side(i, pt):
    g=geoms[i]; d_=g.project(pt); q=g.interpolate(d_); a=g.interpolate(max(0,d_-1)); b=g.interpolate(min(g.length,d_+1))
    cross=(b.x-a.x)*(pt.y-q.y)-(b.y-a.y)*(pt.x-q.x); side='L' if cross>0 else 'R'
    return side if fwd_of(i)==1 else ('R' if side=='L' else 'L')
def along(i, pt): g=geoms[i]; d_=g.project(pt); return d_ if fwd_of(i)==1 else g.length-d_
sidx=ps.sindex
def nearest(pt, maxd):
    hits=list(sidx.query(pt.buffer(maxd),predicate='intersects'))
    if not hits: return None
    i=min(hits,key=lambda k:geoms[k].distance(pt)); return i if geoms[i].distance(pt)<=maxd else None

sh=gpd.read_file(U+'shoreline-2002.geojson'); cb=gpd.read_file(U+'city-boundary.geojson')
lines=list(sh.geometry)+[l for g in cb.geometry for l in (g.geoms if g.geom_type=='MultiLineString' else [g])]
polys=list(polygonize(unary_union(lines)))
street_pts=ps.geometry.interpolate(0.5,normalized=True)
land=[p for p in polys if street_pts.within(p).sum()>3]
print('polygonised',len(polys),'land',len(land),'km2',round(sum(p.area for p in land)/1e6,1))
land_u=unary_union(land).simplify(3)
lp=list(land_u.geoms) if land_u.geom_type=='MultiPolygon' else [land_u]
d['land']=[[[round(float(x-O[0])),round(float(y-O[1]))] for x,y in p.exterior.coords] for p in lp if p.area>2e4]
d['boundary']=[[[round(float(x-O[0])),round(float(y-O[1]))] for x,y in l.coords] for g in cb.geometry for l in (g.geoms if g.geom_type=='MultiLineString' else [g])]
bb=unary_union(list(cb.geometry)).bounds; d['bounds']=[round(float(bb[0]-O[0])),round(float(bb[1]-O[1])),round(float(bb[2]-O[0])),round(float(bb[3]-O[1]))]
pk=gpd.read_file(U+'parks.geojson').to_crs(UTM); hect=pk['hectare'].astype(float).fillna(0)
d['parks']=[[round(float(g.x-O[0])),round(float(g.y-O[1])),round(float(h),1),str(n)] for g,h,n in zip(pk.geometry,hect,pk['name'])]
nc=gpd.read_file(U+'non-city-streets.geojson').to_crs(UTM); d['nc']=[[[round(float(x-O[0])),round(float(y-O[1]))] for x,y in g.simplify(2).coords] for g in nc.geometry if g.geom_type=='LineString']
print('land/boundary done', round(time.time()-t0))

ts=gpd.read_file(U+'traffic-signals.geojson').to_crs(UTM); tsx=ts.sindex
for i,s in enumerate(segs):
    c=np.array(geoms[i].coords); e0,e1=(Point(c[0]),Point(c[-1])) if fwd_of(i)==1 else (Point(c[-1]),Point(c[0]))
    for k,e in enumerate((e0,e1)):
        h=ts.iloc[list(tsx.query(e.buffer(28),predicate='intersects'))]
        if len(h):
            if s['ix'][k] is None: s['ix'][k]={'x':''}
            s['ix'][k]['sig']=str(h.iloc[0]['type'])
# sample 5 points per block; a block is on a route if >=3 samples lie within 9 m of a route line
samp=[]; 
for i,g in enumerate(geoms):
    for t in (0.1,0.3,0.5,0.7,0.9): samp.append((i,g.interpolate(t,normalized=True)))
SP=gpd.GeoDataFrame({'i':[a for a,_ in samp]}, geometry=[b for _,b in samp], crs=ps.crs)
def route_flag(path, maxd, thresh, key, simplify=False):
    L=gpd.read_file(U+path).to_crs(UTM); L=L[L.geometry.notna()]
    j=gpd.sjoin_nearest(SP[['i','geometry']], L[['geometry']], how='inner', max_distance=maxd)
    cnt=j.groupby('i').size()
    n=0
    for i,c in cnt.items():
        if c>=thresh: segs[i][key]=True; n+=1
    return n
print('bus blocks', route_flag('bus-shapes.geojson',9,3,'bus'), round(time.time()-t0))
bst=gpd.read_file(U+'bus-stops.geojson').to_crs(UTM); bst=bst[bst['location_type'].astype(str).isin(['False','0','0.0','nan','None'])]
stopc=0
for _,r in bst.iterrows():
    i=nearest(r.geometry,14)
    if i is None: continue
    sd=lbl_side(i,r.geometry); segs[i].setdefault('bst',{'L':[],'R':[]})[sd].append([round(float(along(i,r.geometry)),1), str(r['stop_name'])[:40]]); stopc+=1
print('stops placed', stopc, round(time.time()-t0))
route_flag('truck-routes.geojson',9,3,'truck'); route_flag('one-way-streets.geojson',6,4,'ow')
print('truck',sum(1 for s in segs if s.get('truck')),'oneway',sum(1 for s in segs if s.get('ow')))
racks=json.load(open(U+'bike-racks.json'))
def norm(n):
    n=(n or '').upper().strip()
    for a,b in [('AVENUE','AV'),('STREET','ST'),('BOULEVARD','BLVD'),('PLACE','PL')]: n=re.sub(r'\b'+a+r'\b',b,n)
    return n
byblock={}
for i,s in enumerate(segs): byblock.setdefault(s['n'],[]).append(i)
placed=0
for r in racks:
    try: num=int(str(r.get('street_number') or '').split('-')[0])
    except: continue
    ids=byblock.get(f"{num//100*100} {norm(r.get('street_name'))}")
    if not ids: continue
    i=ids[0]; s=segs[i]; side=(r.get('street_side') or '').upper(); lbl=['W','E'] if s['ns'] else ['N','S']
    sd='L' if side.startswith(lbl[0]) else ('R' if side.startswith(lbl[1]) else 'L')
    s.setdefault('rk',{'L':0,'R':0})[sd]+=int(r.get('number_of_racks') or 1); placed+=1
print('racks placed',placed,'of',len(racks))
js=json.dumps(d,separators=(',',':')); open('data.json','w').write(js); print('JSON',len(js)//1024//1024,'MB', round(time.time()-t0))
