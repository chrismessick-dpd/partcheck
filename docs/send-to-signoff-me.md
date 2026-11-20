# Send to Signoff ME: part pictures and models for Signoff PL

**Status: built on branch `me-send` (2026-11-08), merged to `main` in every repo 2026-11-19.** Chris took the proposed
default for every decision below except 7: the demo is rebuilt in this format, so it always shows
what the real Send stores. This replaces `preview-format.md` (the `signoff-preview/1` proposal, which
never shipped and doesn't match what PL reads).

**As built:**
- **Partcheck:**
  - `assets/send.js` (`PC.send`) and the *Send to Signoff ME…* sheet on Overview and on Previews &
    export.
  - `tools/sync_vendor.py` copies the engine's `model.js` and `github.js` and PL's `model3d.js` into
    `assets/vendor/`.
  - `analyze.js` keeps `p.plMesh`, the model in PL's shape.
  - `tools/pl_demo.html` writes the demo files.
- **Signoff PL:**
  - `reader.js` keeps `parts` (`cleanPart`); `CACHE_V` is 5.
  - `pl.js` has `checkerPart`, `heroPart` and `partViews`.
  - In `app.js`: `previewFor`, `checkerModel` (in `sceneList` and the inspector), `loadMesh(sha,
    repo)`, the *From Partcheck* line, and the Part sheet's note.
  - The demo reads `assets/demo-partcheck.js` and `assets/demo-partcheck/<review>/` through
    `cleanPreview`; `assets/demo-models/` and `config.demo.models` are gone.
- **Signoff ME:** `config.previews.dir` is `partcheck/`; the demo's pictures are in
  `assets/demo-previews/`.
- **Engine:**
  - `workspace.js` `checkerDirs` and `moveChecker` replace `moveFabcheck`.
  - `app.js` `loadPicture` shows the hero part's views, and only links Fabcheck runs.
- **Tests:** Partcheck 22 (Send against PL's fake GitHub, and the demo files current), PL 212,
  EE 199, ME 62, FW 66. PL's `tests/fake-hub.js` answers `GET /repos/<owner>/<repo>` for the
  write probe.
- **Not tried live:** a real Send needs Chris's token in the page.
- **After changing the Send or the demo packages:** open `tools/pl_demo.html`, unzip its download
  into the tools folder, then stamp PL and build ME. Partcheck's last test fails while the files are
  stale.

## Why

Signoff PL shows boards with pictures and in 3D because Fabcheck's Send stores
`fabcheck/<id>/preview/` next to each EE review. Nothing does that for ME parts:

- Partcheck checks STEP, drawing and BOM packages, but sends nothing.
- A real ME Part in PL gets pictures only if someone attaches its STEP in PL by hand.
- The demo's covers and bracket have models only because they were baked into
  `signoff_pl/assets/demo-models/`.

This adds a **Send to Signoff ME** to Partcheck. It stores each part's pictures and a small mesh
with the ME review, the way Fabcheck stores board pictures with an EE review.

## What already works, and what's missing

PL already reads `<tool.previews><reviewId>/preview/index.json` from every repo of a tool that
sets `previews` in `signoff_pl/assets/config.js`. Today only EE does (`"fabcheck/"`). EE's
overview shows the hero image beside the ring through its own `config.previews.dir`.

So, for **pictures of the review as a whole**, three steps would be enough:

1. Partcheck writes `partcheck/<id>/preview/` in Fabcheck's `v: 1` shape.
2. PL's ME tool gets `"previews": "partcheck/"`.
3. ME's `config.js` gets `"previews": { "dir": "partcheck/" }`. That file is ME's own, not an
   engine copy.

**Missing:**
- **A Part per part number.** One ME review covers several parts. The demo Enclosure, `mdemo5`,
  is the front cover 2100410-011 and the back cover 2100410-012, and PL has a Part for each.
  Both link `me:mdemo5`. PL keys previews per review, so today both would show the same hero.
- **The mesh.** PL's 3D Exploded view draws a Part only from a model attached in PL, or a board
  slab from Fabcheck's `board` size.
- **Partcheck's side:**
  - GitHub sign-in;
  - ME's home repo;
  - a picker for the review;
  - the write.

## Measured sizes

These come from PL's own `model3d.prepare` in the page (2026-11-08), on the git-ignored NIST
public-domain samples in `partcheck/samples/`:

| Sample | STEP | Triangles | Mesh (PLM1, gzipped) | Four views as WebP, 480 × 360 | Four views as PNG | Time |
| --- | --- | --- | --- | --- | --- | --- |
| CTC-04 cover | 1.2 MB | 15,490 | 108 kB | 15 kB | 46 kB | 3.8 s |
| CTC-02 plate | 1.9 MB | 23,544 | 167 kB | 29 kB | 89 kB | 4.5 s |
| FTC-09 housing | 6.0 MB | 5,006 | 34 kB | 15 kB | 35 kB | 4.1 s |

- The mesh runs about **7 kB per 1,000 triangles**.
- At PL's cap of 60,000 triangles, that's roughly **0.4 MB per part**.
- All three samples were under the cap, so none were simplified.
- With pictures, a part comes to **about 0.05–0.45 MB per Send**, and only for parts whose
  geometry changed (see *Writing* below).
- The demo parts are about 10 kB each.

For comparison: gzipping the STEP itself took 0.26–1.8 MB. This design never stores the STEP (see
*Not in this round*).

## The stored files

The files go in the ME review's home repo (`me_design_review_data`, or the review's own
`review-me-<slug>` once shared), under the data path:

```
partcheck/<reviewId>/preview/index.json
partcheck/<reviewId>/preview/<pk>-iso.webp        480 × 360, transparent; also -top, -front, -right
partcheck/<reviewId>/preview/<pk>.plm.gz          PL's PLM1 mesh, ≤ 60,000 triangles
```

- `<pk>` is the part number as a lowercase slug (`a-z`, `0-9`, `-`). It's cut to 25 characters,
  so `<pk>-front` stays within the reader's 32.
- A part number that slugs to an empty string, or collides with another part's slug, gets
  `p<n>` instead.
- The raw part number is kept in `index.json`.
- The pictures are drawn by PL's own renderer (`model3d.js`), so they match the pictures of a
  STEP attached in PL and the demo's pictures. They are WebP where the browser can write it,
  else PNG, as Fabcheck does.

### `index.json`

This is Fabcheck's `v: 1`, plus a `parts` list:

```json
{
 "v": 1, "tool": "partcheck", "runId": "k3f9…", "at": "2026-11-08T21:00:00.000Z",
 "hero": "2100410-011-iso",
 "images": [
  { "key": "2100410-011-iso", "file": "2100410-011-iso.webp", "type": "image/webp", "w": 480, "h": 360 },
  { "key": "2100410-011-top", "file": "2100410-011-top.webp", "type": "image/webp", "w": 480, "h": 360 },
  "… every part's four views …"
 ],
 "parts": [
  { "key": "2100410-011", "partNumber": "2100410-011", "revision": "B", "name": "FRONT COVER, SMART THERMOSTAT",
    "views": { "iso": "2100410-011-iso", "top": "2100410-011-top", "front": "2100410-011-front", "right": "2100410-011-right" },
    "mesh": { "file": "2100410-011.plm.gz", "tris": 1248, "srcTris": 1248, "bboxMm": [90, 90, 14] },
    "massG": 25.5, "material": "PC/ABS" }
 ],
 "package": { "name": "Enclosure rev B (to the molder)", "sha256": "…" }
}
```

- **Readers that know only `v: 1`** keep working. EE's and ME's overview and PL's current
  reader see `images` and `hero`, so they show the hero part's iso view.
- **`parts[].views`** names images in `images` by key. A view whose key isn't there is dropped.
- **`mesh.file`** must match `^[a-z0-9-]{1,32}\.plm\.gz$` and be in the repo tree, like every
  image file.
- **`massG`** is the drawing's mass if there is one, else the model's volume × density.
  `material` is the family. Both are optional. PL shows them in the inspector but never writes
  them over the Part's own `massG`. Whether it should is open question 6.
- Readers must cope with missing `parts`, `mesh`, `views` or the whole folder.

## Partcheck: the Send

The Send follows Fabcheck's `pcb_dfm/assets/repo.js`, as a new `partcheck/assets/send.js`.

1. **Sign in.** Partcheck uses the same `signoff.token` key as every tool, so a token set in
   EE, ME or Fabcheck works here. The CSP gains `connect-src https://api.github.com`.
2. **Pick the review.** The list comes from ME's stored projects (`signoff-me.v1.*`), not EE's.
   - It suggests the review whose name or number matches the package (the BOM's top part, then
     the part numbers).
   - It remembers the last review per package name.
3. **Home repo.** Fabcheck's `home()` reads EE's keys. Partcheck reads ME's: `settings`,
   `homes` and `roster.shared`, all under `signoff-me.v1.`. The folder is
   `<dataPath>partcheck/<reviewId>/`. `probe()` checks the token can write there before
   anything is drawn.
4. **Confirm.** The confirm lists the repo and folder, one row per part with a tick box, the
   hero radio and the upload size. Nothing is written before the confirm. Parts whose STEP
   didn't read are listed but can't be ticked.
5. **Make the files.** For each ticked part: Partcheck's OCCT mesh → `model3d.fromOcct`-shaped
   mesh → `simplify(60k)` → `encode`, then four `render`s. There's no second STEP read. The
   meshes Partcheck already holds are reused.
6. **Write.** All the files go in one commit with `GitHubStore.putFiles` (message
   `Partcheck: pictures and models for <n> parts (<package>)`). `putFiles` skips blobs that are
   already there, so a re-send of unchanged parts uploads only `index.json`. The new
   `index.json` lists only the parts sent this time. Files of parts dropped from the index could
   stay in the folder unread, or be removed in the same commit (`putFiles` takes
   `{ path, remove: true }`). That's open question 5.
7. **Afterwards.** A done card links to the review in Signoff ME and to PL. It says PL shows the
   change after its next refresh.

**Vendored into Partcheck** (`tools/sync_vendor.py`, with a `--check` mode, as in Fabcheck and
PL):
- the engine's `model.js` and `github.js` → `assets/vendor/`, for `GitHubStore` and `tokenTag`;
- PL's `model3d.js` → `assets/vendor/`. That makes PL the source for the PLM1 encoder and the
  renderer, so a format change happens in one place. PL's `occt-worker.js` is already a copy of
  Partcheck's.

**Demo:** in `?demo`, Send runs everything except the network. It shows the confirm and the
files with their sizes, then says the demo doesn't write. PL's demo keeps its baked models.
Whether to rebuild them through this format is open question 7.

## Signoff PL: reading it

1. **`config.js`:** the ME tool gets `"previews": "partcheck/"`.
2. **`reader.js`:**
   - `cleanPreview` and `keepPreview` keep `parts`, with each part's views resolved to image
     keys and its mesh resolved to `{ sha, size, tris, bboxMm }` from the tree. Today
     `keepPreview` would drop them, and `cleanIndex` re-runs it on every load, so this is the
     change that matters.
   - Bump `CACHE_V` to 5. Strictly, previews are re-cleaned from the cached raw doc, so the old
     cache would pick `parts` up. The bump makes sure every ME repo's tree is listed once with
     the new `previews` folder.
3. **`app.js`:**
   - **`previewFor(n, entry)`:** for a `source: 'me'` Part, take the `parts` item whose
     `partNumber` equals the Part's `number` (trimmed, case-insensitive). It returns a picture
     set shaped like `modelPreview` (keys iso, top, front, right). Otherwise it returns the
     review's preview as today, with its hero. A STEP attached in PL wins, as today (open
     question 4).
   - **`sceneList`:** an `me` Part with no attached model, whose matched part has a mesh, joins
     the scene as `kind: 'model'` with `{ repo, sha }` from the preview.
   - **`loadMesh(repo, sha)`:** today it always reads PL's home repo (`homeOf(current())`). It
     takes the repo from the preview instead. `fileBlob` already fetches by sha from any repo
     and caches in IndexedDB.
   - **The inspector** shows the part's line: file, size, triangles, mass, "from Partcheck, \<date\>".
   - **The Part sheet's "3D model" field** says "From Partcheck (\<date\>)" when it applies, so
     nobody attaches a STEP that would hide it without knowing.
   - Exploded places the mesh in its CAD coordinates, the same as an attached STEP, so existing
     `place` values mean the same thing.

## Signoff ME and the engine

- **ME `config.js`:** `"previews": { "dir": "partcheck/" }`. The overview shows the hero beside
  the ring. No `runs`: there's no Revisions tab for ME this round.
- **Engine (`ee_design_review/assets/workspace.js`):** `moveFabcheck` copies only
  `fabcheck/<id>/` when a review is shared into its own repo. An ME review's `partcheck/<id>/`
  would stay behind, and PL would lose the pictures (it reads the review's current repo). This
  needs a generalized move: the folders named by `config.previews.dir` and `config.runs.dir`,
  else `fabcheck/`. That's an engine change, built in EE and synced to ME and FW, then
  re-vendored where `workspace.js` goes.
- **PL's share** needs nothing more. `share.js` moves each tool's `previews` folder along with
  the review (`tool.files`), so `"previews": "partcheck/"` in PL's config already covers a PL
  share.

## Tests (the done criteria once built)

- **Partcheck:** `tests/test.html` gains a Send test against a fake GitHub (PL's
  `tests/fake-hub.js` pattern). It sends the demo enclosure package (two parts) and checks:
  - the commit's paths;
  - `index.json` against the shape above;
  - that a second send of the same package uploads only `index.json`.
- **PL:** a fake `review-me-x` repo holding `partcheck/<id>/preview/` for two parts. The checks:
  - each Part's picture resolves by part number;
  - a Part with no number match falls back to the hero;
  - the mesh loads from `review-me-x`, not PL's repo;
  - `sceneList` includes the Part as a model;
  - an attached STEP still wins;
  - a preview without `parts` (Fabcheck-shaped) behaves exactly as today.
- **ME:** the overview shows the hero from a fake store. The engine's move test covers
  `partcheck/`.
- EE, ME, FW and PL tests pass after the engine sync. Every touched repo gets stamped.

## Not in this round

- Run records, findings and Signoff ME issues. That's Phase 2 in
  `me_fabcheck_exploration/report.md` and needs an ME "Fab Package Check" template.
- Storing the STEP, PDF or DXF. That's package storage, a Phase 2 decision with its own size
  question.
- An ME Revisions tab.
- Partcheck → Signoff deep links ("Open in Partcheck").

## Decisions (Chris, 2026-11-08: the defaults, except 7, which became "rebuild the demo")

1. **Which part represents the review** (the hero: ME's overview, PL's tray and picker, and a
   PL Part whose number matches nothing). Proposal:
   - each PL Part shows its own part by part number;
   - the hero defaults to the largest part by bounding-box volume (the front cover over the back
     cover);
   - the Send confirm lets you pick another.

   Other options: the BOM's first line, or always ask.
2. **Mesh, or pictures only.** Proposal: both.
   - The mesh is the point for Exploded.
   - It's about 7 kB per 1,000 triangles, at most about 0.4 MB per part, and only re-uploaded
     when a part's geometry changes.
   - Pictures only would be about 15–30 kB per part, but ME Parts would still be missing from
     3D.
3. **Repo size.** Proposal: keep PL's 60,000-triangle cap, and keep only the latest copy in
   `preview/`. Git history keeps the old blobs, so ten re-sends of a large changed part add
   about 4 MB. Would you rather have a lower cap for Partcheck sends (say 30,000, about
   0.2 MB)?
4. **Attached STEP vs. Partcheck.** For boards, Fabcheck's pictures beat an attached model on
   tiles. For ME Parts, should Partcheck's stored model beat a STEP attached in PL? The proposal
   is no: an attached STEP is a deliberate choice on that Part, and the inspector says a
   Partcheck model exists.
5. **Parts no longer sent.** Proposal: a full-package Send removes the `preview/` files no part
   uses any more, in the same commit (`putFiles` `remove`). A Send with some parts unticked
   keeps the others' entries and files from the last `index.json`. Other option: never remove
   anything.
6. **Mass.** Should PL offer "Use Partcheck's 25.5 g" on a Part whose `massG` differs, or only
   show it?
7. **The demo.** Keep PL's baked demo models, or rebuild them as a stored Partcheck preview
   under `mdemo5` and `mdemo13`, so the demo walks the real path? Rebuilding means
   `config.demo.previews` gains per-part entries and the PL snapshot is regenerated.
8. **The engine move** (shared ME reviews take their `partcheck/` folder along). OK to include
   in this round? It touches every engine copy.
