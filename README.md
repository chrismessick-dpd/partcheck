# Partcheck: mechanical package check (prototype)

Partcheck opens a mechanical fab package, meaning what goes to a molder, machine shop or
sheet-metal shop: STEP models, drawing PDFs, DXF flat patterns, and a BOM. For each part it shows:

- a 3D view;
- mass and size;
- whether the files agree with each other.

It's the mechanical counterpart to [Fabcheck](../pcb_dfm/), and part of the Dovetail Signoff suite.
Everything runs in the browser tab, and nothing is uploaded.

**Live:** https://chrismessick-dpd.github.io/partcheck/ (once GitHub Pages is turned on for the repo).

**Status: prototype**, built to show MEs what's possible (2026-11-01). It doesn't store runs or
send findings to Signoff ME yet. The reasoning, and what a full version would take, are in
`../me_fabcheck_exploration/report.md`.

Open `index.html?demo` for the made-up Smart Thermostat packages:
- the enclosure package going to the molder;
- the wall bracket going to the sheet-metal shop.

A few problems are planted in them for the checks to find.

## What it does

- **Package checks** compare what the files say about each part. Each finding names the Signoff ME
  checks it gives evidence for, and in demo mode those chips open the check in Signoff ME's demo
  review.
  - Every part has a model and a drawing; sheet metal has a flat pattern; BOM lines have files.
  - The revision and part number agree across file names, the STEP, the drawing title block, and its
    revision table, the DXF, and the BOM.
  - The model is one closed solid, in mm.
  - The title block has material, finish, a tolerance block, the GD&T standard, units, projection
    and sign-offs.
  - The material on the drawing matches the BOM, and the mass on the drawing matches the model.
  - The flat pattern is at the part's revision and has as many holes as the model.
- **Part facts:**
  - mass (model volume × the density of the material on the drawing);
  - bounding box, volume, surface area, and center of mass;
  - bodies and through-holes;
  - the STEP header (schema, units, originating system, product, revision).
- **Analysis views.** These are color maps for an ME to read, not pass/fail checks.
  - **Draft** for a chosen pull direction and minimum angle.
  - **Wall thickness** by the rolling-ball method: the largest sphere that fits at each point.
- **Previews.** Each part gets a thumbnail (you can pick the view), and a four-view sheet.
- **Preview pack.** This is what Signoff PL would show next to each part. The format is in
  [docs/preview-format.md](docs/preview-format.md).
- **Convert.** Turn STEP, IGES, or STL into STL, OBJ, GLB (glTF, which opens in PowerPoint), or PNG
  views, one file or a whole batch.

## What it doesn't do

- **No geometry DFM.** It doesn't check minimum internal radius, bend radius against thickness,
  hole-to-bend distance, undercuts, or rib ratios. Those need exact surfaces, not the triangle mesh
  the browser gets, which means a Python step on OpenCascade. We're waiting on ME input before
  building it.
- **No native CAD** (SLDPRT, Creo, Inventor). Nothing open-source can read SolidWorks files.
  The Convert page lists the ways to get a STEP.
- **Drawings are read from their text layer by label.** It works on vector PDFs exported from CAD,
  and needs a template's labels added if they differ (`LABELS` in `assets/drawing.js`). It can't
  read a scan, or text exported as outlines.

## Naming files

Name files `<part number>_<rev>_<description>.<ext>`, for example
`2100410-011_B_front-cover.step`. Many STEP exports carry no revision, so the file name is often
the only thing tying a model to its drawing.

## Running it

It needs http, because the STEP reader runs in a worker and a worker can't start from `file://`.
Serve the tools folder:

```bash
python -m http.server 8774 --bind 127.0.0.1 --directory C:/Dovetail/tools
```

Then open `http://127.0.0.1:8774/partcheck/` (add `?demo` for the demo). On GitHub Pages it works
as is.

## Speed (2026-11-01, in a background browser pane)

| | Demo part (~1k triangles) | 80k triangles | 320k triangles |
| --- | --- | --- | --- |
| Loading the STEP reader (first time, then cached) | ~6 s | | |
| Reading the STEP | 0.3–1 s | not measured | not measured |
| Mass, topology | < 10 ms | 0.17 s | 0.45 s |
| One preview image | < 0.1 s | 0.6 s | 1.5 s |
| Wall thickness | 0.2–0.6 s | 11 s | 33 s |

The larger meshes are the demo front cover subdivided. Wall thickness runs in slices with progress
and a time-left estimate, so the page stays usable.

**Real CAD files.** Three of NIST's public-domain PMI test parts (AP242 STEP with their PDF
drawings) went through it on 2026-11-01. They live in `samples/`, which is git-ignored.

| Part | STEP | Triangles | Read | Wall thickness |
| --- | --- | --- | --- | --- |
| CTC-02 | 2.0 MB | 31.5k | 4.0 s | 7.6 s |
| CTC-04 | 1.3 MB | 23.5k | 1.6 s | — |
| FTC-09 | 6.1 MB | 6.8k | 2.6 s | — |

The whole three-part package took 10–11 s once the reader was cached. The test changed four
things, all now covered by tests:

- **Bodies are judged one by one.** All three files carry open surface bodies (construction or
  supplemental geometry) next to the solid, which a whole-file test misread as a broken solid.
- **Loose file names group by shared prefix**, and tags like `asme1` or `ap242` aren't taken for
  part numbers.
- **Drawing notes are read too.** Material, revision, and units given as notes (`5. MATERIAL: …`,
  `Rev D`, `UNITS: INCHES`) are picked up, and a drawing in inches against a model in mm gets a
  note.
- **Flat sheet parts skip the bend-note check.**

## Libraries

All are pinned, and each is checked by its SRI hash:

| Library | Version | Use |
| --- | --- | --- |
| occt-import-js | 0.0.23 | OpenCascade as WebAssembly: STEP, IGES, and BREP to triangles. The `.wasm` is 7.6 MB, about 2.3 MB compressed. It runs in `assets/occt-worker.js` |
| three.js | r149 | The 3D view and the preview renders |
| pdf.js | 3.11.174 | Drawing text and page images |
| JSZip | 3.10.1 | Zipped packages, and the preview pack |

## Layout

| Path | Contents |
| --- | --- |
| `index.html`, `assets/app.js` | The UI |
| `assets/package.js` | Unzipping, file kinds, names (part number and rev), the BOM, the STEP header, grouping into parts |
| `assets/analyze.js` | Reads each part's model, drawing, and DXF, and works out its rev, process, material, and mass |
| `assets/checks.js` | The package checks (`CATALOG`), each with its related Signoff ME check ids |
| `assets/mesh.js` | Mass properties, topology, draft, wall thickness (BVH ray casting and nearest point) |
| `assets/drawing.js` | PDF title block and revision table, and DXF loops, holes, and SVG |
| `assets/materials.js` | Material callouts to family, density, and the usual process |
| `assets/viewer.js` | three.js view and off-screen previews |
| `assets/export.js` | STL, OBJ, GLB, PNG, the preview pack, and the run record |
| `assets/libs.js`, `assets/occt-worker.js` | Pinned library loading; OpenCascade in a worker |
| `assets/suite.css` | Signoff EE's stylesheet, copied by `tools/sync_suite_css.py` |
| `demo/` | The generated Smart Thermostat packages and `demo-package.js` (built by `tools/make_demo.py`) |
| `tests/test.html` | Unit tests, plus both demo packages end to end. Open it over http; the title shows PASS or FAIL |
