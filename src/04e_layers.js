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
  if(PROJ.layers.prop) PROJ.proposals.forEach(p=>{ if(p.hidden) return; const act=p===ap; Object.keys(p.blocks).forEach(i=>{ const s=SEGS[+i]; if(!s) return; ctx.strokeStyle=act?PROP_COL:PROP_COL2; ctx.lineWidth=(act?4.5:3.5)*dpr*k; ctx.setLineDash([]); path(s.g); ctx.stroke();
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
function drawNorthArrow(ctx,W,H,dpr){ ctx.save(); ctx.setTransform(1,0,0,1,0,0); const x=W-38*dpr, y=H-92*dpr; ctx.fillStyle='rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(x,y,17*dpr,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='rgba(15,23,42,.25)'; ctx.lineWidth=1*dpr; ctx.stroke();
  ctx.fillStyle='#0F172A'; ctx.beginPath(); ctx.moveTo(x,y-12*dpr); ctx.lineTo(x-5*dpr,y+4*dpr); ctx.lineTo(x,y+1*dpr); ctx.closePath(); ctx.fill(); ctx.fillStyle='#94A3B8'; ctx.beginPath(); ctx.moveTo(x,y-12*dpr); ctx.lineTo(x+5*dpr,y+4*dpr); ctx.lineTo(x,y+1*dpr); ctx.closePath(); ctx.fill();
  ctx.fillStyle='#0F172A'; ctx.font=`700 ${8*dpr}px Inter`; ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillText('N',x,y+4*dpr); ctx.restore(); }
// ── legend with layer switches ──
function renderLegend(){ const L=PROJ.layers; const lay=$('leg-layers'), dyn=$('leg-dyn'); if(!lay) return;
  lay.innerHTML=`<div class="label" style="margin-top:6px">Layers</div>
    <label class="lay"><input type="checkbox" data-l="prop" ${L.prop?'checked':''}> Proposed bike lanes</label>
    <label class="lay"><input type="checkbox" data-l="heat" ${L.heat?'checked':''} ${SCORE?'':'disabled'}> Bike score heat map</label>
    ${L.heat?`<label class="lay" style="padding-left:18px"><input type="checkbox" data-l="heatProp" ${L.heatProp?'checked':''}> Include proposals</label>`:''}
    <label class="lay"><input type="checkbox" data-l="infra" ${L.infra?'checked':''} ${DATA.bikeinfra?'':'disabled'}> Bike infrastructure</label>`;
  lay.querySelectorAll('input').forEach(i=>i.onchange=()=>{ L[i.dataset.l]=i.checked; projChanged(); });
  const items=[]; if(L.prop) items.push(`<div class="label" style="margin-top:6px">Proposals</div><div class="item"><span class="sw" style="border-top:4px solid ${PROP_COL}"></span>Active proposed lane</div><div class="item"><span class="sw" style="border-top:4px solid ${PROP_COL2}"></span>Other proposed lanes</div><div class="item"><span class="sw" style="border-top:4px dashed ${PROP_COL}"></span>Designed block (custom option)</div>`);
  if(L.heat&&SCORE) items.push(`<div class="label" style="margin-top:6px">Bike score</div><div class="item"><span style="display:inline-block;width:110px;height:10px;border-radius:3px;background:linear-gradient(90deg,${[0,25,50,70,90,100].map(v=>scoreColor(v)).join(',')})"></span></div><div class="item small" style="justify-content:space-between;width:110px"><span>0</span><span>50</span><span>100</span></div><div class="item small muted">0–49 Somewhat bikeable · 50–69 Bikeable · 70–89 Very bikeable · 90+ Biker's paradise</div>`);
  if(L.infra&&DATA.bikeinfra){ const cnt={}; DATA.bikeinfra.forEach(f=>cnt[f.k]=(cnt[f.k]||0)+1); items.push(`<div class="label" style="margin-top:6px">Bike infrastructure (OSM)</div>`+['park','share','repair','shop','water'].map(k=>`<div class="item"><canvas width="18" height="18" data-glyph="${k}"></canvas>${INFRA[k].n} <span class="muted">· ${cnt[k]||0}</span></div>`).join('')+`<div class="item small muted">Zoom in to see them; racks under 10 spaces appear close up.</div>`); }
  dyn.innerHTML=items.join(''); dyn.querySelectorAll('canvas[data-glyph]').forEach(cv=>{ const c=cv.getContext('2d'); infraGlyph(c,cv.dataset.glyph,9,9,5); }); }
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
