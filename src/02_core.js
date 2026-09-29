// ═══════════════════════════════════════════════════════════════════════════
// DATA & MODEL
// ═══════════════════════════════════════════════════════════════════════════
const SEGS = DATA.segs, BW = DATA.bw;
// ── v2 geometry helpers ──────────────────────────────────────────────────────
// Chaikin corner-cutting with fixed ends: the City's centrelines have a vertex every block or two, so curves (Pacific, Expo,
// the bridge ramps) come out as chords; two passes round them the way the street is actually built. Ends never move, so
// streets still meet exactly at their nodes.
function smoothLine(g, it){ let p=g; for(let k=0;k<(it==null?2:it);k++){ if(p.length<3) return p; const o=[p[0]];
    for(let i=0;i<p.length-1;i++){ const a=p[i], b=p[i+1]; o.push([a[0]*.75+b[0]*.25, a[1]*.75+b[1]*.25],[a[0]*.25+b[0]*.75, a[1]*.25+b[1]*.75]); }
    o.push(p[p.length-1]); p=o; } return p; }
function dSegPt(p,a,b){ const dx=b[0]-a[0], dz=b[1]-a[1]; const L2=dx*dx+dz*dz||1; const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/L2)); const q=[a[0]+t*dx,a[1]+t*dz]; return [Math.hypot(p[0]-q[0],p[1]-q[1]), q, t]; }
function nearOnPoly(p,g){ let best=[Infinity,null]; for(let i=1;i<g.length;i++){ const r=dSegPt(p,g[i-1],g[i]); if(r[0]<best[0]) best=r; } return best; }
// distance of p from polyline g, and how far along g its nearest point is
function alongOnPoly(g,p){ let acc=0, best=Infinity, at=0; for(let k=1;k<g.length;k++){ const a=g[k-1], b=g[k]; const L=Math.hypot(b[0]-a[0],b[1]-a[1]); const [d,,t]=dSegPt(p,a,b); if(d<best){ best=d; at=acc+t*L; } acc+=L; } return [best,at]; }
// the z values where polyline g crosses the line x = const (block frame), used to meet curving and angled cross streets
function zCross(g,x){ const out=[]; for(let i=1;i<g.length;i++){ const [x0,z0]=g[i-1],[x1,z1]=g[i]; if(x0!==x1 && (x0-x)*(x1-x)<=0){ const t=(x-x0)/(x1-x0); out.push({z:z0+(z1-z0)*t, dx:x1-x0, dz:z1-z0}); } } return out; }
// OSM paths (cycleways and bike-permitted public paths), indexed on a 100 m grid
const PATH_GRID=new Map(); (DATA.paths||[]).forEach(p=>{ const cs=new Set(); p.g.forEach(([x,y])=>cs.add(Math.floor(x/100)+','+Math.floor(y/100))); cs.forEach(k=>{ if(!PATH_GRID.has(k)) PATH_GRID.set(k,[]); PATH_GRID.get(k).push(p); }); });
function pathsNear(p,r){ const cx=Math.floor(p[0]/100), cy=Math.floor(p[1]/100), seen=new Set(), out=[];
  for(let i=-1;i<=1;i++) for(let j=-1;j<=1;j++) (PATH_GRID.get((cx+i)+','+(cy+j))||[]).forEach(q=>{ if(seen.has(q)) return; seen.add(q); const [d,at]=nearOnPoly(p,q.g); if(d<r) out.push({p:q,d,at}); });
  return out.sort((a,b)=>a.d-b.d); }
// levels: a street's OSM layer (0 = grade; a bridge or viaduct without a layer tag counts as 1) and its layer at each end (ramps
// land: lyE from osmpaths.py). Streets meet only when they are at the same level at the node — otherwise one passes over the other.
const lvlOf=o=>{ const q=o.osm||{}; return q.ly>0 ? q.ly : (q.br || /(VIADUCT|BRIDGE|OVERPASS)$/.test(o.n)) ? 1 : 0; };   // named "… Bridge", not "Old Bridge Court"
const lyAt=(o,k)=>{ const q=o.osm||{}; return q.lyE ? (q.lyE[k]||0) : lvlOf(o); };
const isUpSeg=o=>lvlOf(o)>0;   // on a bridge deck / viaduct
const endIdxNear=(o,p)=>{ const a=o.g[0], b=o.g[o.g.length-1]; return Math.hypot(a[0]-p[0],a[1]-p[1])<=Math.hypot(b[0]-p[0],b[1]-p[1])?0:1; };
// the road surface is continuous through a node: where a street carries on (same street, or collinear) the two pieces share one
// height there — the higher one — so a deck's approach piece runs down as a ramp from the deck, never a step at the node
// A piece that does not carry on (a ramp ending at a merge or a landing) takes the level of what it runs into: the streets it
// meets there at an angle — the deck it merges into (elevated), or the street it lands on (grade). A tagged level that
// contradicts that is the tag lagging the road, and a ramp is never left hanging in the air.
function nodeH(o,k){ const p=o.g[k?o.g.length-1:0]; const nb=endNeighbours(o,k); let h=lyAt(o,k);
  if(nb.cont.length){
    // v3: a structure LANDS where it runs on into a street with no level of its own (not a bridge by name or by OSM, no end tag):
    // the node is at grade and the structure piece runs down to it — the Granville Bridge's 4th Avenue ramp lands on W 4th Ave,
    // Granville St at Drake and Burrard St at Pacific stay on the ground — instead of the street being lifted to the deck and
    // ramping down beyond the node. An end tagged elevated at the node (lyE) keeps its level, and every piece there agrees.
    const at=x=>lyAt(x,endIdxNear(x,p)); const expl=x=>!!(x.osm&&x.osm.lyE); const all=[o,...nb.cont];
    if(all.some(x=>!isUpSeg(x)&&!expl(x)) && !all.some(x=>expl(x)&&at(x)>0)) h=0;
    else nb.cont.forEach(x=>{ h=Math.max(h, at(x)); }); }
  else if(nb.cross.length && !(o.osm&&o.osm.lyE)){ h=Math.min(h, ...nb.cross.map(x=>lyAt(x,endIdxNear(x,p)))); }   // an inherited level comes DOWN to what it lands on; an explicit end tag (lyE) is kept, so a deck is not pulled down by a street ending beneath it
  else if(!nb.cross.length && h>0){ // nothing within 14 m: a gap in the City's centrelines — join the nearest street end within 40 m, else come down to grade
    let best=null, bd=40; const [cx,cy]=[Math.round(p[0]/12),Math.round(p[1]/12)]; for(let i=-4;i<=4;i++) for(let j=-4;j<=4;j++) (END_INDEX.get((cx+i)+','+(cy+j))||[]).forEach(e=>{ if(e.s===o) return; const q=e.s.g[e.k?e.s.g.length-1:0]; const d=Math.hypot(q[0]-p[0],q[1]-p[1]); if(d<bd){ bd=d; best=e; } });
    h = best ? lyAt(best.s,best.k) : 0; }
  return h*6.0; }
// the crossing streets at end k of o that are at o's level there (the ones it actually meets)
function sameLevelCross(o,k){ const p=o.g[k?o.g.length-1:0]; const h=nodeH(o,k); return endNeighbours(o,k).cross.filter(x=>Math.abs(nodeH(x,endIdxNear(x,p))-h)<0.5); }
// ── terrain: 20 m elevation grid interpolated from the 1 m contour lines ──
const TERR=(()=>{ const t=DATA.terr; const bin=atob(t.z); const n=bin.length/2; const a=new Int16Array(n);
  for(let i=0;i<n;i++){ a[i]=(bin.charCodeAt(i*2) | (bin.charCodeAt(i*2+1)<<8))<<16>>16; }
  return {...t, a}; })();
// Topography is switched off for now (flat ground, no contours, no grade): the terrain grid interacted badly with the
// proposed geometry. Set TOPO_OFF=false to bring the elevation grid, contours and grade checks back.
const TOPO_OFF=true;
function elevAt(x,y){ if(TOPO_OFF) return 0; const t=TERR; const fx=(x-t.x0)/t.c, fy=(y-t.y0)/t.c;
  const i=Math.floor(fx), j=Math.floor(fy); if(i<0||j<0||i>=t.nx-1||j>=t.ny-1) return 0;
  const u=fx-i, v=fy-j; const g=(ii,jj)=>t.a[jj*t.nx+ii]/10;
  return g(i,j)*(1-u)*(1-v)+g(i+1,j)*u*(1-v)+g(i,j+1)*(1-u)*v+g(i+1,j+1)*u*v; }
// longitudinal grade of a block, from its two ends
function blockGrade(s){ const a=s.g[0], b=s.g[s.g.length-1]; const za=elevAt(a[0],a[1]), zb=elevAt(b[0],b[1]);
  return {za, zb, grade:(zb-za)/Math.max(s.len,1)}; }
// decode building layer: [n u8][h|flag u8][n × (x u16, y u16)] little-endian, 1 m units
const BLD=(()=>{ const bin=atob(DATA.bldb); const n=bin.length; const u=new Uint8Array(n); for(let i=0;i<n;i++) u[i]=bin.charCodeAt(i);
  const dv=new DataView(u.buffer); const out=[]; let o=0;
  while(o<n){ const cnt=dv.getUint8(o); const hb=dv.getUint8(o+1); o+=2; const p=new Array(cnt); let cx=0,cy=0;
    for(let k=0;k<cnt;k++){ const x=dv.getUint16(o,true), y=dv.getUint16(o+2,true); o+=4; p[k]=[x,y]; cx+=x; cy+=y; }
    out.push({p, x:cx/cnt, y:cy/cnt, h:hb&0x7f, f:!!(hb&0x80)}); }
  return out; })();
// ── street-end index: which block ends meet at each node (12 m cells) ──
const END_INDEX=new Map(); const endKey=p=>Math.round(p[0]/12)+','+Math.round(p[1]/12);
SEGS.forEach(s=>{ [s.g[0], s.g[s.g.length-1]].forEach((p,k)=>{ const key=endKey(p); if(!END_INDEX.has(key)) END_INDEX.set(key,[]); END_INDEX.get(key).push({s,k}); }); });
const chord=s=>{ const a=s.g[0], b=s.g[s.g.length-1]; const L=Math.hypot(b[0]-a[0],b[1]-a[1])||1; return [(b[0]-a[0])/L,(b[1]-a[1])/L]; };
// blocks meeting the end k of s within 14 m, split into crossing (angle > ~37°) and collinear continuations
// A block of the same street is always a continuation, whatever the angle (curved streets); anything else within ~37° too.
function endNeighbours(s,k){ const p=s.g[k?s.g.length-1:0]; const u=chord(s); const cross=[], cont=[]; const [cx,cy]=[Math.round(p[0]/12),Math.round(p[1]/12)];
  for(let i=-1;i<=1;i++) for(let j=-1;j<=1;j++){ (END_INDEX.get((cx+i)+','+(cy+j))||[]).forEach(e=>{ if(e.s===s) return; const q=e.s.g[e.k?e.s.g.length-1:0]; if(Math.hypot(q[0]-p[0],q[1]-p[1])>14) return; const v=chord(e.s); (e.s.s!==s.s && Math.abs(u[0]*v[0]+u[1]*v[1])<0.8?cross:cont).push(e.s); }); }
  return {cross, cont}; }
// Right-of-way sanity. The ROW layer is a point dataset matched to the nearest block, so single blocks pick up stray
// values (a lane's 33 ft inside a 66 ft street, a plaza's 140 ft). Two rules, applied to same-street neighbours only:
//   1. a block far narrower (< 70 %) than the neighbours' median takes the median;
//   2. a block that differs by > 15 % from BOTH neighbours while they agree with each other (± 10 %) takes their mean.
// Genuine changes of width (a street that widens for several blocks) survive because the neighbours then disagree.
(function fixRows(){ let n=0; const orig=new Map(SEGS.map(s=>[s.i,s.row]));
  SEGS.forEach(s=>{ const ends=[0,1].map(k=>endNeighbours(s,k).cont.filter(o=>o.s===s.s).map(o=>orig.get(o.i))); const nb=ends.flat(); if(!nb.length) return;
    let fix=null;
    // v2: only the blocks adjoining along the same street are evidence — never a citywide same-street median (Cambie is a 45 m
    // boulevard south of False Creek and a 20 m street downtown; the median widened the downtown blocks to 45.7 m and put the
    // buildings on the road). A block takes its neighbours' width when the two neighbours agree with each other and it differs
    // from them by more than 15 %; a block with a neighbour at one end only is corrected only when it is a short stub narrower
    // than 70 % of that neighbour (a lane's 33 ft value inside a 66 ft street).
    if(ends[0].length&&ends[1].length){ const a=Math.min(...ends[0]), b=Math.min(...ends[1]); if(Math.abs(a-b)/Math.max(a,b)<0.10 && Math.abs(s.row-a)/Math.max(s.row,a)>0.15) fix=Math.round((a+b)/2*10)/10; }
    else { const a=Math.min(...nb); if(s.row<0.7*a && a>=15 && s.len<90) fix=a; }
    if(fix!==null){ s.rowOrig=s.row; s.row=fix; s.ctc=Math.round((fix-7.2)*10)/10; s.rowFix=true; n++; } });
  console.log('ROW corrected from adjoining blocks:', n); })();
// v2: dead-end blocks that end in a turnaround loop. The City's centreline often runs on past the real end of the street (at 0 Smithe
// St it carries on 27 m through the plaza); where a mapped OSM loop crosses the block's line within its last 80 m, the block is
// cut back to where it meets the loop road (less half the loop's width), so the street ends at the loop and the loop continues it.
// Along-block positions (laneways, bus stops) are shifted when the cut is at the block's start.
(function loopEnds(){ let n=0; const segX=(a,b,c,d)=>{ const r=[b[0]-a[0],b[1]-a[1]], q=[d[0]-c[0],d[1]-c[1]], den=r[0]*q[1]-r[1]*q[0]; if(Math.abs(den)<1e-9) return null; const t=((c[0]-a[0])*q[1]-(c[1]-a[1])*q[0])/den, u=((c[0]-a[0])*r[1]-(c[1]-a[1])*r[0])/den; return (t>=0&&t<=1&&u>=0&&u<=1)?t:null; };
  SEGS.forEach(s=>{ [0,1].forEach(k=>{ const nb=endNeighbours(s,k); if(nb.cross.length||nb.cont.length) return; const p=k?s.g[s.g.length-1]:s.g[0];
    const OV=(DATA.overrides||{})[s.i]; if(OV&&OV[k]&&OV[k].loop===false) return;   // reviewer says: no loop here
    const L=(DATA.loops||[]).find(l=>!l.bulb && nearOnPoly(p,l.g)[0]<80 && l.g.some(q=>nearOnPoly(q,s.g)[0]<3)); if(!L) return;
    const g=k?s.g:s.g.slice().reverse(); let acc=0, hit=null;   // g runs from the live end towards the dead end
    for(let i=1;i<g.length&&hit==null;i++){ const segL=Math.hypot(g[i][0]-g[i-1][0],g[i][1]-g[i-1][1]); let tb=null; for(let j=1;j<L.g.length;j++){ const t=segX(g[i-1],g[i],L.g[j-1],L.g[j]); if(t!=null&&(tb==null||t<tb)) tb=t; } if(tb!=null) hit=acc+tb*segL; acc+=segL; }
    const total=plen(g); if(hit==null) hit=alongOnPoly(g, L.g.reduce((b,q)=>nearOnPoly(q,g)[0]<nearOnPoly(b,g)[0]?q:b))[1];
    const cut=hit-Math.max(5.5,(L.ln||1)*4.5)/2; if(cut<20||cut>total-2) return;
    const ng=trimLine(g,0,total-cut); if(ng.length<2) return; const shift=total-cut; s.loopFix={was:s.len}; s.g=k?ng:ng.reverse(); s.len=Math.round(cut);
    if(k===0){ ['L','R'].forEach(sd=>{ if(s.ln&&s.ln[sd]) s.ln[sd]=s.ln[sd].map(z=>z-shift).filter(z=>z>2&&z<s.len-2); if(s.bst&&s.bst[sd]) s.bst[sd]=s.bst[sd].map(([z,nm])=>[z-shift,nm]).filter(([z])=>z>2&&z<s.len-2); }); }
    n++; }); });
  console.log('dead ends cut back to their turnaround loop:', n); })();
// ── Which blocks can carry a bike-lane design at all ─────────────────────────
// Returns {ok, reason}. Everything is judged from the block's own record; the result is cached on the segment.
// Kept on purpose (not excluded): OSM "trunk" streets (Granville, Howe, Seymour, Georgia, Oak: Hwy 99 is routed along
// them, they are exactly where protected lanes go), bridges and viaducts (key network links), diversions, truck and bus
// routes, one-way streets, blocks that already have a protected lane (redesign is allowed), very narrow blocks (the solver
// falls back to a local-street bikeway), and longer dead-end streets (they often end at a path or the seawall).
function designable(s){ if(s._dz) return s._dz; let reason=null;
  const name=s.n, last=s.s.split(' ').pop(), hw=(s.osm&&s.osm.hw)||'';
  if (hw==='motorway' || /TRANS CANADA/.test(name)) reason='Highway: a freeway-standard road; cycling is prohibited or served by a separate path';
  else if (/\bRAMP\b|ON-RAMP|OFF-RAMP/.test(name)) reason='Highway ramp: a merge / diverge leg with no frontage, not a street a bike lane can serve';
  else if (isUpSeg(s)) reason='Bridge, viaduct or overpass: a fixed structure whose deck and ramps are drawn as they exist; a bike lane is designed on the streets at either end and the existing deck facility is kept';   // v3: structures are context, not design blocks
  else if (s.u==='Closed') reason='Closed street (Open Data class "Closed")';
  else if (s.u==='Leased') reason='Leased / private road (Open Data class "Leased"): not a public street';
  else if (s.u==='Recreational') reason='Park road (Open Data class "Recreational"): Park Board jurisdiction, the Engineering Design Manual street standards do not apply';
  else if (/^(ALLEY|MEWS|WALK|WALKWAY|LANE)$/.test(last)) reason='Alley, lane, mews or walk: shared low-speed space by design, with no room for a separated facility';
  else if (s.bw && (s.bw.sub==='OSS'||s.bw.sub==='OSB')) reason='Off-street path: an '+SUBTYPE[s.bw.sub]+' already serves this block (e.g. the seawall); the roadway does not need a lane';
  else if (s.len<30) reason='Block under 30 m: an intersection leg or turning stub, too short to carry a facility of its own';
  else { const dead=[0,1].filter(k=>{ const nb=endNeighbours(s,k); return !nb.cross.length&&!nb.cont.length; }).length;
    if (dead===2) reason='Isolated segment: connects to no other street at either end, so a lane here would join nothing';
    else if (dead===1 && s.len<60 && s.u==='Residential') reason='Dead-end residential stub under 60 m: serves only its own frontages'; }
  return s._dz={ok:!reason, reason}; }
const $ = id => document.getElementById(id);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const fmt = v => (Math.round(v*100)/100).toFixed(2);

// ── EDM rules (CoV Engineering Design Manual 2026, Tables 8-6, 8-7, 8-10) ──
const RULES = {
  bike:  { one:{abs:1.5, min:2.0, pref:[2.4,3.0]}, two:{abs:2.7, min:3.0, pref:[3.5,4.5]} },
  buffer:{ painted:{min:0.8, pref:1.0},           // painted + intermittent posts, adjacent to parking
           raised:{one:{min:0.4,pref:0.8}, two:{min:0.6,pref:1.0}},   // raised buffer, bike at road grade
           treed:{min:1.5, pref:2.3}, planter:{min:1.0,pref:1.0}, barrierW:[0.46,0.61] },
  travel:{ through:{abs:2.7, min:3.0, max:3.2}, curb:{abs:2.8, min:3.0, max:3.4},
           busCurb:{abs:3.0, min:3.2, max:3.5}, busThrough:{abs:3.0,min:3.2,max:3.2}, single:{abs:2.9,min:3.0,max:3.5}, busSingle:{abs:3.5,min:3.5,max:3.6} },
  parking: 2.5, curbLaneWithParking: 5.5, sidewalk: 3.6,
};
const SEP = {
  posts:   {name:'Painted buffer + flex posts', prot:'Low',     cost:'$',   bufKind:'painted', h:0.0,  maxSpd:50, maxAadt:6000},
  precast: {name:'Pre-cast concrete curb',      prot:'Medium',  cost:'$$',  bufKind:'raised',  h:0.15, maxSpd:60, maxAadt:1e9},
  planter: {name:'Planter boxes on curb',       prot:'Medium',  cost:'$$',  bufKind:'planter', h:0.15, maxSpd:50, maxAadt:1e9},
  extruded:{name:'Extruded concrete curb',      prot:'Medium-High', cost:'$$$', bufKind:'raised', h:0.15, maxSpd:80, maxAadt:1e9},
  barrier: {name:'Concrete barrier',            prot:'High',    cost:'$$',  bufKind:'barrier', h:0.69, maxSpd:80, maxAadt:1e9},
  shared:  {name:'Local street bikeway (shared, traffic-calmed)', prot:'Low', cost:'$', bufKind:'none', h:0, maxSpd:30, maxAadt:1500},
  // v2: the permanent end of the range, and a painted buffer with no posts (used to draw existing painted lanes)
  raised:  {name:'Raised bike lane (intermediate level, concrete curb both sides)', prot:'High', cost:'$$$$', bufKind:'raisedlane', h:0.15, maxSpd:80, maxAadt:1e9, permanent:true},
  paint:   {name:'Painted buffer (no physical separation)', prot:'None', cost:'$', bufKind:'paint', h:0.0, maxSpd:50, maxAadt:6000},
};
// durability order used by the "make permanent" case (Rapid Implementation Guide Figure 32 protection levels and Tables 3–9 durability)
const SEP_RANK = {paint:0, posts:1, planter:2, precast:3, extruded:4, barrier:5, raised:6};

// ── v2: what kind of design this block calls for, from its existing facility ─────────────────────────────────────────
// Subtype codes as used in the bikeways layer (decoded from its notes field: "SL to PL NB", "upgrade to wide paint", "Protected from 2018"…)
const SUBTYPE = { NB:'painted lane, no buffer', PBT:'painted lane, buffer on the traffic side', PBP:'painted lane, buffer on the parking side', PBPT:'painted lane, buffers both sides',
                  SL:'street-level protected lane', R:'raised protected lane', OSS:'off-street shared path', OSB:'off-street bike path' };
function facilityDesc(bw){ if(!bw) return 'no facility'; const sub=SUBTYPE[bw.sub]; const dir=bw.dir==='Bidirectional'?'two-way':bw.dir==='2W'?'each side':bw.dir==='OW'?'one side':bw.dir==='CFlow'?'contra-flow':'';
  return (sub||(bw.t==='Local Street'?'local street bikeway (shared)':bw.t==='Shared Lanes'?'shared lanes (sharrows)':bw.t.toLowerCase()))+(dir?' ('+dir+')':''); }
function designCase(s){ if(s._case) return s._case; const bw=s.bw; let c;
  const when=bw?[bw.yr?'built '+bw.yr:null, bw.up?'upgraded '+bw.up:null].filter(Boolean).join(', '):'';
  const flags=bw?[bw.aaa?'AAA network':'not on the AAA network', bw.aaaSeg?'AAA segment':null, bw.snow?'snow-cleared':null, bw.route?bw.route:null].filter(Boolean):[];
  if(!bw) c={mode:'new', label:'New protected lane', button:'Design a new bike lane →', why:'No facility on this block.'};
  else if(bw.sub==='OSS'||bw.sub==='OSB') c={mode:'offstreet', label:'Off-street path', button:'Not a roadway design', why:'An '+SUBTYPE[bw.sub]+' already serves this block; the roadway does not need a lane.'};
  else if(bw.t==='Painted Lanes'||bw.t==='Shared Lanes'||/^(NB|PBT|PBP|PBPT)$/.test(bw.sub||'')) c={mode:'upgrade', label:'Upgrade to protected', button:'Upgrade to a protected lane →', why:'Existing '+facilityDesc(bw)+': painted lanes and sharrows are not All Ages & Abilities (EDM §8.5.3.4, §8.5.3.5); the options add physical separation.'};
  else if(bw.t==='Local Street') c=(s.u==='Residential')?{mode:'new', label:'Local-street bikeway (AAA by design) · new lane optional', button:'Design a separated lane anyway →', why:'A traffic-calmed local street bikeway is AAA on a residential street; a separated lane is optional here.'}
                                  :{mode:'upgrade', label:'Upgrade to protected', button:'Upgrade to a protected lane →', why:'A shared local-street bikeway on a '+s.u.toLowerCase()+' is not AAA (EDM §8.5.3.5).'};
  else if(bw.sub==='R') c={mode:'review', label:'Existing raised lane · review', button:'Review the existing lane →', why:'A raised protected lane is already the permanent form; the tool checks widths and intersections rather than proposing a new separation.'};
  else c={mode:'permanent', label:'Make permanent', button:'Make the protected lane permanent →', why:'Existing '+facilityDesc(bw)+'. The layer does not record its separation material, so the options are the durable end of the Rapid Implementation Guide range (Figure 32): extruded curb, raised lane, barrier.'};
  c.existing=bw?facilityDesc(bw):null; c.when=when; c.flags=flags; c.note=bw&&bw.note?bw.note:null; return s._case=c; }

// ── Segment context ──────────────────────────────────────────────────────────
function segContext(s) {
  const lbl = s.ns ? ['W','E'] : ['N','S'];
  const pm = s.pm || {L:0,R:0};
  const meters = pm.L + pm.R;
  // inferred existing configuration (editable); lane count from OpenStreetMap where tagged, else from the width
  // (a two-way street needs at least one lane per direction; an OSM way of a divided street may carry only its own carriageway's lanes)
  const lanes = (s.osm&&s.osm.ln) ? clamp(s.osm.ln, s.ow?1:2, 6) : s.ow ? (s.ctc>=12?2:1) : (s.ctc >= 16 ? 4 : 2);
  const owd = (s.osm&&s.osm.owd) || 0;   // one-way direction from OSM: +1 = travel in +z (north/east); 0 = unknown (drawn as +z)
  const resid = s.u==='Residential' || s.u==='Collector';
  const park = { L: pm.L>0 || (resid && s.ctc>=10), R: pm.R>0 || (resid && s.ctc>=10) };
  // direction mode from network connections on the same street
  let dirMode='free', dirWhy='no same-street facility at either end';
  const same=[]; (s.cn||[]).forEach((end,i)=>end.forEach(c=>{ if(c.same) same.push({...c,end:i}); }));
  if (s.bw) { same.push({...s.bw, same:true, end:-1}); }
  const two = same.find(c=>c.dir==='Bidirectional'), one = same.find(c=>c.dir==='2W'||c.dir==='OW'||c.dir==='CFlow');
  if (two) { dirMode='two'; dirWhy = (two.end<0?'existing ':'connects to ')+'bidirectional '+two.t.toLowerCase()+' ('+two.name+')'; }
  else if (one) { dirMode='one'; dirWhy = (one.end<0?'existing ':'connects to ')+'one-way '+one.t.toLowerCase()+' ('+one.name+')'; }
  const cross=[]; (s.cn||[]).forEach((end,i)=>end.forEach(c=>{ if(!c.same) cross.push({...c,end:i}); }));
  const bus=!!(s.bus||s.truck);
  // v3: a block on a structure takes its carriageway from its lane count (structCtc), not from the right-of-way points
  const ctcS=structCtc(s); if(ctcS!==s.ctc){ s.ctcOrig=s.ctc; s.ctc=ctcS; s.row=Math.max(s.row, Math.round((ctcS+3)*10)/10); }
  const swW=Math.max(1.8, Math.min(8, (s.row - s.ctc)/2));
  const G=blockGrade(s);
  return { seg:s, case:designCase(s), lbl, meters, pm, lanes, park, bus, aadt:null, oneway:!!s.ow, owd, swW, grade:G.grade, z0:G.za, z1:G.zb, stops:s.bst||{L:[],R:[]}, racks:s.rk||{L:0,R:0}, ctc:s.ctc, spd:s.spd, dirMode, dirWhy, cross, same, ln:s.ln||{L:[],R:[]}, tr:s.tr||{}, bl:s.bl||{} };
}

// ── Layout solver ───────────────────────────────────────────────────────────
function laneMin(ctx, isCurb, single){ const b=ctx.bus; return single ? (b?RULES.travel.busSingle:RULES.travel.single) : isCurb ? (b?RULES.travel.busCurb:RULES.travel.curb) : (b?RULES.travel.busThrough:RULES.travel.through); }
function bufMin(sep, adjParking, mode){
  const k=SEP[sep].bufKind;
  if (k==='barrier') return 0.6;
  if (k==='planter') return RULES.buffer.planter.min;
  if (k==='raisedlane') return adjParking ? RULES.buffer.painted.min : (mode==='two'?0.6:0.15);   // Table 8-7: raised buffer, bicycle lane flush with buffer (note 1 for bidirectional)
  if (k==='painted' || k==='paint' || adjParking) return RULES.buffer.painted.min;
  return RULES.buffer.raised[mode].min;
}
function bufPref(sep, adjParking, mode){ const k=SEP[sep].bufKind; if(k==='barrier') return 0.6; if(k==='planter') return 1.0; if(k==='raisedlane') return adjParking?1.0:(mode==='two'?1.0:0.6); if(k==='painted'||k==='paint'||adjParking) return 1.0; return RULES.buffer.raised[mode].pref; }

// Build an element list for a given configuration; returns null if it can't fit at minimums.
function solve(ctx, mode, sep, lanes, park, twoSide) {
  const L=ctx.lbl[0], R=ctx.lbl[1];
  const els=[];
  const push=(k,side,w,extra={})=>els.push({k,side,w,...extra});
  // sidewalks fixed
  const SW=ctx.swW||RULES.sidewalk;
  push('sw','L',SW,{h:0.15,lock:true});
  const bufH = SEP[sep].h;
  const bikeH = SEP[sep].bufKind==='raisedlane' ? 0.15 : 0.0;   // a raised lane rides at the buffer's level
  // Right-hand traffic: the L (west/north) side carries −z (south/west-bound) movement, the R side carries +z.
  if (mode==='one') {
    push('bike','L',ctx.absolute?RULES.bike.one.abs:RULES.bike.one.min,{h:bikeH,dir:-1});
    push('buf','L',ctx.absolute?Math.min(0.4,bufMin(sep,park.L,'one')):bufMin(sep,park.L,'one'),{h:bufH,sep});
    if (park.L) push('park','L',RULES.parking,{h:0});
  } else {
    const side = twoSide;
    if (side==='L') { push('bike','L',ctx.absolute?RULES.bike.two.abs:RULES.bike.two.min,{h:bikeH,dir:0,two:true}); push('buf','L',bufMin(sep,park.L,'two'),{h:bufH,sep}); if (park.L) push('park','L',RULES.parking,{h:0}); }
    else if (park.L) push('park','L',RULES.parking,{h:0});
  }
  const perDir = ctx.oneway ? lanes : Math.max(1, Math.floor(lanes/2)), extra = ctx.oneway ? 0 : lanes - perDir*2; // odd => centre turn lane
  if (ctx.oneway) { for (let i=0;i<lanes;i++) push('travel', i===0?'L':(i===lanes-1?'R':'C'), 0, {h:0, curb:i===0||i===lanes-1, ow:true}); }
  else { for (let i=0;i<perDir;i++) push('travel','L',0,{h:0,curb:i===0}); if (extra) push('travel','C',0,{h:0,turn:true}); for (let i=0;i<perDir;i++) push('travel','R',0,{h:0,curb:i===perDir-1}); }
  if (mode==='one') {
    if (park.R) push('park','R',RULES.parking,{h:0});
    push('buf','R',ctx.absolute?Math.min(0.4,bufMin(sep,park.R,'one')):bufMin(sep,park.R,'one'),{h:bufH,sep});
    push('bike','R',ctx.absolute?RULES.bike.one.abs:RULES.bike.one.min,{h:bikeH,dir:1});
  } else {
    if (twoSide==='R') { if (park.R) push('park','R',RULES.parking,{h:0}); push('buf','R',bufMin(sep,park.R,'two'),{h:bufH,sep}); push('bike','R',ctx.absolute?RULES.bike.two.abs:RULES.bike.two.min,{h:bikeH,dir:0,two:true}); }
    else if (park.R) push('park','R',RULES.parking,{h:0});
  }
  push('sw','R',SW,{h:0.15,lock:true});
  // travel minimums
  const single = ctx.oneway ? lanes===1 : perDir===1;
  els.forEach(e=>{ if(e.k==='travel'){ const isCurb = e.curb && !(e.side==='L'?park.L:park.R) ; e.min = laneMin(ctx,isCurb,single).min; e.abs = laneMin(ctx,isCurb,single).abs; e.max = laneMin(ctx,isCurb,single).max; e.w = ctx.absolute? e.abs : e.min; } });
  const used = els.filter(e=>e.k!=='sw').reduce((s,e)=>s+e.w,0);
  let spare = ctx.ctc - used;
  if (spare < -0.05) return null;
  // allocate spare in EDM preference order
  const give=(pred, cap)=>{ const t=els.filter(pred); if(!t.length||spare<=0) return; let room=t.map(e=>Math.max(0,cap(e)-e.w)); let tot=room.reduce((a,b)=>a+b,0); if(tot<=0) return; const g=Math.min(spare,tot); t.forEach((e,i)=>{ e.w+= g*room[i]/tot; }); spare-=g; };
  give(e=>e.k==='bike', e=>e.two?RULES.bike.two.pref[0]:RULES.bike.one.pref[0]);
  give(e=>e.k==='travel', e=>Math.min(e.max, e.min+0.3));
  give(e=>e.k==='buf', e=>bufPref(e.sep, (e.side==='L'?park.L:park.R), e.two?'two':'one'));
  give(e=>e.k==='bike', e=>e.two?RULES.bike.two.pref[1]:RULES.bike.one.pref[1]);
  give(e=>e.k==='travel', e=>e.max);
  give(e=>e.k==='buf', e=>SEP[e.sep].bufKind==='barrier'?1.2:RULES.buffer.treed.pref);
  if (spare>0.001) { const t=els.filter(e=>e.k==='buf'); t.forEach(e=>e.w+=spare/t.length); spare=0; }
  els.forEach(e=>e.w=Math.round(e.w*100)/100);
  return els;
}

function generateOptions(ctx) {
  const spd=ctx.spd, aadt=ctx.aadt;
  const low = spd<=30 && (aadt===null || aadt<4000);
  const high = spd>=60 || (aadt!==null && aadt>=10000);
  const cs=ctx.case||designCase(ctx.seg);
  // v2: the separation set depends on the case. make-permanent → only the durable end of the range; review → the raised lane as built
  let seps = high ? ['extruded','barrier','precast'] : low ? ['posts','precast','planter'] : ['precast','extruded','barrier'];
  if (cs.mode==='permanent') seps=['extruded','raised','barrier']; else if (cs.mode==='review') seps=['raised'];
  const modes = ctx.dirMode==='free' ? ['one','two','one'] : [ctx.dirMode,ctx.dirMode,ctx.dirMode];
  const twoSide = twoSideOf(ctx);
  const opts=[];
  seps.forEach((sep,i)=>{
    const mode=modes[i]; const best = fitConfig(ctx, mode, sep, twoSide);
    if (!best) return;
    opts.push({ id:'ABC'[i], sep, mode, twoSide, custom:false, els:best.els, tradeoffs:best.tradeoffs, lanes:best.lanes, park:best.park,
      title: (mode==='two'?'Two-way':'One-way each side')+' · '+SEP[sep].name });
  });
  // fallbacks when a protected facility cannot fit at EDM minimums (not for a review of an existing raised lane)
  if (opts.length<3 && cs.mode!=='review') {
    const absCtx={...ctx, absolute:true};
    const a=fitConfig(absCtx, ctx.dirMode==='free'?'one':ctx.dirMode, 'precast', twoSide);
    if (a && opts.length<3) opts.push({id:'ABC'[opts.length], sep:'precast', mode:ctx.dirMode==='free'?'one':ctx.dirMode, twoSide, custom:false, els:a.els, tradeoffs:[...a.tradeoffs,'Uses absolute-minimum widths — requires City Engineer approval (Table 8-6 note 1, Table 8-10 note 4)'], lanes:a.lanes, park:a.park, absolute:true, title:'Absolute minimums · Pre-cast concrete curb'});
    while (opts.length<3) opts.push({id:'ABC'[opts.length], sep:'shared', mode:'shared', twoSide, custom:false, els:beforeElements(ctx).map(e=>({...e})), tradeoffs:['No road-space reallocation — relies on 30 km/h and traffic calming (diverters, speed humps)'], lanes:ctx.lanes, park:ctx.park, title:'Local street bikeway (shared, traffic-calmed)'});
  }
  // v2: on a structure (bridge, viaduct, overpass) no sidewalk is added — the deck's existing sidewalk is kept as it is and only noted
  if (lvlOf(ctx.seg)>0) opts.forEach(o=>o.els.forEach(e=>{ if(e.k==='sw'){ e.existing=true; e.lock=true; } }));
  return opts;
}
// two-way side: side with fewer laneway openings, then fewer meters
function twoSideOf(ctx){ const bw=ctx.seg.bw; if(bw&&bw.dir==='Bidirectional'){ const fs=facilitySide(ctx.seg); if(fs==='L'||fs==='R') return fs; }   // an existing two-way lane keeps its side (OSM)
  const lnL=(ctx.ln.L||[]).length, lnR=(ctx.ln.R||[]).length; return lnL!==lnR ? (lnL<lnR?'L':'R') : (ctx.pm.L<=ctx.pm.R?'L':'R'); }
// try configurations in order of least disruption; never below 2 lanes; keep lanes ≥ min widths
function fitConfig(ctx, mode, sep, twoSide) {
  const n=ctx.lanes, P=ctx.park, bestSide = ctx.pm.L>=ctx.pm.R?'L':'R';
  const cands=[];
  const add=(lanes,park,tr)=>cands.push({lanes,park,tradeoffs:tr});
  add(n,{...P},[]);
  if (P.L&&P.R) add(n,{L:bestSide==='L',R:bestSide==='R'},['Parking removed on the '+(bestSide==='L'?ctx.lbl[1]:ctx.lbl[0])+' side']);
  if (P.L||P.R) add(n,{L:false,R:false},['All on-street parking removed']);
  for (let k=n-1;k>=(ctx.oneway?1:2);k--) {
    const tr=['Travel lanes reduced from '+n+' to '+k];
    add(k,{...P},tr);
    if (P.L&&P.R) add(k,{L:bestSide==='L',R:bestSide==='R'},[...tr,'Parking removed on the '+(bestSide==='L'?ctx.lbl[1]:ctx.lbl[0])+' side']);
    if (P.L||P.R) add(k,{L:false,R:false},[...tr,'All on-street parking removed']);
  }
  for (const c of cands) { const els=solve(ctx,mode,sep,c.lanes,c.park,twoSide); if (els) return {els, tradeoffs:c.tradeoffs, lanes:c.lanes, park:c.park}; }
  return null;
}

// ── Compliance & recommendations ────────────────────────────────────────────
function checkCompliance(opt, ctx) {
  const out=[]; const E=opt.els; const push=(lvl,msg)=>out.push({lvl,msg});
  if (opt.sep==='shared') { if (ctx.spd>30 || ctx.seg.u==='Arterial' || ctx.seg.u==='Secondary Arterial') push('err','A shared local-street bikeway is not All Ages & Abilities above 30 km/h or on arterials (EDM §8.5.3.5). Use a protected facility.'); else if (ctx.aadt!==null && ctx.aadt>1500) push('warn',`Local street bikeways suit < 1,500 veh/day; this block is at ${ctx.aadt.toLocaleString()}. Add diverters to cut through-traffic.`); else push('warn','Shared bikeway: confirm volumes are below 1,500 veh/day and add traffic calming; sharrows must be centred in the lane (BC Safe Passing Law).'); return out; }
  const sum=E.filter(e=>e.k!=='sw').reduce((s,e)=>s+e.w,0);
  const diff=sum-ctx.ctc;
  const rowSum=E.reduce((s,e)=>s+e.w,0); if (Math.abs(rowSum-ctx.seg.row)>0.06) push('warn', `Section totals ${fmt(rowSum)} m against a ${fmt(ctx.seg.row)} m right-of-way — the sidewalk edge would no longer meet the property line, so the sidewalk would jog at each end of the block.`);
  if (Math.abs(diff)>0.05) push('err', diff>0 ? `Section is ${fmt(diff)} m wider than the ${fmt(ctx.ctc)} m curb-to-curb — property lines and sidewalks are fixed.` : `${fmt(-diff)} m of road width is unallocated. Use Auto-balance or widen a buffer.`);
  E.forEach(e=>{
    if (e.k==='bike') { const r=e.two?RULES.bike.two:RULES.bike.one, nm=e.two?'Two-way bike lane':'One-way bike lane ('+ctx.lbl[e.side==='L'?0:1]+')';
      if (e.w<r.abs-0.001) push('err', `${nm} ${fmt(e.w)} m is below the absolute minimum ${r.abs} m (Table 8-6).`);
      else if (e.w<r.min-0.001) push(opt.absolute?'warn':'err', `${nm} ${fmt(e.w)} m is below the ${r.min} m minimum; ${r.abs}–${r.min} m only for short constrained sections with City Engineer approval.`);
      else if (e.w<r.pref[0]-0.001) push('warn', `${nm} ${fmt(e.w)} m meets the minimum but is below the preferred ${r.pref[0]}–${r.pref[1]} m.`); }
    if (e.k==='buf') { const adj = E[E.indexOf(e)+ (e.side==='L'?1:-1)]; const adjP = adj && adj.k==='park'; const m=bufMin(e.sep,adjP,e.two?'two':'one'); const kind=SEP[e.sep].bufKind;
      if (kind==='barrier' && (e.w<RULES.buffer.barrierW[0]-0.001)) push('err', `Barrier zone ${fmt(e.w)} m is narrower than the barrier itself (0.46–0.61 m).`);
      else if (e.w<m-0.001) push(opt.absolute&&e.w>=0.4?'warn':'err', `Buffer (${ctx.lbl[e.side==='L'?0:1]}) ${fmt(e.w)} m is below the ${m} m minimum for a ${SEP[e.sep].name.toLowerCase()}${adjP?' next to parking (door zone)':''} (Table 8-7).`); }
    if (e.k==='travel') {
      if (e.w<e.abs-0.001) push('err', `Travel lane ${fmt(e.w)} m is below the absolute minimum ${e.abs} m (Table 8-10) — unsafe.`);
      else if (e.w<e.min-0.001) push(opt.absolute?'warn':'err', `Travel lane ${fmt(e.w)} m is below the ${e.min} m minimum${ctx.bus?' for a bus/truck route':''}; absolute minimums need City Engineer approval.`);
      else if (e.w>e.max+0.001) push('warn', `Travel lane ${fmt(e.w)} m exceeds the ${e.max} m maximum — wide lanes invite unsafe passing of cyclists (Table 8-10 note 8). Reallocate to the buffer or bike lane.`); }
    if (e.k==='sw' && e.w<1.8-0.001) push('err', `Sidewalk + boulevard ${fmt(e.w)} m is below the 1.8 m absolute minimum clear width.`);
    else if (e.k==='sw' && e.w<2.0-0.001) push('warn', `Sidewalk + boulevard ${fmt(e.w)} m — 2.0 m is the minimum on a commercial frontage.`);
    if (e.k==='park' && Math.abs(e.w-RULES.parking)>0.05) push('warn', `Parking lane ${fmt(e.w)} m — marked parking lanes are generally 2.5 m.`);
  });
  const gp=Math.abs(ctx.grade)*100;
  if (gp>=8) push('err', `Block grade ${gp.toFixed(1)}% — above 8% a protected lane needs extra width for speed differential and braking; check the design speed and consider widening the downhill lane or a separate uphill treatment.`);
  else if (gp>=5) push('warn', `Block grade ${gp.toFixed(1)}% — on grades above 5% widen the downhill bike lane toward the preferred dimension and keep the buffer clear of drainage.`);
  const lanes=E.filter(e=>e.k==='travel').length; if (lanes<(ctx.oneway?1:2)) push('err', ctx.oneway?'A one-way street needs at least one travel lane.':'At least one travel lane per direction is required.');
  const bikes=E.filter(e=>e.k==='bike'); const two = bikes.some(b=>b.two);
  if (ctx.dirMode==='two' && !two) push('err', `This block must be two-way: it ${ctx.dirWhy}. A one-way pair would not connect.`);
  if (ctx.dirMode==='one' && two) push('err', `This block must be one-way each side: it ${ctx.dirWhy}. A two-way facility would not connect.`);
  if (bikes.length===0) push('err','No bike lane in this section.');
  if (opt.absolute) push('warn','Absolute-minimum widths are for short constrained sections and require City Engineer / Director of Transportation approval.');
  const sep=opt.sep; if (SEP[sep].maxSpd<ctx.spd) push('err', `${SEP[sep].name} is not appropriate at ${ctx.spd} km/h — physical curb separation required (EDM §8.5.3.5).`);
  if (ctx.aadt!==null && ctx.aadt>=SEP[sep].maxAadt) push('err', `${SEP[sep].name} is not appropriate above ${SEP[sep].maxAadt.toLocaleString()} veh/day (Rapid Implementation Guide).`);
  if (ctx.aadt===null && ctx.spd>=50 && sep==='posts') push('warn','AADT unknown; flex posts only suitable below 6,000 veh/day.');
  return out;
}
function gpR(ctx){ return Math.abs(ctx.grade)*100; }
function recommendations(opt, ctx) {
  const R=[]; const E=opt.els; const sum=E.filter(e=>e.k!=='sw').reduce((s,e)=>s+e.w,0); const spare=ctx.ctc-sum;
  // v2: the case comes first
  const cs=ctx.case||designCase(ctx.seg); const bw=ctx.seg.bw;
  if (cs.mode==='upgrade') R.push(`Upgrade: the existing ${cs.existing}${cs.when?' ('+cs.when+')':''} is not All Ages & Abilities; painted lanes and sharrows give no physical protection (EDM §8.5.3.4, §8.5.3.5). This option replaces it with ${SEP[opt.sep].name.toLowerCase()}. Widths of the existing lane are not recorded; the "before" view uses EDM minimums.`);
  if (cs.mode==='permanent') R.push(`Make permanent: the existing street-level protected lane${cs.when?' ('+cs.when+')':''} keeps its alignment; the Rapid Implementation Guide treats posts, planters and pre-cast curb as interim materials (Figure 32, Tables 3–9) and this option moves to ${SEP[opt.sep].name.toLowerCase()}. The layer does not record the current material, so check it on site before pricing the change.`);
  if (cs.mode==='review') R.push(`Review: the raised lane${cs.when?' ('+cs.when+')':''} is already the permanent form. Check its width against Table 8-6 (widths are not recorded; the drawing assumes the minimum) and its intersections against §8.9.1.12.`);
  if (bw && !bw.aaa && cs.mode!=='offstreet') R.push('Not on the AAA network: confirm the lane meets Table 8-6 minimums and that the crossings at both ends are protected, then it can be added to the network.');
  if (bw && bw.dir==='OW' && ctx.dirMode==='two') R.push('The existing facility is one-way; the connection rule makes this block two-way, so the design adds the contra-flow direction (a change of facility, not just of material).');
  E.filter(e=>e.k==='buf').forEach(e=>{ const kind=SEP[e.sep].bufKind;
    if (e.w>=RULES.buffer.treed.min && kind!=='barrier') R.push(`Buffer on the ${ctx.lbl[e.side==='L'?0:1]} is ${fmt(e.w)} m — wide enough for a raised buffer with street trees (min 1.5 m, preferred 2.3 m, Table 8-7).`);
    if (kind==='painted') R.push(`Painted buffer: add intermittent physical separation ~1.5 m long at the front of each parking stall (Table 8-7 note 2).`);
  });
  E.filter(e=>e.k==='bike').forEach(e=>{ const r=e.two?RULES.bike.two:RULES.bike.one; if (e.w>=r.min && e.w<r.pref[0]) R.push(`Widen the ${e.two?'two-way':'one-way'} bike lane toward ${r.pref[0]} m if a travel lane is above its minimum.`); if (ctx.tr && ((ctx.tr.L&&ctx.tr.L.n)||(ctx.tr.R&&ctx.tr.R.n))) R.push('Lamp poles or trees beside the lane: add 0.3 m (0.6 m preferred) shy distance (Table 8-6 note 3).'); });
  const wide=E.filter(e=>e.k==='travel' && e.w>e.max-0.05); if (wide.length) R.push('Travel lanes are at their maximum; give any further width to the buffer or bike lane, not the lanes.');
  const park=E.some(e=>e.k==='park'); if (park) R.push('Parking-protected layout: keep buffers ≥ 0.8 m (≥ 1.0 m preferred) for the door zone and provide accessible curb gaps.');
  ['L','R'].forEach(sd=>{ const n=(ctx.ln[sd]||[]).length; if (n) R.push(`${n} laneway opening${n>1?'s':''} on the ${ctx.lbl[sd==='L'?0:1]} side: break the curb/barrier there, dash the bike lane edge and add conflict markings; keep sightlines clear.`); });
  if (ctx.cross.length) R.push(`Cross-street bikeway at ${ctx.cross.map(c=>c.name).filter((v,i,a)=>a.indexOf(v)===i).join(', ')}: design the intersection with protected corners / bike signals.`);
  ['L','R'].forEach(sd=>{ const st=ctx.stops[sd]||[]; if(st.length) R.push(`${st.length} bus stop${st.length>1?'s':''} on the ${ctx.lbl[sd==='L'?0:1]} side (${st.map(x=>x[1]).join('; ')}): build floating bus stop islands (2.75 m min, 3.0 m preferred, Table 8-7) so the bike lane stays protected through the stop.`); });
  if (ctx.bus && !((ctx.stops.L||[]).length+(ctx.stops.R||[]).length)) R.push(`${ctx.seg.truck?'Truck':'Bus'} route: curb lanes are held at 3.2 m minimum (Table 8-10).`);
  ['L','R'].forEach(sd=>{ const n=ctx.racks[sd]; if(n) R.push(`${n} bike rack${n>1?'s':''} on the ${ctx.lbl[sd==='L'?0:1]} side — keep them on the sidewalk/boulevard, not in the buffer, and add racks near the new lane's entry points.`); });
  endInfo(ctx.seg).forEach((e,i)=>{ const where=i?'Far':'Near';
    if (e.type==='dead') R.push(`${where} end is a dead end — terminate the facility with a ramped transition to the sidewalk or a path connection; a lane that simply stops is a hazard (EDM §8.5.4).`);
    else if (e.type==='path') R.push(`${where} end: the street ends for cars${e.loop?' in a turnaround loop':''}, but ${e.path.n?e.path.n:'a public '+(e.path.des?'cycleway':'path')} (${e.path.src==='OSM'?'OpenStreetMap':'City bikeways layer'}) carries cyclists on. Hand the lane over to it with a flush curb ramp (no lip) aligned with the path, keep the connector as wide as the path${e.path.ow?' (one-way)':' (two-way, 3.0 m)'}, and sign the transition; count this end as connected to the network.`);
    else if (e.type==='continue') R.push(`${where} end continues as ${e.names.length?e.names.map(n=>n.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())).join('/'):'the same street'} — carry the cross-section straight through with no transition, and match the adjacent block's facility type and side.`);
    if (e.gapUnder) R.push(`${where} end: the City's centreline breaks here, but ${titleCase(e.gapUnder.s)} stands over the gap and the street runs on beneath it — treated as a continuation (check on site / in the review page).`);
    if (e.ov) R.push(`${where} end: read as "${e.ov.v}" by the reviewer${e.ov.note?' — '+e.ov.note:''} (data/overrides.json).`);
    if (e.under.length) R.push(`${where} end: ${[...new Set(e.under.map(o=>titleCase(o.s)))].join(' and ')} pass${e.under.length>1?'':'es'} beneath the structure here (OpenStreetMap layers) — there is no junction; the facility runs on across the deck.`);
    if (e.over.length) R.push(`${where} end: ${[...new Set(e.over.map(o=>titleCase(o.s)))].join(' and ')} pass${e.over.length>1?'':'es'} overhead here — no junction with it; check clearance for lighting and signs under the structure.`); });
  if (lvlOf(ctx.seg)>0) R.push(`This block is on a structure (OpenStreetMap layer ${lvlOf(ctx.seg)}): no sidewalk or boulevard is added — the existing deck sidewalk is kept as it is and the facility fits within the existing carriageway between the deck's curbs; drainage, expansion joints and railing height (1.4 m for a bicycle rail, EDM §8.6) govern the edge details.`);
  (ctx.seg.ix||[]).forEach((e,i)=>{ if(e) R.push(`${i?'Far':'Near'} end meets ${e.x? e.x.split(' AND ').filter(n=>!n.startsWith(ctx.seg.s)).join('/')||'a cross street':'a cross street'}: the lane crosses between elephant's feet with a bicycle stencil in each cross-street lane (EDM §8.9.1.12, Table 8-19); bicycle stop bar 0.3 m wide, 0.5 m clear of the crosswalk, vehicle stop bar 2.0 m behind it (§8.9.1.8); physical protection ends 6 m back behind a corner island (BC Parkway Guide §4.5.2). Green in the crossing only where the cross street carries turning conflicts.`); });
  (ctx.seg.ix||[]).forEach((e,i)=>{ if(e&&e.sig) R.push(`${e.sig} signal at the ${i?'far':'near'} end: add a bike signal phase / leading bike interval and set the bike lane back from the crosswalk with yield markings.`); else if(e && (ctx.seg.u==='Arterial'||ctx.seg.u==='Secondary Arterial')) R.push(`Unsignalised arterial intersection at the ${i?'far':'near'} end: consider a raised crossing or RRFB for the crosswalk.`); });
  if (ctx.oneway) R.push('One-way street: a contra-flow protected lane can restore two-way cycling; place the with-flow lane on the driver\'s left where bus stops are on the right.');
  if (ctx.meters>=20) R.push(`${ctx.meters} parking meters on this block — run a parking utilisation study before removing stalls.`);
  if (opt.sep==='barrier') R.push('Concrete barrier reduces effective lane width (pedal strike); consider 0.3 m extra bike lane width.');
  if (ctx.spd>=50 && opt.sep==='precast') R.push('At 50 km/h pre-cast curbs are acceptable; extruded curb or barrier gives higher protection where volumes are high.');
  if (spare>0.1) R.push(`${fmt(spare)} m is unallocated — add it to the buffer (tree zone) before the travel lanes.`);
  if (gpR(ctx)>=3) R.push(`Grade is ${gpR(ctx).toFixed(1)}% (${ctx.z0.toFixed(1)} m to ${ctx.z1.toFixed(1)} m across the block, from the 1 m contours): cyclists descend fast here, so favour the wider end of the bike-lane range downhill and keep catch basins out of the riding surface.`);
  if (ctx.aadt===null) R.push('AADT is not in Open Data. Enter a count from a traffic study to confirm separation thresholds (6,000 / 10,000 veh/day).');
  return R.slice(0,8);
}

// existing (before) elements
function beforeElements(ctx){
  const els=[]; const push=(k,side,w,extra={})=>els.push({k,side,w,...extra});
  const SW=ctx.swW||RULES.sidewalk;
  push('sw','L',SW,{h:0.15,lock:true});
  const fits=(ctx.ctc-(ctx.park.L?2.5:0)-(ctx.park.R?2.5:0))/ctx.lanes>=2.7; if(!fits){ ctx.park={L:false,R:false}; }
  if (ctx.park.L) push('park','L',RULES.parking,{h:0});
  const n=ctx.lanes, perDir=ctx.oneway?n:Math.max(1,Math.floor(n/2)), extra=ctx.oneway?0:n-perDir*2;
  const laneW = Math.max(2.7,(ctx.ctc-(ctx.park.L?2.5:0)-(ctx.park.R?2.5:0))/n);
  if(ctx.oneway){ for(let i=0;i<n;i++) push('travel', i===0?'L':(i===n-1?'R':'C'), laneW,{h:0,ow:true}); } else { for(let i=0;i<perDir;i++) push('travel','L',laneW,{h:0}); if(extra) push('travel','C',laneW,{h:0,turn:true}); for(let i=0;i<perDir;i++) push('travel','R',laneW,{h:0}); }
  if (ctx.park.R) push('park','R',RULES.parking,{h:0});
  push('sw','R',SW,{h:0.15,lock:true});
  return els.map(e=>({...e,w:Math.round(e.w*100)/100}));
}
// v2: the existing street WITH its facility, so "before" and "after" differ. Widths are not recorded: EDM minimums are used
// (painted 1.5 m, protected one-way 1.8 m, two-way 3.0 m, buffers 0.6 m); the side of a two-way lane follows the design's side.
function existingElements(ctx){
  const bw=ctx.seg.bw; const cs=ctx.case||designCase(ctx.seg);
  const sub=(bw&&bw.sub)||'', painted=/^(NB|PBT|PBP|PBPT)$/.test(sub), prot=!!bw&&(bw.t==='Protected Bike Lanes'||sub==='SL'||sub==='R');
  if (!bw || cs.mode==='new' || cs.mode==='offstreet' || (!painted && !prot)) return beforeElements(ctx);   // sharrows / shared local streets have nothing to draw
  const two=bw.dir==='Bidirectional';
  const has=v=>v===undefined || (v && v!=='nan' && v!=='None');
  const fs=facilitySide(ctx.seg); const fsOK=fs==='L'||fs==='R';
  const sides = two ? [twoSideOf(ctx)] : (bw.dir==='OW'||bw.dir==='CFlow') ? [fsOK?fs:(has(bw.es)?'L':'R')] : ['L','R'];   // OSM side first; else E/S-bound uses the L side
  const laneW = two ? RULES.bike.two.min : prot ? 1.8 : 1.5;
  const sep = prot ? (sub==='R'?'raised':'precast') : 'paint';
  const bufTraffic = prot || sub==='PBT' || sub==='PBPT', bufParking = sub==='PBP' || sub==='PBPT';
  const build=(park)=>{ const els=[]; const push=(k,side,w,extra={})=>els.push({k,side,w,...extra}); const SW=ctx.swW||RULES.sidewalk;
    const facility=(side,dir)=>{ const seq=[]; if(park[side]) seq.push(['park',RULES.parking,{h:0}]); if(park[side]&&bufParking) seq.push(['buf',0.6,{h:0,sep:'paint'}]);
      seq.push(['bike',laneW,{h:sep==='raised'?0.15:0,dir,two}]); if(bufTraffic) seq.push(['buf',0.6,{h:SEP[sep].h,sep}]); return side==='L'?seq:seq.reverse(); };
    push('sw','L',SW,{h:0.15,lock:true}); if(sides.includes('L')) facility('L',two?0:-1).forEach(([k,w,x])=>push(k,'L',w,x)); else if(park.L) push('park','L',RULES.parking,{h:0});
    const n=ctx.lanes, perDir=ctx.oneway?n:Math.max(1,Math.floor(n/2)), extra=ctx.oneway?0:n-perDir*2;
    if(ctx.oneway){ for(let i=0;i<n;i++) push('travel', i===0?'L':(i===n-1?'R':'C'), 0,{h:0,ow:true}); } else { for(let i=0;i<perDir;i++) push('travel','L',0,{h:0}); if(extra) push('travel','C',0,{h:0,turn:true}); for(let i=0;i<perDir;i++) push('travel','R',0,{h:0}); }
    if(sides.includes('R')) facility('R',two?0:1).forEach(([k,w,x])=>push(k,'R',w,x)); else if(park.R) push('park','R',RULES.parking,{h:0});
    push('sw','R',SW,{h:0.15,lock:true});
    const fixed=els.filter(e=>e.k!=='sw'&&e.k!=='travel').reduce((s,e)=>s+e.w,0); const tl=els.filter(e=>e.k==='travel'); const w=(ctx.ctc-fixed)/tl.length; tl.forEach(e=>{ e.w=w; e.min=2.7; e.max=3.5; }); return {els,w}; };
  let r=build({...ctx.park}); if(r.w<2.7) r=build({L:false,R:false});
  if(r.w<2.7 && ctx.lanes>(ctx.oneway?1:2)){ const saved=ctx.lanes; ctx.lanes=ctx.oneway?1:2; r=build({L:false,R:false}); ctx.lanes=saved; }
  if(r.w<2.7) return beforeElements(ctx);   // the recorded width cannot hold the facility at all (bad right-of-way value): show the plain street
  return r.els.map(e=>({...e,w:Math.round(e.w*100)/100}));
}
// x positions
function layout(els){ const total=els.reduce((s,e)=>s+e.w,0); let x=-total/2; els.forEach(e=>{ e.x=x; x+=e.w; }); return total; }

// ── v2: direct editing of the cross-section (drag handles and the element popover in plan / section) ──────────────────
// Every operation keeps the curb-to-curb total: a dragged boundary trades width between its two neighbours; an inserted
// element takes its width from the travel lanes' spare; a removed element gives its width to the nearest travel lane.
const LEVELS=[[0,'street level'],[0.08,'intermediate · +80 mm'],[0.15,'sidewalk level · +150 mm']];
function elLabel(e,ctx){ const side=e.side==='C'?'centre':ctx.lbl[e.side==='L'?0:1];
  return e.k==='sw'?(e.existing?'Existing deck sidewalk (kept) · ':'Sidewalk + boulevard · ')+side:e.k==='bike'?(e.two?'Two-way bike lane':'Bike lane · '+side):e.k==='buf'?'Buffer · '+side:e.k==='park'?'Parking · '+side:e.turn?'Centre turn lane':'Travel lane · '+side; }
function elShort(e){ return e.k==='sw'?(e.existing?'existing sw':'sidewalk'):e.k==='bike'?(e.two?'2-way bike':'bike'):e.k==='buf'?(SEP[e.sep]?SEP[e.sep].name.split(' ')[0].toLowerCase():'buffer'):e.k==='park'?'parking':e.turn?'turn':'travel'; }
// the least an element may be dragged down to (absolute minimums; compliance still flags anything below the normal minimum)
function elFloor(e,els){ if(e.k==='sw') return e.w; if(e.k==='bike') return e.two?RULES.bike.two.abs:RULES.bike.one.abs; if(e.k==='travel') return e.abs||2.7;
  if(e.k==='buf'){ const i=els.indexOf(e); const adj=els[i+(e.side==='L'?1:-1)]; return Math.min(0.4,bufMin(e.sep,adj&&adj.k==='park',e.two?'two':'one')); } if(e.k==='park') return 2.0; return 0.3; }
function headlineSep(o){ const bufs=o.els.filter(e=>e.k==='buf'&&SEP[e.sep]); if(!bufs.length) return o.sep==='shared'?'shared':'paint'; return bufs.reduce((a,b)=>(SEP_RANK[b.sep]||0)<(SEP_RANK[a]||0)?b.sep:a, bufs[0].sep); }
function edMark(o){ if(!o.custom) o.edited=true; o.sep=headlineSep(o); o.els.forEach(e=>{ if(e.k!=='sw') e.side=e.side==='C'?'C':(e.x+e.w/2<0?'L':'R'); }); }
function edDrag(o,i,w0,dx){ const a=o.els[i-1], b=o.els[i]; if(!a||!b||a.k==='sw'||b.k==='sw') return; const fa=elFloor(a,o.els), fb=elFloor(b,o.els);
  let d=clamp(dx, Math.min(0,fa-w0[0]), Math.max(0,w0[1]-fb)); d=Math.round(d*20)/20; a.w=Math.round((w0[0]+d)*100)/100; b.w=Math.round((w0[1]-d)*100)/100; edMark(o); }
// a typed width: the difference is taken from (or given to) the nearest travel lane, so the curb-to-curb total holds
function edSetWidthKeep(o,i,w){ const e=o.els[i]; if(!e||e.k==='sw'||isNaN(w)) return; w=Math.round(clamp(w,elFloor(e,o.els),8)*100)/100; const d=w-e.w; if(Math.abs(d)<0.001) return;
  const tl=o.els.filter(x=>x.k==='travel'&&x!==e); if(tl.length){ const t=tl.reduce((a,b)=>Math.abs(o.els.indexOf(b)-i)<Math.abs(o.els.indexOf(a)-i)?b:a); const room=t.w-elFloor(t,o.els); const g=d>0?Math.min(d,room):d; t.w=Math.round((t.w-g)*100)/100; }
  e.w=w; edMark(o); }
function edSetWidth(o,i,w){ const e=o.els[i]; if(!e||e.k==='sw') return; e.w=Math.round(clamp(w,0.3,8)*100)/100; edMark(o); }
function edSetSep(o,i,sep){ const e=o.els[i]; if(!e||e.k!=='buf'||!SEP[sep]) return; e.sep=sep; e.h=SEP[sep].h; edMark(o); }
function edSetLevel(o,i,h){ const e=o.els[i]; if(!e||e.k==='sw') return; e.h=h; edMark(o); }
// fund a new element's width from whatever has spare above its floor: travel lanes first, then parking, then the bike lanes and buffers
function edTake(o,n,w){ let need=w; const order={travel:0,park:1,bike:2,buf:3};
  for (const kind of ['travel','park','bike','buf']) { const pool=o.els.filter(e=>e!==n&&e.k===kind);
    while(need>0.001&&pool.length){ pool.sort((a,b)=>(b.w-elFloor(b,o.els))-(a.w-elFloor(a,o.els))); const t=pool[0]; const room=t.w-elFloor(t,o.els); if(room<=0.001) break; const g=Math.min(room,need); t.w=Math.round((t.w-g)*100)/100; need-=g; } }
  return need; }   // anything left makes the section over-width, which the compliance check reports
// insert a new element on the 'L' or 'R' side of element i (as drawn); the new one is sized at its minimum
function edInsert(o,i,dir,k){ const ref=o.els.find(e=>e.k==='travel')||{min:2.7,max:3.5,abs:2.7};
  const w=k==='buf'?0.6:k==='park'?RULES.parking:k==='bike'?RULES.bike.one.min:(ref.min||2.7); const at=dir==='L'?i:i+1;
  const n={k,side:'L',w,h:0}; if(k==='buf'){ n.sep='posts'; } if(k==='bike'){ n.dir=-1; } if(k==='travel'){ n.min=ref.min; n.max=ref.max; n.abs=ref.abs; }
  o.els.splice(at,0,n); edTake(o,n,w); layout(o.els); edMark(o); if(k==='bike') n.dir=n.side==='L'?-1:1; return at; }
function edRemove(o,i){ const e=o.els[i]; if(!e||e.k==='sw') return; o.els.splice(i,1); const tl=o.els.filter(x=>x.k==='travel');
  if(tl.length){ const t=tl.reduce((a,b)=>Math.abs(o.els.indexOf(b)-i)<Math.abs(o.els.indexOf(a)-i)?b:a); t.w=Math.round((t.w+e.w)*100)/100; } layout(o.els); edMark(o); }
function edConvert(o,i,k){ const e=o.els[i]; if(!e||e.k==='sw') return; const ref=o.els.find(x=>x.k==='travel')||{min:2.7,max:3.5,abs:2.7};
  if(k==='park') o.els[i]={k:'park',side:e.side,w:e.w,h:0,x:e.x}; else if(k==='travel') o.els[i]={k:'travel',side:e.side,w:e.w,h:0,x:e.x,min:ref.min,max:ref.max,abs:ref.abs};
  else if(k==='bike') o.els[i]={k:'bike',side:e.side,w:e.w,h:0,x:e.x,dir:e.side==='L'?-1:1}; else if(k==='buf') o.els[i]={k:'buf',side:e.side,w:e.w,h:0,x:e.x,sep:'posts'}; edMark(o); }

// ── Existing traffic model of any street, shared by the plan and 3D renderers ─
// Same inference as segContext / beforeElements: lanes from curb-to-curb, parking from meters or
// residential/collector class, lane edges across the street (L = west/north = negative).
// Right-hand traffic: movement in the +z (north/east) direction uses the R half, −z uses the L half.
// One-way streets are flagged in Open Data but their direction is not published.
function laneModel(s){ const ctc=s.ctc, ow=!!s.ow; const osm=s.osm||{}; const lanes=osm.ln?clamp(osm.ln,ow?1:2,6):ow?(ctc>=12?2:1):(ctc>=16?4:2); const owd=osm.owd||0; const resid=s.u==='Residential'||s.u==='Collector'; const pm=s.pm||{L:0,R:0};
  let park={L:pm.L>0||(resid&&ctc>=10), R:pm.R>0||(resid&&ctc>=10)};
  let laneW=(ctc-(park.L?2.5:0)-(park.R?2.5:0))/lanes; if(laneW<2.7){ park={L:false,R:false}; laneW=Math.max(2.7,ctc/lanes); }
  const edges=[]; let x=-ctc/2+(park.L?2.5:0); for(let i=0;i<=lanes;i++){ edges.push(Math.round(x*100)/100); x+=laneW; }
  // two-way: an even lane count splits at the middle edge; an odd count (common in OSM, e.g. 3 or 5) has a centre turn lane,
  // so the centre is the middle of that lane and both of its edges are yellow. yellow = offsets drawn yellow, white = other lane lines.
  const turn = !ow && lanes%2===1 && lanes>=3; const mid=(lanes-1)/2;
  const centre = ow ? null : turn ? (edges[mid]+edges[mid+1])/2 : edges[lanes/2];
  const yellow = ow ? [] : turn ? [edges[mid], edges[mid+1]] : [edges[lanes/2]];
  const white = edges.filter((e,i)=>i>0 && i<lanes && yellow.indexOf(e)<0);
  return {seg:s, n:s.n, u:s.u, spd:s.spd, ctc, row:s.row, ow, owd, lanes, park, laneW, edges, centre, turn, yellow, white, bus:!!s.bus, truck:!!s.truck, bw:s.bw||null, sig:(s.ix||[]).map(e=>!!(e&&e.sig)), stops:s.bst||null, osm:!!s.osm}; }
// compass word for a one-way direction (+1 = +z = north on N–S streets, east on E–W streets)
function owText(s,owd){ if(!owd) return 'one-way (direction not in Open Data or OSM)'; const ns=s.ns; return 'one-way '+(owd>0?(ns?'northbound':'eastbound'):(ns?'southbound':'westbound'))+' (OSM)'; }
// one-line description used for labels in plan and 3D
function trafficLabel(m){ const bits=[m.u, m.spd+' km/h', m.lanes+(m.lanes>1?' lanes':' lane')+(m.osm&&m.seg.osm.ln?' (OSM)':'')+(m.ow?' '+owText(m.seg,m.owd):' two-way')];
  if(m.park.L||m.park.R) bits.push('parking '+(m.park.L&&m.park.R?'both sides':'one side')); if(m.bus) bits.push('bus route'); if(m.truck) bits.push('truck route');
  if(m.bw) bits.push('existing '+m.bw.t.toLowerCase()+(m.bw.dir==='Bidirectional'?' (two-way)':m.bw.dir==='2W'?' (each side)':m.bw.dir==='OW'?' (one side)':m.bw.dir==='CFlow'?' (contra-flow)':'')); return bits.join(' · '); }
// cut t0 / t1 metres off the start / end of a polyline (the junctions), keeping interior vertices
function trimLine(g, t0, t1){ if(t1===undefined) t1=t0; const len=[0]; for(let i=1;i<g.length;i++) len.push(len[i-1]+Math.hypot(g[i][0]-g[i-1][0],g[i][1]-g[i-1][1])); const L=len[len.length-1]; if(L<=t0+t1+0.5) return [];
  const at=d=>{ for(let i=1;i<g.length;i++){ if(len[i]>=d){ const f=(d-len[i-1])/((len[i]-len[i-1])||1); return [g[i-1][0]+(g[i][0]-g[i-1][0])*f, g[i-1][1]+(g[i][1]-g[i-1][1])*f]; } } return g[g.length-1]; };
  const out=[at(t0)]; for(let i=1;i<g.length-1;i++){ if(len[i]>t0&&len[i]<L-t1) out.push(g[i]); } out.push(at(L-t1)); return out; }
// extend a polyline straight out by e0 / e1 metres at its ends (pavement runs to the far curb of the crossing street)
function extendLine(g, e0, e1){ if(g.length<2) return g; const out=g.slice(); const a=g[0], b=g[1]; let L=Math.hypot(b[0]-a[0],b[1]-a[1])||1; if(e0) out[0]=[a[0]-(b[0]-a[0])/L*e0, a[1]-(b[1]-a[1])/L*e0];
  const c=g[g.length-2], d=g[g.length-1]; L=Math.hypot(d[0]-c[0],d[1]-c[1])||1; if(e1) out[out.length-1]=[d[0]+(d[0]-c[0])/L*e1, d[1]+(d[1]-c[1])/L*e1]; return out; }
// pavement markings of a surrounding street from its traffic model, in the local frame:
//   centre  — yellow centreline (two-way streets)      lane — dashed white lane line (multi-lane, or the one-way centre)
//   park    — faint edge of a parking lane
function streetMarkings(st){ const m=st.m; const out=[]; const tr=st.trim||[8,8]; const cr=st.cross||[true,true];
  const bar=st.bar||[0,0];   // v2: at a junction the lines and stop bar end 1 m behind the crossing street's sidewalk, not inside its crosswalk
  const g=trimLine(st.g, cr[0]?Math.max(tr[0]+1.5,bar[0]):0, cr[1]?Math.max(tr[1]+1.5,bar[1]):0); if(g.length<2) return out;   // markings stop 1.5 m short of a junction only; where the street simply carries on they run through
  // stop bars where a two-way street meets a crossing street: traffic arriving at end 1 travels +along and keeps to the
  // R half (positive offsets), traffic arriving at end 0 travels −along and keeps to the L half (negative offsets)
  // one-way streets with a known direction (OSM) get one full-width bar at the end they travel towards
  if(st.cross && (!m.ow ? m.lanes>=2 : !!m.owd)){ [0,1].forEach(k=>{ if(!st.cross[k]) return; if(m.ow && (m.owd>0?1:0)!==k) return; const p=k?g[g.length-1]:g[0], q=k?g[g.length-2]:g[1];
      let dx=k?p[0]-q[0]:q[0]-p[0], dz=k?p[1]-q[1]:q[1]-p[1]; const L=Math.hypot(dx,dz)||1; dx/=L; dz/=L;      // +along direction at this end
      const inx=k?-dx:dx, inz=k?-dz:dz;                                                                    // pointing into the street
      const c=[p[0]+inx*0.65, p[1]+inz*0.65]; const oa=m.ow?m.edges[0]+0.15:k?m.centre+0.15:m.edges[0]+0.15, ob=m.ow?m.edges[m.lanes]-0.15:k?m.edges[m.lanes]-0.15:m.centre-0.15;
      const P=o=>[c[0]+dz*o, c[1]-dx*o]; out.push({kind:'stop', g:[P(oa),P(ob)], w:0.5}); }); }
  if(m.lanes>=2) m.yellow.forEach(e=>out.push({kind:'centre', g:offsetLine(g,e), w:0.12}));
  m.white.forEach(e=>out.push({kind:'lane', g:offsetLine(g,e), w:0.12, dash:[2,3.5]}));
  if(m.park.L) out.push({kind:'park', g:offsetLine(g,m.edges[0]), w:0.1}); if(m.park.R) out.push({kind:'park', g:offsetLine(g,m.edges[m.lanes]), w:0.1});
  return out; }
// points every `sp` metres along a polyline (for sharrow symbols, posts), with the local direction
function alongLine(g, sp, start){ const out=[]; let carry=start||sp/2; for(let i=1;i<g.length;i++){ const [ax,az]=g[i-1],[bx,bz]=g[i]; const L=Math.hypot(bx-ax,bz-az); if(L<1e-6) continue; const ux=(bx-ax)/L, uz=(bz-az)/L; let t=carry; while(t<L){ out.push([ax+ux*t, az+uz*t, ux, uz]); t+=sp; } carry=t-L; } return out; }
// clip a polyline to an axis-aligned box {x0,x1,z0,z1}; returns the pieces inside (Liang–Barsky per segment)
function clipPoly(g, B){ const out=[]; let cur=null;
  for(let i=1;i<g.length;i++){ let [ax,az]=g[i-1], [bx,bz]=g[i]; const dx=bx-ax, dz=bz-az; let t0=0, t1=1; let ok=true;
    [[-dx, ax-B.x0],[dx, B.x1-ax],[-dz, az-B.z0],[dz, B.z1-az]].forEach(([p,q])=>{ if(!ok) return; if(p===0){ if(q<0) ok=false; return; } const r=q/p; if(p<0){ if(r>t1) ok=false; else if(r>t0) t0=r; } else { if(r<t0) ok=false; else if(r<t1) t1=r; } });
    if(!ok){ cur=null; continue; }
    const P=[ax+dx*t0, az+dz*t0], Q=[ax+dx*t1, az+dz*t1];
    if(cur && t0===0) cur.push(Q); else { cur=[P,Q]; out.push(cur); }
    if(t1<1) cur=null; }
  return out.filter(p=>p.length>1); }
// existing street trees on a surrounding street (public-trees per block side: count, spacing, median height / trunk diameter;
// no positions are published, so they are spaced evenly along the boulevard nearest the curb, the same rule as on the block)
// v3: a tree is never placed on a carriageway — not on another street's (a divided road's twin, a ramp beside its street, an
// intersection) and not on its own where the recorded curb-to-curb is too narrow for the real road (the tree sits at least
// 4.5 m from the centreline, a lane and a half), and none on a structure
function streetTrees(st, streets){ const tr=st.s.tr; if(!tr||st.up||st.lvl>0) return []; const m=st.m; const out=[]; const band=trimLine(st.g, st.trim?st.trim[0]:0, st.trim?st.trim[1]:0); if(band.length<2) return out;
  const swW=Math.max(1.5,(st.row-m.ctc)/2); const half=Math.max(m.ctc/2, 4.5);
  const onRoad=p=>(streets||[]).some(o=>o!==st && o.m && alongOnPoly(o.g,p)[0]<o.m.ctc/2+0.8);
  ['L','R'].forEach(sd=>{ const t=tr[sd]; if(!t||!t.n) return; const sp=Math.max(6,t.sp||8); const off=(sd==='L'?-1:1)*(half+swW*0.3);
    alongLine(offsetLine(band,off), sp, sp/2).forEach(([x,z])=>{ if(!onRoad([x,z])) out.push({x,z,h:t.h||7,d:t.d||15}); }); });
  return out; }
// orient a polyline so it runs S→N (or W→E), like the street segments
function fwdOrient(g){ const a=g[0], b=g[g.length-1]; const dx=b[0]-a[0], dy=b[1]-a[1]; const fwd = Math.abs(dy)>=Math.abs(dx) ? dy>=0 : dx>=0; return fwd ? g : g.slice().reverse(); }
// offset a polyline laterally: off<0 → left of travel (west/north side), off>0 → right
function offsetLine(g, off){ const n=g.length; if(n<2) return g.slice(); const out=[];
  for(let i=0;i<n;i++){ const p=g[i]; const a=g[Math.max(0,i-1)], b=g[Math.min(n-1,i+1)]; let dx=b[0]-a[0], dz=b[1]-a[1]; const L=Math.hypot(dx,dz)||1; dx/=L; dz/=L; out.push([p[0]+dz*off, p[1]-dx*off]); } return out; }
// where an existing facility sits across its street: CoV publishes centreline geometry only, so the
// lateral position is derived from type + direction (+ which direction has the facility, wn/es).
//   returns [{off, w, kind, two, dir}]  off = lateral offset of the lane centre, kind: prot | paint | shared
//   v2: the side comes from OpenStreetMap's cycleway:left / cycleway:right tags on the matched way where they exist (b.side,
//   via facilitySide), then from continuity with an adjoining collinear piece, and only then from the type/direction guess.
function facilitySide(seg){ if(seg&&seg.bwSide) return seg.bwSide;   // v3: the side the user set for a one-side facility
  const cw=seg&&seg.osm&&seg.osm.cw; if(!cw) return null; const yes=v=>!!v&&v!=='no'&&v!=='shoulder'; const L=yes(cw.L), R=yes(cw.R); return L&&!R?'L':R&&!L?'R':L&&R?'both':null; }
function bikewayLanes(b, ctc, sideHint){ const t=b.t, d=b.d; const sd=(b.side==='L'||b.side==='R')?b.side:null;
  const half=ctc/2, prot=1.8, paint=1.5, buf=0.6;
  const has=sd=>{ const v=sd==='L'?b.es:b.wn; return v===undefined || (v && v!=='nan' && v!=='None'); };   // E/S-bound uses the L side, W/N-bound the R side
  if (t==='Protected Bike Lanes' || t==='Painted Lanes') { const w=t==='Protected Bike Lanes'?prot:paint, bf=t==='Protected Bike Lanes'?buf:0.15, kind=t==='Protected Bike Lanes'?'prot':'paint';
    if (d==='Bidirectional') { const w2=3.0; const s2=sd||sideHint||'L'; return [{off:(s2==='L'?-1:1)*(half-bf-w2/2), w:w2, kind, two:true, dir:0}]; }
    if (d==='OW' && sd) return [sd==='L' ? {off:-(half-bf-w/2), w, kind, dir:-1} : {off:(half-bf-w/2), w, kind, dir:1}];
    const out=[]; if(d!=='OW'||has('L')) out.push({off:-(half-bf-w/2), w, kind, dir:-1}); if(d!=='OW'||has('R')) out.push({off:(half-bf-w/2), w, kind, dir:1}); if(!out.length) out.push({off:-(half-bf-w/2), w, kind, dir:-1}); return out; }
  return [{off:0, w:ctc, kind:'shared', dir:0}];   // Local Street bikeway / Shared Lanes: sharrows in the travel lanes
}

// ── How a protected bike lane ends at a cross street (CoV EDM 2026) ──────────
// Distances are measured from the cross street's projected curb line into the block. Both renderers use this.
const IX = {
  cwInset: 0.6, cwW: 3.0, cwLine: 0.2,   // marked crosswalk: two 0.2 m lines 3.0 m apart, nearest line ≥0.6 m from the curb line; signalised intersections only (§8.8.1.7)
  bikeBarClear: 0.5, bikeBarW: 0.3,      // bicycle stop bar 0.3 m wide, parallel to the cross street, 0.5 m clear of the crosswalk / travelled edge (§8.9.1.8)
  carBarBack: 2.0, carBarW: 0.3,         // vehicle stop bar ≥2.0 m behind the bicycle stop bar (§8.9.1.8)
  setback: 6.0,                          // physical protection ends and the corner island runs 6 m back: one vehicle length of stacking (BC Parkway Guide §4.5.2, p.63)
  ee: 0.5, eeGap: 0.5,                   // elephant's feet: 0.5 m squares, 0.5 m gaps, both edges of the crossing (TAC MUTCDC; EDM Table 8-19)
  ddlDash: 1.0, ddlGap: 3.0, ddlSolid: 10,   // two-way lane dividing line: 1.0 m yellow dashes / 3.0 m gaps, solid for 10 m before a pedestrian crossing (§8.9.1.11)
};
// offsets from the curb line for one end: crosswalk band, bicycle stop bar, vehicle stop bar, where lane markings start, corner island
function endLayout(hasCW){ const cw0 = hasCW ? IX.cwInset : 0, cw1 = hasCW ? IX.cwInset+IX.cwW : 0;
  const bb0 = cw1 + (hasCW ? IX.bikeBarClear : 0.5), bb1 = bb0 + IX.bikeBarW; const vb0 = bb1 + IX.carBarBack, vb1 = vb0 + IX.carBarW;
  return {hasCW, cw0, cw1, bb0, bb1, vb0, vb1, bikeStart: bb1+0.2, carStart: vb1+0.5, isl0: 0.3, isl1: IX.setback}; }
// green in the crossing only where turning conflicts exist: a cross street that carries through traffic (§8.9.1.12, Table 8-18)
function crossingGreen(crossSeg){ return !!crossSeg && crossSeg.u!=='Residential'; }

// ── Intersection extents: where the block's section must stop ───────────────
// The cross street's pavement belongs to the intersection, so our cross-section
// runs only between the cross-street curb lines. Widths come from the ROW of the
// streets meeting each end (CoV publishes no curb lines or corner geometry).
const XW_CACHE={};
// For each end of the block, work out what is actually there:
//   'cross'    — another street meets it: the section stops at that street's curb line
//   'continue' — the same street carries on: the section runs straight through
//   'dead'     — nothing connects: a dead end, drawn closed
function endInfo(s){ if(XW_CACHE[s.i]) return XW_CACHE[s.i];
  const ends=[s.g[0], s.g[s.g.length-1]];
  const ov=[s.g[s.g.length-1][0]-s.g[0][0], s.g[s.g.length-1][1]-s.g[0][1]]; const nv=Math.hypot(ov[0],ov[1])||1;
  const out=ends.map(()=>({type:'dead', w:20.1, names:[], segs:[], cont:[], under:[], over:[]}));
  SEGS.forEach(o=>{ if(o.i===s.i) return;
    const od=[o.g[o.g.length-1][0]-o.g[0][0], o.g[o.g.length-1][1]-o.g[0][1]]; const no=Math.hypot(od[0],od[1])||1;
    const cosang=Math.abs((ov[0]*od[0]+ov[1]*od[1])/(nv*no));
    const oe=[o.g[0], o.g[o.g.length-1]];
    ends.forEach((p,k)=>{ const ko=oe.findIndex(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<26); const touches=ko>=0;
      if(!touches) return;
      // v2: a crossing street at another level here does not meet this one — it passes beneath (or over) the deck: no junction.
      // A street that carries on (same street, or collinear) is the same road surface whatever its tag says: a deck's approach
      const isCont = cosang>0.80 || o.s===s.s;
      const lo=nodeH(o,ko), ls=nodeH(s,k); if(!isCont && Math.abs(lo-ls)>0.5){ (lo<ls?out[k].under:out[k].over).push(o); return; }
      if (isCont) { // roughly collinear, or the same street carrying on round a bend
        out[k].cont.push(o);
        if (out[k].type!=='cross') { out[k].type='continue'; out[k].w=Math.max(out[k].w,o.row); if(o.s!==s.s&&out[k].names.indexOf(o.s)<0) out[k].names.push(o.s); }
      } else { out[k].segs.push(o); out[k].type='cross'; out[k].w=Math.max(out[k].w===20.1&&out[k].type!=='cross'?0:out[k].w, o.row); if(out[k].names.indexOf(o.s)<0) out[k].names.push(o.s); }
    }); });
  out.forEach(e=>{ if(e.type==='cross'&&(!e.w||e.w<8)) e.w=20.1; });
  // v2: an end with nothing at its node that lies INSIDE another street's carriageway at the same level (the City maps the
  // Granville connector as its own piece on top of the bridge deck) carries on along that street: a continuation, not a dead end
  out.forEach((e,k)=>{ if(e.type!=='dead') return; const p=ends[k]; const hs=nodeH(s,k);
    const host=SEGS.find(o=>{ if(o.i===s.i||o.s===s.s&&false) return false; const xs=o.g.map(q=>q[0]), ys=o.g.map(q=>q[1]); const r=o.ctc/2; if(p[0]<Math.min(...xs)-r||p[0]>Math.max(...xs)+r||p[1]<Math.min(...ys)-r||p[1]>Math.max(...ys)+r) return false;
      const [d,at]=alongOnPoly(o.g,p); if(d>=r) return false; const L=plen(o.g); if(at<8||at>L-8) return false; return Math.abs(lvlOf(o)*6-hs)<0.5; });
    if(host){ e.type='continue'; e.cont=[host]; e.w=Math.max(e.w,host.row); if(host.s!==s.s) e.names.push(host.s); } });
  // v2: a dead end where the same street starts again 14–45 m on, with a structure standing over the gap (the City breaks
  // some centrelines at a bridge or viaduct) — the street runs on beneath it: a continuation, with the structure noted
  out.forEach((e,k)=>{ if(e.type!=='dead') return; const p=ends[k];
    const same=SEGS.find(o=>o.i!==s.i&&o.s===s.s&&[o.g[0],o.g[o.g.length-1]].some(q=>{ const d=Math.hypot(q[0]-p[0],q[1]-p[1]); return d>=14&&d<45; })); if(!same) return;
    const q=[same.g[0],same.g[same.g.length-1]].reduce((a,b)=>Math.hypot(b[0]-p[0],b[1]-p[1])<Math.hypot(a[0]-p[0],a[1]-p[1])?b:a); const mid=[(p[0]+q[0])/2,(p[1]+q[1])/2];
    const deck=SEGS.find(o=>lvlOf(o)>0&&o.i!==s.i&&nearOnPoly(mid,o.g)[0]<o.ctc/2+2); if(!deck) return;
    e.type='continue'; e.cont=[same]; e.under.push(deck); e.gapUnder=deck; });
  // v2: the reviewer's verdicts (data/overrides.json, from audit.html) override what the data implies at this end — applied
  // before the path search ('under' / 'continue' change the end type) and again after it ('dead' / no loop stick)
  const OV=(DATA.overrides||{})[s.i]; const applyOv=(e,k,late)=>{ const o=OV&&OV[k]; if(!o) return; e.ov=o; const p=ends[k];
    if(o.loop===false) e.loop=null;
    if(o.type==='dead'){ e.type='dead'; e.segs=[]; e.cont=[]; e.path=null; }
    if(late) return;
    if(o.type==='under'){ e.under=[...e.under,...e.segs]; e.segs=[]; e.names=[]; e.type=e.cont.length?'continue':'dead'; e.path=null; }
    else if(o.type==='junction'){ const xs=[...e.segs,...e.under,...e.over]; if(!xs.length) return; e.segs=xs; e.under=[]; e.over=[]; e.type='cross'; e.w=Math.max(8,...xs.map(x=>x.row)); e.names=[...new Set(xs.map(x=>x.s))]; e.path=null; e.loop=null; }
    else if(o.type==='continue'){ if(e.type!=='continue'){ const endD=q=>Math.min(...[q.g[0],q.g[q.g.length-1]].map(x=>Math.hypot(x[0]-p[0],x[1]-p[1])));
        const same=SEGS.find(q=>q.i!==s.i&&q.s===s.s&&endD(q)<60) || SEGS.filter(q=>q.i!==s.i&&endD(q)<20).sort((a,b)=>endD(a)-endD(b))[0];   // same street first, else the nearest street end
        e.type='continue'; e.segs=[]; if(same){ e.cont=[same]; e.w=Math.max(e.w,same.row); if(same.s!==s.s&&e.names.indexOf(same.s)<0) e.names.push(same.s); } e.path=null; e.loop=null; } } };
  out.forEach((e,k)=>applyOv(e,k,false));
  // v2: a dead end where a public path carries a cyclist on is a 'path' end, not a stop. The street still ends for cars (and may
  // end in a turnaround loop, from OSM: 0 Smithe St loops round the pandas sculpture). The path must leave the block — beyond its
  // end or outside its right-of-way — so a cycle track mapped alongside the block does not count. OSM first (designated
  // cycleways preferred), then the City's off-street bikeways.
  out.forEach((e,k)=>{ if(e.type!=='dead') return; const p=ends[k]; const F=localFrame(s);
    const beyond=q=>{ const [x,z]=F.toLocal(q[0],q[1]); return (k? z>s.len+4 : z<-4) || Math.abs(x)>s.row/2+2; };
    let lp=null; (DATA.loops||[]).forEach(l=>{ const [d]=nearOnPoly(p,l.g); if(d<25&&(!lp||d<lp.d)) lp={l,d}; }); if(lp){ e.loop=lp.l.g; e.loopRec=lp.l; }
    // a public plaza (OSM pedestrian area) that the end or its loop opens onto also carries the cyclist across to a path beyond it
    // (a loop's outer curb and sidewalk take ~8–10 m, so a path within 15 m of the loop road opens off it; a plaza within 20 m)
    const touchesEnd=ring=>nearOnPoly(p,ring)[0]<10 || (lp && lp.l.g.some(v=>nearOnPoly(v,ring)[0]<20));
    const plz=(DATA.plazas||[]).filter(r=>Math.hypot(r[0][0]-p[0],r[0][1]-p[1])<400 && touchesEnd(r));
    const cand=pathsNear(p, (lp||plz.length)?60:15).filter(c=>c.p.g.some(beyond) && (c.d<15 || (lp && c.p.g.some(v=>nearOnPoly(v,lp.l.g)[0]<15)) || plz.some(r=>c.p.g.some(v=>nearOnPoly(v,r)[0]<5))));
    if(plz.length) e.plaza=plz[0];
    cand.sort((a,b)=>((b.p.des?1:0)-(a.p.des?1:0)) || a.d-b.d);
    if(cand.length){ const c=cand[0]; e.type='path'; e.path={g:c.p.g, n:c.p.n||null, des:!!c.p.des, ow:!!c.p.ow, src:'OSM'}; }
    else { const b=BW.find(b=>(b.st==='Off-street'||b.sub==='OSB'||b.sub==='OSS') && nearOnPoly(p,b.g)[0]<15);
      if(b){ e.type='path'; e.path={g:b.g, n:b.r||b.n||null, des:true, ow:b.d==='OW', src:'CoV'}; } } });
  out.forEach((e,k)=>applyOv(e,k,true));
  XW_CACHE[s.i]=out; return out; }
const isStop=e=>e.type==='dead'||e.type==='path';   // the street ends for cars
function crossWidths(s){ return endInfo(s).map(e=>e.w); }

// ── City context in the block's local frame (x across, z along) ───────────
const CTX_CACHE={id:null};
function localFrame(s){ const P0=s.g[0], P1=s.g[s.g.length-1]; const dx=P1[0]-P0[0], dy=P1[1]-P0[1], L=Math.hypot(dx,dy)||1; const u=[dx/L,dy/L];
  return { P0, u, toLocal:(x,y)=>{ const rx=x-P0[0], ry=y-P0[1]; return [ rx*u[1]-ry*u[0], rx*u[0]+ry*u[1] ]; },
           toWorld:(lx,lz)=>[ P0[0] + lz*u[0] + lx*u[1], P0[1] + lz*u[1] - lx*u[0] ],
           ang:Math.atan2(u[1],u[0]), len:L }; }
// which side of street o (L = left of its drawing direction, R = right) each crossing street at end k leaves on, and how far
// the sidewalk / curb must stop short there (that street's half carriageway, ≥ 3 m); a side with no crossing street gets 0
function endSides(o,k,cross){ const n=o.g.length, p=k?o.g[n-1]:o.g[0], q=k?o.g[n-2]:o.g[1]; let dx=k?p[0]-q[0]:q[0]-p[0], dy=k?p[1]-q[1]:q[1]-p[1]; const L=Math.hypot(dx,dy)||1; dx/=L; dy/=L;
  // bar: where the stop bar and lane lines end — 1 m behind the crossing street's sidewalk (its crosswalk)
  const out={L:0,R:0,bar:0}; cross.forEach(x=>{ const t=Math.max(3,(x.row-7.2)/2); out.bar=Math.max(out.bar, x.row/2+1.0); const a=x.g[0], b=x.g[x.g.length-1]; const far=Math.hypot(a[0]-p[0],a[1]-p[1])>Math.hypot(b[0]-p[0],b[1]-p[1])?a:b;
    const side=((far[0]-p[0])*dy-(far[1]-p[1])*dx)>0?'R':'L'; out[side]=Math.max(out[side],t); }); return out; }
// the legs of the proposed block's cross street at end i, in the block's local frame: L / R = how far that leg reaches
// (its far end's x), null when the cross street does not continue on that side (a T-junction)
function endLegs(s,i){ const F=localFrame(s); const e=endInfo(s)[i]; const out={L:null,R:null}; if(e.type!=='cross') return out;
  const node=F.toLocal(...(i?s.g[s.g.length-1]:s.g[0]));
  (e.segs||[]).forEach(o=>{ const a=F.toLocal(...o.g[0]), b=F.toLocal(...o.g[o.g.length-1]); const far=Math.hypot(a[0]-node[0],a[1]-node[1])>Math.hypot(b[0]-node[0],b[1]-node[1])?a:b;
    if(far[0]<-2) out.L=Math.min(out.L==null?0:out.L, far[0]); else if(far[0]>2) out.R=Math.max(out.R==null?0:out.R, far[0]); });
  if(out.L==null&&out.R==null){ out.L=-1e4; out.R=1e4; }   // no geometry to judge by: treat as a full crossing
  return out; }
// deck height of an elevated context street at a point (its end / mid / end heights, straight between)
function deckAtSt(st,x,z){ if(!st||!st.deck) return 0; const a=alongOnPoly(st.g,[x,z])[1], L=st.L||1;
  if(st.prof&&st.prof.k){ const k=st.prof.k; if(a<=k[0][0]) return k[0][1]; for(let i=1;i<k.length;i++){ if(a<=k[i][0]){ const [a_,h_]=k[i-1], [b_,g_]=k[i]; return h_+(g_-h_)*((a-a_)/((b_-a_)||1)); } } return k[k.length-1][1]; }   // v3: a knotted profile (a deck landing at both ends: up, level, down)
  if(st.prof){ const {h0,a0,h1,a1}=st.prof; return a<=a0 ? h0 : a>=a1 ? h1 : h0+(h1-h0)*((a-a0)/((a1-a0)||1)); }   // level while on the deck, then one grade
  const [h0,hm,h1]=st.deck; return a<L/2 ? h0+(hm-h0)*(a/(L/2)) : hm+(h1-hm)*((a-L/2)/(L/2)); }
// ── v3: one continuous structure surface — ramps taper into their deck, hosted pieces are not drawn twice ──────────────
// A structure's drawn band: a bridge carries a sidewalk (up to 2.25 m a side), a one-way ramp only its parapet (0.6 m)
function structBandW(st){ return st.m.ow ? st.m.ctc+1.2 : Math.min(st.row, st.m.ctc+4.5); }
// a structure's carriageway width: the right-of-way points do not describe a deck (the Cambie carriageways are recorded at
// 2.9 m, the Granville deck at 12.9 m), so an elevated piece takes lanes × 3.3 m + 0.6 m shoulders from its OSM lane count
// (structlanes.py) where that is wider, and a piece under 6 m with no lane count one lane (one-way) or two
function structCtc(s){ if(!isUpSeg(s)) return s.ctc; const ln=(s.osm&&s.osm.ln)||0; const med=(s.osm&&s.osm.div)?2.0:0;   // a divided deck carries a median between its carriageways
  // v3: with a lane count the carriageway IS its lanes, wider or narrower than the right-of-way value (the Seymour and Howe ramps
  // of the Granville Bridge are recorded at 17.2 m for two lanes); a one-way ramp with no count is two lanes (a viaduct keeps its value)
  if(ln) return Math.round((ln*3.3+0.6+med)*10)/10; if(s.ctc<6) return Math.round(((s.ow?1:2)*3.3+0.6)*10)/10; if(s.ow&&s.ctc>9&&!/VIADUCT/.test(s.n)) return 7.2; return s.ctc; }
function resampleLine(g,n){ if(g.length<2) return g; const L=[0]; for(let i=1;i<g.length;i++) L.push(L[i-1]+Math.hypot(g[i][0]-g[i-1][0],g[i][1]-g[i-1][1])); const T=L[L.length-1]; const out=[]; let j=1;
  for(let k=0;k<n;k++){ const t=T*k/(n-1); while(j<g.length-1&&L[j]<t) j++; const a=g[j-1], b=g[j]; const u=(L[j]-L[j-1])>0?(t-L[j-1])/(L[j]-L[j-1]):0; out.push([a[0]+(b[0]-a[0])*u, a[1]+(b[1]-a[1])*u]); } return out; }
function pointAlong(g,t){ let acc=0; for(let i=1;i<g.length;i++){ const a=g[i-1], b=g[i]; const d=Math.hypot(b[0]-a[0],b[1]-a[1]); if(acc+d>=t){ const u=d?(t-acc)/d:0; return [a[0]+(b[0]-a[0])*u, a[1]+(b[1]-a[1])*u]; } acc+=d; } return g[g.length-1]; }
// which wider deck at the same level a structure's end k lies in (its carriageway, within 3 m): the deck it merges into
function mergeDeckAt(streets, st, k){ const g=st.g; const p=g[k?g.length-1:0], q=g[k?g.length-2:1]; const hEnd=st.deck?st.deck[k?2:0]:0; const away=[q[0]-p[0],q[1]-p[1]], aL=Math.hypot(away[0],away[1])||1; let best=null;
  // the direction a piece's body lies in from the node, for a piece with an end at the node
  const bodyDir=o=>{ const a=alongOnPoly(o.g,p)[1], L=plen(o.g); if(a>=6&&a<=L-6) return null; const inw=pointAlong(o.g, a<6?Math.min(L,12):Math.max(0,L-12)); const v=[inw[0]-p[0],inw[1]-p[1]], vL=Math.hypot(v[0],v[1])||1; return [v[0]/vL,v[1]/vL]; };
  // v3: a ramp that forks off a ramp of the same width (the Granville Bridge's southbound ramp splits into the Fir St and 4th
  // Avenue ramps) merges into the piece beyond the node when it has a sibling there — another piece leaving on its side
  const hasSibling=()=>streets.some(x=>{ if(x===st||!x.deck||x.host2) return false; const q=x.g[0], r=x.g[x.g.length-1]; if(Math.hypot(q[0]-p[0],q[1]-p[1])>6&&Math.hypot(r[0]-p[0],r[1]-p[1])>6) return false; const bd=bodyDir(x); return !!bd && (bd[0]*away[0]+bd[1]*away[1])/aL>0.3; });
  streets.forEach(o=>{ if(o===st||!o.deck||o.host2) return; const wider=o.m.ctc>st.m.ctc+0.5; if(!wider&&Math.abs(o.m.ctc-st.m.ctc)>0.5) return; const d=nearOnPoly(p,o.g)[0]; if(d>o.m.ctc/2+3) return; if(Math.abs(deckAtSt(o,p[0],p[1])-hEnd)>1.5) return;
    // v3: at a node where two deck pieces meet, the ramp runs on from the one whose body lies beyond the node (the piece its
    // traffic shares — an off-ramp's deceleration lane lies on the deck before the split, an on-ramp's merge on the deck after it)
    let score=1.5; const bd=bodyDir(o); if(bd) score=-(bd[0]*away[0]+bd[1]*away[1])/aL;
    if(!wider && !(score>0.3 && hasSibling())) return;
    const key=score*10-d; if(!best||key>best.key) best={o,key}; });
  return best?best.o:null; }
// the left / right edges of a structure at half-width hw. At an end that merges into a deck the centreline is run on to the
// deck's centreline (so the piece never stops at the deck's edge with a step) and the OUTER edge is replaced by a quadratic
// curve tangent to the ramp's edge and to the deck's edge (halfDeck(o) gives the deck's half-width for this edge kind): the
// join tapers like a real gore, the inner edge disappears inside the deck.
// offset a polyline by an offset that varies along it (offAt(a), a = metres from the start), resampled every 4 m so a taper is smooth
function offsetLineVar(g, offAt){ const gg=resampleLine(g, Math.max(2, Math.ceil(plen(g)/4)+1)); const n=gg.length; const out=[]; let acc=0;
  for(let i=0;i<n;i++){ if(i) acc+=Math.hypot(gg[i][0]-gg[i-1][0],gg[i][1]-gg[i-1][1]); const p=gg[i]; const a=gg[Math.max(0,i-1)], b=gg[Math.min(n-1,i+1)]; let dx=b[0]-a[0], dz=b[1]-a[1]; const L=Math.hypot(dx,dz)||1; dx/=L; dz/=L; const off=offAt(acc); out.push([p[0]+dz*off, p[1]-dx*off]); } return out; }
// the half-width of a structure along its length: its own width, tapering over 40 m to the width of the narrower piece it
// continues into at either end (a lane drop or an added lane is a taper on the wider piece, never a step at the node —
// TAC / AASHTO merge geometry; 40 m is the taper a 3.3 m lane takes at the tool's scale)
const TAPER_L=50;   // a 3.3 m lane dropped over 50 m (~15:1; TAC / AASHTO give 50:1–70:1 at freeway speed, 15:1–25:1 at the 50 km/h of the city's bridges)
function widthFn(st, hw, targets){ return a=>{ let w=hw; const L=st.L||plen(st.g);
  [0,1].forEach(k=>{ const t=targets[k]; if(t==null||t>=hw-0.2) return; const d=k?L-a:a; if(d<TAPER_L) w=Math.min(w, t+(hw-t)*Math.max(0,d)/TAPER_L); }); return w; }; }
function structEdges(st, hw, halfDeck, hwFn){ const g=st.gx||st.g; const ext0=st.ext0||0; const Lf=st.L||plen(st.g); const wOf=f=>f?(a=>f(clamp(a-ext0,0,Lf))):(()=>hw); const wL=wOf(hwFn&&hwFn.L?hwFn.L:hwFn), wR=wOf(hwFn&&hwFn.R?hwFn.R:hwFn);   // v3: a width function per side (no taper on the side a ramp joins)
  let L=offsetLineVar(g,a=>-wL(a)), R=offsetLineVar(g,a=>wR(a)); let taper=false; const merges=[];
  [0,1].forEach(k=>{ const o=st.merge&&st.merge[k]; if(!o) return; const dh=halfDeck(o);
    const gk=k?g:g.slice().reverse(); let Lk=k?L:L.slice().reverse(), Rk=k?R:R.slice().reverse(); const n=gk.length; const p=gk[n-1];
    const total=plen(gk); if(total<25) return;
    const back=t=>pointAlong(gk.slice().reverse(), t);   // t metres back from the merge end, on the centreline
    const bp=back(12); const dOff=[Lk,Rk].map(E=>nearOnPoly(pointAlong(E.slice().reverse(),12),o.g)[0]); const outerL=dOff[0]>dOff[1]; const E=outerL?Lk:Rk;
    const cand=[offsetLine(o.g,-dh), offsetLine(o.g,dh)]; const ep=pointAlong(E.slice().reverse(),12); const ED=nearOnPoly(ep,cand[0])[0]<nearOnPoly(ep,cand[1])[0]?cand[0]:cand[1];
    // A: on the outer edge, the last point (coming from the far end) still clear of the deck's band, at least 10 m back
    const Erev=E.slice().reverse(); const EL=plen(E); let tA=10; for(let t=10;t<Math.min(EL-4,80);t+=2){ if(nearOnPoly(pointAlong(Erev,t),o.g)[0]>dh+3){ tA=t; break; } } const A=pointAlong(Erev,tA);
    // r: the ramp's direction into the node; u: the deck's direction there, turned to run with r; B: on the deck edge 30 m on
    const q=back(6); const rL=Math.hypot(p[0]-q[0],p[1]-q[1])||1; const r=[(p[0]-q[0])/rL,(p[1]-q[1])/rL];
    const aP=alongOnPoly(o.g,p)[1]; const q1=pointAlong(o.g,Math.max(0,aP-3)), q2=pointAlong(o.g,Math.min(plen(o.g),aP+3)); let u=[q2[0]-q1[0],q2[1]-q1[1]]; const uL=Math.hypot(u[0],u[1])||1; u=[u[0]/uL,u[1]/uL]; if(u[0]*r[0]+u[1]*r[1]<0) u=[-u[0],-u[1]];
    const aB=alongOnPoly(ED,pointAlong(o.g,aP))[1]; const dirB=(u[0]*(ED[ED.length-1][0]-ED[0][0])+u[1]*(ED[ED.length-1][1]-ED[0][1]))>=0?1:-1; const MERGE_L=60; const B=pointAlong(ED, clamp(aB+dirB*MERGE_L, 0, plen(ED)));   // the acceleration / deceleration lane closes over 60 m (parallel-type ramp terminal, TAC ch. 10 / AASHTO ch. 10, at 50 km/h)
    // C: where the two tangents meet (fallback: midway)
    const den=r[0]*(-u[1])-r[1]*(-u[0]); let C; if(Math.abs(den)>1e-6){ const dx=B[0]-A[0], dy=B[1]-A[1]; const s1=(dx*(-u[1])-dy*(-u[0]))/den; C=[A[0]+r[0]*s1, A[1]+r[1]*s1]; if(s1<0||Math.hypot(C[0]-A[0],C[1]-A[1])>120) C=null; } if(!C) C=[(A[0]+B[0])/2,(A[1]+B[1])/2];
    const bez=[]; for(let i=1;i<=10;i++){ const t=i/10; bez.push([(1-t)*(1-t)*A[0]+2*(1-t)*t*C[0]+t*t*B[0], (1-t)*(1-t)*A[1]+2*(1-t)*t*C[1]+t*t*B[1]]); }
    // the outer edge: from the far end to A, then the curve to B
    const keep=[]; let acc=0; for(let i=0;i<E.length;i++){ if(i){ acc+=Math.hypot(E[i][0]-E[i-1][0],E[i][1]-E[i-1][1]); } if(acc>EL-tA) break; keep.push(E[i]); } keep.push(A); const newE=keep.concat(bez);
    // the gore: where the ramp's INNER edge reaches the deck's edge, the ramp lane runs on beside the deck's outer lane to B —
    // the deck's old edge line becomes the lane line between them (dashed), ending where the taper closes
    const I=outerL?Rk:Lk; const Irev=I.slice().reverse(); let nose=null; for(let t=0;t<plen(I);t+=2){ const q=pointAlong(Irev,t); if(nearOnPoly(q,o.g)[0]>dh){ nose=pointAlong(ED, alongOnPoly(ED,q)[1]); break; } }
    if(nose){ const a0=alongOnPoly(ED,nose)[1], a1=clamp(aB+dirB*60,0,plen(ED)); const lo=Math.min(a0,a1), hi=Math.max(a0,a1); if(hi-lo>4){ const line=[]; for(let t=lo;t<=hi;t+=3) line.push(pointAlong(ED,t)); line.push(pointAlong(ED,hi)); merges.push({line, deck:o}); } }
    if(outerL) Lk=newE; else Rk=newE; L=k?Lk:Lk.slice().reverse(); R=k?Rk:Rk.slice().reverse(); taper=true; });
  return {L,R,taper,merges}; }
function cityContext(s, R){ if (CTX_CACHE.id===s.i && CTX_CACHE.R===R) return CTX_CACHE.v; const F=localFrame(s); const cx=(s.g[0][0]+s.g[s.g.length-1][0])/2, cy=(s.g[0][1]+s.g[s.g.length-1][1])/2;
  const near=p=>Math.hypot(p[0]-cx,p[1]-cy)<R+200;
  // surrounding streets carry their full record (s) so the renderers can draw existing lanes, direction, parking, signals
  // trim[k]: how far the sidewalk band / curbs stop short of the node at end k (the widest crossing street's half carriageway),
  // and how far the pavement runs past it; cross[k]: a crossing street exists there (dead ends and straight continuations: 0)
  // v2: trims are also kept per side (trimLR[k].L / .R): at a T-junction the crossing street meets one side only, so the curb
  // and sidewalk on the other side run straight through instead of stopping at a curb line that is not there
  // v2: centrelines are smoothed (curves read as curves); a bridge / viaduct whose right-of-way value is implausibly narrow for
  // its OSM lanes (the Cambie Bridge is recorded at 10.1 m) is widened to its lanes × 3.3 m plus a 1.5 m edge each side
  const streets=SEGS.filter(o=>o.i!==s.i && o.g.some(near)).map(o=>{ const trimLR=[0,1].map(k=>endSides(o,k,sameLevelCross(o,k))); const trim=trimLR.map(t=>Math.max(t.L,t.R));   // a street passing under a deck keeps its curbs
    const up=isUpSeg(o); const sc=structCtc(o); const rec=(up&&sc!==o.ctc) ? {...o, ctc:sc, row:Math.max(o.row, Math.round((sc+3)*10)/10)} : o;   // v3: structure widths from lanes (structCtc)
    return {row:rec.row,u:o.u,s:o,m:laneModel(rec),g:smoothLine(o.g.map(p=>F.toLocal(p[0],p[1])),2),trim,trimLR,bar:trimLR.map(t=>t.bar),cross:trim.map(t=>t>0),up,lvl:up?((o.osm&&o.osm.ly)||1):0}; });
  // v3: the City's file carries some structure centrelines twice (1300 Howe St, the Granville St approach north of Pacific):
  // two slabs on one line read as a stacked deck, so a duplicate (same ends, same length) is dropped — the one with a lane count stays
  for(let i=streets.length-1;i>=0;i--){ const st=streets[i]; const a=st.g[0], b=st.g[st.g.length-1], L=plen(st.g);
    const j=streets.findIndex((o,jj)=>jj<i && (o.up||st.up||o.s.n===st.s.n) && Math.hypot(o.g[0][0]-a[0],o.g[0][1]-a[1])<2.5 && Math.hypot(o.g[o.g.length-1][0]-b[0],o.g[o.g.length-1][1]-b[1])<2.5 && Math.abs(plen(o.g)-L)<3);
    if(j<0) continue; const o=streets[j]; const ln=x=>(x.s.osm&&x.s.osm.ln)||0; if(ln(st)&&!ln(o)) streets.splice(j,1); else streets.splice(i,1); }
  // bridge decks: height at each end (6 m per OSM layer; 0 where the end lands on a street at grade) and mid-block, for 3D
  // v2: the height at each node comes from the street's level there, so two pieces meeting at a node agree; a piece whose ends
  // differ (a ramp) runs as one straight grade between them — no step where a ramp meets its deck
  const DECK=6.0; streets.forEach(st=>{ if(!st.up) return; const o=st.s, os=o.osm||{}; const top=st.lvl*DECK;
    const endH=k=>{ const nh=nodeH(o,k); if(os.lyE) return Math.max(nh,(os.lyE[k]||0)*DECK); const nb=endNeighbours(o,k), all=[...nb.cross,...nb.cont]; if(!all.length) return nh; return Math.max(nh, all.some(q=>!isUpSeg(q)) ? 0 : top); };   /* an end with nothing beyond it follows the node rule (never left in the air) */
    const h0=endH(0), h1=endH(1); st.deck=[h0, h0===h1?top:(h0+h1)/2, h1]; st.L=plen(st.g); });
  // a street at grade that carries on from a deck node (the Granville Bridge lands on Hemlock St) is the deck's approach: it runs
  // down from that node's height to grade as one ramp, drawn and shaded as part of the structure
  streets.forEach(st=>{ if(st.up) return; const h0=nodeH(st.s,0), h1=nodeH(st.s,1); if(h0<0.5&&h1<0.5) return; st.deck=[h0,(h0+h1)/2,h1]; st.L=plen(st.g); st.up=true; st.lvl=Math.max(st.lvl||0,1); });
  // v3: one surface per structure. (1) a piece whose centreline runs inside a wider deck at its level for most of its length
  // (the Granville connector pieces on the bridge deck) is HOSTED: it gets no slab, band, edges or piers of its own — only its
  // markings on the deck. Decided first, from the City's lines, before any ramp is moved
  // (a piece of the same width lying on a longer one — the 1400 Granville St address line on the bridge deck — is hosted by it)
  streets.forEach(st=>{ if(!st.deck) return; const smp=alongLine(st.g,5,2.5); if(!smp.length) return; const Ls=plen(st.g);
    const inside=smp.filter(q=>streets.some(o=>o!==st&&o.deck&&(o.m.ctc>st.m.ctc+0.5||(Math.abs(o.m.ctc-st.m.ctc)<=0.5&&plen(o.g)>Ls+5))&&nearOnPoly([q[0],q[1]],o.g)[0]<o.m.ctc/2&&Math.abs(deckAtSt(o,q[0],q[1])-deckAtSt(st,q[0],q[1]))<1.5)).length;
    if(inside/smp.length>=0.6) st.host2=true; });
  // a ramp stays at deck level for as long as it runs inside the deck it leaves (the gore), and only then falls away on one
  // grade — so it never drops through the deck's side; the same for a ramp climbing into a deck
  const blockUp=lvlOf(s)>0||nodeH(s,0)>0.5||nodeH(s,1)>0.5, bH=[nodeH(s,0),nodeH(s,1)];
  const inDeckAt=(st,p,h)=>streets.some(o=>o!==st&&o.deck&&o.m.ctc>st.m.ctc&&nearOnPoly(p,o.g)[0]<o.m.ctc/2&&Math.abs(deckAtSt(o,p[0],p[1])-h)<1.5) || (blockUp&&Math.abs(p[0])<s.ctc/2&&p[1]>0&&p[1]<s.len&&Math.abs(bH[0]+(bH[1]-bH[0])*p[1]/s.len-h)<1.5);
  // v3: the streets a piece passes over (their centreline crosses its centreline with no node there — the City splits a street at
  // every at-grade junction, so a plan crossing without a node is grade-separated): the fall starts only past the last of them
  const segX=(a,b,c,d)=>{ const r=[b[0]-a[0],b[1]-a[1]], q=[d[0]-c[0],d[1]-c[1]]; const den=r[0]*q[1]-r[1]*q[0]; if(Math.abs(den)<1e-9) return null; const w=[c[0]-a[0],c[1]-a[1]]; const t=(w[0]*q[1]-w[1]*q[0])/den, u=(w[0]*r[1]-w[1]*r[0])/den; return (t>0&&t<1&&u>0&&u<1)?t:null; };
  const underAt=st=>{ const out=[]; const g=st.g; const L=st.L||plen(g); streets.forEach(o=>{ if(o===st||o.deck||o.host2) return; let acc=0; for(let i=1;i<g.length;i++){ const sl=Math.hypot(g[i][0]-g[i-1][0],g[i][1]-g[i-1][1]); for(let j=1;j<o.g.length;j++){ const t=segX(g[i-1],g[i],o.g[j-1],o.g[j]); if(t!=null){ const a=acc+t*sl; if(a>15&&a<L-15) out.push(a); } } acc+=sl; } }); return out; };
  streets.forEach(st=>{ if(!st.deck||st.host2) return; const [h0,hm,h1]=st.deck; const L=st.L;
    // v3: a deck that lands at both ends (the Burrard Bridge: Pacific St and Cornwall Ave at grade) climbs, runs level, and falls —
    // 8 % at the most, each landing kept clear of the streets the deck crosses over, steepening to 12 % where it must
    if(Math.abs(h0-h1)<0.5 && hm>Math.max(h0,h1)+0.5){ const xs=underAt(st); const up=hm-h0, dn=hm-h1; let a0=Math.min(L/2, up/0.08), a1=Math.max(L/2, L-dn/0.08); if(xs.length){ a0=Math.min(a0, Math.min(...xs)-4); a1=Math.max(a1, Math.max(...xs)+4); } a0=Math.max(a0, Math.min(L/2, up/0.12)); a1=Math.min(a1, Math.max(L/2, L-dn/0.12)); if(a1<=a0+1) return;
      st.prof={h0,a0,h1,a1,k:[[0,h0],[a0,hm],[a1,hm],[L,h1]]}; return; }
    if(Math.abs(h0-h1)<0.5) return; const smp=alongLine(st.g,4,2); let a0=0, a1=L;
    if(h0>h1){ for(const q of smp){ if(inDeckAt(st,[q[0],q[1]],h0)) a0=alongOnPoly(st.g,[q[0],q[1]])[1]+2; else break; } }
    else { for(let i=smp.length-1;i>=0;i--){ const q=smp[i]; if(inDeckAt(st,[q[0],q[1]],h1)) a1=alongOnPoly(st.g,[q[0],q[1]])[1]-2; else break; } }
    // the fall (or climb) needs room: at most 8 % (75 m for 6 m) — a ramp inside its deck to the very end falls over its last 75 m;
    // it starts only past the last street the piece crosses over (that street keeps its clearance), steepening to 12 % at most
    const dh=Math.abs(h0-h1); const need=dh/0.08, least=dh/0.12; const xs=underAt(st);
    if(h0>h1){ a0=Math.min(a0, Math.max(0,L-need)); if(xs.length) a0=Math.max(a0, Math.max(...xs)+4); a0=Math.min(a0, Math.max(0,L-least)); }
    else { a1=Math.max(a1, Math.min(L,need)); if(xs.length) a1=Math.min(a1, Math.min(...xs)-4); a1=Math.max(a1, Math.min(L,least)); }
    if(a1<=a0+1) return; st.prof={h0,a0,h1,a1}; });
  // v3: a ramp running beside a deck at another level sits outside the deck's edge band (a sidewalk is never above a ramp): where the
  // two bands would overlap and the heights differ by more than a metre, the ramp's line moves outward by the overlap, easing back
  // to the City's line as it reaches the deck's level (there the gore taper joins the two surfaces)
  streets.forEach(st=>{ if(!st.deck||!st.prof||st.host2) return; const decks=streets.filter(o=>o!==st&&o.deck&&!o.host2&&o.m.ctc>st.m.ctc+0.5); if(!decks.length) return;
    const bwS=structBandW(st)/2; const L=st.L; const g=resampleLine(st.g, Math.max(3, Math.ceil(L/5)+1)); let moved=false;
    const out=g.map(p=>{ const h=deckAtSt(st,p[0],p[1]); let s=0, dir=null; decks.forEach(o=>{ const [d,q]=nearOnPoly(p,o.g); const need=structBandW(o)/2+bwS+0.2; const dh=Math.abs(deckAtSt(o,p[0],p[1])-h); if(d<need&&d>0.5&&dh>1.0){ const k=Math.min(1,(dh-1)/2); const sh=(need-d)*k; if(sh>s){ s=sh; dir=[p[0]-q[0],p[1]-q[1]]; } } }); if(!dir||s<0.05) return p; moved=true; const n=Math.hypot(dir[0],dir[1])||1; return [p[0]+dir[0]/n*s, p[1]+dir[1]/n*s]; });
    if(moved){ st.g=smoothLine(out,2); st.L=plen(st.g); } });
  // (2) a piece whose end lies in a wider deck MERGES there: its centreline is run on to the deck (far enough for its inner edge to
  // cross the deck's through edge, so the gore between them is paved) and its outer edge tapers into the deck edge (structEdges),
  // so ramp and deck read as one continuous surface. Merges are found for every piece first: a deck keeps its full width up to a node
  // where a ramp leaves or joins on that side (the lane the ramp takes is the lane drop) and tapers only where nothing joins
  streets.forEach(st=>{ if(!st.deck||st.host2) return; st.merge=[0,1].map(k=>mergeDeckAt(streets,st,k)); st.rampSide=[{},{}]; });
  streets.forEach(st=>{ if(!st.merge) return; [0,1].forEach(k=>{ const o=st.merge[k]; if(!o) return; const g=st.g; const p=k?g[g.length-1]:g[0]; const body=pointAlong(k?g.slice().reverse():g, Math.min(20, plen(g)/2));
    const og=o.g, oL=plen(og); const a=alongOnPoly(og,p)[1]; const ko=a<8?0:a>oL-8?1:null; if(ko==null) return;   // a merge at the deck's own node
    const q1=pointAlong(og,Math.max(0,a-4)), q2=pointAlong(og,Math.min(oL,a+4)); const u=[q2[0]-q1[0],q2[1]-q1[1]]; const v=[body[0]-p[0],body[1]-p[1]]; const side=(u[0]*v[1]-u[1]*v[0])>0?'L':'R'; o.rampSide[ko][side]=true; }); });
  streets.forEach(st=>{ if(!st.merge) return;
    let gx=st.g.slice(); st.ext0=0; [0,1].forEach(k=>{ const o=st.merge[k]; if(!o) return; const p=k?gx[gx.length-1]:gx[0], q=k?gx[gx.length-2]:gx[1]; const d=nearOnPoly(p,o.g)[0];
      const aP=alongOnPoly(o.g,p)[1], oL=plen(o.g); const q1=pointAlong(o.g,Math.max(0,aP-4)), q2=pointAlong(o.g,Math.min(oL,aP+4)); const u=[q2[0]-q1[0],q2[1]-q1[1]], uL=Math.hypot(u[0],u[1])||1; const r=[p[0]-q[0],p[1]-q[1]], rL=Math.hypot(r[0],r[1])||1; const sinT=Math.abs(u[0]*r[1]-u[1]*r[0])/(uL*rL);
      const ext=Math.max(d+1, Math.min(36, (st.m.ctc/2)/Math.max(sinT,0.1)+2)); if(ext<0.5) return; const e=[p[0]+(p[0]-q[0])/rL*ext, p[1]+(p[1]-q[1])/rL*ext]; if(k) gx.push(e); else { gx.unshift(e); st.ext0=ext; } });
    st.gx=gx;
    // width targets at each end and side: the piece this one continues into (same street or collinear), if narrower — its curb-to-curb
    // and its band (a street at grade beyond a ramp's landing has the full boulevard, so the band opens out to it); no taper on a
    // side where a ramp leaves or joins at that node
    const tg=[0,1].map(k=>{ if(st.merge[k]) return [null,null]; const nb=endNeighbours(st.s,k).cont.map(o=>streets.find(x=>x.s===o)).filter(Boolean); if(!nb.length) return [null,null];
      return [Math.min(...nb.map(x=>x.m.ctc/2)), Math.min(...nb.map(x=>(x.deck?structBandW(x):x.row)/2))]; });
    const tgSide=(sd,i)=>tg.map((t,k)=>st.rampSide[k][sd]?null:t[i]);
    const fnP={L:widthFn(st, st.m.ctc/2, tgSide('L',0)), R:widthFn(st, st.m.ctc/2, tgSide('R',0))}, fnB={L:widthFn(st, structBandW(st)/2, tgSide('L',1)), R:widthFn(st, structBandW(st)/2, tgSide('R',1))};
    st.E={pav:structEdges(st, st.m.ctc/2, o=>o.m.ctc/2, fnP), band:structEdges(st, structBandW(st)/2, o=>structBandW(o)/2, fnB)};
    st.E.ring=[...st.E.pav.L,...st.E.pav.R.slice().reverse()]; });
  // v3: a ramp keeps its deck's level until its whole width has cleared the deck's carriageway (the nose of the gore) and only then
  // falls — so no edge of it is ever inside the deck at another height (that read as a twist)
  streets.forEach(st=>{ if(!st.prof||st.host2) return; const {h0,h1}=st.prof; const L=st.L; const hw=st.m.ctc/2-0.4; const hTop=Math.max(h0,h1);
    const decks=streets.filter(o=>o!==st&&o.deck&&!o.host2&&o.m.ctc>st.m.ctc+0.5); if(!decks.length) return;
    const anyIn=a=>{ const p=pointAlong(st.g,a), q=pointAlong(st.g,Math.min(L,a+1)); let dx=q[0]-p[0], dz=q[1]-p[1]; const n=Math.hypot(dx,dz)||1; dx/=n; dz/=n; return [-hw,hw].some(off=>{ const e=[p[0]+dz*off,p[1]-dx*off]; return decks.some(o=>nearOnPoly(e,o.g)[0]<o.m.ctc/2-0.3&&Math.abs(deckAtSt(o,e[0],e[1])-hTop)<1.5); }); };
    if(h0>h1){ let a=st.prof.a0; for(let t=a;t<Math.min(L-4,a+120);t+=3){ if(anyIn(t)) a=t+3; else break; } if(a>st.prof.a0){ st.prof.a0=a; st.prof.a1=Math.max(st.prof.a1, Math.min(L, a+Math.abs(h0-h1)/0.12)); } }
    else { let a=st.prof.a1; for(let t=a;t>Math.max(4,a-120);t-=3){ if(anyIn(t)) a=t-3; else break; } if(a<st.prof.a1){ st.prof.a1=a; st.prof.a0=Math.min(st.prof.a0, Math.max(0, a-Math.abs(h0-h1)/0.12)); } } });
  // v3: a divided deck — two one-way pieces of one bridge running side by side (the Cambie Bridge's northbound and southbound
  // carriageways, mapped as two centrelines) — is one structure: each piece's band reaches the midline between the two, so
  // the two bands meet and the deck reads as one slab with a median, not two ribbons with a gap
  streets.forEach(st=>{ if(!st.deck||st.host2||!st.E||!st.m.ow) return; const L=plen(st.g); const mid=pointAlong(st.g,L/2);
    const tw=streets.find(o=>o!==st&&o.deck&&!o.host2&&o.m.ow&&o.s.s===st.s.s&&(o.m.owd||0)*(st.m.owd||0)<0&&nearOnPoly(mid,o.g)[0]<22&&Math.abs(deckAtSt(o,mid[0],mid[1])-deckAtSt(st,mid[0],mid[1]))<1.5); if(!tw) return; st.twin=tw;
    const a=st.g[0], b=st.g[st.g.length-1]; const ux=b[0]-a[0], uz=b[1]-a[1]; const q=nearOnPoly(mid,tw.g)[1]; const innerR=(ux*(q[1]-mid[1])-uz*(q[0]-mid[0]))<0;   // the twin lies to the right of travel
    const g=st.gx||st.g; const hwP=st.m.ctc/2; const inner=a2=>{ const p=pointAlong(g,a2); const d=nearOnPoly(p,tw.g)[0]; return Math.max(hwP+0.3, Math.min(d/2, 12)); };
    st.E.band[innerR?'R':'L']=offsetLineVar(g, a2=>(innerR?1:-1)*inner(a2)); });
  const distTo=(st,p)=>{ let d=Infinity; for(let k=1;k<st.g.length;k++){ const a=st.g[k-1], b=st.g[k]; const dx=b[0]-a[0], dz=b[1]-a[1]; const t=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1),0,1); d=Math.min(d, Math.hypot(p[0]-(a[0]+t*dx), p[1]-(a[1]+t*dz))); } return d; };
  // existing bikeways: oriented S→N / W→E, with the street they run on (for curb-to-curb and which direction has the lane)
  const bike=BW.filter(b=>b.g.some(near)).map(b=>{ const g=smoothLine(fwdOrient(b.g).map(p=>F.toLocal(p[0],p[1])),2); const mid=g[Math.floor(g.length/2)];
    let best=null, bd=14; streets.forEach(st=>{ const d=distTo(st,mid); if(d<bd){ bd=d; best=st; } });
    const onBlock = distTo({g:[[0,0],[0,s.len]]}, mid) < 6;
    const rec = best && best.s.bw ? best.s.bw : (onBlock && s.bw ? s.bw : {});
    return {t:b.t, d:b.d, a:b.a, g, st:b.st, sub:b.sub, wn:rec.wn!==undefined?rec.wn:b.wn, es:rec.es!==undefined?rec.es:b.es, ctc: best ? best.s.ctc : (onBlock ? s.ctc : 12.9), onBlock, side:facilitySide(best?best.s:(onBlock?s:null)), elev:!!(best&&best.s.osm&&best.s.osm.br)}; });
  // continuity: a one-way or two-way piece with no OSM side takes the side of a collinear piece that touches it and has one
  const dirOf=g=>{ const a=g[0], b=g[g.length-1]; const L=Math.hypot(b[0]-a[0],b[1]-a[1])||1; return [(b[0]-a[0])/L,(b[1]-a[1])/L]; };
  for(let pass=0;pass<3;pass++) bike.forEach(b=>{ if(b.side||b.d==='2W') return; const ends=[b.g[0],b.g[b.g.length-1]], db=dirOf(b.g);
    const o=bike.find(q=>q!==b&&(q.side==='L'||q.side==='R')&&Math.abs(db[0]*dirOf(q.g)[0]+db[1]*dirOf(q.g)[1])>0.8&&[q.g[0],q.g[q.g.length-1]].some(e=>ends.some(p=>Math.hypot(e[0]-p[0],e[1]-p[1])<20)));
    if(o) b.side=o.side; });
  // v2: every existing facility is drawn ON its host street. The bikeways layer is its own centreline, often a few metres off the
  // street's, and offsetting lanes from it put them on sidewalks — or, where no street carries it (bridge ramps, greenways,
  // the seawall), as two strips over open ground. Each piece is sampled every 4 m: a sample within a street's right-of-way is
  // hosted by that street (the lanes are then drawn from the street's own centreline, over the along-range the piece covers);
  // samples on the proposed block are dropped (the design replaces them); runs hosted by nothing are drawn as a path of their own.
  const hosts=streets.filter(st=>st.m.ctc>=7);
  const bbox=st=>{ if(st._bb) return st._bb; const xs=st.g.map(p=>p[0]), zs=st.g.map(p=>p[1]), r=st.row/2+1; return st._bb=[Math.min(...xs)-r,Math.max(...xs)+r,Math.min(...zs)-r,Math.max(...zs)+r]; };
  const alongOf=(g,p)=>{ let acc=0, best=Infinity, at=0; for(let k=1;k<g.length;k++){ const a=g[k-1], b=g[k]; const dx=b[0]-a[0], dz=b[1]-a[1], L2=dx*dx+dz*dz||1, L=Math.sqrt(L2); const t=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dz)/L2,0,1); const d=Math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dz)); if(d<best){ best=d; at=acc+t*L; } acc+=L; } return [best,at]; };
  const hosted=new Map(), paths=[];
  bike.forEach(b=>{ const off=b.st==='Off-street'; const pts=[b.g[0],...alongLine(b.g,4,2).map(q=>[q[0],q[1]]),b.g[b.g.length-1]]; let run=[];
    const flush=()=>{ if(run.length>=2 && plen(run)>=6) paths.push({g:run, t:b.t, d:b.d, sub:b.sub, off}); run=[]; };
    pts.forEach(p=>{ if(Math.abs(p[0])<s.row/2+1 && p[1]>-2 && p[1]<s.len+2){ flush(); return; }   // on the proposed block
      let host=null, hd=Infinity, ha=0; if(!off) hosts.forEach(st=>{ const B=bbox(st); if(p[0]<B[0]||p[0]>B[1]||p[1]<B[2]||p[1]>B[3]) return; const [d,a]=alongOf(st.g,p); if(d<st.row/2+1 && d<hd){ hd=d; host=st; ha=a; } });
      if(host){ flush(); let h=hosted.get(host); if(!h){ h={st:host, a0:ha, a1:ha, t:b.t, d:b.d, wn:b.wn, es:b.es, side:b.side}; hosted.set(host,h); } h.a0=Math.min(h.a0,ha); h.a1=Math.max(h.a1,ha); }
      else run.push(p); });
    flush(); });
  // v2: OSM paths — the real, finely mapped geometry of off-street routes and connectors. Kept where they run outside every
  // street's right-of-way at their own level (a cycle track mapped beside a street is that street's hosted lane) and off the
  // proposed block; each run keeps one point inside the edge it leaves or enters, so it meets the sidewalk. Bridge paths
  // (bridge=yes or layer ≥ 1) are drawn as decks. The City's unhosted pieces are dropped where an OSM path already covers them.
  const osmPaths=[]; const upOf=st=>st.up;
  (DATA.paths||[]).forEach(p=>{ if(!p.g.some(near)) return; const up=!!(p.br||(p.ly&&p.ly>0)); const g=smoothLine(p.g.map(q=>F.toLocal(q[0],q[1])),1);
    const pts=[g[0],...alongLine(g,3,1.5).map(q=>[q[0],q[1]]),g[g.length-1]]; let run=[], prevIn=null;
    const flush=()=>{ if(run.length>=2 && plen(run)>=4) osmPaths.push({g:run, des:!!p.des, up, lvl:up?(p.ly||1):0, n:p.n||null, ow:!!p.ow}); run=[]; };
    pts.forEach(q=>{ const onBlock=Math.abs(q[0])<s.row/2 && q[1]>0 && q[1]<s.len;
      const inRow=streets.some(st=>{ if(upOf(st)!==up) return false; const B=bbox(st); if(q[0]<B[0]||q[0]>B[1]||q[1]<B[2]||q[1]>B[3]) return false; return alongOf(st.g,q)[0]<st.row/2-0.5; });
      if(onBlock||inRow){ if(run.length) run.push(q); flush(); prevIn=q; } else { if(!run.length&&prevIn) run.push(prevIn); run.push(q); prevIn=null; } });
    flush(); });
  for(let k=paths.length-1;k>=0;k--){ const smp=alongLine(paths[k].g,5,2.5); if(!smp.length) continue; const cov=smp.filter(([x,z])=>osmPaths.some(o=>nearOnPoly([x,z],o.g)[0]<8)).length; if(cov/smp.length>0.5) paths.splice(k,1); }
  const loops=(DATA.loops||[]).filter(l=>l.g.some(near)).map(l=>({g:l.g.map(q=>F.toLocal(q[0],q[1])), ln:l.ln||1, bulb:!!l.bulb, hw:l.hw}));
  const plazas=(DATA.plazas||[]).filter(r=>r.some(near)).map(r=>r.map(q=>F.toLocal(q[0],q[1])));
  const blds=BLD.filter(b=>Math.hypot(b.x-cx,b.y-cy)<R+60).map(b=>({p:b.p.map(q=>F.toLocal(q[0],q[1])), c:F.toLocal(b.x,b.y), h:b.h, f:b.f}));
  const nodes=[]; const seen={};
  SEGS.forEach(o=>{ [o.g[0], o.g[o.g.length-1]].forEach((q,k)=>{ if(Math.hypot(q[0]-cx,q[1]-cy)>R+120) return;
    const sig=!!(o.ix&&o.ix[k]&&o.ix[k].sig);
    const key=Math.round(q[0]/12)+','+Math.round(q[1]/12); if(seen[key]){ seen[key].n++; seen[key].row=Math.max(seen[key].row,o.row); seen[key].sig=seen[key].sig||sig; return; }
    seen[key]={p:q, n:1, row:o.row, sig}; }); });
  Object.values(seen).forEach(v=>{ if(v.n>=2){ const [x,z]=F.toLocal(v.p[0],v.p[1]); nodes.push({x,z,row:v.row,sig:v.sig}); } });
  // land polygons in the local frame (shoreline). A ring is kept when its bounding box reaches the scene,
  // so the main land mass is always present for inland blocks; no ring at all → everything is land.
  const water=[]; const ext=R*3;
  DATA.land.forEach(ring=>{ let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity; ring.forEach(([x,y])=>{ x0=Math.min(x0,x); y0=Math.min(y0,y); x1=Math.max(x1,x); y1=Math.max(y1,y); });
    if(x1<cx-ext||x0>cx+ext||y1<cy-ext||y0>cy+ext) return; water.push(ring.map(p=>F.toLocal(p[0],p[1]))); });
  // hosted facilities: the host's own record and OSM side win where the host has them; the lanes cover the hosted along-range
  // (widened to the whole block when the piece covers most of it), inside the host's junction trims
  // v3: the deck that carries the block itself (the rule of sceneCtx.host): its existing lanes stop at the block's ends — the
  // design replaces them there — and the renderers taper the block's lanes into them, so the lane is one lane along the deck
  const blockLvl=lvlOf(s); let blockHost=null; if(blockLvl>0){ const zs=[]; for(let z=2;z<s.len-2;z+=8) zs.push(z); streets.forEach(st=>{ if(st.lvl!==blockLvl||st.m.ctc<=s.ctc+1) return; const n=zs.filter(z=>nearOnPoly([0,z],st.g)[0]<s.ctc/2).length; if(zs.length&&n/zs.length>=0.6&&(!blockHost||st.m.ctc>blockHost.m.ctc)) blockHost=st; }); }
  const bikeHosted=[]; [...hosted.values()].forEach(h=>{ const st=h.st, L=plen(st.g), rec=st.s.bw||{}; let a0=h.a0, a1=h.a1; if(a0<12) a0=0; if(a1>L-12) a1=L; const fs=facilitySide(st.s);
    const b={t:rec.t||h.t, d:rec.dir||h.d, wn:rec.wn!==undefined?rec.wn:h.wn, es:rec.es!==undefined?rec.es:h.es, side:(fs==='L'||fs==='R')?fs:h.side};
    // the deck's existing lane beyond the block takes the block's own side (the design keeps an existing two-way lane on its
    // recorded side), so the lane does not jump across the deck where the block begins
    if(st===blockHost){ const bs=facilitySide(s); if(bs==='L'||bs==='R') b.side=bs; }
    const ranges=[[a0,a1]];
    if(st===blockHost){ const aS=alongOf(st.g,[0,0])[1], aE=alongOf(st.g,[0,s.len])[1]; const lo=Math.min(aS,aE), hi=Math.max(aS,aE); ranges.length=0; if(lo-a0>4) ranges.push([a0,lo]); if(a1-hi>4) ranges.push([hi,a1]); }
    ranges.forEach(([r0,r1])=>{ const g=trimLine(st.g, Math.max(r0, st.trim[0]+1), Math.max(L-r1, st.trim[1]+1)); if(g.length>1) bikeHosted.push({st, g, b, ctc:st.m.ctc, blockHost:st===blockHost}); }); });
  // v3: the other blocks of the proposal this block belongs to, with their proposed lanes and buffers (drawn as context so the
  // whole proposal is seen, not one block)
  const propLanes=(typeof proposalContextLanes==='function')?proposalContextLanes(s,F,near):[];
  const v={streets,bike,bikeHosted,blockHost,bikePaths:paths,osmPaths,loops,plazas,blds,water,nodes,F,propLanes,onLand:(x,z)=>{ if(!water.length) return true; return water.some(r=>pointInRing(x,z,r)); }}; CTX_CACHE.id=s.i; CTX_CACHE.R=R; CTX_CACHE.v=v; return v; }
function pointInRing(x,z,r){ let inside=false; for(let i=0,j=r.length-1;i<r.length;j=i++){ const [xi,zi]=r[i], [xj,zj]=r[j]; if(((zi>z)!==(zj>z)) && (x < (xj-xi)*(z-zi)/((zj-zi)||1e-9)+xi)) inside=!inside; } return inside; }

// ── v2: review export — every block end the tool reads as something special, for checking against Google Maps ──────────
// Run from the browser console:  exportAuditCases()   → downloads data/audit_cases.json (chunked so the page stays responsive).
// Then  python scripts/audit.py  builds audit.html with a Satellite / Street View link per case and an overrides exporter.
// exportAuditCases(url) POSTs the JSON to url instead (used by the developer's local receiver).
function auditCases(from,to){ const rows=[]; const near=(p,o)=>nearOnPoly(p,o.g)[0];
  for(let idx=from;idx<to;idx++){ const s=SEGS[idx]; let EI; try{ EI=endInfo(s); }catch(err){ continue; }
    EI.forEach((e,k)=>{ const p=k?s.g[s.g.length-1]:s.g[0]; const base={i:s.i,k,n:s.n,x:+p[0].toFixed(1),y:+p[1].toFixed(1)};
      if(e.loop&&!(e.loopRec&&e.loopRec.bulb)) rows.push({...base,c:'loop',now:`turnaround loop (${e.loopRec?e.loopRec.hw:'?'}, ${e.loopRec?e.loopRec.len:'?'} m) at a ${e.type} end`});
      if(e.gapUnder) rows.push({...base,c:'gap',now:`centreline gap under ${e.gapUnder.s} — read as passing under (automatic rule)`});
      else if(e.type==='dead'||e.type==='path'){ const same=SEGS.find(o=>o.i!==s.i&&o.s===s.s&&[o.g[0],o.g[o.g.length-1]].some(q=>{ const d=Math.hypot(q[0]-p[0],q[1]-p[1]); return d>=14&&d<45; }));
        if(same) rows.push({...base,c:'gap',now:`${e.type} end; same street continues ${Math.round(Math.min(...[same.g[0],same.g[same.g.length-1]].map(q=>Math.hypot(q[0]-p[0],q[1]-p[1]))))} m on`}); }
      if((e.type==='dead'||e.type==='path')&&!e.gapUnder){ const deck=SEGS.find(o=>o.i!==s.i&&lvlOf(o)>0&&near(p,o)<30); if(deck) rows.push({...base,c:'deck',now:`${e.type} end beside ${deck.s} (structure ${Math.round(near(p,deck))} m away)`}); }
      if(e.type==='path') rows.push({...base,c:'path',now:`hands over to ${e.path.n||('a public '+(e.path.des?'cycleway':'path'))} (${e.path.src})${e.loop?' via turnaround':''}`}); }); }
  return rows; }
function exportAuditCases(url){ const rows=[]; let i=0; const STEP=400;
  const step=()=>{ rows.push(...auditCases(i,Math.min(SEGS.length,i+STEP))); i+=STEP; console.log('review scan', Math.min(i,SEGS.length)+'/'+SEGS.length);
    if(i<SEGS.length){ setTimeout(step,10); return; }
    const txt=JSON.stringify(rows); console.log('review cases:', rows.length);
    if(url){ fetch(url,{method:'POST',body:txt}).then(r=>console.log('posted', r.status)).catch(e=>console.error(e)); return; }
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([txt],{type:'application/json'})); a.download='audit_cases.json'; a.click(); };
  step(); return 'scanning…'; }
