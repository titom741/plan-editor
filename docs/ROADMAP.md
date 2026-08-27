# Roadmap

Each mission is scoped to leave a working, tested, buildable app — no
half-finished features spanning missions.

- **KL-001 — Bootstrap & Architecture** *(done)*
  Project scaffold (React + TypeScript + Vite + react-konva), the
  domain/rendering/ui split, the metric coordinate system
  (`worldToScreen` / `screenToWorld` / `metersToPixels` / `pixelsToMeters`),
  the `Project`/`Layer`/`PlanObject`/`Calibration` domain model, default
  layers, a basic desktop layout, a pannable/zoomable canvas with a metric
  grid, and the "Chapiteau principal" 10 × 5 m demo object.

- **KL-002 — Metric Geometry Engine & Object Editing** *(done)*
  `domain/geometry.ts`: pure resize/rotate solve functions
  (`resizeRectangleFromCorner`, `resizeCircleFromHandle`,
  `computeRotationFromPointer`) plus the vector primitives behind them.
  A generic, framework-free undo/redo stack (`history/`). On the canvas:
  create rectangles/circles/lines/polygons/text from the tools palette,
  select, drag to move, resize (rectangle/circle), rotate, delete —
  editable live from the properties panel too, with per-layer lock
  enforcement.

- **KL-003 — Canvas & Background** *(done)*
  Import a PNG/JPEG background (`domain/background.ts`,
  `ui/hooks/useHtmlImage.ts`), render it beneath the grid and objects,
  select/move/resize it (aspect-ratio-locked) and adjust its opacity from
  the properties panel, replace or remove it, per-background visibility/
  lock like a layer. Its placement/size is a manual first-guess — precise,
  guided calibration is KL-005. See the KL-003 mission report for the full
  list of decisions, including a real Konva event-bubbling bug found and
  fixed along the way.

- **KL-004 — Advanced Object Editing** *(done)*
  What KL-002 deliberately deferred. `resizeRectangleFromHandle` covers
  all eight handles (four corners, four edges, `Shift` to keep the aspect
  ratio) with one rule — the opposite handle never moves — so the anchor
  is solved for rather than assumed. Editable line/polygon vertices
  (drag to move, click a midpoint to insert, double-click to remove, with
  a floor on how few points a shape may keep). Two new domain modules:
  `selection.ts` (Shift-click toggling, marquee hit-testing, selection
  extent) and `clipboard.ts` (copy/paste/duplicate with fresh ids and a
  layer fallback). Multi-selection with `Shift`+click and `Shift`+drag
  marquee, group moves solved from a drag-start snapshot, arrow-key
  nudging (`Shift` = 1 m) coalesced into a single undo step, and
  `Ctrl`/`Cmd`+`A`/`C`/`V`/`D`. See the KL-004 mission report for the two
  defects only the browser found.

  Not covered, and still open: resizing or rotating a multi-selection as
  a group (what "resize" means for a circle and a text label in the same
  gesture is a design question, not a missing function); snapping, which
  belongs to KL-007; and the system clipboard — copies live in memory, so
  they don't cross between browser tabs.

- **KL-005 — Calibration** *(done)*
  Interactive calibration: pick two points a known distance apart on the
  background, enter the real distance, and the background's true
  `widthM`/`heightM` are computed from its native resolution
  (`calibrationFromKnownDistance` + `applyCalibration`) — replacing
  KL-003's manual, approximate resize. One undo step covers the
  calibration and the resulting resize together. Also separates
  `Calibration.pixelsPerMeter` (image pixels per meter) from the
  viewport's display scale, which the pre-KL-005 code conflated, and
  fixes shapes swallowing clicks meant for a non-select tool. See the
  KL-005 mission report for the full list of decisions.

  Not covered, and still open: the `knownScale` (1:100) and `geo`
  `CalibrationSource` cases, and calibrating with the plan rotated.

- **KL-006 — Layers** *(this mission)*
  Full layer management: create, rename (double-click), reorder, delete,
  and an **active layer** that new objects land on — KL-002 always
  targeted the first unlocked one. A layer picker in the properties panel
  moves the selection (one object or many) between layers. Deleting a
  layer keeps its objects, moving them to the layer below, and the last
  layer can't be deleted at all. `order` is renormalised to 0, 1, 2… on
  every reorder so it can never develop gaps or duplicates. Objects are
  now drawn in layer order, on screen and in the export alike.

  Not covered, and still open: dragging objects between layers directly
  on the canvas, per-layer default styles, and layer groups/folders.

- **KL-007 — Measurements**
  On-canvas measurement tool (distance, area) and snapping to grid/objects,
  built on the KL-002 geometry primitives.

- **KL-008 — Persistence** *(done)*
  A new `persistence/` layer: `projectFile.ts` (pure — a versioned
  envelope, plus validation that treats every stored or opened file as
  untrusted and never throws) and `projectStorage.ts` (IndexedDB, chosen
  over `localStorage` because a background image blows its ~5 MB budget).
  Autosave with a save-state indicator, restore on launch, and
  `Nouveau` / `Ouvrir…` / `Enregistrer un fichier` for portable `.kl.json`
  copies. Undo/redo itself already worked as of KL-002 — this mission
  persists the project, not the edit history, and deliberately drops the
  history when the document is replaced. See the KL-008 mission report.

  Not covered, and still open: multiple named projects (there is one
  autosave slot), and a "recently opened" list.

- **KL-009 — Export** *(done)*
  `Sheet` becomes functional (paper size, orientation, print scale,
  margin) and a new `printing/` layer puts the plan on paper: a
  hand-written one-page PDF writer, sheet layout with frame, title block
  and a true scale bar, and `domain/bounds.ts` to frame the drawing. PDF
  and PNG export, with the dialog warning — before you print — when the
  plan won't fit at the chosen scale. Verified against real PDFs: page
  exactly 420 × 297 mm on A3 landscape, scale bar exactly 50.000 mm for
  "10 m" at 1:200. See the KL-009 mission report for the three defects the
  first printed sheet revealed.

  Not covered, and still open: vector (rather than raster) drawing inside
  the PDF, multiple sheets per project, and a print preview of the sheet
  before exporting.

---

The roadmap as first drafted is complete, and KL-004 and KL-006 have
closed both of the features deferred from it. Natural next steps, in rough
order of usefulness: KL-007 (measurement and snapping), then multi-sheet plans, a legend/schedule of objects, and
vector PDF output.
