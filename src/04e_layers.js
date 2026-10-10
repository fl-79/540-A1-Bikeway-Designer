// ═══════════════════════════════════════════════════════════════════════════
// v3: MAP LAYERS — proposed lanes, bike-score heat map, bike infrastructure, cycling volumes; legend; north arrow
// ═══════════════════════════════════════════════════════════════════════════
// drawMap calls these hooks: drawHeatLayer under the streets, drawProposalsLayer / drawInfraLayer / drawVolumesLayer over
// the bikeways (inside the city clip), drawNorthArrow last.
function drawHeatLayer(ctx,W,H,dpr){ if(!PROJ.layers.heat||!SCORE) return; const s=SCORE; const add=PROJ.layers.heatProp?laneAdd(allPropBlockIds()):null;
  const [wx0,wy1]=S2W(0,0),[wx1,wy0]=S2W(W,H); const i0=Math.max(0,Math.floor((wx0-s.x0)/s.c)), i1=Math.min(s.nx-1,Math.floor((wx1-s.x0)/s.c)), j0=Math.max(0,Math.floor((wy0-s.y0)/s.c)), j1=Math.min(s.ny-1,Math.floor((wy1-s.y0)/s.c));
  const size=s.c*map.z+0.5; ctx.save(); ctx.globalAlpha=0.55;
  for(let j=j0;j<=j1;j++) for(let i=i0;i<=i1;i++){ const k=j*s.nx+i; if(!s.mask[k]) continue; const c=cellScore(k,add); ctx.fillStyle=scoreColor(c.total); const [sx,sy]=W2S(s.x0+i*s.c, s.y0+(j+1)*s.c); ctx.fillRect(sx,sy,size,size); }
  ctx.restore(); }
function drawProposalsLayer(ctx,path,dpr,lod){ if(!PROJ.layers.prop&&!map.routeA) return; const ap=activeProp(); const k=Math.min(1.2,Math.max(0.6,lod/250));
  const ltsOn=!!PROJ.layers.lts;   // v4: with the traffic-stress layer on, the proposal blocks are drawn by that layer (LTS colour in a magenta halo)
  if(PROJ.layers.prop&&!ltsOn) PROJ.proposals.forEach(p=>{ if(p.hidden) return; const act=p===ap; Object.keys(p.blocks).forEach(i=>{ const s=SEGS[+i]; if(!s) return; ctx.strokeStyle=act?PROP_COL:PROP_COL2; ctx.lineWidth=(act?4.5:3.5)*dpr*k; ctx.setLineDash([]); path(s.g); ctx.stroke();
    if(!p.blocks[i].auto){ ctx.strokeStyle='rgba(255,255,255,.9)'; ctx.lineWidth=1.2*dpr*k; ctx.setLineDash([5*dpr,5*dpr]); path(s.g); ctx.stroke(); ctx.setLineDash([]); } }); });
  if(map.routeA){ ctx.strokeStyle='#F59E0B'; ctx.lineWidth=7*dpr; ctx.setLineDash([]); path(map.routeA.g); ctx.stroke(); } }
const INFRA={park:{c:'#2563EB',n:'Bike parking'}, share:{c:'#0D9488',n:'Bike share (Mobi)'}, repair:{c:'#EA580C',n:'Repair station'}, shop:{c:'#7C3AED',n:'Bike shop'}, water:{c:'#38BDF8',n:'Drinking water'}};
function infraGlyph(ctx,k,x,y,r){ ctx.fillStyle=INFRA[k].c; ctx.strokeStyle='#fff'; ctx.lineWidth=r*0.35; ctx.beginPath();
  if(k==='park'){ ctx.arc(x,y,r,0,Math.PI*2); } else if(k==='shop'){ ctx.rect(x-r,y-r,2*r,2*r); } else if(k==='share'){ for(let i=0;i<6;i++){ const a=Math.PI/3*i-Math.PI/6; ctx.lineTo(x+r*1.15*Math.cos(a),y+r*1.15*Math.sin(a)); } ctx.closePath(); }
  else if(k==='repair'){ ctx.moveTo(x,y-r*1.25); ctx.lineTo(x+r*1.15,y+r*0.75); ctx.lineTo(x-r*1.15,y+r*0.75); ctx.closePath(); } else { ctx.moveTo(x,y-r*1.2); ctx.quadraticCurveTo(x+r*1.3,y+r*0.6,x,y+r*1.1); ctx.quadraticCurveTo(x-r*1.3,y+r*0.6,x,y-r*1.2); }
  ctx.fill(); ctx.stroke(); }
function drawInfraLayer(ctx,dpr,lod,wx0,wx1,wy0,wy1){ if(!PROJ.layers.infra||!DATA.bikeinfra) return; if(lod<160) return;   // readable only once the map is close enough
  const r=Math.max(3,Math.min(7,lod/120))*dpr; const order=['water','park','share','shop','repair'];
  order.forEach(k=>DATA.bikeinfra.forEach(f=>{ if(f.k!==k) return; const [x,y]=f.p; if(x<wx0||x>wx1||y<wy0||y>wy1) return; if(k==='park'&&lod<400&&!(f.cap>=10)) return;   // at mid zoom only the larger racks
    const [sx,sy]=W2S(x,y); infraGlyph(ctx,k,sx,sy,k==='park'?r*(f.cap>=20?1.15:0.8):r); })); }
// (cycling volumes: removed from the map for now — the layer needs Strava Metro or City counter data that is not available yet)
function drawVolumesLayer(){}
// ── v4: the stress view — every street in its LTS colour (worse end of the range, dashed where the range is open). A block that
// has a bikeway today gets a dark edge (casing); a proposal's blocks a magenta halo at the stress of their design; off-street paths
// (seawall, greenways) are separated facilities, LTS 1. Levels unticked in the legend are left on the grey base, so unticking 3 and 4
// shows the low-stress network alone. Drawn in place of the green bikeway pass, under the selection. ──
function drawLtsLayer(ctx,path,dpr,lod,vis,wx0,wx1,wy0,wy1){ if(!PROJ.layers.lts||typeof ltsShown!=='function') return; const k=Math.min(1.2,Math.max(0.6,lod/250)); const lv=PROJ.layers.ltsLv||{1:true,2:true,3:true,4:true}; const inProp=new Set(PROJ.layers.ltsProp!==false?allPropBlockIds():[]);
  ctx.save();
  const draw=(g,r,hasBw,prop,w)=>{ if(!lv[r.hi]) return; ctx.globalAlpha=(hasBw||prop)?1:0.5; ctx.setLineDash([]); ctx.lineCap='round';   // plain streets step back; bikeways (cased) and proposals (haloed) stand out
    // a proposal is the magenta line of the bikeways view, with the stress of its design as a thin core; a bikeway today keeps its
    // green as the edge, so green means bikeway in both views and only the core changes colour
    if(prop){ ctx.strokeStyle=PROP_COL; ctx.lineWidth=10*dpr*k; path(g); ctx.stroke(); ctx.strokeStyle='#fff'; ctx.lineWidth=5*dpr*k; path(g); ctx.stroke(); } else if(hasBw){ ctx.strokeStyle='#16A34A'; ctx.lineWidth=w+3*dpr*k; path(g); ctx.stroke(); }
    ctx.strokeStyle=LTS_COL[r.hi]||LTS_COL[0]; ctx.lineWidth=prop?2.4*dpr*k:w; if(r.lo!==r.hi){ ctx.lineCap='butt'; ctx.setLineDash([6*dpr,4*dpr]); } path(g); ctx.stroke(); };
  BW.forEach(b=>{ if(!(b.st==='Off-street'||/^OS/.test(b.sub||''))) return; if(b.g.every(([x,y])=>x<wx0-300||x>wx1+300||y<wy0-300||y>wy1+300)) return; draw(b.g,{lo:1,hi:1},true,false,1.4*dpr*k); });
  SEGS.forEach(s=>{ if(!vis(s)) return; if(!designable(s).ok&&!s.bw) return; if(s.u==='Residential'&&lod<120) return; const r=ltsShown(s); const w=(s.u==='Residential'?1.0:1.4)*dpr*k; draw(s.g,r,!!s.bw,inProp.has(s.i),w); });   // thin: the stress is a tint under the network, the proposals the loudest line
  ctx.setLineDash([]); ctx.globalAlpha=1; ctx.restore(); }
// ── v4: traffic signals at the street nodes (City of Vancouver traffic-signals, by type) ──
function drawSigLayer(ctx,dpr,lod,wx0,wx1,wy0,wy1){ if(!PROJ.layers.sig||typeof SIG_NODES==='undefined') return; if(lod<110) return; const r=Math.max(2.5,Math.min(6,lod/160))*dpr;
  SIG_NODES.forEach(n=>{ const [x,y]=n.p; if(x<wx0||x>wx1||y<wy0||y>wy1) return; const [sx,sy]=W2S(x,y); const cls=sigClass(n.t); ctx.fillStyle=SIG_STYLE[cls].c; ctx.strokeStyle='#fff'; ctx.lineWidth=r*0.35; ctx.beginPath();
    if(cls==='beacon'){ ctx.moveTo(sx,sy-r*1.2); ctx.lineTo(sx+r*1.1,sy+r*0.7); ctx.lineTo(sx-r*1.1,sy+r*0.7); ctx.closePath(); } else if(cls==='ped'){ ctx.rect(sx-r*0.85,sy-r*0.85,r*1.7,r*1.7); } else { ctx.arc(sx,sy,r,0,Math.PI*2); }
    ctx.fill(); ctx.stroke(); if(cls==='full'){ ctx.fillStyle='#FDE047'; ctx.beginPath(); ctx.arc(sx,sy,r*0.38,0,Math.PI*2); ctx.fill(); } }); }
// ── v4: cyclist crashes reported to ICBC, per intersection (circle area ∝ crashes; the darker share = with injury) and mid-block ──
function drawCrashLayer(ctx,dpr,lod,wx0,wx1,wy0,wy1){ if(!PROJ.layers.crash||typeof CRASH==='undefined'||!CRASH) return; if(lod<60) return; const sc=Math.max(1.6,Math.min(4,lod/200))*dpr;
  CRASH.nodes.forEach(n=>{ if(!n[3]) return; const [x,y]=n; if(x<wx0||x>wx1||y<wy0||y>wy1) return; const [sx,sy]=W2S(x,y); const r=sc*Math.sqrt(n[3])+1.5*dpr;
    ctx.fillStyle='rgba(220,38,38,.35)'; ctx.beginPath(); ctx.arc(sx,sy,r,0,Math.PI*2); ctx.fill(); if(n[4]){ ctx.fillStyle='rgba(153,27,27,.75)'; ctx.beginPath(); ctx.arc(sx,sy,r*Math.sqrt(n[4]/n[3]),0,Math.PI*2); ctx.fill(); }
    ctx.strokeStyle='rgba(127,29,29,.8)'; ctx.lineWidth=0.8*dpr; ctx.beginPath(); ctx.arc(sx,sy,r,0,Math.PI*2); ctx.stroke();
    if(lod>500&&n[3]>=3){ ctx.fillStyle='#7F1D1D'; ctx.font=`600 ${9*dpr}px Inter`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(n[3],sx,sy-r-6*dpr); } });
  if(lod>250) Object.keys(CRASH.blocks).forEach(i=>{ const b=CRASH.blocks[i]; if(!b[1]) return; const s=SEGS[+i]; if(!s) return; const m=s.g[Math.floor(s.g.length/2)]; if(m[0]<wx0||m[0]>wx1||m[1]<wy0||m[1]>wy1) return; const [sx,sy]=W2S(m[0],m[1]); const r=sc*0.8*Math.sqrt(b[1])+1.2*dpr;
    ctx.fillStyle='rgba(220,38,38,.3)'; ctx.strokeStyle='rgba(127,29,29,.7)'; ctx.lineWidth=0.8*dpr; ctx.beginPath(); ctx.rect(sx-r,sy-r,2*r,2*r); ctx.fill(); ctx.stroke(); }); }
function drawNorthArrow(ctx,W,H,dpr){ ctx.save(); ctx.setTransform(1,0,0,1,0,0); const x=W-38*dpr, y=H-92*dpr; ctx.fillStyle='rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(x,y,17*dpr,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='rgba(15,23,42,.25)'; ctx.lineWidth=1*dpr; ctx.stroke();
  ctx.fillStyle='#0F172A'; ctx.beginPath(); ctx.moveTo(x,y-12*dpr); ctx.lineTo(x-5*dpr,y+4*dpr); ctx.lineTo(x,y+1*dpr); ctx.closePath(); ctx.fill(); ctx.fillStyle='#94A3B8'; ctx.beginPath(); ctx.moveTo(x,y-12*dpr); ctx.lineTo(x+5*dpr,y+4*dpr); ctx.lineTo(x,y+1*dpr); ctx.closePath(); ctx.fill();
  ctx.fillStyle='#0F172A'; ctx.font=`700 ${8*dpr}px Inter`; ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillText('N',x,y+4*dpr); ctx.restore(); }
// ── legend: what colours the streets (bikeways or traffic stress), the key for it, then the layers ──
const legNote=(title,note,open)=>`<div class="label legsec" style="margin-top:6px"><span>${title}</span><button class="ghost small legi" data-note title="${note.replace(/"/g,'&quot;')}" aria-label="About ${title}">i</button></div><div class="legnote small muted" ${open?'':'hidden'}>${note}</div>`;
function renderLegend(){ const L=PROJ.layers; const lay=$('leg-layers'), dyn=$('leg-dyn'), ex=$('leg-exist'); if(!lay) return; if(!L.ltsLv) L.ltsLv={1:true,2:true,3:true,4:true};
  const leg=lay.closest('.legend'); if(leg&&!leg.querySelector('.leghead')){ leg.insertAdjacentHTML('afterbegin','<div class="leghead"><span>Map key</span><button class="ghost small" data-act="min" title="Collapse / expand the key">▾</button></div>'); leg.querySelector('[data-act=min]').onclick=()=>{ leg.classList.toggle('min'); leg.querySelector('[data-act=min]').textContent=leg.classList.contains('min')?'▸':'▾'; }; }
  if(ex) ex.style.display='none';
  const hasCrash=typeof CRASH!=='undefined'&&!!CRASH;
  // ══ KEY — what the map is showing right now (explanatory only, no controls) ══
  const K=[];
  K.push(`<div class="label legsec"><span>Bikeways</span></div>`+(L.lts
    ?`<div class="item"><span class="sw" style="border-top:6px solid #16A34A;position:relative"><span style="position:absolute;left:0;right:0;top:-4.5px;border-top:2px solid ${LTS_COL[1]}"></span></span>Existing bikeway — green edge, its comfort level inside</div>`
    :`<div class="item"><span class="sw" style="border-top:4px solid #15803D"></span>Protected bike lane · All Ages and Abilities (AAA)</div><div class="item"><span class="sw" style="border-top:4px solid #22C55E"></span>Protected bike lane</div><div class="item"><span class="sw" style="border-top:3px dashed #16A34A"></span>Painted lane</div><div class="item"><span class="sw" style="border-top:3px solid #86EFAC"></span>Local street bikeway</div><div class="item"><span class="sw" style="border-top:3px dotted #4D7C0F"></span>Shared lane</div><div class="item"><span class="sw" style="border-top:2px solid #C4C9D1"></span>Street without a bikeway</div>`)
    +`<div class="item"><span class="sw" style="border-top:4px solid #F59E0B"></span>Selected block / route start</div>`);
  if(L.prop) K.push(`<div class="label legsec"><span>Proposals</span></div>`+(L.lts
    ?`<div class="item"><span class="sw" style="border-top:9px solid ${PROP_COL};position:relative"><span style="position:absolute;left:0;right:0;top:-6.5px;border-top:4px solid #fff"></span><span style="position:absolute;left:0;right:0;top:-6px;border-top:3px solid ${LTS_COL[1]}"></span></span>Proposed bike lane — the comfort of its design inside</div>`
    :`<div class="item"><span class="sw" style="border-top:4px solid ${PROP_COL}"></span>Active proposed lane</div><div class="item"><span class="sw" style="border-top:4px solid ${PROP_COL2}"></span>Other proposed lanes</div><div class="item"><span class="sw" style="border-top:4px dashed ${PROP_COL}"></span>Designed block (custom design)</div>`));
  if(L.lts) K.push(legNote('Cycling comfort — most to least comfortable','Who is comfortable riding each street (the Level of Traffic Stress method). LTS 1–2 is low stress for the All Ages and Abilities population. Streets without a bikeway are drawn lighter and thinner. Click a block for the inputs behind its level. Mekuria, Furth &amp; Nixon 2012.')
    +`<div class="ltsbar">${[1,2,3,4].map(l=>`<span style="background:${LTS_COL[l]}"></span>`).join('')}</div>`
    +[1,2,3,4].map(l=>`<div class="item ${L.ltsLv[l]?'':'off'}"><span class="sw" style="border-top:4px solid ${LTS_COL[l]}"></span>LTS ${l} · ${LTS_NAME[l]}${L.ltsLv[l]?'':' <span class="muted">(hidden)</span>'}</div>`).join('')
    +`<div class="item"><span class="sw" style="border-top:3px dashed ${LTS_COL[2]}"></span>Range — an input is not in the data; drawn at its worse level</div>`);
  if(L.heat&&SCORE) K.push(legNote('Bike score','0–49 Somewhat bikeable · 50–69 Bikeable · 70–89 Very bikeable · 90+ Biker’s paradise. Bike Score method (Walk Score / UBC Cycling in Cities).')+`<div class="item"><span style="display:inline-block;width:110px;height:10px;border-radius:3px;background:linear-gradient(90deg,${[0,25,50,70,90,100].map(v=>scoreColor(v)).join(',')})"></span></div><div class="item small" style="justify-content:space-between;width:110px"><span>0</span><span>50</span><span>100</span></div>`);
  if(L.infra&&DATA.bikeinfra){ const cnt={}; DATA.bikeinfra.forEach(f=>cnt[f.k]=(cnt[f.k]||0)+1); K.push(legNote('Bike infrastructure (OSM)','Zoom in to see them; racks under 10 spaces appear close up. OpenStreetMap contributors, ODbL.')+['park','share','repair','shop','water'].map(k=>`<div class="item"><canvas width="18" height="18" data-glyph="${k}"></canvas>${INFRA[k].n} <span class="muted">· ${cnt[k]||0}</span></div>`).join('')); }
  if(L.sig&&typeof SIG_STYLE!=='undefined'){ const cnt={}; SIG_NODES.forEach(n=>{ const c=sigClass(n.t); cnt[c]=(cnt[c]||0)+1; }); K.push(legNote('Traffic signals (City of Vancouver)','At the street nodes the tool knows; zoom in to see them. A signalised crossing is not a barrier in the LTS criteria; an RRFB or special crosswalk is not a signal.')+['full','ped','beacon'].map(c=>`<div class="item"><canvas width="18" height="18" data-sig="${c}"></canvas>${SIG_STYLE[c].n} <span class="muted">· ${cnt[c]||0}</span></div>`).join('')); }
  if(L.crash&&hasCrash) K.push(legNote('Cyclist crashes reported to ICBC, '+CRASH.years, `${CRASH.n.cyclist.toLocaleString()} located cyclist-involved crashes in the city at ${CRASH.nodes.filter(n=>n[3]).length} intersections and ${Object.values(CRASH.blocks).filter(b=>b[1]).length} blocks. Self-reported claims; locations approximate; ${Math.round(100*CRASH.n.geocoded/CRASH.n.rows)} % of reports had a location. ICBC Open Data Licence.`)+`<div class="item"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:rgba(220,38,38,.35);border:1px solid rgba(127,29,29,.8);position:relative"><span style="position:absolute;left:3px;top:3px;width:6px;height:6px;border-radius:50%;background:rgba(153,27,27,.75)"></span></span>At an intersection · area ∝ crashes, darker core = with injury</div><div class="item"><span style="display:inline-block;width:10px;height:10px;background:rgba(220,38,38,.3);border:1px solid rgba(127,29,29,.7)"></span>Mid-block (ICBC places these at the block's middle)</div>`);
  dyn.innerHTML=K.join('');
  // ══ LAYERS — switches only, in their own box ══
  lay.innerHTML=`<div class="legbox"><div class="label legsec"><span>Layers</span><span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">switch on or off</span></div>
    <label class="lay"><input type="checkbox" data-l="prop" ${L.prop?'checked':''}> Proposed bike lanes</label>
    <label class="lay" title="Colours every street by how comfortable it is to ride (Level of Traffic Stress); bikeways keep a green edge, proposals stay magenta"><input type="checkbox" data-l="lts" ${L.lts?'checked':''}> Cycling comfort</label>
    ${L.lts?`<div class="lay sub"><span class="muted">levels shown</span>${[1,2,3,4].map(l=>`<label class="lv" title="LTS ${l} · ${LTS_NAME[l]}"><input type="checkbox" data-lv="${l}" ${L.ltsLv[l]?'checked':''}><span style="border-bottom:3px solid ${LTS_COL[l]}">${l}</span></label>`).join('')}</div>
    <label class="lay sub"><input type="checkbox" data-l="ltsProp" ${L.ltsProp!==false?'checked':''}> Proposals at the comfort of their design</label>`:''}
    <label class="lay"><input type="checkbox" data-l="heat" ${L.heat?'checked':''} ${SCORE?'':'disabled'}> Bike score heat map</label>
    ${L.heat?`<label class="lay sub"><input type="checkbox" data-l="heatProp" ${L.heatProp?'checked':''}> Include proposals</label>`:''}
    <label class="lay"><input type="checkbox" data-l="infra" ${L.infra?'checked':''} ${DATA.bikeinfra?'':'disabled'}> Bike infrastructure</label>
    <label class="lay" title="City of Vancouver traffic-signals dataset: the signal type at each intersection"><input type="checkbox" data-l="sig" ${L.sig?'checked':''}> Traffic signals</label>
    <label class="lay" title="Crashes involving a cyclist reported to ICBC, ${hasCrash?CRASH.years:''}, by intersection and block"><input type="checkbox" data-l="crash" ${L.crash?'checked':''} ${hasCrash?'':'disabled'}> Cyclist crashes (ICBC)</label></div>`;
  leg.querySelectorAll('button[data-note]').forEach(b=>b.onclick=()=>{ const n=b.closest('.legsec').nextElementSibling; n.hidden=!n.hidden; b.classList.toggle('on',!n.hidden); });
  leg.querySelectorAll('input[data-lv]').forEach(i=>i.onchange=()=>{ L.ltsLv[+i.dataset.lv]=i.checked; projChanged(); });
  leg.querySelectorAll('input[data-l]').forEach(i=>i.onchange=()=>{ L[i.dataset.l]=i.checked; projChanged(); });
  leg.querySelectorAll('canvas[data-glyph]').forEach(cv=>{ const c=cv.getContext('2d'); infraGlyph(c,cv.dataset.glyph,9,9,5); });
  leg.querySelectorAll('canvas[data-sig]').forEach(cv=>{ const c=cv.getContext('2d'); const cls=cv.dataset.sig; const r=5, x=9, y=9; c.fillStyle=SIG_STYLE[cls].c; c.strokeStyle='#fff'; c.lineWidth=1.5; c.beginPath(); if(cls==='beacon'){ c.moveTo(x,y-r*1.2); c.lineTo(x+r*1.1,y+r*0.7); c.lineTo(x-r*1.1,y+r*0.7); c.closePath(); } else if(cls==='ped'){ c.rect(x-r*0.85,y-r*0.85,r*1.7,r*1.7); } else c.arc(x,y,r,0,Math.PI*2); c.fill(); c.stroke(); if(cls==='full'){ c.fillStyle='#FDE047'; c.beginPath(); c.arc(x,y,2,0,Math.PI*2); c.fill(); } }); }
// WGS84 → UTM 10N, for imported counts given as latitude / longitude
function fromLatLon(lat,lon){ const a=6378137, f=1/298.257223563, k0=0.9996, e2=f*(2-f), ep2=e2/(1-e2), lon0=-123; const phi=lat*Math.PI/180, lam=(lon-lon0)*Math.PI/180; const N=a/Math.sqrt(1-e2*Math.sin(phi)**2), T=Math.tan(phi)**2, C=ep2*Math.cos(phi)**2, A=Math.cos(phi)*lam;
  const M=a*((1-e2/4-3*e2*e2/64-5*e2**3/256)*phi-(3*e2/8+3*e2*e2/32+45*e2**3/1024)*Math.sin(2*phi)+(15*e2*e2/256+45*e2**3/1024)*Math.sin(4*phi)-(35*e2**3/3072)*Math.sin(6*phi));
  const E=500000+k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120), Nn=k0*(M+N*Math.tan(phi)*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep2)*A**6/720)); return [E-DATA.origin[0], Nn-DATA.origin[1]]; }
if($('vol-file')) $('vol-file').addEventListener('change',e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{ try{ const rows=parseCSV(r.result); if(rows.length<2) throw new Error('empty file'); const h=rows[0].map(x=>x.toLowerCase().trim()); const fi=(...names)=>h.findIndex(x=>names.some(n=>x.includes(n)));
      const iLat=fi('lat'), iLon=fi('lon','lng'), iX=fi('x'), iY=fi('y'), iV=fi('volume','count','daily','total','aadb','riders','trips'), iN=fi('name','station','location','site','edge');
      if(iV<0||(iLat<0&&iX<0)) throw new Error('need columns for latitude/longitude (or x/y) and a volume');
      const out=[]; rows.slice(1).forEach(rw=>{ const v=parseFloat(rw[iV]); if(isNaN(v)) return; let x,y; if(iLat>=0&&iLon>=0){ const la=parseFloat(rw[iLat]), lo=parseFloat(rw[iLon]); if(isNaN(la)||isNaN(lo)) return; [x,y]=fromLatLon(la,lo); } else { x=parseFloat(rw[iX]); y=parseFloat(rw[iY]); if(isNaN(x)||isNaN(y)) return; } out.push({n:iN>=0?String(rw[iN]).slice(0,40):'', x:Math.round(x), y:Math.round(y), v:Math.round(v), src:f.name}); });
      if(!out.length) throw new Error('no usable rows'); PROJ.volumes=PROJ.volumes.concat(out); PROJ.layers.vol=true; projChanged(); toast(out.length+' count points imported from '+f.name); }catch(err){ toast('Import failed: '+err.message, 4000); } }; r.readAsText(f); e.target.value=''; });
function parseCSV(txt){ const rows=[]; let row=[], cell='', q=false; for(let i=0;i<txt.length;i++){ const ch=txt[i]; if(q){ if(ch==='"'){ if(txt[i+1]==='"'){ cell+='"'; i++; } else q=false; } else cell+=ch; } else if(ch==='"') q=true; else if(ch===','||ch===';'||ch==='\t'){ row.push(cell); cell=''; } else if(ch==='\n'||ch==='\r'){ if(cell!==''||row.length){ row.push(cell); rows.push(row); } row=[]; cell=''; if(ch==='\r'&&txt[i+1]==='\n') i++; } else cell+=ch; } if(cell!==''||row.length){ row.push(cell); rows.push(row); } return rows; }
renderLegend(); renderProj();
