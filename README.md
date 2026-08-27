# KL — Implantation Événementielle

A local, offline web app for drawing scaled 2D layout plans for events:
import a floor plan, calibrate it, then place chapiteaux, scènes,
installations électriques, barrières, zones de sécurité, etc. at their real
dimensions in meters.

Deliberately **not** a general-purpose CAD tool — it's scoped to fast,
simple event-layout drafting.

Current mission: **KL-005 (Calibration)** — click two points a known
distance apart on the background, enter the real distance, and the plan is
scaled to its true real-world size. On top of everything KL-002 and KL-003
already deliver: import a PNG/JPEG background and position it, and create,
select, move, resize, rotate, and delete rectangles, circles, lines,
polygons, and text, all working in real-world dimensions with undo/redo. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how it's built and
[`docs/ROADMAP.md`](docs/ROADMAP.md) for what's next.

## Stack

- React + TypeScript + Vite
- react-konva / Konva for the interactive canvas
- Vitest for unit tests
- No backend, no accounts, no network dependency once installed

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

Opens the app at `http://localhost:5173`. It loads a demo project with a
10 × 5 m "Chapiteau principal" rectangle so the metric pipeline (domain
model → viewport → Konva) is visible immediately.

**Canvas**

- **Scroll / wheel** to zoom, centered on the cursor.
- **Drag** empty canvas to pan (select tool only).
- **Click** an object to select it; **drag** it to move it.
- **Drag the corner handle** on a selected rectangle or the edge handle on
  a selected circle to resize; **drag the handle above a selection** to
  rotate it.
- **Delete** / **Backspace** deletes the selected object; **Escape**
  deselects.

**Creating objects** — pick a tool in the left panel, then:

- **Rectangle / Cercle / Ligne** — press, drag, release on the canvas.
- **Polygone** — click to add each point, `Entrée` to finish (3+ points),
  `Échap` to cancel.
- **Texte** — click once to place it, then rename its content from the
  properties panel.

Every tool returns to Selection and selects the object you just drew.

**Properties panel** — edit an object's name, position, dimensions,
rotation, or text directly; the canvas updates live as you type, and
dimensions on the canvas label update live as you drag.

**Undo / redo** — `Ctrl`/`Cmd`+`Z` to undo, `Ctrl`/`Cmd`+`Shift`+`Z` (or
`Ctrl`/`Cmd`+`Y`) to redo, or the toolbar buttons. Covers creation, moving,
resizing, rotating, deleting, and property edits.

**Layers** — click the eye / lock icons in the bottom bar to toggle a
layer's visibility or lock it (a locked layer's objects can be selected
but not edited or deleted).

**Background** — click "Importer un fond de plan…" in the layers bar (or
"Remplacer" in the properties panel once one exists) to choose a PNG/JPEG.
It's placed centered on the current view at an approximate size; select it
to drag it into place, drag its corner handle to resize (aspect ratio is
always preserved — a background is a photo/scan, not a shape to stretch),
and adjust its opacity from the properties panel.

**Calibration** — to give the plan its true real-world scale, select the
background and click **📏 Calibrer**, then click two points on it whose
real distance you know (a door width, a marked dimension, a building
edge) and enter that distance. The background resizes to its true size;
`Échap` cancels at any point, and the whole calibration is a single undo
step. Calibrating never moves your objects and never changes the zoom
level — it corrects the background, not the plan. Recalibrate as often as
you like: each pass measures against the current scale, so repeating it
on the same segment gives the same answer instead of drifting.

## Test

```bash
npm run test
```

Runs the unit tests (`vitest run`) covering: meters↔pixels and
world↔screen conversion round-trips; zoom/pan behavior and zoom's
non-mutation of the business model; the metric grid; object geometry
factories and labels; the resize/rotate solve functions in
`domain/geometry.ts` (including drift-free round-tripping under
rotation); the generic undo/redo stack in `history/`; the background
placement/resize/aspect-ratio logic in `domain/background.ts`; and
calibration — deriving `pixelsPerMeter` from a measured distance,
applying it to the background without touching the plan's objects, and
staying stable (not drifting) when the same segment is recalibrated.

## Lint & build

```bash
npm run lint    # oxlint
npm run build   # tsc -b && vite build
```

## Project layout

```
src/
├── domain/     business model + geometry (Project, Layer, PlanObject, resize/rotate math…) — no React/Konva
├── rendering/  meters ↔ pixels conversion, viewport, grid — no React/Konva
├── history/    generic undo/redo stack — no React, no domain knowledge
└── ui/         React components + react-konva
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the reasoning behind
this split and the metric coordinate system.
