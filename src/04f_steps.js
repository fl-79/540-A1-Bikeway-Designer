// ═══════════════════════════════════════════════════════════════════════════
// v3: THE DESIGN SCREEN AS THREE STEPS — 1 Verify existing · 2 Design proposal · 3 Review & score
// ═══════════════════════════════════════════════════════════════════════════
// A proposal spans many blocks but a cross-section belongs to one block, so the steps run per block: a block opens on step 1
// (only the existing street, full width, with the Street View panel and the editable existing configuration), the user
// confirms it ("Existing street is correct"), step 2 puts existing and proposed side by side with the design panel, and step 3
// shows the proposal's score and the save / next-block / done actions. A confirmed block is marked `verified` in the proposal,
// so it reopens on step 2 and the proposal card can count the blocks checked. The step bar also carries the block navigator.
D.step=1; D.only=null;   // D.only = 'before': the viewport shows the existing street alone (step 1)
function stepRec(){ const s=D.ctx&&D.ctx.seg; if(!s) return null; const p=typeof propOf==='function'?propOf(s.i):null; return p?p.blocks[s.i]:null; }
function blockVerified(){ const r=stepRec(); return r?!!r.verified:!!(D.ctx&&D.ctx.seg._verified); }
function setStep(n){ n=clamp(n,1,3); D.step=n; const scr=$('screen-design'); scr.dataset.step=n;
  document.querySelectorAll('#stepbar .stp').forEach(e=>{ const k=+e.dataset.step; e.classList.toggle('active',k===n); e.classList.toggle('done',k<n||(k===1&&blockVerified())); });
  D.only = n===1?'before':null;
  if(n===1){ D.before=true; $('tg-before').classList.add('on'); if(typeof toggleSide==='function') toggleSide(false); if(typeof showSV==='function') showSV(false); }
  else if(typeof toggleSide==='function') toggleSide(true);
  $('tg-before').style.display = n===1?'none':''; $('tg-anim').style.display = n===1?'none':'';
  $('bverify').style.display = n===1?'':'none'; $('bhead').style.display = n===2?'':'none'; $('bcols').style.display = n===2?'':'none';
  $('breview').style.display = n===3?'':'none'; $('bscore').style.display = n===3?'':'none';
  $('bottom').classList.remove('collapsed'); $('btn-collapse').textContent='▾ Hide panel';
  renderStepBar(); setView(D.view); if(n===3&&typeof renderScorePane==='function') renderScorePane(); }
// the step bar's right side: what comes next from here
function renderStepBar(){ const n=D.step; const nx=$('step-next'); if(!nx) return;
  nx.textContent = n===1?'Existing street is correct → Design':n===2?'Next: review & score →':'Done · back to map';
  nx.onclick = n===1?()=>verifyBlock():n===2?()=>setStep(3):()=>stepDone();
  const bk=$('step-back'); bk.style.visibility = n>1?'visible':'hidden'; bk.textContent = n===2?'← Existing street':'← Design'; bk.onclick=()=>setStep(n-1);
  if(typeof renderPropNav==='function') renderPropNav(); }
// step 1 → 2: the existing street as recorded (or as corrected in the panel) is confirmed for this block
function verifyBlock(){ const r=stepRec(); if(r) r.verified=true; else if(D.ctx) D.ctx.seg._verified=true; if(r&&typeof projChanged==='function') projChanged(); setStep(2); toast('Existing street confirmed — now design the proposal'); }
function skipVerify(){ setStep(2); }
// step 3 actions: keep the design in the proposal, go on to the next block (which opens on its own step 1 unless verified), or finish
function stepSave(){ if(typeof propNavKeep==='function'&&D.prop) propNavKeep(); else if($('btn-prop')) $('btn-prop').click(); renderStepBar(); if(typeof renderPropNote==='function') renderPropNote(); }
function stepNextBlock(){ if(!D.prop) return; if(typeof propNavKeep==='function') propNavKeep(); if(D.prop.idx<D.prop.order.length-1){ D.prop.idx++; openDesign(SEGS[D.prop.order[D.prop.idx]]); } else stepDone(); }
function stepDone(){ if(typeof propNavKeep==='function') propNavKeep(); const p=D.prop&&PROJ.proposals.find(x=>x.id===D.prop.id); showMap(); if(p) showPropCard(p); else if(activeProp()) showPropCard(activeProp()); }
(function bindSteps(){ document.querySelectorAll('#stepbar .stp').forEach(e=>e.onclick=()=>setStep(+e.dataset.step));
  const on=(id,f)=>{ const el=$(id); if(el) el.onclick=f; };
  on('bv-ok',verifyBlock); on('bv-skip',skipVerify); on('br-back',()=>setStep(2)); on('br-save',stepSave); on('br-next',stepNextBlock); on('br-done',stepDone);
  on('bh-next',()=>setStep(3)); })();
