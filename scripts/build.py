import geopandas as gpd, numpy as np, json, re, warnings, time
from shapely.geometry import Point, LineString
from shapely.ops import linemerge
warnings.filterwarnings('ignore'); t0=time.time()
U='/mnt/user-data/uploads/'; UTM=26910
L=lambda n: gpd.read_file(U+n).to_crs(UTM)
ps=L('public-streets.geojson'); rw=L('right-of-way-widths.geojson'); bw=L('bikeways.geojson')
si=L('street-intersections.geojson'); pm=L('parking-meters.geojson'); tr=L('public-trees.geojson')
bl=L('building-footprints-2015.geojson'); ln=L('lanes.geojson')
print('loaded', time.time()-t0)

ps=ps[ps.geometry.geom_type.isin(['LineString','MultiLineString'])].copy()
ps['geometry']=ps.geometry.apply(lambda g: linemerge(g) if g.geom_type=='MultiLineString' else g)
ps=ps[ps.geometry.geom_type=='LineString'].reset_index(drop=True)
ps['sname']=ps['hblock'].str.replace(r'^[\d\-]+ ','',regex=True).str.strip()
ps['first']=ps['sname'].str.split().str[0]
ps['len']=ps.geometry.length
ps=ps[ps['len']>20].reset_index(drop=True)
ps['sid']=ps.index
ORIGIN=np.array([ps.total_bounds[0], ps.total_bounds[1]]); print('origin', ORIGIN, 'segments', len(ps))

def parse_ft(w):
    m=re.search(r'\d+\.?\d*',str(w)); v=float(m.group()) if m else None
    return round(v*0.3048,1) if v else None
rw['wm']=rw['width'].apply(parse_ft)

# ---------- per-point nearest segment + side (vectorised) ----------
def assign(points, maxdist):
    j=gpd.sjoin_nearest(points[['geometry']], ps[['sid','geometry']], how='inner', max_distance=maxdist, distance_col='dist')
    j=j[~j.index.duplicated()]
    segs=ps.geometry.values[j['sid'].values]
    side=[]; along=[]
    for g,p in zip(segs, j.geometry.values):
        d=g.project(p); q=g.interpolate(d); a=g.interpolate(max(0,d-1)); b=g.interpolate(min(g.length,d+1))
        cross=(b.x-a.x)*(p.y-q.y)-(b.y-a.y)*(p.x-q.x)
        side.append('L' if cross>0 else 'R'); along.append(d)
    j['side']=side; j['along']=along; return j

# orientation & normalisation: L should be West (NS) / North (EW). Segment param direction may be reversed.
coords=[np.array(g.coords) for g in ps.geometry]
ps['ns']=[abs(c[-1][1]-c[0][1])>=abs(c[-1][0]-c[0][0]) for c in coords]
ps['fwd']=[1 if ((c[-1][1]-c[0][1])>=0 if ns else (c[-1][0]-c[0][0])>=0) else -1 for c,ns in zip(coords,ps['ns'])]
# with fwd=+1 (param runs N or E), cross>0 => left => West/North. If fwd=-1 flip.
def norm_side(sid, s): return s if ps['fwd'].iat[sid]==1 else ('R' if s=='L' else 'L')

# ROW: nearest segment for each ROW point (within 25 m); mode per segment of plausible widths
rj=assign(rw, 25); rj['wm']=rw['wm'].reindex(rj.index).values
rj=rj[rj['wm'].between(10,50)]
row_by=rj.groupby('sid')['wm'].agg(lambda x: float(x.mode().iloc[0]))
# fill missing from same street name mode
ps['row']=ps['sid'].map(row_by)
street_mode=ps.dropna(subset=['row']).groupby('sname')['row'].agg(lambda x: float(x.mode().iloc[0]))
ps['row']=ps['row'].fillna(ps['sname'].map(street_mode))
use_default={'Arterial':24.4,'Secondary Arterial':20.1,'Collector':20.1,'Residential':20.1}
ps['row']=ps['row'].fillna(ps['streetuse'].map(use_default)).fillna(20.1)
print('row done', time.time()-t0)

# trees
tj=assign(tr,14); tj=tj.join(tr[['height_m','diameter_cm','common_name']])
tj=tj[tj['dist']<=(ps['row'].values[tj['sid'].values]/2+1.5)]
tj['side']=[norm_side(s,d) for s,d in zip(tj['sid'],tj['side'])]
trees={}
for (sid,sd),g in tj.groupby(['sid','side']):
    n=len(g); names=[x for x in g['common_name'] if isinstance(x,str)]
    trees.setdefault(int(sid),{})[sd]={'n':int(n),'sp':round(float(ps['len'].iat[sid]/n),1),'h':round(float(np.nanmedian(g['height_m'])),1),'d':round(float(np.nanmedian(g['diameter_cm'])),1),'name':(max(set(names),key=names.count).title() if names else None)}
print('trees done', time.time()-t0)

# meters
mj=assign(pm,16); mj=mj[mj['dist']<=(ps['row'].values[mj['sid'].values]/2+2)]
mj['side']=[norm_side(s,d) for s,d in zip(mj['sid'],mj['side'])]
pms={}
for (sid,sd),g in mj.groupby(['sid','side']): pms.setdefault(int(sid),{'L':0,'R':0})[sd]=int(len(g))

# buildings: centroid nearest segment within 40 m
bc=gpd.GeoDataFrame({'area':bl.geometry.area,'geom':bl.geometry}, geometry=bl.geometry.centroid, crs=bl.crs)
bj=assign(bc,42); bj=bj.join(bc[['area','geom']])
bj['side']=[norm_side(s,d) for s,d in zip(bj['sid'],bj['side'])]
blds={}
for (sid,sd),g in bj.groupby(['sid','side']):
    seg=ps.geometry.iat[sid]; half=ps['row'].iat[sid]/2; Ls=ps['len'].iat[sid]
    sbs=[max(0.0, gm.distance(seg)-half) for gm in g['geom']]
    front=0.0
    for gm in g['geom']:
        polys=list(gm.geoms) if gm.geom_type=='MultiPolygon' else [gm]
        cs=np.vstack([np.array(p.exterior.coords) for p in polys]); st=max(1,len(cs)//8)
        pr=[seg.project(Point(x,y)) for x,y in cs[::st]]; front+=min(max(pr)-min(pr),60)
    area=float(np.median(g['area'])); hc=6 if area<220 else (9 if area<600 else 13)
    blds.setdefault(int(sid),{})[sd]={'n':int(len(g)),'sb':round(float(np.median(sbs)),1),'cov':round(min(1.0,front/Ls),2),'h':hc}
print('buildings done', time.time()-t0)

# laneway openings: lane endpoints near a segment, roughly perpendicular
ends=[]; 
for i,g in enumerate(ln.geometry):
    if g.geom_type!='LineString': continue
    c=g.coords; ends.append((Point(c[0]), c[0], c[-1])); ends.append((Point(c[-1]), c[-1], c[0]))
ep=gpd.GeoDataFrame({'a':[e[1] for e in ends],'b':[e[2] for e in ends]}, geometry=[e[0] for e in ends], crs=ln.crs)
lj=assign(ep,22); lj=lj.join(ep[['a','b']])
lj=lj[lj['dist']<=(ps['row'].values[lj['sid'].values]/2+8)]
lanes={}
for idx,r in lj.iterrows():
    seg=ps.geometry.iat[r['sid']]; a,b=r['a'],r['b']; vx,vy=b[0]-a[0],b[1]-a[1]
    d=r['along']; p1=seg.interpolate(max(0,d-2)); p2=seg.interpolate(min(seg.length,d+2)); sx,sy=p2.x-p1.x,p2.y-p1.y
    if abs(vx*sx+vy*sy)/(np.hypot(vx,vy)*np.hypot(sx,sy)+1e-9)<0.7:
        sd=norm_side(r['sid'], r['side']); rec=lanes.setdefault(int(r['sid']),{'L':[],'R':[]})
        pos=round(float(d if ps['fwd'].iat[r['sid']]==1 else seg.length-d),1); rec[sd].append(pos)
print('lanes done', time.time()-t0)

# bikeways: on-segment existing facility, and node connections
bw=bw[bw['status']=='Active'].copy()
bw['first']=bw['street_name'].fillna('').str.upper().str.split().str[0]
def bwrec(b): 
    spd=b['speed_limit']
    return {'t':str(b['bikeway_type']),'dir':str(b['bikeway_direction']),'aaa':str(b['aaa_network'])=='YES','wn':str(b['w_n_bound_type']),'es':str(b['e_s_bound_type']),'spd':(float(spd) if spd==spd and spd>0 else None),'name':str(b['bike_route_name'])}
bsx=bw.sindex
onseg={}
for sid,g in zip(ps['sid'], ps.geometry):
    cand=bw.iloc[list(bsx.query(g.buffer(12),predicate='intersects'))]
    if len(cand)==0: continue
    first=ps['first'].iat[sid]
    same=cand[cand['first']==first]
    pick=same if len(same) else cand[cand.geometry.buffer(6).intersection(g).length>g.length*0.5]
    if len(pick): onseg[int(sid)]=bwrec(pick.iloc[0])
# node connections: for each segment end, bikeways touching within 15 m; flag same-street
conn={}
bends=[]
for i,g in zip(bw.index, bw.geometry):
    gs=[g] if g.geom_type=='LineString' else list(g.geoms)
    for l in gs: bends.append((i,Point(l.coords[0]))); bends.append((i,Point(l.coords[-1])))
be=gpd.GeoDataFrame({'bi':[b[0] for b in bends]}, geometry=[b[1] for b in bends], crs=bw.crs); bex=be.sindex
for sid,g in zip(ps['sid'], ps.geometry):
    c=g.coords; e0,e1=(Point(c[0]),Point(c[-1])) if ps['fwd'].iat[sid]==1 else (Point(c[-1]),Point(c[0]))
    out=[]
    for e in (e0,e1):
        hits=be.iloc[list(bex.query(e.buffer(15),predicate='intersects'))]
        recs=[]; seen=set()
        for bi in hits['bi'].unique():
            b=bw.loc[bi]; key=(b['bikeway_type'],b['bikeway_direction'],b['first'])
            if key in seen: continue
            seen.add(key)
            if sid in onseg and b['first']==ps['first'].iat[sid] and bw.geometry.loc[bi].buffer(6).intersection(g).length>g.length*0.5: continue  # itself
            r=bwrec(b); r['same']=bool(b['first']==ps['first'].iat[sid]); recs.append(r)
        out.append(recs)
    if out[0] or out[1]: conn[int(sid)]=out
print('bikeways done', time.time()-t0, len(onseg), len(conn))

# intersections at ends
six=si.sindex
def end_info(sid):
    g=ps.geometry.iat[sid]; c=g.coords; e0,e1=(Point(c[0]),Point(c[-1])) if ps['fwd'].iat[sid]==1 else (Point(c[-1]),Point(c[0]))
    out=[]
    for e in (e0,e1):
        h=si.iloc[list(six.query(e.buffer(20),predicate='intersects'))]
        out.append({'x':str(h.iloc[0]['xstreet'])} if len(h) else None)
    return out

SPEED={'Arterial':50,'Secondary Arterial':50,'Collector':30,'Residential':30}
ctc_of=lambda row: round(row-7.2,1)   # 3.6 m sidewalk+boulevard each side (EDM typical); editable in UI
segs=[]
for sid in ps['sid']:
    r=ps.iloc[sid]; c=np.array(r.geometry.simplify(1.0).coords)-ORIGIN; 
    if r['fwd']==-1: c=c[::-1]
    spd=SPEED.get(r['streetuse'],50)
    ob=onseg.get(sid)
    if ob and ob['spd']: spd=ob['spd']
    rec={'i':int(sid),'n':r['hblock'],'s':r['sname'],'u':r['streetuse'],'ns':bool(r['ns']),'len':int(r['len']),'row':float(r['row']),'ctc':ctc_of(float(r['row'])),'spd':spd,
         'g':[[round(float(x)),round(float(y))] for x,y in c]}
    if ob: rec['bw']=ob
    if sid in conn: rec['cn']=conn[sid]
    if sid in trees: rec['tr']=trees[sid]
    if sid in pms: rec['pm']=pms[sid]
    if sid in blds: rec['bl']=blds[sid]
    if sid in lanes: rec['ln']=lanes[sid]
    rec['ix']=end_info(sid)
    segs.append(rec)
# bikeway geometry for the map
bwg=[]
for _,b in bw.iterrows():
    g=b.geometry; gs=[g] if g.geom_type=='LineString' else list(g.geoms)
    for l in gs:
        c=np.array(l.simplify(1.5).coords)-ORIGIN
        bwg.append({'t':str(b['bikeway_type']),'d':str(b['bikeway_direction']),'a':str(b['aaa_network'])=='YES','g':[[round(float(x)),round(float(y))] for x,y in c]})
data={'origin':[float(ORIGIN[0]),float(ORIGIN[1])],'bounds':[round(float(v)) for v in (ps.total_bounds-np.tile(ORIGIN,2))],'segs':segs,'bw':bwg}
js=json.dumps(data,separators=(',',':'))
open('data.json','w').write(js); print('JSON', len(js)//1024,'KB', 'segs',len(segs),'bw',len(bwg), time.time()-t0)
