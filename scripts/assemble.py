"""Assemble index.html from src/ and data/data.json. Run from the repo root: python scripts/assemble.py"""
import pathlib
root=pathlib.Path(__file__).resolve().parent.parent; src=root/'src'
order=['02_core.js','03_map.js','04_design.js','04b_project.js','04c_score.js','04d_photo.js','04e_layers.js','05_plan_section.js','06_three.js']
rd=lambda p: p.read_text(encoding='utf-8')          # sources contain UTF-8 symbols; never rely on the OS locale encoding
js=''.join(rd(src/f)+'\n' for f in order)
ovp=root/'data'/'overrides.json'; ov=rd(ovp) if ovp.exists() else '{}'   # v2: reviewer's verdicts from audit.html (see scripts/audit.py)
html=rd(src/'01_head.html')+'const DATA='+rd(root/'data'/'data.json')+';\nDATA.overrides='+ov+';\n'+js+rd(src/'07_boot.js')
(root/'index.html').write_text(html, encoding='utf-8'); print('index.html', round(len(html)/1048576,1), 'MB')
