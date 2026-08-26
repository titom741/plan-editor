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

- **KL-002 — Metric Geometry Engine & Object Editing** *(this mission)*
  `domain/geometry.ts`: pure resize/rotate solve functions
  (`resizeRectangleFromCorner`, `resizeCircleFromHandle`,
  `computeRotationFromPointer`) plus the vector primitives behind them.
  A generic, framework-free undo/redo stack (`history/`). On the canvas:
  create rectangles/circles/lines/polygons/text from the tools palette,
  select, drag to move, resize (rectangle/circle), rotate, delete —
  editable live from the properties panel too, with per-layer lock
  enforcement. See the KL-002 mission report for the full list of
  interaction and architecture decisions.

- **KL-003 — Canvas & Background**
  Import a PNG/JPEG background, position and scale it, render it as the
  bottom layer beneath the grid and objects.

- **KL-004 — Advanced Object Editing**
  What KL-002 deliberately deferred: multi-selection, additional resize
  handles (edges, all four corners with a `Shift`-to-keep-aspect-ratio
  modifier), editable line/polygon vertices, copy/paste, keyboard nudging
  and arrow-key movement.

- **KL-005 — Calibration**
  Interactive calibration UI: click two points on the background, enter
  the real distance (or a known scale), compute and store
  `Calibration.pixelsPerMeter`.

- **KL-006 — Layers**
  Full layer management UI: create/rename/reorder/delete layers, assign
  objects to a chosen layer (KL-002 always targets the first unlocked
  one), drag objects between layers. Visibility/lock toggling and lock
  enforcement on the canvas already work as of KL-002.

- **KL-007 — Measurements**
  On-canvas measurement tool (distance, area) and snapping to grid/objects,
  built on the KL-002 geometry primitives.

- **KL-008 — Persistence**
  Local save/load (e.g. to a project file or browser storage). Undo/redo
  itself already works as of KL-002 (`history/`) — this mission is about
  persisting a project across sessions, not the edit history.

- **KL-009 — Export**
  PDF export, PNG/JPEG export, print scale, and making `Sheet` functional.
