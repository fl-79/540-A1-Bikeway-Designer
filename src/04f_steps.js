// ═══════════════════════════════════════════════════════════════════════════
// v3: THE DESIGN SCREEN AS A CHECKLIST OF BLOCK TABS — verify each block's existing street, design it, then review the proposal
// ═══════════════════════════════════════════════════════════════════════════
// Every designed block belongs to a proposal (a block opened on its own joins the active proposal, or starts one), so one block
// and many blocks work the same way. A bar under the toolbar lists the proposal's blocks as tabs, each with its state —
// ○ existing street not yet verified · ◐ verified, design not yet confirmed · ● verified and designed — and a last tab,
// "Review & score", that stays greyed until every block is verified and designed. A block tab opens on the EXISTING view
// (the existing street alone, full width, with the Street View and the editable configuration) with one action, "Existing
// street is correct → Design"; once confirmed the tab becomes the design view (existing and proposed side by side, the design
// panel below) with one action, "Design confirmed → next block". Designs autosave to the proposal as they are edited — there is
// no Save button — and the lane direction (one-way lane each side / two-way lane on one side) is one setting for the whole
// proposal, taken from the first confirmed block and changeable in the design panel, so the blocks cannot contradict each other.
D.mode='verify'; D.only=null;   // D.only = 'before': the viewport shows the existing street alone
function curProp(){ return D.prop?PROJ.proposals.find(x=>x.id===D.prop.id):null; }
function curRec(){ const p=curProp(); return p&&D.ctx?p.blocks[D.ctx.seg.i]:null; }
function ensureProposal(s){ let p=propOf(s.i); if(!p){ if(!propAdd(s,true)) return null; p=propOf(s.i); } const order=propOrder(p); D.prop={id:p.id, order:order.map(x=>x.i), idx:Math.max(0,order.findIndex(x=>x.i===s.i))}; return p; }
function blockState(r){ return !r?'new':r.done?'done':r.verified?'verified':'new'; }
function allDone(p){ const bs=Object.values(p.blocks); return bs.length>0&&bs.every(r=>r.verified&&r.done); }
const DIR_NAME={one:'one-way lane each side', two:'two-way lane on one side'};
// ── the bar: block tabs with their state, the counts, the review tab ──
function renderBlockBar(){ const el=$('blockbar'); const p=curProp(); if(!el) return; if(!p){ el.innerHTML=''; return; } const order=propOrder(p); const cur=D.ctx&&D.ctx.seg.i; const ready=allDone(p);
  const nv=order.filter(s=>p.blocks[s.i].verified).length, nd=order.filter(s=>p.blocks[s.i].done).length;
  el.innerHTML=`<span class="bb-name" title="The proposal being designed · its lane direction: ${p.dir?DIR_NAME[p.dir]:'not set yet'}">${esc(p.name)}</span>`
    +order.map((s,i)=>{ const st=blockState(p.blocks[s.i]); return `<button class="bb ${st} ${s.i===cur&&D.mode!=='review'?'cur':''}" data-i="${s.i}" title="${esc(titleCase(s.n))} · ${st==='done'?'verified and designed':st==='verified'?'verified — confirm the design':'verify the existing street first'}"><i></i><span class="n">${i+1}</span>${esc(titleCase(s.n))}</button>`; }).join('')
    +`<span class="grow"></span><span class="bb-sum">${nv} of ${order.length} verified · ${nd} of ${order.length} designed</span>`
    +`<button class="bb review ${ready?'ready':''} ${D.mode==='review'?'cur':''}" id="bb-review" ${ready?'':'disabled'} title="${ready?'The bike score and statistics of the whole proposal':'Greyed until every block is verified and designed'}"><i></i><span id="stp3">Review &amp; score</span></button>`;
  el.querySelectorAll('button[data-i]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.i; if(D.ctx&&i===D.ctx.seg.i&&D.mode!=='review') return; autoSaveDesign(true); D.prop.idx=D.prop.order.indexOf(i); openDesign(SEGS[i]); });
  const rv=$('bb-review'); if(rv&&ready) rv.onclick=()=>setMode('review'); if(typeof updateLiveScore==='function'){ updateLiveScore.key=''; updateLiveScore(); } }   // the label was just re-rendered: refill the live number
// ── what the screen shows: the existing street to verify, the design, or the review ──
function setMode(m){ D.mode=m; $('screen-design').dataset.mode=m; D.only=m==='verify'?'before':null;
  if(m==='verify'){ D.before=true; $('tg-before').classList.add('on'); if(typeof toggleSide==='function') toggleSide(false); if(typeof showSV==='function') showSV(false); }
  else if(typeof toggleSide==='function') toggleSide(true);
  $('tg-before').style.display=m==='verify'?'none':''; $('tg-anim').style.display=m==='verify'?'none':'';
  $('bverify').style.display=m==='verify'?'':'none'; $('bhead').style.display=m==='design'?'':'none'; $('bcols').style.display=m==='design'?'':'none';
  $('breview').style.display=m==='review'?'':'none'; $('bscore').style.display=m==='review'?'':'none';
  $('bottom').classList.remove('collapsed'); $('btn-collapse').textContent='▾ Hide panel';
  renderBlockBar(); renderDirSelect(); setView(D.view); if(m==='review'&&typeof renderScorePane==='function') renderScorePane(); }
// ── the two confirmations ──
function verifyBlock(){ const r=curRec(); if(r){ r.verified=true; projChanged(); } setMode('design'); toast('Existing street confirmed — design the proposal on this block'); }
function nextOpen(){ const p=curProp(); if(!p) return null; const order=D.prop.order; const k=order.indexOf(D.ctx.seg.i); const ring=order.slice(k+1).concat(order.slice(0,k)); return ring.find(i=>{ const r=p.blocks[i]; return !(r&&r.verified&&r.done); }); }
function confirmDesign(){ const p=curProp(); if(!p||!curOpt()) return; autoSaveDesign(true); const r=curRec(); if(r) r.done=true; if(!p.dir){ p.dir=curOpt().mode; } projChanged();
  const nxt=nextOpen(); if(nxt!=null){ D.prop.idx=D.prop.order.indexOf(nxt); openDesign(SEGS[nxt]); toast('Design kept · next block: '+titleCase(SEGS[nxt].n)); } else { setMode('review'); toast('Every block is designed — here is the proposal\'s score'); } }
// ── autosave: the option being edited is the block's design in the proposal (its verified / done marks are kept) ──
function autoSaveDesign(now){ clearTimeout(autoSaveDesign.t); const f=()=>{ const p=curProp(); const o=curOpt(); if(!p||!o||!D.ctx) return; const r0=p.blocks[D.ctx.seg.i]; const keep=r0?{verified:!!r0.verified, done:!!r0.done}:null; propStore(D.ctx.seg,o,D.ctx); const r=p.blocks[D.ctx.seg.i]; if(keep&&r){ r.verified=keep.verified; r.done=keep.done; } if(typeof renderPropNote==='function') renderPropNote(); renderBlockBar(); }; if(now) f(); else autoSaveDesign.t=setTimeout(f,400); }
// ── one lane direction for the whole proposal ──
function applyPropDir(){ const p=curProp(); if(!p||!p.dir) return; const keep=D.options.filter(o=>o.custom||o.mode===p.dir); if(keep.length&&keep.length<D.options.length){ const cur=D.options[D.cur]; D.options=keep; D.cur=Math.max(0,keep.indexOf(cur)); renderChips(); renderAll(); } }
function renderDirSelect(){ const sel=$('prop-dir'); const p=curProp(); if(!sel||!p) return; sel.value=p.dir||''; const note=$('prop-dir-note'); if(note){ const c=D.ctx; const forced=c&&c.dirMode!=='free'?c.dirMode:null; note.textContent = forced&&p.dir&&forced!==p.dir ? ('this block must be '+DIR_NAME[forced]+' to connect to the network') : forced ? ('fixed by the network here: '+DIR_NAME[forced]) : ''; } }
function setPropDir(v){ const p=curProp(); if(!p) return; p.dir=v||null; let n=0;
  Object.values(p.blocks).forEach(rec=>{ const s=SEGS[rec.i]; if(!s||s===D.ctx.seg) return; const c=applyOverrides(segContext(s),rec.x); const opts=generateOptions(c); if(!opts.length) return; const m=(v&&opts.find(x=>x.mode===v&&x.sep===rec.opt.sep))||(v&&opts.find(x=>x.mode===v))||opts[0]; if(m.mode!==rec.opt.mode){ rec.opt=cloneJ(m); rec.done=false; n++; } });
  projChanged(); const s=D.ctx.seg; openDesign(s); toast(v?(DIR_NAME[v]+' for the whole proposal'+(n?' · '+n+' other block'+(n===1?'':'s')+' re-solved, confirm them again':'')):'Lane direction left to each block'); }
function stepDone(){ autoSaveDesign(true); const p=curProp(); showMap(); if(p) showPropCard(p); }
// this option's separation and direction on every other block of the proposal, each solved for its own width (the nearest
// separation its case allows); those blocks go back to "verified, design to confirm"
function applyToAll(){ const p=curProp(); const o=curOpt(); if(!p||!o) return; autoSaveDesign(true); let n2=0, near=0; const rank=s=>SEP_RANK[s]||0;
  D.prop.order.forEach(i=>{ const s=SEGS[i]; if(!s||s===D.ctx.seg) return; const rec=p.blocks[i]; if(rec&&rec.x&&'fac' in rec.x&&typeof setUserFacility==='function') setUserFacility(s,rec.x.fac); const c=applyOverrides(segContext(s),rec&&rec.x); const opts=generateOptions(c); if(!opts.length) return;
    const m=opts.find(x=>x.sep===o.sep&&x.mode===o.mode)||opts.find(x=>x.sep===o.sep)||opts.slice().sort((a,b)=>(Math.abs(rank(a.sep)-rank(o.sep))-Math.abs(rank(b.sep)-rank(o.sep)))||((a.mode===o.mode?0:1)-(b.mode===o.mode?0:1)))[0];
    if(m.sep!==o.sep) near++; p.blocks[i]={i, opt:cloneJ(m), x:ctxOverrides(c), auto:false, verified:!!(rec&&rec.verified), done:false}; n2++; });
  p.dir=o.mode; projChanged(); renderBlockBar(); renderDirSelect(); toast(SEP[o.sep].name.split(' (')[0]+' · '+DIR_NAME[o.mode]+' applied to '+n2+' other block'+(n2===1?'':'s')+(near?' ('+near+' took the nearest separation their case allows)':'')+' — confirm each on its tab', 4500); }
(function bindSteps(){ const on=(id,f)=>{ const el=$(id); if(el) el.onclick=f; };
  on('bv-ok',verifyBlock); on('bh-confirm',confirmDesign); on('br-done',stepDone); on('apply-all',applyToAll);
  const sel=$('prop-dir'); if(sel) sel.onchange=()=>setPropDir(sel.value); })();
// kept for callers: the navigator is the block bar now
function renderPropNav(){ renderBlockBar(); }
function propNavKeep(){ autoSaveDesign(true); }
