import geopandas as gpd, numpy as np, json, base64, warnings, time
from scipy.spatial import cKDTree
warnings.filterwarnings('ignore'); t0=time.time()
U='/mnt/user-data/uploads/'
d=json.load(open('data.json')); O=np.array(d['origin']); B=d['bounds']
c=gpd.read_file(U+'elevation-contour-lines-1-metre-contours.geojson')
print('contours',len(c), round(time.time()-t0))
pts=[]; els=[]
for g,e in zip(c.geometry.values, c['elevation'].astype(float).values):
    if g is None or g.geom_type!='LineString': continue
    a=np.asarray(g.coords)
    if len(a)>4: a=a[::3]
    pts.append(a[:,:2]); els.append(np.full(len(a),e))
P=np.vstack(pts)-O; E=np.concatenate(els)
print('vertices',len(P), round(time.time()-t0))
CELL=20
x0,y0,x1,y1=B[0]-60,B[1]-60,B[2]+60,B[3]+60
nx=int(np.ceil((x1-x0)/CELL))+1; ny=int(np.ceil((y1-y0)/CELL))+1
gx=x0+np.arange(nx)*CELL; gy=y0+np.arange(ny)*CELL
GX,GY=np.meshgrid(gx,gy)
tree=cKDTree(P)
dist,idx=tree.query(np.c_[GX.ravel(),GY.ravel()], k=3, workers=-1)
w=1/np.maximum(dist,0.5); z=(E[idx]*w).sum(1)/w.sum(1)
z[dist[:,0]>140]=0
Z=np.clip(np.round(z*10),-3000,32000).astype('<i2')     # decimetres
b64=base64.b64encode(Z.tobytes()).decode()
print('grid',nx,'x',ny,'=',nx*ny,'cells |',len(b64)//1024,'KB base64 | range',Z.min()/10,'-',Z.max()/10,'m', round(time.time()-t0))
d['terr']={'x0':float(x0),'y0':float(y0),'c':CELL,'nx':nx,'ny':ny,'z':b64}
js=json.dumps(d,separators=(',',':')); open('data.json','w').write(js); print('JSON',round(len(js)/1048576,1),'MB')
