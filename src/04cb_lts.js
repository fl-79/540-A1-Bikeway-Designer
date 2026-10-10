// ═══════════════════════════════════════════════════════════════════════════
// v4: LEVEL OF TRAFFIC STRESS (LTS) — how comfortable each block is to ride, before and after a proposal
// ═══════════════════════════════════════════════════════════════════════════
// Method: Mekuria, Furth & Nixon (2012), "Low-Stress Bicycling and Network Connectivity", Mineta Transportation Institute
// report 11-19 — the original criteria, which need no traffic volumes (the City publishes none): Table 2 (bike lanes alongside
// parking), Table 3 (bike lanes not alongside parking), Table 4 (mixed traffic), Table 7 (unsignalised crossings, no median
// refuge), and §III "physically separated bikeways … LTS 1" (curbs, medians, parking lanes, flexible bollards). A block takes
// the WORST of its factors (the weakest-link rule), and an unsignalised crossing of a wide or fast street at either end can
// only make it worse. Furth's v2.2 (2022) note 4 is also applied: a bike lane is never rated worse than mixed traffic on the
// same street would be.
//   LTS 1  comfortable for children · LTS 2  most adults (the All Ages and Abilities population) · LTS 3  confident riders ·
//   LTS 4  fearless riders only.
// Speed thresholds in the tables are in mph; the bins are converted: ≤ 40 km/h = "up to 25 mph", 41–52 = "30 mph",
// 53–60 = "35 mph", over 60 = "40+ mph" (50 km/h is 31 mph).
//
// No assumed inputs. Every input is either real data for the block or UNKNOWN, and an unknown is enumerated over the values it
// can take in Vancouver, giving a RANGE of levels (lo–hi) rather than a guess:
//   speed limit   OpenStreetMap maxspeed, or the City's bikeways layer (speed_limit), or the value confirmed by the user on the
//                 design screen; else unknown → {30, 50} km/h (the posted limits in the city; 40 and 60 appear only where
//                 OSM tags them)
//   lanes         OpenStreetMap lanes, or the user's verified value; else unknown → {2, 4} (two-way) / {1, 2} (one-way). On a
//                 Residential-class street the 2012 method's own surrogate applies (the authors used the residential class for
//                 "no centreline, fewer than 3 lanes" where lane data was missing, Table 4 note a)
//   lane width    a proposal's drawn width (bike lane + marked buffer); an existing painted lane's width is not recorded →
//                 unknown → {under 1.8 m, 1.8 m or more} (the 6 ft threshold)
//   parking       a parking lane beside the bike lane: known from the design, from the subtype of an existing painted lane
//                 (PBP / PBPT = buffer on the parking side), or from parking meters on the block; else unknown
//   crossings     the crossing street's speed and lanes, as above; a crossing with a traffic signal is not a barrier (2012);
//                 an RRFB or special crosswalk is not a signal; median refuges are not in the data, so Table 7 (no refuge) is
//                 used — conservative, and the same before and after
//   volumes, bike lane blockage, right-turn lanes, raised medians  not in any public dataset: not used, and said so.
// The map draws a block at the worse end of its range (dashed where it is a range). Network figures count a block as low
// stress only when its whole range is LTS 1–2, and as improved only when the worse end of the range drops.
const LTS_COL={1:'#4A5FC1',2:'#A3B1E8',3:'#F7A64A',4:'#D7191C',0:'#B0B7C3'};   // indigo → periwinkle → orange → red: cool to hot with no teal, so it sits apart from the bikeway greens and the proposal magenta   // ColorBrewer RdYlBu stops, cool → hot; green stays the bikeways' colour, yellow is dropped (invisible on the pale map)
const LTS_NAME={1:'comfortable for children',2:'most adults — All Ages and Abilities',3:'confident riders only',4:'fearless riders only'};
const LTS_SHORT={1:'children',2:'most adults',3:'confident riders',4:'fearless only'};
const LTS_SRC='Mekuria, Furth & Nixon 2012, MTI 11-19';
function ltsSpdBin(v){ return v<=40?0:v<=52?1:v<=60?2:3; }   // 0 = up to 25 mph · 1 = 30 mph · 2 = 35 mph · 3 = 40+ mph
const ltsBinName=['up to 40 km/h','41–52 km/h','53–60 km/h','over 60 km/h'];
const SIG_TRUE=/Signal|Fixed Time|Actuated/;   // a traffic signal (not an RRFB, special crosswalk, FH or CS)
function isSignal(t){ return !!t && SIG_TRUE.test(t) && !/RRFB/.test(t); }
// ── the real inputs of a block ──
function ltsSpeed(s){ const o=s.osm||{}; if(o.spd) return {v:o.spd, src:'OSM'}; if(s.bw&&s.bw.spd) return {v:s.bw.spd, src:'City bikeways layer'}; return null; }
function ltsLanes(s){ const o=s.osm||{}; if(o.ln) return {v:Math.min(o.ln,8), src:'OSM'}; return null; }
// ── one evaluation of the segment tables with every input known ──
// q: {fac:'sep'|'paint'|'mixed', spd, lanes (total), ow, resid, bw (bike lane width incl. buffer, m), park (bool), reach (m)}
function ltsSegOne(q){
  if(q.fac==='sep') return 1;
  const sb=ltsSpdBin(q.spd); const n=q.lanes; const perDir=q.ow?n:Math.max(1,Math.floor(n/2));
  const col=q.ow?(n<=1?0:n===2?1:2):(n<=3?0:n<=5?1:2);           // Table 4 width class: 2–3 lanes · 4–5 · 6+
  const T4=[[q.resid?1:2,3,4],[q.resid?2:3,4,4],[4,4,4],[4,4,4]]; const mixed=T4[sb][col];
  if(q.fac==='mixed') return mixed;
  let l=1;
  if(q.park){ // Table 2: bike lanes alongside a parking lane
    if(perDir>=2) l=Math.max(l,3);
    const r=q.reach; if(r>=4.57) {} else if(r>=4.26){ if(!(q.spd<40||q.resid)) l=Math.max(l,2); } else l=Math.max(l,3);   // 15 ft · 14–14.5 ft (note a) · ≤ 13.5 ft
    l=Math.max(l,[1,2,3,4][sb]); }
  else { // Table 3: not alongside parking (a raised median between directions is not in the data, so 2 lanes per direction → 3)
    if(perDir>=2) l=Math.max(l,3);
    if(q.bw<1.83) l=Math.max(l,2);                                   // under 6 ft
    l=Math.max(l,[1,1,3,4][sb]); }
  return Math.min(l, mixed);                                        // v2.2 note 4
}
// ── enumerate the unknowns: returns {lo, hi, unknown:[names], why} ──
function ltsSeg(q){
  const dom=[]; const unknown=[];
  const spd=q.spd!=null?[q.spd]:(unknown.push('speed limit'),[30,50]);
  let lanes; if(q.lanes!=null) lanes=[q.lanes]; else if(q.resid&&!q.ow) lanes=[2]; else { unknown.push('lane count'); lanes=q.ow?[1,2]:[2,4]; }
  const park=q.fac==='paint'?(q.park!=null?[q.park]:(unknown.push('parking beside the lane'),[true,false])):[false];
  const bw=q.fac==='paint'?(q.bw!=null?[q.bw]:(unknown.push('bike lane width'),[1.5,1.83])):[0];
  const reach=q.fac==='paint'?(q.reach!=null?[q.reach]:(q.bw!=null?[q.bw+2.5]:[4.0,4.57])):[0];   // a drawn lane beside a 2.5 m parking lane
  let lo=9, hi=0;
  spd.forEach(S=>lanes.forEach(L=>park.forEach(P=>bw.forEach(W=>reach.forEach(R=>{ const l=ltsSegOne({...q, spd:S, lanes:L, park:P, bw:W, reach:R}); lo=Math.min(lo,l); hi=Math.max(hi,l); })))));
  if(q.fac==='sep') unknown.length=0;
  return {lo, hi, unknown:[...new Set(unknown)]};
}
// ── the crossing of a street at one end of a block (Table 7, no median refuge): returns {lo,hi,unknown} or null when no barrier ──
function ltsCrossOne(spd, lanes, ow){ const sb=ltsSpdBin(spd); const col=ow?(lanes<=1?0:lanes<=2?1:2):(lanes<=3?0:lanes<=5?1:2); return [[1,2,4],[1,2,4],[2,3,4],[3,4,4]][sb][col]; }
function ltsCross(s,k){
  const ix=(s.ix||[])[k]; if(ix&&isSignal(ix.sig)) return null;   // signalised: not a barrier in the 2012 criteria
  const xs=(typeof sameLevelCross==='function'?sameLevelCross(s,k):endNeighbours(s,k).cross).filter(o=>o.s!==s.s); if(!xs.length) return null;
  let lo=0, hi=0; const unknown=new Set(); let worst=null;
  xs.forEach(o=>{ const sp=ltsSpeed(o), ln=ltsLanes(o); const spd=sp?[sp.v]:(unknown.add('cross-street speed limit'),[30,50]);
    let lanes; if(ln) lanes=[ln.v]; else if(o.u==='Residential'&&!o.ow) lanes=[2]; else { unknown.add('cross-street lane count'); lanes=o.ow?[1,2]:[2,4]; }
    let l0=9, l1=0; spd.forEach(S=>lanes.forEach(L=>{ const l=ltsCrossOne(S,L,!!o.ow); l0=Math.min(l0,l); l1=Math.max(l1,l); }));
    if(l1>hi||(l1===hi&&l0>lo)){ worst=o; } lo=Math.max(lo,l0); hi=Math.max(hi,l1); });
  return {lo, hi, unknown:[...unknown], street:worst?titleCase(worst.n):'', rrfb:!!(ix&&ix.sig&&!isSignal(ix.sig))};
}
// ── the existing state of a block (what is there today), as the tables see it ──
// over: the user's confirmed existing state from the design screen (rec.x of a verified block): {lanes, park, spd, fac}
function ltsExisting(s, over){
  const bw=s.bw; const sub=(bw&&bw.sub)||''; const sp=over&&over.spd?{v:over.spd, src:'confirmed on the design screen'}:ltsSpeed(s);
  const ln=over&&over.lanes!=null&&over.verified?{v:over.lanes, src:'confirmed on the design screen'}:ltsLanes(s);
  const q={spd:sp?sp.v:null, lanes:ln?ln.v:null, ow:!!s.ow, resid:s.u==='Residential'}; const src=[]; let fac='';
  if(sp) src.push(sp.v+' km/h ('+sp.src+')'); if(ln) src.push(ln.v+' lane'+(ln.v>1?'s':'')+' ('+ln.src+')'); else if(s.u==='Residential'&&!s.ow) src.push('residential class → fewer than 3 lanes, no centreline (the 2012 study\'s surrogate)');
  if(bw&&(bw.t==='Protected Bike Lanes'||sub==='SL'||sub==='R'||sub==='OSS'||sub==='OSB')){ q.fac='sep'; fac='protected / separated lane'; }
  else if(bw&&(bw.t==='Painted Lanes'||/^(NB|PBT|PBP|PBPT)$/.test(sub))){ q.fac='paint'; fac='painted lane'+(SUBTYPE[sub]?' ('+SUBTYPE[sub]+')':''); q.bw=null;
    const pm=s.pm||{L:0,R:0}; q.park=(sub==='PBP'||sub==='PBPT')?true:(pm.L+pm.R>0)?true:(over&&over.verified&&over.park)?!!(over.park.L||over.park.R):null;
    if(q.park&&sub!=='PBP'&&sub!=='PBPT'&&pm.L+pm.R>0) src.push('parking meters on the block'); }
  else { q.fac='mixed'; fac=bw?(bw.t==='Local Street'?'local street bikeway (shared)':'shared lane markings'):'no facility, mixed traffic'; }
  const seg=ltsSeg(q); const cr=[0,1].map(k=>ltsCross(s,k)).filter(Boolean);
  return ltsCombine(seg, cr, {fac, src, q});
}
// ── a proposal's design on a block: the option chosen (rec.opt) with the confirmed existing state (rec.x) ──
function ltsProposed(s, rec){
  const o=rec&&rec.opt; if(!o) return ltsExisting(s, rec&&rec.x);
  const x=rec.x||{}; const sp=x.spd?{v:x.spd, src:'confirmed on the design screen'}:ltsSpeed(s);
  const q={spd:sp?sp.v:null, ow:!!s.ow, resid:s.u==='Residential'}; const src=[]; let fac='';
  if(sp) src.push(sp.v+' km/h ('+sp.src+')');
  const els=o.els||[]; const lanesN=els.filter(e=>e.k==='travel').length||o.lanes; q.lanes=lanesN; src.push(lanesN+' travel lane'+(lanesN>1?'s':'')+' in the design');
  if(o.sep==='shared'){ q.fac='mixed'; fac='local street bikeway (shared, traffic-calmed)'; }
  else { // is the bike lane physically separated from the travel lanes (curb, posts, planters, barrier, raised, or a parking lane between)?
    const bikes=els.map((e,i)=>({e,i})).filter(x=>x.e.k==='bike'); let sep=false, paintW=null, park=false, reach=null;
    bikes.forEach(({e,i})=>{ const dir=e.side==='L'?1:-1;   // towards the travel lanes
      let w=e.w, j=i+dir, phys=false, pk=false, pkW=0; while(els[j]&&els[j].k!=='travel'){ const n=els[j]; if(n.k==='buf'){ if(SEP[n.sep]&&SEP[n.sep].bufKind!=='paint'&&SEP[n.sep].bufKind!=='none') phys=true; else w+=n.w; } if(n.k==='park'){ pk=true; pkW=n.w; phys=true; } j+=dir; }
      if(phys) sep=true; else { paintW=paintW==null?w:Math.min(paintW,w); if(pk){ park=true; reach=w+pkW; } } });
    // the lane sits beside parking on the curb side (bike at the curb, parking outside it) → "alongside a parking lane"
    bikes.forEach(({e,i})=>{ const dir=e.side==='L'?-1:1; let j=i+dir; while(els[j]&&els[j].k!=='sw'){ if(els[j].k==='park'){ park=true; if(reach==null) reach=e.w+els[j].w; } j+=dir; } });
    if(sep){ q.fac='sep'; fac=SEP[o.sep]?SEP[o.sep].name.toLowerCase():'separated lane'; }
    else { q.fac='paint'; fac='painted lane, no physical separation'; q.bw=paintW!=null?Math.round(paintW*100)/100:null; q.park=park; q.reach=reach; if(q.bw!=null) src.push(fmt(q.bw)+' m lane incl. buffer'); } }
  const seg=ltsSeg(q); const cr=[0,1].map(k=>ltsCross(s,k)).filter(Boolean);
  return ltsCombine(seg, cr, {fac, src, q});
}
function ltsCombine(seg, cr, info){ let lo=seg.lo, hi=seg.hi; const unknown=[...seg.unknown]; let crossNote='';
  cr.forEach(c=>{ if(c.hi>seg.hi||c.lo>seg.lo){ crossNote=(c.hi>hi||!crossNote)?('unsignalised crossing of '+c.street+(c.rrfb?' (RRFB only)':'')+' → LTS '+(c.lo===c.hi?c.hi:c.lo+'–'+c.hi)):crossNote; } lo=Math.max(lo,c.lo); hi=Math.max(hi,c.hi); c.unknown.forEach(u=>{ if(!unknown.includes(u)) unknown.push(u); }); });
  return {lo, hi, seg, cross:cr, unknown, fac:info.fac, src:info.src, q:info.q, crossNote}; }
const ltsText=r=>r.lo===r.hi?('LTS '+r.hi):('LTS '+r.lo+'–'+r.hi);
function ltsLabel(r){ return ltsText(r)+' · '+(r.lo===r.hi?LTS_NAME[r.hi]:LTS_SHORT[r.lo]+' to '+LTS_SHORT[r.hi]); }
// one line of reasons for a card or panel
function ltsWhy(r){ const bits=[r.fac]; if(r.src.length) bits.push(r.src.join(', ')); if(r.crossNote) bits.push(r.crossNote); if(r.unknown.length) bits.push('not in the data: '+r.unknown.join(', ')+(r.lo!==r.hi?' — shown as a range':' (the level is the same either way)')); return bits.join(' · '); }
// ── cache of the existing state for every block (the citywide layer) ──
function ltsOf(s){ if(!s._lts){ s._lts=ltsExisting(s, null); } return s._lts; }
// a proposal block's before (with its confirmed existing state) and after
function ltsPair(s, rec){ const before=ltsExisting(s, rec&&rec.verified?{...rec.x, verified:true}:(rec&&rec.x&&rec.x.spd?{spd:rec.x.spd}:null)); const after=ltsProposed(s, rec); return {before, after, drop:Math.max(0,before.hi-after.hi), low:after.hi<=2, wasLow:before.hi<=2}; }
// the LTS a block shows on the map: its proposal's design when the layer includes proposals
function ltsShown(s){ if(PROJ.layers.ltsProp!==false){ const p=propOf(s.i); if(p&&!p.hidden){ const r=ltsAfterCached(p, s.i); if(r) return r.after; } } return ltsOf(s); }
var LTS_CACHE=new Map();   // proposal id + block → pair, cleared by projChanged (ltsDirty)
function ltsDirty(){ LTS_CACHE.clear(); }
function ltsAfterCached(p, i){ const rec=p.blocks[i]; if(!rec) return null; const key=p.id+':'+i; const sig=JSON.stringify([rec.opt&&rec.opt.sep, rec.opt&&rec.opt.els, rec.x, !!rec.verified]); const c=LTS_CACHE.get(key); if(c&&c.sig===sig) return c.pair; const pair=ltsPair(SEGS[i], rec); LTS_CACHE.set(key,{sig, pair}); return pair; }
// ── network figures: the whole city, and what the visible proposals change ──
// low-stress = every level in the block's range is 1–2 (hi ≤ 2); high-stress = the whole range is 3–4 (lo ≥ 3)
function ltsNetwork(extra){ const t0=performance.now(); const out={lowKm:0, highKm:0, rangeKm:0, bwHigh:0, bwHighKm:0, blocks:0, after:{lowKm:0, bwHigh:0, bwHighKm:0, improved:0, drops:0, newLow:0, newLowKm:0}};
  const inProp=new Map(); PROJ.proposals.forEach(p=>{ if(p.hidden) return; Object.keys(p.blocks).forEach(i=>inProp.set(+i,p)); });
  SEGS.forEach(s=>{ if(!designable(s).ok&&!s.bw) return; const r=ltsOf(s); const km=s.len/1000; out.blocks++;
    if(r.hi<=2) out.lowKm+=km; else if(r.lo>=3) out.highKm+=km; else out.rangeKm+=km;
    const bwHigh=s.bw&&r.hi>2; if(bwHigh){ out.bwHigh++; out.bwHighKm+=km; }
    const p=inProp.get(s.i); let a=r; if(p){ const pr=(extra&&extra.i===s.i)?ltsPair(s,{...p.blocks[s.i], opt:extra.opt}):ltsAfterCached(p,s.i); if(pr){ a=pr.after; if(pr.drop>0){ out.after.improved++; out.after.drops+=pr.drop; } if(a.hi<=2&&r.hi>2){ out.after.newLow++; out.after.newLowKm+=km; } } }
    if(a.hi<=2) out.after.lowKm+=km; if(s.bw&&a.hi>2){ out.after.bwHigh++; out.after.bwHighKm+=km; } });
  out.ms=performance.now()-t0; return out; }
var LTS_NET=null; function ltsNetworkCached(){ if(!LTS_NET) LTS_NET=ltsNetwork(); return LTS_NET; } function ltsNetDirty(){ LTS_NET=null; }
// ── a proposal's traffic-stress summary ──
function ltsPropStats(p, extra){ const rows=propOrder(p).map(s=>{ const rec=p.blocks[s.i]; const pr=(extra&&extra.i===s.i)?ltsPair(s,{...rec, opt:extra.opt}):ltsAfterCached(p,s.i); return {s, ...pr}; });
  const n=rows.length; const low=rows.filter(r=>r.low).length, wasLow=rows.filter(r=>r.wasLow).length, improved=rows.filter(r=>r.drop>0).length, drops=rows.reduce((a,r)=>a+r.drop,0);
  const unknownB=rows.filter(r=>r.before.lo!==r.before.hi).length, unknownA=rows.filter(r=>r.after.lo!==r.after.hi).length; const worstB=Math.max(0,...rows.map(r=>r.before.hi)), worstA=Math.max(0,...rows.map(r=>r.after.hi));
  const upg=rows.filter(r=>r.s.bw&&r.drop>0).length; const crashes=typeof crashOfProposal==='function'?crashOfProposal(p):null;
  return {rows, n, low, wasLow, newLow:low-Math.min(low,wasLow), improved, drops, unknownB, unknownA, worstB, worstA, upg, crashes}; }
// the summary as HTML: a box (card), a chip (proposal row), or the detail list (statistics)
function ltsBoxHTML(L, mode){ if(!L||!L.n) return ''; const col=LTS_COL[L.worstA]||LTS_COL[0];
  if(mode==='row') return `<span class="srow" title="Cycling comfort: ${L.low} of ${L.n} blocks at LTS 1–2 after the proposal (${L.wasLow} before) · ${L.improved} block${L.improved===1?'':'s'} improved" style="color:${col}">LTS ${L.worstB}→${L.worstA}</span>`;
  if(mode==='chip') return `<span class="muted">· comfort <b style="color:${col}">LTS ${L.worstB} → ${L.worstA}</b> on the worst block · ${L.low} of ${L.n} blocks low-stress</span>`;
  const ok=L.low===L.n; return `<div class="scorebox" style="margin-top:0"><div class="num" style="color:${col};font-size:22px">${L.low}<small style="font-size:11px;color:var(--ink3)">/${L.n}</small></div><div class="grow"><div><b>Cycling comfort</b> · blocks at LTS 1–2 (comfortable for most adults)</div><div class="small muted">${L.wasLow} of ${L.n} were low-stress before · <b style="color:${L.improved?'var(--green)':'var(--ink2)'}">${L.improved} improved</b>${L.upg?' ('+L.upg+' existing bikeway'+(L.upg===1?'':'s')+' upgraded)':''} · worst block LTS ${L.worstB} → ${L.worstA}${L.unknownA?' · '+L.unknownA+' shown as a range (inputs not in the data)':''}</div>${ok?'':'<div class="small" style="color:var(--amber)">'+(L.n-L.low)+' block'+(L.n-L.low===1?'':'s')+' still above LTS 2 — see which in the details</div>'}${L.crashes&&L.crashes.c?`<div class="small muted">ICBC ${DATA.crash.years}: <b>${L.crashes.c}</b> cyclist crash${L.crashes.c===1?'':'es'} on these blocks and their intersections (${L.crashes.ci} with injury)</div>`:''}</div></div>`; }
function ltsDetailHTML(L){ if(!L||!L.n) return ''; const sw=l=>`<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${LTS_COL[l]};vertical-align:middle;margin-right:3px"></span>`;
  return `<div class="label" style="margin-top:10px">Cycling comfort, block by block</div><div class="small">${L.rows.map(r=>`<div style="display:flex;gap:6px;align-items:baseline;padding:2px 0;border-bottom:1px dashed var(--line)"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(titleCase(r.s.n))}</span><span class="mono" title="${esc(ltsWhy(r.before))}">${sw(r.before.hi)}${ltsText(r.before)}</span><span class="muted">→</span><span class="mono" title="${esc(ltsWhy(r.after))}">${sw(r.after.hi)}${ltsText(r.after)}</span>${r.drop?`<span style="color:var(--green);font-weight:600">−${r.drop}</span>`:r.after.hi>2?'<span style="color:var(--amber)" title="'+esc(r.after.crossNote||'')+'">!</span>':''}</div>`).join('')}</div>
    <div class="small muted" style="margin-top:4px">Levels of Traffic Stress after ${LTS_SRC}: a block takes the worst of its facility, its street's speed and lanes, and any unsignalised crossing of a wide or fast street at its ends. Hover a level for its inputs. A range means an input is not in the data (speed limit or lane count from OpenStreetMap, lane width, parking); confirming the existing street on the block's tab resolves it. <a href="#" data-act="method">Method and references →</a></div>`; }
// the citywide line for the project panel and the legend
function ltsNetHTML(){ const N=ltsNetworkCached(); const d=N.after.lowKm-N.lowKm; const up=N.bwHigh-N.after.bwHigh;
  return `<div class="small" style="margin-top:6px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:#F8FAFC" title="Cycling comfort (Level of Traffic Stress) over the city's streets (${LTS_SRC}). Low-stress = LTS 1–2 over the whole range of the block's possible inputs. Counts every visible proposal.">
    <div><b>Comfortable streets (LTS 1–2)</b> <span class="mono">${N.lowKm.toFixed(1)} km</span>${d>0.0005?` → <span class="mono" style="color:var(--green);font-weight:600">${N.after.lowKm.toFixed(1)} km (+${d.toFixed(2)})</span>`:''}</div>
    <div class="muted">Existing bikeways not yet comfortable (above LTS 2): <span class="mono">${N.bwHigh}</span>${up>0?` → <span class="mono" style="color:var(--green);font-weight:600">${N.after.bwHigh}</span> (${up} upgraded)`:up<0?` → <span class="mono" style="color:var(--amber);font-weight:600">${N.after.bwHigh}</span> (${-up} made worse by a design)`:' blocks to upgrade'} · ${N.after.improved?`<span style="color:var(--green);font-weight:600">${N.after.improved} block${N.after.improved===1?'':'s'} improved</span>`:'no block improved yet'}</div></div>`; }
// ── ICBC crashes (scripts/icbc.py): per street node and per block ──
const CRASH=(()=>{ const c=DATA.crash; if(!c) return null; const grid=new Map(); c.nodes.forEach(n=>{ const k=Math.floor(n[0]/50)+','+Math.floor(n[1]/50); if(!grid.has(k)) grid.set(k,[]); grid.get(k).push(n); }); return {...c, grid}; })();
function crashNodeAt(p){ if(!CRASH) return null; const cx=Math.floor(p[0]/50), cy=Math.floor(p[1]/50); let best=null, bd=20; for(let i=-1;i<=1;i++) for(let j=-1;j<=1;j++) (CRASH.grid.get((cx+i)+','+(cy+j))||[]).forEach(n=>{ const d=Math.hypot(n[0]-p[0],n[1]-p[1]); if(d<bd){ bd=d; best=n; } }); return best; }
// crashes of one block: at each end (the intersection) and mid-block → {ends:[node|null,node|null], mid:[t,c,ci,p]|null, c, ci}
function crashOfBlock(s){ if(!CRASH) return null; if(s._crash) return s._crash; const ends=[s.g[0],s.g[s.g.length-1]].map(crashNodeAt); const mid=CRASH.blocks[s.i]||null; const c=ends.reduce((a,n)=>a+(n?n[3]:0),0)+(mid?mid[1]:0), ci=ends.reduce((a,n)=>a+(n?n[4]:0),0)+(mid?mid[2]:0); return s._crash={ends, mid, c, ci}; }
function crashOfProposal(p){ if(!CRASH) return null; const seen=new Set(); let c=0, ci=0, t=0; propBlocks(p).filter(Boolean).forEach(s=>{ const r=crashOfBlock(s); r.ends.forEach(n=>{ if(n&&!seen.has(n)){ seen.add(n); c+=n[3]; ci+=n[4]; t+=n[2]; } }); if(r.mid){ c+=r.mid[1]; ci+=r.mid[2]; t+=r.mid[0]; } }); return {c, ci, t}; }
function crashText(s){ const r=crashOfBlock(s); if(!r) return ''; const bits=[]; r.ends.forEach((n,i)=>{ if(n&&n[3]) bits.push(n[3]+' at '+(n[6]?titleCase(n[6]):(i?'the far end':'the near end'))+(n[4]?' ('+n[4]+' injured)':'')); }); if(r.mid&&r.mid[1]) bits.push(r.mid[1]+' mid-block'+(r.mid[2]?' ('+r.mid[2]+' injured)':'')); return bits.length?('Cyclist crashes '+CRASH.years+' (ICBC): '+bits.join(' · ')):'No cyclist crash reported to ICBC '+CRASH.years+' on this block or at its ends'; }
// ── traffic signals: one glyph per street node (block ends share a node) ──
const SIG_NODES=(()=>{ const m=new Map(); SEGS.forEach(s=>[0,1].forEach(k=>{ const e=(s.ix||[])[k]; if(!e||!e.sig||e.sig==='nan') return; const p=s.g[k?s.g.length-1:0]; const key=Math.round(p[0]/12)+','+Math.round(p[1]/12); if(!m.has(key)) m.set(key,{p, t:e.sig}); })); return [...m.values()]; })();
function sigClass(t){ return /RRFB|Special Crosswalk|^FH$|^CS$/.test(t)?'beacon':/Pedestrian/.test(t)?'ped':'full'; }
const SIG_STYLE={full:{c:'#0F172A', n:'Traffic signal (fixed time / actuated)'}, ped:{c:'#2563EB', n:'Pedestrian-actuated signal'}, beacon:{c:'#D97706', n:'RRFB / special crosswalk (no signal)'}};
