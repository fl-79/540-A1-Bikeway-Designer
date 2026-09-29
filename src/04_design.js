// ═══════════════════════════════════════════════════════════════════════════
// DESIGN SCREEN STATE
// ═══════════════════════════════════════════════════════════════════════════
const D = { ctx:null, options:[], cur:0, before:false, anim:false, city:true, view:'3d', beforeEls:[] };
function showMap(){ $('screen-map').classList.add('active'); $('screen-design').classList.remove('active'); $('btn-back').style.display='none'; stop3D(); mapResize(); drawMap(); }
function showDesign(){ $('screen-map').classList.remove('active'); $('screen-design').classList.add('active'); $('btn-back').style.display='inline-block'; }
$('btn-back').onclick=showMap;
$('btn-collapse').onclick=()=>{ const b=$('bottom'); b.classList.toggle('collapsed'); $('btn-collapse').textContent=b.classList.contains('collapsed')?'▴ Show panel':'▾ Hide panel'; setTimeout(redrawViews,220); };
$('c-design').onclick=()=>{ if(map.sel && designable(map.sel).ok) openDesign(map.sel); else if(map.selBW){ const blk=blockOfBW(map.selBW); if(blk){ zoomTo(blk); selectSeg(blk); } } };

function openDesign(s){
  D.ctx=segContext(s); const c=D.ctx;
  $('d-title').textContent=titleCase(s.n)+' · '+(s.ix.filter(Boolean).map(i=>titleCase(i.x.split(' AND ').filter(n=>!n.startsWith(s.s)).join('/')||'')).filter(Boolean).join(' – ')||s.u);
  const cs=c.case; $('d-tag').title=cs.why; $('d-tag').innerHTML=`<span class="case ${cs.mode}">${cs.label}</span> ${s.u}${s.ow?' · one-way':''}${s.bus?' · bus':''}${s.truck?' · truck':''} · ${s.spd} km/h · ${s.ctc} m curb-to-curb${cs.existing?' · existing: '+cs.existing+(cs.when?' ('+cs.when+')':''):''}`;
  $('dir-note').textContent = c.dirMode==='two'?'two-way required':c.dirMode==='one'?'one-way each side required':'';
  { const sw=c.swW||RULES.sidewalk; $('sw-note').textContent = lvlOf(s)>0 ? `On a structure: the existing deck sidewalk (${fmt(sw)} m each side) is kept as it is — no sidewalk or boulevard is added; the design fits the existing carriageway.` : `Sidewalk + boulevard fixed at ${fmt(sw)} m each side — property lines cannot change.`; }
  $('x-ctc').value=c.ctc; $('x-lanes').value=c.lanes; $('x-lL').textContent=c.lbl[0]; $('x-lR').textContent=c.lbl[1]; $('x-pL').value=c.park.L?1:0; $('x-pR').value=c.park.R?1:0; $('x-bus').value=c.bus?1:0; $('x-aadt').value='';
  // show the screen first: the 2D renderers need a laid-out (non-zero) canvas before they can draw
  showDesign(); regenerate(); setView(D.view);
}
['x-ctc','x-lanes','x-pL','x-pR','x-bus','x-aadt'].forEach(id=>$(id).addEventListener('change',()=>{ const c=D.ctx; c.ctc=Math.max(6,+$('x-ctc').value||c.ctc); c.swW=Math.max(1.8,Math.min(8,(c.seg.row-c.ctc)/2)); c.lanes=+$('x-lanes').value; c.park={L:$('x-pL').value==='1',R:$('x-pR').value==='1'}; c.bus=$('x-bus').value==='1'; const a=parseInt($('x-aadt').value,10); c.aadt=isNaN(a)?null:a; regenerate(true); }));
function regenerate(keepCustom){
  const custom = keepCustom ? D.options.filter(o=>o.custom) : [];
  D.options=[...generateOptions(D.ctx), ...custom]; D.beforeEls=existingElements(D.ctx); D.cur=0; D.sel=null;   // v2: "before" includes the facility that is there today
  if (!D.options.length) { $('warnings').innerHTML='<div class="msg err">No compliant layout fits: even two minimum travel lanes plus a minimum bike facility exceed the curb-to-curb width. Check the curb-to-curb value.</div>'; }
  renderChips(); renderAll();
}
function curOpt(){ return D.options[D.cur]; }
function renderChips(){ $('opt-chips').innerHTML=D.options.map((o,i)=>`<button class="chip ${i===D.cur?'active':''} ${o.custom?'custom':''}" data-i="${i}" title="${o.title}">${o.id}${o.custom?'':' · '+SEP[o.sep].name.split(' ')[0]}</button>`).join('');
  $('opt-chips').querySelectorAll('button').forEach(b=>b.onclick=()=>{ D.cur=+b.dataset.i; D.sel=null; renderChips(); renderAll(); }); }
$('btn-revert').onclick=()=>{ const o=curOpt(); if(!o) return; if(o.custom){ D.cur=0; } else { const fresh=generateOptions(D.ctx).find(x=>x.id===o.id); if(fresh) D.options[D.cur]=fresh; } D.sel=null; renderChips(); renderAll(); };
$('btn-save').onclick=()=>{ const o=curOpt(); if(!o) return; const n=D.options.filter(x=>x.custom).length+1; const id=String.fromCharCode(68+n-1); D.options.push({...JSON.parse(JSON.stringify(o)), id, custom:true, title:'Iteration '+n+' ('+o.title+')'}); D.cur=D.options.length-1; renderChips(); renderAll(); };

// ── editor (v2): the cross-section is edited in the view — click an element, drag the handles — and the panel mirrors it ──
const KNAME={sw:'Sidewalk + boulevard',bike:'Bike lane',buf:'Buffer',park:'Parking',travel:'Travel lane'};
const KCOL={sw:'#D9D6CF',bike:'#3FB06E',buf:'#B7C4CC',park:'#7C8DA0',travel:'#5F7A9A'};
D.sel=null; D.editOn=true;
function renderEditor(){ const o=curOpt(); if(!o){ $('ed-strip').innerHTML=''; $('props').innerHTML=''; return; } renderStrip(); renderProps(); updateBar(); }
function renderStrip(){ const o=curOpt(); const c=D.ctx; const locked=o.sep==='shared';
  $('ed-strip').innerHTML=o.els.map((e,i)=>`<div class="k-${e.k} ${i===D.sel?'sel':''} ${e.k==='sw'||locked?'lock':''}" style="flex:${e.w}" data-i="${i}" title="${elLabel(e,c)} · ${fmt(e.w)} m"><span>${elShort(e)}</span><small>${fmt(e.w)}</small></div>`).join('');
  $('ed-strip').querySelectorAll('div[data-i]').forEach(d=>d.onclick=()=>{ if(d.classList.contains('lock')) return; selectEl(+d.dataset.i); }); }
function propsHTML(o,i){ const e=o.els[i]; const c=D.ctx; if(!e) return ''; const fl=elFloor(e,o.els);
  const seps=Object.keys(SEP).filter(k=>k!=='shared').map(k=>`<option value="${k}" ${e.sep===k?'selected':''}>${SEP[k].name}</option>`).join('');
  const lvls=LEVELS.map(([h,n])=>`<option value="${h}" ${Math.abs((e.h||0)-h)<0.001?'selected':''}>${n}</option>`).join('')+(LEVELS.every(([h])=>Math.abs((e.h||0)-h)>0.001)?`<option value="${e.h}" selected>${e.h.toFixed(2)} m</option>`:'');
  const step=e.k==='buf'?'3':e.k==='bike'?'4':'2';
  return `<div class="ph"><span class="swatch" style="background:${KCOL[e.k]}"></span><b>${elLabel(e,c)}</b><span class="grow"></span><button class="ghost small" data-act="close" title="Deselect">✕</button></div>
    <div class="prow"><label>② Width</label><input type="number" step="0.05" min="${fl}" max="8" value="${e.w}" data-act="w"> <span class="muted small">m · floor ${fmt(fl)}${e.k==='travel'?' · max '+e.max:''}</span></div>
    ${e.k==='buf'?`<div class="prow"><label>③ Protection</label><select data-act="sep">${seps}</select></div>`:''}
    ${e.k==='buf'||e.k==='bike'?`<div class="prow"><label>④ Level</label><select data-act="lvl">${lvls}</select></div>`:''}
    <div class="prow acts"><label>Add</label>
      <button data-act="ins" data-k="buf" data-dir="L" title="Insert a buffer on the left of this element">+ buffer ◀</button><button data-act="ins" data-k="buf" data-dir="R" title="Insert a buffer on the right">▶ buffer +</button>
      ${e.k!=='bike'?`<button data-act="ins" data-k="bike" data-dir="${e.side==='L'?'L':'R'}" title="Insert a bike lane on the curb side">+ bike lane</button>`:''}
      ${e.k==='travel'?`<button data-act="ins" data-k="park" data-dir="${e.side==='L'?'L':'R'}" title="Insert parking on the curb side">+ parking</button>`:''}</div>
    <div class="prow acts"><label>Change</label>
      ${e.k==='travel'?`<button data-act="conv" data-k="park">→ parking</button><button data-act="conv" data-k="buf">→ buffer</button>`:''}
      ${e.k==='park'?`<button data-act="conv" data-k="travel">→ travel lane</button><button data-act="conv" data-k="buf">→ buffer</button>`:''}
      ${e.k==='buf'?`<button data-act="conv" data-k="park">→ parking</button>`:''}
      ${e.k==='bike'?`<button data-act="lvl" data-h="${(e.h||0)>0.05?0:0.15}">${(e.h||0)>0.05?'lower to street':'raise to curb level'}</button>`:''}
      <button data-act="rm" class="danger">remove</button></div>`; }
function bindProps(el){
  el.oninput=ev=>{ const t=ev.target; if(t.dataset.act==='w'&&D.sel!=null){ edSetWidth(curOpt(),D.sel,parseFloat(t.value)||0); renderAll(true); } };
  el.onchange=ev=>{ const t=ev.target, o=curOpt(); if(D.sel==null) return; if(t.dataset.act==='sep'){ edSetSep(o,D.sel,t.value); renderAll(); } else if(t.dataset.act==='lvl'&&t.tagName==='SELECT'){ edSetLevel(o,D.sel,parseFloat(t.value)); renderAll(); } else if(t.dataset.act==='w'){ renderAll(); } };
  el.onclick=ev=>{ const b=ev.target.closest('button'); if(!b||D.sel==null) return; const o=curOpt(); const a=b.dataset.act;
    if(a==='close') selectEl(null); else if(a==='ins'){ D.sel=edInsert(o,D.sel,b.dataset.dir,b.dataset.k); renderAll(); } else if(a==='rm'){ edRemove(o,D.sel); D.sel=null; renderAll(); }
    else if(a==='conv'){ edConvert(o,D.sel,b.dataset.k); renderAll(); } else if(a==='lvl'){ edSetLevel(o,D.sel,parseFloat(b.dataset.h)); renderAll(); } }; }
function renderProps(){ const o=curOpt(); const box=$('props'); if(!o||D.sel==null||o.sep==='shared'||!o.els[D.sel]){ box.innerHTML=`<div class="small muted" style="padding:6px 2px">${o&&o.sep==='shared'?'A shared local-street bikeway keeps the existing section; nothing to edit.':'Click a lane, buffer or parking strip in the Plan or Section view (or in the strip above) to edit it.'}</div>`; box.classList.remove('props'); return; }
  box.classList.add('props'); box.innerHTML=propsHTML(o,D.sel); bindProps(box); }
function selectEl(i){ D.sel=i; renderEditor(); redrawViews(); }
// the same properties float beside the selected element in plan / section
function showPop(force){ const pop=$('pop'); const o=curOpt(); const canvas=D.view==='plan'?$('plan-a'):D.view==='sec'?$('sec-a'):null; const E=canvas&&canvas._edit;
  if(!o||D.sel==null||!E||!o.els[D.sel]||o.sep==='shared'){ pop.classList.remove('show'); pop.dataset.sel=''; return; }
  const key=o.id+':'+D.sel+':'+o.els.length+':'+o.els[D.sel].w+':'+(o.els[D.sel].h||0)+':'+(o.els[D.sel].sep||''); if((force||pop.dataset.sel!==key)&&!pop.contains(document.activeElement)){ pop.dataset.sel=key; pop.innerHTML=propsHTML(o,D.sel); bindProps(pop); }   // re-render on any change, but never under the user's cursor while typing
  const e=o.els[D.sel]; const dpr=devicePixelRatio; const cr=canvas.getBoundingClientRect(), vr=$('vp').getBoundingClientRect();
  const cx=cr.left-vr.left+E.toPx(e.x+e.w/2)/dpr, cy=cr.top-vr.top+E.popY/dpr; pop.classList.add('show');
  const pw=pop.offsetWidth||300, ph=pop.offsetHeight||160; pop.style.left=clamp(cx-pw/2, cr.left-vr.left+8, cr.right-vr.left-pw-8)+'px'; pop.style.top=clamp(cy-ph-14, 8, vr.height-ph-8)+'px'; }
$('pop').addEventListener('mousedown',e=>e.stopPropagation());
// inline width box on a dimension number (plan / section): Enter or blur applies, Escape cancels; the neighbouring travel lane absorbs the difference
function inlineEdit(canvas,dm){ const inp=$('inl'); const o=curOpt(); if(!o||o.sep==='shared'||!o.els[dm.i]) return; const dpr=devicePixelRatio; const cr=canvas.getBoundingClientRect(), vr=$('vp').getBoundingClientRect();
  const cw=Math.max(58, dm.w/dpr+18); inp.style.left=(cr.left-vr.left+dm.px/dpr-cw/2)+'px'; inp.style.top=(cr.top-vr.top+dm.py/dpr-13)+'px'; inp.style.width=cw+'px';
  inp.value=fmt(o.els[dm.i].w); inp.dataset.i=dm.i; inp.style.display='block'; D.sel=dm.i; renderEditor(); redrawViews(); inp.focus(); inp.select(); }
function applyInline(){ const inp=$('inl'); if(inp.style.display==='none') return; inp.style.display='none'; const o=curOpt(); const i=+inp.dataset.i; const w=parseFloat(inp.value); if(!o||isNaN(w)) return; edSetWidthKeep(o,i,w); renderAll(); }
$('inl').addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Enter') applyInline(); else if(e.key==='Escape'){ $('inl').style.display='none'; } });
$('inl').addEventListener('blur',applyInline);
$('inl').addEventListener('mousedown',e=>e.stopPropagation());
window.addEventListener('keydown',e=>{ if(!$('screen-design').classList.contains('active')||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return; if(e.key==='Escape'&&D.sel!=null) selectEl(null); if((e.key==='Delete'||e.key==='Backspace')&&D.sel!=null){ const o=curOpt(); if(o&&o.sep!=='shared'){ edRemove(o,D.sel); D.sel=null; renderAll(); } } });
function updateBar(){ const o=curOpt(); if(!o) return; const c=D.ctx; const inner=o.els.filter(e=>e.k!=='sw'); const sum=inner.reduce((s,e)=>s+e.w,0); $('ed-total').textContent=fmt(sum)+' / '+fmt(c.ctc)+' m';
  $('ed-strip').querySelectorAll('div[data-i]').forEach(d=>{ const e=o.els[+d.dataset.i]; if(!e) return; d.style.flex=e.w; d.querySelector('small').textContent=fmt(e.w); });
  const r=c.ctc-sum; const rm=$('ed-remain'); rm.textContent = Math.abs(r)<0.05?'Balanced':(r>0?fmt(r)+' m unallocated':fmt(-r)+' m over'); rm.style.color=Math.abs(r)<0.05?'var(--green)':'var(--red)'; }
$('btn-balance').onclick=()=>{ const o=curOpt(); if(!o) return; const c=D.ctx; const inner=o.els.filter(e=>e.k!=='sw'); let r=c.ctc-inner.reduce((s,e)=>s+e.w,0);
  if (r>0) { const order=[e=>e.k==='bike', e=>e.k==='travel', e=>e.k==='buf']; const caps=[e=>e.two?RULES.bike.two.pref[1]:RULES.bike.one.pref[1], e=>e.max, e=>99]; for(let k=0;k<order.length&&r>0.001;k++){ const t=inner.filter(order[k]); const room=t.map(e=>Math.max(0,caps[k](e)-e.w)); const tot=room.reduce((a,b)=>a+b,0); if(tot<=0) continue; const g=Math.min(r,tot); t.forEach((e,i)=>e.w+=g*room[i]/tot); r-=g; } }
  else if (r<0) { let need=-r; const order=[e=>e.k==='travel', e=>e.k==='buf', e=>e.k==='bike']; const floors=[e=>e.min, e=>{const adj=o.els[o.els.indexOf(e)+(e.side==='L'?1:-1)]; return bufMin(e.sep,adj&&adj.k==='park',e.two?'two':'one');}, e=>e.two?RULES.bike.two.min:RULES.bike.one.min]; for(let k=0;k<order.length&&need>0.001;k++){ const t=inner.filter(order[k]); const room=t.map(e=>Math.max(0,e.w-floors[k](e))); const tot=room.reduce((a,b)=>a+b,0); if(tot<=0) continue; const g=Math.min(need,tot); t.forEach((e,i)=>e.w-=g*room[i]/tot); need-=g; } }
  o.els.forEach(e=>e.w=Math.round(e.w*100)/100); renderAll(); };

function renderPanels(){ const o=curOpt(); if(!o) return; const c=D.ctx;
  const issues=checkCompliance(o,c); const errs=issues.filter(i=>i.lvl==='err').length, warns=issues.length-errs;
  $('status').innerHTML = errs? `<span class="tag err">Non-compliant · ${errs} issue${errs>1?'s':''}</span>` : warns? `<span class="tag warn">Compliant with notes</span>` : `<span class="tag ok">Compliant</span>`;
  $('warnings').innerHTML = issues.length? issues.map(i=>`<div class="msg ${i.lvl}">${i.lvl==='err'?'⛔':'⚠'}<span>${i.msg}</span></div>`).join('') : '<div class="msg ok">✓<span>All widths within EDM Tables 8-6, 8-7 and 8-10 and the facility connects correctly to the network.</span></div>';
  $('recs').innerHTML = recommendations(o,c).map(r=>`<div class="msg info">💡<span>${r}</span></div>`).join('');
  const pros=[], cons=[...(o.tradeoffs||[])];
  // v2: what changes against the facility that is there today
  const cs=c.case; if (cs.existing && o.sep!=='shared') { const bk=o.els.filter(e=>e.k==='bike'), bb=D.beforeEls.filter(e=>e.k==='bike');
    if (cs.mode==='review') pros.push(`Review: the existing ${cs.existing} is kept in its form; drawn at ${bk.length?fmt(bk[0].w)+' m':'—'} (its built width is not recorded, so the minimum is checked, not the drawing)`);
    else pros.push(`${cs.mode==='upgrade'?'Upgrade':'Made permanent'}: ${cs.existing} → ${SEP[o.sep].name.toLowerCase()}${bb.length&&bk.length?', lane width '+fmt(bb[0].w)+' → '+fmt(bk[0].w)+' m':''}${(bb.length===1)!==(bk.length===1)?', '+(bk.length===1?'one two-way lane':'a lane on each side'):''}`); }
  pros.push(`${SEP[o.sep].name}: ${SEP[o.sep].prot.toLowerCase()} protection, ${SEP[o.sep].cost}/km`);
  if (o.sep!=='shared') pros.push(o.mode==='two'?'Single two-way facility on the '+c.lbl[o.twoSide==='L'?0:1]+' side — one curb line to protect':'One-way lane each side — simplest at intersections and laneways');
  if (c.same.length) pros.push('Matches the existing facility direction so the network connects');
  o.els.filter(e=>e.k==='park').forEach(e=>pros.push('Parking retained on the '+c.lbl[e.side==='L'?0:1]+' side (parking-protected)'));
  if (o.sep==='barrier') cons.push('Concrete barrier limits curbside access and reduces effective bike lane width');
  if (o.sep==='posts') cons.push('Flex posts give no physical protection and need frequent replacement');
  if (o.sep==='planter') cons.push('Planters need ongoing watering and replanting');
  if (o.sep==='raised') cons.push('Raised lane means full reconstruction of the curb, drainage and the bike lane pavement (highest cost, longest closure)');
  if (o.sep==='extruded' && cs.mode==='permanent') cons.push('Extruded curb keeps the street-level lane: cheapest permanent form, but sweeping and snow clearing need narrow equipment');
  if (o.mode==='two' && ((c.ln.L||[]).length+(c.ln.R||[]).length)) cons.push('Two-way operation adds contra-flow conflicts at laneways and intersections');
  $('summary').innerHTML = pros.map(p=>`<p class="pro">${p}</p>`).join('')+cons.map(p=>`<p class="con">${p}</p>`).join('');
}
function renderAll(fromEditor){ if(!fromEditor) renderEditor(); else updateBar(); renderPanels(); redrawViews(); }

// view plumbing
$('tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{ $('tabs').querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); setView(b.dataset.v); });
$('tg-before').onclick=()=>{ D.before=!D.before; $('tg-before').classList.toggle('on',D.before); setView(D.view); };
$('tg-anim').onclick=()=>{ D.anim=!D.anim; $('tg-anim').classList.toggle('on',D.anim); if(D.view==='3d') setAnim(D.anim); anim2D(D.anim&&D.view==='plan'); };
$('tg-ctx').onclick=()=>{ D.city=!D.city; $('tg-ctx').classList.toggle('on',D.city); CTX_CACHE.id=null; redrawViews(); };
// annotations = text and dimensions in every view (3D labels; plan street names, PL marks, dimension strings; section dimensions and element names)
D.ann=true; $('tg-ann').onclick=()=>{ D.ann=!D.ann; $('tg-ann').classList.toggle('on',D.ann); redrawViews(); };
function setView(v){ D.view=v; $('c3d').style.display=v==='3d'?'block':'none'; $('split3d').style.display=v==='3d'?'grid':'none'; $('splitplan').style.display=v==='plan'?'grid':'none'; $('splitsec').style.display=v==='sec'?'grid':'none';
  ['split3d','splitplan','splitsec'].forEach(id=>$(id).style.gridTemplateColumns=D.before?'1fr 1fr':'1fr'); $('p3d-b').style.display=D.before?'block':'none'; $('pp-b').style.display=D.before?'block':'none'; $('ps-b').style.display=D.before?'block':'none';
  $('vhint').textContent = v==='3d' ? 'Drag to orbit · Scroll to zoom · Double-click to reset' : 'Scroll to zoom · Drag to pan · Double-click to reset';
  $('tg-anim').style.visibility = v==='sec'?'hidden':'visible';
  $('tg-edit').style.display = v==='3d'?'none':'';   // editing happens in plan and section only; the 3D view is a viewer
  redrawViews(); if(v==='3d') setAnim(D.anim); else stop3D(); anim2D(D.anim&&v==='plan'); }
function redrawViews(){ const o=curOpt(); if(!o) return; const badge='PROPOSED · OPTION '+o.id; ['b3d','bplan','bsec'].forEach(id=>$(id).textContent=badge);
  if (D.view==='plan') { if(D.before) drawPlanTo($('plan-b'), D.beforeEls, {before:true}); drawPlanTo($('plan-a'), o.els, {shared:o.sep==='shared', editable:o.sep!=='shared'}); }
  else if (D.view==='sec') { if(D.before) drawSectionTo($('sec-b'), D.beforeEls, {before:true}); drawSectionTo($('sec-a'), o.els, {editable:o.sep!=='shared'}); }
  else build3D();
  showPop(); }
$('tg-edit').onclick=()=>{ D.editOn=!D.editOn; $('tg-edit').classList.toggle('on',D.editOn); if(!D.editOn) D.sel=null; renderEditor(); redrawViews(); };
window.addEventListener('resize',()=>{ if($('screen-design').classList.contains('active')) redrawViews(); });
