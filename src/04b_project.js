// ═══════════════════════════════════════════════════════════════════════════
// v3: PROJECT — proposals that run over many blocks, kept in the browser and saved as a file
// ═══════════════════════════════════════════════════════════════════════════
// A proposal is a named set of blocks, each with the cross-section chosen for it (the solver's option A until the block is
// opened and edited) and any edits to its existing state (curb-to-curb, lanes, parking, bus, AADT, existing widths).
// The project holds every proposal, the map layers that are on, and imported cycling volumes. It autosaves to
// localStorage and can be saved to / opened from a .json file (Save project / Open project).
const PROP_COL='#C026D3', PROP_COL2='#E879F9';   // proposed lanes: magenta, apart from the greens of the existing network
const PROJ={ name:'Untitled project', proposals:[], active:null, layers:{prop:true,heat:false,heatProp:true,infra:false,vol:false}, volumes:[], seq:1 };
const SETTINGS=(()=>{ try{ return Object.assign({mly:'',gkey:''}, JSON.parse(localStorage.getItem('bikeway-settings')||'{}')); }catch(e){ return {mly:'',gkey:''}; } })();
function saveSettings(){ try{ localStorage.setItem('bikeway-settings', JSON.stringify(SETTINGS)); }catch(e){} }
const cloneJ=o=>JSON.parse(JSON.stringify(o));
function activeProp(){ return PROJ.proposals.find(p=>p.id===PROJ.active)||null; }
function propOf(i){ return PROJ.proposals.find(p=>p.blocks[i])||null; }
function propBlocks(p){ return Object.keys(p.blocks).map(i=>SEGS[+i]); }
function propLen(p){ return propBlocks(p).reduce((a,s)=>a+s.len,0); }
function allPropBlockIds(){ const out=[]; PROJ.proposals.forEach(p=>{ if(p.hidden) return; Object.keys(p.blocks).forEach(i=>out.push(+i)); }); return out; }   // hidden proposals are neither drawn nor counted
function newProposal(name){ const p={id:'p'+Date.now().toString(36)+(PROJ.seq++), name:name||('Proposal '+(PROJ.proposals.length+1)), blocks:{}, created:new Date().toISOString(), note:''}; PROJ.proposals.push(p); PROJ.active=p.id; projChanged(); return p; }
// what the design screen edited on the existing state, kept with the block so the proposal reopens as it was left
function ctxOverrides(c){ return {ctc:c.ctc, lanes:c.lanes, park:{...c.park}, bus:c.bus, aadt:c.aadt, beforeW:c.beforeW||null, fac:c.seg.fac||null}; }
function applyOverrides(c,x){ if(!x) return c; c.ctc=x.ctc; c.swW=Math.max(1.8,Math.min(8,(c.seg.row-c.ctc)/2)); c.lanes=x.lanes; c.park={...x.park}; c.bus=x.bus; c.aadt=x.aadt==null?null:x.aadt; c.beforeW=x.beforeW||null; return c; }
function blockDefault(s){ const c=segContext(s); const opts=generateOptions(c); return opts.length?{opt:cloneJ(opts[0]), x:ctxOverrides(c)}:null; }
// add a block to the active proposal (created if none); a block in another proposal moves over
function propAdd(s,quiet){ if(!designable(s).ok){ if(!quiet) toast(titleCase(s.n)+' cannot take a bike lane: '+designable(s).reason.split(':')[0]); return false; }
  const p=activeProp()||newProposal(); const other=propOf(s.i); if(other===p) return true; if(other) delete other.blocks[s.i];
  const d=blockDefault(s); if(!d){ if(!quiet) toast('No compliant layout fits '+titleCase(s.n)); return false; }
  p.blocks[s.i]={i:s.i, opt:d.opt, x:d.x, auto:true}; projChanged(); return true; }
function propRemove(i){ const p=propOf(i); if(!p) return; delete p.blocks[i]; projChanged(); }
function propToggle(s){ if(propOf(s.i)) { propRemove(s.i); toast(titleCase(s.n)+' removed'); } else if(propAdd(s)) toast(titleCase(s.n)+' added to '+activeProp().name+' · '+Object.keys(activeProp().blocks).length+' blocks'); }
function propDelete(id){ const k=PROJ.proposals.findIndex(p=>p.id===id); if(k<0) return; PROJ.proposals.splice(k,1); if(PROJ.active===id) PROJ.active=PROJ.proposals.length?PROJ.proposals[PROJ.proposals.length-1].id:null; projChanged(); }
function projReset(){ PROJ.proposals=[]; PROJ.active=null; projChanged(); }
// the block record's design, as the design screen stores it (the option in use plus the existing-state edits)
function propStore(s, opt, c){ const p=propOf(s.i)||activeProp()||newProposal(); p.blocks[s.i]={i:s.i, opt:cloneJ(opt), x:ctxOverrides(c), auto:false}; projChanged(); return p; }

// the proposal's other blocks near the block being designed, as lanes for the city context (plan and 3D): each block's
// bike lanes and buffers at their position across its own centreline (block frame: L = west/north = negative x)
function proposalContextLanes(s,F,near){ const p=propOf(s.i); if(!p||p.hidden) return []; const out=[];
  Object.values(p.blocks).forEach(rec=>{ if(rec.i===s.i) return; const o=SEGS[rec.i]; if(!o||!o.g.some(near)) return; const opt=rec.opt; if(!opt||opt.sep==='shared') return;
    const laid=cloneJ(opt.els); layout(laid);   // x positions come from the layout (stored options carry widths only)
    const els=laid.filter(e=>e.k==='bike'||e.k==='buf').map(e=>({k:e.k, x:e.x, w:e.w, h:e.h||0, sep:e.sep, two:!!e.two}));
    if(els.length) out.push({s:o, name:o.n, g:smoothLine(o.g).map(q=>F.toLocal(q[0],q[1])), els, ctc:rec.x?rec.x.ctc:o.ctc, designed:!rec.auto}); });
  return out; }
// ── routing: the shortest street route between two blocks, over blocks that can take a lane ──
function routeBlocks(a,b){ if(a===b) return [a]; const dist=new Map([[a.i,0]]), prev=new Map(), done=new Set(); const heap=[[0,a.i]];
  const push=(d,i)=>{ heap.push([d,i]); let k=heap.length-1; while(k>0){ const j=(k-1)>>1; if(heap[j][0]<=heap[k][0]) break; [heap[j],heap[k]]=[heap[k],heap[j]]; k=j; } };
  const pop=()=>{ const top=heap[0], last=heap.pop(); if(heap.length){ heap[0]=last; let k=0; for(;;){ const l=2*k+1, r=l+1; let m=k; if(l<heap.length&&heap[l][0]<heap[m][0]) m=l; if(r<heap.length&&heap[r][0]<heap[m][0]) m=r; if(m===k) break; [heap[m],heap[k]]=[heap[k],heap[m]]; k=m; } } return top; };
  let guard=0; while(heap.length&&guard++<60000){ const [d,i]=pop(); if(done.has(i)) continue; done.add(i); if(i===b.i) break; const s=SEGS[i];
    [0,1].forEach(k=>{ const nb=endNeighbours(s,k); [...nb.cross,...nb.cont].forEach(o=>{ if(done.has(o.i)||!designable(o).ok) return; const turn=nb.cross.includes(o)?25:0; const nd=d+o.len+turn; if(nd<(dist.has(o.i)?dist.get(o.i):Infinity)){ dist.set(o.i,nd); prev.set(o.i,i); push(nd,o.i); } }); }); }
  if(!dist.has(b.i)) return null; const out=[b]; let cur=b.i; while(cur!==a.i){ cur=prev.get(cur); out.push(SEGS[cur]); } return out.reverse(); }

// ── persistence ──
function projSerialize(){ return {v:3, app:'Vancouver Bikeway Designer', name:PROJ.name, saved:new Date().toISOString(), active:PROJ.active, layers:PROJ.layers, seq:PROJ.seq, proposals:PROJ.proposals, volumes:PROJ.volumes}; }
function projLoad(o){ if(!o||!Array.isArray(o.proposals)) throw new Error('not a project file'); PROJ.name=o.name||'Untitled project'; PROJ.proposals=o.proposals.filter(p=>p&&p.blocks).map(p=>{ Object.keys(p.blocks).forEach(i=>{ if(!SEGS[+i]||!p.blocks[i].opt) delete p.blocks[i]; }); return p; });
  PROJ.active=o.active&&PROJ.proposals.some(p=>p.id===o.active)?o.active:(PROJ.proposals[0]?PROJ.proposals[0].id:null); PROJ.layers=Object.assign(PROJ.layers,o.layers||{}); PROJ.seq=o.seq||PROJ.proposals.length+1; PROJ.volumes=Array.isArray(o.volumes)?o.volumes:[]; projChanged(); }
function projChanged(){ clearTimeout(projChanged.t); projChanged.t=setTimeout(()=>{ try{ localStorage.setItem('bikeway-project-v3', JSON.stringify(projSerialize())); }catch(e){} },250);
  if(typeof laneDeltaDirty==='function') laneDeltaDirty(); if(typeof CTX_CACHE!=='undefined') CTX_CACHE.id=null; renderProj(); if(typeof renderLegend==='function') renderLegend(); if($('screen-map').classList.contains('active')) drawMap(); }
function projSaveFile(){ const txt=JSON.stringify(projSerialize(),null,1); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([txt],{type:'application/json'})); a.download=(PROJ.name||'project').replace(/[^\w\- ]+/g,'').trim().replace(/\s+/g,'-')+'.bikeproject.json'; a.click(); toast('Project saved as '+a.download); }
$('proj-file').addEventListener('change',e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{ try{ projLoad(JSON.parse(r.result)); toast('Opened '+PROJ.name+' · '+PROJ.proposals.length+' proposal'+(PROJ.proposals.length===1?'':'s')); }catch(err){ toast('Could not open: '+err.message); } }; r.readAsText(f); e.target.value=''; });
(function projBoot(){ try{ const raw=localStorage.getItem('bikeway-project-v3'); if(raw) projLoad(JSON.parse(raw)); }catch(e){ console.warn('project autosave not restored', e); } })();

// ── map modes: select (cards) · add (click adds / removes a block) · route (two clicks, the route between fills in) ──
// the default is to build: every block clicked joins the active proposal (a first click starts "Proposal 1"), a second click
// on the same block takes it out; the pointer shows + over a block that would be added and − over one that would be removed.
// "Inspect" is the single-block card of earlier versions; "Route fill" adds the street route between two clicks.
map.mode='add'; map.routeA=null;
// pointer glyphs: a small circled + / − (SVG data URIs), with copy / not-allowed as fallbacks
const CUR_PLUS="url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22'><circle cx='11' cy='11' r='9' fill='white' stroke='%230F172A' stroke-width='1.5'/><path d='M11 6v10M6 11h10' stroke='%23C026D3' stroke-width='2.2' stroke-linecap='round'/></svg>\") 11 11, copy";
const CUR_MINUS="url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22'><circle cx='11' cy='11' r='9' fill='white' stroke='%230F172A' stroke-width='1.5'/><path d='M6 11h10' stroke='%23DC2626' stroke-width='2.2' stroke-linecap='round'/></svg>\") 11 11, not-allowed";
function mapCursor(h,hb){ if(map.mode==='add'){ if(h) return designable(h).ok?(propOf(h.i)?CUR_MINUS:CUR_PLUS):'not-allowed'; return hb?'pointer':'crosshair'; }
  if(map.mode==='route') return h&&designable(h).ok?CUR_PLUS:(h?'not-allowed':'crosshair'); return h?(designable(h).ok?'pointer':'not-allowed'):hb?'pointer':'crosshair'; }
function hintFor(m){ return m==='add' ? 'Click blocks to build '+(activeProp()?activeProp().name:'a proposal')+' (+ adds, − removes) · click an existing bikeway for details' : m==='route' ? (map.routeA?'Now click the block where the route should end':'Route fill: click the block where the route starts') : 'Inspect: click a block for its details · click an existing bikeway for its details'; }
function setMapMode(m){ map.mode=m; map.routeA=null; $('card').classList.remove('show'); map.sel=null; map.selBW=null; renderProj(); drawMap(); if(m!=='select'&&activeProp()&&Object.keys(activeProp().blocks).length) showPropCard(activeProp());
  $('maphint').textContent=hintFor(m); }
// called by the map's click handler with the bikeway feature and street block under the pointer
function mapClick(b,s){ if(map.mode==='add'){ if(s&&designable(s).ok){ propToggle(s); if(activeProp()) showPropCard(activeProp(), propOf(s.i)?s:null); $('maphint').textContent=hintFor('add');
      // the pointer is still on the block: switch the glyph and the tooltip to what the next click would do
      map.c.style.cursor=mapCursor(s,null); const tip=$('maptip'); if(tip.classList.contains('show')) tip.innerHTML='<b>'+(propOf(s.i)?'<span style="color:#FCA5A5">− remove</span>':'<span style="color:#F0ABFC">+ add</span>')+' · '+titleCase(s.n)+'</b>'+s.u+' · '+s.len+' m'; }
    else if(b) selectBW(b); else if(s) selectSeg(s); return true; }
  if(map.mode==='route'){ if(!s) return true; if(!designable(s).ok){ toast(titleCase(s.n)+' cannot take a bike lane'); return true; }
    if(!map.routeA){ map.routeA=s; setMapMode('route'); map.routeA=s; $('maphint').textContent='Now click the block where the route should end'; drawMap(); return true; }
    const r=routeBlocks(map.routeA,s); map.routeA=null; if(!r){ toast('No street route found between those blocks'); drawMap(); return true; }
    let n=0; r.forEach(o=>{ if(propAdd(o,true)) n++; }); toast(n+' blocks added along the route · '+Math.round(r.reduce((a,o)=>a+o.len,0))+' m'); $('maphint').textContent='Route fill: click the block where the next route starts'; showPropCard(activeProp()); return true; }
  return false; }
// the blocks of a proposal in route order (chained end to end where they touch), for the navigator and the photo strip
function propOrder(p){ const blocks=propBlocks(p).filter(Boolean); if(!blocks.length) return []; const order=[]; const left=new Set(blocks.map(s=>s.i)); let cur=blocks[0];
  // start from an end of the chain: a block with a neighbour in the set at one end only
  const endBlock=blocks.find(s=>{ const n=[0,1].map(k=>{ const nb=endNeighbours(s,k); return [...nb.cont,...nb.cross].some(o=>left.has(o.i)); }); return n[0]!==n[1]; }); if(endBlock) cur=endBlock;
  while(cur){ order.push(cur); left.delete(cur.i); let nxt=null; [1,0].forEach(k=>{ if(nxt) return; const nb=endNeighbours(cur,k); nxt=[...nb.cont,...nb.cross].find(o=>left.has(o.i))||null; }); if(!nxt) nxt=blocks.find(s=>left.has(s.i))||null; cur=nxt; } return order; }
// the proposal's card on the map: what is selected, and the same button as a single block — Design bike lanes →
// focus: the block just clicked (still in the proposal) — the card then offers that block alone or the whole proposal
function showPropCard(p,focus,opts){ p=p||activeProp(); if(!p) return; opts=opts||{}; const order=propOrder(p); const n=order.length; if(focus&&!p.blocks[focus.i]) focus=null; map.sel=focus||null; map.selBW=null; drawMap();   // the focused block is drawn in orange (map.sel)
  $('c-title').textContent=p.name; $('c-sub').textContent=`${n} block${n===1?'':'s'} · ${(propLen(p)/1000).toFixed(2)} km · ${map.mode==='add'?'click blocks to add or remove':map.mode==='route'?'click a start and an end block to fill a route':'proposal'}`;
  const cases={}; order.forEach(s=>{ const m=designCase(s).mode; cases[m]=(cases[m]||0)+1; }); const caseN={new:'new lane',upgrade:'upgrade to protected lane',permanent:'make permanent',review:'review existing lane'};
  // v3: the score first, then the three steps — build (blocks), verify (street photos), design (block by block, the whole proposal in the drawings)
  const S=n?propStats(p):null; const designed=order.filter(s=>!p.blocks[s.i].auto).length; const det=!!(opts.details||(showPropCard.open===p.id+':det')), ver=!!(opts.verify||(showPropCard.open===p.id+':ver'));
  const steps=`<div class="steps card-steps"><span class="${n?'done':''}"><b>1</b>Build · ${n} block${n===1?'':'s'}</span><span class="${ver?'on':''}" data-act="verify" title="Check the recorded lanes, parking and bikeway of each block against a street photo before designing"><b>2</b>Verify streets</span><span class="${designed?'done':''}" title="Design the cross-section block by block; the plan and 3D views show the whole proposal"><b>3</b>Design · ${designed} of ${n}</span></div>`;
  $('c-case').innerHTML=n?(S?scoreBoxHTML(S,'box'):'')+steps+`<div id="c-sdet" class="stats" style="display:${det?'':'none'}">${S?statsHTML(p,S):''}</div><div id="c-verify" style="display:${ver?'':'none'}"><div class="label" style="margin-top:6px">Verify streets</div><div class="stats-photos small muted">…</div></div>`+Object.entries(cases).map(([k,c])=>`<span class="case ${k}">${c} × ${caseN[k]||k}</span> `).join('')+`<div class="casewhy">${focus?'<b>'+esc(titleCase(focus.n))+'</b> selected · '+focus.u.toLowerCase()+' · '+focus.len+' m · '+designCase(focus).label.toLowerCase()+'. ':''}Each block uses the default option (A) until you design it. The drawings show the whole proposal; the cross-section is designed block by block (‹ › moves along the route).</div>`:'<div class="casewhy">No blocks yet. Click blocks on the map, or a start and an end block with Route fill.</div>';
  const cc=$('c-case'); const sdBtn=cc.querySelector('[data-act=sdet]'); if(sdBtn){ sdBtn.textContent=det?'Details ▴':'Details ▾'; sdBtn.onclick=()=>{ showPropCard.open=det?null:p.id+':det'; showPropCard(p,focus); }; }
  const vBtn=cc.querySelector('[data-act=verify]'); if(vBtn) vBtn.onclick=()=>{ showPropCard.open=ver?null:p.id+':ver'; showPropCard(p,focus); };
  if(det&&S&&typeof bindStats==='function') bindStats(cc.querySelector('#c-sdet'),p); if(ver&&typeof renderPhotoStrip==='function') renderPhotoStrip(p, cc.querySelector('#c-verify .stats-photos'));
  $('c-kv').innerHTML=''; $('c-ctx').innerHTML=''; const bl=$('c-blocks'); bl.style.display=n?'':'none'; bl.innerHTML=order.map((s,i)=>`<div ${focus&&s.i===focus.i?'style="background:#FDF4FF;border-radius:4px"':''}><a href="#" data-i="${s.i}">${i+1}. ${esc(titleCase(s.n))}</a><span>${s.len} m${p.blocks[s.i].auto?'':' · designed'}</span></div>`).join('');
  bl.querySelectorAll('a').forEach(a=>a.onclick=e=>{ e.preventDefault(); openProposalDesign(p, order.findIndex(s=>s.i===+a.dataset.i)); });
  const b1=$('c-design1'); b1.style.display=focus?'':'none'; if(focus){ b1.textContent='Design only '+titleCase(focus.n)+' →'; b1.onclick=()=>{ D.prop=null; openDesign(focus); }; }
  const btn=$('c-design'); btn.disabled=!n; btn.textContent=n?`Design all ${n} block${n===1?'':'s'} →`:'Add blocks first'; btn.onclick=()=>openProposalDesign(p, focus?Math.max(0,order.findIndex(s=>s.i===focus.i)):0);
  const cp=$('c-prop'); cp.style.display='none';   // the score and its details are in the card itself
  $('c-close').style.display='none';   // the card that leads to the design page cannot be closed away
  $('stats').classList.remove('show'); $('card').classList.add('show'); }
// design the proposal block by block: the design screen with a navigator; the current design is kept in the proposal when moving on
function openProposalDesign(p,idx){ const order=propOrder(p); if(!order.length) return; idx=clamp(idx||0,0,order.length-1); D.prop={id:p.id, order:order.map(s=>s.i), idx}; openDesign(order[idx]); }
function propNavKeep(){ if(!D.prop||!D.ctx) return; const p=PROJ.proposals.find(x=>x.id===D.prop.id); if(!p) return; const o=curOpt(); if(!o) return; const rec=p.blocks[D.ctx.seg.i]; if(rec&&rec.auto&&!o.custom&&!o.edited&&o.id==='A'&&JSON.stringify(ctxOverrides(D.ctx))===JSON.stringify(rec.x)) return;   // untouched default with no existing-state edits: leave it as the default
  propStore(D.ctx.seg,o,D.ctx); }
function renderPropNav(){ const el=$('pnav'); if(!D.prop){ el.style.display='none'; return; } const p=PROJ.proposals.find(x=>x.id===D.prop.id); if(!p){ D.prop=null; el.style.display='none'; return; } const n=D.prop.order.length, i=D.prop.idx;
  el.style.display=''; el.innerHTML=`<b>${esc(p.name)}</b> · block ${i+1} of ${n} <button data-act="prev" ${i<=0?'disabled':''} title="Previous block (keeps this design)">‹</button><button data-act="next" ${i>=n-1?'disabled':''} title="Next block (keeps this design)">›</button><button class="wide" data-act="all" title="Solve every block of the proposal with this option's separation and direction">Apply to all blocks</button><button class="wide" data-act="done" title="Keep this design and return to the map">Done · back to map</button>`;
  el.querySelectorAll('button').forEach(b=>b.onclick=()=>{ const a=b.dataset.act; propNavKeep(); if(a==='prev'||a==='next'){ D.prop.idx+=a==='next'?1:-1; openDesign(SEGS[D.prop.order[D.prop.idx]]); }
    else if(a==='all'){ const o=curOpt(); let n2=0, near=0; const rank=s=>SEP_RANK[s]||0;
      D.prop.order.forEach(i=>{ const s=SEGS[i]; if(s===D.ctx.seg) return; const rec=p.blocks[i]; const c=applyOverrides(segContext(s),rec&&rec.x); const opts=generateOptions(c); if(!opts.length) return;
        // the same separation and direction where that block's case allows it, else the nearest separation in the durability order
        if(rec&&rec.x&&'fac' in rec.x&&typeof setUserFacility==='function'){ setUserFacility(s,rec.x.fac); }
        const m=opts.find(x=>x.sep===o.sep&&x.mode===o.mode)||opts.find(x=>x.sep===o.sep)||opts.slice().sort((a,b)=>(Math.abs(rank(a.sep)-rank(o.sep))-Math.abs(rank(b.sep)-rank(o.sep)))||((a.mode===o.mode?0:1)-(b.mode===o.mode?0:1)))[0];
        if(m.sep!==o.sep) near++; p.blocks[i]={i, opt:cloneJ(m), x:ctxOverrides(c), auto:false}; n2++; });
      projChanged(); toast(SEP[o.sep].name.split(' (')[0]+' · '+(o.mode==='two'?'two-way':'one-way each side')+' applied to '+n2+' other blocks, each solved for its own width'+(near?' ('+near+' took the nearest separation their case allows)':''), 4000); renderPropNote(); }
    else if(a==='done'){ showMap(); showPropCard(p); } }); }
function toast(msg,ms){ const t=$('toast'); t.textContent=msg; t.style.display='block'; clearTimeout(toast.t); toast.t=setTimeout(()=>t.style.display='none', ms||2600); }

// ── the project panel ──
function renderProj(){ const box=$('proj'); if(!box) return; const ap=activeProp();
  const arm=renderProj.arm||{};   // two-step confirmation: the first click arms the button, the second within 6 s acts (no browser dialogs)
  const rows=PROJ.proposals.map(p=>{ const n=Object.keys(p.blocks).length; const del=arm.del===p.id; const ren=arm.ren===p.id;
    return `<div class="prow ${p.id===PROJ.active?'active':''} ${p.hidden?'hid':''}" data-id="${p.id}" title="Click to make this the active proposal · double-click to rename"><button class="ghost small eye" data-act="eye" data-id="${p.id}" title="${p.hidden?'Show this proposal on the map':'Hide this proposal on the map (it is then not counted either)'}">${p.hidden?'◌':'👁'}</button><span class="dot" style="background:${p.id===PROJ.active?PROP_COL:PROP_COL2}"></span>${ren?`<input class="nm" data-ren="${p.id}" type="text" value="${esc(p.name)}" style="padding:2px 5px;border:1px solid var(--accent);border-radius:5px">`:`<span class="nm">${esc(p.name)}</span>`}<small>${n} block${n===1?'':'s'} · ${(propLen(p)/1000).toFixed(1)} km</small>${n&&typeof scoreBoxHTML==='function'?scoreBoxHTML(propStats(p),'row'):''}<button class="ghost small" data-act="stats" data-id="${p.id}" title="Bike score details and statistics">📊</button><button class="${del?'danger':'ghost'} small" data-act="del" data-id="${p.id}" title="${del?'Click again to delete':'Delete this proposal'}">${del?'delete?':'✕'}</button></div>`; }).join('');
  box.innerHTML=`<h4><span>Project</span><input id="proj-name" type="text" value="${esc(PROJ.name)}" title="Project name"><span class="grow"></span><button class="ghost small" data-act="save" title="Save the project as a file">💾</button><button class="ghost small" data-act="open" title="Open a project file">📂</button><button class="ghost small" data-act="settings" title="Settings: street-photo tokens">⚙</button></h4>
    <div class="plist">${rows||'<div class="small muted" style="padding:4px 6px">No proposals yet. Click blocks on the map to build one (each click adds a block; <b>Route fill</b> adds a whole route), then <b>Design all blocks →</b> on its card.</div>'}</div>
    <div class="modes"><button class="${map.mode==='add'?'on':''}" data-mode="add" title="Default: click blocks to build the proposal — + adds, − removes">Build</button><button class="${map.mode==='route'?'on':''}" data-mode="route" title="Click a start block and an end block; the street route between them is added">Route fill</button><button class="${map.mode==='select'?'on':''}" data-mode="select" title="Click a block for its own card, without adding it">Inspect</button></div>
    <div class="acts2"><button data-act="new">+ New proposal</button>${ap?`<button data-act="stats" data-id="${ap.id}">Bike score &amp; statistics</button>`:''}<button data-act="reset" class="danger" title="${arm.reset?'Click again to remove every block from '+(ap?ap.name:'the proposal'):'Remove every selected block from the active proposal (the proposal stays, empty)'}" ${ap&&Object.keys(ap.blocks).length?'':'disabled'}>${arm.reset?'Remove all '+Object.keys(ap.blocks).length+' blocks?':'Reset proposal'}</button></div>`;
  box.querySelectorAll('.prow').forEach(r=>{ r.onclick=e=>{ if(e.target.closest('button,input')) return; PROJ.active=r.dataset.id; projChanged(); showPropCard(activeProp()); }; r.ondblclick=e=>{ if(e.target.closest('button,input')) return; renderProj.arm={ren:r.dataset.id}; renderProj(); const inp=box.querySelector('input[data-ren]'); if(inp){ inp.focus(); inp.select(); } }; });
  const ri=box.querySelector('input[data-ren]'); if(ri){ const done=()=>{ const p=PROJ.proposals.find(x=>x.id===ri.dataset.ren); if(p&&ri.value.trim()) p.name=ri.value.trim(); renderProj.arm={}; projChanged(); }; ri.onkeydown=e=>{ e.stopPropagation(); if(e.key==='Enter') done(); if(e.key==='Escape'){ renderProj.arm={}; renderProj(); } }; ri.onblur=done; }
  box.querySelectorAll('button[data-mode]').forEach(b=>b.onclick=()=>setMapMode(b.dataset.mode));
  const disarm=()=>{ clearTimeout(renderProj.t); renderProj.t=setTimeout(()=>{ if(renderProj.arm&&(renderProj.arm.del||renderProj.arm.reset)){ renderProj.arm={}; renderProj(); } },6000); };
  box.querySelectorAll('button[data-act]').forEach(b=>b.onclick=()=>{ const a=b.dataset.act;
    if(a==='new'){ const p=newProposal(); toast(p.name+' created — click blocks to add them'); if(map.mode==='select') setMapMode('add'); else $('maphint').textContent=hintFor(map.mode); }
    else if(a==='del'){ const p=PROJ.proposals.find(x=>x.id===b.dataset.id); if(!p) return; if(arm.del===p.id){ renderProj.arm={}; propDelete(p.id); $('stats').classList.remove('show'); $('card').classList.remove('show'); toast('"'+p.name+'" deleted'); } else { renderProj.arm={del:p.id}; renderProj(); disarm(); } }
    else if(a==='reset'){ const p=activeProp(); if(!p||!Object.keys(p.blocks).length) return; if(arm.reset){ renderProj.arm={}; const n=Object.keys(p.blocks).length; p.blocks={}; projChanged(); $('stats').classList.remove('show'); showPropCard(p); toast(p.name+' reset · '+n+' block'+(n===1?'':'s')+' removed'); } else { renderProj.arm={reset:true}; renderProj(); disarm(); } }
    else if(a==='eye'){ const p=PROJ.proposals.find(x=>x.id===b.dataset.id); if(p){ p.hidden=!p.hidden; projChanged(); } }
    else if(a==='save') projSaveFile(); else if(a==='open') $('proj-file').click(); else if(a==='settings') showSettings();
    else if(a==='stats'){ if(typeof showStats==='function') showStats(b.dataset.id); } });
  const nm=$('proj-name'); nm.onchange=()=>{ PROJ.name=nm.value.trim()||'Untitled project'; projChanged(); }; nm.onkeydown=e=>e.stopPropagation(); }
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function showSettings(){ const m=$('settings'); m.querySelector('#set-mly').value=SETTINGS.mly||''; m.querySelector('#set-gkey').value=SETTINGS.gkey||''; m.classList.add('show'); }
$('settings').addEventListener('click',e=>{ if(e.target.id==='settings'||e.target.dataset.act==='close') $('settings').classList.remove('show'); if(e.target.dataset.act==='saveset'){ SETTINGS.mly=$('set-mly').value.trim(); SETTINGS.gkey=$('set-gkey').value.trim(); saveSettings(); $('settings').classList.remove('show'); toast('Settings saved'); if(typeof refreshPhoto==='function') refreshPhoto(); } });
// the block card: add / remove this block
function renderCardProp(s){ const b=$('c-prop'); if(!b) return; $('c-blocks').style.display='none'; $('c-design').onclick=defaultDesignClick; const p=propOf(s.i); const ok=designable(s).ok; b.style.display=ok?'':'none'; if(!ok) return;
  b.textContent=p?'Remove from '+p.name:'+ Add to '+(activeProp()?activeProp().name:'a new proposal'); b.onclick=()=>{ propToggle(s); renderCardProp(s); }; }
