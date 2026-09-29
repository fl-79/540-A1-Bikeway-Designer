"""v2: the review page — every block end the tool reads as something special, with a Google Maps link to check it against.

Reads data/audit_cases.json (exported from the tool: category, block, end, what the tool reads now, end point in local metres)
and writes audit.html: one row per case with Satellite and Street View links, a verdict menu and a notes box. "Copy overrides
JSON" produces the text for data/overrides.json; assemble.py embeds that file, and the tool applies it (endInfo / loopEnds).

Google Maps is used only to LOOK — nothing from it is copied into the data; the verdict you record is your own observation.
Run:  python scripts/audit.py      (after exporting audit_cases.json; re-run whenever the cases change)
"""
import json, pathlib, html
from pyproj import Transformer

root = pathlib.Path(__file__).resolve().parent.parent
d = json.load(open(root / 'data' / 'data.json', encoding='utf-8')); O = d['origin']
cases = json.load(open(root / 'data' / 'audit_cases.json', encoding='utf-8'))
ovp = root / 'data' / 'overrides.json'; ov = json.load(open(ovp, encoding='utf-8')) if ovp.exists() else {}
T = Transformer.from_crs('EPSG:26910', 'EPSG:4326', always_xy=True)

CAT = {'deck': 'Dead end beside a structure — does the street really pass under?',
       'gap': 'Dead end, same street continues after a short gap — one street, or two ends?',
       'loop': 'Turnaround loop attached — is it really there?',
       'path': 'Dead end handed over to a path — is the path really public and does it connect?'}
VERDICTS = [('', 'not checked'), ('keep', 'as read — correct'), ('under', 'passes under the structure (no junction, street runs on)'),
            ('junction', 'meets the structure at grade (a junction: the ramp lands here)'),
            ('continue', 'continues (one street, the gap is not a dead end)'), ('dead', 'true dead end (no path, no loop)'),
            ('noloop', 'no turnaround loop here'), ('nopath', 'no public path here (dead end)')]
rows = []
for c in sorted(cases, key=lambda r: (r['c'], r['n'])):
    lon, lat = T.transform(c['x'] + O[0], c['y'] + O[1])
    sat = f'https://www.google.com/maps/@{lat:.6f},{lon:.6f},70m/data=!3m1!1e3'
    sv = f'https://www.google.com/maps?layer=c&cbll={lat:.6f},{lon:.6f}'
    cur = (ov.get(str(c['i'])) or {}).get(str(c['k'])) or {}
    sel = cur.get('v', '')
    opts = ''.join(f'<option value="{v}"{" selected" if v == sel else ""}>{html.escape(t)}</option>' for v, t in VERDICTS)
    rows.append(f'<tr data-i="{c["i"]}" data-k="{c["k"]}" data-c="{c["c"]}"><td>{c["c"]}</td><td>{html.escape(c["n"])} <small>#{c["i"]} · {"far" if c["k"] else "near"} end</small></td>'
                f'<td>{html.escape(c["now"])}</td><td><a href="{sat}" target="_blank">Satellite</a> · <a href="{sv}" target="_blank">Street View</a></td>'
                f'<td><select>{opts}</select></td><td><input value="{html.escape(cur.get("note", ""))}" placeholder="what you saw"></td></tr>')
page = f'''<!doctype html><html><head><meta charset="utf-8"><title>Bikeway Designer · review against Google Maps</title>
<style>body{{font:13px/1.4 Inter,system-ui,sans-serif;margin:20px;color:#1e293b}} h1{{font-size:18px}} table{{border-collapse:collapse;width:100%}} th,td{{text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0;vertical-align:top}}
th{{position:sticky;top:0;background:#fff}} small{{color:#64748b}} select,input{{font:inherit;padding:3px 6px;border:1px solid #cbd5e1;border-radius:6px}} input{{width:220px}}
.bar{{position:sticky;top:0;background:#fff;padding:8px 0;border-bottom:1px solid #e2e8f0;margin-bottom:10px;display:flex;gap:10px;align-items:center}} button{{font:inherit;padding:6px 12px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer}}
textarea{{width:100%;height:120px;font:12px JetBrains Mono,monospace}} .how{{background:#f1f5f9;border-radius:8px;padding:10px 12px;margin:10px 0}} tr[data-c=deck] td:first-child{{color:#1d4ed8}} tr[data-c=gap] td:first-child{{color:#b45309}} tr[data-c=loop] td:first-child{{color:#7c3aed}} tr[data-c=path] td:first-child{{color:#15803d}}</style></head><body>
<h1>Review of special block ends · {len(rows)} cases</h1>
<div class="how"><b>How to use.</b> Open the Satellite (or Street View) link, look at the street end, pick a verdict, add a note if useful. Verdicts are saved in this browser as you go.
When done, <b>Copy overrides JSON</b> and save it as <code>data/overrides.json</code>, then run <code>python scripts/assemble.py</code>: the tool applies your verdicts (a "passes under" end runs the street on beneath the structure; "continues" joins the two ends; "true dead end" removes a path or loop; "no loop" drops the loop).
Nothing from Google Maps is copied into the data — only what you record here.<br>
<b>Categories.</b> {' · '.join(f'<b>{k}</b>: {html.escape(v)}' for k, v in CAT.items())}</div>
<div class="bar"><button id="copy">Copy overrides JSON</button><button id="clear">Clear all verdicts</button><span id="msg"></span></div>
<table><thead><tr><th>Case</th><th>Block</th><th>What the tool reads now</th><th>Check</th><th>Verdict</th><th>Note</th></tr></thead><tbody>{''.join(rows)}</tbody></table>
<h3>overrides.json</h3><textarea id="out" readonly></textarea>
<script>
const KEY='bikeway-audit-v2'; const saved=JSON.parse(localStorage.getItem(KEY)||'{{}}');
const rowsEl=[...document.querySelectorAll('tbody tr')];
rowsEl.forEach(tr=>{{ const id=tr.dataset.i+':'+tr.dataset.k; const s=saved[id]; if(s){{ tr.querySelector('select').value=s.v||''; tr.querySelector('input').value=s.note||''; }} }});
const MAP={{keep:{{}}, under:{{type:'under'}}, junction:{{type:'junction'}}, continue:{{type:'continue'}}, dead:{{type:'dead',loop:false}}, noloop:{{loop:false}}, nopath:{{type:'dead'}}}};
function build(){{ const ov={{}}; rowsEl.forEach(tr=>{{ const v=tr.querySelector('select').value, note=tr.querySelector('input').value; const id=tr.dataset.i+':'+tr.dataset.k; if(v||note) saved[id]={{v,note}}; else delete saved[id];
  if(!v||v==='keep') return; (ov[tr.dataset.i]=ov[tr.dataset.i]||{{}})[tr.dataset.k]={{...MAP[v], v, note}}; }}); localStorage.setItem(KEY,JSON.stringify(saved)); const txt=JSON.stringify(ov,null,1); document.getElementById('out').value=txt; return txt; }}
document.addEventListener('change',build); document.addEventListener('input',build); build();
document.getElementById('copy').onclick=()=>{{ const t=build(); navigator.clipboard.writeText(t).then(()=>document.getElementById('msg').textContent='copied — save as data/overrides.json and run scripts/assemble.py'); }};
document.getElementById('clear').onclick=()=>{{ if(!confirm('Clear every verdict?')) return; rowsEl.forEach(tr=>{{ tr.querySelector('select').value=''; tr.querySelector('input').value=''; }}); build(); }};
</script></body></html>'''
(root / 'audit.html').write_text(page, encoding='utf-8'); print('audit.html', len(rows), 'cases; overrides in effect:', sum(len(v) for v in ov.values()))
