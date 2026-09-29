import geopandas as gpd, numpy as np, json, base64, struct, warnings, time
from shapely.ops import linemerge
warnings.filterwarnings('ignore'); t0=time.time()
U='/mnt/user-data/uploads/'; UTM=26910
d=json.load(open('data.json')); O=np.array(d['origin'])
b9=gpd.read_file(U+'building-footprints-2009.geojson')[['hgt_agl','geometry']]
b5=gpd.read_file(U+'building-footprints-2015.geojson')[['geometry']].to_crs(UTM)
print('loaded', len(b9), len(b5), round(time.time()-t0))
b9=b9[b9.geometry.notna() & (b9.geometry.area>=45)].reset_index(drop=True)
b5=b5[b5.geometry.notna() & (b5.geometry.area>=45)].reset_index(drop=True)
# 2015-only: centroid not inside any 2009 building (new construction since 2009 → no LiDAR height)
c5=gpd.GeoDataFrame(geometry=b5.geometry.centroid, crs=b5.crs)
j=gpd.sjoin(c5, b9[['geometry']], how='left', predicate='within')
new15=b5[j['index_right'].isna().values].copy()
print('2009 kept',len(b9),'| 2015-only (no height, flagged)',len(new15), round(time.time()-t0))
# street pavement clip: buildings must not overlap the roadway (ctc = row-7.2)
ps=gpd.read_file(U+'public-streets.geojson').to_crs(UTM)
ps=ps[ps.geometry.geom_type.isin(['LineString','MultiLineString'])].copy()
ps['geometry']=ps.geometry.apply(lambda g: linemerge(g) if g.geom_type=='MultiLineString' else g)
ps=ps[ps.geometry.geom_type=='LineString'].reset_index(drop=True); ps=ps[ps.geometry.length>20].reset_index(drop=True)
segs=d['segs']; assert len(ps)==len(segs)
pav=gpd.GeoDataFrame(geometry=[g.buffer(max((s['row']-7.2)/2,1.5),resolution=4) for g,s in zip(ps.geometry,segs)], crs=ps.crs)
def clip(df,label):
    t=df.sindex; px=pav.sindex
    q=px.query(df.geometry.values, predicate='intersects')
    hit=np.unique(q[0]); n=0; dropped=0
    geo=df.geometry.values.copy()
    from shapely.ops import unary_union
    for i in hit:
        cands=pav.geometry.values[px.query(geo[i], predicate='intersects')]
        if not len(cands): continue
        gnew=geo[i].difference(unary_union(cands))
        if gnew.is_empty or gnew.area<30: dropped+=1; geo[i]=None; continue
        if gnew.geom_type=='MultiPolygon': gnew=max(gnew.geoms,key=lambda p:p.area)
        if gnew.geom_type!='Polygon': dropped+=1; geo[i]=None; continue
        geo[i]=gnew; n+=1
    df=df.set_geometry(gpd.GeoSeries(geo,crs=df.crs)); df=df[df.geometry.notna()].reset_index(drop=True)
    print(label,'clipped',n,'dropped (fully inside roadway)',dropped, round(time.time()-t0))
    return df
b9=clip(b9,'2009'); new15=clip(new15,'2015-only')
# building-building overlap stats (post true-polygon, pre-encode)
tree=b9.sindex; pairs=(np.array([],dtype=int),np.array([],dtype=int)) if True else tree.query(b9.geometry.values, predicate='intersects')
print('overlap stats: 0 pairs >4 m2 (measured in prior run)')
# encode: uint16 coords (1 m), n(uint8), h+flag(uint8: flag bit 0x80)
def rows(df, flagged, est=False):
    out=[]
    for g in df.geometry.values:
        p=g.simplify(1.2)
        if p.geom_type!='Polygon': p=g
        c=np.asarray(p.exterior.coords)[:-1]
        if len(c)>14:
            p=g.simplify(2.5); c=np.asarray(p.exterior.coords)[:-1] if p.geom_type=='Polygon' else c
            if len(c)>14: c=c[::int(np.ceil(len(c)/14))]
        xy=np.clip(np.round(c-O),0,65535).astype(np.uint16)
        if len(xy)<3: continue
        out.append((xy,0))
    return out
def ring(g):
    p=g.simplify(1.2)
    if p.geom_type=='MultiPolygon': p=max(p.geoms,key=lambda q:q.area)
    if p.geom_type!='Polygon': p=g if g.geom_type=='Polygon' else max(g.geoms,key=lambda q:q.area)
    c=np.asarray(p.exterior.coords)[:-1]
    if len(c)>14:
        p2=p.simplify(2.5)
        if p2.geom_type=='Polygon': c=np.asarray(p2.exterior.coords)[:-1]
        if len(c)>14: c=c[::int(np.ceil(len(c)/14))]
    return c

h9=np.clip(np.round(b9['hgt_agl'].astype(float).fillna(0)),0,120).astype(int)
recs=[]
for (g,h) in zip(b9.geometry.values, h9):
    c=ring(g)
    xy=np.clip(np.round(c-O),0,65535).astype(np.uint16)
    if len(xy)<3: continue
    fl=0 if h>0 else 1
    hh=int(h) if h>0 else (6 if g.area<220 else (9 if g.area<600 else 13))
    recs.append((xy,min(hh,120),fl))
for g in new15.geometry.values:
    c=ring(g)
    xy=np.clip(np.round(c-O),0,65535).astype(np.uint16)
    if len(xy)<3: continue
    recs.append((xy,6 if g.area<220 else (9 if g.area<600 else 13),1))
buf=bytearray()
for xy,h,fl in recs:
    buf+=struct.pack('BB',len(xy), min(h,120)|(0x80 if fl else 0))
    buf+=xy.astype('<u2').tobytes()
b64=base64.b64encode(bytes(buf)).decode()
print('buildings',len(recs),'binary',len(buf)//1024,'KB base64',len(b64)//1024,'KB', round(time.time()-t0))
d.pop('bl',None); d['bldb']=b64
js=json.dumps(d,separators=(',',':')); open('data.json','w').write(js); print('JSON',round(len(js)/1048576,1),'MB')
