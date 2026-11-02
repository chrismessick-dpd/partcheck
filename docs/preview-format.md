# Preview format (`signoff-preview/1`)

**Status: proposal (2026-11-01).** Partcheck writes this format into the zip that **Download
preview pack** gives you. Nothing stores it in a repo yet, and Signoff PL doesn't read it yet.

The format is meant to be shared with Fabcheck's board previews, so PL needs only one reader. If
the PL redesign settles on something else, change this file first.

## Where it would live

It would go in the review's private repo, next to the stored runs, as the latest copy. Each stored
run overwrites it:

```
partcheck/<projectId>/preview/index.json
partcheck/<projectId>/preview/<key>.png          320 × 240, transparent, about 10–40 kB
partcheck/<projectId>/preview/<key>-views.png    640 × 480: iso, top, front, right
partcheck/<projectId>/preview/<key>.json         facts about one part
```

`<key>` is the part number, made filename-safe. Fabcheck would use the same layout under
`fabcheck/<projectId>/preview/`, keyed by board.

Don't put it in the project JSON. That file syncs on every write, and `project.summary` must
depend only on the document and the checklists.

## `index.json`

```json
{
  "format": "signoff-preview/1",
  "tool": { "name": "Partcheck", "version": "<build>" },
  "at": "2026-11-01T22:58:00.000Z",
  "package": { "name": "Enclosure rev B (to the molder)", "sha256": "<package fingerprint>" },
  "hero": "2100410-011",
  "items": [
    { "key": "2100410-011", "partNumber": "2100410-011", "revision": "B", "name": "FRONT COVER, SMART THERMOSTAT",
      "png": "2100410-011.png", "views": "2100410-011-views.png", "json": "2100410-011.json" }
  ]
}
```

`hero` is the part that represents the review in PL. One review can cover several parts: the demo
Enclosure is a front cover and a back cover.

## `<key>.json`

```json
{
  "partNumber": "2100410-011", "revision": "B", "name": "FRONT COVER, SMART THERMOSTAT", "process": "molded",
  "material": "PC/ABS, SABIC CYCOLOY C1200HF, WHITE (CMF-01)", "materialFamily": "PC/ABS", "density_g_cm3": 1.15,
  "volume_mm3": 22140.5, "area_mm2": 21782.7, "mass_g": 25.46, "massSource": "computed: model volume × density",
  "massOnDrawing_g": 25.5, "bbox_mm": [90, 90, 14], "bodies": 1, "closed": true, "throughHoles": 1,
  "findings": { "error": 0, "warn": 0, "info": 1 },
  "model": { "file": "2100410-011_B_front-cover.step", "sha256": "<sha256>" },
  "at": "2026-11-01T22:58:00.000Z"
}
```

Readers must cope with any field being `null` or missing, and with the whole folder being absent
(no run yet).

## How PL would read it

PL is FTE-only, and FTEs are on every ME repo. It would:

1. fetch `index.json` (one small request);
2. fetch the hero PNG with the raw-contents `Accept` header;
3. cache both in IndexedDB by blob sha.

A reload then fetches nothing that hasn't changed.
