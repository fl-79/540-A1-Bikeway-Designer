// ═══════════════════════════════════════════════════════════════════════════
// v3: STREET PHOTOS — a Mapillary photo per block to verify lanes and existing facilities, and a Google Street View link
// ═══════════════════════════════════════════════════════════════════════════
// Mapillary (CC BY-SA, free API): needs a client token from mapillary.com/dashboard/developers, pasted in ⚙ Settings; the
// nearest image to the block's midpoint that looks along the block is shown, newest first. Google Street View: a link
// opens the panorama at the same point (no key); with a Maps Platform key in Settings the panorama is embedded instead.
// Nothing is copied or cached beyond the session — the photos are viewed, the data stays the tool's own.
const PHOTO_CACHE=new Map();
// UTM zone 10N (EPSG:26910) → WGS84 latitude / longitude, for the photo services
function toLatLon(x,y){ const E=x+DATA.origin[0], N=y+DATA.origin[1]; const a=6378137, f=1/298.257223563, k0=0.9996, e2=f*(2-f), ep2=e2/(1-e2), lon0=-123*Math.PI/180;
  const M=(N)/k0; const mu=M/(a*(1-e2/4-3*e2*e2/64-5*e2*e2*e2/256)); const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const phi1=mu+(3*e1/2-27*e1*e1*e1/32)*Math.sin(2*mu)+(21*e1*e1/16-55*e1*e1*e1*e1/32)*Math.sin(4*mu)+(151*e1*e1*e1/96)*Math.sin(6*mu);
  const sp=Math.sin(phi1), cp=Math.cos(phi1), tp=Math.tan(phi1); const N1=a/Math.sqrt(1-e2*sp*sp), T1=tp*tp, C1=ep2*cp*cp, R1=a*(1-e2)/Math.pow(1-e2*sp*sp,1.5), D=(E-500000)/(N1*k0);
  const lat=phi1-(N1*tp/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*D*D*D*D/24+(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D*D*D*D*D*D/720);
  const lon=lon0+(D-(1+2*T1+C1)*D*D*D/6+(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D*D*D*D*D/120)/cp;
  return [lat*180/Math.PI, lon*180/Math.PI]; }
// the view point: mid-block, looking along the block — with the traffic on a one-way street (OSM direction), otherwise
// towards the north / east end; SV.flip turns it round
function polyMid(g){ let L=0; for(let i=1;i<g.length;i++) L+=Math.hypot(g[i][0]-g[i-1][0],g[i][1]-g[i-1][1]); let t=L/2; for(let i=1;i<g.length;i++){ const a=g[i-1], b=g[i]; const d=Math.hypot(b[0]-a[0],b[1]-a[1]); if(t<=d){ const k=d?t/d:0; return [a[0]+(b[0]-a[0])*k, a[1]+(b[1]-a[1])*k]; } t-=d; } return g[g.length-1]; }
function blockView(s){ const m=polyMid(s.g); const a=s.g[0], b=s.g[s.g.length-1]; let head=(90-Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI+360)%360;   // the true middle of the block (a two-vertex block's "middle vertex" was its end)
  if(s.ow&&s.osm&&s.osm.owd<0) head=(head+180)%360; if(typeof SV!=='undefined'&&SV.flip&&SV.cur===s.i) head=(head+180)%360; const [lat,lon]=toLatLon(m[0],m[1]); return {lat,lon,head,x:m[0],y:m[1]}; }
const compass=h=>['N','NE','E','SE','S','SW','W','NW'][Math.round(((h%360)+360)%360/45)%8];
function streetViewURL(s){ const v=blockView(s); return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${v.lat.toFixed(6)},${v.lon.toFixed(6)}&heading=${Math.round(v.head)}&pitch=0&fov=90`; }
async function mapillaryFor(s){ if(!SETTINGS.mly) return null; if(PHOTO_CACHE.has(s.i)) return PHOTO_CACHE.get(s.i); const v=blockView(s); const dLat=45/111320, dLon=45/(111320*Math.cos(v.lat*Math.PI/180));
  const url=`https://graph.mapillary.com/images?access_token=${encodeURIComponent(SETTINGS.mly)}&fields=id,thumb_1024_url,captured_at,compass_angle,computed_geometry,is_pano&bbox=${(v.lon-dLon).toFixed(6)},${(v.lat-dLat).toFixed(6)},${(v.lon+dLon).toFixed(6)},${(v.lat+dLat).toFixed(6)}&limit=60`;
  try{ const r=await fetch(url); if(!r.ok) throw new Error('Mapillary '+r.status); const j=await r.json(); const imgs=(j.data||[]).filter(im=>im.thumb_1024_url);
    // score: along the block (either way) first, then near the midpoint, then newest
    const best=imgs.map(im=>{ const g=im.computed_geometry&&im.computed_geometry.coordinates; const d=g?Math.hypot((g[0]-v.lon)*111320*Math.cos(v.lat*Math.PI/180),(g[1]-v.lat)*111320):40; let da=Math.abs(((im.compass_angle||0)-v.head+540)%360-180); da=Math.min(da,180-da); return {im, sc:(im.is_pano?0:1)*30 + Math.max(0,45-d) + Math.max(0,60-da)*0.8 + (im.captured_at||0)/3.15e10}; }).sort((a,b)=>b.sc-a.sc)[0];
    const out=best?{id:best.im.id, url:best.im.thumb_1024_url, when:best.im.captured_at?new Date(best.im.captured_at).toISOString().slice(0,7):'', pano:!!best.im.is_pano}:false; PHOTO_CACHE.set(s.i,out); return out; }
  catch(err){ console.warn(err); return {err:err.message}; } }
// the photo box in the design screen's "Existing configuration" section
function photoHTML(s, ph){ const gv=streetViewURL(s); const v=blockView(s); const links=`<a href="${gv}" target="_blank" rel="noopener">Google Street View ↗</a>${ph&&ph.id?` · <a href="https://www.mapillary.com/app/?pKey=${ph.id}&focus=photo" target="_blank" rel="noopener">Mapillary ↗</a>`:''}`;
  const embed=SETTINGS.gkey?`<iframe loading="lazy" style="width:100%;height:170px;border:0;border-radius:8px" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(SETTINGS.gkey)}&location=${v.lat.toFixed(6)},${v.lon.toFixed(6)}&heading=${Math.round(v.head)}&pitch=0&fov=90"></iframe>`:'';
  if(ph&&ph.url) return `<img src="${ph.url}" alt="street photo" title="Mapillary ${ph.when} · CC BY-SA">${embed}<div class="cap"><span>Mapillary${ph.when?' · '+ph.when:''}${ph.pano?' · panorama':''} · CC BY-SA</span>${links}</div>`;
  if(ph&&ph.err) return `${embed}<div class="cap"><span>Mapillary: ${esc(ph.err)} (check the token in ⚙)</span>${links}</div>`;
  if(ph===false) return `${embed}<div class="cap"><span>No Mapillary photo within 45 m of mid-block.</span>${links}</div>`;
  if(!SETTINGS.mly) return `${embed}<div class="cap"><span>${SETTINGS.gkey?'':'Add a Mapillary token in ⚙ Settings (map screen) for a photo of this block here. '}</span>${links}</div>`;
  return `${embed}<div class="cap"><span>Loading photo…</span>${links}</div>`; }
async function refreshPhoto(){ const box=$('photo'); if(!box||!D.ctx) return; const s=D.ctx.seg; box.innerHTML='<div class="label" style="margin-bottom:4px">Verify on the street</div>'+photoHTML(s,null); if(!SETTINGS.mly) return; const ph=await mapillaryFor(s); if(D.ctx&&D.ctx.seg===s) box.innerHTML='<div class="label" style="margin-bottom:4px">Verify on the street</div>'+photoHTML(s,ph); }
// ── the street-view mini window: a small live Google Street View panorama in the design viewport, at the block's midpoint
// looking along the block. Google's keyless embed (maps.google.com/maps/embed?pb=…, the "share → embed" form) needs no API
// key; with a Maps Platform key in Settings the Embed API v1 is used instead. It opens with each block, can be collapsed,
// dragged, resized and closed; 📷 Verify street brings it back. Closing it keeps it closed for the rest of the session.
function streetViewEmbedURL(s){ const v=blockView(s); if(SETTINGS.gkey) return `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(SETTINGS.gkey)}&location=${v.lat.toFixed(6)},${v.lon.toFixed(6)}&heading=${Math.round(v.head)}&pitch=0&fov=90`;
  return `https://www.google.com/maps/embed?pb=!6m7!1m6!2m2!1d${v.lat.toFixed(6)}!2d${v.lon.toFixed(6)}!3f${Math.round(v.head)}!4f0!5f1`; }
const SV={cur:null, flip:false};
function showSV(force){ const c=D.ctx; if(!c) return; const s=c.seg; const w=$('svwin'); if(force){ $('side').classList.remove('collapsed'); w.classList.remove('min'); sideTabText(); setTimeout(redrawViews,200); }
  if(SV.cur!==s.i) SV.flip=false; const v=blockView(s);
  $('sv-title').textContent='Street view · '+titleCase(s.n)+' · facing '+compass(v.head)+(s.ow?' (with traffic)':' (along the block)'); $('sv-title').title=`Mid-block, looking ${compass(v.head)} (${Math.round(v.head)}°) along ${titleCase(s.s)}${s.ow?', the one-way direction':''}. ↻ turns round.`; $('sv-open').href=streetViewURL(s);
  if(SV.cur!==s.i||SV.reload){ SV.cur=s.i; SV.reload=false; $('sv-body').innerHTML=`<div class="svmsg">Loading Street View…</div><iframe loading="eager" referrerpolicy="no-referrer-when-downgrade" allow="accelerometer; gyroscope" src="${streetViewEmbedURL(s)}"></iframe>`; }
  const cs=c.case; $('sv-foot').innerHTML=`Recorded: ${c.lanes} lanes${c.park.L||c.park.R?', parking '+[c.park.L?c.lbl[0]:null,c.park.R?c.lbl[1]:null].filter(Boolean).join(' & '):', no parking'}, ${cs.existing||'no facility'} — correct them in <b>Existing configuration</b> below if the street differs.`; }
// the street panel collapses into the left edge (◀ / ▶ tab); the panorama alone can be folded with ▾
function sideTabText(){ const col=$('side').classList.contains('collapsed'); $('side-tab').textContent=col?'▶':'◀'; $('side-tab').title=col?'Expand the street panel':'Collapse the street panel'; }
function toggleSide(force){ const sd=$('side'); const col=force===undefined?!sd.classList.contains('collapsed'):!!force; sd.classList.toggle('collapsed',col); sideTabText(); setTimeout(redrawViews,200); }
$('side-tab').onclick=()=>toggleSide(); $('btn-verify').onclick=()=>{ if($('side').classList.contains('collapsed')) showSV(true); else toggleSide(true); };
$('sv-flip').onclick=()=>{ SV.flip=!SV.flip; SV.reload=true; showSV(true); }; $('sv-min').onclick=()=>{ const w=$('svwin'); w.classList.toggle('min'); $('sv-min').textContent=w.classList.contains('min')?'▴':'▾'; };
// the sampled strip for a proposal: a photo at the first block and wherever the recorded lanes / width change from the previous
// block along the proposal, and at least every 400 m (see README: why not "every four blocks")
function photoSample(p){ const order=propOrder(p); if(!order.length) return [];
  const out=[]; let since=Infinity, prev=null; order.forEach(s=>{ const x=p.blocks[s.i].x; const key=x.lanes+'|'+(x.park.L?1:0)+(x.park.R?1:0)+'|'+Math.round(x.ctc); const change=!prev||key!==prev; if(change||since>=400){ out.push({s, why:!prev?'first block':key!==prev?'lanes / width change':'400 m sample'}); since=0; } since+=s.len; prev=key; }); return out; }
async function renderPhotoStrip(p, el){ const smp=photoSample(p); if(!el) return; if(!smp.length){ el.textContent='No blocks yet.'; return; }
  el.innerHTML=`<div class="small muted" style="margin-bottom:4px">${smp.length} of ${Object.keys(p.blocks).length} blocks sampled (first block, every change of recorded lanes or width, at least every 400 m). Click a name to open the block.</div>`+smp.map(({s,why})=>`<div class="pstrip" data-i="${s.i}"><div class="thumb" id="pth-${s.i}">${SETTINGS.mly?'…':''}</div><div><a href="#" data-open="${s.i}">${esc(titleCase(s.n))}</a><div class="small muted">${p.blocks[s.i].x.lanes} lanes · ${p.blocks[s.i].x.ctc} m · ${why}</div><div class="small"><a href="${streetViewURL(s)}" target="_blank" rel="noopener">Street View ↗</a></div></div></div>`).join('');
  el.querySelectorAll('a[data-open]').forEach(a=>a.onclick=e=>{ e.preventDefault(); openDesign(SEGS[+a.dataset.open]); });
  if(!SETTINGS.mly) return; for(const {s} of smp){ const ph=await mapillaryFor(s); const t=document.getElementById('pth-'+s.i); if(!t) return; t.innerHTML=ph&&ph.url?`<img src="${ph.url}" alt="">`:'<span class="small muted">no photo</span>'; } }
