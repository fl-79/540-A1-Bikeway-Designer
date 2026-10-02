// ═══════════════════════════════════════════════════════════════════════════
// MAP
// ═══════════════════════════════════════════════════════════════════════════
const map = { c:$('map'), z:0.08, x:0, y:0, hover:null, sel:null, drag:null };
const B = DATA.bounds; // [minx,miny,maxx,maxy] in metres from origin
// view bounds: the city plus the greyed context to the west (UBC endowment lands) and north (North Shore coast).
// The east edge is Boundary Road: the map is fitted and clamped so that edge sits at the right of the window.
// Fit bounds VB: Boundary Road at the right edge, the Fraser with a 900 m strip of Richmond at the bottom edge, the west and north
// context beyond. Pan bounds PB allow a further 600 m of overshoot east and south so blocks on those edges can be centred when zoomed in.
const VB = [B[0]-3300, B[1]-900, B[2], B[3]+3600];
const PB = [VB[0]-3000, B[1]-5500, VB[2]+600, VB[3]];   // pan can reach Sea Island / YVR and the Strait, beyond the initial fit
const YNE = (()=>{ const pts=DATA.boundary.flat().filter(p=>p[0]>B[2]-150); return pts.length? Math.max(...pts.map(p=>p[1])) : B[3]; })();   // where Boundary Road meets the inlet
// The south boundary runs down the middle of the Fraser's North Arm. Richmond's bank is drawn ~160 m beyond it, following the
// boundary rather than a straight line, so the river reads full width without implying water inside Richmond.
const SOUTH_BANK=(()=>{ const pts=DATA.boundary.flat(); const step=100; const bins=new Map(); pts.forEach(([x,y])=>{ const k=Math.round(x/step); if(!bins.has(k)||y<bins.get(k)) bins.set(k,y); });
  const ks=[...bins.keys()].sort((a,b)=>a-b); const out=[]; let last=null; for(let k=ks[0];k<=ks[ks.length-1];k++){ if(bins.has(k)) last=bins.get(k); out.push([k*step, last]); } return out; })();
// (Richmond is filled from the boundary line; the river's true extent is then painted over it from the OSM water polygons in DATA.water)
// city boundary as one closed ring (the dataset is 14 line parts, chained end to end); the map is clipped to it
const BRING=(()=>{ const parts=DATA.boundary.map(l=>l.slice()); if(!parts.length) return null; const ring=parts.shift(); const same=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<3;
  let guard=0; while(parts.length && guard++<200){ const tail=ring[ring.length-1]; let hit=-1, rev=false; parts.forEach((p,i)=>{ if(hit>=0) return; if(same(p[0],tail)) hit=i; else if(same(p[p.length-1],tail)){ hit=i; rev=true; } }); if(hit<0) break; const p=parts.splice(hit,1)[0]; (rev?p.reverse():p).slice(1).forEach(q=>ring.push(q)); }
  return parts.length ? null : ring; })();
const USE_COL = {Arterial:'#B8BEC7','Secondary Arterial':'#C4C9D1',Collector:'#CDD2D9',Residential:'#D8DCE2'};
const USE_W = {Arterial:2.2,'Secondary Arterial':1.8,Collector:1.5,Residential:1.0};
const BW_STYLE = t => t==='Protected Bike Lanes' ? {c:'#22C55E',w:3.5} : t==='Painted Lanes' ? {c:'#16A34A',w:2.5,dash:[8,5]} : t==='Shared Lanes' ? {c:'#4D7C0F',w:2.5,dash:[2,4]} : {c:'#86EFAC',w:2.5};
// spatial grid for hit testing
const GRID=250, grid=new Map();
SEGS.forEach(s=>{ const cells=new Set(); s.g.forEach(([x,y])=>cells.add(Math.floor(x/GRID)+','+Math.floor(y/GRID))); cells.forEach(k=>{ if(!grid.has(k)) grid.set(k,[]); grid.get(k).push(s); }); });
// v2: the bikeway features are hit-tested too, so a facility with no street block under it (seawall, greenways) still opens a card
const bwgrid=new Map();
BW.forEach((b,i)=>{ b.i=i; const cells=new Set(); b.g.forEach(([x,y])=>cells.add(Math.floor(x/GRID)+','+Math.floor(y/GRID))); cells.forEach(k=>{ if(!bwgrid.has(k)) bwgrid.set(k,[]); bwgrid.get(k).push(b); }); });
function mapResize(){ const c=map.c; c.width=c.clientWidth*devicePixelRatio; c.height=c.clientHeight*devicePixelRatio; }
function minZoom(){ const c=map.c; return Math.min(c.width/(VB[2]-VB[0]), c.height/(VB[3]-VB[1]))*0.92; }   // whole view visible; can't zoom out further
function clampMap(){ const c=map.c; map.z=clamp(map.z,minZoom(),8*devicePixelRatio);
  // the viewport never leaves the pan bounds; when the view is smaller than the window it is pinned to the bottom-right (Boundary Road, the Fraser)
  const bw=(PB[2]-PB[0])*map.z, bh=(PB[3]-PB[1])*map.z;
  if (bw<=c.width) map.x=c.width-VB[2]*map.z; else map.x=clamp(map.x, c.width-PB[2]*map.z, -PB[0]*map.z);
  if (bh<=c.height) map.y=c.height+VB[1]*map.z; else map.y=clamp(map.y, c.height+PB[1]*map.z, PB[3]*map.z); }
function coverZoom(){ const c=map.c; return Math.max(c.width/(VB[2]-VB[0]), c.height/(VB[3]-VB[1])); }
// initial view: cover-fit the fit bounds and anchor their south-east corner to the window's bottom-right corner
function mapFit(){ mapResize(); const c=map.c; map.z=coverZoom(); map.x=c.width-VB[2]*map.z; map.y=c.height+VB[1]*map.z; clampMap(); drawMap(); }
function mapZoomBy(f){ const c=map.c; const sx=c.width/2, sy=c.height/2; const nz=clamp(map.z*f,minZoom(),8*devicePixelRatio); const k=nz/map.z; map.x=sx-(sx-map.x)*k; map.y=sy-(sy-map.y)*k; map.z=nz; clampMap(); drawMap(); }
const W2S=(x,y)=>[map.x+x*map.z, map.y-y*map.z];
const S2W=(sx,sy)=>[(sx-map.x)/map.z, (map.y-sy)/map.z];
function drawMap(){
  const c=map.c, ctx=c.getContext('2d'); const W=c.width,H=c.height;
  ctx.setTransform(1,0,0,1,0,0); const dpr0=devicePixelRatio;
  // ── outside the city: the sea everywhere, then greyed land where it is known or assumed ──
  ctx.fillStyle='#C9DCE6'; ctx.fillRect(0,0,W,H);
  // fallback only (no regional coastline in the data): Burnaby east of Boundary Road below the inlet, Richmond from the boundary line
  if(!(DATA.landOut&&DATA.landOut.length)){ ctx.fillStyle='#E9EBEE'; const [ex,ey]=W2S(B[2],YNE); ctx.fillRect(ex,ey,Math.max(0,W-ex)+4,H);
    ctx.beginPath(); SOUTH_BANK.forEach(([x,y],i)=>{ const [sx,sy]=W2S(x,y); i?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy); }); const [lx]=W2S(SOUTH_BANK[SOUTH_BANK.length-1][0],0), [fx]=W2S(SOUTH_BANK[0][0],0); ctx.lineTo(lx,H+4); ctx.lineTo(fx,H+4); ctx.closePath(); ctx.fill(); }
  const ringPath=r=>{ ctx.beginPath(); r.forEach(([x,y],i)=>{ const [sx,sy]=W2S(x,y); i?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy); }); ctx.closePath(); };
  // regional land from the OSM coastline (mainland closed to the east, islands as rings), then the City's own polygonised land
  // mass, which runs 3 km past the boundary over Pacific Spirit Park and UBC: all greyed here, the city in colour inside the clip below
  ctx.lineWidth=1*dpr0; (DATA.landOut||[]).forEach(r=>{ ringPath(r); ctx.fillStyle='#E6E8EB'; ctx.fill(); });
  DATA.land.forEach(r=>{ ringPath(r); ctx.fillStyle='#E6E8EB'; ctx.fill(); ctx.strokeStyle='#A3B9C7'; ctx.stroke(); });
  // then the Fraser's arms at their surveyed extent (OSM river relations) cut through that land, with their islands back on top
  (DATA.water||[]).forEach(r=>{ ringPath(r); ctx.fillStyle='#C9DCE6'; ctx.fill(); ctx.strokeStyle='#A3B9C7'; ctx.stroke(); });
  (DATA.islands||[]).forEach(r=>{ ringPath(r); ctx.fillStyle='#E9EBEE'; ctx.fill(); ctx.strokeStyle='#A3B9C7'; ctx.stroke(); });
  ctx.strokeStyle='#A3B9C7'; ctx.lineWidth=1*dpr0; (DATA.coast||[]).forEach(l=>{ ctx.beginPath(); l.forEach(([x,y],i)=>{ const [sx,sy]=W2S(x,y); i?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy); }); ctx.stroke(); });   // their shorelines, greyed
  // ── the city itself, clipped to its boundary ──
  ctx.save(); if (BRING) { ctx.beginPath(); BRING.forEach(([x,y],i)=>{ const [sx,sy]=W2S(x,y); i?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy); }); ctx.closePath(); ctx.clip(); }
  ctx.fillStyle='#C9DCE6'; ctx.fillRect(0,0,W,H);   // water
  // land from the shoreline + boundary polygonisation
  ctx.fillStyle='#F1F2EE'; DATA.land.forEach(ring=>{ ctx.beginPath(); ring.forEach(([x,y],i)=>{ const [sx,sy]=W2S(x,y); i?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy); }); ctx.closePath(); ctx.fill(); ctx.strokeStyle='#8FB0C4'; ctx.lineWidth=1.2*devicePixelRatio; ctx.stroke(); });
  // parks shaded to their real boundaries (v3: the City's parks-polygon-representation, scripts/parkpoly.py; a ring with holes
  // is filled even-odd); the old point dataset's circles sized by hectares are the fallback where the polygons are missing
  ctx.fillStyle='rgba(160,205,140,.55)';
  if(DATA.parkpoly&&DATA.parkpoly.length){ DATA.parkpoly.forEach(pk=>{ ctx.beginPath(); pk.r.forEach(ring=>{ ring.forEach(([x,y],i)=>{ const [sx,sy]=W2S(x,y); i?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy); }); ctx.closePath(); }); ctx.fill('evenodd'); }); }
  else DATA.parks.forEach(([x,y,ha])=>{ if(ha<0.3) return; const [sx,sy]=W2S(x,y); const r=Math.sqrt(ha*1e4/Math.PI)*map.z; if(r<1.5) return; ctx.beginPath(); ctx.arc(sx,sy,r,0,Math.PI*2); ctx.fill(); });
  // v3: the city limit is drawn only where it runs over land (Pacific Spirit Park / UBC to the west, Boundary Road to the east), as a
  // light dashed line; along the inlet and the river the shoreline itself is the edge, so no line is drawn there
  // (drawn after the clip below, so the dashes are not cut in half by the clip edge)
  // v3: a boundary piece is "on land" when points along it lie inside the land polygons (the City's land mass, which runs on over
  // UBC and Pacific Spirit Park, or the regional land) and not in the Fraser's water. English Bay, Burrard Inlet and the river are
  // not land, so the limit there is left to the shoreline. Sampled every ~20 m so a piece that just touches a beach is not kept.
  if(!window.BND_LAND){ const L=[...(DATA.land||[]),...(DATA.landOut||[])], Wt=DATA.water||[];
    const onLand=(x,y)=>L.some(r=>pointInRing(x,y,r)) && !Wt.some(r=>pointInRing(x,y,r));
    const pieceOnLand=(a,b)=>{ const n=Math.max(2,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/20)); let k=0; for(let i=1;i<n;i++){ const t=i/n; if(onLand(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t)) k++; } return k/(n-1)>0.5; };
    window.BND_LAND=DATA.boundary.map(l=>{ const runs=[]; let run=[]; for(let i=1;i<l.length;i++){ const a=l[i-1], b=l[i]; if(!pieceOnLand(a,b)){ if(run.length>1) runs.push(run); run=[]; } else { if(!run.length) run.push(a); run.push(b); } } if(run.length>1) runs.push(run); return runs; }).flat(); }
  if(typeof drawHeatLayer==='function') drawHeatLayer(ctx,W,H,dpr0);   // v3: bike-score heat map under the streets
  ctx.strokeStyle='#D3D6DA'; ctx.lineWidth=1.2*devicePixelRatio; DATA.nc.forEach(g=>{ ctx.beginPath(); g.forEach(([x,y],i)=>{ const [sx,sy]=W2S(x,y); i?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy); }); ctx.stroke(); });
  const [wx0,wy1]=S2W(0,0),[wx1,wy0]=S2W(W,H); const vis=s=>s.g.some(([x,y])=>x>=wx0-300&&x<=wx1+300&&y>=wy0-300&&y<=wy1+300);
  ctx.lineCap='round'; ctx.lineJoin='round';
  const path=(g)=>{ ctx.beginPath(); g.forEach(([x,y],i)=>{ const [sx,sy]=W2S(x,y); i?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy); }); };
  const dpr=devicePixelRatio;
  // streets by class (residential faint at low zoom)
  const lod = map.z*1000; // px per km
  SEGS.forEach(s=>{ if (s.u==='Residential' && lod<120) return; if(!vis(s)) return; const off = lod>250 && !designable(s).ok;   // blocks that cannot take a design: faint and dashed once the map is close enough to read
    ctx.strokeStyle=off?'#DADDE3':(USE_COL[s.u]||'#D8DCE2'); ctx.lineWidth=Math.max(0.6,USE_W[s.u]*Math.min(1,lod/300))*dpr; ctx.setLineDash(off?[3*dpr,3*dpr]:[]); path(s.g); ctx.stroke(); }); ctx.setLineDash([]);
  if (lod>700) { ctx.lineWidth=0.5*dpr; ctx.strokeStyle='#C8C4BA';
    BLD.forEach(b=>{ if(b.x<wx0-60||b.x>wx1+60||b.y<wy0-60||b.y>wy1+60) return;
      ctx.fillStyle='#E4E2DA';   /* v3: estimated heights stay flagged in the data (b.f) but are not coloured */ ctx.beginPath(); b.p.forEach((q,i)=>{ const [sx,sy]=W2S(q[0],q[1]); i?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy); }); ctx.closePath(); ctx.fill(); ctx.stroke(); }); }
  // bikeways
  BW.forEach(b=>{ const st=BW_STYLE(b.t); ctx.strokeStyle=st.c; ctx.lineWidth=st.w*dpr*Math.min(1.2,Math.max(0.6,lod/250)); ctx.setLineDash((st.dash||[]).map(v=>v*dpr)); if(b.g.every(([x,y])=>x<wx0-300||x>wx1+300||y<wy0-300||y>wy1+300)) return; path(b.g); ctx.stroke(); if (b.a && b.t==='Protected Bike Lanes') { ctx.strokeStyle='#15803D'; ctx.lineWidth=st.w*dpr*0.45; ctx.setLineDash([]); path(b.g); ctx.stroke(); } });
  ctx.setLineDash([]);
  // v3: proposals, bike infrastructure and cycling volumes over the existing network
  if(typeof drawProposalsLayer==='function'){ drawProposalsLayer(ctx,path,dpr,lod); drawInfraLayer(ctx,dpr,lod,wx0,wx1,wy0,wy1); drawVolumesLayer(ctx,dpr,lod); }
  ctx.restore();   // end of the boundary clip
  // v3: the city limit as a light dashed line over land only (the old solid outline of the whole ring, water included, is gone)
  if (window.BND_LAND) { ctx.strokeStyle='rgba(15,23,42,.35)'; ctx.setLineDash([5*devicePixelRatio,4*devicePixelRatio]); ctx.lineWidth=1*devicePixelRatio; window.BND_LAND.forEach(l=>{ ctx.beginPath(); l.forEach(([x,y],i)=>{ const [sx,sy]=W2S(x,y); i?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy); }); ctx.stroke(); }); ctx.setLineDash([]); }
  if (map.hoverBW && map.hoverBW!==map.selBW) { ctx.strokeStyle='rgba(15,23,42,.55)'; ctx.lineWidth=6*dpr; path(map.hoverBW.g); ctx.stroke(); }
  if (map.selBW) { ctx.strokeStyle='#F59E0B'; ctx.lineWidth=8*dpr; path(map.selBW.g); ctx.stroke(); ctx.strokeStyle=BW_STYLE(map.selBW.t).c; ctx.lineWidth=3*dpr; path(map.selBW.g); ctx.stroke(); }
  if (map.hover && map.hover!==map.sel) { const off=!designable(map.hover).ok; ctx.strokeStyle=off?'rgba(120,128,138,.6)':'rgba(15,23,42,.55)'; ctx.lineWidth=5*dpr; ctx.setLineDash(off?[6*dpr,4*dpr]:[]); path(map.hover.g); ctx.stroke(); ctx.setLineDash([]); }
  if (map.sel) { const off=!designable(map.sel).ok; ctx.strokeStyle=off?'#9AA0A8':'#F59E0B'; ctx.lineWidth=7*dpr; ctx.setLineDash(off?[8*dpr,5*dpr]:[]); path(map.sel.g); ctx.stroke(); ctx.setLineDash([]); }
  // street labels at high zoom
  if (lod>900) { ctx.fillStyle='#475467'; ctx.font=`${11*dpr}px Inter`; ctx.textAlign='center'; const done=new Set(); SEGS.forEach(s=>{ if(!vis(s)||done.has(s.n)) return; done.add(s.n); const m=s.g[Math.floor(s.g.length/2)]; const [sx,sy]=W2S(m[0],m[1]); ctx.save(); ctx.translate(sx,sy); const a=s.g[s.g.length-1], b=s.g[0]; let ang=Math.atan2(-(a[1]-b[1]),a[0]-b[0]); if(ang>Math.PI/2||ang<-Math.PI/2) ang+=Math.PI; ctx.rotate(ang); ctx.fillText(s.n,0,-4*dpr); ctx.restore(); }); }
  if(typeof drawNorthArrow==='function') drawNorthArrow(ctx,W,H,dpr);   // v3
}
function nearestIn(G,sx,sy){ const [wx,wy]=S2W(sx,sy); const tol=Math.max(6,10/map.z*devicePixelRatio); let best=null,bd=tol; const cx=Math.floor(wx/GRID), cy=Math.floor(wy/GRID);
  for(let i=-1;i<=1;i++) for(let j=-1;j<=1;j++){ const arr=G.get((cx+i)+','+(cy+j)); if(!arr) continue; arr.forEach(s=>{ for(let k=1;k<s.g.length;k++){ const d=distSeg(wx,wy,s.g[k-1],s.g[k]); if(d<bd){bd=d;best=s;} } }); }
  return [best,bd]; }
function nearestSeg(sx,sy){ return nearestIn(grid,sx,sy)[0]; }
// a bikeway feature wins the hit only when it is clearly nearer than any street block (3 m), so an on-street facility opens its block (which has the design)
// (an off-street piece, or one beside a block that has no on-street facility, wins whenever it is the nearer of the two)
function nearestBW(sx,sy){ const [b,db]=nearestIn(bwgrid,sx,sy); if(!b) return null; const [s,ds]=nearestIn(grid,sx,sy); if(!s || db<ds-3) return b;
  return (db<ds && (b.st==='Off-street' || !s.bw || /^OS/.test(s.bw.sub||''))) ? b : null; }
// the street block a bikeway feature runs along (for "go to the block"): a block with a facility whose midpoint lies within 15 m of the feature
function blockOfBW(b){ let best=null,bd=15; const cells=new Set(); b.g.forEach(([x,y])=>cells.add(Math.floor(x/GRID)+','+Math.floor(y/GRID)));
  cells.forEach(k=>{ (grid.get(k)||[]).forEach(s=>{ if(!s.bw) return; const m=s.g[Math.floor(s.g.length/2)]; for(let i=1;i<b.g.length;i++){ const d=distSeg(m[0],m[1],b.g[i-1],b.g[i]); if(d<bd){ bd=d; best=s; } } }); }); return best; }
function distSeg(px,py,a,b){ const dx=b[0]-a[0],dy=b[1]-a[1]; const t=clamp(((px-a[0])*dx+(py-a[1])*dy)/(dx*dx+dy*dy||1),0,1); return Math.hypot(px-(a[0]+t*dx),py-(a[1]+t*dy)); }
(function bindMap(){
  const c=map.c; const pos=e=>[(e.clientX-c.getBoundingClientRect().left)*devicePixelRatio,(e.clientY-c.getBoundingClientRect().top)*devicePixelRatio];
  c.addEventListener('wheel',e=>{ e.preventDefault(); const [sx,sy]=pos(e); const f=Math.exp(-e.deltaY*0.0015); const nz=clamp(map.z*f,minZoom(),8*devicePixelRatio); const k=nz/map.z; map.x=sx-(sx-map.x)*k; map.y=sy-(sy-map.y)*k; map.z=nz; clampMap(); drawMap(); },{passive:false});
  // a press that travels less than 6 CSS px before release is a click (selection); anything more is a pan
  c.addEventListener('mousedown',e=>{ map.drag={x:e.clientX,y:e.clientY,x0:e.clientX,y0:e.clientY,moved:false}; });
  c.addEventListener('dblclick',e=>{ const [sx,sy]=pos(e); const nz=clamp(map.z*2,minZoom(),8*devicePixelRatio); const k=nz/map.z; map.x=sx-(sx-map.x)*k; map.y=sy-(sy-map.y)*k; map.z=nz; clampMap(); drawMap(); });
  $('mz-in').onclick=()=>mapZoomBy(1.6); $('mz-out').onclick=()=>mapZoomBy(1/1.6); $('mz-fit').onclick=()=>mapFit();
  window.addEventListener('mousemove',e=>{ if(map.drag){ const d=map.drag; if(!d.moved && Math.hypot(e.clientX-d.x0,e.clientY-d.y0)>6) d.moved=true; if(d.moved){ map.x+=(e.clientX-d.x)*devicePixelRatio; map.y+=(e.clientY-d.y)*devicePixelRatio; clampMap(); drawMap(); } d.x=e.clientX; d.y=e.clientY; return; } if(e.target!==c) return; const [sx,sy]=pos(e); const hb=nearestBW(sx,sy); const h=hb?null:nearestSeg(sx,sy); if(h!==map.hover||hb!==map.hoverBW){ map.hover=h; map.hoverBW=hb; const dz=h?designable(h):null; c.style.cursor=typeof mapCursor==='function'?mapCursor(h,hb):h?(dz.ok?'pointer':'not-allowed'):hb?'pointer':'crosshair'; drawMap();
      const tip=$('maptip'); const pre=(typeof propOf==='function'&&h&&dz.ok&&map.mode==='add')?(propOf(h.i)?'<span style="color:#FCA5A5">− remove</span> · ':'<span style="color:#F0ABFC">+ add</span> · '):'';   // v3: what a click does
      if(h&&!dz.ok){ tip.innerHTML='<b>'+titleCase(h.n)+' · not available for a bike lane</b>'+dz.reason; tip.classList.add('show'); }
      else if(h&&h.bw){ const cs=designCase(h); tip.innerHTML='<b>'+pre+titleCase(h.n)+' · '+cs.label+'</b>Existing: '+cs.existing+(cs.when?' · '+cs.when:''); tip.classList.add('show'); }   // v2: the case for blocks that already have a facility
      else if(h&&pre){ tip.innerHTML='<b>'+pre+titleCase(h.n)+'</b>'+h.u+' · '+h.len+' m'; tip.classList.add('show'); }
      else if(hb){ tip.innerHTML='<b>'+bwTitle(hb)+'</b>'+bwDesc(hb)+(hb.a?' · All Ages and Abilities (AAA) network':'')+' · click for details'; tip.classList.add('show'); }   // v2: a bikeway feature with no street block under it
      else tip.classList.remove('show'); }
    if((map.hover||map.hoverBW)&&$('maptip').classList.contains('show')){ const tip=$('maptip'); const r=c.getBoundingClientRect(); const x=e.clientX-r.left+14, y=e.clientY-r.top+16; tip.style.left=Math.min(x, c.clientWidth-tip.offsetWidth-8)+'px'; tip.style.top=Math.min(y, c.clientHeight-tip.offsetHeight-8)+'px'; } });
  window.addEventListener('mouseup',e=>{ if(map.drag&&!map.drag.moved&&$('screen-map').classList.contains('active')){ const r=c.getBoundingClientRect(); const inside=e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom; if(inside&&(e.target===c||e.target===document.body||e.target===document.documentElement)){ const [sx,sy]=pos(e); const b=nearestBW(sx,sy), s=nearestSeg(sx,sy); if(typeof mapClick==='function'&&mapClick(b,s)) {} else if(b) selectBW(b); else if(s) selectSeg(s); } } map.drag=null; });   // v3: add / route modes take the click first
  window.addEventListener('resize',()=>{ if($('screen-map').classList.contains('active')) { mapResize(); clampMap(); drawMap(); } });
  // the map pane can change size without a window resize (side panels, embedded browsers): follow the element itself
  if (window.ResizeObserver) new ResizeObserver(()=>{ if($('screen-map').classList.contains('active') && (c.width!==c.clientWidth*devicePixelRatio || c.height!==c.clientHeight*devicePixelRatio)) { mapResize(); clampMap(); drawMap(); } }).observe($('screen-map'));
})();
function zoomTo(s){ const xs=s.g.map(p=>p[0]),ys=s.g.map(p=>p[1]); const cx=(Math.min(...xs)+Math.max(...xs))/2, cy=(Math.min(...ys)+Math.max(...ys))/2; map.z=0.9*devicePixelRatio; map.x=map.c.width/2-cx*map.z; map.y=map.c.height/2+cy*map.z; clampMap(); drawMap(); }
// v2: a bikeway feature's own card (seawall, greenways, and any facility clicked away from a street block)
function bwTitle(b){ return b.r ? b.r+(b.n&&b.n!=='Off Street'&&b.n.toUpperCase()!==b.r.toUpperCase()?' · '+titleCase(b.n):'') : titleCase(b.n||'Bikeway'); }
function bwDesc(b){ return facilityDesc({t:b.t, sub:b.sub, dir:b.d}); }
function selectBW(b){ map.selBW=b; map.sel=null; drawMap(); const blk=blockOfBW(b); const off=b.sub==='OSS'||b.sub==='OSB'||b.st==='Off-street';
  $('c-title').textContent=bwTitle(b); $('c-sub').textContent=`${b.t}${b.a?' · All Ages and Abilities (AAA) network':''} · ${b.len} m piece`;
  const mode=off?'offstreet':blk?designCase(blk).mode:'review';
  $('c-case').innerHTML=`<span class="case ${mode}">${off?'Off-street path':blk?designCase(blk).label:'Existing facility'}</span><div class="casewhy">${off?'Runs off the roadway ('+(b.st||'off-street').toLowerCase()+'); there is no street cross-section to redesign, so this card is information only.':blk?'Runs along '+titleCase(blk.n)+' — open that block to design.':'No street block in the data lies under this piece; information only.'}</div>`;
  const dir=b.d==='Bidirectional'?'two-way':b.d==='2W'?'both directions':b.d==='OW'?'one-way':b.d==='CFlow'?'contra-flow':b.d||'—';
  $('c-kv').innerHTML=[['Facility',bwDesc(b)],['Direction',dir],['All Ages and Abilities (AAA)',b.a?'on the network'+(b.seg?', AAA segment':''):(b.seg?'AAA segment, not on the network':'no')],['Built / upgraded',(b.yr||'—')+(b.up?' / '+b.up:'')],['Surface',b.surf||'—'],['Snow clearing',b.snow?'yes':'no'],['Speed limit',b.spd?b.spd+' km/h':'—'],['Bound types',[b.wn?'W/N: '+b.wn:null,b.es?'E/S: '+b.es:null].filter(Boolean).join(' · ')||'—']].map(([k,v])=>`<div><b>${k}</b><span>${v}</span></div>`).join('');
  $('c-ctx').innerHTML=(b.note?`<div class="msg" style="background:#F1F5F9;color:var(--ink2)">Layer note: “${b.note}”</div>`:'')+(b.sub&&SUBTYPE[b.sub]?`<div class="msg info" style="margin-top:4px">Subtype ${b.sub}: ${SUBTYPE[b.sub]}</div>`:'');
  const btn=$('c-design'); btn.disabled=!blk; btn.textContent=blk?'Go to '+titleCase(blk.n)+' →':(off?'Off-street path — no roadway design':'No street block under this piece');
  $('c-prop').style.display='none'; $('c-blocks').style.display='none'; $('c-design1').style.display='none'; $('c-close').style.display=''; $('c-design').onclick=defaultDesignClick; $('stats').classList.remove('show'); $('card').classList.add('show'); }
function selectSeg(s){ map.sel=s; map.selBW=null; if(map.z<0.5*devicePixelRatio) zoomTo(s); drawMap(); const ctx=segContext(s); $('c-title').textContent=titleCase(s.n); $('c-sub').textContent=`${s.u} · ${s.len} m block · ${s.spd} km/h`;
  // v2: the existing facility decoded, and the design case it leads to
  const cs=designCase(s); const bw=s.bw? cs.existing : 'None';
  $('c-case').innerHTML = `<span class="case ${cs.mode}">${cs.label}</span><div class="casewhy">${cs.why}${cs.when||cs.flags.length?'<br><small>'+[cs.when,...cs.flags].filter(Boolean).join(' · ')+'</small>':''}${cs.note?'<br><small>Layer note: “'+cs.note+'”</small>':''}</div>`;
  $('c-kv').innerHTML=[['Right-of-way',s.row+' m'],['Curb-to-curb (estimated)',s.ctc+' m'],['Existing facility',bw],['Parking meters',(ctx.pm.L+ctx.pm.R)+' ('+ctx.lbl[0]+' '+ctx.pm.L+' / '+ctx.lbl[1]+' '+ctx.pm.R+')'],['Trees',['L','R'].map(sd=>ctx.tr[sd]?ctx.tr[sd].n:0).reduce((a,b)=>a+b)+' on block'],['Laneways',((ctx.ln.L||[]).length+(ctx.ln.R||[]).length)+' openings']].map(([k,v])=>`<div><b>${k}</b><span>${v}</span></div>`).join('');
  const ends=(s.cn||[]).map((e,i)=>e.map(c=>`${c.same?'continues as':'meets'} <b>${c.name}</b> (${c.t.toLowerCase()}${c.dir==='Bidirectional'?', two-way':''}) at ${i?'far':'near'} end`)).flat();
  endInfo(s).forEach((e,i)=>{ (e.under||[]).forEach(o=>ends.push(`<b>${titleCase(o.s)}</b> passes beneath the structure at the ${i?'far':'near'} end (no junction)`)); (e.over||[]).forEach(o=>ends.push(`<b>${titleCase(o.s)}</b> passes overhead at the ${i?'far':'near'} end (no junction)`)); });
  endInfo(s).forEach((e,i)=>{ if(e.type==='path') ends.push(`street ends${e.loop?' in a turnaround loop':''} at ${i?'far':'near'} end; continues on <b>${e.path.n||('a public '+(e.path.des?'cycleway':'path'))}</b> (off-street path connection, ${e.path.src==='OSM'?'OpenStreetMap':'City data'})`); });   // v2
  $('c-ctx').innerHTML = (ends.length? ends.map(t=>`<div class="msg info" style="margin:4px 0">${t}</div>`).join('') : '<div class="msg" style="background:#F1F5F9;color:var(--ink2)">No bikeway touches this block — the design will start a new link.</div>') + `<div class="msg ${ctx.dirMode==='free'?'ok':'warn'}" style="margin-top:4px"><b>Bike lane direction:</b>&nbsp;${ctx.dirMode==='two'?'must be two-way':ctx.dirMode==='one'?'must be one-way each side':'free choice'} — ${ctx.dirWhy}</div>`;
  const flags=[]; if(lvlOf(s)>0) flags.push('on a bridge deck / viaduct (OpenStreetMap layer '+lvlOf(s)+')'); if(s.rowFix) flags.push('right-of-way taken from the adjoining blocks (dataset gave '+s.rowOrig+' m)'); if(s.bus) flags.push('bus route'); if(s.truck) flags.push('truck route'); if(s.ow) flags.push(owText(s,(s.osm&&s.osm.owd)||0)); if(s.osm&&s.osm.ln) flags.push(s.osm.ln+' lanes (OSM)'); (s.ix||[]).forEach((e,i)=>{ if(e&&e.sig) flags.push('signal at '+(i?'far':'near')+' end ('+e.sig.toLowerCase()+')'); }); if(s.bst) flags.push(((s.bst.L||[]).length+(s.bst.R||[]).length)+' bus stops'); if(s.rk) flags.push((s.rk.L+s.rk.R)+' bike racks');
  if (flags.length) $('c-ctx').insertAdjacentHTML('beforeend','<div class="msg" style="background:#F1F5F9;color:var(--ink2);margin-top:4px">'+flags.join(' · ')+'</div>');
  // blocks that cannot take a design keep their card (so the reason is legible) but the design button is off
  const dz=designable(s); const btn=$('c-design'); btn.disabled=!dz.ok; btn.textContent=dz.ok?cs.button:'Not available for a bike lane design';
  if(!dz.ok) $('c-ctx').insertAdjacentHTML('beforeend','<div class="why"><b>Why not:</b> '+dz.reason+'</div>');
  if(typeof renderCardProp==='function') renderCardProp(s);   // v3: add to / remove from the proposal
  $('c-design1').style.display='none'; $('c-close').style.display=dz.ok?'none':'';   // v3: a card with the design button stays until another selection
  $('stats').classList.remove('show'); $('card').classList.add('show'); }
function titleCase(s){ return s.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()).replace(/\bAv\b/,'Ave').replace(/\bSt\b/,'St'); }
$('c-close').onclick=()=>{ $('card').classList.remove('show'); map.sel=null; map.selBW=null; drawMap(); if(typeof activeProp==='function'&&activeProp()&&Object.keys(activeProp().blocks).length) showPropCard(activeProp()); };   // v3: the proposal card comes back — it is never closed away
// search
const qi=$('q'), ac=$('ac'); let acIdx=-1;
qi.addEventListener('input',()=>{ const v=qi.value.trim().toUpperCase(); if(v.length<2){ac.classList.remove('show');return;} const hits=SEGS.filter(s=>s.n.includes(v)).slice(0,14); if(!hits.length){ac.classList.remove('show');return;} ac.innerHTML=hits.map((s,i)=>{ const dz=designable(s); return `<div data-i="${s.i}" class="${dz.ok?'':'off'}">${titleCase(s.n)}<span>${dz.ok?(s.u+' · '+designCase(s).label):'not available · '+dz.reason.split(':')[0]}</span></div>`; }).join(''); ac.classList.add('show'); acIdx=-1; });
ac.addEventListener('click',e=>{ const d=e.target.closest('div[data-i]'); if(!d) return; const s=SEGS[+d.dataset.i]; ac.classList.remove('show'); qi.value=titleCase(s.n); showMap(); zoomTo(s); selectSeg(s); });
qi.addEventListener('keydown',e=>{ const items=ac.querySelectorAll('div[data-i]'); if(e.key==='ArrowDown'){acIdx=Math.min(acIdx+1,items.length-1);} else if(e.key==='ArrowUp'){acIdx=Math.max(acIdx-1,0);} else if(e.key==='Enter'&&acIdx>=0){ items[acIdx].click(); return; } else if(e.key==='Escape'){ac.classList.remove('show');return;} items.forEach((el,i)=>el.classList.toggle('sel',i===acIdx)); });
document.addEventListener('click',e=>{ if(!e.target.closest('.search')) ac.classList.remove('show'); });
