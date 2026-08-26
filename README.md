# KL — Implantation Événementielle

A local, offline web app for drawing scaled 2D layout plans for events:
import a floor plan, calibrate it, then place chapiteaux, scènes,
installations électriques, barrières, zones de sécurité, etc. at their real
dimensions in meters.

Deliberately **not** a general-purpose CAD tool — it's scoped to fast,
simple event-layout drafting.

Current mission: **KL-002 (Metric Geometry Engine & Object Editing)** —
create, select, move, resize, rotate, and delete rectangles, circles,
lines, polygons, and text on the canvas, all working in real-world
dimensions with undo/redo. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for how it's built and [`docs/ROADMAP.md`](docs/ROADMAP.md) for what's next.

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

## Test

```bash
npm run test
```

Runs the unit tests (`vitest run`) covering: meters↔pixels and
world↔screen conversion round-trips; zoom/pan behavior and zoom's
non-mutation of the business model; the metric grid; object geometry
factories and labels; the resize/rotate solve functions in
`domain/geometry.ts` (including drift-free round-tripping under
rotation); and the generic undo/redo stack in `history/`.

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
