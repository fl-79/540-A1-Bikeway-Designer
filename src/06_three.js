// ═══════════════════════════════════════════════════════════════════════════
// 3D — Three.js, all objects closed solids; orthographic isometric + orbit
// ═══════════════════════════════════════════════════════════════════════════
const T3 = { renderer:null, scene:null, cam:null, groups:{}, movers:[], labels:[], az:-Math.PI/4, el:Math.atan(1/Math.sqrt(2)), dist:400, zoom:0.7, target:null,   /* v3: the default view takes in the block and its neighbours (0.7), not the block alone */ raf:null, animating:false, last:0, extent:{w:40,len:100} };
const MAT = (c,o={}) => new THREE.MeshLambertMaterial({color:c, ...o});
// crisp edges on building volumes so massing stays legible at any zoom
// v3 illustration style: the line carries the form. Buildings get a dark edge (the proposal's neighbours a little heavier than
// the rest of the city); rounded things (figures, wheels, canopies) get an inverted-hull outline (hull); curb lines read as lines
const EDGE  = new THREE.LineBasicMaterial({color:0x3f4650, transparent:true, opacity:0.9});
const EDGE2 = new THREE.LineBasicMaterial({color:0x4b5563, transparent:true, opacity:0.6});
function outline(mesh, g, mat){ const e=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 15), mat||EDGE);
  e.position.copy(mesh.position); e.rotation.copy(mesh.rotation); e.scale.copy(mesh.scale); g.add(e); return e; }
const HULL=new THREE.MeshBasicMaterial({color:0x2b3340, side:THREE.BackSide});
function hull(m,g,k){ const h=new THREE.Mesh(m.geometry,HULL); h.position.copy(m.position); h.rotation.copy(m.rotation); h.scale.copy(m.scale).multiplyScalar(k||1.07); (g||m.parent).add(h); return h; }
function tube(g,a,b,r,mat){ const d=new THREE.Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]); const L=d.length()||0.01; const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,L,8),mat); m.position.set((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2); m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()); g.add(m); return m; }
const JOINT=new THREE.LineBasicMaterial({color:0x8d8f8a, transparent:true, opacity:0.3});   // paver joints on the proposal's sidewalks
// one pavement grey for the block and its surroundings (as in the plan), so junctions and continuations have no colour seam
// v3: the bike lane green is the plan's (rgba(96,150,110,.45) over the #A9ABA9 pavement = #88A28E), so the two views match
const M = { asphalt:MAT(0x6e737a), bike:MAT(0x88a28e), bikeX:MAT(0x9bb3a2), sw:MAT(0xe6e2d8), buf:MAT(0xc2cbd1), curb:MAT(0x5f6670), barrier:MAT(0xb8bfc4), park:MAT(0x656a71), grass:MAT(0x9fd08c), yard:MAT(0xd9d6cd), bld:MAT(0xF5F3EE), bldNoH:MAT(0xE4D9C6), glass:MAT(0xa9c4d6), white:MAT(0xffffff), yellow:MAT(0xffd400), amber:MAT(0xf5a623), trunk:MAT(0x8c6a4a), leaf:MAT(0x68be6e), leaf2:MAT(0x4c9e5a), leafF:MAT(0x72c278,{flatShading:true}), leaf2F:MAT(0x56a862,{flatShading:true}), skin:MAT(0xf2c9a8), dark:MAT(0x2a3242), red:MAT(0xd9322b), post:MAT(0xffffff), ctxSw:MAT(0xE9E7E1), ctxRd:MAT(0x9fa4a9), ctxBk:MAT(0x8F9693), steel:MAT(0x3a424e), signal:MAT(0x2f3b45) };
const PEOPLE=[0xe8574b,0x3f6fb5,0x2fa6a0,0xe9b23a,0x8c5fb5].map(c=>MAT(c)); const CARS=[0xf2f3f4,0xdce1e6,0xc9d0d6,0xeef0f2].map(c=>MAT(c));
// the existing streets use the same materials as the proposal, faded toward white, so the block reads as the one thing in full tone
const lighten=(hex,t)=>{ const f=v=>Math.round(v+(255-v)*t); return (f((hex>>16)&255)<<16)|(f((hex>>8)&255)<<8)|f(hex&255); };
const FADE=0.3;   // existing streets: same asphalt, lighter; the proposal is the full tone (v3: a little more fade, the context recedes)
M.ctxRd=MAT(lighten(0x6e737a,FADE)); M.ctxSw=MAT(lighten(0xe6e2d8,FADE)); M.ctxCurb=MAT(0x8e949b); M.ctxBuf=MAT(lighten(0xc2cbd1,FADE)); M.ctxPost=MAT(lighten(0x3a424e,FADE));   /* the context curb stays a visible line */
M.ctxTrunk=MAT(lighten(0x8c6a4a,FADE)); M.ctxLeaf=MAT(lighten(0x72c278,FADE),{flatShading:true});
// Vertical datum shared by everything in 3D. Steps between stacked surfaces are ≥ 3 cm so a 16-bit depth buffer cannot
// make them flicker: ground plate 0 · pavement top +0.03 · markings +0.06 · curb / sidewalk top +0.18.
// The block's own pavement is also at +0.03 (its group is lifted so its element tops land there), so there is no level
// change where the proposal meets the existing street, and its markings sit ~2.5 cm above its pavement.
const Y={ground:0, road:0.03, walk:0.18, mark:0.06, block:0.05};   // block: lanes top at −0.01+0.05 = +0.04, 1 cm above the context pavement (+0.03) so the two never share a plane where a cross street's pavement runs on under the block's lanes (v3: that flicker was the "striped triangle"); sidewalk/buffer boxes (h .15) top at +0.17, 1 cm under the context curbs (+0.18)
// flat pavement markings are merged into one mesh per colour (thousands of dashes would otherwise be thousands of draw calls)
const MQ = { white:MAT(0xffffff,{side:THREE.DoubleSide}), yellow:MAT(0xffd400,{side:THREE.DoubleSide}), bike:MAT(0x88a28e,{side:THREE.DoubleSide}), paint:MAT(0x9fc4aa,{side:THREE.DoubleSide}), shared:MAT(0x7f9a86,{side:THREE.DoubleSide}) };
// faded versions for the existing streets (lighten() is defined below MAT, so these are filled in lazily)
const MQC = {};
function mqc(k){ if(!MQC[k]) MQC[k]=MAT(lighten(MQ[k].color.getHex(),0.3),{side:THREE.DoubleSide}); return MQC[k]; }
function Quads(mat){ this.p=[]; this.mat=mat; }
Quads.prototype.seg=function(ax,az,bx,bz,w,yf){ const dx=bx-ax, dz=bz-az, L=Math.hypot(dx,dz)||1; const nx=-dz/L*w/2, nz=dx/L*w/2; const y=(x,z)=>typeof yf==='function'?yf(x,z):yf;
  const c=[[ax+nx,az+nz],[bx+nx,bz+nz],[bx-nx,bz-nz],[ax-nx,az-nz]]; [[0,1,2],[0,2,3]].forEach(t=>t.forEach(k=>this.p.push(c[k][0],y(c[k][0],c[k][1]),c[k][1]))); };
Quads.prototype.rect=function(x0,z0,x1,z1,yf){ this.seg((x0+x1)/2,z0,(x0+x1)/2,z1,Math.abs(x1-x0),yf); };
Quads.prototype.quad=function(a,b,c,d,yf){ const y=(x,z)=>typeof yf==='function'?yf(x,z):yf; [[a,b,c],[a,c,d]].forEach(t=>t.forEach(p=>this.p.push(p[0],y(p[0],p[1]),p[1]))); };   // v3: any four corners (a taper)
Quads.prototype.line=function(g,w,yf,dash){ for(let i=1;i<g.length;i++){ const [ax,az]=g[i-1],[bx,bz]=g[i]; const L=Math.hypot(bx-ax,bz-az); if(L<0.05) continue; if(!dash){ this.seg(ax,az,bx,bz,w,yf); continue; }
  const ux=(bx-ax)/L, uz=(bz-az)/L; for(let t=0;t<L;t+=dash[0]+dash[1]){ const t1=Math.min(L,t+dash[0]); this.seg(ax+ux*t,az+uz*t,ax+ux*t1,az+uz*t1,w,yf); } } };
Quads.prototype.mesh=function(g){ if(!this.p.length) return null; const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(this.p,3)); const n=new Float32Array(this.p.length); for(let i=1;i<n.length;i+=3) n[i]=1; geo.setAttribute('normal',new THREE.BufferAttribute(n,3)); const m=new THREE.Mesh(geo,this.mat); m.receiveShadow=true; g.add(m); return m; };
// text label as a billboard sprite; kept at constant screen size by updateCam (T3.labels)
function label3(g, lines, x, y, z, opts={}){ const fs=opts.fs||12, pad=6, lh=fs*1.3; const cv=document.createElement('canvas'); const c2=cv.getContext('2d');
  // wrap long detail lines at their ' · ' separators so a label stays a compact card
  lines=lines.flatMap((l,i)=>{ if(i===0||l.length<=(opts.wrap||44)) return [l]; const out=[]; let cur=''; l.split(' · ').forEach(p=>{ if(cur && (cur+' · '+p).length>(opts.wrap||44)){ out.push(cur); cur=p; } else cur=cur?cur+' · '+p:p; }); if(cur) out.push(cur); return out; });
  const fonts=lines.map((l,i)=>`${i===0?600:400} ${i===0?fs:fs*.9}px Inter, sans-serif`); let w=0; lines.forEach((l,i)=>{ c2.font=fonts[i]; w=Math.max(w,c2.measureText(l).width); }); w+=pad*2; const h=lines.length*lh+pad*2-lh*.25;
  const k=2; cv.width=Math.ceil(w*k); cv.height=Math.ceil(h*k); c2.scale(k,k);
  c2.fillStyle=opts.bg||'rgba(255,255,255,.9)'; c2.beginPath(); c2.moveTo(4,0); c2.arcTo(w,0,w,h,4); c2.arcTo(w,h,0,h,4); c2.arcTo(0,h,0,0,4); c2.arcTo(0,0,w,0,4); c2.closePath(); c2.fill();
  if(opts.edge){ c2.strokeStyle=opts.edge; c2.lineWidth=1; c2.stroke(); }
  lines.forEach((l,i)=>{ c2.font=fonts[i]; c2.fillStyle=i===0?(opts.col||'#0F172A'):'#475467'; c2.textBaseline='top'; c2.fillText(l,pad,pad+i*lh); });
  const tex=new THREE.CanvasTexture(cv); tex.minFilter=THREE.LinearFilter; const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false})); sp.position.set(x,y,z); sp.center.set(0.5,0); sp.renderOrder=20; g.add(sp);
  T3.labels.push({sp,w,h}); return sp; }
function scaleLabels(){ const c=$('c3d'); const H=c.clientHeight||1; const k=(T3.cam.top-T3.cam.bottom)/H; T3.labels.forEach(l=>l.sp.scale.set(l.w*k,l.h*k,1)); }
function box(w,h,d,mat,x,y,z,g){ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat); m.position.set(x+w/2,y+h/2,z+d/2); m.castShadow=m.receiveShadow=true; g.add(m); return m; }
function cyl(r,h,mat,x,y,z,g,rt){ const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,rt||14),mat); m.position.set(x,y+h/2,z); m.castShadow=true; g.add(m); return m; }
function sph(r,mat,x,y,z,g){ const m=new THREE.Mesh(new THREE.SphereGeometry(r,12,10),mat); m.position.set(x,y,z); m.castShadow=true; g.add(m); return m; }

function init3D(){ if(T3.renderer) return; const c=$('c3d'); T3.renderer=new THREE.WebGLRenderer({canvas:c,antialias:true}); T3.renderer.setPixelRatio(devicePixelRatio); T3.renderer.shadowMap.enabled=true; T3.renderer.shadowMap.type=THREE.PCFSoftShadowMap; T3.renderer.setClearColor(0xfbfbf9,1);
  T3.scene=new THREE.Scene(); T3.scene.fog=new THREE.Fog(0xfbfbf9,500,1400);
  // hemisphere + sun kept near 1.2 total so pale context colours (terrain, sidewalks, water) do not clip to white
  // v3 illustration style: an almost flat light — the hemisphere carries the tone, the sun only adds a light, short shadow
  // (a steep sun from the south-west) so faces read by their outline, not by shade; roof and wall are one tone
  T3.scene.add(new THREE.HemisphereLight(0xffffff,0xeef0f2,0.98)); const sun=new THREE.DirectionalLight(0xffffff,0.22); sun.position.set(-50,170,70); sun.castShadow=true; sun.shadow.mapSize.set(2048,2048); sun.shadow.bias=-0.0008; sun.shadow.normalBias=0.35; sun.shadow.radius=4; const sc=sun.shadow.camera; sc.left=-260; sc.right=260; sc.top=260; sc.bottom=-260; sc.near=1; sc.far=800; T3.scene.add(sun); T3.sun=sun;
  T3.cam=new THREE.OrthographicCamera(-1,1,1,-1,1,1200);   // tight depth range: the model is ≤ 900 m deep from a 400 m camera, and precision matters for the stacked surfaces
  let drag=null; c.addEventListener('mousedown',e=>{drag=[e.clientX,e.clientY];}); window.addEventListener('mousemove',e=>{ if(!drag) return; T3.az-= (e.clientX-drag[0])*0.006; T3.el=clamp(T3.el+(e.clientY-drag[1])*0.005,0.08,1.5); drag=[e.clientX,e.clientY]; updateCam(); render3D(); }); window.addEventListener('mouseup',()=>drag=null);
  c.addEventListener('wheel',e=>{ e.preventDefault(); T3.zoom=clamp(T3.zoom*Math.exp(-e.deltaY*0.0012),0.18,12); updateCam(); render3D(); },{passive:false});   // zoom out far enough to see the whole site plate
  c.addEventListener('dblclick',()=>{ T3.az=-Math.PI/4; T3.el=Math.atan(1/Math.sqrt(2)); T3.zoom=0.7; updateCam(); render3D(); }); }
function updateCam(){ const c=$('c3d'); const W=c.clientWidth,H=c.clientHeight; const halves=(D.before&&!D.only)?2:1; const aspect=(W/halves)/H; const ext=T3.extent; const span=Math.max(ext.len*0.75, ext.w*1.6)/T3.zoom; T3.cam.left=-span*aspect/2; T3.cam.right=span*aspect/2; T3.cam.top=span/2; T3.cam.bottom=-span/2; T3.cam.updateProjectionMatrix();
  const t=T3.target; T3.cam.position.set(t.x+T3.dist*Math.cos(T3.el)*Math.sin(T3.az), t.y+T3.dist*Math.sin(T3.el), t.z+T3.dist*Math.cos(T3.el)*Math.cos(T3.az)); T3.cam.lookAt(t); scaleLabels(); }
// v3: the pixel scale is re-read on every draw. It changes when the browser is zoomed (Ctrl +/−) or the window moves to a screen
// with a different display scaling; set only once at start, the drawing buffer stopped matching the canvas, the two panes were
// drawn at the wrong widths and the strip between them was left undrawn (a black bar). The viewports now use the buffer's real
// size, and the whole canvas is cleared to the background first, so a gap can never show black.
function render3D(){ const r=T3.renderer, c=$('c3d'); const dpr=devicePixelRatio||1; if(r.getPixelRatio()!==dpr) r.setPixelRatio(dpr);
  if(c.width!==Math.floor(c.clientWidth*dpr)||c.height!==Math.floor(c.clientHeight*dpr)){ r.setSize(c.clientWidth,c.clientHeight,false); }
  const W=c.width, H=c.height;
  r.setScissorTest(false); r.setViewport(0,0,W,H); r.clear(); r.setScissorTest(true);
  const pc=T3.propCtx;   // v3: the proposal's other blocks show in the proposed view only
  if (D.before&&!D.only) { const cr=c.getBoundingClientRect(), pb=$('p3d-b').getBoundingClientRect(), pa=$('p3d-a').getBoundingClientRect(); const dpr=devicePixelRatio; const wb=Math.round((pb.right-cr.left)*dpr), xa=Math.round((pa.left-cr.left)*dpr);   // the panes' own widths (draggable divider)
    T3.groups.after.visible=false; T3.groups.before.visible=true; if(pc) pc.visible=false; r.setViewport(0,0,wb,H); r.setScissor(0,0,wb,H); r.render(T3.scene,T3.cam);
    T3.groups.before.visible=false; T3.groups.after.visible=true; if(pc) pc.visible=true; r.setViewport(xa,0,W-xa,H); r.setScissor(xa,0,W-xa,H); r.render(T3.scene,T3.cam); }
  else { const bf=D.only==='before'; T3.groups.before.visible=bf; T3.groups.after.visible=!bf; if(pc) pc.visible=!bf; r.setViewport(0,0,W,H); r.setScissor(0,0,W,H); r.render(T3.scene,T3.cam); } }   // v3: step 1 — the existing street alone, full width

function build3D(){ init3D(); const o=curOpt(); if(!o) return; ['before','after'].forEach(k=>{ if(T3.groups[k]) T3.scene.remove(T3.groups[k]); }); T3.movers=[]; T3.labels=[];
  TZ0 = elevAt(o && D.ctx ? D.ctx.seg.g[0][0] : 0, D.ctx.seg.g[0][1]);
  if (T3.groups.city) T3.scene.remove(T3.groups.city);
  T3.groups.city = D.city ? buildCity() : new THREE.Group(); T3.scene.add(T3.groups.city);
  T3.groups.before=buildStreet(D.beforeEls,true); T3.groups.after=buildStreet(o.els,false); T3.scene.add(T3.groups.before, T3.groups.after);
  // v3: the review — every other designed block of the proposal built in full (its own cross-section, cars, posts, trees) in its own
  // frame and placed into this block's frame, so the whole proposal reads as designed streets
  if(T3.groups.others){ T3.scene.remove(T3.groups.others); T3.groups.others=null; }
  if(D.mode==='review'&&typeof reviewBlocks==='function'){ const og=new THREE.Group(); const F=sceneCtx(o.els).C.F; const save=D.ctx; T3.other=true;
    reviewBlocks().forEach(({s,rec})=>{ try{ if(rec.x&&'fac' in rec.x&&typeof setUserFacility==='function') setUserFacility(s,rec.x.fac); D.ctx=applyOverrides(segContext(s),rec.x); const els=cloneJ(rec.opt.els); layout(els); const gr=buildStreet(els,false); gr.position.y=Y.block;
        const FB=localFrame(s); const p0=F.toLocal(...FB.toWorld(0,0)), p1=F.toLocal(...FB.toWorld(0,10)); const w=new THREE.Group(); w.add(gr); w.position.set(p0[0],0,p0[1]); w.rotation.y=Math.atan2(p1[0]-p0[0],p1[1]-p0[1]); og.add(w); }catch(e){ console.warn('review block', s&&s.n, e); } });
    T3.other=false; D.ctx=save; CTX_CACHE.id=null; T3.groups.others=og; T3.scene.add(og); }
  // v2: a block on a structure rides the existing surface: it starts at its near-end deck height and runs as one grade to the far
  // end (a ramp block slopes), a hair above the context deck it may share — no step where it meets the decks around it
  const S_=sceneCtx(o.els); const [h0,h1]=S_.prof||[0,0]; const slope=(h1-h0)/S_.LEN;
  [T3.groups.before,T3.groups.after].forEach(gr=>{ gr.rotation.x = (TOPO_OFF ? 0 : -Math.atan(D.ctx.grade)) - Math.atan(slope); gr.position.y = Y.block + h0 + ((h0||h1)?0.03:0); });
  T3.extent={w:S_.sceneXR-S_.sceneXL, len:S_.LEN}; T3.target=new THREE.Vector3(0,0,S_.LEN/2);
  if(D.mode==='review'&&D.reviewBox){ const b=D.reviewBox; T3.target=new THREE.Vector3(b.cx,0,b.cz); T3.zoom=clamp(Math.max(T3.extent.len*0.75,T3.extent.w*1.6)/(b.size*1.1),0.18,12); }   // frame the whole proposal (its footprint, not the scene objects)
  T3.sun.target.position.copy(T3.target); T3.sun.target.updateMatrixWorld(); updateCam(); render3D(); }

// city-wide context around the block: land, surrounding streets, buildings, existing bikeways (block's local frame)
let TZ0=0;
// The context is a square site model: HALF metres each way from the block centre, with a visible slab edge. Everything
// (streets, markings, bikeways, buildings, water) is clipped to that square so the model has one clear boundary.
// plate half-size: always contains the block, grows gently for long merged blocks
function buildCity(){ const g=new THREE.Group(); const c=D.ctx; const LEN=c.seg.len; const HALF=Math.max(320, LEN*0.6+80, D.plateHalf||0); /* v3: the review plate spans the whole proposal */ const R=HALF*1.5; const C=cityContext(c.seg, R); const S_=sceneCtx(curOpt().els);
  const F=C.F, ez=(lx,lz)=>{ const [wx,wy]=F.toWorld(lx,lz); return elevAt(wx,wy)-TZ0; };
  const BOX={x0:-HALF, x1:HALF, z0:LEN/2-HALF, z1:LEN/2+HALF}; const inBox=(x,z)=>x>=BOX.x0&&x<=BOX.x1&&z>=BOX.z0&&z<=BOX.z1;
  // ── ground: a flat plate (topography off), cut along the shoreline polygon; off-land vertices drop below the water
  const N=96, span=HALF*2; const geo=new THREE.PlaneGeometry(span,span,N,N); const pos=geo.attributes.position;
  const land=new Uint8Array(pos.count), zs=new Float32Array(pos.count); let anyWater=false;
  for(let i=0;i<pos.count;i++){ const lx=pos.getX(i), lz=-pos.getY(i)+LEN/2; zs[i]=ez(lx,lz); land[i]=C.onLand(lx,lz)?1:0; if(!land[i]) anyWater=true; }
  let shoreMin=Infinity; if(anyWater){ const W1=N+1; for(let i=0;i<pos.count;i++){ if(!land[i]) continue; const nb=[i-1,i+1,i-W1,i+W1].filter(k=>k>=0&&k<pos.count); if(nb.some(k=>!land[k])) shoreMin=Math.min(shoreMin,zs[i]); } }
  const WATER = isFinite(shoreMin) ? shoreMin-0.6 : -0.6;   // no shoreline in view: nominal level well below the plate so the base slab stays under the ground
  for(let i=0;i<pos.count;i++) pos.setZ(i, land[i] ? zs[i] : Math.min(zs[i], WATER-2.5));
  geo.computeVertexNormals();
  // the plate IS the ground plane: proposal and existing streets both sit directly on it (Y.ground = 0)
  const terr=new THREE.Mesh(geo, MAT(0xE3E6DD)); terr.rotation.x=-Math.PI/2; terr.position.set(0,Y.ground,LEN/2); terr.receiveShadow=true; g.add(terr);
  // site-model base: a slab whose top sits below the water surface, and a rim wall from the slab up to the land plate, so the
  // square has one clear edge and any water reads as a pool inside the rim
  const SLAB_TOP=WATER-0.45;
  const slab=new THREE.Mesh(new THREE.BoxGeometry(span,2.0,span),MAT(0xD3D6CF)); slab.position.set(0,SLAB_TOP-1.0,LEN/2); g.add(slab);
  { const e=[[BOX.x0,BOX.z0],[BOX.x1,BOX.z0],[BOX.x1,BOX.z1],[BOX.x0,BOX.z1]]; const wall=new Float32Array(6*3*4); let o=0; const put=(x,y,z)=>{ wall[o++]=x; wall[o++]=y; wall[o++]=z; };
    for(let k=0;k<4;k++){ const [ax,az]=e[k],[bx,bz]=e[(k+1)%4]; put(ax,SLAB_TOP,az); put(bx,SLAB_TOP,bz); put(bx,Y.ground,bz); put(ax,SLAB_TOP,az); put(bx,Y.ground,bz); put(ax,Y.ground,az); }
    const wg=new THREE.BufferGeometry(); wg.setAttribute('position',new THREE.BufferAttribute(wall,3)); wg.computeVertexNormals(); g.add(new THREE.Mesh(wg,MAT(0xD9DCD5,{side:THREE.DoubleSide})));
    const pts=[]; e.forEach(([x,z])=>pts.push(x,Y.ground+0.01,z)); const lg=new THREE.BufferGeometry(); lg.setAttribute('position',new THREE.Float32BufferAttribute(pts,3)); g.add(new THREE.LineLoop(lg,new THREE.LineBasicMaterial({color:0x6b7280}))); }
  if(anyWater){ // unlit material so the water reads as the same blue as the map, whatever the lighting
    const water=new THREE.Mesh(new THREE.PlaneGeometry(span,span),new THREE.MeshBasicMaterial({color:0xC2DAE6})); water.rotation.x=-Math.PI/2; water.position.set(0,WATER,LEN/2); g.add(water);
    const pts=[]; C.water.forEach(r=>{ for(let i=0;i<r.length;i++){ const a=r[i], b=r[(i+1)%r.length]; clipPoly([a,b],BOX).forEach(p=>{ pts.push(p[0][0],WATER+0.05,p[0][1], p[1][0],WATER+0.05,p[1][1]); }); } });
    if(pts.length){ const lg=new THREE.BufferGeometry(); lg.setAttribute('position',new THREE.Float32BufferAttribute(pts,3)); g.add(new THREE.LineSegments(lg,new THREE.LineBasicMaterial({color:0x5C819A}))); } }
  // ── surrounding streets: sidewalk band, pavement, curb lines, existing lane markings — all clipped to the square, all on the
  //    same datum as the block (Y): pavement top +0.005, curb and sidewalk top +0.15, markings +0.009. `top` is the box's top face.
  // strips follow an optional height function hf(x,z) (bridge decks and their ramps): each piece is tilted to its slope and casts a shadow
  // v2: a street surface is one continuous ribbon along its (smoothed) centreline — top, underside and sides built from the
  // offset edges vertex by vertex — instead of a box per segment, so curves are smooth and a ramp's surface runs into its deck
  // without a break; heights follow hf (bridge decks and ramps) and the ribbon casts a shadow when it is up in the air
  const DS=new Map(); const ds=m=>{ if(!DS.has(m)){ const c=m.clone(); c.side=THREE.DoubleSide; DS.set(m,c); } return DS.get(m); };
  // v3: a ribbon is built from its two edges (ribbonLR), so a merging ramp can be built from its tapered edges; ribbon(pts,w)
  // is the parallel-edged case
  // hIdx (optional): the structure height as a function of the position along the ribbon (0..1) — for a tapered ramp, whose
  // two edges are different lengths, so that both edges take the height of the same point of the centreline and the surface
  // does not twist
  const ribbonLR=(Lp0,Rp0,mat,top,h,hf,yoff,hIdx)=>{ if(Lp0.length<2||Rp0.length<2) return; const n=Math.max(Lp0.length,Rp0.length,2); const Lp=Lp0.length===n?Lp0:resampleLine(Lp0,n), Rp=Rp0.length===n?Rp0:resampleLine(Rp0,n); const yT=(x,z,i)=>ez(x,z)+top+(hIdx?hIdx(i/(n-1)):(hf?hf(x,z):0))+(yoff||0);
    const P=[]; const V=(p,dy,i)=>[p[0],yT(p[0],p[1],i)-(dy||0),p[1]]; const tri=(a,b,c)=>P.push(...a,...b,...c); const quad=(a,b,c,d)=>{ tri(a,b,c); tri(a,c,d); }; let up=false;
    for(let i=1;i<n;i++){ const TL0=V(Lp[i-1],0,i-1),TL1=V(Lp[i],0,i),TR0=V(Rp[i-1],0,i-1),TR1=V(Rp[i],0,i),BL0=V(Lp[i-1],h,i-1),BL1=V(Lp[i],h,i),BR0=V(Rp[i-1],h,i-1),BR1=V(Rp[i],h,i); if(TL0[1]-ez(Lp[i-1][0],Lp[i-1][1])>0.6) up=true;
      quad(TL0,TR0,TR1,TL1); quad(BL0,BL1,BR1,BR0); quad(TL0,TL1,BL1,BL0); quad(TR0,BR0,BR1,TR1); if(i===1) quad(TL0,BL0,BR0,TR0); if(i===n-1) quad(TL1,TR1,BR1,BL1); }
    const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(P,3)); geo.computeVertexNormals(); const m=new THREE.Mesh(geo,ds(mat)); m.receiveShadow=true; if(hf&&up) m.castShadow=true; (ribbon.target||g).add(m); };
  const ribbon=(pts,w,mat,top,h,hf,yoff)=>{ if(pts.length<2) return; ribbonLR(offsetLine(pts,-w/2),offsetLine(pts,w/2),mat,top,h,hf,yoff); };
  // v3: a surface is cut exactly at the site plate's edge: both of its edges are clipped to the plate (clipping the centreline
  // alone left a lip of half the width hanging past the edge wherever a street left the plate at an angle)
  const clipLR=(L,R)=>{ const Lc=clipPoly(L,BOX), Rc=clipPoly(R,BOX); return Lc.length===Rc.length ? Lc.map((l,i)=>[l,Rc[i]]) : null; };
  const strip=(pts,w,mat,top,h,hf,yoff)=>{ const pr=clipLR(offsetLine(pts,-w/2),offsetLine(pts,w/2)); if(pr){ pr.forEach(([l,r])=>ribbonLR(l,r,mat,top,h,hf,yoff)); return; } clipPoly(pts,BOX).forEach(p=>ribbon(p,w,mat,top,h,hf,yoff)); };
  const deckAt=deckAtSt;
  // decks that share a surface (the bridge and its ramps, or the deck under the block) are co-planar: the narrower one sits a few
  // millimetres higher so the two surfaces never flicker through each other
  // v3: one height field for every structure at a level. Where pieces overlap (a ramp's gore inside its deck, two ramps meeting
  // at one deck, a divided deck's two carriageways) each vertex takes the height of the highest piece that contains it at
  // that level, so overlapping surfaces are exactly coplanar and read as one slab — no micro-offsets, no steps, no twist.
  const upList=C.streets.filter(st=>st.deck&&!st.host2); upList.forEach(st=>{ st._yo=0; });
  const HF=(st,x,z)=>{ let h=deckAt(st,x,z); upList.forEach(o=>{ if(o===st||!o.E||!o.E.ring) return; if(!pointInRing(x,z,o.E.ring)) return; const ho=deckAt(o,x,z); if(Math.abs(ho-h)<0.5&&ho>h) h=ho; }); return h; };   // within half a metre only: a ramp already falling away beside its deck keeps its own grade (a wider tolerance twisted its inner edge up to the deck)
  const deckMk=[];   // v3: marking runs of every structure piece, joined and drawn after the loop
  const HFany=(x,z)=>{ let h=0; upList.forEach(o=>{ const inside=o.E&&o.E.ring?pointInRing(x,z,o.E.ring):nearOnPoly([x,z],o.g)[0]<o.m.ctc/2+1; if(inside) h=Math.max(h,deckAt(o,x,z)); }); return h; };
  const MP={path:MAT(0xE9E5DC), des:MAT(0xDCE5D6), island:MAT(0xCAD4B8), plaza:MAT(0xECE8E0), pier:MAT(0xB9BBBD)};
  const inR=pts=>pts.some(([x,z])=>inBox(x,z));
  const Q={white:new Quads(mqc('white')), yellow:new Quads(mqc('yellow')), bike:new Quads(mqc('bike')), paint:new Quads(mqc('paint')), shared:new Quads(mqc('shared'))}; const yRoad=(x,z)=>ez(x,z)+Y.mark;
  // sidewalk band and curbs stop at the crossing street's curb line; the pavement runs on to its far curb → clean rectangular junctions
  // v3: the deck that carries the block: its markings run straight through the block, silenced only inside the block's bike lanes and buffers
  const BZ=(curOpt()?curOpt().els:[]).filter(e=>e.k==='bike'||e.k==='buf').map(e=>[e.x-0.1,e.x+e.w+0.1]);
  const mkRuns=(st,gg)=>{ if(st!==C.blockHost||!BZ.length) return clipPoly(gg,BOX); const pts=[gg[0],...alongLine(gg,1.5,0.75).map(q=>[q[0],q[1]]),gg[gg.length-1]]; const runs=[]; let run=[]; pts.forEach(p=>{ const inZ=p[1]>0&&p[1]<LEN&&BZ.some(([a,b])=>p[0]>a&&p[0]<b); if(inZ){ if(run.length>1) runs.push(run); run=[]; } else run.push(p); }); if(run.length>1) runs.push(run); return runs.flatMap(r=>clipPoly(r,BOX)); };
  C.streets.forEach(st=>{ if(!inR(st.g)) return; const m=st.m; const band=trimLine(st.g,st.trim[0],st.trim[1]), pav=extendLine(st.g,(st.ext||st.trim)[0],(st.ext||st.trim)[1]);   /* v3: the pavement runs to the crossing street's far curb (ext), the sidewalk strips stop clear of its carriageway (trimLR) */
    // v2: bridges and viaducts stand on their deck (ramping down to grade where they land), cast shadows and sit on piers
    const hf=st.deck?((x,z)=>HF(st,x,z)):null, yM=hf?((x,z)=>ez(x,z)+Y.mark+hf(x,z)):yRoad; st._yM=yM;
    // v3: a structure's markings are collected (dropped inside any other piece at the same height) and drawn joined after the loop
    if(hf){ const emit=(gg,mk)=>mkRuns(st,gg).forEach(p=>deckMk.push({g:p,mk})); const inOtherMk=p=>upList.some(o=>o!==st&&o.E&&o.E.ring&&pointInRing(p[0],p[1],o.E.ring)&&Math.abs(deckAt(o,p[0],p[1])-deckAt(st,p[0],p[1]))<0.6&&o.m.ctc>=st.m.ctc-0.01);
      const dropMk=gg=>{ const pts=[gg[0],...alongLine(gg,1.5,0.75).map(q=>[q[0],q[1]]),gg[gg.length-1]]; const runs=[]; let run=[]; pts.forEach(p=>{ if(inOtherMk(p)){ if(run.length>1) runs.push(run); run=[]; } else run.push(p); }); if(run.length>1) runs.push(run); return runs; };
      st._emitMk=mk=>dropMk(mk.g).forEach(r=>emit(r,mk)); }
    if(st.host2){ streetMarkings(st).forEach(mk=>st._emitMk(mk)); return; }   // v3: a hosted piece rides its deck — markings only, no slab of its own
    if(hf&&st.E){   // v3: every structure piece is one surface from its edges (width tapers, merge tapers); parapets along them, none inside its deck and none at grade
      // v3: no parapet or pier inside ANY other structure piece at the same height — a deck's edge line stops where a ramp joins it
      // at deck level (the merge), a ramp's inside its deck; a piece passing at another level keeps its parapet
      const inDeck=p=>{ const h=deckAt(st,p[0],p[1]); return C.streets.some(o=>o!==st&&o.deck&&!o.host2&&(o.E&&o.E.ring?pointInRing(p[0],p[1],o.E.ring):(o.m.ctc>st.m.ctc+0.5&&nearOnPoly(p,o.g)[0]<o.m.ctc/2-0.3))&&Math.abs(deckAt(o,p[0],p[1])-h)<0.6); };
      const atGrade=p=>deckAt(st,p[0],p[1])<0.5;
      const dropIn=gg=>{ const pts=[gg[0],...alongLine(gg,2,1).map(q=>[q[0],q[1]]),gg[gg.length-1]]; const runs=[]; let run=[]; pts.forEach(p=>{ if(inDeck(p)||atGrade(p)){ if(run.length>1) runs.push(run); run=[]; } else run.push(p); }); if(run.length>1) runs.push(run); return runs; };
      // heights by position along the ramp's (extended) centreline, so both edges of the taper share one height
      // every vertex takes the shared structure height (HF): the ramp's own height outside its deck, the deck's inside it
      (clipLR(st.E.pav.L,st.E.pav.R)||[[st.E.pav.L,st.E.pav.R]]).forEach(([l,r])=>ribbonLR(l,r,M.ctxRd,Y.road,0.8,hf));   /* v3: cut at the plate edge */
      ['L','R'].forEach(sd=>{ const a=st.E.pav[sd], b=st.E.band[sd]; const n=Math.max(a.length,b.length); const A=resampleLine(a,n), B=resampleLine(b,n);
        // the parapet strip between the pavement edge and the band edge, only outside the deck
        const mid=A.map((p,i)=>[(p[0]+B[i][0])/2,(p[1]+B[i][1])/2]); dropIn(mid).forEach(run=>{ const w=Math.max(0.5,Math.hypot(B[0][0]-A[0][0],B[0][1]-A[0][1])); strip(run,w,M.ctxSw,Y.walk,0.6,hf); }); });
      alongLine(st.g,24,12).forEach(([x,z])=>{ const h=hf(x,z); if(h<2.5||!inBox(x,z)||inDeck([x,z])) return; cyl(0.55,Math.max(0.5,h-0.8),MP.pier,x,ez(x,z),z,g,12); });
      streetMarkings(st).forEach(mk=>{ if(hf){ st._emitMk(mk); return; } mkRuns(st,mk.g).forEach(p=>(mk.kind==='centre'?Q.yellow:Q.white).line(p, mk.kind==='park'?0.08:mk.w, yM, mk.dash)); });
      st.E.pav.merges.forEach(m=>clipPoly(m.line,BOX).forEach(p=>deckMk.push({g:p,mk:{kind:'lane',w:0.12,dash:[2,3.5]}})));   // the gore lane line, on the deck
      return; }
    // sidewalk zones as two strips (curb line → property line) so the pavement stays visible between them, plus the curb lines
    // per side: at a T-junction the sidewalk and curb on the side with no crossing street run straight through
    { const bandW=hf ? structBandW(st) : st.row; const swW=Math.max(0.5,(bandW-m.ctc)/2); [-1,1].forEach(sg=>{   /* a ramp carries only its parapet, a bridge a sidewalk */ const sd=sg<0?'L':'R';
      if(hf){ strip(offsetLine(pav,sg*(m.ctc/2+swW/2)),swW,M.ctxSw,Y.walk,0.6,hf); strip(offsetLine(pav,sg*m.ctc/2),0.25,M.ctxCurb,Y.walk,0.6,hf); return; }
      // v3: at grade each edge of the strip (curb line, property line) stops where IT leaves the crossing street's carriageway, so the
      // strip's end runs along that street's curb line at any angle and meets the block's sidewalk corner there
      const te=(i,w)=>st.edge?st.edge[i][sd][w]:st.trimLR[i][sd]; const Le=trimLine(offsetLine(st.g,sg*m.ctc/2),te(0,'in'),te(1,'in')), Re=trimLine(offsetLine(st.g,sg*(m.ctc/2+swW)),te(0,'out'),te(1,'out'));
      const Lc=Le.length>1?clipPoly(Le,BOX):[], Rc=Re.length>1?clipPoly(Re,BOX):[];
      if(Lc.length===1&&Rc.length===1) ribbonLR(sg<0?Rc[0]:Lc[0], sg<0?Lc[0]:Rc[0], M.ctxSw,Y.walk,0.45,null);
      else { const bs=trimLine(st.g, st.trimLR[0][sd], st.trimLR[1][sd]); if(bs.length>1) strip(offsetLine(bs,sg*(m.ctc/2+swW/2)),swW,M.ctxSw,Y.walk,0.45,null); }
      const cb=trimLine(st.g,te(0,'in'),te(1,'in')); if(cb.length>1) strip(offsetLine(cb,sg*m.ctc/2),0.25,M.ctxCurb,Y.walk,0.45,null); }); }
    strip(pav,Math.max(3,m.ctc),M.ctxRd,Y.road,hf?0.8:0.3,hf);
    if(hf) alongLine(st.g,24,12).forEach(([x,z])=>{ const h=hf(x,z); if(h<2.5||!inBox(x,z)) return; cyl(0.55,Math.max(0.5,h-0.8),MP.pier,x,ez(x,z),z,g,12); });   // piers under the deck, every 24 m
    streetMarkings(st).forEach(mk=>{ if(hf){ st._emitMk(mk); return; } mkRuns(st,mk.g).forEach(p=>(mk.kind==='centre'?Q.yellow:Q.white).line(p, mk.kind==='park'?0.08:mk.w, yM, mk.dash)); });
    // bus stops on the street (TransLink GTFS): pole + sign on the correct side
    if(m.stops){ const len=[0]; for(let i=1;i<st.g.length;i++) len.push(len[i-1]+Math.hypot(st.g[i][0]-st.g[i-1][0],st.g[i][1]-st.g[i-1][1]));
      ['L','R'].forEach(sd=>(m.stops[sd]||[]).forEach(([d])=>{ let i=1; while(i<len.length-1&&len[i]<d) i++; const a=st.g[i-1], b=st.g[i]; const f=clamp((d-len[i-1])/((len[i]-len[i-1])||1),0,1); const px=a[0]+(b[0]-a[0])*f, pz=a[1]+(b[1]-a[1])*f; const ux=(b[0]-a[0]), uz=(b[1]-a[1]), L=Math.hypot(ux,uz)||1; const off=(sd==='L'?-1:1)*(m.ctc/2+1.2); const x=px+uz/L*off, z=pz-ux/L*off; const y=ez(x,z)+Y.walk; if(!inBox(x,z)) return;
        cyl(0.04,2.6,M.ctxPost,x,y,z,g,8); box(0.4,0.3,0.06,M.ctxPost,x-0.2,y+2.3,z-0.03,g); })); } });
  // v3: structure markings drawn joined end to end (joinRuns): one polyline per lane line along a deck, dashes through the nodes
  { const groups={}; deckMk.forEach(({g,mk})=>{ const key=mk.kind+'|'+mk.w+'|'+(mk.dash?mk.dash.join(','):''); (groups[key]=groups[key]||{mk,runs:[]}).runs.push(g); }); const yD=(x,z)=>ez(x,z)+Y.mark+HFany(x,z)+0.002;
    Object.values(groups).forEach(({mk,runs})=>joinRuns(runs,1.2).forEach(r=>(mk.kind==='centre'?Q.yellow:Q.white).line(r, mk.kind==='park'?0.08:mk.w, yD, mk.dash))); }
  // existing bikeways at their position across the street, by type and direction; protected lanes get their buffer
  // (on the host street's own centreline; pieces no street carries are paths of their own — see cityContext)
  // v3: existing lanes on structures as continuous chains (one polyline per lane along the deck, following its edges through
  // tapers and merges); the height comes from whichever piece of the structure the point is on
  (C.bikeChains||[]).forEach(c=>{ if(!inR(c.g)) return; const yH=(x,z)=>ez(x,z)+Y.mark+c.h(x,z); const lineQ=(Q,gg,w)=>clipPoly(gg,BOX).forEach(p=>Q.line(p,w,yH));
    lineQ(c.kind==='prot'?Q.bike:Q.paint,c.g,c.w); lineQ(Q.white,offsetLine(c.g,-c.w/2),0.1); lineQ(Q.white,offsetLine(c.g,c.w/2),0.1);
    if(c.buf) strip(c.buf,0.6,M.ctxBuf,Y.walk,0.45,c.h); });
  C.bikeHosted.forEach(h=>{ if(!inR(h.g)||h.chained) return; const base=h.g, b={ctc:h.ctc}; const yH=h.st._yM||yRoad, hf=h.st.deck?((x,z)=>deckAt(h.st,x,z)):null;   // lanes on a deck ride on it
    bikewayLanes(h.b,h.ctc,'L').forEach(l=>{
      if(l.kind==='shared'){ [-b.ctc/4,b.ctc/4].forEach(off=>{ alongLine(offsetLine(base,off),12,6).forEach(([x,z,ux,uz])=>{ if(inBox(x,z)) Q.shared.seg(x-ux*0.6,z-uz*0.6,x+ux*0.6,z+uz*0.6,0.5,yH); }); }); return; }
      const cg=offsetLine(base,l.off); const lineQ=(Q,gg,w)=>clipPoly(gg,BOX).forEach(p=>Q.line(p,w,yH)); lineQ(l.kind==='prot'?Q.bike:Q.paint,cg,l.w); lineQ(Q.white,offsetLine(cg,-l.w/2),0.1); lineQ(Q.white,offsetLine(cg,l.w/2),0.1);
      if(l.kind==='prot') strip(offsetLine(cg,(l.off<0?1:-1)*(l.w/2+0.3)),0.6,M.ctxBuf,Y.walk,0.45,hf); }); });
  // v3: over a host deck, the block's bike lanes taper into the deck's existing lanes at each end (10 m): one lane along the deck
  if(C.blockHost){ const hl=C.bikeHosted.filter(h=>h.blockHost); const host=C.blockHost; const yH=host._yM||yRoad; const lanesH=hl.length?bikewayLanes(hl[0].b,hl[0].ctc,'L').filter(l=>l.kind!=='shared'):[];
    const bikesB=(curOpt()?curOpt().els:[]).filter(e=>e.k==='bike');
    [0,1].forEach(k=>{ const zEnd=k?LEN:0, sgn=k?1:-1; const hp=nearOnPoly([0,zEnd],host.g)[1]; const hx=hp?hp[0]:0;
      bikesB.forEach(b=>{ const bc=b.x+b.w/2; let best=null; lanesH.forEach(l=>{ const xe=hx+l.off; const d=Math.abs(xe-bc); if(d<6&&(!best||d<best.d)) best={xe,w:l.w,d}; }); if(!best) return; const T=10, z2=zEnd+sgn*T; const x0=best.xe-best.w/2, x1=best.xe+best.w/2;
        Q.bike.quad([b.x,zEnd],[b.x+b.w,zEnd],[x1,z2],[x0,z2],(x,z)=>yH(x,z)+0.003); Q.white.quad([b.x,zEnd],[b.x+0.1,zEnd],[x0+0.1,z2],[x0,z2],(x,z)=>yH(x,z)+0.004); Q.white.quad([b.x+b.w-0.1,zEnd],[b.x+b.w,zEnd],[x1,z2],[x1-0.1,z2],(x,z)=>yH(x,z)+0.004); }); }); }
  // v2: paths in the path language (a paved path with a dashed centreline — not a protected lane): the City's pieces no street or
  // OSM path carries, then the OSM paths themselves; bridge paths on a deck at 6 m per level, ramping down over 30 m at a free end
  const pathStrip=(g,w,des,ow,hf)=>{ strip(g,w,des?MP.des:MP.path,Y.road+0.03,hf?0.5:0.08,hf); if(!ow) clipPoly(g,BOX).forEach(q=>Q.white.line(q,0.08,(x,z)=>ez(x,z)+Y.road+0.035+(hf?hf(x,z):0),[0.8,1.6])); };
  C.bikePaths.forEach(p=>{ if(!inR(p.g)) return; pathStrip(p.g,p.d==='OW'?2.0:3.0,p.sub==='OSB'||p.t==='Protected Bike Lanes',p.d==='OW',null); });
  const upEnds=C.osmPaths.filter(p=>p.up).flatMap(p=>[p.g[0],p.g[p.g.length-1]]);
  C.osmPaths.forEach(p=>{ if(!inR(p.g)) return; let hf=null;
    if(p.up){ const H=(p.lvl||1)*6.0, L=plen(p.g), free=[p.g[0],p.g[p.g.length-1]].map(e=>upEnds.filter(q=>Math.hypot(q[0]-e[0],q[1]-e[1])<3).length<2);
      hf=(x,z)=>{ const a=alongOnPoly(p.g,[x,z])[1]; let h=H; if(free[0]&&a<30) h=H*a/30; if(free[1]&&L-a<30) h=Math.min(h,H*(L-a)/30); return Math.max(0,h); };
      alongLine(p.g,20,10).forEach(([x,z])=>{ const h=hf(x,z); if(h>2.5&&inBox(x,z)) cyl(0.3,h-0.5,MP.pier,x,ez(x,z),z,g,10); }); }
    pathStrip(p.g,p.ow?2.0:3.0,p.des,p.ow,hf); });
  // turnaround loops (planted island, ring road) and public plazas, flat on the ground plate
  const flatShape=(ring,mat,y)=>{ if(ring.length<4) return; const sh=new THREE.Shape(ring.map(([x,z])=>new THREE.Vector2(x,-z))); const m=new THREE.Mesh(new THREE.ShapeGeometry(sh),mat); m.rotation.x=-Math.PI/2; m.position.y=y; m.receiveShadow=true; g.add(m); };
  C.plazas.forEach(r=>{ if(inR(r)) flatShape(r,MP.plaza,Y.ground+0.012); });
  C.loops.forEach(l=>{ if(!inR(l.g)) return; const w=Math.max(5.5,(l.ln||1)*4.5);
    if(l.bulb&&l.hw==='turning_circle'){ flatShape(l.g,M.ctxRd,Y.road+0.01); return; }   // cul-de-sac bulb: one paved disc
    const c=l.g.reduce((a,p)=>[a[0]+p[0]/l.g.length,a[1]+p[1]/l.g.length],[0,0]);
    const isl=l.g.map(p=>{ const d=Math.hypot(p[0]-c[0],p[1]-c[1])||1; const k=Math.max(0,(d-w/2)/d); return [c[0]+(p[0]-c[0])*k, c[1]+(p[1]-c[1])*k]; });   // island inside the ring road's inner curb
    strip([...l.g,l.g[1]],w,M.ctxRd,Y.road,0.3); flatShape(isl,MP.island,Y.walk-0.02); });
  Object.values(Q).forEach(q=>q.mesh(g));
  // existing street trees on every surrounding street (public-trees), instanced so a thousand trees stay one draw call each
  // v3: the other blocks of the proposal with their lanes and buffers — in a group of their own, shown in the proposed view only
  { const pg=new THREE.Group(); const QB=new Quads(mqc('bike')), QW=new Quads(mqc('white')); const yP=(x,z)=>yRoad(x,z)+0.004; ribbon.target=pg;
    (D.mode==='review'?[]:(C.propLanes||[])).forEach(pl=>{ if(!inR(pl.g)) return; pl.els.forEach(el=>{ const cg=offsetLine(pl.g, el.x+el.w/2);   // v3: in the review the other blocks are built in full (build3D)
      if(el.k==='bike'){ clipPoly(cg,BOX).forEach(p=>QB.line(p,el.w,yP)); [el.x,el.x+el.w].forEach(x=>clipPoly(offsetLine(pl.g,x),BOX).forEach(p=>QW.line(p,0.1,yP))); }
      else strip(cg, el.w, M.ctxBuf, Y.walk, Math.max(0.05,el.h||0.15)); }); });
    ribbon.target=null; QB.mesh(pg); QW.mesh(pg); g.add(pg); T3.propCtx=pg; }
  { const trees=[]; C.streets.forEach(st=>{ if(!inR(st.g)) return; streetTrees(st, C.streets).forEach(t=>{ if(inBox(t.x,t.z)&&!nearStructure(C,t.x,t.z)) trees.push(t); }); });   // v3: no tree under or on a deck or ramp
    // v3 illustration style: a faceted canopy (low-poly, flat shaded) with a dark inverted-hull outline, slightly flattened
    if(trees.length){ const cg=new THREE.IcosahedronGeometry(1,1); const trunk=new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5,0.5,1,8),M.ctxTrunk,trees.length), crown=new THREE.InstancedMesh(cg,M.ctxLeaf,trees.length), rim=new THREE.InstancedMesh(cg,HULL,trees.length);
      const mtx=new THREE.Matrix4(), p=new THREE.Vector3(), q=new THREE.Quaternion(), s=new THREE.Vector3();
      trees.forEach((t,i)=>{ const H=clamp(t.h,3,18), r=clamp(H*0.19,0.6,2.4), tw=clamp(t.d/100,0.12,0.5), y0=ez(t.x,t.z)+Y.walk;
        p.set(t.x,y0+H*0.275,t.z); s.set(tw,H*0.55,tw); mtx.compose(p,q,s); trunk.setMatrixAt(i,mtx);
        p.set(t.x,y0+H*0.55+r*0.55,t.z); s.set(r,r*0.85,r); mtx.compose(p,q,s); crown.setMatrixAt(i,mtx); s.set(r*1.05,r*0.85*1.05,r*1.05); mtx.compose(p,q,s); rim.setMatrixAt(i,mtx); });
      trunk.castShadow=crown.castShadow=true; g.add(trunk); g.add(crown); g.add(rim); } }
  // signal head at junctions where Open Data has a traffic signal
  C.nodes.forEach(nd=>{ const r=Math.max(6,(nd.row-7.2)/2); if(!inBox(nd.x,nd.z)) return;
    if(nd.sig){ const x=nd.x+r+0.8, z=nd.z+r+0.8, y=ez(x,z)+Y.walk; cyl(0.08,4.6,M.ctxPost,x,y,z,g,10); box(0.3,0.9,0.3,M.signal,x-0.15,y+3.6,z-0.15,g); box(0.12,0.12,0.02,MAT(0xff3b30),x-0.06,y+4.3,z-0.17,g); box(0.12,0.12,0.02,MAT(0x34c759),x-0.06,y+3.8,z-0.17,g); } });
  C.blds.forEach(b=>{ if(b.c[1]>-20&&b.c[1]<LEN+20&&Math.abs(b.c[0])>Math.abs(S_.xL)-1&&Math.abs(b.c[0])<Math.abs(S_.xL)+40) return; if(!b.p.every(([x,z])=>inBox(x,z))) return;   // whole footprint inside the plate
    const sh=new THREE.Shape(b.p.map(([x,z])=>new THREE.Vector2(x,-z)));
    const geo=new THREE.ExtrudeGeometry(sh,{depth:b.h,bevelEnabled:false});
    const m=new THREE.Mesh(geo, M.bld); m.rotation.x=-Math.PI/2; m.position.y=ez(b.c[0],b.c[1])+Y.ground; m.castShadow=m.receiveShadow=true; g.add(m); outline(m,g,EDGE2); });
  // ── labels: existing traffic on the block and on the nearest surrounding streets (class · speed · lanes · direction · parking · routes · facility)
  //    full detail for the streets meeting the block's ends, a short line for the nearest others
  const EIs=S_.EI, endSegs=new Set(); EIs.forEach(e=>{ (e.segs||[]).concat(e.cont||[]).forEach(o=>endSegs.add(o)); });
  if(D.ann===false) return g;
  // v3: concise labels — the four nearest streets, one short line each (the full traffic description is on the card and in the panel)
  const near=C.streets.filter(st=>{ const mid=st.g[Math.floor(st.g.length/2)]; st._d=Math.hypot(mid[0],mid[1]-LEN/2); return inBox(mid[0],mid[1]) && (endSegs.has(st.s) || st._d<Math.max(LEN,140)*0.9); }).sort((a,b)=>a._d-b._d).slice(0,4);
  near.forEach(st=>{ const m=st.m; const mid=st.g[Math.floor(st.g.length/2)];
    const short=`${m.spd} km/h · ${m.lanes} ${m.lanes>1?'lanes':'lane'}${m.ow?' one-way':''}${m.bw?' · '+(m.bw.t==='Protected Bike Lanes'?'protected lane':m.bw.t==='Painted Lanes'?'painted lane':m.bw.t==='Local Street'?'local bikeway':'sharrows'):''}`;
    label3(g,[titleCase(m.n), short], mid[0], ez(mid[0],mid[1])+3, mid[1], {fs:8.5, bg:'rgba(255,255,255,.8)', wrap:60}); });
  const bm=laneModel(c.seg); label3(g,['EXISTING · '+titleCase(c.seg.n), `${bm.spd} km/h · ${bm.lanes} ${bm.lanes>1?'lanes':'lane'}${bm.ow?' one-way':''}${bm.park.L||bm.park.R?' · parking':''}`], (S_.xR+S_.sceneXR)/2+4, 12, LEN/2, {fs:9, bg:'rgba(255,251,235,.92)', edge:'#D97706', wrap:60});
  return g; }
const sw_l=els=>{ const s=els.filter(e=>e.k==='sw'); return s[0].x+s[0].w; }, sw_r=els=>{ const s=els.filter(e=>e.k==='sw'); return s[s.length-1].x; };   // curb lines
function buildStreet(els, before){ const g=new THREE.Group(); const S_=sceneCtx(els); const {c,xL,xR,CL,CR,leftW,rightW,sceneXL,sceneXR,LEN,LW,ZA,ZB,RAD}=S_; const ends=S_.cw, EI=S_.EI; const EL=[endLayout(!!ends[0]), endLayout(!!ends[1])];
  // where posts / planters / barrier may stand: outside the 6 m corner-island zone at a cross street
  const zp0 = EI[0].type==='cross'?ZA+IX.setback+0.5:ZA+0.5, zp1 = EI[1].type==='cross'?ZB-IX.setback-0.5:ZB-0.5; const protOK=z=>z>zp0&&z<zp1;
  const gaps=sd=>(S_.lanes[sd]||[]).filter(p=>p>ZA+2&&p<ZB-2).map(p=>[p-LW/2,p+LW/2]);
  const runs=(sd,za,zb)=>{ if(za==null) za=ZA; if(zb==null) zb=ZB; let z=za; const out=[]; gaps(sd).sort((a,b)=>a[0]-b[0]).forEach(([a,b])=>{ if(a-z>0.05) out.push([z,a]); z=b; }); if(zb-z>0.05) out.push([z,zb]); return out; };
  // No slab of its own: the block sits on the shared ground plate, and the cross streets' pavement (extended to this block's
  // far curb in buildCity) is the intersection surface. Sidewalks run between the cross streets' curb lines.
  const zS0 = EI[0].type==='cross' ? ZA : 0, zS1 = EI[1].type==='cross' ? ZB : LEN;
  const noLeg=(i,sd)=>EI[i].type==='cross' && (sd==='L'?S_.legs[i].L==null:S_.legs[i].R==null);   // T-junction: the cross street does not continue on this side
  // v3: the cross streets' real curb lines (endGeom, shared with the plan). A skewed cross street's curb cuts into the block short
  // of its square section end on one side: every element in the x-range [x0,x1] stops at that curb (cutZ), so nothing of the block
  // runs on into the crossing carriageway (no doubled surfaces, no sidewalk slab across the cross street)
  const GE=EI.map((e,i)=>e.type==='cross'?endGeom(S_,i,sw_l(els),sw_r(els)):null);
  const cutZ=(i,x0,x1)=>{ const G=GE[i], zE=i?ZB:ZA; if(!G) return zE; const sgn=i?1:-1; let z=zE; [x0,x1].forEach(x=>{ const c=G.fb(x).near.z; z=sgn>0?Math.min(z,c):Math.max(z,c); }); return z; };
  // the carriageway strip under the block's own elements, so gaps between elements never show the plate
  if(!S_.host) box(sw_r(els)-sw_l(els),0.3,zS1-zS0,M.asphalt,sw_l(els),-0.34,zS0,g);   // top −0.04, just under the element boxes (over a host deck the deck is the surface)
  // v2: on a structure — the deck slab under the block, piers to the ground and parapets on the edges (none over a host deck)
  const DH=S_.deckH||0; const PR=S_.prof||[0,0]; if(DH>0){ const MD=MAT(0xC4C6C8); box(xR-xL+0.6,1.4,LEN,MD,xL-0.3,-1.75,0,g); for(let z=12;z<LEN-4;z+=24){ const hz=PR[0]+(PR[1]-PR[0])*z/LEN; if(hz>2.4) [xL+1.8,xR-1.8].forEach(px=>cyl(0.5,hz-1.7,MD,px,-hz,z,g,12)); }
    if(!S_.host) [xL,xR-0.3].forEach(px=>box(0.3,1.4,zS1-zS0,M.curb,px,0.1,zS0,g)); }
  // real footprints fronting this block, extruded at their LiDAR height (flagged ones in a warmer tone; on the true ground when the block is on a deck)
  const HALF=Math.max(320, LEN*0.6+80, D.plateHalf||0), BOXB={x0:-HALF, x1:HALF, z0:LEN/2-HALF, z1:LEN/2+HALF};   // v3: frontages stay inside the site plate, and near the block
  (T3.other?[]:S_.C.blds).forEach(b=>{ if(b.c[1]<-20||b.c[1]>LEN+20) return; if(Math.abs(b.c[0])<Math.abs(xL)-1||Math.abs(b.c[0])>Math.abs(xL)+60) return; if(!b.p.every(([x,z])=>x>=BOXB.x0&&x<=BOXB.x1&&z>=BOXB.z0&&z<=BOXB.z1)) return;
    const sh=new THREE.Shape(b.p.map(([x,z])=>new THREE.Vector2(x,-z)));
    const m=new THREE.Mesh(new THREE.ExtrudeGeometry(sh,{depth:Math.max(b.h,3),bevelEnabled:false}), M.bld);
    const [bwx,bwy]=S_.C.F.toWorld(b.c[0],b.c[1]); m.rotation.x=-Math.PI/2; m.position.y=elevAt(bwx,bwy)-TZ0-Math.tan(Math.atan(D.ctx.grade))*b.c[1]+Y.ground-DH; m.castShadow=m.receiveShadow=true; g.add(m); outline(m,g); });
  // elements
  els.forEach(e=>{ const sd=e.side==='C'?'R':e.side; const h=Math.max(e.h,0.02);
    if(S_.host&&(e.k==='travel'||e.k==='park'||e.k==='sw')) return;   // v3: over a host deck the block adds only its bike lanes and buffers
    // element boxes top out at h−0.03 (group; h ≥ 0.02), i.e. pavement at −0.01 → world Y.road, level with the existing street;
    // pavement markings drawn from y≈0.005 then sit a clear 2.5 cm above them
    const za=cutZ(0,e.x,e.x+e.w), zb=cutZ(1,e.x,e.x+e.w);   /* v3: this element's ends — the square section end, or the skewed cross street's curb where that cuts in earlier */
    if (e.k==='travel'||e.k==='park'||e.k==='bike') { box(e.w,h+0.02,zb-za, e.k==='bike'?M.bike:e.k==='park'?M.park:M.asphalt, e.x,-0.05,za,g); }
    else { const mat=e.k==='sw'?M.sw:(SEP[e.sep].bufKind==='barrier'?M.asphalt:(SEP[e.sep].bufKind==='painted'||SEP[e.sep].bufKind==='paint')?M.asphalt:M.buf);
      // sidewalks run the block but stop at a cross street's curb line (as in plan); the corner is rounded by the curb return below
      // (at a T-junction the side with no cross-street leg keeps its sidewalk running to the node, with no corner)
      const rr = e.k==='sw' ? (()=>{ let z=noLeg(0,sd)?0:(EI[0].type==='cross'?za:0); const zE=noLeg(1,sd)?LEN:(EI[1].type==='cross'?zb:LEN);   /* the corner slab (below) takes over at a cross street */ const o=[]; gaps(sd).forEach(([a,b])=>{ if(a-z>0.05) o.push([z,a]); z=b; }); if(zE-z>0.05) o.push([z,zE]); return o; })() : runs(sd,za,zb);
      rr.forEach(([a,b])=>box(e.w,h+0.02,b-a,mat,e.x,-0.05,a,g)); gaps(sd).forEach(([a,b])=>box(e.w,0.04,b-a,M.asphalt,e.x,-0.05,a,g));
      // v3 illustration style: paver joints across the proposal's sidewalks every metre — the one texture in the view, and only here
      if(e.k==='sw'&&!S_.host){ const pts=[]; const top=h-0.03+0.004; rr.forEach(([a,b])=>{ for(let z=Math.ceil(a)+0.5;z<b-0.2;z+=1.0) pts.push(e.x+0.05,top,z, e.x+e.w-0.05,top,z); }); if(pts.length){ const lg=new THREE.BufferGeometry(); lg.setAttribute('position',new THREE.Float32BufferAttribute(pts,3)); g.add(new THREE.LineSegments(lg,JOINT)); } }
      if (e.k==='buf'){ const kind=SEP[e.sep].bufKind;
        if (kind==='barrier'){ runs(sd,za,zb).forEach(([a,b])=>{ for(let z=Math.max(a,zp0);z<Math.min(b,zp1)-0.1;z+=3){ const d=Math.min(3,Math.min(b,zp1)-z); const bm=box(0.56,0.69,d-0.05,M.barrier,e.x+(e.w-0.56)/2,0,z,g); if(Math.floor(z/3)%2===0) box(0.58,0.12,d-0.05,M.amber,e.x+(e.w-0.58)/2,0.45,z,g); } }); }
        else if (kind==='painted'){ for(let z=1.5;z<LEN-1;z+=3){ if(inLaneAt(S_,sd,z)||!protOK(z)) continue; cyl(0.05,0.95,M.post,e.x+e.w/2,0,z,g,10); box(0.11,0.18,0.11,M.bike,e.x+e.w/2-0.055,0.5,z-0.055,g); } for(let z=0.5;z<LEN;z+=1.2){ if(!protOK(z)) continue; box(e.w-0.1,0.01,0.12,M.white,e.x+0.05,h+0.001,z,g); } }
        else if (kind==='paint'){ for(let z=0.5;z<LEN;z+=1.2){ if(!protOK(z)) continue; box(e.w-0.1,0.01,0.12,M.white,e.x+0.05,h+0.001,z,g); } }   // v2: existing painted buffer, no posts
        else if (kind==='raisedlane'){ }   // v2: a plain concrete curb, no posts — the lane itself is raised
        else if (kind==='planter'){ for(let z=1.2;z<LEN-1.5;z+=3.2){ if(inLaneAt(S_,sd,z)||!protOK(z)) continue; box(Math.min(e.w-0.2,0.8),0.6,1.2,MAT(0x6b7a86),e.x+(e.w-Math.min(e.w-0.2,0.8))/2,h,z,g); sph(0.35,M.leaf,e.x+e.w/2,h+0.8,z+0.6,g); sph(0.25,M.leaf2,e.x+e.w/2+0.15,h+0.7,z+0.25,g); } }
        else { for(let z=1.5;z<LEN-1;z+=3){ if(inLaneAt(S_,sd,z)||!protOK(z)) continue; cyl(0.05,0.9,M.post,e.x+e.w/2,h,z,g,10); box(0.11,0.18,0.11,M.bike,e.x+e.w/2-0.055,h+0.45,z-0.055,g); }
          if (e.w>=RULES.buffer.treed.min && D.city) for(let z=6;z<LEN-4;z+=12){ if(inLaneAt(S_,sd,z)) continue; tree3(g,e.x+e.w/2,z,7,20,h); } } } } });
  // markings
  // motor-vehicle markings start behind the vehicle stop bar, bike markings behind the bicycle stop bar (EDM §8.9.1.8)
  const z0m=ZA+(EI[0].type==='cross'?EL[0].carStart:(isStop(EI[0])?5.0:0.5)), z1m=ZB-(EI[1].type==='cross'?EL[1].carStart:(isStop(EI[1])?5.0:0.5));
  const zb0=ZA+(EI[0].type==='cross'?EL[0].bikeStart:(EI[0].type==='dead'?5.0:EI[0].type==='path'?1.0:0.5)), zb1=ZB-(EI[1].type==='cross'?EL[1].bikeStart:(EI[1].type==='dead'?5.0:EI[1].type==='path'?1.0:0.5));
  const travel=els.filter(e=>e.k==='travel'), bikes=els.filter(e=>e.k==='bike'), park=els.filter(e=>e.k==='park'), sw=els.filter(e=>e.k==='sw');
  if(!S_.host) travel.forEach((tl,i)=>{ if(i===0) return; const centre = !tl.ow&&(tl.side==='C'||travel[i-1].side!==tl.side); if(centre) box(0.12,0.01,z1m-z0m,M.yellow,tl.x-0.06,0.005,z0m,g); else for(let z=z0m;z<z1m-1;z+=3.5) box(0.12,0.01,2,M.white,tl.x-0.06,0.005,z,g); });   // over a host deck the deck's markings run through
  bikes.forEach(b=>{ [b.x+0.04,b.x+b.w-0.14].forEach(x=>box(0.1,0.01,zb1-zb0,M.white,x,0.005,zb0,g));
    if(b.two){ // dividing line: 1.0 m dashes / 3.0 m gaps, solid for the 10 m before each pedestrian crossing (EDM §8.9.1.11)
      const s0=ends[0]?Math.min(zb0+IX.ddlSolid,zb1):zb0, s1=ends[1]?Math.max(zb1-IX.ddlSolid,zb0):zb1; const cx=b.x+b.w/2-0.05;
      if(ends[0]) box(0.1,0.01,s0-zb0,M.yellow,cx,0.006,zb0,g); if(ends[1]) box(0.1,0.01,zb1-s1,M.yellow,cx,0.006,s1,g);
      for(let z=s0;z<s1-IX.ddlDash;z+=IX.ddlDash+IX.ddlGap) box(0.1,0.01,IX.ddlDash,M.yellow,cx,0.006,z,g); }
    const pict=(cx,z,dir)=>{ box(0.16,0.01,0.9,M.white,cx-0.08,0.006,z,g); box(0.5,0.01,0.12,M.white,cx-0.25,0.006,z+(dir>0?0.75:0.05),g); };
    if(b.two) for(let z=zb0+4;z<zb1-2;z+=14){ pict(b.x+b.w*.25,z,-1); pict(b.x+b.w*.75,z+7,1);} else for(let z=zb0+4;z<zb1-2;z+=14){ if(!inLaneAt(S_,b.side,z)) pict(b.x+b.w/2,z,b.dir); }   // right-hand: −z on the left half
    // bicycle stop bar: 0.3 m wide, parallel to the cross street, across the half that arrives at this end (EDM §8.9.1.8)
    EI.forEach((e,i)=>{ if(e.type!=='cross') return; const el=EL[i]; const zEdge=i?ZB:ZA, sgn=i?1:-1; const arrives = b.two ? true : (b.dir>0 ? i===1 : i===0); if(!arrives) return;
      const x0 = b.two ? (i===1 ? b.x+b.w/2 : b.x) : b.x, w = b.two ? b.w/2 : b.w; const z=zEdge-sgn*el.bb0; box(w-.1,.01,IX.bikeBarW,M.white,x0+.05,.006,Math.min(z,z-sgn*IX.bikeBarW),g); });
    (S_.lanes[b.side]||[]).forEach(p=>{ if(p<2||p>LEN-2) return; for(let z=p-LW/2+.15;z<p+LW/2;z+=.6){ box(.3,.01,.3,M.white,b.x+.08,.006,z,g); box(.3,.01,.3,M.white,b.x+b.w-.38,.006,z,g);} }); });
  if(!S_.host) park.forEach(pk=>{ for(let z=z0m+1;z<z1m;z+=6) box(pk.w,0.01,0.1,M.white,pk.x,0.005,z,g); });
  // ── intersection: crosswalks, stop bars, bicycle crossing, corner islands, signals (EDM 2026 §8.8.1.7, §8.9.1.8, §8.9.1.12) ──
  const cXL=sw[0].x+sw[0].w, cXR=sw[1].x;
  EI.forEach((e,i)=>{ if(e.type!=='cross') return; const zEdge=i?ZB:ZA, sgn=i?1:-1; const el=EL[i]; const zIn=d=>zEdge-sgn*d;   // zIn(d): d metres from the curb line into the block
    // marked crosswalk across this street: two 0.2 m lines 3.0 m apart, in line with the cross street's sidewalk, nearest line 0.6 m from the curb line; signalised only
    if (ends[i]) [el.cw0, el.cw1-IX.cwLine].forEach(d=>box(cXR-cXL-.4,.01,IX.cwLine,M.white,cXL+.2,.006,Math.min(zIn(d),zIn(d)-sgn*IX.cwLine),g));
    // vehicle stop bars 0.3 m wide, ≥2.0 m behind the bicycle stop bar, on the lanes arriving at this end
    travel.forEach(tl=>{ const towards = tl.ow ? ((c.owd||1)>0 ? i===1 : i===0) : (tl.side==='R' ? i===1 : i===0); if(!towards) return; box(tl.w-.16,.01,IX.carBarW,M.white,tl.x+.08,.006,Math.min(zIn(el.vb0),zIn(el.vb0)-sgn*IX.carBarW),g); });   // right-hand: R lanes head +z; one-way per OSM direction
    // v2: the corners follow the cross street's real curbs (endGeom, shared with the plan): the block's sidewalk runs on to the
    // cross street's near curb and its corner is a fillet tangent to both curb lines at whatever angle they meet, built as one
    // extruded slab at sidewalk height (−0.05 … +0.12, like the sidewalk runs); a missing leg keeps its sidewalk to the node
    const hasL=!noLeg(i,'L'), hasR=!noLeg(i,'R'); const G=GE[i]; const rq=Math.min(RAD, sw[0].w-0.2);
    [[hasL,sw[0],cXL,-1],[hasR,sw[1],cXR,1]].forEach(([has,s,curbX,ox])=>{ if(!has||S_.host) return; const xPL=ox<0?s.x:s.x+s.w; const FL=G.fillet(curbX,ox,rq);
      // v3: the slab starts where this sidewalk's run stopped (cutZ: the section end, or the skewed curb's innermost reach) and
      // runs out to the cross street's curb line, so the corner is one piece whatever the angle
      const zS=cutZ(i,s.x,s.x+s.w); const onSide=z=>(z-zS)*sgn<0?zS:z;   // never behind the sidewalk run's end
      const pts=[[xPL,zS],[curbX,zS]];
      if(FL&&(FL.TA[1]-zS)*sgn>-0.01){ pts.push(FL.TA,...FL.arc(12).slice(1)); const tb=FL.TB; for(let k=1;k<=4;k++){ const x=tb[0]+(xPL-tb[0])*k/4; pts.push([x,onSide(G.fb(x).near.z)]); } }
      else { [curbX,(curbX+xPL)/2,xPL].forEach(x=>pts.push([x,onSide(G.fb(x).near.z)])); }
      const ring=pts.map(([x,z])=>[x,onSide(z)]); if(Math.abs(ring.reduce((a,p,k)=>{ const q=ring[(k+1)%ring.length]; return a+p[0]*q[1]-q[0]*p[1]; },0))<0.05) return;   // nothing between the section end and the curb
      const sh=new THREE.Shape(ring.map(([x,z])=>new THREE.Vector2(x,-z))); const m=new THREE.Mesh(new THREE.ExtrudeGeometry(sh,{depth:0.17,bevelEnabled:false}),M.sw); m.rotation.x=-Math.PI/2; m.position.y=-0.05; m.receiveShadow=true; g.add(m); });
    // the cross street's own lanes and stop bars come with the context streets (streetMarkings, along its real centreline); without
    // the city context they are drawn here, with its pavement. The crosswalks across it span its real curbs.
    { const Qw=new Quads(MQ.white), Qy=new Quads(MQ.yellow);
      if(!D.city) G.ext.forEach(E=>{ const L=E.g; for(let k=1;k<L.length;k++){ const [x0,z0]=L[k-1],[x1,z1]=L[k]; const len=Math.hypot(x1-x0,z1-z0); if(len<0.2) continue; const mm=new THREE.Mesh(new THREE.BoxGeometry(E.m.ctc,0.04,len+0.02),M.asphalt); mm.position.set((x0+x1)/2,-0.05+0.02,(z0+z1)/2); mm.rotation.y=Math.atan2(x1-x0,z1-z0); g.add(mm); }
        streetMarkings(E.st).forEach(mk=>(mk.kind==='centre'?Qy:Qw).line(mk.g, mk.kind==='park'?0.08:mk.w, 0.007, mk.dash)); });
      if(ends[i]) sw.forEach((sx,si)=>{ if(si===0?!hasL:!hasR) return; [sx.x+.4, sx.x+sx.w-.4-IX.cwLine].forEach(x=>{ const cz=G.curbZ(x+IX.cwLine/2); if(!cz) return; const a=cz.near.z, b=cz.far.z, dz=Math.sign(b-a)*0.6; Qw.rect(x,Math.min(a+dz,b-dz),x+IX.cwLine,Math.max(a+dz,b-dz),0.007); }); });
      Qw.mesh(g); Qy.mesh(g); }
    // the bicycle crossing: across the cross street's real carriageway at each lane, bounded by elephant's feet (0.5 m squares, 0.5 m
    // gaps), green only where the cross street carries turning conflicts, one bicycle stencil per cross-street lane (EDM §8.9.1.12,
    // Table 8-19). No box in the crossing: "protected intersection treatments are preferred" (§8.9.1.12).
    { const xs=e.segs&&e.segs[0]; const green=crossingGreen(xs);
      bikes.forEach(b=>{ const cz=G.fb(b.x+b.w/2); const z0=Math.min(cz.near.z,cz.far.z), z1=Math.max(cz.near.z,cz.far.z);
        if(green) box(b.w-.1,.008,z1-z0,M.bikeX,b.x+.05,.004,z0,g);
        for(let z=z0+.25; z<z1-.4; z+=IX.ee+IX.eeGap){ box(IX.ee,.01,IX.ee,M.white,b.x+.05,.007,z,g); box(IX.ee,.01,IX.ee,M.white,b.x+b.w-.05-IX.ee,.007,z,g); }
        const cxg=b.two?b.x+b.w*.75:b.x+b.w/2, dir=b.two?1:b.dir;
        G.ext.forEach(E=>{ const m=E.m; for(let k=0;k<m.lanes;k++){ const hs=zCross(offsetLine(E.g,(m.edges[k]+m.edges[k+1])/2),cxg).filter(h=>h.z>=z0-0.2&&h.z<=z1+0.2); if(!hs.length) continue; const zl=hs[0].z;
          box(0.16,0.01,0.9,M.white,cxg-0.08,0.008,zl-0.45,g); box(0.5,0.01,0.12,M.white,cxg-0.25,0.008,zl-0.45+(dir>0?0.75:0.05),g); } }); }); }
    // corner island in the buffer: physical protection ends 6 m back and the island runs from 0.3 m behind the curb line to 6 m,
    // doubling as the pedestrian refuge where the crosswalk crosses the bike lane (BC Parkway Guide §4.5.2, p.63)
    els.filter(bf=>bf.k==='buf').forEach(bf=>{ const a=zIn(el.isl1), b2=zIn(el.isl0); box(bf.w,0.14,Math.abs(b2-a),M.buf,bf.x,0,Math.min(a,b2),g); });
    if (S_.sig[i]) [[cXL-0.5, zEdge+sgn*0.6],[cXR+0.5, zEdge+sgn*0.6]].forEach(([x,z])=>{ cyl(0.08,4.6,M.steel,x,0.15,z,g,10); box(0.3,0.9,0.3,M.signal,x-0.15,3.7,z-0.15,g); box(0.12,0.12,0.02,MAT(0xff3b30),x-0.06,4.4,z-0.17*sgn,g); box(0.12,0.12,0.02,MAT(0xffcc00),x-0.06,4.15,z-0.17*sgn,g); box(0.12,0.12,0.02,MAT(0x34c759),x-0.06,3.9,z-0.17*sgn,g); box(0.28,0.3,0.14,M.signal,x-0.14,2.4,z-0.07,g); });
  });
  // dead ends: close the carriageway, wrap the sidewalk, ramp the bike lane up to it
  EI.forEach((e,i)=>{ if(e.type!=='dead') return; const zEnd=i?LEN:0, sgn=i?1:-1; const cXL2=sw[0].x+sw[0].w, cXR2=sw[1].x;
    if(e.loop){ const F=S_.C.F; const loop=e.loop.map(q=>F.toLocal(q[0],q[1])); const at=nearOnPoly([0,zEnd],loop)[1]; const L=Math.hypot(at[0],at[1]-zEnd)+0.02;
      const m=new THREE.Mesh(new THREE.BoxGeometry(cXR2-cXL2,0.04,L),M.asphalt); m.position.set(at[0]/2,-0.03,(zEnd+at[1])/2); m.rotation.y=Math.atan2(at[0],at[1]-zEnd); m.receiveShadow=true; g.add(m); return; }   // runs into the turnaround
    box(cXR2-cXL2,0.17,1.6,M.sw,cXL2,-0.05,Math.min(zEnd,zEnd-sgn*1.6),g);
    box(cXR2-cXL2,0.30,0.25,M.curb,cXL2,0,zEnd-sgn*1.7,g);
    for(let x=cXL2;x<cXR2-0.3;x+=1.4) box(0.25,0.012,1.4,M.white,x,0.006,Math.min(zEnd-sgn*1.8,zEnd-sgn*3.2),g);
    bikes.forEach(b=>box(b.w*0.8,0.05,2.4,M.bike,b.x+b.w*0.1,0,Math.min(zEnd-sgn*1.9,zEnd-sgn*4.3),g)); });
  // v2: path ends — the street stops for cars, a public path carries the cyclist on. The carriageway runs into the turnaround loop
  // (drawn with the context) or closes with a curb cut flush at each bike lane; a connector in the path language leads to the path
  { const segBox=(pts,w,h,mat,y)=>{ for(let k=1;k<pts.length;k++){ const [x0,z0]=pts[k-1],[x1,z1]=pts[k]; const L=Math.hypot(x1-x0,z1-z0); if(L<0.2) continue; const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,L+0.02),mat); m.position.set((x0+x1)/2,y+h/2,(z0+z1)/2); m.rotation.y=Math.atan2(x1-x0,z1-z0); m.receiveShadow=true; g.add(m); } };
    const MPath=MAT(0xE9E5DC);
    EI.forEach((e,i)=>{ if(e.type!=='path') return; const zEnd=i?LEN:0, sgn=i?1:-1; const F=S_.C.F; const toL=gg=>gg.map(q=>F.toLocal(q[0],q[1])); const pg=smoothLine(toL(e.path.g),1); const cXL2=sw[0].x+sw[0].w, cXR2=sw[1].x; const pw=e.path.ow?2.0:3.0;
      if(e.loop){ const loop=toL(e.loop); const at=nearOnPoly([0,zEnd],loop)[1]; segBox([[0,zEnd],[0,zEnd+sgn*1.5],at],cXR2-cXL2,0.04,M.asphalt,-0.05); }
      else { const cuts=bikes.map(b=>[b.x,b.x+b.w]).sort((a,b)=>a[0]-b[0]); let x=cXL2; const seg=(a,b)=>{ if(b-a<0.05) return; box(b-a,0.17,1.6,M.sw,a,-0.05,Math.min(zEnd,zEnd-sgn*1.6),g); box(b-a,0.30,0.25,M.curb,a,0,zEnd-sgn*1.7,g); };
        cuts.forEach(([a,b])=>{ seg(x,a); x=b; box(b-a,0.04,1.6,MPath,a,-0.05,Math.min(zEnd,zEnd-sgn*1.6),g); }); seg(x,cXR2); }   // flush cut: the lane meets the path level
      pathConnectors(S_,e,i,bikes).forEach(gg=>segBox(gg,e.loop?pw:Math.min(pw,(bikes[0]?bikes[0].w:2)+0.4),0.03,MPath,-0.01)); }); }
  // bus stops: shelter on the sidewalk + pole; bike racks
  ['L','R'].forEach(sd=>{ (S_.stops[sd]||[]).forEach(([z])=>{ if(z<3||z>LEN-3) return; const s=sw[sd==='L'?0:1]; const x=sd==='L'?s.x+s.w-1.7:s.x+0.5; box(1.2,0.08,4,MAT(0x8fa3b4),x,2.3,z-2,g); [0,4].forEach(dz=>cyl(0.04,2.3,M.steel,x+0.1,0.15,z-2+dz+0.05,g,8)); box(0.04,2.2,3.9,M.glass,sd==='L'?x:x+1.16,0.15,z-1.95,g); cyl(0.04,2.6,M.steel,x+0.6,0.15,z-2.6,g,8); box(0.4,0.3,0.06,MAT(0x2f3b45),x+0.4,2.3,z-2.63,g); }); });
  ['L','R'].forEach(sd=>{ const n=S_.racks[sd]; if(!n) return; const s=sw[sd==='L'?0:1]; const x=sd==='L'?s.x+s.w-0.9:s.x+0.6; for(let k=0;k<Math.min(n,8);k++){ const z=6+k*1.1+(LEN-8-Math.min(n,8)*1.1)/2; const r=new THREE.Mesh(new THREE.TorusGeometry(0.35,0.03,8,16,Math.PI),M.steel); r.position.set(x,0.15,z); r.rotation.y=Math.PI/2; r.castShadow=true; g.add(r); } });
  // trees on sidewalks (from data), yards, bench
  if(!DH) sw.forEach(s=>{ const t=S_.tr[s.side]; if(!t||!t.n) return; const tx=s.side==='L'?s.x+s.w*.75:s.x+s.w*.25; const sp=Math.max(6,t.sp); for(let z=(s.side==='L'?3.1:7.4)%sp+(ends[0]?5:0); z<LEN-3; z+=sp){ if(!inLaneAt(S_,s.side,z)) tree3(g,tx,z,t.h||7,t.d||15,0.15); } });   // no trees on a deck
  // (no invented yard trees: only trees in the public-trees dataset are drawn)
  // people, cyclists, cars (movers)
  sw.forEach((s,si)=>{ const px=s.x+s.w*(s.side==='L'?.4:.6); for(let z=2;z<LEN-2;z+=11){ if(inLaneAt(S_,s.side,z)) continue; const p=person3(g,px+((z*7)%3-1)*.3,z,PEOPLE[Math.floor(z/11+si)%5]); T3.movers.push({obj:p,v:1.4*(si?1:-1),z0:1,z1:LEN-1}); } });
  bikes.forEach((b,i)=>{ const lanesX=b.two?[[b.x+b.w*.25,-1],[b.x+b.w*.75,1]]:[[b.x+b.w/2,b.dir]]; lanesX.forEach(([cx,dir],j)=>{ for(let z=z0m+5+j*8;z<z1m-3;z+=24){ const m=cyclist3(g,cx,z,dir,PEOPLE[(i+j)%5]); T3.movers.push({obj:m,v:5*dir,z0:z0m,z1:z1m}); } }); });
  // right-hand traffic; a one-way street's direction is not in Open Data (assumed +z)
  travel.forEach((tl,i)=>{ const dir=tl.ow?(c.owd||1):(tl.side==='L'?-1:tl.side==='R'?1:0); if(!dir) return; for(let z=z0m+6+i*9;z<z1m-5;z+=30){ const m=car3(g,tl.x+tl.w/2,z,dir,CARS[(i+Math.floor(z/30))%4]); T3.movers.push({obj:m,v:c.spd/3.6*0.5*dir,z0:z0m,z1:z1m}); } });
  park.forEach(pk=>{ for(let z=z0m+3;z<z1m-3;z+=6.6){ if(inLaneAt(S_,pk.side,z-2.2)||inLaneAt(S_,pk.side,z+2.2)) continue; if(((z*13)%7)<4.5) car3(g,pk.x+pk.w/2,z,1,CARS[Math.floor(z)%4]); } });
  g.visible=!before; return g; }

// ── v3 illustration style: figures as small articulated toon models — flat colour, a dark outline (hull), one light shadow ──
// a tree: trunk and two faceted canopy lobes (flat-shaded icosahedra, the larger one flattened), each with a hull outline
function tree3(g,x,z,h,dcm,y0){ const H=clamp(h,3,18), r=clamp(H*0.19,0.6,2.4), tw=clamp(dcm/100,0.12,0.5); cyl(tw/2,H*0.55,M.trunk,x,y0,z,g,8);
  const c1=new THREE.Mesh(new THREE.IcosahedronGeometry(r,1),M.leafF); c1.position.set(x,y0+H*0.55+r*0.55,z); c1.scale.set(1,0.85,1); c1.castShadow=true; g.add(c1); hull(c1,g,1.05);
  const c2=new THREE.Mesh(new THREE.IcosahedronGeometry(r*0.62,1),M.leaf2F); c2.position.set(x+r*0.35,y0+H*0.55+r*1.05,z-r*0.25); c2.castShadow=true; g.add(c2); hull(c2,g,1.06); }
// a person: head with hair, shoulders, torso, two arms, two legs; the movers carry the whole group
function person3(g,x,z,mat){ const p=new THREE.Group();
  const torso=new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.19,0.56,10),mat); torso.position.y=1.1; torso.castShadow=true; p.add(torso); hull(torso,p,1.1);
  const sh=new THREE.Mesh(new THREE.SphereGeometry(0.17,10,8),mat); sh.position.y=1.37; sh.scale.set(1,0.5,1); p.add(sh); hull(sh,p,1.1);
  [-0.09,0.09].forEach(dx=>{ const l=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.065,0.8,8),M.dark); l.position.set(dx,0.42,0); p.add(l); hull(l,p,1.14); });
  [-0.25,0.25].forEach(dx=>{ const a=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.045,0.5,8),mat); a.position.set(dx,1.08,0.02); a.rotation.z=dx<0?0.14:-0.14; p.add(a); hull(a,p,1.16); });
  const hd=new THREE.Mesh(new THREE.SphereGeometry(0.14,10,8),M.skin); hd.position.y=1.64; p.add(hd); hull(hd,p,1.1);
  const hair=new THREE.Mesh(new THREE.SphereGeometry(0.145,10,8,0,Math.PI*2,0,Math.PI/2),M.dark); hair.position.y=1.66; p.add(hair);
  p.position.set(x,0.02,z); g.add(p); return p; }
// a cyclist: two spoked wheels, a diamond frame, bars and saddle, a rider leaning to the bars with legs on the pedals and a helmet;
// built nose towards +z and turned round for dir < 0
function cyclist3(g,x,z,dir,mat){ const p=new THREE.Group();
  [0.52,-0.52].forEach(dz=>{ const w=new THREE.Mesh(new THREE.TorusGeometry(0.33,0.035,8,24),M.dark); w.position.set(0,0.35,dz); w.rotation.y=Math.PI/2; p.add(w); hull(w,p,1.06);
    [0,Math.PI/3,2*Math.PI/3].forEach(a=>{ const s=new THREE.Mesh(new THREE.BoxGeometry(0.015,0.62,0.015),M.steel); s.position.set(0,0.35,dz); s.rotation.x=a; p.add(s); }); });
  const F=[[0,0.92,0.33],[0,0.96,-0.22],[0,0.42,-0.08],[0,0.35,-0.52],[0,0.35,0.52]];   // head tube, seat, bottom bracket, rear axle, front axle
  [[0,1],[0,2],[1,2],[2,3],[1,3],[0,4]].forEach(([a,b])=>tube(p,F[a],F[b],0.025,M.steel));
  box(0.46,0.03,0.03,M.steel,-0.23,0.98,0.34,p); box(0.12,0.05,0.26,M.dark,-0.06,0.96,-0.34,p);   // handlebar, saddle
  const torso=new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.16,0.55,10),mat); torso.position.set(0,1.22,0); torso.rotation.x=0.55; torso.castShadow=true; p.add(torso); hull(torso,p,1.1);
  [-0.1,0.1].forEach((dx,k)=>{ tube(p,[dx,0.98,-0.2],[dx,0.55+(k?0.12:-0.12),-0.08+(k?0.16:-0.16)],0.05,M.dark); tube(p,[dx*2.2,1.38,0.12],[dx*2,1.0,0.33],0.04,mat); });   // legs to the pedals, arms to the bars
  const hd=new THREE.Mesh(new THREE.SphereGeometry(0.13,10,8),M.skin); hd.position.set(0,1.56,0.22); p.add(hd); hull(hd,p,1.1);
  const hm=new THREE.Mesh(new THREE.SphereGeometry(0.15,10,6,0,Math.PI*2,0,Math.PI/2),M.white); hm.position.copy(hd.position); hm.position.y+=0.02; p.add(hm);
  p.position.set(x,0.02,z); p.rotation.y=dir>0?0:Math.PI; g.add(p); return p; }
// a car: an extruded side profile (low hood, cabin, tail) with a glass band, hubbed wheels, head and tail lights, an edge outline;
// built nose towards −z and turned round for dir > 0
function car3(g,x,z,dir,mat){ const p=new THREE.Group();
  const prof=[[-2.1,0.32],[-2.1,0.8],[-1.4,0.86],[-0.72,1.38],[0.72,1.42],[1.3,0.92],[2.1,0.82],[2.1,0.32]];
  const body=new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape(prof.map(([a,b])=>new THREE.Vector2(a,b))),{depth:1.72,bevelEnabled:false}),mat); body.rotation.y=Math.PI/2; body.position.x=-0.86; body.castShadow=true; p.add(body); outline(body,p,EDGE);
  const gl=[[-1.3,0.88],[-0.7,1.33],[0.7,1.37],[1.22,0.92]]; const glass=new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape(gl.map(([a,b])=>new THREE.Vector2(a,b))),{depth:1.76,bevelEnabled:false}),M.glass); glass.rotation.y=Math.PI/2; glass.position.x=-0.88; p.add(glass);
  [[-0.78,1.35],[0.78,1.35],[-0.78,-1.35],[0.78,-1.35]].forEach(([dx,dz])=>{ const w=new THREE.Mesh(new THREE.CylinderGeometry(0.32,0.32,0.22,14),M.dark); w.rotation.z=Math.PI/2; w.position.set(dx,0.32,dz); p.add(w); hull(w,p,1.08); const cap=new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.13,0.24,10),M.curb); cap.rotation.z=Math.PI/2; cap.position.set(dx,0.32,dz); p.add(cap); });
  [-0.55,0.55].forEach(dx=>{ box(0.3,0.12,0.06,M.white,dx-0.15,0.6,-2.13,p); box(0.26,0.1,0.05,M.red,dx-0.13,0.62,2.09,p); });
  // v3: a little more articulation — bumpers, mirrors, door seams and a sill line on each side (lines, not geometry)
  box(1.6,0.14,0.08,M.curb,-0.8,0.36,-2.16,p); box(1.6,0.14,0.08,M.curb,-0.8,0.36,2.08,p);
  [-0.86,0.86].forEach(sx=>box(0.12,0.08,0.2,mat,sx<0?sx-0.1:sx-0.02,0.98,-0.6,p));
  { const sp=[]; [-0.865,0.865].forEach(sx=>{ sp.push(sx,0.36,-0.05, sx,1.3,-0.05, sx,0.36,1.1, sx,1.22,1.1, sx,0.38,-1.9, sx,0.38,1.9); }); const lg=new THREE.BufferGeometry(); lg.setAttribute('position',new THREE.Float32BufferAttribute(sp,3)); p.add(new THREE.LineSegments(lg,EDGE)); }
  p.position.set(x,0.02,z); p.rotation.y=dir>0?Math.PI:0; g.add(p); return p; }

function setAnim(on){ T3.animating=on&&D.view==='3d'; if(T3.animating&&!T3.raf){ T3.last=performance.now(); T3.raf=requestAnimationFrame(tick); } if(!T3.animating&&T3.raf){ cancelAnimationFrame(T3.raf); T3.raf=null; } if(D.view==='3d'&&T3.renderer) render3D(); }
function tick(t){ if(!T3.animating){T3.raf=null;return;} const dt=Math.min(0.05,(t-T3.last)/1000); T3.last=t; T3.movers.forEach(m=>{ m.obj.position.z+=m.v*dt; if(m.obj.position.z>m.z1) m.obj.position.z=m.z0; if(m.obj.position.z<m.z0) m.obj.position.z=m.z1; }); render3D(); T3.raf=requestAnimationFrame(tick); }
function stop3D(){ if(T3.raf){ cancelAnimationFrame(T3.raf); T3.raf=null; } T3.animating=false; }
