// ═══════════════════════════════════════════════════════════════════════════
// v3: BIKE SCORE — the 100 m grid from scripts/score.py, plus what a proposal adds; proposal statistics
// ═══════════════════════════════════════════════════════════════════════════
// Method (see the Methodology panel): three equally weighted parts, each 0–100 — bike lanes (weighted length within 1 km,
// linear decay), hills (steepest grade within 200 m: 2 % → 100, 10 % → 0) and destinations (Walk Score amenity categories at
// bicycle scale, less the connectivity penalty). Bike Score's fourth part, commute mode share, is left out because a design
// cannot change it. A proposal adds its blocks to the lane part as protected lanes (weight 3) — the hill and destination
// parts are properties of the place.
const SCORE=(()=>{ const s=DATA.score; if(!s) return null; const dec=b64=>{ const bin=atob(b64); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u; };
  const lane=new Float32Array(dec(s.lane).buffer); return {...s, mask:dec(s.mask), hill:dec(s.hill), dest:dec(s.dest), lane, n:s.nx*s.ny}; })();
const SC_W=3;                                   // a proposed protected lane counts as an off-street path / protected lane
function cellAt(x,y){ const s=SCORE; const i=Math.floor((x-s.x0)/s.c), j=Math.floor((y-s.y0)/s.c); if(i<0||j<0||i>=s.nx||j>=s.ny) return -1; return j*s.nx+i; }
function cellXY(k){ const s=SCORE; return [s.x0+((k%s.nx)+0.5)*s.c, s.y0+(Math.floor(k/s.nx)+0.5)*s.c]; }
// sample points along a polyline every `step` m, each carrying `step` m of length
function samplePoly(g,step){ const out=[]; for(let i=1;i<g.length;i++){ const a=g[i-1], b=g[i]; const L=Math.hypot(b[0]-a[0],b[1]-a[1]); const n=Math.max(1,Math.round(L/step)); for(let k=0;k<n;k++){ const t=(k+0.5)/n; out.push([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, L/n]); } } return out; }
// what the proposals add to the lane raw value of each cell (cached until the block set changes)
let LANE_ADD=null, LANE_KEY='';
function laneDeltaDirty(){ LANE_KEY=''; }
function laneAdd(ids){ if(!SCORE) return null; const key=ids.slice().sort((a,b)=>a-b).join(','); if(LANE_ADD&&key===LANE_KEY) return LANE_ADD; const s=SCORE; const add=new Float32Array(s.n); const R=Math.ceil(1000/s.c);
  ids.forEach(i=>{ const blk=SEGS[i]; if(!blk||blk.bw&&(blk.bw.t==='Protected Bike Lanes')) return;   // a block that already has a protected lane adds nothing new
    const already=blk.bw?(blk.bw.t==='Painted Lanes'?1.5:blk.bw.t==='Local Street'?1:0):0;
    samplePoly(blk.g,25).forEach(([x,y,L])=>{ const ci=Math.floor((x-s.x0)/s.c), cj=Math.floor((y-s.y0)/s.c); for(let j=Math.max(0,cj-R);j<=Math.min(s.ny-1,cj+R);j++) for(let i=Math.max(0,ci-R);i<=Math.min(s.nx-1,ci+R);i++){ const k=j*s.nx+i; if(!s.mask[k]) continue; const [cx,cy]=cellXY(k); const d=Math.hypot(cx-x,cy-y); if(d>=1000) continue; add[k]+=(SC_W-already)*L*(1-d/1000); } }); });
  LANE_ADD=add; LANE_KEY=key; return add; }
const laneScore=(raw)=>Math.min(100, Math.sqrt(Math.max(0,raw)/SCORE.K)*100);   // square-root scaling, as in score.py
function cellScore(k, add){ const s=SCORE; if(!s.mask[k]) return null; const lane=laneScore(s.lane[k]+(add?add[k]:0)); return {lane, hill:s.hill[k], dest:s.dest[k], total:(lane+s.hill[k]+s.dest[k])/3}; }
const BANDS=[[90,"Biker's Paradise",'daily errands can be done by bike'],[70,'Very Bikeable','cycling is convenient for most trips'],[50,'Bikeable','some bike infrastructure'],[0,'Somewhat Bikeable','minimal bike infrastructure']];
const bandOf=v=>BANDS.find(b=>v>=b[0]);
// colour ramp for the heat map (Bike Score: red 0 → dark green 100)
function scoreColor(v){ const stops=[[0,[178,24,43]],[25,[239,138,98]],[50,[253,219,153]],[70,[161,215,106]],[90,[26,152,80]],[100,[0,104,55]]]; let a=stops[0], b=stops[stops.length-1]; for(let i=1;i<stops.length;i++){ if(v<=stops[i][0]){ a=stops[i-1]; b=stops[i]; break; } } const t=(v-a[0])/Math.max(1,b[0]-a[0]); const c=a[1].map((x,i)=>Math.round(x+(b[1][i]-x)*t)); return `rgb(${c[0]},${c[1]},${c[2]})`; }
// the terrain, regardless of the TOPO_OFF drawing switch (grades are a property of the place)
function terrAt(x,y){ const t=TERR; const fx=(x-t.x0)/t.c, fy=(y-t.y0)/t.c; const i=Math.floor(fx), j=Math.floor(fy); if(i<0||j<0||i>=t.nx-1||j>=t.ny-1) return 0; const u=fx-i, v=fy-j; const g=(ii,jj)=>t.a[jj*t.nx+ii]/10; return g(i,j)*(1-u)*(1-v)+g(i+1,j)*u*(1-v)+g(i,j+1)*(1-u)*v+g(i+1,j+1)*u*v; }
function blockGrades(s){ const pts=[]; let acc=0; for(let i=1;i<s.g.length;i++){ const a=s.g[i-1], b=s.g[i]; const L=Math.hypot(b[0]-a[0],b[1]-a[1]); const n=Math.max(1,Math.round(L/20)); for(let k=0;k<n;k++){ const t=(k+0.5)/n; pts.push([acc+t*L, terrAt(a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t)]); } acc+=L; }
  // grade over a 60 m window (three samples): the 20 m grid is interpolated from contour vertices and a single step carries noise
  const segs=[]; const W=Math.min(3,pts.length-1); for(let i=1;i<pts.length;i++){ const j=Math.max(0,i-W); const dz=pts[i][1]-pts[j][1], dl=pts[i][0]-pts[j][0]; const l=pts[i][0]-pts[i-1][0]; if(dl>0&&l>0) segs.push({g:Math.abs(dz)/dl, l}); } return segs; }
const POI_GRID=(()=>{ const m=new Map(); (DATA.poi||[]).forEach(p=>{ const k=Math.floor(p.p[0]/200)+','+Math.floor(p.p[1]/200); if(!m.has(k)) m.set(k,[]); m.get(k).push(p); }); return m; })();
function poisWithin(pts,r){ const seen=new Set(), out=[]; pts.forEach(([x,y])=>{ const cx=Math.floor(x/200), cy=Math.floor(y/200), R=Math.ceil(r/200); for(let i=-R;i<=R;i++) for(let j=-R;j<=R;j++) (POI_GRID.get((cx+i)+','+(cy+j))||[]).forEach(p=>{ if(seen.has(p)) return; if(Math.hypot(p.p[0]-x,p.p[1]-y)<=r){ seen.add(p); out.push(p); } }); }); return out; }
const POI_NAME={g:'grocery stores',r:'restaurants & bars',s:'shops',c:'cafés',b:'banks',p:'parks',e:'schools',k:'libraries & bookshops',n:'entertainment & recreation'};

// ── statistics of a proposal ──
function propStats(p){ const blocks=propBlocks(p).filter(Boolean); const ids=blocks.map(s=>s.i); const len=blocks.reduce((a,s)=>a+s.len,0);
  const cases={}; blocks.forEach(s=>{ const m=designCase(s).mode; cases[m]=(cases[m]||0)+1; });
  const seps={}; blocks.forEach(s=>{ const r=p.blocks[s.i]; const sep=r.opt.sep; seps[sep]=(seps[sep]||0)+1; });
  // connections at the block ends: inside the proposal, to an existing facility (AAA or not), to another proposal, or nothing
  const inP=new Set(ids), inAny=new Set(allPropBlockIds()); let internal=0, aaa=0, exist=0, other=0, loose=0; const links=[];
  blocks.forEach(s=>[0,1].forEach(k=>{ const nb=endNeighbours(s,k); const all=[...nb.cross,...nb.cont]; if(all.some(o=>inP.has(o.i))) { internal++; return; }
    const p0=s.g[k?s.g.length-1:0]; const bwNear=BW.filter(b=>(b.st==='Off-street'||/^OS/.test(b.sub||''))&&nearOnPoly(p0,b.g)[0]<25);
    const ex=all.filter(o=>o.bw&&!inAny.has(o.i)); const e=endInfo(s)[k];
    if(ex.some(o=>o.bw.aaa)||bwNear.some(b=>b.a)||(e.type==='path'&&e.path.des)){ aaa++; const o=ex.find(o=>o.bw.aaa); links.push({t:'aaa', n:o?titleCase(o.n):(bwNear[0]?bwTitle(bwNear[0]):(e.path&&e.path.n)||'public cycleway')}); }
    else if(ex.length||bwNear.length||e.type==='path'){ exist++; const o=ex[0]; links.push({t:'exist', n:o?titleCase(o.n)+' ('+facilityDesc(o.bw)+')':(bwNear[0]?bwTitle(bwNear[0]):(e.path&&e.path.n)||'public path')}); }
    else if(all.some(o=>inAny.has(o.i))) other++;
    else loose++; }));
  // destinations within 400 m of the proposal's blocks (a 2-minute ride)
  const pts=blocks.flatMap(s=>samplePoly(s.g,50).map(q=>[q[0],q[1]])); const near=poisWithin(pts,400); const byCat={}; near.forEach(q=>byCat[q.c]=(byCat[q.c]||0)+1);
  // grades along the proposal, from the contour grid
  const gs=blocks.flatMap(blockGrades); const gl=gs.reduce((a,x)=>a+x.l,0)||1; const gmax=gs.length?Math.max(...gs.map(x=>x.g)):0; const gmean=gs.reduce((a,x)=>a+x.g*x.l,0)/gl; const steep=gs.filter(x=>x.g>0.05).reduce((a,x)=>a+x.l,0), mod=gs.filter(x=>x.g>0.03&&x.g<=0.05).reduce((a,x)=>a+x.l,0);
  // bike score: the cells within 400 m of the proposal, before (existing network) and after (with every proposal)
  let sc=null; if(SCORE){ const add=laneAdd(allPropBlockIds()); const cells=new Set(); pts.forEach(([x,y])=>{ const R=Math.ceil(400/SCORE.c); const ci=Math.floor((x-SCORE.x0)/SCORE.c), cj=Math.floor((y-SCORE.y0)/SCORE.c); for(let j=cj-R;j<=cj+R;j++) for(let i=ci-R;i<=ci+R;i++){ if(i<0||j<0||i>=SCORE.nx||j>=SCORE.ny) continue; const k=j*SCORE.nx+i; if(!SCORE.mask[k]) continue; const [cx,cy]=cellXY(k); if(Math.hypot(cx-x,cy-y)<=400) cells.add(k); } });
    const acc=(add_)=>{ let t=0,l=0,h=0,d=0,n=0; cells.forEach(k=>{ const c=cellScore(k,add_); if(!c) return; t+=c.total; l+=c.lane; h+=c.hill; d+=c.dest; n++; }); return n?{total:t/n,lane:l/n,hill:h/n,dest:d/n,n}:null; };
    const before=acc(null), after=acc(add);
    // citywide: the mean over every scored cell, before and after
    let cb=0,ca=0,cn=0,up=0; for(let k=0;k<SCORE.n;k++){ if(!SCORE.mask[k]) continue; const b=cellScore(k,null).total, a=cellScore(k,add).total; cb+=b; ca+=a; cn++; if(a-b>=1) up++; }
    sc={before,after,cells:cells.size,city:{before:cb/cn,after:ca/cn,cells:cn,up}}; }
  return {blocks:blocks.length, len, cases, seps, conn:{internal,aaa,exist,other,loose,links}, dest:{n:near.length,byCat}, grade:{max:gmax,mean:gmean,steep,mod,len:gl}, score:sc}; }

// ── the statistics panel ──
// the statistics as HTML, for the map's panel and for the Score tab of the design screen
function statsHTML(p){ const S=propStats(p); const km=(S.len/1000).toFixed(2); const pc=v=>Math.round(v); const sgn=v=>(v>=0?'+':'')+Math.round(v);
  const caseN={new:'new lane',upgrade:'upgrade to protected lane',permanent:'made permanent',review:'review of existing lane'};
  const sepN=Object.entries(S.seps).map(([k,n])=>n+' × '+(SEP[k]?SEP[k].name.split(' (')[0].toLowerCase():k)).join(', ');
  const sc=S.score; const band=sc&&sc.after?bandOf(sc.after.total):null;
  const explain=sc&&sc.after?[`<b>Bike lanes</b> ${pc(sc.before.lane)} → ${pc(sc.after.lane)} (${sgn(sc.after.lane-sc.before.lane)}): the ${km} km of protected lane counts at weight 3 within 1 km of each cell (linear decay), like an off-street path; the existing network around it contributed the rest. Square-root scaled, so the first lanes near a place count most.`,
    `<b>Hills</b> ${pc(sc.after.hill)}: from the steepest grade within 200 m (2 % → 100, 10 % → 0). Along the proposal itself the grade averages ${(S.grade.mean*100).toFixed(1)} % and peaks at ${(S.grade.max*100).toFixed(1)} %${S.grade.steep>0?'; '+Math.round(S.grade.steep)+' m is steeper than 5 %':''}.`,
    `<b>Destinations</b> ${pc(sc.after.dest)}: Walk Score amenity categories and distances (full credit to 400 m, none beyond 1.6 km), less a penalty for few intersections or long blocks. Within 400 m of the proposal: ${S.dest.n} places${S.dest.n?' — '+Object.entries(S.dest.byCat).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([c,n])=>n+' '+POI_NAME[c]).join(', '):''}.`]:[];
  return `<div class="small muted">${S.blocks} block${S.blocks===1?'':'s'} · ${km} km · ${Object.entries(S.cases).map(([k,n])=>n+' '+(caseN[k]||k)).join(', ')||'—'}</div>
    ${sc&&sc.after?`<div class="row" style="margin-top:10px;gap:14px"><div><div class="big" style="color:${scoreColor(sc.after.total)}">${pc(sc.after.total)}</div><div class="small muted">bike score around the proposal<br>${pc(sc.before.total)} before → ${pc(sc.after.total)} after (${sgn(sc.after.total-sc.before.total)})</div></div><div><div style="font-weight:600">${band[1]}</div><div class="small muted">${band[2]}</div></div></div>
    <div class="sc"><div><b>Bike lanes</b><span>${pc(sc.before.lane)} → ${pc(sc.after.lane)}</span></div><div><b>Hills</b><span>${pc(sc.after.hill)}</span></div><div><b>Destinations</b><span>${pc(sc.after.dest)}</span></div></div>
    <div class="small muted">Mean of the ${sc.cells} grid cells within 400 m of the proposal. Citywide mean ${sc.city.before.toFixed(1)} → ${sc.city.after.toFixed(1)}; ${sc.city.up} of ${sc.city.cells} cells gain a point or more. Turn on the <b>Bike score heat map</b> layer to see it.</div>
    <div class="label" style="margin-top:10px">How the score was calculated</div>${explain.map(t=>`<div class="msg" style="background:#F8FAFC;color:var(--ink2)">${t}</div>`).join('')}<div class="small"><a href="#" data-act="method">Full methodology and references →</a></div>`:'<div class="msg warn">No score grid in the data (run scripts/score.py).</div>'}
    <div class="label" style="margin-top:10px">Connectivity</div>
    <div class="kv"><div><b>Joins the All Ages and Abilities network</b><span>${S.conn.aaa} end${S.conn.aaa===1?'':'s'}</span></div><div><b>Joins other facilities</b><span>${S.conn.exist}</span></div><div><b>Inside the proposal</b><span>${S.conn.internal} ends</span></div><div><b>Loose ends</b><span>${S.conn.loose}</span></div></div>
    ${S.conn.links.length?`<div class="small muted">${S.conn.links.slice(0,6).map(l=>(l.t==='aaa'?'AAA: ':'')+esc(l.n)).join(' · ')}${S.conn.links.length>6?' · …':''}</div>`:''}
    ${S.conn.loose?`<div class="msg warn" style="margin-top:4px">⚠<span>${S.conn.loose} end${S.conn.loose===1?'':'s'} of the proposal meet${S.conn.loose===1?'s':''} no bikeway: extend the proposal (Route fill) to reach the network or a destination.</span></div>`:'<div class="msg ok">✓<span>Every end of the proposal meets a bikeway or another block of the proposal.</span></div>'}
    <div class="label" style="margin-top:10px">Grades</div>
    <div class="kv"><div><b>Average</b><span>${(S.grade.mean*100).toFixed(1)} %</span></div><div><b>Steepest 20 m</b><span>${(S.grade.max*100).toFixed(1)} %</span></div><div><b>Over 5 % (steep)</b><span>${Math.round(S.grade.steep)} m</span></div><div><b>3–5 % (moderate)</b><span>${Math.round(S.grade.mod)} m</span></div></div>
    <div class="small muted">All Ages and Abilities guidance: keep grades under 3 % where possible; 3–5 % is acceptable for short lengths; over 5 % needs extra width for the slow uphill rider and the fast downhill one (BC Active Transportation Design Guide §3; Engineering Design Manual §8.5).</div>
    <div class="label" style="margin-top:10px">Design</div><div class="small muted">${sepN||'—'}. ${Object.values(p.blocks).filter(b=>b.auto).length} block(s) still use the default option (A) — open a block to design it.</div>
    <div class="label" style="margin-top:10px">Street photos (check the existing street)</div><div class="stats-photos small muted">…</div>`; }
function bindStats(box,p){ const m=box.querySelector('[data-act=method]'); if(m) m.onclick=e=>{ e.preventDefault(); $('method').classList.add('show'); }; const ph=box.querySelector('.stats-photos'); if(ph&&typeof renderPhotoStrip==='function') renderPhotoStrip(p, ph); }
function showStats(id){ const p=PROJ.proposals.find(x=>x.id===id)||activeProp(); const box=$('stats'); if(!p){ box.classList.remove('show'); return; } $('card').classList.remove('show');
  box.innerHTML=`<div class="row"><h3>${esc(p.name)}</h3><div class="grow"></div><button class="ghost small" data-act="close">✕</button></div>`+statsHTML(p);
  box.classList.add('show'); box.querySelector('[data-act=close]').onclick=()=>{ box.classList.remove('show'); if(typeof showPropCard==='function'&&activeProp()) showPropCard(activeProp()); }; bindStats(box,p); }
// the Score tab of the design screen: the proposal this block belongs to, or the block on its own as a one-block proposal
function renderScorePane(){ const pane=$('bscore'); if(!pane||!D.ctx||pane.style.display==='none') return; const s=D.ctx.seg; let p=propOf(s.i); let note='';
  if(!p){ const d=blockDefault(s); p={id:'tmp', name:titleCase(s.n)+' (this block only)', blocks:d?{[s.i]:{i:s.i, opt:cloneJ(curOpt()||d.opt), x:ctxOverrides(D.ctx), auto:false}}:{}}; note='<div class="msg info">This block is not in a proposal yet: the score is for the block on its own. Save it to a proposal to score the whole route.</div>'; }
  pane.innerHTML=`<div class="scorein"><h4 style="font-size:12px;font-weight:600;margin-bottom:4px">${esc(p.name)} · bike score</h4>${note}${statsHTML(p)}</div>`; bindStats(pane,p); }
$('method').addEventListener('click',e=>{ if(e.target.id==='method'||e.target.dataset.act==='close') $('method').classList.remove('show'); });
