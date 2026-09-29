// ═══════════════════════════════════════════════════════════════════════════
// 2D RENDERERS — plan and section (dimensions scale-invariant on zoom)
// ═══════════════════════════════════════════════════════════════════════════
function rng(seed){ let s=seed>>>0||1; return ()=>{ s=(s*1664525+1013904223)>>>0; return s/4294967296; }; }
const VIEWS={}; const ANIM={t:0,raf:null,last:0};
function anim2D(on){ if(on&&!ANIM.raf){ ANIM.last=performance.now(); const step=(t)=>{ if(!D.anim||D.view!=='plan'){ ANIM.raf=null; return; } ANIM.t+=Math.min(.05,(t-ANIM.last)/1000); ANIM.last=t; redrawViews(); ANIM.raf=requestAnimationFrame(step); }; ANIM.raf=requestAnimationFrame(step); } if(!on&&ANIM.raf){ cancelAnimationFrame(ANIM.raf); ANIM.raf=null; } }
function view(id){ return VIEWS[id]||(VIEWS[id]={z:1,x:0,y:0}); }
// v2: a font size for text drawn inside the zoomed canvas transform. On screen the text grows with the square root of the zoom
// (2× zoom → 1.4× text), clamped to [lo, hi] screen pixels; the value returned is in transformed units (divided by the zoom).
function zoomFont(base, lo, hi, v, dpr){ return clamp(base*Math.sqrt(v.z), lo, hi)/v.z; }
// v2: line-weight hierarchy, as on a drawn street plan — heavy for the cut and curb lines, medium for edges of the proposed
// elements and buildings, light for secondary lines (property lines, context curbs, hatch boundaries), hairline for paving
// hatch, vehicles and tree crowns. Weights are screen pixels (× dpr) that grow gently with the zoom (√zoom, capped at 1.8×),
// returned in drawing units so they hold their hierarchy at every zoom instead of thickening with the geometry.
function lineWeights(v,dpr){ const f=dpr*clamp(Math.sqrt(v.z),1,1.8)/v.z; return {hair:.35*f, light:.6*f, med:1.0*f, heavy:1.7*f, f}; }
// one width dimension (line, ticks, number) for plan and section. The number sits above the line when it fits between the
// ticks; in a narrow element it turns to run along the element instead (as a draughtsman would), and it is skipped only when
// even that does not fit. When `i` is an element index the number is registered as a control (hover / click to type).
function dimString(ctx,canvas,v,dpr,k,fs,dimCol,S,X,x1,x2,y,label,i,DIMS){ ctx.font=`${fs}px JetBrains Mono, monospace`; const tw=ctx.measureText(label).width; const wpx=(x2-x1)*S;
  const fits=wpx>=tw*1.15, rot=!fits&&wpx>=fs*1.25; if(!fits&&!rot) return;
  ctx.strokeStyle=dimCol; ctx.lineWidth=.8*k*dpr; ctx.beginPath(); ctx.moveTo(X(x1),y); ctx.lineTo(X(x2),y); ctx.stroke(); [x1,x2].forEach(x=>{ ctx.beginPath(); ctx.moveTo(X(x)-3*k*dpr,y+3*k*dpr); ctx.lineTo(X(x)+3*k*dpr,y-3*k*dpr); ctx.stroke(); });
  const cx=(X(x1)+X(x2))/2, hot=i!=null&&canvas._hoverDim===i;
  if(fits){ if(hot){ ctx.fillStyle='rgba(20,184,166,.2)'; ctx.fillRect(cx-tw*.65,y-3*k*dpr-fs*1.15,tw*1.3,fs*1.25); } ctx.fillStyle=dimCol; ctx.textAlign='center'; ctx.textBaseline='bottom'; ctx.fillText(label,cx,y-2*k*dpr);
    if(i!=null) DIMS.push({i, px:v.z*cx+v.x, py:v.z*(y-2*k*dpr-fs*.55)+v.y, w:v.z*tw*1.4, h:v.z*fs*1.4}); }
  else { ctx.save(); ctx.translate(cx,y-4*k*dpr); ctx.rotate(-Math.PI/2); if(hot){ ctx.fillStyle='rgba(20,184,166,.2)'; ctx.fillRect(-tw*.1,-fs*.62,tw*1.2,fs*1.25); } ctx.fillStyle=dimCol; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(label,0,0); ctx.restore();
    if(i!=null) DIMS.push({i, px:v.z*cx+v.x, py:v.z*(y-4*k*dpr-tw*.5)+v.y, w:v.z*fs*1.6, h:v.z*tw*1.2}); } }
// v2: the geometry of a block end at a cross street, from the cross street's real (smoothed) centreline — shared by plan and 3D.
//   ext      each cross street, its centreline run on through the node to this block's far curb (its pavement crosses the block)
//   curbZ(x) where its curbs cross the line x = const: `near` on the block side, `far` beyond (null where it does not reach x)
//   fillet   the curb return at the block curb x = curbX: a circle of radius r tangent to the block's curb line and to the cross
//            street's actual curb line at whatever angle it meets; P corner point, C centre, TA / TB tangent points, arc(n) points
function endGeom(S_,i,cXL,cXR){ const LEN=S_.LEN, zc=i?LEN:0, sgn=i?1:-1, zEdge=i?S_.ZB:S_.ZA, half=S_.half[i]; const e=S_.EI[i];
  const ext=(e.segs||[]).map(o=>S_.C.streets.find(st=>st.s===o)).filter(Boolean).map(st=>{ const g=st.g; const atStart=Math.hypot(g[0][0],g[0][1]-zc)<Math.hypot(g[g.length-1][0],g[g.length-1][1]-zc); const run=(cXR-cXL)/2+1;
    return {st, m:st.m, g:atStart?extendLine(g,run,0):extendLine(g,0,run)}; });
  const curbZ=x=>{ let best=null; ext.forEach(E=>{ const hs=[]; [E.m.ctc/2,-E.m.ctc/2].forEach(off=>zCross(offsetLine(E.g,off),x).forEach(h=>{ if(Math.abs(h.z-zc)<E.m.ctc+12) hs.push(h); })); if(hs.length<2) return;
    const near=hs.reduce((p,q)=>(sgn>0?q.z<p.z:q.z>p.z)?q:p), far=hs.reduce((p,q)=>(sgn>0?q.z>p.z:q.z<p.z)?q:p); if(!best||Math.abs(near.z-zc)<Math.abs(best.near.z-zc)) best={near,far}; }); return best; };
  const fb=x=>curbZ(x)||{near:{z:zEdge,dx:1,dz:0},far:{z:zc+sgn*half,dx:1,dz:0}};
  const fillet=(curbX,ox,r)=>{ const h=fb(curbX).near; const P=[curbX,h.z]; const dl=Math.hypot(h.dx,h.dz)||1; const d=[h.dx/dl,h.dz/dl]; let nB=[-d[1],d[0]]; if(nB[1]*sgn>0) nB=[-nB[0],-nB[1]]; const nA=[ox,0];
    const det=nA[0]*nB[1]-nA[1]*nB[0]; if(Math.abs(det)<0.2) return null;   // cross curb nearly parallel to the block: no corner to round
    const vx=(r*nB[1]-nA[1]*r)/det, vz=(nA[0]*r-r*nB[0])/det; const C=[P[0]+vx,P[1]+vz]; const TA=[C[0]-nA[0]*r,C[1]-nA[1]*r], TB=[C[0]-nB[0]*r,C[1]-nB[1]*r];
    const t1=Math.atan2(TA[1]-C[1],TA[0]-C[0]); let dt=Math.atan2(TB[1]-C[1],TB[0]-C[0])-t1; while(dt>Math.PI) dt-=2*Math.PI; while(dt<-Math.PI) dt+=2*Math.PI;   // the short way round
    const arc=n=>Array.from({length:n+1},(_,k)=>{ const t=t1+dt*k/n; return [C[0]+Math.cos(t)*r, C[1]+Math.sin(t)*r]; });
    return {P,C,TA,TB,arc,ok:(TA[1]-zEdge)*sgn>-0.01}; };
  return {ext,curbZ,fb,fillet,zc,sgn,zEdge}; }
// v2: connectors from a path end to its path, routed clear of obstacles. Starts: the loop's outer curb (every 1–2 m round the ring)
// where the street ends in a loop, else a point 2.5 m beyond each bike lane's end. Targets: the path every 2 m within 80 m. The
// shortest start → target leg that crosses no building footprint and not the loop's island wins (the loop road and plazas are
// fine to cross); if every leg is blocked, the shortest one is used. Returns local polylines, already smoothed.
function pathConnectors(S_,e,i,bikes){ const F=S_.C.F, zEnd=i?S_.LEN:0, sgn=i?1:-1; const toL=g=>g.map(q=>F.toLocal(q[0],q[1]));
  const pg=smoothLine(toL(e.path.g),1); const loop=e.loop?toL(e.loop):null; const W=5.5;
  const cxy=loop?loop.reduce((a,p)=>[a[0]+p[0]/loop.length,a[1]+p[1]/loop.length],[0,0]):null;
  const island=loop?loop.map(p=>{ const d=Math.hypot(p[0]-cxy[0],p[1]-cxy[1])||1, k=Math.max(0,(d-W/2)/d); return [cxy[0]+(p[0]-cxy[0])*k, cxy[1]+(p[1]-cxy[1])*k]; }):null;
  const bb=r=>{ let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9; r.forEach(([x,z])=>{ x0=Math.min(x0,x); x1=Math.max(x1,x); z0=Math.min(z0,z); z1=Math.max(z1,z); }); return [x0,x1,z0,z1]; };
  const obst=[...S_.C.blds.map(b=>b.p), ...(island?[island]:[])].map(p=>({p,b:bb(p)}));
  const cross=(a,b,c,d)=>{ const o=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]); return o(a,b,c)*o(a,b,d)<0 && o(c,d,a)*o(c,d,b)<0; };
  const clear=(a,b)=>{ const x0=Math.min(a[0],b[0]), x1=Math.max(a[0],b[0]), z0=Math.min(a[1],b[1]), z1=Math.max(a[1],b[1]);
    return !obst.some(({p,b:B})=>{ if(B[1]<x0||B[0]>x1||B[3]<z0||B[2]>z1) return false; for(let k=0;k<p.length;k++){ if(cross(a,b,p[k],p[(k+1)%p.length])) return true; } return pointInRing((a[0]+b[0])/2,(a[1]+b[1])/2,p); }); };
  const targets=[...alongLine(pg,2,1).map(q=>[q[0],q[1]]), pg[0], pg[pg.length-1]];
  const best=starts=>{ let win=null, any=null; starts.forEach(s=>targets.forEach(t=>{ const d=Math.hypot(t[0]-s[0],t[1]-s[1]); if(d>80) return; if(!any||d<any.d) any={s,t,d}; if((!win||d<win.d) && clear(s,t)) win={s,t,d}; })); return win||any; };
  if(loop){ const outer=[]; for(let k=1;k<loop.length;k++){ const a=loop[k-1], b=loop[k]; for(let f=0;f<1;f+=0.5){ const p=[a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f]; const d=Math.hypot(p[0]-cxy[0],p[1]-cxy[1])||1; outer.push([p[0]+(p[0]-cxy[0])/d*W/2, p[1]+(p[1]-cxy[1])/d*W/2]); } }
    const r=best(outer); return r?[smoothLine([r.s,r.t],1)]:[]; }
  return bikes.map(b=>{ const p0=[b.x+b.w/2,zEnd-sgn*0.2], p1=[p0[0],zEnd+sgn*2.5]; const r=best([p1]); return r?smoothLine([p0,p1,r.t],2):null; }).filter(Boolean); }
function plen(g){ let L=0; for(let i=1;i<g.length;i++) L+=Math.hypot(g[i][0]-g[i-1][0],g[i][1]-g[i-1][1]); return L; }
// Zoom / pan handlers are attached once per canvas, but the redraw they call is refreshed on every draw, so a scroll always
// redraws the CURRENT option and widths (a captured first-draw closure used to redraw the first option ever opened).
function bind2D(canvas, redraw){ canvas._redraw=redraw; if(canvas.dataset.b) return; canvas.dataset.b='1'; const v=view(canvas.id); const loc=e=>{ const r=canvas.getBoundingClientRect(); return [(e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height]; };
  const rd=()=>canvas._redraw&&canvas._redraw();
  canvas.addEventListener('wheel',e=>{ e.preventDefault(); const [mx,my]=loc(e); const nz=clamp(v.z*Math.exp(-e.deltaY*0.0012),1,14); const k=nz/v.z; v.x=mx-(mx-v.x)*k; v.y=my-(my-v.y)*k; v.z=nz; clamp2D(canvas,v); rd(); },{passive:false});
  // v2: the proposed pane is editable — a press on a boundary handle drags the width, a click on an element selects it, anything else pans
  let drag=null;
  const hitHandle=(mx,my)=>{ const E=canvas._edit; if(!E) return null; let best=null,bd=14*devicePixelRatio; E.handles.forEach(h=>{ const d=Math.hypot(h.px-mx,h.py-my); if(d<bd){ bd=d; best=h; } }); return best; };
  const hitEl=(mx,my)=>{ const E=canvas._edit; if(!E||my<E.y0||my>E.y1) return -1; return E.els.findIndex(e=>e.k!=='sw'&&mx>=E.toPx(e.x)&&mx<E.toPx(e.x+e.w)); };
  // a dimension number is a control too: hover shows a text cursor, a click opens an inline box to type the width
  const hitDim=(mx,my)=>{ const E=canvas._edit; if(!E||!E.dims) return null; return E.dims.find(d=>Math.abs(mx-d.px)<=d.w/2&&Math.abs(my-d.py)<=d.h/2)||null; };
  canvas.addEventListener('mousedown',e=>{ const [mx,my]=loc(e); const h=hitHandle(mx,my); if(h){ const o=curOpt(); drag={h:h.i, mx, w0:[o.els[h.i-1].w,o.els[h.i].w]}; canvas._drag=h.i; e.preventDefault(); return; } if(hitDim(mx,my)){ drag={dim:true}; e.preventDefault(); return; } drag={pan:[e.clientX,e.clientY], moved:false}; });
  canvas.addEventListener('mousemove',e=>{ if(drag) return; const [mx,my]=loc(e); const h=hitHandle(mx,my); const hi=h?h.i:null; const dm=h?null:hitDim(mx,my); const di=dm?dm.i:null; canvas.style.cursor=h?'col-resize':dm?'text':(hitEl(mx,my)>=0?'pointer':''); if(hi!==canvas._hover||di!==canvas._hoverDim){ canvas._hover=hi; canvas._hoverDim=di; rd(); } });
  canvas.addEventListener('mouseleave',()=>{ if((canvas._hover!=null||canvas._hoverDim!=null)&&!drag){ canvas._hover=null; canvas._hoverDim=null; rd(); } });
  window.addEventListener('mousemove',e=>{ if(!drag) return; if(drag.h!==undefined){ const [mx]=loc(e); edDrag(curOpt(),drag.h,drag.w0,(mx-drag.mx)*canvas._edit.mPerPx); renderAll(true); return; }
    const r=canvas.getBoundingClientRect(); if(Math.hypot(e.clientX-drag.pan[0],e.clientY-drag.pan[1])>3) drag.moved=true; v.x+=(e.clientX-drag.pan[0])*canvas.width/r.width; v.y+=(e.clientY-drag.pan[1])*canvas.height/r.height; drag.pan=[e.clientX,e.clientY]; clamp2D(canvas,v); rd(); });
  window.addEventListener('mouseup',e=>{ if(!drag) return; if(drag.h!==undefined){ canvas._drag=null; drag=null; renderAll(); return; }
    if(drag.dim){ drag=null; if(e.target===canvas){ const [mx,my]=loc(e); const dm=hitDim(mx,my); if(dm) inlineEdit(canvas,dm); } return; }
    if(!drag.moved&&e.target===canvas&&canvas._edit){ const [mx,my]=loc(e); const i=hitEl(mx,my); selectEl(i>=0?i:null); } drag=null; });
  canvas.addEventListener('dblclick',()=>{ v.z=1; v.x=0; v.y=0; rd(); }); }
// the edit overlay: selection highlight and the boundary handles; returns the handle positions in canvas pixels for hit-testing
function editOverlay(ctx, canvas, els, v, dpr, X, top, bot, hyOf){ const k=1/v.z; const o=curOpt(); const handles=[]; const accent='#0F766E';
  if (D.sel!=null && els[D.sel]) { const e=els[D.sel]; ctx.fillStyle='rgba(20,184,166,.16)'; ctx.fillRect(X(e.x),top,(X(e.x+e.w)-X(e.x)),bot-top); ctx.strokeStyle=accent; ctx.lineWidth=2*k*dpr; ctx.strokeRect(X(e.x),top,(X(e.x+e.w)-X(e.x)),bot-top); }
  for (let i=1;i<els.length;i++){ const a=els[i-1], b=els[i]; if(a.k==='sw'||b.k==='sw') continue; const x=X(b.x), y=hyOf(i); const hot=canvas._hover===i||canvas._drag===i;
    if (hot){ ctx.strokeStyle=accent; ctx.lineWidth=1.2*k*dpr; ctx.setLineDash([4*k*dpr,3*k*dpr]); ctx.beginPath(); ctx.moveTo(x,top); ctx.lineTo(x,bot); ctx.stroke(); ctx.setLineDash([]);
      const fs=zoomFont(10.5*dpr,9*dpr,18*dpr,v,dpr); ctx.font=`${fs}px JetBrains Mono, monospace`; ctx.textBaseline='bottom'; const lab=fmt(a.w)+' | '+fmt(b.w); const tw=ctx.measureText(lab).width; ctx.fillStyle='rgba(15,23,42,.88)'; ctx.fillRect(x-tw/2-5*k*dpr,y-30*k*dpr,tw+10*k*dpr,16*k*dpr); ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.fillText(lab,x,y-16*k*dpr); }
    const hw=6*k*dpr, hh=12*k*dpr; ctx.fillStyle=hot?accent:'#fff'; ctx.strokeStyle=hot?accent:'rgba(15,23,42,.7)'; ctx.lineWidth=1*k*dpr; ctx.beginPath(); ctx.roundRect?ctx.roundRect(x-hw,y-hh,hw*2,hh*2,3*k*dpr):ctx.rect(x-hw,y-hh,hw*2,hh*2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle=hot?'#fff':'rgba(15,23,42,.55)'; [-2.5,0,2.5].forEach(d=>{ ctx.beginPath(); ctx.moveTo(x+d*k*dpr,y-5*k*dpr); ctx.lineTo(x+d*k*dpr,y+5*k*dpr); ctx.stroke(); });
    handles.push({i, px:v.z*x+v.x, py:v.z*y+v.y}); }
  return handles; }
// keep the block (its fitted box, stored by the renderer) at least 30% inside the viewport
function clamp2D(canvas,v){ const b=canvas._box; if(!b) return; const W=canvas.width,H=canvas.height; const sx0=v.z*b[0]+v.x, sx1=v.z*b[2]+v.x, sy0=v.z*b[1]+v.y, sy1=v.z*b[3]+v.y; const bw=sx1-sx0, bh=sy1-sy0; if(sx1<W*0.3) v.x+=W*0.3-sx1; if(sx0>W*0.7) v.x-=sx0-W*0.7; if(sy1<H*0.3) v.y+=H*0.3-sy1; if(sy0>H*0.7) v.y-=sy0-H*0.7; if(v.z<=1.001){ v.x=0; v.y=0; } }
function prep(canvas){ const p=canvas.parentElement; canvas.width=p.clientWidth*devicePixelRatio; canvas.height=p.clientHeight*devicePixelRatio; }
function sceneCtx(els){ const c=D.ctx; const total=layout(els); const xL=els[0].x, xR=xL+total;
  const LEN=c.seg.len; const EI=endInfo(c.seg);   // the whole block, intersection to intersection (no 200 m cap)
  const ix=(c.seg.ix||[null,null]);
  const cw=EI.map((e,i)=>e.type==='cross' && !!(ix[i]&&ix[i].sig));   // marked crosswalks at signalised intersections only (EDM §8.8.1.7)
  const half=EI.map(e=>e.type==='cross'?Math.max(4,(e.w-7.2)/2):0);
  const ZA=half[0], ZB=LEN-half[1], RAD=5;
  const CTXW=22;                                   // how far beyond the property line we show
  const sceneXL=xL-CTXW, sceneXR=xR+CTXW;
  // real building footprints near the block, in its local frame
  const C=cityContext(c.seg, Math.max(LEN,140)*1.5);
  const frontage=sd=>{ const near=C.blds.filter(b=>{ const [bx,bz]=b.c; return bz>-8&&bz<LEN+8 && (sd==='L'? bx<xL+1 : bx>xR-1) && Math.abs(bx)<Math.abs(xL)+40; });
    if(!near.length) return {has:false, sb:6, h:0};
    const sbs=near.map(b=>Math.min(...b.p.map(q=>Math.abs(q[0])))-Math.abs(sd==='L'?xL:xR)).map(v=>Math.max(0,v)).sort((a,b)=>a-b);
    const hs=near.map(b=>b.h).sort((a,b)=>a-b);
    return {has:true, sb:sbs[Math.floor(sbs.length/2)], h:hs[Math.floor(hs.length/2)], n:near.length}; };
  const CL=frontage('L'), CR=frontage('R');
  // v2: the block's level (OSM layer; 6 m per level in 3D and section) and, when it is on a structure, the wider same-level
  // deck that carries it (the City maps the Granville Bridge and its centre connector as two streets on one deck): the block's
  // outer zones are then that deck's remaining lanes, left transparent, not sidewalks
  const lvl=lvlOf(c.seg), deckH=lvl*6.0; let host=null;
  if(lvl>0){ const zs=[]; for(let z=ZA+2;z<ZB-2;z+=8) zs.push(z); C.streets.forEach(st=>{ if(st.lvl!==lvl||st.m.ctc<=c.ctc+1) return; const n=zs.filter(z=>nearOnPoly([0,z],st.g)[0]<c.ctc/2).length; if(zs.length&&n/zs.length>=0.6&&(!host||st.m.ctc>host.m.ctc)) host=st; }); }
  // the block's own surface profile: on the host deck's surface where there is one (the proposal rides the existing road), else its
  // level at each end — a ramp block runs as one grade, so it meets the decks it joins without a step
  const prof = host ? [deckAtSt(host,0,0), deckAtSt(host,0,LEN)] : [nodeH(c.seg,0), nodeH(c.seg,1)]; const deckHm=(prof[0]+prof[1])/2;
  return {c, els, total, xL, xR, CL, CR, CTXW, leftW:CTXW, rightW:CTXW, sceneXL, sceneXR, LEN, ZA, ZB, half, RAD, C, EI, legs:[endLegs(c.seg,0),endLegs(c.seg,1)], lvl, deckH:lvl>0?deckHm:0, prof, host,
          lanes:D.city?c.ln:{L:[],R:[]}, LW:3.6, ix, cw, sig:ix.map(e=>!!(e&&e.sig)), tr:D.city?c.tr:{}, stops:c.stops||{L:[],R:[]}, racks:c.racks||{L:0,R:0}, t:ANIM.t}; }
const inLaneAt=(S,sd,z)=>(S.lanes[sd]||[]).some(p=>z>p-2.1&&z<p+2.1);

// ── PLAN ────────────────────────────────────────────────────────────────────
function drawPlanTo(canvas, els, opts){ prep(canvas); if(canvas.width<40||canvas.height<40) return;   // hidden / not laid out yet: nothing to draw into
  bind2D(canvas, ()=>drawPlanTo(canvas, els, opts)); const v=view(canvas.id);
  const ctx=canvas.getContext('2d'), W=canvas.width, H=canvas.height, dpr=devicePixelRatio; const ANN=D.ann!==false;   // Annotations toggle
  ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle='#F4F3EF'; ctx.fillRect(0,0,W,H);
  const S_=sceneCtx(els); const {c,xL,xR,CL,CR,leftW,rightW,sceneXL,sceneXR,LEN,LW,ZA,ZB,RAD,EI}=S_; const sceneW=sceneXR-sceneXL;
  const padL=40*dpr,padR=70*dpr,padT=30*dpr,padB=100*dpr;
  const S=Math.min((W-padL-padR)/sceneW,(H-padT-padB)/LEN);
  const ox=padL+((W-padL-padR)-sceneW*S)/2-sceneXL*S, oyB=padT+((H-padT-padB)-LEN*S)/2+LEN*S;
  ctx.setTransform(v.z,0,0,v.z,v.x,v.y);
  const X=x=>ox+x*S, Y=z=>oyB-z*S, R=rng(5);
  // the part of the world that is on screen at this zoom / pan (labels are placed on what is visible, not on the whole block)
  const VIS={x0:((0-v.x)/v.z-ox)/S, x1:((W-v.x)/v.z-ox)/S, z0:(oyB-(H-v.y)/v.z)/S, z1:(oyB-(0-v.y)/v.z)/S};
  const LWT=lineWeights(v,dpr);
  const rect=(x0,z0,w,dz,f)=>{ctx.fillStyle=f;ctx.fillRect(X(x0),Y(z0+dz),w*S,dz*S);};
  const asphalt=(x0,z0,w,dz)=>rect(x0,z0,w,dz,'#A9ABA9');
  const paving=(x0,z0,w,dz)=>{rect(x0,z0,w,dz,'#E3E0D8');ctx.strokeStyle='rgba(90,85,80,.22)';ctx.lineWidth=LWT.hair;ctx.beginPath();for(let z=z0;z<=z0+dz+1e-6;z+=1.5){ctx.moveTo(X(x0),Y(z));ctx.lineTo(X(x0+w),Y(z));}ctx.stroke();};
  const planting=(x0,z0,w,dz)=>rect(x0,z0,w,dz,'#CFD9B8');
  const bcut=(x0,z0,w,dz)=>{rect(x0,z0,w,dz,'#ECE9E1');ctx.strokeStyle='rgba(40,40,40,.7)';ctx.lineWidth=LWT.light;ctx.strokeRect(X(x0),Y(z0+dz),w*S,dz*S);};
  const shadow=(cx,cz,rx,rz,a)=>{ctx.fillStyle=`rgba(30,30,30,${a*.6})`;ctx.beginPath();ctx.ellipse(X(cx)+S*.2,Y(cz)+S*.2,rx*S,rz*S,0,0,Math.PI*2);ctx.fill();};
  canvas._box=[X(sceneXL),Y(LEN),X(sceneXR),Y(0)];
  // building footprints (2015 layer) — drawn once, complete; the streets are painted over them so a footprint never shows on a road
  const drawBlds=()=>{ ctx.strokeStyle='rgba(40,40,40,.55)'; ctx.lineWidth=LWT.light; S_.C.blds.forEach(b=>{ ctx.fillStyle=b.f?'#F0DFC2':'#EDEBE5'; ctx.beginPath(); b.p.forEach((q,i)=>{ i?ctx.lineTo(X(q[0]),Y(q[1])):ctx.moveTo(X(q[0]),Y(q[1])); }); ctx.closePath(); ctx.fill(); ctx.stroke(); }); };
  const stroke=(g,w,col)=>{ if(g.length<2) return; ctx.strokeStyle=col; ctx.lineWidth=w; ctx.beginPath(); g.forEach(([x,z],i)=>{ i?ctx.lineTo(X(x),Y(z)):ctx.moveTo(X(x),Y(z)); }); ctx.stroke(); };
  const poly=(g,w,col,dash)=>{ ctx.strokeStyle=col; ctx.lineWidth=Math.max(.8,w*S); ctx.setLineDash(dash?dash.map(d=>d*S):[]); ctx.beginPath(); g.forEach(([x,z],i)=>{ i?ctx.lineTo(X(x),Y(z)):ctx.moveTo(X(x),Y(z)); }); ctx.stroke(); ctx.setLineDash([]); };
  // path drawing language — NOT a protected lane: a paved path with hairline edges and a dashed centreline (two-way), a faint
  // green-grey where it is a designated cycleway, plain where bikes share it; decks get medium edges; connectors dashed edges
  const pathP=(g,w,o)=>{ if(g.length<2) return; ctx.lineJoin='round'; ctx.lineCap='round'; stroke(g,w*S,o.des?'#DCE4D5':'#E8E4DA'); ctx.lineCap='butt';
    ctx.strokeStyle=o.up?'rgba(40,40,40,.7)':'rgba(90,85,75,.6)'; ctx.lineWidth=o.up?LWT.med:LWT.hair; ctx.setLineDash(o.conn?[1.2*S,0.8*S]:[]);
    [-w/2,w/2].forEach(off=>{ ctx.beginPath(); offsetLine(g,off).forEach(([x,z],i)=>{ i?ctx.lineTo(X(x),Y(z)):ctx.moveTo(X(x),Y(z)); }); ctx.stroke(); }); ctx.setLineDash([]);
    if(!o.ow) poly(g,0.08,'rgba(120,115,105,.7)',[0.8,1.6]); };
  // a turnaround loop (closed OSM ring = the loop road's centreline): planted central island, the ring road, curbs both sides
  const drawLoop=(ring,w,rec)=>{ if(ring.length<4) return; const path=g=>{ ctx.beginPath(); g.forEach(([x,z],i)=>{ i?ctx.lineTo(X(x),Y(z)):ctx.moveTo(X(x),Y(z)); }); ctx.closePath(); };
    // a cul-de-sac bulb (OSM turning_circle) is one paved disc with a curb round it — no ring road, no island
    if(rec&&rec.bulb&&rec.hw==='turning_circle'){ ctx.fillStyle='#A9ABA9'; path(ring); ctx.fill(); ctx.strokeStyle='rgba(40,40,40,.7)'; ctx.lineWidth=LWT.light; ctx.lineJoin='round'; path(ring); ctx.stroke(); return; }
    ctx.fillStyle='#D6DDC6'; path(ring); ctx.fill();
    ctx.strokeStyle='#A9ABA9'; ctx.lineWidth=w*S; ctx.lineJoin='round'; path(ring); ctx.stroke();
    ctx.strokeStyle='rgba(40,40,40,.7)'; ctx.lineWidth=LWT.light; [-w/2,w/2].forEach(off=>{ const o=offsetLine([...ring,ring[1]],off).slice(0,ring.length); path(o); ctx.stroke(); }); };
  if (D.city) { const C=cityContext(c.seg, Math.max(LEN,140)*1.5);
    // ── city context: black & white; only the proposed block carries colour ──
    ctx.fillStyle='#D7E2E8'; ctx.fillRect(X(sceneXL-3000),Y(LEN+3000),6000*S,6000*S);       // water (near-grey blue)
    ctx.fillStyle='#F6F5F2'; C.water.forEach(r=>{ ctx.beginPath(); r.forEach(([x,z],i)=>{ i?ctx.lineTo(X(x),Y(z)):ctx.moveTo(X(x),Y(z)); }); ctx.closePath(); ctx.fill(); });
    ctx.lineCap='butt'; ctx.lineJoin='round';
    // public plazas (OSM pedestrian areas) as paving, then building footprints; the street right-of-way covers any footprint
    // that strays past the property line
    ctx.fillStyle='#ECE8DF'; ctx.strokeStyle='rgba(90,85,75,.35)'; ctx.lineWidth=LWT.hair; C.plazas.forEach(r=>{ ctx.beginPath(); r.forEach(([x,z],i)=>{ i?ctx.lineTo(X(x),Y(z)):ctx.moveTo(X(x),Y(z)); }); ctx.closePath(); ctx.fill(); ctx.stroke(); });
    drawBlds();
    // full street sections in grey. The sidewalk band stops at the crossing street's curb line and the pavement runs on to
    // its far curb, so junctions come out as clean rectangles with no discs or overlapping bands.
    // v2: viaducts and bridges (OSM bridge=yes / layer ≥ 1, or the name) are structures over the surface streets. They are drawn in
    // a second pass, on top, and cast a shadow: the deck outline shifted 2.4 m south-east per level (sun from the north-west, the
    // usual plan convention), so it reads as raised above whatever it passes over
    const elevated=st=>st.up&&st.deck&&Math.max(st.deck[0],st.deck[1],st.deck[2])>0.5;
    const u=C.F.u, sh=lv=>{ const wx=2.4*lv, wy=-2.4*lv; return [wx*u[1]-wy*u[0], wx*u[0]+wy*u[1]]; }, shift=(g,d)=>g.map(([x,z])=>[x+d[0],z+d[1]]);
    const hostedLanes=list=>list.forEach(h=>{ const base=h.g;
      bikewayLanes(h.b,h.ctc,'L').forEach(l=>{
        if(l.kind==='shared'){ [-h.ctc/4,h.ctc/4].forEach(off=>poly(offsetLine(base,off),0.5,'rgba(110,135,120,.75)',[1.2,10])); return; }
        const cg=offsetLine(base,l.off); poly(cg,l.w,l.kind==='prot'?'rgba(125,165,135,.85)':'rgba(165,185,170,.7)');
        if(l.kind==='prot') poly(offsetLine(cg,(l.off<0?1:-1)*(l.w/2+0.3)),0.6,'#CFCCC4'); }); });
    // a polyline with the pieces inside other structures removed (sampled every 1.5 m): lines of one deck never run across another
    const dropInside=(g,isIn)=>{ if(g.length<2) return []; const pts=[g[0],...alongLine(g,1.5,0.75).map(q=>[q[0],q[1]]),g[g.length-1]]; const runs=[]; let run=[]; pts.forEach(p=>{ if(isIn(p)){ if(run.length>1) runs.push(run); run=[]; } else run.push(p); }); if(run.length>1) runs.push(run); return runs; };
    const drawStreets=(list,up)=>{
      list.forEach(st=>{ st._band=trimLine(st.g,st.trim[0],st.trim[1]); st._pav=extendLine(st.g,st.trim[0],st.trim[1]); });
      // structures at one level are one surface: a point inside another (wider) deck's carriageway, or inside the block's own
      // deck when the block is elevated, gets no line and no marking from this street — a ramp's edges start where it leaves the deck
      // edges: inside ANY other structure at this level → no line, so what remains is the outline of the union — a ramp's edge
      // and the deck's edge meet at the point of divergence and the join tapers; markings: only a wider structure silences them
      const inBlock=p=>S_.lvl>0 && Math.abs(p[0])<S_.c.ctc/2-0.25 && p[1]>0 && p[1]<LEN;
      const inOther=(st,p)=>list.some(o=>o!==st && o.m.ctc>=st.m.ctc-0.01 && nearOnPoly(p,o._pav)[0]<o.m.ctc/2-0.25) || inBlock(p);
      const inOtherEdge=(st,p)=>list.some(o=>o!==st && nearOnPoly(p,o._pav)[0]<o.m.ctc/2-0.25) || inBlock(p);
      // a deck's band: bridges carry a sidewalk (up to 2.25 m a side), a one-way ramp only its parapet — not the 3.6 m boulevard the right-of-way implies
      const bandW=st=>up ? (st.m.ow ? st.m.ctc+1.2 : Math.min(st.row, st.m.ctc+4.5)) : st.row;
      if(up){ // one shadow for everything at this level (decks, ramps, deck paths, the block's own deck): drawn once through an
        // offscreen mask so overlaps do not darken twice, and the deck outlines read as one structure
        const sc=document.createElement('canvas'); sc.width=W; sc.height=H; const c2=sc.getContext('2d'); c2.setTransform(v.z,0,0,v.z,v.x,v.y); c2.lineCap='round'; c2.lineJoin='round'; c2.strokeStyle='#000'; c2.fillStyle='#000';
        const sp=(g,w)=>{ if(g.length<2) return; c2.lineWidth=w; c2.beginPath(); g.forEach(([x,z],i)=>{ i?c2.lineTo(X(x),Y(z)):c2.moveTo(X(x),Y(z)); }); c2.stroke(); };
        list.forEach(st=>sp(shift(st._pav,sh(st.lvl||1)),(bandW(st)+1)*S)); C.osmPaths.filter(p=>p.up).forEach(p=>sp(shift(p.g,sh(p.lvl||1)),((p.ow?2:3)+1)*S));
        if(S_.lvl>0){ const d=sh(S_.lvl); c2.fillRect(X(xL+d[0]),Y(LEN+d[1]),(xR-xL)*S,LEN*S); }
        ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha=0.17; ctx.drawImage(sc,0,0); ctx.restore(); }
      // the sidewalk band runs to the node (the crossing street's pavement, painted next, covers the part inside it), so at a
      // T-junction the sidewalk on the side with no crossing street is continuous; decks: every band first, then every pavement,
      // so where a ramp leaves the deck the surfaces merge
      list.forEach(st=>stroke(up?st._pav:st.g, bandW(st)*S, up?'#DBD8D0':'#E3E0D8'));
      list.forEach(st=>stroke(st._pav, Math.max(1,st.m.ctc*S), up?'#9EA09F':'#A9ABA9'));
      // existing lane markings from each street's traffic model: yellow centreline on two-way streets,
      // dashed lane lines where the width gives more than one lane per direction, faint parking-lane edges
      ctx.lineCap='butt'; list.forEach(st=>{ streetMarkings(st).forEach(mk=>{ const col=mk.kind==='centre'?'rgba(255,214,0,.85)':mk.kind==='park'?'rgba(255,255,255,.4)':'rgba(255,255,255,.85)'; (up?dropInside(mk.g,p=>inOther(st,p)):[mk.g]).forEach(r=>poly(r, mk.w, col, mk.dash)); }); });
      // curb and property lines (a structure's edges read darker; a deck's outer line is its parapet), stopping at a crossing
      // street only on the side it leaves from (per-side trims); on decks, only outside every other structure
      list.forEach(st=>{ const bw=bandW(st); [st.m.ctc/2, -st.m.ctc/2, bw/2, -bw/2].forEach((off,k)=>{ const sd=off>0?'R':'L'; const g=up?st._pav:trimLine(st.g, st.trimLR[0][sd], st.trimLR[1][sd]); if(g.length<2) return;
        ctx.strokeStyle = k<2 ? 'rgba(40,40,40,.6)' : (up?'rgba(40,40,40,.8)':'rgba(40,40,40,.3)'); ctx.lineWidth = k<2 ? (up?LWT.med:LWT.light) : (up?LWT.med:LWT.hair);
        const og=offsetLine(g,off); (up?dropInside(og,p=>inOtherEdge(st,p)):[og]).forEach(r=>{ ctx.beginPath(); r.forEach(([x,z],i)=>{ i?ctx.lineTo(X(x),Y(z)):ctx.moveTo(X(x),Y(z)); }); ctx.stroke(); }); }); }); };
    // surface level: streets, turnaround loops (OSM, e.g. the loop at the end of 0 Smithe), surface paths, the lanes on surface
    // streets; then the bridge level (shadows, decks, deck paths, lanes on decks) over all of it
    drawStreets(C.streets.filter(st=>!elevated(st)),false);
    C.loops.forEach(l=>drawLoop(l.g, Math.max(5.5,(l.ln||1)*4.5), l));
    C.osmPaths.filter(p=>!p.up).forEach(p=>pathP(p.g,p.ow?2.0:3.0,p));
    C.bikePaths.forEach(p=>pathP(p.g,p.d==='OW'?2.0:3.0,{des:p.sub==='OSB'||p.t==='Protected Bike Lanes',ow:p.d==='OW'}));   // City pieces with no OSM path and no street: same path language
    hostedLanes(C.bikeHosted.filter(h=>!h.st.up));
    // v2: a structure that passes OVER the block (a ramp above a street being designed) is drawn after the proposal, with its
    // shadow falling on it, so the plan reads the right way up; decks at the block's own level (or elsewhere) are drawn now
    const bh=z=>S_.prof[0]+(S_.prof[1]-S_.prof[0])*z/LEN;
    const overBlock=(g,hAt)=>{ const pts=[g[0],...alongLine(g,3,1.5).map(q=>[q[0],q[1]]),g[g.length-1]]; return pts.some(p=>Math.abs(p[0])<xR-xL && p[1]>-2 && p[1]<LEN+2 && hAt(p)>bh(p[1])+0.5); };
    const upS=C.streets.filter(elevated), overS=upS.filter(st=>overBlock(st.g,p=>deckAtSt(st,p[0],p[1]))), sameS=upS.filter(st=>!overS.includes(st));
    const upP=C.osmPaths.filter(p=>p.up), overP=upP.filter(p=>overBlock(p.g,()=>(p.lvl||1)*6)), sameP=upP.filter(p=>!overP.includes(p));
    drawStreets(sameS,true); sameP.forEach(p=>pathP(p.g,p.ow?2.0:3.0,p)); hostedLanes(C.bikeHosted.filter(h=>h.st.up&&!overS.includes(h.st)));
    S_.drawOver=()=>{ if(!overS.length&&!overP.length) return; drawStreets(overS,true); overP.forEach(p=>pathP(p.g,p.ow?2.0:3.0,p)); hostedLanes(C.bikeHosted.filter(h=>overS.includes(h.st))); };
    C.nodes.forEach(nd=>{ const r=Math.max(6,(nd.row-7.2)/2);
      if(nd.sig){ ctx.fillStyle='#2F3B45'; ctx.fillRect(X(nd.x+r*.75)-.2*S,Y(nd.z+r*.75)-.2*S,.4*S,.4*S); ctx.fillStyle='#34C759'; ctx.beginPath(); ctx.arc(X(nd.x+r*.75),Y(nd.z+r*.75),.1*S,0,Math.PI*2); ctx.fill(); } });
    // street names with their existing traffic (class · speed · lanes · direction · parking · bus/truck · facility).
    // Labels never overlap: one per street name (nearest block wins), none on the cross streets at the block's ends (they get
    // the dedicated label there), none inside the reserved zone around the block and its dimension strings, and each new
    // label is skipped if its box touches one already placed.
    // v2: text scales with the zoom, but gently (square root of the zoom factor, capped), so names stay readable at every level, and
    // the room a label needs is judged at the current zoom — streets and details that did not fit at the overview appear as you zoom in
    ctx.textAlign='center'; ctx.textBaseline='middle'; const fsN=zoomFont(Math.min(12*dpr,S*1.3),8*dpr,18*dpr,v,dpr), fsI=fsN*.82;
    const placed=[[X(sceneXL)-8*dpr, Y(LEN)-16*dpr, X(sceneXR)+64*dpr, Y(0)+104*dpr]];   // block + dimension strings + scale bar
    const hit=r=>placed.some(p=>!(r[2]<p[0]||r[0]>p[2]||r[3]<p[1]||r[1]>p[3]));
    const crossSegs=new Set(); S_.EI.forEach(e=>(e.segs||[]).forEach(o=>crossSegs.add(o)));
    const seen=new Set(); crossSegs.forEach(o=>seen.add(o.n));   // the cross streets' names are taken by their dedicated labels
    if(ANN) C.streets.slice().sort((p,q)=>{ const mp=p.g[Math.floor(p.g.length/2)], mq=q.g[Math.floor(q.g.length/2)]; return Math.hypot(mp[0],mp[1]-LEN/2)-Math.hypot(mq[0],mq[1]-LEN/2); }).forEach(st=>{ const m=st.m; if(crossSegs.has(st.s)||seen.has(m.n)) return; const mid0=st.g[Math.floor(st.g.length/2)]; if(Math.hypot(mid0[0],mid0[1]-LEN/2)>Math.max(LEN,140)*1.15) return;
      // label the on-screen part of the street: as you zoom and pan, the name sits on whatever piece is in view
      const pieces=clipPoly(st.g,VIS); if(!pieces.length) return; const vg=pieces.reduce((p,q)=>plen(q)>plen(p)?q:p); const a=vg[0], b=vg[vg.length-1];
      const dxs=X(b[0])-X(a[0]), dys=Y(b[1])-Y(a[1]); const Lpx=Math.hypot(dxs,dys); if(Lpx*v.z<70*dpr) return; let ang=Math.atan2(dys,dxs); if(ang>Math.PI/2||ang<-Math.PI/2) ang+=Math.PI;
      const full=trafficLabel(m), short=`${m.spd} km/h · ${m.lanes} ${m.lanes>1?'lanes':'lane'}${m.ow?' · one-way':''}${m.bus?' · bus':''}`;
      // the label stays inside the pavement (never on the sidewalk band): two lines when the carriageway is tall enough for
      // 2.4 em at this zoom, otherwise the name alone, sized to the carriageway
      const room=m.ctc*S*0.9; let fN=Math.min(fsN, room/2.4); const twoL=fN*v.z>=6*dpr; if(!twoL) fN=Math.min(fsN, room/1.2); const fI=fN*.82;
      ctx.font=`${fI}px Inter`; const info=ctx.measureText(full).width<Lpx-16*dpr?full:short; const showInfo=twoL && ctx.measureText(info).width<Lpx-10*dpr; const wI=showInfo?ctx.measureText(info).width:0;
      ctx.font=`600 ${fN}px Inter`; const wN=ctx.measureText(titleCase(m.n)).width; if(wN>Lpx-6*dpr) return; const w=Math.max(wN,wI)+6*dpr, h=(showInfo?fN+fI:fN)*1.5;
      const cxp=(X(a[0])+X(b[0]))/2, cyp=(Y(a[1])+Y(b[1]))/2; const bw=Math.abs(w*Math.cos(ang))+Math.abs(h*Math.sin(ang)), bh=Math.abs(w*Math.sin(ang))+Math.abs(h*Math.cos(ang)); const rect=[cxp-bw/2,cyp-bh/2,cxp+bw/2,cyp+bh/2];
      if(hit(rect)) return; placed.push(rect); seen.add(m.n);
      ctx.save(); ctx.translate(cxp,cyp); ctx.rotate(ang);
      ctx.fillStyle='rgba(55,65,75,.9)'; ctx.fillText(titleCase(m.n),0,showInfo?-fN*.7:0);
      if(showInfo){ ctx.font=`${fI}px Inter`; ctx.fillStyle='rgba(75,85,95,.85)'; ctx.fillText(info,0,fI*.9); } ctx.restore(); });
    ctx.lineCap='round';
  }
  const withGaps=(fn,x0,w,sd)=>{ const ps=(S_.lanes[sd]||[]).filter(p=>p>ZA+2&&p<ZB-2).sort((a,b)=>a-b); let z=ZA; ps.forEach(p=>{ const a=p-LW/2; if(a-z>0.05) fn(x0,z,w,a-z); asphalt(x0,a,w,LW); z=a+LW; }); if(ZB-z>0.05) fn(x0,z,w,ZB-z); };
  // private land beyond the property line (only when the city layer isn't already providing ground), then the footprints
  if (!D.city) { rect(sceneXL,0,xL-sceneXL,LEN,'#EFEEE9'); rect(xR,0,sceneXR-xR,LEN,'#EFEEE9'); drawBlds(); }
  // v2: a block on a structure sits on its own deck slab (unless a wider deck already carries it); its outer zones are deck
  // edges — over a host deck they stay transparent so the deck's remaining lanes show through, and they carry parapets, not PL
  if(S_.lvl>0 && !S_.host) rect(xL,0,xR-xL,LEN,'#DBD8D0');
  const swPaint=S_.host?((x0,z0,w,dz)=>{}):(S_.lvl>0?((x0,z0,w,dz)=>rect(x0,z0,w,dz,'#E3E0D8')):paving);   /* an existing deck sidewalk is context: plain, no scoring */
  // elements
  els.forEach(e=>{ const sd=e.side==='C'?'R':e.side; if(e.k==='sw') withGaps(swPaint,e.x,e.w,sd); else if(e.k==='bike'){ asphalt(e.x,ZA,e.w,ZB-ZA); rect(e.x,ZA,e.w,ZB-ZA,'rgba(96,150,110,.45)'); } else if(e.k==='buf'){ withGaps((x0,z0,w,dz)=>{ rect(x0,z0,w,dz, SEP[e.sep].bufKind==='barrier'?'#B5B3AC':SEP[e.sep].bufKind==='raisedlane'?'#DAD7CF':'#CFCCC4'); if(SEP[e.sep].bufKind==='painted'||SEP[e.sep].bufKind==='paint') { rect(x0,z0,w,dz,'#A6A5A2'); ctx.strokeStyle='rgba(255,255,255,.85)'; ctx.lineWidth=Math.max(1,S*.08); for(let z=z0;z<z0+dz;z+=1.2){ ctx.beginPath(); ctx.moveTo(X(x0),Y(z)); ctx.lineTo(X(x0+w),Y(z+.6)); ctx.stroke(); } } },e.x,e.w,sd); } else asphalt(e.x,ZA,e.w,ZB-ZA); });
  ctx.setLineDash([]);
  if(S_.lvl>0 && !S_.host){ ctx.strokeStyle='rgba(40,40,40,.85)'; ctx.lineWidth=LWT.med; [xL,xR].forEach(x=>{ ctx.beginPath(); ctx.moveTo(X(x),Y(0)); ctx.lineTo(X(x),Y(LEN)); ctx.stroke(); }); }   // parapet: the deck's edge
  else if(!S_.host){ ctx.strokeStyle='rgba(15,23,42,.7)'; ctx.lineWidth=LWT.light; ctx.setLineDash([6,3,1.5,3].map(d=>d*LWT.f)); [xL,xR].forEach(x=>{ ctx.beginPath(); ctx.moveTo(X(x),Y(-12)); ctx.lineTo(X(x),Y(LEN+12)); ctx.stroke(); }); ctx.setLineDash([]); }
  if(ANN&&!S_.host){ const tag=S_.lvl>0?'deck edge':'PL'; ctx.fillStyle='rgba(15,23,42,.7)'; ctx.font=`${Math.max(7,S*.38)}px JetBrains Mono`; ctx.textBaseline='bottom'; ctx.textAlign='right'; ctx.fillText(tag, X(xL)-2, Y(LEN*0.5)); ctx.textAlign='left'; ctx.fillText(tag, X(xR)+2, Y(LEN*0.5)); }
  // the block's curb lines beyond its section: only where the street carries straight on or dead-ends (at a cross street the curb return takes over)
  const _sw=els.filter(e=>e.k==='sw'); ctx.strokeStyle='rgba(40,40,40,.85)'; ctx.lineWidth=LWT.heavy; [_sw[0].x+_sw[0].w, _sw[_sw.length-1].x].forEach(x=>{ ctx.beginPath(); if(EI[0].type!=='cross'){ ctx.moveTo(X(x),Y(0)); ctx.lineTo(X(x),Y(ZA)); } if(EI[1].type!=='cross'){ ctx.moveTo(X(x),Y(ZB)); ctx.lineTo(X(x),Y(LEN)); } ctx.stroke(); });
  // the block's own curb lines (carriageway edge) are the heavy line of the drawing; the edges of the proposed elements are medium
  [_sw[0].x+_sw[0].w, _sw[_sw.length-1].x].forEach(x=>{ ctx.beginPath(); ctx.moveTo(X(x),Y(ZA)); ctx.lineTo(X(x),Y(ZB)); ctx.stroke(); });
  ctx.strokeStyle='rgba(40,40,40,.7)'; ctx.lineWidth=LWT.med;
  els.forEach(e=>{ if(e.k==='travel'||e.k==='park'||e.k==='sw') return; ctx.beginPath(); ctx.moveTo(X(e.x),Y(ZA)); ctx.lineTo(X(e.x),Y(ZB)); ctx.moveTo(X(e.x+e.w),Y(ZA)); ctx.lineTo(X(e.x+e.w),Y(ZB)); ctx.stroke(); });
  // markings
  const white='rgba(255,255,255,.92)'; const sw=els.filter(e=>e.k==='sw'); const cXL=sw[0].x+sw[0].w, cXR=sw[1].x;
  const travel=els.filter(e=>e.k==='travel'), park=els.filter(e=>e.k==='park'), bikes=els.filter(e=>e.k==='bike');
  const ends=[S_.cw[0]?1:0, S_.cw[1]?1:0]; const EL=[endLayout(!!S_.cw[0]), endLayout(!!S_.cw[1])];
  // motor-vehicle markings start behind the vehicle stop bar, bike markings behind the bicycle stop bar (EDM §8.9.1.8)
  const z0m = ZA + (EI[0].type==='cross'?EL[0].carStart:(isStop(EI[0])?5.0:0.5)), z1m = ZB - (EI[1].type==='cross'?EL[1].carStart:(isStop(EI[1])?5.0:0.5));
  const zb0 = ZA + (EI[0].type==='cross'?EL[0].bikeStart:(EI[0].type==='dead'?5.0:EI[0].type==='path'?1.0:0.5)), zb1 = ZB - (EI[1].type==='cross'?EL[1].bikeStart:(EI[1].type==='dead'?5.0:EI[1].type==='path'?1.0:0.5));   // at a path end the lane runs on to the hand-over
  const zp0 = EI[0].type==='cross'?ZA+IX.setback+0.5:z0m, zp1 = EI[1].type==='cross'?ZB-IX.setback-0.5:z1m;   // where posts / planters / barrier may stand
  travel.forEach((tl,i)=>{ if(i===0) return; const centre=!tl.ow&&(tl.side==='C'||travel[i-1].side!==tl.side); ctx.strokeStyle=centre?'rgba(255,214,0,.95)':white; ctx.lineWidth=Math.max(1,S*.1); ctx.setLineDash(centre?[]:[S*2,S*1.5]); ctx.beginPath(); ctx.moveTo(X(tl.x),Y(z0m)); ctx.lineTo(X(tl.x),Y(z1m)); ctx.stroke(); ctx.setLineDash([]); });
  park.forEach(pk=>{ ctx.strokeStyle=white; ctx.lineWidth=Math.max(1,S*.1); for(let z=z0m+1;z<z1m;z+=6){ ctx.beginPath(); ctx.moveTo(X(pk.x),Y(z)); ctx.lineTo(X(pk.x+pk.w),Y(z)); ctx.stroke(); } });
  const glyph=(cx,cz,dir)=>{ ctx.strokeStyle=white; ctx.fillStyle=white; ctx.lineWidth=Math.max(1,S*.08); const r=.22*S; [-.3,.3].forEach(dz=>{ctx.beginPath();ctx.arc(X(cx),Y(cz+dz*dir),r,0,Math.PI*2);ctx.stroke();}); ctx.beginPath();ctx.moveTo(X(cx),Y(cz-.3*dir));ctx.lineTo(X(cx+.2),Y(cz));ctx.lineTo(X(cx),Y(cz+.3*dir));ctx.stroke(); ctx.beginPath();ctx.ellipse(X(cx),Y(cz+.05*dir),.1*S,.18*S,0,0,Math.PI*2);ctx.fill(); };
  const arrow=(cx,cz,dir)=>{ ctx.fillStyle=white; const L=1,hw=.26; ctx.beginPath(); ctx.moveTo(X(cx-.07),Y(cz-L/2*dir));ctx.lineTo(X(cx+.07),Y(cz-L/2*dir));ctx.lineTo(X(cx+.07),Y(cz+L*.15*dir));ctx.lineTo(X(cx+hw),Y(cz+L*.15*dir));ctx.lineTo(X(cx),Y(cz+L/2*dir));ctx.lineTo(X(cx-hw),Y(cz+L*.15*dir));ctx.lineTo(X(cx-.07),Y(cz+L*.15*dir));ctx.closePath();ctx.fill(); };
  if(opts.shared){ travel.forEach(tl=>{ const dir=tl.side==='L'?-1:1; for(let z=z0m+6;z<z1m-4;z+=18){ glyph(tl.x+tl.w/2,z,dir); ctx.fillStyle=white; [0,0.5].forEach(o=>{ ctx.beginPath(); ctx.moveTo(X(tl.x+tl.w/2-0.4),Y(z+1.0*dir+o*dir)); ctx.lineTo(X(tl.x+tl.w/2),Y(z+1.4*dir+o*dir)); ctx.lineTo(X(tl.x+tl.w/2+0.4),Y(z+1.0*dir+o*dir)); ctx.lineTo(X(tl.x+tl.w/2),Y(z+1.2*dir+o*dir)); ctx.closePath(); ctx.fill(); }); } }); }
  bikes.forEach(b=>{ const sd=b.side, cx=b.x+b.w/2; ctx.strokeStyle=white; ctx.lineWidth=Math.max(1,S*.1); [b.x+.06,b.x+b.w-.06].forEach(x=>{ctx.beginPath();ctx.moveTo(X(x),Y(zb0));ctx.lineTo(X(x),Y(zb1));ctx.stroke();});
    if (b.two){ // dividing line: 1.0 m dashes / 3.0 m gaps, solid for the 10 m before each pedestrian crossing (EDM §8.9.1.11)
      ctx.strokeStyle='rgba(255,214,0,.95)'; const s0=ends[0]?zb0+IX.ddlSolid:zb0, s1=ends[1]?zb1-IX.ddlSolid:zb1;
      ctx.setLineDash([S*IX.ddlDash,S*IX.ddlGap]); ctx.beginPath(); ctx.moveTo(X(cx),Y(Math.max(s0,zb0))); ctx.lineTo(X(cx),Y(Math.min(s1,zb1))); ctx.stroke(); ctx.setLineDash([]);
      if(ends[0]){ ctx.beginPath(); ctx.moveTo(X(cx),Y(zb0)); ctx.lineTo(X(cx),Y(Math.min(s0,zb1))); ctx.stroke(); } if(ends[1]){ ctx.beginPath(); ctx.moveTo(X(cx),Y(Math.max(s1,zb0))); ctx.lineTo(X(cx),Y(zb1)); ctx.stroke(); }
      for(let z=zb0+4;z<zb1-2;z+=14){ glyph(cx-b.w/4,z,-1); arrow(cx-b.w/4,z+3,-1); glyph(cx+b.w/4,z+7,1); arrow(cx+b.w/4,z+4,1); } }   // right-hand: −z on the left half, +z on the right
    else for(let z=zb0+4;z<zb1-2;z+=14){ if(!inLaneAt(S_,sd,z)) glyph(cx,z,b.dir); if(!inLaneAt(S_,sd,z+3)) arrow(cx,z+3,b.dir); }
    (S_.lanes[sd]||[]).forEach(p=>{ if(p<2||p>LEN-2) return; ctx.fillStyle=white; for(let z=p-LW/2+.15;z<p+LW/2;z+=.6){ ctx.fillRect(X(b.x+.08),Y(z+.3),.3*S,.3*S); ctx.fillRect(X(b.x+b.w-.38),Y(z+.3),.3*S,.3*S); } });
    // bicycle stop bar: 0.3 m wide, parallel to the cross street, across the half that arrives at this end (EDM §8.9.1.8)
    EI.forEach((e,i)=>{ if(e.type!=='cross') return; const el=EL[i]; const zEdge=i?ZB:ZA, sgn=i?1:-1; const arrives = b.two ? true : (b.dir>0 ? i===1 : i===0); if(!arrives) return;
      const x0 = b.two ? (i===1 ? b.x+b.w/2 : b.x) : b.x, w = b.two ? b.w/2 : b.w; ctx.fillStyle=white; ctx.fillRect(X(x0+.05),Y(zEdge-sgn*el.bb0+(sgn<0?IX.bikeBarW:0)),(w-.1)*S,IX.bikeBarW*S); });
  });
  // contours and spot elevations from the 1 m contour data (topography switched off for now)
  if(!TOPO_OFF){ const F=S_.C.F, step=1.0;
    ctx.strokeStyle='rgba(90,105,120,.28)'; ctx.lineWidth=.6; ctx.font=`${Math.max(7,S*.35)}px JetBrains Mono`; ctx.fillStyle='rgba(90,105,120,.7)'; ctx.textAlign='center'; ctx.textBaseline='middle';
    const gz=(lx,lz)=>{ const [wx,wy]=F.toWorld(lx,lz); return elevAt(wx,wy); };
    const NX=26, NZ=26, x0=sceneXL, z0=-10, dx=(sceneXR-sceneXL)/NX, dz=(LEN+20)/NZ;
    const grid=[]; for(let j=0;j<=NZ;j++){ const row=[]; for(let i=0;i<=NX;i++) row.push(gz(x0+i*dx, z0+j*dz)); grid.push(row); }
    let lo=Infinity, hi=-Infinity; grid.forEach(r=>r.forEach(v=>{ lo=Math.min(lo,v); hi=Math.max(hi,v); }));
    for(let lev=Math.ceil(lo/step)*step; lev<=hi; lev+=step){
      ctx.beginPath();
      for(let j=0;j<NZ;j++) for(let i=0;i<NX;i++){
        const a=grid[j][i], b=grid[j][i+1], cc=grid[j+1][i+1], d2=grid[j+1][i];
        const px=x0+i*dx, pz=z0+j*dz; const segs=[];
        const ip=(v1,v2,p1,p2)=>{ const t=(lev-v1)/((v2-v1)||1e-9); return [p1[0]+(p2[0]-p1[0])*t, p1[1]+(p2[1]-p1[1])*t]; };
        const P=[[px,pz],[px+dx,pz],[px+dx,pz+dz],[px,pz+dz]], V=[a,b,cc,d2];
        for(let k=0;k<4;k++){ const k2=(k+1)%4; if((V[k]-lev)*(V[k2]-lev)<0) segs.push(ip(V[k],V[k2],P[k],P[k2])); }
        if(segs.length>=2){ ctx.moveTo(X(segs[0][0]),Y(segs[0][1])); ctx.lineTo(X(segs[1][0]),Y(segs[1][1])); }
      }
      ctx.stroke();
    }
    if(ANN) [[xL-1.2, 2, c.z0],[xL-1.2, LEN-2, c.z1]].forEach(([sx,sz,zz])=>{ ctx.fillStyle='rgba(50,65,80,.8)'; ctx.beginPath(); ctx.arc(X(sx),Y(sz),.28*S,0,Math.PI*2); ctx.fill(); ctx.fillText(zz.toFixed(1)+' m', X(sx-3.4), Y(sz)); });
    if (ANN && Math.abs(c.grade)>0.004) ctx.fillText((c.grade*100).toFixed(1)+'% grade', X((xL+xR)/2), Y(LEN/2));
  }
  // ── ends: intersection treatment, straight continuation, or dead end ──────
  EI.forEach((e,i)=>{
    const sgn=i?1:-1;
    if (e.type==='cross') {
      const zEdge=i?ZB:ZA, el=EL[i]; const zc=i?LEN:0, half=S_.half[i]; const zIn=d=>zEdge-sgn*d;   // zIn(d): d metres from the curb line into the block
      // v2: only the legs the cross street really has. At a T-junction (Robson ends at Beatty) the missing side keeps the block's
      // sidewalk and curb running straight to the node, and gets no curb return, cross-street lines, stop bar or crosswalk
      const LG=S_.legs[i], hasL=LG.L!=null, hasR=LG.R!=null;
      // v2: the junction is built from the cross street's real (smoothed) geometry, not a right-angled rectangle, so a curving or
      // skewed cross street (Pacific Blvd at 0 Smithe) meets the block where its curbs actually are. Each cross street's
      // centreline runs on through the node to this block's far curb (its pavement crosses the block).
      const G=endGeom(S_,i,cXL,cXR); const {ext,curbZ,fb}=G;   // shared with the 3D view
      // the block's sidewalks run on to the cross street's near curb (a skewed street leaves a wedge), or are cut back where it intrudes
      [[hasL,sw[0]],[hasR,sw[1]]].forEach(([has,sx])=>{ if(!has||S_.host) return; const x0=sx.x, x1=sx.x+sx.w, z0=fb(x0).near.z, z1=fb(x1).near.z;   // (no sidewalk corners over a host deck's lanes)
        const quad=(a,b,col)=>{ ctx.fillStyle=col; ctx.beginPath(); ctx.moveTo(X(x0),Y(zEdge)); ctx.lineTo(X(x1),Y(zEdge)); ctx.lineTo(X(x1),Y(b)); ctx.lineTo(X(x0),Y(a)); ctx.closePath(); ctx.fill(); };
        const cl=z=>sgn>0?Math.max(z,zEdge):Math.min(z,zEdge), cr=z=>sgn>0?Math.min(z,zEdge):Math.max(z,zEdge);
        quad(cl(z0),cl(z1),'#E3E0D8'); quad(cr(z0),cr(z1),'#A9ABA9'); });
      asphalt(cXL, i?ZB:0, cXR-cXL, i?LEN-ZB:ZA);   // the block's own carriageway to the node
      if(!D.city){ ext.forEach(E=>{ ctx.lineCap='butt'; stroke(E.g,E.m.ctc*S,'#A9ABA9'); streetMarkings(E.st).forEach(mk=>poly(mk.g,mk.w,mk.kind==='centre'?'rgba(255,214,0,.85)':mk.kind==='park'?'rgba(255,255,255,.4)':'rgba(255,255,255,.85)',mk.dash)); }); }
      [[!hasL,sw[0],cXL],[!hasR,sw[1],cXR]].forEach(([miss,sx,curbX])=>{ if(!miss) return; swPaint(sx.x, i?ZB:0, sx.w, i?LEN-ZB:ZA);
        ctx.strokeStyle='rgba(40,40,40,.85)'; ctx.lineWidth=LWT.heavy; ctx.beginPath(); ctx.moveTo(X(curbX),Y(zEdge)); ctx.lineTo(X(curbX),Y(zc)); ctx.stroke(); });
      // curb returns: a true fillet of radius rq tangent to the block's curb line and to the cross street's actual curb line at
      // whatever angle it meets; the road wraps round the corner (the wedge between the arc and the corner point is pavement)
      ctx.strokeStyle='rgba(40,40,40,.85)'; ctx.lineWidth=LWT.heavy; ctx.lineCap='butt';
      const rq=Math.min(RAD, sw[0].w-0.2);   // same radius as the 3D corner: 5 m, or a little less than the sidewalk width
      [[cXL,-1,hasL],[cXR,1,hasR]].forEach(([curbX,ox,has])=>{ if(!has||S_.host) return; const FL=G.fillet(curbX,ox,rq); if(!FL) return; const {P,C,TA,TB}=FL;
        const a1=-Math.atan2(TA[1]-C[1],TA[0]-C[0]), a2=-Math.atan2(TB[1]-C[1],TB[0]-C[0]); const ccw=((((a2-a1)%(2*Math.PI))+2*Math.PI)%(2*Math.PI))>Math.PI;
        ctx.fillStyle='#A9ABA9'; ctx.beginPath(); ctx.moveTo(X(P[0]),Y(P[1])); ctx.lineTo(X(TA[0]),Y(TA[1])); ctx.arc(X(C[0]),Y(C[1]),rq*S,a1,a2,ccw); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(X(curbX),Y(zEdge)); ctx.lineTo(X(TA[0]),Y(TA[1])); ctx.arc(X(C[0]),Y(C[1]),rq*S,a1,a2,ccw); ctx.stroke(); });
      // marked crosswalk across this street: two 0.2 m lines 3.0 m apart, inside the block's carriageway in line with the cross
      // street's sidewalk, nearest line 0.6 m from the projected curb line (EDM §8.8.1.7); signalised intersections only
      if (S_.cw[i]) { ctx.strokeStyle=white; ctx.lineWidth=Math.max(1,IX.cwLine*S); [el.cw0+IX.cwLine/2, el.cw1-IX.cwLine/2].forEach(d=>{ ctx.beginPath(); ctx.moveTo(X(cXL+.2),Y(zIn(d))); ctx.lineTo(X(cXR-.2),Y(zIn(d))); ctx.stroke(); }); }
      ctx.lineCap='round';
      // vehicle stop bars 0.3 m wide, ≥2.0 m behind the bicycle stop bar, on the lanes that arrive at this end (EDM §8.9.1.8)
      ctx.fillStyle=white; travel.forEach(tl=>{ const towards=tl.ow?((c.owd||1)>0?i===1:i===0):(tl.side==='R'?i===1:i===0); if(!towards) return; ctx.fillRect(X(tl.x+.08),Y(zIn(el.vb0)+(sgn<0?IX.carBarW:0)),(tl.w-.16)*S,IX.carBarW*S); });
      // the cross street's own lanes and stop bars come from its traffic model, drawn along its real centreline with the context
      // (streetMarkings: lines and bars end 1 m behind this block's sidewalk); here: the crosswalks across it and its label
      { const xs=e.segs&&e.segs[0]; const xst=xs&&S_.C.streets.find(st=>st.s===xs);
        if(xst){ const m=xst.m; const zc=i?LEN:0, half=m.ctc/2;
          if(S_.cw[i]) sw.forEach((sx,si)=>{ if(si===0?!hasL:!hasR) return; ctx.strokeStyle=white; ctx.lineWidth=Math.max(1,IX.cwLine*S); ctx.lineCap='butt'; [sx.x+.4+IX.cwLine/2, sx.x+sx.w-.4-IX.cwLine/2].forEach(x=>{ const cz=curbZ(x); if(!cz) return; const a=cz.near.z, b=cz.far.z, dz=Math.sign(b-a)*0.6; ctx.beginPath(); ctx.moveTo(X(x),Y(a+dz)); ctx.lineTo(X(x),Y(b-dz)); ctx.stroke(); }); ctx.lineCap='round'; });   // crosswalk across the cross street, between its real curbs
          // the cross street's label: two lines, right-aligned just outside the corner return on the block side of its centreline,
          // clear of the dimension strings (which sit beyond the near end) and of the bicycle crossing
          const l1=titleCase(m.n), l2=(m.ow?owText(m.seg,m.owd):'two-way')+' · '+m.spd+' km/h'+(m.bus?' · bus':'')+(m.sig.some(Boolean)?' · signal':''); const fsX0=zoomFont(Math.min(11*dpr,S*1.2),8*dpr,18*dpr,v,dpr);
          // the label lives in the near half of the cross street's pavement and never on its sidewalk: two lines (2.4 em) when that half
          // has room for them at this zoom, otherwise the name alone, sized to the pavement; no halo (it spilled over the curb)
          const xl=hasL?cXL-RAD-0.6:cXR+RAD+0.6, lz=curbZ(xl); const hw=lz?Math.abs(lz.far.z-lz.near.z)/2:half;   // placed in the near half of the carriageway where it really is
          const roomX=hw*S*0.9; let fsX=Math.min(fsX0, roomX/2.4); const twoX=fsX*v.z>=6*dpr; if(!twoX) fsX=Math.min(fsX0, roomX/1.2);
          ctx.textAlign=hasL?'right':'left'; ctx.textBaseline='middle'; const lx=X(xl), ly=Y(lz?(lz.near.z+(lz.far.z-lz.near.z)*0.25):(zc-sgn*half*0.5));   // on a leg that exists
          if(ANN){ ctx.fillStyle='rgba(30,38,48,.95)'; (twoX?[[l1,`600 ${fsX}px Inter`,-fsX*.7],[l2,`${fsX*.9}px Inter`,fsX*.7]]:[[l1,`600 ${fsX}px Inter`,0]]).forEach(([t,f,dy])=>{ ctx.font=f; ctx.fillText(t,lx,ly+dy); }); } } }
      // corner island in the buffer: physical protection ends 6 m back, the island noses toward the corner and doubles as the
      // pedestrian refuge where the crosswalk crosses the bike lane (BC Parkway Guide §4.5.2; EDM §8.9.1.12 "protected intersection treatments are preferred")
      els.filter(bf=>bf.k==='buf').forEach(bf=>{ const zA2=zIn(el.isl1), zB2=zIn(el.isl0);
        ctx.fillStyle='#CFCCC4'; ctx.beginPath(); ctx.moveTo(X(bf.x),Y(zA2)); ctx.lineTo(X(bf.x+bf.w),Y(zA2)); ctx.lineTo(X(bf.x+bf.w*.5),Y(zB2)); ctx.closePath(); ctx.fill();
        ctx.strokeStyle='rgba(40,40,40,.6)'; ctx.lineWidth=LWT.med; ctx.stroke(); });
      // the bicycle crossing: across the full cross street, bounded by elephant's feet (0.5 m squares, 0.5 m gaps), green where the
      // cross street carries turning conflicts, one non-elongated bicycle stencil per cross-street lane (EDM §8.9.1.12, Table 8-19)
      { const xs=e.segs&&e.segs[0]; const xst=xs&&S_.C.streets.find(st=>st.s===xs); const green=crossingGreen(xs);
        bikes.forEach(b=>{ const cz=fb(b.x+b.w/2); const z0=Math.min(cz.near.z,cz.far.z), z1=Math.max(cz.near.z,cz.far.z);   // across the cross street's real carriageway at this lane
          if(green){ ctx.fillStyle='rgba(96,150,110,.45)'; ctx.fillRect(X(b.x+.05),Y(z1),(b.w-.1)*S,(z1-z0)*S); }
          ctx.fillStyle=white; for(let z=z0+.25;z<z1-.4;z+=IX.ee+IX.eeGap){ ctx.fillRect(X(b.x+.05),Y(z+IX.ee),IX.ee*S,IX.ee*S); ctx.fillRect(X(b.x+b.w-.05-IX.ee),Y(z+IX.ee),IX.ee*S,IX.ee*S); }
          ext.forEach(E=>{ const m=E.m; const cxg=b.two?b.x+b.w*.75:b.x+b.w/2; const dir=b.two?1:b.dir;
            for(let k=0;k<m.lanes;k++){ const off=(m.edges[k]+m.edges[k+1])/2; const hs=zCross(offsetLine(E.g,off),cxg).filter(h=>h.z>=z0-0.2&&h.z<=z1+0.2); if(hs.length) glyph(cxg,hs[0].z,dir); } }); }); }
      if (S_.sig[i]) [cXL-0.5,cXR+0.5].forEach(x=>{ ctx.fillStyle='#2F3B45'; ctx.fillRect(X(x-.18),Y(zEdge+sgn*.6+.5),.36*S,.5*S); ctx.fillStyle='#34C759'; ctx.beginPath(); ctx.arc(X(x),Y(zEdge+sgn*.6+.25),.1*S,0,Math.PI*2); ctx.fill(); });
      sw.forEach((sx,si)=>{ if(si===0?!hasL:!hasR) return; ctx.fillStyle='rgba(120,110,95,.45)'; ctx.fillRect(X(sx.x+.3),Y(zEdge-sgn*0.1),(sx.w-.6)*S,.55*S); });
    }
    else if (e.type==='path') {
      // v2: the street stops for cars but a public path carries the cyclist on. No END, no hatch. The carriageway runs into the
      // turnaround loop where OSM maps one (0 Smithe's loop round the pandas sculpture), otherwise it closes with a curb that has
      // a flush cut at each bike lane; a connector in the PATH language (dashed edges, no lane green) leads from each lane end to
      // the path, which is drawn as a path, not as a protected lane
      const zEnd=i?LEN:0, F=S_.C.F; const toL=g=>g.map(q=>F.toLocal(q[0],q[1])); const pg=smoothLine(toL(e.path.g),1); const loop=e.loop?toL(e.loop):null; const pw=e.path.ow?2.0:3.0;
      if(loop){ const at=nearOnPoly([0,zEnd],loop)[1]; ctx.lineCap='butt'; stroke([[0,zEnd],[0,zEnd+sgn*1.5],at],(cXR-cXL)*S,'#A9ABA9'); if(!D.city) drawLoop(loop,5.5,e.loopRec);
        ctx.strokeStyle='rgba(40,40,40,.75)'; ctx.lineWidth=LWT.heavy; [cXL,cXR].forEach(x=>{ const t=nearOnPoly([x,zEnd],loop)[1]; ctx.beginPath(); ctx.moveTo(X(x),Y(zEnd)); ctx.lineTo(X(t[0]),Y(t[1])); ctx.stroke(); }); }
      else { ctx.fillStyle='#E3E0D8'; ctx.fillRect(X(cXL),Y(Math.max(zEnd,zEnd-sgn*1.6)),(cXR-cXL)*S,1.6*S);
        const cuts=bikes.map(b=>[b.x,b.x+b.w]).sort((a,b)=>a[0]-b[0]); let x=cXL; ctx.strokeStyle='rgba(40,40,40,.8)'; ctx.lineWidth=LWT.heavy; const seg=(a,b)=>{ if(b-a<0.05) return; ctx.beginPath(); ctx.moveTo(X(a),Y(zEnd-sgn*1.6)); ctx.lineTo(X(b),Y(zEnd-sgn*1.6)); ctx.stroke(); };
        cuts.forEach(([a,b])=>{ seg(x,a); x=b; }); seg(x,cXR); }
      if(!D.city) pathP(pg,pw,{des:e.path.des,ow:e.path.ow});
      // connectors (the cyclist rides the loop road where there is one), routed clear of buildings and the loop's island
      pathConnectors(S_,e,i,bikes).forEach(g=>pathP(g,loop?pw:Math.min(pw,(bikes[0]?bikes[0].w:2)+0.4),{conn:true,ow:e.path.ow}));
      if(ANN){ const at=nearOnPoly([0,zEnd+sgn*3],pg)[1]; if(at){ ctx.fillStyle='rgba(70,70,62,.9)'; ctx.font=`italic ${zoomFont(9*dpr,8*dpr,14*dpr,v,dpr)}px Inter`; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText('path connection → '+(e.path.n||('public '+(e.path.des?'cycleway':'path'))), X(at[0]), Y(at[1]+sgn*3)); } }
    }
    else if (e.type==='dead' && e.loop) {
      // v2: the street ends for everyone in a turnaround (loop road or cul-de-sac bulb): the carriageway runs into it, no cap
      const zEnd=i?LEN:0, F=S_.C.F; const loop=e.loop.map(q=>F.toLocal(q[0],q[1])); const at=nearOnPoly([0,zEnd],loop)[1];
      ctx.lineCap='butt'; stroke([[0,zEnd],[0,zEnd+sgn*1.5],at],(cXR-cXL)*S,'#A9ABA9'); if(!D.city) drawLoop(loop,5.5,e.loopRec);
      ctx.strokeStyle='rgba(40,40,40,.75)'; ctx.lineWidth=LWT.heavy; [cXL,cXR].forEach(x=>{ const t=nearOnPoly([x,zEnd],loop)[1]; ctx.beginPath(); ctx.moveTo(X(x),Y(zEnd)); ctx.lineTo(X(t[0]),Y(t[1])); ctx.stroke(); });
      bikes.forEach(b=>{ if(!ANN) return; ctx.fillStyle='#0F172A'; ctx.font=`600 ${Math.max(7,S*.42)}px Inter`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('END', X(b.x+b.w/2), Y(zEnd-sgn*3.1)); });
    }
    else if (e.type==='dead') {
      const zEnd=i?LEN:0;
      ctx.fillStyle='#E3E0D8'; ctx.fillRect(X(cXL),Y(Math.max(zEnd,zEnd-sgn*1.6)),(cXR-cXL)*S,1.6*S);
      ctx.strokeStyle='rgba(40,40,40,.8)'; ctx.lineWidth=Math.max(1.2,.14*S);
      ctx.beginPath(); ctx.moveTo(X(cXL),Y(zEnd-sgn*1.6)); ctx.lineTo(X(cXR),Y(zEnd-sgn*1.6)); ctx.stroke();
      ctx.fillStyle='rgba(40,40,40,.22)';
      for(let x=cXL;x<cXR-.3;x+=1.4){ ctx.beginPath(); ctx.moveTo(X(x),Y(zEnd-sgn*1.7)); ctx.lineTo(X(x+.9),Y(zEnd-sgn*3.1)); ctx.lineTo(X(x+1.15),Y(zEnd-sgn*3.1)); ctx.lineTo(X(x+.25),Y(zEnd-sgn*1.7)); ctx.closePath(); ctx.fill(); }
      bikes.forEach(b=>{ ctx.fillStyle='rgba(96,150,110,.5)';
        ctx.beginPath(); ctx.moveTo(X(b.x),Y(zEnd-sgn*4.4)); ctx.lineTo(X(b.x+b.w),Y(zEnd-sgn*4.4)); ctx.lineTo(X(b.x+b.w*.72),Y(zEnd-sgn*1.8)); ctx.lineTo(X(b.x+b.w*.28),Y(zEnd-sgn*1.8)); ctx.closePath(); ctx.fill();
        if(ANN){ ctx.fillStyle='#0F172A'; ctx.font=`600 ${Math.max(7,S*.42)}px Inter`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('END', X(b.x+b.w/2), Y(zEnd-sgn*3.1)); } });
    }
  });
  ['L','R'].forEach(sd=>{ (S_.stops[sd]||[]).forEach(([z])=>{ if(z<3||z>LEN-3) return; const sx=sw[sd==='L'?0:1]; const x=sd==='L'?sx.x+sx.w-1.6:sx.x+0.4;
    ctx.fillStyle='#8FA3B4'; ctx.fillRect(X(x),Y(z+2),1.2*S,4*S); ctx.strokeStyle='rgba(40,40,40,.6)'; ctx.lineWidth=LWT.light; ctx.strokeRect(X(x),Y(z+2),1.2*S,4*S); }); });
  ['L','R'].forEach(sd=>{ const n=S_.racks[sd]; if(!n) return; const sx=sw[sd==='L'?0:1]; const x=sd==='L'?sx.x+sx.w-0.9:sx.x+0.6;
    for(let k=0;k<Math.min(n,8);k++){ const z=6+k*1.1+(LEN-8-Math.min(n,8)*1.1)/2; ctx.strokeStyle='#2A3242'; ctx.lineWidth=Math.max(1,S*.06); ctx.beginPath(); ctx.arc(X(x),Y(z),.35*S,Math.PI*.5,Math.PI*1.5); ctx.stroke(); } });
  // sprites
  const car=(cx,cz,col)=>{ const w=1.75,l=4.2; shadow(cx,cz,w*.55,l*.5,.28); ctx.fillStyle=col; ctx.beginPath(); const x0=X(cx-w/2),y0=Y(cz+l/2),r=.35*S; ctx.roundRect?ctx.roundRect(x0,y0,w*S,l*S,r):ctx.rect(x0,y0,w*S,l*S); ctx.fill(); ctx.strokeStyle='rgba(40,40,40,.55)'; ctx.lineWidth=LWT.hair; ctx.stroke(); ctx.fillStyle='rgba(60,70,85,.75)'; ctx.fillRect(X(cx-w/2+.2),Y(cz+l/2-.9),(w-.4)*S,.5*S); ctx.fillRect(X(cx-w/2+.2),Y(cz+l/2-2.2),(w-.4)*S,1*S); };
  const person=(cx,cz,col)=>{ shadow(cx,cz,.3,.3,.3); ctx.fillStyle=col; ctx.beginPath(); ctx.ellipse(X(cx),Y(cz),.24*S,.16*S,0,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#2A3242'; ctx.beginPath(); ctx.arc(X(cx),Y(cz),.1*S,0,Math.PI*2); ctx.fill(); };
  const cyc=(cx,cz,col)=>{ shadow(cx,cz,.3,.9,.28); ctx.strokeStyle='#2A3242'; ctx.lineWidth=Math.max(1,S*.06); ctx.beginPath(); ctx.moveTo(X(cx),Y(cz-.85)); ctx.lineTo(X(cx),Y(cz+.85)); ctx.stroke(); ctx.fillStyle=col; ctx.beginPath(); ctx.ellipse(X(cx),Y(cz),.28*S,.22*S,0,0,Math.PI*2); ctx.fill(); };
  const tree=(cx,cz,h)=>{ const r=clamp((h||7)*.19,.6,2.4); shadow(cx,cz,r*.95,r*.95,.22); const g=ctx.createRadialGradient(X(cx)-r*S*.3,Y(cz)-r*S*.3,r*S*.1,X(cx),Y(cz),r*S); g.addColorStop(0,'rgba(190,210,160,.95)'); g.addColorStop(.7,'rgba(120,150,95,.92)'); g.addColorStop(1,'rgba(80,110,70,.9)'); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(X(cx),Y(cz),r*S,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='rgba(50,70,40,.5)'; ctx.lineWidth=LWT.hair; ctx.stroke(); ctx.fillStyle='rgba(60,50,40,.6)'; ctx.beginPath(); ctx.arc(X(cx),Y(cz),.12*S,0,Math.PI*2); ctx.fill(); };
  const bollard=(cx,cz)=>{ ctx.fillStyle='#2A2A2A'; ctx.beginPath(); ctx.arc(X(cx),Y(cz),Math.max(1.5,.07*S),0,Math.PI*2); ctx.fill(); };
  sw.forEach(s=>{ const sd=s.side, t=S_.tr[sd]; if(!t||!t.n) return; const tx=sd==='L'?s.x+s.w*.75:s.x+s.w*.25; const sp=Math.max(6,t.sp); for(let z=(sd==='L'?3.1:7.4)%sp+ (ends[0]?5:0); z<LEN-3; z+=sp){ if(!inLaneAt(S_,sd,z)) tree(tx,z,t.h); } });
  // existing street trees on the surrounding streets (public-trees), flat and lighter so the context stays quiet
  if (D.city) { S_.C.streets.forEach(st=>{ streetTrees(st).forEach(t=>{ const r=clamp(t.h*.19,.6,2.4); ctx.fillStyle='rgba(140,170,120,.45)'; ctx.beginPath(); ctx.arc(X(t.x),Y(t.z),r*S,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='rgba(70,95,60,.35)'; ctx.lineWidth=LWT.hair; ctx.stroke(); ctx.fillStyle='rgba(60,50,40,.45)'; ctx.beginPath(); ctx.arc(X(t.x),Y(t.z),.1*S,0,Math.PI*2); ctx.fill(); }); }); }
  els.filter(e=>e.k==='buf'&&!/^(barrier|paint|raisedlane)$/.test(SEP[e.sep].bufKind)).forEach(bf=>{ for(let z=zp0+1.5;z<zp1-.5;z+=3){ if(!inLaneAt(S_,bf.side,z)) bollard(bf.x+bf.w/2,z); } });
  park.forEach(pk=>{ const cx=pk.x+pk.w/2; for(let z=z0m+3.5;z<z1m-2;z+=6.4){ if(!inLaneAt(S_,pk.side,z-2.2)&&!inLaneAt(S_,pk.side,z+2.2)&&R()<.7) car(cx,z,['#EEF0F2','#DCE1E6','#E6E9EC'][Math.floor(R()*3)]); } });
  const mv=(z,v)=>{ const span=z1m-z0m-8; return z0m+4+(((z-z0m-4)+v*S_.t)%span+span)%span; };
  travel.forEach((tl,i)=>{ const dir=tl.ow?(c.owd||1):(tl.side==='L'?-1:tl.side==='R'?1:0); if(!dir) return; for(let z=z0m+8+i*9;z<z1m-4;z+=28) car(tl.x+tl.w/2,mv(z,dir*c.spd/3.6*0.5),'#F2F3F4'); });   // right-hand traffic; one-way direction from OSM (else +z)
  bikes.forEach((b,i)=>{ const cx=b.two?b.x+b.w*.25:b.x+b.w/2; for(let z=z0m+7+i*6;z<z1m-3;z+=22) cyc(cx,mv(z,5*(b.two?-1:b.dir)),['#E8574B','#3F6FB5'][i%2]); if(b.two) for(let z=z0m+14;z<z1m-3;z+=22) cyc(b.x+b.w*.75,mv(z,5),'#2FA6A0'); });
  sw.forEach((s,si)=>{ const px=s.x+s.w*(s.side==='L'?.4:.6); for(let z=2;z<LEN-1;z+=11){ const zz=((z+1.4*(si?1:-1)*S_.t)%(LEN-2)+(LEN-2))%(LEN-2)+1; if(!inLaneAt(S_,s.side,zz)) person(px+((z*7)%3-1)*.25,zz,['#E8574B','#3F6FB5','#2FA6A0','#E9B23A'][Math.floor(z/11+si)%4]); } });
  if(S_.drawOver) S_.drawOver();   // structures above the block go on top of the proposal (their shadow on it), under the annotations
  // v2: once zoomed in past 1.5×, every element carries its name and width along the lane, repeated so one is always in view,
  // and the block's own street name runs along the property line — the plan explains itself wherever you are looking
  if (ANN && v.z>1.5) { const zA=Math.max(ZA+2,VIS.z0), zB=Math.min(ZB-2,VIS.z1);
    const kk=1/v.z, r1d=Math.min(Y(ZA+0.6),(H-v.y)/v.z-84*kk*dpr), dimBand=v.z>=1.3?[r1d-30*kk*dpr, r1d+62*kk*dpr]:[0,0];   // the dimension rows (drawn below)
    if (zB-zA>6) { const fsE=zoomFont(9*dpr,8*dpr,15*dpr,v,dpr); ctx.font=`${fsE}px Inter`; ctx.textAlign='center'; ctx.textBaseline='middle'; const stepZ=Math.max(24,(zB-zA)/2);
      els.forEach(e=>{ if(e.w*S<fsE*1.15) return; /* the text has to fit inside the element's width */ const txt=(e.k==='sw'?(e.existing?(S_.host?'existing deck lanes (not designed)':'existing deck sidewalk (kept)'):'sidewalk + boulevard'):e.k==='bike'?(e.two?'two-way bike lane':'bike lane'):e.k==='buf'?SEP[e.sep].name.toLowerCase():e.k==='park'?'parking':e.turn?'turn lane':'travel lane')+' · '+fmt(e.w)+' m';
        const tw=ctx.measureText(txt).width; if(tw>(zB-zA)*S*0.9) return; ctx.fillStyle=(e.k==='sw'||e.k==='buf'||e.k==='bike')?'rgba(30,38,48,.8)':'rgba(255,255,255,.88)';
        const first=zA+((zB-zA)/2)%stepZ; for(let z=first;z<zB;z+=stepZ){ if(z-tw/(2*S)<zA||z+tw/(2*S)>zB) continue; if(inLaneAt(S_,e.side==='C'?'R':e.side,z)) continue;
          if(Y(z+tw/(2*S))<dimBand[1] && Y(z-tw/(2*S))>dimBand[0]) continue; ctx.save(); ctx.translate(X(e.x+e.w/2),Y(z)); ctx.rotate(-Math.PI/2); ctx.fillText(txt,0,0); ctx.restore(); } });
      const nm=titleCase(c.seg.n); ctx.font=`600 ${zoomFont(11*dpr,9*dpr,18*dpr,v,dpr)}px Inter`; ctx.fillStyle='rgba(55,65,75,.9)';
      [xL-1.6, xR+1.6].forEach((x,i)=>{ if(x<VIS.x0||x>VIS.x1) return; const z=(zA+zB)/2; ctx.save(); ctx.translate(X(x),Y(z)); ctx.rotate(-Math.PI/2); ctx.fillText(nm,0,0); ctx.restore(); }); } }
  // dimensions — widths only (the cross-section is the subject; the block length is not dimensioned). They appear once zoomed in
  // (≥ 1.3×), as a row inside the block just above the bottom of the view so they stay beside the elements wherever you look;
  // a line is drawn only where its number fits. Each element's number is a control: hover → text cursor, click → type a width;
  // the boundary handles sit on the same row, so the row is the place to drag widths (see bind2D)
  const k=1/v.z, dimCol='rgba(30,30,30,.9)'; const fs=zoomFont(10.5*dpr,9*dpr,14*dpr,v,dpr); const DIMS=[];
  const r1=Math.min(Y(ZA+0.6), (H-v.y)/v.z-84*k*dpr), r2=r1+26*k*dpr, r3=r1+52*k*dpr; const showDims=ANN && v.z>=1.3;
  const hDim=(x1,x2,y,label,i)=>dimString(ctx,canvas,v,dpr,k,fs,dimCol,S,X,x1,x2,y,label,i,DIMS);
  if(showDims){ ctx.strokeStyle='rgba(30,30,30,.4)'; ctx.lineWidth=.6*k*dpr; ctx.setLineDash([2*k*dpr,3*k*dpr]); els.forEach(e=>{ [e.x,e.x+e.w].forEach(x=>{ ctx.beginPath(); ctx.moveTo(X(x),r1-14*k*dpr); ctx.lineTo(X(x),r1+8*k*dpr); ctx.stroke(); }); }); ctx.setLineDash([]);
    els.forEach((e,i)=>hDim(e.x,e.x+e.w,r1,fmt(e.w),e.k==='sw'?null:i)); hDim(cXL,cXR,r2,fmt(cXR-cXL)); hDim(xL,xR,r3,fmt(xR-xL)); }
  // north arrow (fixed) and scale bar (zooms) — orientation, kept when annotations are off
  ctx.save(); ctx.setTransform(1,0,0,1,0,0); const nx=W-26*dpr, ny=padT; ctx.strokeStyle=dimCol; ctx.lineWidth=1*dpr; ctx.beginPath(); ctx.moveTo(nx,ny+16*dpr); ctx.lineTo(nx,ny-4*dpr); ctx.stroke(); ctx.fillStyle=dimCol; ctx.beginPath(); ctx.moveTo(nx,ny-6*dpr); ctx.lineTo(nx-4*dpr,ny+2*dpr); ctx.lineTo(nx+4*dpr,ny+2*dpr); ctx.closePath(); ctx.fill(); ctx.font=`${9*dpr}px JetBrains Mono`; ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillText(c.seg.ns?'N':'E',nx,ny+18*dpr); ctx.restore();
  const sbX=X(sceneXL), sbY=Y(0)+92*dpr; for(let i=0;i<5;i++){ ctx.fillStyle=i%2?'#F4F3EF':dimCol; ctx.fillRect(sbX+i*S,sbY-4*dpr,S,4*dpr); ctx.strokeStyle=dimCol; ctx.strokeRect(sbX+i*S,sbY-4*dpr,S,4*dpr); } ctx.fillStyle=dimCol; ctx.font=`${fs}px JetBrains Mono`; ctx.textAlign='left'; ctx.textBaseline='bottom'; ctx.fillText('0',sbX,sbY-6*dpr); ctx.textAlign='right'; ctx.fillText('5 m',sbX+5*S,sbY-6*dpr);
  // v2: raised elements get a curb line along both edges; the proposed pane gets the edit overlay
  els.forEach(e=>{ if(e.k==='sw'||!(e.h>0.05)) return; ctx.strokeStyle='rgba(40,40,40,.8)'; ctx.lineWidth=LWT.med; [e.x,e.x+e.w].forEach(x=>{ ctx.beginPath(); ctx.moveTo(X(x),Y(ZA)); ctx.lineTo(X(x),Y(ZB)); ctx.stroke(); }); });
  if (opts.editable && D.editOn!==false) { const toPx=x=>v.z*X(x)+v.x, toPy=z=>v.z*Y(z)+v.y;
    const handles=editOverlay(ctx,canvas,els,v,dpr,X,Y(ZB),Y(ZA),()=>r1);   // handles on the dimension row
    canvas._edit={kind:'plan', els, toPx, mPerPx:1/(v.z*S), y0:toPy(ZB), y1:toPy(ZA), popY:toPy(ZB), handles, dims:DIMS}; } else canvas._edit=null;
}

// ── SECTION ─────────────────────────────────────────────────────────────────
function drawSectionTo(canvas, els, opts){ prep(canvas); if(canvas.width<40||canvas.height<40) return;
  bind2D(canvas, ()=>drawSectionTo(canvas, els, opts)); const v=view(canvas.id);
  const ctx=canvas.getContext('2d'), W=canvas.width, H=canvas.height, dpr=devicePixelRatio;
  ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle='#FBFBF9'; ctx.fillRect(0,0,W,H);
  const S_=sceneCtx(els); const {c,xL,xR,CL,CR,leftW,rightW,sceneXL,sceneXR}=S_; const sceneW=sceneXR-sceneXL; const R=rng(11);
  const yardL=CL.has?CL.sb:leftW, yardR=CR.has?CR.sb:rightW;
  const T=S_.tr; const GH=S_.deckH||0; const maxH=Math.max(CL.h-GH,CR.h-GH,(T.L&&T.L.h||0)+1,(T.R&&T.R.h||0)+1,6);   // GH: the block is on a deck this far above the ground
  const padX=40*dpr,padT=30*dpr,padB=110*dpr; const secH=H-padT-padB; const S=Math.min((W-2*padX)/sceneW, secH/(maxH+GH+1.5));
  const ox=padX+((W-2*padX)-sceneW*S)/2-sceneXL*S, ground=padT+secH-GH*S; ctx.setTransform(v.z,0,0,v.z,v.x,v.y);   // `ground` is the deck surface; true ground at Yh(−GH)
  const X=x=>ox+x*S, Yh=h=>ground-h*S; const line='rgba(40,40,40,.9)';
  // haze
  canvas._box=[X(sceneXL),padT,X(sceneXR),ground+130*dpr];
  if (D.city) { // distant context: buildings across the intersection, flat and pale, from the 2015 footprints in the block's frame
    const C=cityContext(c.seg, Math.max(c.seg.len,140)*1.5); ctx.fillStyle='#E9E8E3';
    C.blds.filter(b=>b.c[1]>c.seg.len+2 && b.c[1]<c.seg.len+260).sort((a,b)=>b.c[1]-a.c[1]).forEach(b=>{ const f=1-(b.c[1]-c.seg.len)/300; const xs=b.p.map(q=>q[0]); const w=Math.max(...xs)-Math.min(...xs); if(Math.abs(b.c[0])>(xR-xL)*3) return; ctx.fillStyle=`rgba(215,216,212,${.25+.45*f})`; ctx.fillRect(X(Math.min(...xs)),Yh(b.h*f),w*S,b.h*f*S-.15*S); });
  }
  // ground slab + surfaces
  const LWT=lineWeights(v,dpr);   // same hierarchy as the plan: heavy cut line, medium edges, hairline detail
  const surf=(x0,w,h,f,base)=>{ base=base||0; ctx.fillStyle=f; ctx.fillRect(X(x0),Yh(base+h),w*S,h*S+.45*S); };
  if(GH>0){ // v2: the block is on a structure — true ground GH below, the deck slab under the section, piers, parapets at the edges
    ctx.fillStyle='#DCDAD4'; ctx.fillRect(X(sceneXL),Yh(-GH),sceneW*S,.45*S); ctx.strokeStyle=line; ctx.lineWidth=LWT.heavy; ctx.beginPath(); ctx.moveTo(X(sceneXL),Yh(-GH)); ctx.lineTo(X(sceneXR),Yh(-GH)); ctx.stroke();
    surf(sceneXL,xL-sceneXL,.15,'#E1E0DA',-GH); surf(xR,sceneXR-xR,.15,'#E1E0DA',-GH);
    const dx0=S_.host?xL-6:xL-0.3, dx1=S_.host?xR+6:xR+0.3;   // a host deck runs on beyond the block's outer zones
    ctx.fillStyle='#C9CBCC'; ctx.fillRect(X(dx0),Yh(0),(dx1-dx0)*S,1.4*S); ctx.strokeStyle=line; ctx.lineWidth=LWT.med; ctx.strokeRect(X(dx0),Yh(0),(dx1-dx0)*S,1.4*S);   // slab
    [xL+1.8,xR-1.8].forEach(px=>{ ctx.fillStyle='#BFC2C4'; ctx.fillRect(X(px-0.5),Yh(-1.4),1.0*S,(GH-1.4)*S); ctx.lineWidth=LWT.light; ctx.strokeRect(X(px-0.5),Yh(-1.4),1.0*S,(GH-1.4)*S); });   // piers
    if(!S_.host) [xL,xR-0.3].forEach(px=>{ ctx.fillStyle='#CFCCC4'; ctx.fillRect(X(px),Yh(1.4),0.3*S,1.25*S); ctx.strokeStyle=line; ctx.lineWidth=LWT.med; ctx.strokeRect(X(px),Yh(1.4),0.3*S,1.25*S); });   // parapets, 1.4 m (bicycle rail height)
  } else {
    ctx.fillStyle='#DCDAD4'; ctx.fillRect(X(sceneXL),ground,sceneW*S,.45*S); ctx.strokeStyle=line; ctx.lineWidth=LWT.light; ctx.beginPath(); ctx.moveTo(X(sceneXL),ground+.45*S); ctx.lineTo(X(sceneXR),ground+.45*S); ctx.stroke();
    surf(sceneXL,leftW,.15,'#E1E0DA'); surf(xR,rightW,.15,'#E1E0DA');
    if(CL.has&&yardL>0.3) surf(xL-yardL,yardL,.15,yardL<1.5?'#E2DFD6':'#C9D5A8'); if(CR.has&&yardR>0.3) surf(xR,yardR,.15,yardR<1.5?'#E2DFD6':'#C9D5A8'); }
  els.forEach(e=>{ const h=Math.max(e.h,.02); const f=e.k==='sw'?'#E2DFD6':e.k==='bike'?'#8EBF9C':e.k==='buf'?(SEP[e.sep].bufKind==='barrier'?'#B5B3AC':(SEP[e.sep].bufKind==='painted'||SEP[e.sep].bufKind==='paint')?'#B9B8B4':'#CFCCC4'):e.k==='park'?'#ADACA8':'#B9B8B4'; surf(e.x,e.w,h,f);
    if(e.k==='buf'&&SEP[e.sep].bufKind==='barrier'){ const n=6,sh=e.h/n; for(let i=0;i<n;i++){ ctx.fillStyle=i%2?'#D6DBE0':'#F5A623'; ctx.fillRect(X(e.x+(e.w-.56)/2),Yh((i+1)*sh),.56*S,sh*S);} } });
  ctx.strokeStyle=line; ctx.lineWidth=LWT.heavy; ctx.beginPath(); ctx.moveTo(X(sceneXL),Yh(.15)); ctx.lineTo(X(xL),Yh(.15)); els.forEach(e=>{ const h=Math.max(e.h,.02); ctx.lineTo(X(e.x),Yh(h)); ctx.lineTo(X(e.x+e.w),Yh(h)); }); ctx.lineTo(X(xR),Yh(.15)); ctx.lineTo(X(sceneXR),Yh(.15)); ctx.stroke();
  // facades
  // (buildings stand on the true ground: GH below the deck when the block is on a structure)
  const facade=(x0,w,h,flip)=>{ if(!h) return; const Yb=v=>Yh(v-GH); ctx.fillStyle='#EEEDE9'; ctx.fillRect(X(x0),Yb(h),w*S,h*S-.15*S); ctx.strokeStyle=line; ctx.lineWidth=LWT.med; const xf=flip?X(x0):X(x0+w); ctx.beginPath(); ctx.moveTo(xf,Yb(.15)); ctx.lineTo(xf,Yb(h)); ctx.lineTo(flip?X(x0+w):X(x0),Yb(h)); ctx.stroke(); const cc=flip?-1:1; ctx.beginPath(); ctx.moveTo(xf,Yb(h)); ctx.lineTo(xf+cc*.35*S,Yb(h)); ctx.lineTo(xf+cc*.35*S,Yb(h-.4)); ctx.lineTo(xf,Yb(h-.4)); ctx.stroke(); ctx.strokeStyle='rgba(40,40,40,.35)'; ctx.lineWidth=LWT.hair; for(let f=3;f<h-1;f+=3){ ctx.beginPath(); ctx.moveTo(X(x0),Yb(f)); ctx.lineTo(X(x0+w),Yb(f)); ctx.stroke(); } ctx.fillStyle='rgba(150,165,175,.35)'; for(let f=1.2;f<h-.8;f+=3){ ctx.fillRect(xf-(flip?0:.12*S),Yb(f+1.4),.12*S,1.4*S); } };
  if(CL.has&&CL.h>0) facade(GH>0?sceneXL+2:xL-yardL-6,6,CL.h,false); if(CR.has&&CR.h>0) facade(GH>0?sceneXR-8:xR+yardR,6,CR.h,true);
  const tree=(cx,h,dcm,tone)=>{ const r=clamp(h*.28,.9,3.4), tw=clamp((dcm||15)/100,.12,.5); ctx.fillStyle='rgba(70,55,40,.85)'; ctx.fillRect(X(cx)-tw*S/2,Yh(h*.62),tw*S,(h*.62-.15)*S); const cy=Yh(h*.62+r*.55); const pal=tone?['rgba(214,196,110,.55)','rgba(190,180,90,.5)','rgba(160,170,80,.45)']:['rgba(150,185,110,.55)','rgba(120,165,95,.5)','rgba(95,140,85,.45)']; for(let i=0;i<9;i++){ const a=R()*Math.PI*2, rr=r*S*(.15+R()*.55); ctx.fillStyle=pal[i%3]; ctx.beginPath(); ctx.ellipse(X(cx)+Math.cos(a)*rr*.7,cy+Math.sin(a)*rr*.55,r*S*(.45+R()*.3),r*S*(.38+R()*.25),0,0,Math.PI*2); ctx.fill(); } };
  const sw=els.filter(e=>e.k==='sw'); if(GH===0) sw.forEach((s,i)=>{ const t=T[s.side]; if(!t||!t.n) return; tree(s.side==='L'?s.x+s.w*.72:s.x+s.w*.28,t.h||7,t.d,i===1); });   // no street trees on a deck
  // (no invented yard trees: only trees in the public-trees dataset are drawn)
  // vehicles / people
  const carEnd=(cx,col)=>{ const w=1.8,h=1.45; ctx.fillStyle=col; ctx.strokeStyle='rgba(40,40,40,.5)'; ctx.lineWidth=LWT.hair; ctx.beginPath(); const r=.25*S; ctx.roundRect?ctx.roundRect(X(cx-w/2),Yh(.3+h),w*S,h*S,r):ctx.rect(X(cx-w/2),Yh(.3+h),w*S,h*S); ctx.fill(); ctx.stroke(); ctx.fillStyle='rgba(90,105,120,.45)'; ctx.fillRect(X(cx-w*.38),Yh(.3+h-.1),w*.76*S,.55*S); [cx-w*.32,cx+w*.32].forEach(wx=>{ ctx.fillStyle='rgba(45,45,45,.85)'; ctx.fillRect(X(wx)-.12*S,Yh(.32),.24*S,.32*S); }); };
  const carSide=(cx,col)=>{ const w=4.2,hb=.75,hc=.65; ctx.fillStyle=col; ctx.strokeStyle='rgba(40,40,40,.5)'; ctx.lineWidth=LWT.hair; ctx.beginPath(); ctx.moveTo(X(cx-w/2),Yh(.3)); ctx.lineTo(X(cx-w/2),Yh(.3+hb)); ctx.lineTo(X(cx-w*.22),Yh(.3+hb)); ctx.lineTo(X(cx-w*.1),Yh(.3+hb+hc)); ctx.lineTo(X(cx+w*.28),Yh(.3+hb+hc)); ctx.lineTo(X(cx+w*.42),Yh(.3+hb)); ctx.lineTo(X(cx+w/2),Yh(.3+hb)); ctx.lineTo(X(cx+w/2),Yh(.3)); ctx.closePath(); ctx.fill(); ctx.stroke(); [cx-w*.3,cx+w*.3].forEach(wx=>{ ctx.fillStyle='rgba(45,45,45,.85)'; ctx.beginPath(); ctx.arc(X(wx),Yh(.32),.32*S,0,Math.PI*2); ctx.fill(); }); };
  const rr=(x,y,w,h,r)=>{ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();};
  const person=(cx,base,col)=>{ const u=S*.11,bx=X(cx),by=Yh(base); ctx.fillStyle=col; rr(bx-u*1.1,by-u*5.2,u*.9,u*5.2,u*.3); ctx.fill(); rr(bx+u*.2,by-u*5.2,u*.9,u*5.2,u*.3); ctx.fill(); rr(bx-u*1.7,by-u*11.4,u*3.4,u*6.4,u*1.1); ctx.fill(); ctx.fillStyle='#E8C9A8'; ctx.beginPath(); ctx.arc(bx,by-u*13.4,u*1.8,0,Math.PI*2); ctx.fill(); };
  const cyc=(cx,base,col)=>{ const u=S*.11,bx=X(cx),by=Yh(base); ctx.fillStyle='rgba(45,45,45,.85)'; ctx.fillRect(bx-u*.5,by-u*6.5,u,u*6.5); ctx.strokeStyle='rgba(45,45,45,.9)'; ctx.lineWidth=u*.6; ctx.beginPath(); ctx.moveTo(bx-u*3.2,by-u*8.4); ctx.lineTo(bx+u*3.2,by-u*8.4); ctx.stroke(); ctx.fillStyle=col; rr(bx-u*1.8,by-u*15.4,u*3.6,u*7,u*1.2); ctx.fill(); ctx.fillStyle='#E8C9A8'; ctx.beginPath(); ctx.arc(bx,by-u*17.4,u*1.8,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#F2F3F4'; ctx.beginPath(); ctx.arc(bx,by-u*17.9,u*1.9,Math.PI,Math.PI*2); ctx.fill(); };
  els.filter(e=>e.k==='travel').forEach((tl,i)=>carEnd(tl.x+tl.w/2,i?'rgba(225,228,231,.9)':'rgba(205,210,214,.9)')); els.filter(e=>e.k==='park').forEach(pk=>carSide(pk.x+pk.w/2,'rgba(230,232,234,.9)'));
  els.filter(e=>e.k==='bike').forEach((b,i)=>{ if(b.two){ cyc(b.x+b.w*.28,Math.max(b.h,.02),'#E8574B'); cyc(b.x+b.w*.72,Math.max(b.h,.02),'#3F6FB5'); } else cyc(b.x+b.w/2,Math.max(b.h,.02),['#E8574B','#3F6FB5'][i%2]); });
  sw.forEach((s,i)=>{ person(s.x+s.w*.38,.15,['#3F6FB5','#2FA6A0'][i%2]); person(s.x+s.w*.72,.15,['#E9B23A','#E8574B'][i%2]); });
  // v2: edit overlay on the proposed pane (handles sit on the surface line at each boundary)
  if (opts.editable && D.editOn!==false) { const toPx=x=>v.z*X(x)+v.x, toPy=y=>v.z*y+v.y;
    const handles=editOverlay(ctx,canvas,els,v,dpr,X,Yh(3.0),ground+.45*S,i=>Yh(Math.max(els[i-1].h,els[i].h,0)));
    canvas._edit={kind:'sec', els, toPx, mPerPx:1/(v.z*S), y0:toPy(Yh(3.0)), y1:toPy(ground+.45*S), popY:toPy(Yh(3.2)), handles}; } else canvas._edit=null;
  // dimensions, heights and element names (scale-invariant) — all hidden when the Annotations toggle is off
  if(D.ann===false) return;
  const k=1/v.z, dimCol='rgba(40,40,40,.9)', fs=zoomFont(10.5*dpr,9*dpr,14*dpr,v,dpr); const dimY=Yh(-GH)+.45*S+24*dpr;   // below the true ground
  ctx.strokeStyle='rgba(40,40,40,.35)'; ctx.lineWidth=.6*k*dpr; ctx.setLineDash([3*k*dpr,3*k*dpr]); els.forEach(e=>{[e.x,e.x+e.w].forEach(x=>{ctx.beginPath();ctx.moveTo(X(x),ground+.45*S);ctx.lineTo(X(x),dimY+18*dpr);ctx.stroke();});}); ctx.setLineDash([]);
  // a dimension is drawn only where its number fits; each element's number is a control (hover → text cursor, click → type)
  const DIMS=[]; const hDim=(x1,x2,y,label,i)=>dimString(ctx,canvas,v,dpr,k,fs,dimCol,S,X,x1,x2,y,label,i,DIMS);
  els.forEach((e,i)=>hDim(e.x,e.x+e.w,dimY,e.w.toFixed(2),e.k==='sw'?null:i)); const cXL=sw[0].x+sw[0].w,cXR=sw[1].x; hDim(cXL,cXR,dimY+16*dpr,(cXR-cXL).toFixed(2)); hDim(xL,xR,dimY+32*dpr,(xR-xL).toFixed(2));
  if(canvas._edit) canvas._edit.dims=DIMS;
  // vertical: barrier / curb heights
  els.filter(e=>e.k==='buf'&&e.h>0.1).forEach(e=>{ const x=X(e.x+e.w/2); ctx.strokeStyle=dimCol; ctx.beginPath(); ctx.moveTo(x,Yh(0)); ctx.lineTo(x,Yh(e.h)); ctx.stroke(); ctx.fillStyle=dimCol; ctx.font=`${fs}px JetBrains Mono`; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(e.h.toFixed(2),x+4*k*dpr,Yh(e.h/2)); });
  ctx.fillStyle='rgba(40,40,40,.55)'; ctx.font=`${zoomFont(9*dpr,8*dpr,16*dpr,v,dpr)}px Inter`; ctx.textAlign='right'; ctx.textBaseline='middle';
  els.forEach(e=>{ if(e.w*S<12*dpr) return; ctx.save(); ctx.translate(X(e.x+e.w/2),dimY+40*dpr); ctx.rotate(-Math.PI/2); ctx.fillText((e.k==='sw'?(e.existing?(S_.host?'existing deck lanes':'existing deck sidewalk'):'sidewalk'):e.k==='bike'?(e.two?'two-way bike lane':'bike lane'):e.k==='buf'?SEP[e.sep].name.toLowerCase():e.k==='park'?'parking':e.turn?'turn lane':'travel lane'),0,0); ctx.restore(); });
}
