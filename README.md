# Vancouver Bikeway Designer — version 2

Version 2 adds **design cases** (a block that already has a bikeway is no longer treated as an empty street), makes **every bikeway feature clickable** for its details, and replaces the width sliders with **direct editing in the Plan and Section views** (drag handles, element cards for protection type and level). See *What version 2 changes* and *Editing the section in the view* below. Version 1 is kept untouched in `4 Tool`.

A single-file web tool for designing All Ages & Abilities (AAA) protected bike lanes on any street block in Vancouver. It starts from a map of the existing bikeway network, lets the user pick a block, and generates three compliant design options that connect correctly to the network, with editable widths, live compliance checks against the CoV Engineering Design Manual (EDM 2026) and Metro Vancouver Rapid Implementation Design Guide, and 3D / plan / section outputs set in the real city context.

`index.html` is self-contained (12.9 MB, all data embedded). Open it in a browser. Only external dependency: Three.js r128 from cdnjs and Google Fonts.

---

## Repository layout

```
index.html                 assembled, deployable tool
src/
  01_head.html             markup + CSS (light theme, Inter / JetBrains Mono)
  02_core.js               data decoders, EDM rules, layout solver, options, compliance, recommendations, context helpers
  03_map.js                city map: land/water, streets, bikeways, buildings, parks, boundary, search, selection
  04_design.js             design screen state: options, editor, panels, view plumbing, before/animate/context toggles
  05_plan_section.js       2D renderers (plan, section), zoom/pan with scale-invariant dimensions, plan animation
  06_three.js              Three.js scene: terrain, city context, block, intersections, movers, orbit camera
  07_boot.js               boot + closing tags
scripts/
  build.py                 raw GeoJSON → per-block records + map geometry          (≈2 min)
  enrich.py                shoreline/boundary, signals, bus, truck, one-way, racks  (≈2 min)
  bld.py                   2009+2015 footprints → packed building layer with heights (≈1 min)
  terrain.py               1 m contours → 20 m elevation grid                       (≈10 s)
  assemble.py              src/ + data/data.json (+ data/overrides.json) → index.html
  audit.py                 data/audit_cases.json → audit.html, the review page (Google Maps links, verdicts → overrides.json)
audit.html                 the review page (generated; open in any browser)
data/
  data.json                pre-processed dataset (12 MB) consumed by the app
  audit_cases.json         the special block ends to review (exported from the tool: exportAuditCases())
  overrides.json           the reviewer's verdicts, applied by the tool (optional; see "Reviewing against Google Maps")
  raw/                     put the CoV Open Data exports here (not included, ≈450 MB)
```

Rebuild order when raw data changes: `build.py → enrich.py → bld.py → terrain.py → osm.py → merge.py → assemble.py` (`osm.py` needs `pip install pyproj` and network access to an Overpass mirror; its response is cached in `data/raw/`). Each script reads and rewrites `data.json`, so they must run in that order. Scripts expect raw files in `/mnt/user-data/uploads/` — change `U=` at the top of each to `data/raw/`.

---

## Data sources (City of Vancouver Open Data unless noted)

| Dataset | Used for |
|---|---|
| public-streets | 16,514 selectable blocks, street class, orientation, map geometry |
| right-of-way-widths | ROW per block (values are **feet**, ×0.3048; mode of 10–50 m within 25 m) |
| bikeways | existing facilities, `bikeway_direction` (Bidirectional / 2W / OW), AAA flag, map layer, connection rule |
| street-intersections | cross-street names at block ends |
| parking-meters | meters per side → retained parking side |
| public-trees | trees per side: spacing, median height, median trunk diameter, species |
| building-footprints-2009 | footprint polygons **with LiDAR height** `hgt_agl` (119,350 buildings) |
| building-footprints-2015 | 22,276 buildings built 2009–15, no height → flagged amber, height estimated from area |
| lanes | laneway openings per side with position along block |
| shoreline-2002 + city-boundary | polygonised into land (134 km²); boundary = zoom-out limit |
| parks | **points only** (name, hectares) → circles on map; polygon dataset is *Parks polygon representation* |
| traffic-signals | signal type at block ends → crosswalk logic, signal heads |
| truck-routes | bus/truck flag → 3.2 m curb lane minimum |
| one-way-streets | one-way blocks → single-direction lane solver. The dataset carries no direction of travel; direction comes from OSM (below) where tagged, otherwise +z (north / east) is assumed and every label says so |
| **OpenStreetMap** (`scripts/osm.py`, Overpass, ODbL) | `lanes`, `oneway` direction and `maxspeed` per block, matched by normalised street name within 30 m (10 m unnamed). Not widths: OSM has almost none for Vancouver |
| directional-traffic-count-locations | **not used**: the dataset holds count *locations* only (a block name per line), no volumes, so it cannot supply AADT |
| non-city-streets | map context (bridges, UBC) |
| elevation-contour-lines-1-metre-contours | terrain grid, block grade, contours in plan |
| bike-racks (JSON, no coordinates) | geocoded by street number + side → 1,579 of 1,731 placed |
| TransLink GTFS `shapes` + `stops` (via Abacus) | bus-route flag on 4,573 blocks; 1,612 stops placed by side and position |

Not available anywhere public and therefore **inferred** (all editable in the UI): AADT, lane count (from width: ≥16 m curb-to-curb → 4 lanes), unmetered parking (residential/collector), curb-to-curb (ROW − 7.2 m), curb lines and corner radii (5 m assumed), crosswalk markings (drawn where a signal exists or an arterial/collector meets another street).

---

## How the design logic works

**Sides.** Every point is assigned Left/Right by cross product against the block centreline, normalised so L = West (N–S streets) or North (E–W streets). In all drawings the left of the frame is the L side. The local frame is a proper rotation of the map (z runs north or east, x runs east or south), so **right-hand traffic** means the L half of any street carries −z (south/west-bound) movement and the R half carries +z. Bike-lane direction, stop bars, pictograms and the animated movers all follow this rule.

**Existing traffic model** (`laneModel`, `trafficLabel`, `streetMarkings`, `bikewayLanes`). Every street in view, not just the selected block, gets the same inference as the block itself: lane count from OpenStreetMap where tagged, else from curb-to-curb (≥16 m → 4 lanes; one-way ≥12 m → 2); an odd count on a two-way street (3, 5) is read as a centre turn lane, drawn with yellow lines on both of its edges; parking from meters or residential/collector class, lane edges, centreline, speed, bus/truck flags, signals at its ends, bus stops, and its existing bikeway. Existing bikeways are published as centreline geometry only, so their lateral position is derived: protected / painted lanes sit at the curb (1.8 / 1.5 m, protected with a 0.6 m buffer), *2W* on both sides, *OW* on the side whose direction has the facility (`w_n_bound_type` / `e_s_bound_type`), *Bidirectional* as one 3.0 m lane on the side the design uses, local-street bikeways and shared lanes as sharrows in the travel lanes.

**Connection rule** (`segContext`). Bikeways touching either end of the block are matched. Same-street *Bidirectional* → the design is locked two-way; same-street *2W/OW* → locked one-way each side; otherwise free. The rule and its reason are shown on the selection card and enforced in compliance.

**End classification** (`endInfo`). Independent of the intersections dataset: another street meeting at an angle within 26 m → `cross` (section stops at its curb line, full intersection treatment); collinear continuation → `continue` (section runs straight through); nothing → `dead` (drawn closed with a ramped bike-lane termination).

**Solver** (`solve`, `fitConfig`). Sidewalk + boulevard = (ROW − curb-to-curb)/2 so the section always totals the ROW and the property line never moves. Configurations are tried in order of least disruption: keep all → drop one parking side (keep the side with more meters) → drop both → remove a travel lane (never below one per direction; one for one-way streets). Minimums: travel 3.0 m (3.2 m bus/truck curb lane), one-way bike 2.0 m, two-way 3.0 m, buffer by separation type. Spare width: bike → preferred, travel → +0.3, buffer → preferred, bike → upper preferred, travel → max, buffer → treed (1.5–2.3 m).

**Options** (`generateOptions`). Separation set chosen by speed/AADT: ≤30 km/h low volume → flex posts / pre-cast / planters; 50 km/h → pre-cast / extruded / barrier; ≥60 or ≥10,000 vpd → extruded / barrier / pre-cast. Fallbacks when nothing fits: absolute minimums (flagged for City Engineer approval), then a traffic-calmed shared bikeway (flagged non-AAA on arterials or >30 km/h).

**Compliance** (`checkCompliance`) checks: section total vs curb-to-curb and vs ROW, bike/buffer/travel/sidewalk widths against EDM Tables 8-6, 8-7, 8-10, direction rule, separation vs speed and AADT, lane count, grade (>5% warn, >8% error). **Recommendations** (`recommendations`) add treed buffer opportunities, door-zone buffers, laneway breaks, cross-street bikeways, floating bus stops (named stops), racks, signals, dead-end terminations, grade advice.

---

## Rendering

**Map.** Canvas, world coordinates in metres from `DATA.origin` (UTM 10N). Cover-fit on load, zoom-out limited to the whole city, pan clamped. Buildings drawn as polygons at high zoom; amber = no LiDAR height.

**Plan** (`drawPlanTo`). Block in its local frame (x across, z along). City context in greyscale: land/water, streets as ROW + pavement bands with curb and property lines, junction discs to erase crossing line work, all footprints. Every context street carries its existing traffic: yellow centreline (two-way), dashed lane lines (multi-lane), parking-lane edges, existing bikeways at their derived lateral position, signal heads at signalised nodes, and a name label with class · speed · lanes · direction · parking · bus/truck · facility (a short form where the street is too short for the full line). At each cross end the cross street's own centreline, lane lines, stop bars (right-hand rule; none on one-way streets, whose direction is not published) and the crosswalks across it are drawn, with a label naming the street, its direction, speed, bus flag and signal. The block in colour: sidewalks run the block and stop at the cross-street curb line; carriageway elements stop there too. Intersections get 5 m curb returns, corner refuge islands ending protection 6 m back, crossrides, crosswalks, stop bars, yield teeth, two-stage queue boxes, signal heads (data-driven). Contours (marching squares over the terrain grid), spot elevations, grade. Dimension strings scale-invariant under zoom. Animate toggle moves cars/bikes/people. Nothing is drawn while the canvas is hidden (zero size).

**Section** (`drawSectionTo`). Cut at mid-block. Facades from the median setback/height of real footprints per side; distant buildings beyond the far intersection fade with distance. Dimension string + rotated element names.

**3D** (`build3D`, `buildCity`, `buildStreet`). Orthographic isometric start, drag to orbit, scroll to zoom (out to ~3× the fit so the shoreline and network read), double-click reset. The city context is built to the same resolution as the plan:
- *Land and water.* The terrain mesh (80 × 80 over 3.2 × the block length, from the elevation grid) is cut along the shoreline polygon: vertices off the land polygon drop below an unlit water plane set 0.6 m under the lowest shoreline elevation in view, and the shoreline is drawn as a line at the water surface and along the top of the bank. Inland blocks have no water.
- *Streets.* Sidewalk band (top +0.10 m), pavement (top −0.05 m), 0.25 m curb lines both sides, then the traffic-model markings merged into one mesh per colour (`Quads`): yellow centreline, dashed lane lines, parking edges; existing bikeways as green/pale-green strips with white edge lines and a raised 0.6 m buffer for protected lanes, sharrow blocks for local-street bikeways; bus-stop poles on the correct side; junction pads with a signal pole where Open Data has a signal.
- *Labels.* Billboard sprites (`label3`, constant screen size via `scaleLabels`) on the streets meeting the block's ends (full traffic line) and the nearest others (short line), plus an amber card with the block's own existing configuration and, on one-way blocks, the assumed direction. The **Annotations** toggle in the top bar hides them, and in the plan and section it also hides street names, PL marks, dimension strings, heights and element names; the north arrow and scale bar always stay.
- *One ground plane.* The block has no slab of its own: its elements sit on the shared plate, and the intersection surface is the cross street's pavement extended to the block's far curb. Everything follows one datum (`Y` in `06_three.js`): ground 0, pavement top +0.03 for proposal and context alike, markings +0.06, curb and sidewalk top +0.18. Stacked surfaces are kept ≥ 2.5 cm apart and the camera's depth range is 1–1200 m, because a 16-bit depth buffer flickers on anything closer. Context sidewalks are two strips (curb line to property line) rather than one band across the right-of-way, so the pavement stays visible between them. With no shoreline in view the nominal water level is −0.6 m, which keeps the base slab under the ground plate (a +0.6 m fallback once put the slab over the roads). The surrounding streets use the block's own asphalt and materials lightened 22 % toward white (`lighten`, `M.ctx*`, `mqc`), so existing and proposed read as one drawing with the proposal in full tone and no level change at the threshold.
- *Block.* Sidewalks stop at the cross street's curb line with a rounded curb return (5 m or the sidewalk width); the road base extends across the cross street; the cross street's centreline, lane lines, stop bars and the crosswalks across it are drawn inside the intersection so the proposed lanes can be checked against the traffic they meet. All objects are closed solids (boxes, cylinders, spheres, tori, extrusions). Buildings extruded from true footprints with edge outlines. Before/after via scissor split sharing one camera.

**Packed layers** (decoded at boot in `02_core.js`): buildings `[n u8][h|flag u8][n×(x u16,y u16)]` little-endian metres; terrain `Int16` decimetres, row-major, `nx × ny` at 20 m.

---

## Why street widths jump between blocks (and what was done)

The City publishes no curb lines. Carriageway width is *right-of-way − 7.2 m* (two 3.6 m sidewalk/boulevard zones), and the right-of-way comes from a **point** layer whose values are matched to the nearest block. Three things follow:

1. A single block can inherit a stray point (a lane's 33 ft inside a 66 ft street, a plaza's 140 ft). → `fixRows` replaces a block that is far narrower than its same-street neighbours, or that differs from both neighbours while they agree; ≈1,000 of 16,514 blocks, each flagged on the selection card and the 3D label.
2. Genuine changes of right-of-way (66 ft → 80 ft) do exist and are kept; they now read as a step at the junction rather than a taper.
3. Widths do not exist elsewhere either: OpenStreetMap has a `width` tag on only 46 of ~17,900 Vancouver street ways (checked via Overpass, Sept 2026). What OSM **does** have is used by `scripts/osm.py`: `lanes` (6,465 blocks), `oneway` with direction (266 of the City's 318 one-way blocks) and `maxspeed`. Lane counts and one-way direction now come from OSM where tagged, marked “(OSM)” in labels; the rest is still inferred from width.

## Why blocks were split, and how they are merged (`scripts/merge.py`)

The *public-streets* layer breaks a block wherever a laneway crosses it: of 16,514 segments, 5,963 met another segment of the same street at a node with no crossing street, 5,459 of those at a laneway opening. A design on one of those segments stopped half-way along the block, at the lane, connecting to nothing.

Method, mirrored from `endNeighbours()` in the app: for each segment's far end, find the segments whose end lies within 14 m; a segment of a different street meeting at more than ~37° is a crossing street. A join is accepted only when there is **no** crossing street, exactly **two** segments meet (degree-2 node), both carry the **same street name**, and the next segment's *start* is the one touching (both run S→N / W→E). Chains are followed from their head and merged into one block: geometry concatenated; length summed; hundred-block name widened ("6500 BALSAM ST" + "6600 BALSAM ST" → "6500-6600 BALSAM ST"); the higher street class kept; right-of-way kept when the two agree within 2 m, otherwise length-weighted; trees, meters, racks and building counts summed (spacing, heights and setbacks re-weighted); laneway openings and bus stops shifted by the first segment's length; existing bikeway, connections and end intersections taken from the outer ends; bus / truck / one-way flags OR-ed; OSM tags merged. A laneway at the join was recorded by both halves, so openings within 3 m of each other are collapsed to one. Segments that turn back on themselves or meet a third segment are left alone. Merging repeats until a pass finds no join, because a join can only become eligible once its neighbours have merged. Result on this dataset: 16,514 segments → 10,627 blocks (5,338 chains merged); the longest block is the Burrard Bridge at 1,067 m, whose 3D model builds in about 4 s. The input is kept at `data/raw/data_before_merge.json`. The 200 m drawing cap on block length was removed at the same time so a merged block is drawn end to end.

## Which blocks can be designed (`designable` in `02_core.js`)

Blocks that cannot take a bike-lane design are drawn faint and dashed once the map is zoomed in, show a grey dashed highlight and a tooltip with the reason on hover, keep their selection card with a "Why not" note and a disabled button, and are marked in the search list.

| Excluded | Test | Typical examples |
|---|---|---|
| Highway | OSM `highway=motorway`, or "Trans Canada" in the name | Trans-Canada Hwy, Knight St bridge approach |
| Highway ramp | "RAMP" in the block name | Knight St on / off-ramps |
| Closed street | Open Data class *Closed* | 4 blocks |
| Leased / private road | class *Leased* | 1 block |
| Park road | class *Recreational* (Park Board, not EDM street standards) | Stanley Park drives |
| Alley, lane, mews, walk | last word of the street name | Trounce Alley, Saskatchewan Lane, Kinghorne Mews, Island Park Walk |
| Intersection stub | block shorter than 30 m | ≈300 turning legs |
| Isolated segment | no other street at either end | 7 data fragments |
| Dead-end stub | one dead end, under 60 m, residential | short cul-de-sac stubs |

Reviewed and **kept**: OSM "trunk" streets (Granville, Howe, Seymour, W Georgia, Oak carry the Hwy 99 designation and are exactly where protected lanes belong); bridges and viaducts (network links, several already have lanes); diversions; truck and bus routes; one-way streets; blocks that already have a protected lane (redesign allowed, the card says so); very narrow blocks (the solver falls back to a local-street bikeway); longer dead-end streets (many end at a path, greenway or the seawall). Laneways in the *lanes* dataset were never selectable: they are not streets in *public-streets* and appear only as laneway openings on the block.

## How the bike lane ends at a cross street (`IX`, `endLayout` in `02_core.js`)

One layout drives both the plan and the 3D, measured from the cross street's projected curb line into the block:

| Element | Rule | Source |
|---|---|---|
| Marked crosswalk | two 0.2 m white lines 3.0 m apart, nearest line 0.6 m from the curb line, in line with the cross street's sidewalk; **signalised intersections only** | EDM 2026 §8.8.1.7 |
| Bicycle stop bar | 0.3 m wide, parallel to the cross street, 0.5 m clear of the crosswalk (or of the travelled edge where there is none); on the half of a two-way lane that arrives at that end | EDM §8.9.1.8 |
| Vehicle stop bar | 0.3 m wide, 2.0 m behind the bicycle stop bar, on the lanes arriving at that end | EDM §8.9.1.8 |
| Corner island | in the buffer from 0.3 m to 6 m behind the curb line; posts / planters / barrier stop there; the island is the refuge where the crosswalk crosses the bike lane | BC Parkway Guide §4.5.2 p.63 (6 m = one vehicle); EDM §8.9.1.12 "protected intersection treatments are preferred" |
| Bicycle crossing | across the full cross street, bounded by elephant's feet (0.5 m squares, 0.5 m gaps); one non-elongated bicycle stencil centred in each cross-street lane's path (right half of a two-way crossing) | EDM §8.9.1.12, Table 8-19 |
| Green in the crossing | only where turning conflicts exist: cross street not residential; never on a shared crosswalk | EDM §8.9.1.12, Table 8-18 |
| Two-way dividing line | 0.1 m yellow, 1.0 m dashes with 3.0 m gaps, solid for the 10 m before a pedestrian crossing | EDM §8.9.1.11 |
| Not drawn | yield teeth ("only when directed", §8.9.1.9); two-stage queue box in the crossing (a two-stage box belongs beside the cross street's approach, and the manual prefers protected corners) | EDM §8.9.1.9, §8.9.1.12 |

The previous build drew the crosswalk inside the intersection, a green queue box in the crossing, yield teeth, and stopped the crossing at the cross street's centreline; all four were wrong against the manual.

## What version 2 changes: design cases (`designCase`, `existingElements` in `02_core.js`; `scripts/bwattrs.py`)

Version 1 proposed a new protected lane on every block, including the 2,391 blocks that already carry one, and its "before" view showed those blocks as if they had no facility. Version 2 reads what is there and names one of five cases on the map card, in the hover tooltip, in the search list and in the design screen's tag.

**Data.** `build.py` kept only type, direction and the AAA flag of the existing facility. `scripts/bwattrs.py` (run after `merge.py`) matches every block that has a facility back to its feature in the City's bikeways layer (same type, same street preferred, nearest within 12 m) and copies the subtype, year built, upgrade year, AAA-segment and snow-removal flags, route name and the note. All 2,391 facilities matched. The subtype codes (decoded from the layer's own notes such as "SL to PL NB"): **NB** painted lane, no buffer · **PBT** painted, buffer on the traffic side · **PBP** buffer on the parking side · **PBPT** buffers both sides · **SL** street-level protected lane · **R** raised protected lane · **OSS / OSB** off-street shared path / bike path. Widths and separation materials are not in the layer.

| Case | When | What the tool does |
|---|---|---|
| **New protected lane** | no facility; or a *Local Street* bikeway on a residential street (that is already AAA, so a separated lane is optional) | as version 1 |
| **Upgrade to protected** | *Painted Lanes* (NB, PBT, PBP, PBPT), *Shared Lanes*, or a *Local Street* bikeway on a collector / arterial | painted lanes and sharrows are not AAA (EDM §8.5.3.4, §8.5.3.5). The option set is the normal one for the speed / volume; the "before" view draws the painted lane (1.5 m, 0.6 m painted buffers where the subtype has them) so the change is visible; the notes name the upgrade and the year built |
| **Make permanent** | *Protected Bike Lanes*, street-level (SL) | the alignment is kept; the options are only the durable end of the Rapid Implementation Guide range — extruded concrete curb, **raised lane** (new separation type: lane at 0.15 m on a concrete curb both sides, Table 8-7 raised buffer 0.15 m one-way / 0.6 m two-way) and concrete barrier. The layer does not record the current material, so the notes say to confirm it on site |
| **Review** | *Protected Bike Lanes*, raised (R) | already the permanent form: a single option in the same form, with the compliance check (Table 8-6 widths, §8.9.1.12 intersections) and no fallbacks |
| **Off-street path** | OSS / OSB (the seawall, park paths) | not designable; the map greys the block and the tooltip says why |

Two modifiers apply to any case with a facility: a one-way facility that the connection rule makes two-way is flagged as a change of facility, not of material; and a facility that is not on the AAA network gets a note to check Table 8-6 and the end crossings before adding it.

**Every facility is clickable.** The bikeway features drawn on the map (3,729 pieces, now carrying the full layer attributes from `bwattrs.py`) are hit‑tested as well as the street blocks, so the seawall, Arbutus Greenway, Central Valley Greenway and the other off‑street AAA lanes that have no street block under them open a card of their own: route and street name, decoded facility and subtype, direction, AAA network / segment flags, year built and upgrade year, surface, snow clearing, speed limit, the W/N and E/S bound types, the layer's note, and the piece length. A feature wins the click only when it is clearly nearer than any street block (3 m), so an on‑street facility opens its block (which has the design); a feature that runs along a block gets a "Go to <block> →" button, an off‑street piece says there is no roadway to redesign. Hovering shows the name and facility in the tooltip.

**"Before" view.** `existingElements` lays the existing facility into the existing street at EDM minimums (painted 1.5 m; protected one-way 1.8 m; two-way 3.0 m on the side the design uses; buffers 0.6 m; raised lanes at 0.15 m), reducing parking and then lanes if it does not fit, so plan, section and 3D show the real change: paint → curb, street-level → raised, one-way → two-way. A new `paint` buffer kind draws the painted buffer without posts.

**Summary.** The pros list opens with the change ("Upgrade: painted lane, buffer on the traffic side → extruded concrete curb, lane width 1.50 → 1.80 m"); the recommendations open with the case and its citation.

## Editing the section in the view (v2: `bind2D`, `editOverlay` in `05_plan_section.js`; `ed*` functions in `02_core.js`; `props` / `pop` in `04_design.js`)

The width sliders are gone. The cross-section is edited where it is drawn, in the **Plan** and **Section** views (the 3D view stays a viewer), and the bottom panel mirrors the same state. The sequence the panel names, and that the controls are numbered by:

1. **Layout** — pick option A / B / C (or a saved iteration). Click any lane, buffer or parking strip in the proposed pane, or in the coloured strip in the panel, to select it. The selection is highlighted in the view and a small properties card floats beside it; the panel shows the same card.
2. **Widths** — every boundary between two elements inside the curb lines carries a ▯ handle (mid-block in plan, on the surface line in section). Dragging it widens one neighbour and narrows the other by the same amount, snapped to 5 cm, with the two widths shown live; nothing can go below its absolute minimum (Table 8-6 / 8-7 / 8-10 absolute values), and anything between absolute and normal minimum is flagged by the compliance panel as before. The curb lines and property lines never move (sidewalks stay locked), so the curb-to-curb total is preserved by construction. The width can also be typed on the card.
3. **Protection** — a buffer's card has the full separation list (painted buffer, flex posts, planter, pre-cast curb, extruded curb, concrete barrier, raised lane); choosing one sets its height. "+ buffer ◀ / ▶" inserts a 0.6 m buffer on either side of the selected element (funded from the travel lanes' spare, then parking, then the bike lanes and buffers above their floors — if nothing has spare the section goes over-width and the check says so). A travel lane can become parking or a buffer, parking a travel lane or buffer, and "+ bike lane" / "+ parking" add on the curb side. The option's headline separation (chip label, speed / volume checks) follows the weakest buffer in the section.
4. **Levels** — a bike lane or buffer can sit at street level, intermediate (+80 mm) or sidewalk level (+150 mm); "raise to curb level" is the one-click version. Raised elements get curb lines in plan, their height in section, and a raised slab in 3D.
5. **Check** — compliance and recommendations recompute on every drag and change; Auto-balance still redistributes any unallocated width.

**Dimensions as controls.** In plan the width dimensions (element widths, curb-to-curb, right-of-way) appear once zoomed in past 1.3×, as a row inside the block just above the bottom of the view so they sit beside the elements wherever you are looking; the block length is not dimensioned (the cross-section is the subject). A dimension line is drawn only where its number fits. The boundary handles sit on that row, so it is where widths are dragged; hovering a number shows a text cursor and a click opens an inline box to type the width (Enter applies, Escape cancels) — the nearest travel lane absorbs the difference so curb-to-curb holds. The section's dimension row works the same way.

Delete / Backspace removes the selected element (its width goes to the nearest travel lane), Escape deselects, "Edit in view" in the top bar hides the handles for clean output, and Revert restores the generated option. Levels are uniform along the block; raising only a zone of the block (e.g. at a bus stop) is not yet supported.

## Zoom-aware annotation in plan and section (v2: `zoomFont`, `VIS` in `05_plan_section.js`)

Text inside the zoomed canvas used to be either fixed on screen (dimensions) or scaled 1:1 with the drawing (street names, so 4× zoom gave 4× text). Now every annotation grows with the **square root** of the zoom (2× zoom → 1.4× text) between a floor and a cap in screen pixels, and whether a string is written is judged at the current zoom, so more appears as you go in:

- **Dimension strings** at the block ends are written only where they fit at this zoom (a 0.6 m buffer's width appears once the buffer is wide enough on screen).
- **Context street names** are placed on the *on-screen* piece of each street (the polyline is clipped to the visible box), so a name follows you as you pan and zoom instead of sitting on the street's mid-point off-screen; the short-street cut-off and the label collision are evaluated in screen pixels.
- **Past 1.5× zoom** every element carries its name and width along the lane ("bike lane · 2.40 m", "extruded concrete curb · 0.75 m"), repeated every 24 m so one is always in view, once the element is wide enough for the text; the block's own street name runs along both property lines at the centre of the visible length.
- Section dimensions, element names and the width-handle read-outs use the same rule.

## Line-weight hierarchy in plan and section (v2: `lineWeights` in `05_plan_section.js`)

Modelled on a drawn street plan/section: four weights, held in screen pixels so the hierarchy survives zooming (they grow only with the square root of the zoom, capped at 1.8×), rather than thickening with the geometry as before.

| Weight | Plan | Section |
|---|---|---|
| **heavy** (1.7 px) | the block's curb lines and curb returns — the carriageway edge of the proposal | the ground / surface profile (the cut line) |
| **medium** (1.0 px) | edges of the proposed elements (bike lane, buffers), raised-element curb lines, corner islands, viaduct structure edges | building facades |
| **light** (0.6 px) | property lines (dashed, dash scaled), building footprints, context curb lines, bus shelters, laneway cuts | slab underside |
| **hairline** (0.35 px) | paving hatch, cars, tree crowns, context property lines | facade floor lines, vehicles |

Painted markings keep their real widths (they are physical lines, drawn in metres), and the colours are unchanged.

## Paths, bridges, loops and curving junctions (v2: `scripts/osmpaths.py`; `smoothLine`, `loopEnds`, `endInfo` path ends, `cityContext` in `02_core.js`)

**Data** (`scripts/osmpaths.py`, OpenStreetMap via Overpass, cached in `data/raw/osm_paths_loops.json` and `osm_turning.json`): 3,707 public paths a bike may use (2,819 cycleways; `access=private|no` and `bicycle=no` excluded; sidewalks and crossings left to the streets), 559 turnarounds, 246 public plazas (pedestrian areas), and the OSM `layer` of the 30 blocks that sit on a bridge deck (bridge-tagged ways only), at mid-block and at each end.

**Turnarounds: loops that should be there, loops that should not (v2).** The first pass took every closed residential *or service* ring under 250 m as a turnaround, which put loops at the end of streets that only have a parking aisle, a driveway or a loading loop beside them (57 service rings, 50 parking aisles, 32 driveways citywide). Service rings are now kept only when tagged `service=turning_loop`; public street rings (residential, unclassified, living street) and `junction=roundabout|circular` stay: 297 loops. The other way round, OSM maps most cul-de-sac bulbs not as a ring but as one node, `highway=turning_circle` (a paved circle, ~18 m across) or `highway=turning_loop` (round an island, ~24 m): 262 of them, which the first pass could not see. Each becomes a ring of that diameter (`bulb: true`); a `turning_circle` is drawn as one paved disc with a curb round it (plan and 3D), a `turning_loop` as a ring road round its island. A dead end that ends in any turnaround runs its carriageway into it instead of closing with a curb and END hatch (`e.loop` on a *dead* end, plan and 3D). Bulbs do not shorten the block (`loopEnds` skips them: the City's centreline already ends at the bulb's centre).

**Smoother, representative geometry.** Street, bikeway and path centrelines are rounded with two passes of Chaikin corner-cutting (ends fixed, so streets still meet at their nodes); OSM paths are drawn from their own 2–15 m vertex geometry instead of the City's few-vertex bikeway pieces, which are dropped wherever an OSM path covers them.

**Bridges and overpasses.** A street or path is on a deck when OSM says `bridge=yes` / `layer ≥ 1` (or the name says Viaduct / Bridge / Overpass). Plan: decks are drawn in a second pass over everything at grade, with a cast shadow — the deck outline shifted 2.4 m south-east per level (sun from the north-west) — and medium-weight edges. Bridges whose right-of-way value is implausible for their OSM lane count (the Cambie Bridge is recorded at 10.1 m) are drawn at lanes × 3.3 m plus edges. 3D: decks stand at 6 m per OSM layer, ramp linearly to grade where an end lands on a street at grade, tilt with their slope, sit on piers every 24 m (20 m for path decks) and cast shadows; the lane markings and hosted bike lanes ride on the deck.

**Levels: what meets, what passes over (v2, `lyAt`, `sameLevelCross`, `endInfo` under/over).** Two streets meet at a node only when they are at the same OSM level there (a ramp's level at each end comes from `lyE`). A street at another level is recorded on that end as `under` or `over`: no junction, no crosswalk or curb return, the block's section runs on (the end becomes a *continue* if a same-level street carries on). At 1500 Granville St — the Granville Connector on the bridge's north approach (OSM layer 1) — Beach Avenue and Beach Crescent now pass beneath instead of forming a four-way crossing; the card and the recommendations say so. Context streets keep their curbs and sidewalks through a node where the crossing street is at another level.

**One structure per level (plan).** All decks at a level are drawn as one surface: every deck band, then every deck pavement, then markings and edge lines only where they lie outside every other (wider) structure at that level and outside the block's own deck — so a ramp's edges begin where it leaves the bridge instead of running across it, and the Howe / Seymour ramps at Granville fan out of the deck as one surface. The cast shadow is drawn once through an offscreen mask, so overlapping decks do not darken twice. Deck outer lines are parapets (medium weight).

**A block on a structure.** `sceneCtx` carries the block's level (`lvl`, `deckH` = 6 m per level) and its *host*: a wider same-level deck whose centreline runs inside the block's carriageway for most of its length (the City maps the Granville Bridge and its centre connector as two streets on one deck). Plan: the block gets its own deck slab and parapet lines (labelled *deck edge*, no property line, no street trees); over a host, its outer zones are transparent so the host deck's remaining lanes show through and no sidewalk corners or curb returns are drawn. Section: the true ground is drawn `deckH` below, with the deck slab (1.4 m), piers, 1.4 m parapets (bicycle-rail height) and the buildings standing on the true ground; dimensions sit below the ground. 3D: the block stands on its deck with slab and piers, a hair above the context deck it shares; buildings fronting it stay on the ground.

**A continuous road surface (v2, `nodeH`, ribbons).** Heights are decided at nodes, not per piece: where a street carries on through a node (same street, or collinear) both pieces take the higher level there, so a bridge's approach piece — or an at-grade street the bridge lands on, like Hemlock St under the Granville Bridge's south end — runs down from the deck as one straight ramp instead of stepping 6 m at the node. A crossing street at another level still passes under or over. The designed block follows the same rule: it starts at its near-end node height and runs as one grade to the far end (3D tilts it; section uses the mid-block height), or rides the host deck's own surface where a wider deck carries it. In 3D every street surface is now one continuous ribbon along its smoothed centreline (top, underside, sides), not a box per segment, so curves are smooth and a ramp's surface runs into its deck; co-planar decks are offset by millimetres so they never flicker through each other.

**Ramps that join (v2).** A piece that does not carry on through a node — a ramp at its merge or its landing — takes the level of what it runs into there: the deck it merges into, or the street it lands on; a tagged level that contradicts that is treated as the tag lagging the road, so a ramp is never left hanging in the air. Junction and pass-under decisions use these node heights. A ramp also stays at deck level for as long as it runs inside the deck it leaves (the gore area) and only then falls away on one grade (`prof` breakpoints), so its surface never drops through the deck's side; a climbing ramp does the same in reverse.

**Structures over the block (plan).** A deck, ramp or deck path that passes above the block being designed (its height over the block's footprint exceeds the block's own surface by more than 0.5 m) is drawn *after* the proposal, with its shadow falling on it and under the annotations, so a lane designed on a street beneath a bridge ramp (1500 W 3rd Ave under the Granville ramps) reads as beneath it. Decks at the block's level, or elsewhere in the scene, are drawn with the context as before.

**Ramps: what climbs, what passes under, and the join (v2).** Only a piece whose level is *inherited* (no end tag of its own) comes down to what it lands on; a piece with an explicit OpenStreetMap end tag keeps it, so a street at grade ending under a deck (600 Kinghorne Mews under the Granville connector) stays at grade and passes beneath instead of being drawn as a ramp climbing onto the deck — that was the "loop". An end with nothing at its node that lies inside another same-level street's carriageway (the connector piece sitting on the bridge deck) carries on along that street. Decks and ramps carry only their real edge: a one-way ramp its parapet (carriageway + 1.2 m), a bridge a sidewalk of up to 2.25 m a side, never the right-of-way's 3.6 m boulevard — which made ramps read as fat bands. Where a ramp leaves a deck, edge lines are dropped inside *any* other structure at that level, so what remains is the outline of the union: the ramp's edge and the deck's edge meet at the point of divergence and the join tapers (plan); 3D uses the same narrower ramp band.

**No added sidewalks on structures.** On a bridge, viaduct or overpass the solver's outer zones are marked *existing deck sidewalk (kept)*: locked, drawn as context (plain, no scoring), labelled as existing in plan, section, the strip and the cards, with the panel note and a recommendation saying the design fits the existing carriageway and no sidewalk or boulevard is added.

**Dead ends that continue as a path.** A dead end becomes a *path end* when a public path a cyclist may use leaves it — within 15 m of the end, within 15 m of the turnaround loop it ends in, or across a public plaza it opens onto — and the path goes somewhere (beyond the block's end or out of its right-of-way, so a cycle track mapped alongside the block does not count). OSM designated cycleways are preferred, the City's off-street bikeways are the fallback. The street still ends for cars; the drawing is not a protected bikeway: no END marking or hatch; the carriageway runs into the turnaround loop where there is one (otherwise it closes with a curb that has a flush cut at each bike lane); and a *connector* is drawn in the path language — paved path, dashed edges, dashed centreline — from the lane end (or from the loop's outer curb nearest the path) to the path, with a "path connection → name" note. The card, the design screen's recommendations and the connection count treat it as connected.

A public plaza the end or its loop opens onto (within 20 m) counts as a way through to a path touching it.

**0 Smithe St specifically.** OSM maps its end as a one-way loop road round a planted island (the pandas sculpture) next to a public plaza, with a designated cycleway leaving towards Expo / Smithe and the Cambie Bridge deck. The City's centreline ran on 27 m past the loop through the plaza (142 m); `loopEnds` cuts a dead-end block back to where it meets a mapped loop that crosses its line within its last 80 m (less half the loop's width), so 0 Smithe is now 88 m and ends at the loop, which is drawn from OSM (19 dead ends are corrected this way citywide; laneway and bus-stop positions are shifted when the cut is at the block's start).

**Curving and skewed cross streets (plan).** The junction is built from the cross street's real, smoothed centreline and its curb lines, not a right-angled rectangle: the block's sidewalks run on to the cross street's actual near curb (or are cut back where it intrudes), the curb returns are true fillets tangent to both curb lines at whatever angle they meet, the crosswalks across the cross street and the bicycle crossing span its real curbs, the stencils sit in its real lanes, and its lane lines and stop bars follow its centreline and stop 1 m behind this block's sidewalk (`streetMarkings`, `bar`). The 3D view uses the same geometry (`endGeom` in `05_plan_section.js` is shared): each corner is one extruded sidewalk slab running from the section end to the cross street's real near curb, with the fillet arc cut into it; where a 5 m fillet would reach back past the section end (a sharply skewed curb) the corner falls back to a straight edge along the curb. The crosswalks across the cross street, the bicycle crossing and its stencils sit between its real curbs, and without the city context the cross street's pavement and markings are drawn along its centreline.

**Connector routing** (`pathConnectors`, shared by plan and 3D): from the loop's outer curb (sampled round the ring) or from 2.5 m beyond each bike lane's end, to the path sampled every 2 m within 80 m; the shortest leg that crosses no building footprint and not the loop's island is used (the loop road and plazas may be crossed), the shortest leg overall if every one is blocked. At 0 Smithe this is a single 10.5 m link from the loop's outer curb to the designated cycleway.

**Counts.** Of the 746 designable blocks with a dead end, 65 ends now hand over to a path (63 from OSM, 2 from the City's layer; 15 through a turnaround loop) — among them 6 onto the Arbutus Greenway, 4 onto the BC Parkway, 3 onto the Fraser River Trail and 31 onto unnamed public cycleways and paths; 614 remain plain dead ends.

## Reviewing against Google Maps (v2: `exportAuditCases` in `02_core.js`, `scripts/audit.py`, `data/overrides.json`)

**Is Google Maps a usable check?** Yes, for looking; no, as a data source. Its satellite imagery, Street View and 3D tiles show what is on the ground today — whether a street really passes under a ramp, whether a cul-de-sac bulb exists — and the tool's data (City centrelines, OSM) is what can be wrong. But Google's terms do not allow copying, tracing or deriving data from its maps, and there is no open API for street geometry, so nothing from Google goes into `data.json`. The workflow is: the tool lists every end it reads as *special*, a person looks at each in Google Maps, and records a verdict; the verdict — the reviewer's own observation — is what the tool applies.

**What the first review found (and fixed in the data).** Two of the "dead ends beside a structure" — 200 Alexander St at Main St and 700 Kootenay St at Adanac St — are ordinary junctions at grade in the satellite view. The cause was in OSM: `osmpaths.py` treated any way with `layer ≥ 1` as elevated, but `layer` alone is drawing order, not a structure — Adanac St carries `layer=1` where it crosses *over* the Cassiar tunnel, and Main St has an 11 m `layer=1` stub at the Alexander node before its bridge starts. Only 8 road ways in the city are `layer`-only against 148 tagged `bridge=*`, so a way now counts as a structure only with a `bridge` tag (paths likewise), and those junctions are junctions again; 600 Citadel Parade now runs on under the Georgia Viaduct; deck blocks drop from 34 to 30 and no deck end is left hanging.

**Two data problems this catches.** (1) *Dead ends that actually pass under.* The City's centreline layer breaks some streets where a structure crosses them (a bridge ramp, a viaduct), leaving two dead ends a few metres apart and, in this tool, a "dead end" cap and END hatch at a place where the street simply runs on beneath. Ends where the same street starts again 14–45 m on are listed as *gap* cases; ends within 30 m of a deck are listed as *deck* cases. Where a deck stands over such a gap the tool already reads the end as a continuation (`gapUnder` in `endInfo`: no cap, section runs on, the structure noted as *over*); the rest are for the reviewer. (2) *Turnarounds that should or should not be there* (see above): loops still attached to a dead end are listed as *loop* cases; path hand-overs as *path* cases.

**Workflow.**
1. In the tool, open the browser console and run `exportAuditCases()` — it scans every block end (about a minute, in chunks) and downloads `audit_cases.json`; save it to `data/`. (Today: 217 cases — 10 deck, 95 gap, 15 loop, 97 path; 80 bulbs are attached but not listed.)
2. `python scripts/audit.py` writes `audit.html`: one row per case with what the tool reads now, a **Satellite** link (Google Maps at 70 m over the exact end point, coordinates converted from the tool's UTM 10N frame) and a **Street View** link, a verdict menu (*as read* / *passes under* / *continues* / *true dead end* / *no loop* / *no public path*) and a note. Verdicts are kept in the browser as you go.
3. **Copy overrides JSON**, save as `data/overrides.json`, run `python scripts/assemble.py`. `assemble.py` embeds the file as `DATA.overrides`; `endInfo` applies it per block end — *passes under* moves the crossing street to the end's *under* list (no junction; continues if a same-level street carries on), *continues* joins the end to the same street's next piece, *true dead end* / *no public path* drop the path hand-over, *no loop* drops the turnaround (`loopEnds` also leaves the block uncut). The card's recommendations say when an end was set by the reviewer, with the note.

Nothing else changes: an end with no verdict is read from the data as before, and the review can be repeated whenever the data is rebuilt (re-export, re-run `audit.py`; earlier verdicts are kept by block and end).

## Representation fixes in v2 (plan context)

- **Buildings on the road (900 / 700 Cambie and others).** `fixRows` widened any block narrower than 70 % of its street's *citywide* median. Cambie is a 45.7 m boulevard south of False Creek and a 20.1 m street downtown, so the downtown blocks were widened to 45.7 m and the drawn right-of-way swallowed the buildings. The rule now uses only the blocks adjoining along the same street (both neighbours agreeing, or a short stub narrower than 70 % of its one neighbour); 279 blocks are corrected instead of 840, and Cambie downtown is back to 20.1 m.
- **Footprints within property lines.** Building footprints are painted first and the street right-of-way bands over them, so a footprint that strays past the property line (a few along Expo Boulevard under the viaducts, 1–4 m) is cut at the line.
- **Yellow lines overlapping.** The Dunsmuir and Georgia viaducts run above Dunsmuir Street, Georgia Street and Griffiths Way, and all were drawn at the same level with their lane lines mixed. Streets tagged `bridge=yes` in OSM (or named Viaduct / Bridge / Overpass) are drawn in a second pass on top, with a shadow and heavier structure edges, so the surface street's markings disappear beneath them.
- **Continuous lines.** Lane markings stopped 1.5 m short of *every* block end, so a street that simply carried on (a bend, a laneway, a merged block) showed a 3 m gap in its centreline. They now stop short only at a junction.
- **Existing bike lanes on the wrong side.** The City's bikeways layer is centreline geometry with no lateral position; version 1 guessed the side from type and direction (W/N-bound → east/south side), which put the Smithe lane on the wrong side and made it look as if it crossed all lanes at Beatty. `scripts/osm.py` now reads OSM's `cycleway:left` / `cycleway:right` / `cycleway:both` (and `:oneway`) tags, turned into the block's own frame (L = west/north), and attaches them as `osm.cw`. 709 of the 773 blocks with a painted or protected lane get a side from OSM; the "before" view, the solver's two-way side for existing lanes and the context drawing all use it, with continuity to an adjoining collinear piece as the next fallback and the old guess last. Where OSM says the lane really does change sides (Smithe at Beatty: north side west of Beatty, south side of the two-way section east of it) the crossing is drawn as the data has it.
- **T-junctions drawn as full crossings.** Every cross street was drawn as a four-way crossing: at 800 Beatty's north end Robson only arrives from the west, yet the east side got pavement, a curb return, a crosswalk, a stop bar and Robson's centreline running 60 m on across Expo Boulevard. The legs are now read from the cross street's geometry (`endLegs`); a missing leg keeps the block's sidewalk and heavy curb line running straight to the node and gets none of the cross-street treatment, and the cross street's lines stop where its leg ends. The context streets do the same per side (`endSides` → `trimLR`): their curb and sidewalk stop at a crossing street only on the side it leaves from, so the continuing sidewalk at a T is unbroken. Plan and 3D.
- **Bike lanes with no road under them.** Existing facilities were drawn by offsetting lanes from the bikeways layer's own centreline, which is often a few metres off the street's, and which exists where no street does (the Cambie Bridge ramps, greenways, the seawall) — so lanes landed on sidewalks or as two strips over open ground. Each bikeway piece is now sampled every 4 m: samples within a street's right-of-way are hosted by that street and its lanes are drawn from the *street's* centreline (with the street's own record and OSM side); samples on the proposed block are dropped (the design replaces them); runs no street carries are drawn as a path of their own — a paved path with shoulders, green where bikes only, pale where shared, dashed centreline when two-way.
- **Curb returns.** The corner arcs were centred one radius on the wrong side of the corner, so they floated in the junction and touched nothing. They are now proper curb returns: centre in the sidewalk corner, tangent to both curb lines, the road wrapping round the corner, same radius as the 3D corner (5 m or a little under the sidewalk width). The block's curb lines no longer run on across the cross street.

## Fixed in this revision

- **Selecting a street on the map was unreliable.** A press was treated as a pan, and the selection dropped, as soon as the pointer moved more than about 2 screen pixels between press and release, which any ordinary click can do (and more so on a high-DPI screen). A click now selects unless the pointer travels more than 6 CSS px; only then does the map pan.
- **Plan labels no longer overlap dimensions or each other.** Context street labels are placed nearest-first, one per street name, skipped on the cross streets at the block's ends (those get the dedicated two-line label, now right-aligned outside the corner return on the block side of the cross street's centreline), skipped inside a reserved zone around the block, its dimension strings and scale bar, and skipped whenever their rotated box touches a label already placed.
- **Existing trees everywhere, not only on the block.** The public-trees layer is summarised per block side (count, spacing, median height and trunk diameter; positions are not carried into `data.json`), so trees on every surrounding street are spaced evenly along the boulevard nearest the curb with the same rule the block uses (`streetTrees`). In 3D they are two instanced meshes (trunks, crowns) in the faded context palette; in plan they are flat, lighter discs. The invented placeholder trees that used to appear in front of blocks with no building footprints are gone: only trees in the dataset are drawn.
- **Plan and section changed as you zoomed.** Each 2D canvas attaches its zoom / pan handlers once, and those handlers redrew the element list captured on the very first draw, so after switching options or editing widths a scroll drew the first option ever opened: street width, sidewalks and property lines jumped. The handlers now always redraw the current option (`bind2D` refreshes the redraw on every draw). Property lines and sidewalks are fixed by the solver for every option (sidewalk + boulevard = (ROW − curb-to-curb)/2 on both sides), so all options share the same right-of-way.

- **Topography switched off** (`TOPO_OFF` in `02_core.js`). The elevation grid tilted the block and put the surrounding streets on a warped surface that collided with the proposed geometry. The 3D ground is flat, the plan has no contours / spot heights / grade, and the grade compliance notes are silent. Everything is still in the code behind the flag.
- **3D context is a site model with a clear edge.** A square plate (640 m side, or 2.6 × the block length if longer) on a slab with a rim wall; streets, markings, bikeways, buildings, water and shoreline are clipped to the square (`clipPoly`); water sits inside the rim as a pool. Zoom out to 0.18 × fit shows the whole plate.
- **Fragmented streets.** A block of the *same street* meeting at an angle (a curve) was treated as a crossing, so both sidewalk bands were trimmed and the street broke into pieces. Same-name neighbours are now always continuations (`endNeighbours`, `endInfo`).

- **"Design bike lane on this block" only worked intermittently.** `openDesign` drew the plan/section before the design screen was shown, so those canvases had zero size, the scale went negative and the first `arc()` call threw, aborting the screen switch. It only worked when the last view was 3D (no canvas arcs). The screen is now shown first and both 2D renderers return early on a zero-size canvas. Verified by opening ~70 sampled blocks in each view without an error.
- **Left-hand traffic.** Bike-lane direction, movers and stop bars had +z traffic on the L (west/north) side. Corrected to right-hand traffic everywhere.
- **Sidewalks crossed the intersection in 3D** (they ran the full block length through the cross street's pavement). They now stop at the cross street with a curb return, matching the plan.
- **Map opened in the top-left corner.** The map canvas is absolutely positioned; without an explicit `width:100%;height:100%` an absolutely positioned canvas keeps its intrinsic size, so it stayed at its first measured size. Fixed in CSS, plus a `ResizeObserver` so the map follows the pane when there is no window `resize` event.
- **Map context beyond the boundary, revised** (`scripts/coast.py`). The regional OSM coastline (Howe Sound to the delta, one bbox) is merged into continuous chains; the mainland chain is 170 km long and is closed far to the east as one land polygon, islands close on themselves. Because OSM draws coastline with land on the left, Burrard Inlet, English Bay, the North Arm mouth and the Middle Arm are water without any special handling. The North and South Arm river relations are painted over that land as water, with their islands back on top. The earlier per-piece approach (North Shore chain, offset banks, assumed Richmond and Burnaby rectangles) is kept only as a fallback when the data lacks the coastline. The paragraph below describes that earlier version.
- **Map context beyond the boundary** (`scripts/coast.py`, earlier version). The sea is drawn everywhere outside the city; the polygonised land mass already in the data (`land`, from the City's shoreline layer) runs 3 km west of the boundary over Pacific Spirit Park and UBC, so it is drawn greyed outside the boundary and in colour inside it, which keeps the shoreline one continuous line; the North Shore coast comes from OpenStreetMap `natural=coastline` (no City layer crosses the inlet), chained and closed off to the north; Burnaby east of Boundary Road below the inlet is assumed land; Richmond is filled from the south boundary line (which runs down the middle of the Fraser's North Arm) and the river is then painted over it at its surveyed extent from OpenStreetMap `natural=water` polygons (`data.water`, outer rings of the river relation chained with shapely; its islands such as Mitchell Island in `data.islands`), so the Richmond and Sea Island banks are the mapped banks, not an offset of the boundary. Sea Island (YVR) and Lulu Island's Strait coast come from OpenStreetMap coastline south-west of the city, clipped to south of the city and closed off to the east as land, which the river polygons then carve the arms through. Panning reaches down to YVR and out to the Strait even though the initial fit stops at the river. All of it is greyed with a muted shoreline; only the city carries colour and is selectable. The initial view cover-fits the city plus that context and anchors its south-east corner to the window's bottom-right, so Boundary Road sits at the right edge and the Fraser, with a 900 m strip of Richmond, at the bottom edge; panning may overshoot a further 600 m east and south so edge blocks can be centred when zoomed in.
- **Map ends at the city boundary.** The 14 boundary line parts are chained into one ring at load; everything (water, land, streets, buildings, bikeways) is clipped to it, the outside is a flat neutral tone, and panning is clamped to the city's bounding box, so the east edge is Boundary Road, not an open field of context.
- **Junctions drawn as overlapping planes / round pads.** Surrounding streets were boxes running through each other with a cylinder pad on top, which read as stacked planes and curved road ends. Each street's sidewalk band and curb lines now stop at the widest crossing street's curb line and its pavement runs on to that street's far curb (`endNeighbours` → `trim`), so a junction is the plain rectangle where two pavements cross; the pads are gone. Same construction in the plan (bands trimmed, pavement extended, curb/property lines trimmed). Lane markings stop 1.5 m short of the junction and two-way streets get stop bars on the approach half.
- **Streets that suddenly narrowed.** The right-of-way layer is a point dataset matched to the nearest block, so an isolated block could pick up a lane's 33 ft value inside a 66 ft street (e.g. 1700 Beach Ave came out at 2.9 m curb-to-curb). At load, a block narrower than 70 % of its same-street neighbours takes their width (`fixRows`, 840 blocks) and the selection card says so, with the original value.
- `assemble.py` reads and writes UTF-8 explicitly (Windows default code page broke the symbols in the sources).

## Known gaps / next steps

- **3D dimension strip** (per-element widths, curb-to-curb, ROW): `label3` is back (used for street labels) but the per-element strip is still to be re-added in `buildStreet` after the movers.
- **One-way direction** is not in Open Data (`one-way-streets` has only the block name and class). The tool assumes +z and labels the assumption; a directional attribute would remove it.
- **Existing bikeway side** is derived from type + direction, not surveyed; a *Bidirectional* facility's side follows the design's side.
- Heights for the 22,276 post-2009 buildings: LiDAR 2022 zonal stats, or Overture Maps.
- Curb lines / corner radii / crosswalk markings: not published; if a *road surfaces* polygon layer exists on the portal it would replace the 5 m assumption.
- Cross-street lane layout at intersections is generic.
- Parks polygons (*Parks polygon representation*) would replace the point circles.
- AADT remains manual.
- Section is always cut at mid-block; a movable cut line would be useful.

## Testing

`node --check` on the concatenated JS, then a headless harness (`/tmp/v2test.js` in the original session) that stubs the DOM, iterates ~170 sampled blocks through `generateOptions` + `checkCompliance` (expects zero errors except the honest non-AAA cases), and runs the 2D renderers. For 3D, install `three@0.128.0` from npm, stub `WebGLRenderer` and `CanvasTexture`, and call `build3D()` — this is how the water-plane bug was found.
