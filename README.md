# KL — Implantation Événementielle

A local, offline web app for drawing scaled 2D layout plans for events:
import a floor plan, calibrate it, then place chapiteaux, scènes,
installations électriques, barrières, zones de sécurité, etc. at their real
dimensions in meters.

Deliberately **not** a general-purpose CAD tool — it's scoped to fast,
simple event-layout drafting.

Current mission: **KL-006 (Calques)** — create, rename, reorder and
delete layers, choose which one new objects land on, and move a selection
between them. On top of everything
the earlier missions deliver: draw and edit in real-world dimensions with
undo/redo, import and calibrate a background, save the project
automatically, and print it to a true-scale PDF. See
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
- **Drag any of the eight handles** on a selected rectangle — four corners
  and four edge midpoints — to resize it; hold **Maj** to keep its
  proportions. A circle has four handles, one per compass point. The
  handle **above** a selection rotates it.
- **Drag a vertex** of a selected line or polygon to reshape it; **click a
  small dashed dot** on a segment to add a vertex there; **double-click a
  vertex** to remove it (a line keeps at least 2 points, a polygon 3).
- **Delete** / **Backspace** deletes the selection; **Escape** deselects.

**Selecting several objects**

- **Maj + clic** (or `Ctrl`/`Cmd` + clic) adds an object to the selection,
  or removes it if it's already in.
- **Maj + glisser** on empty canvas — or over the background — draws a
  rubber band and selects everything it touches. A plain drag still pans,
  because that's what you do all day.
- **`Ctrl`/`Cmd` + A** selects everything on the visible layers.
- Dragging any member of a multi-selection moves the whole group, keeping
  its arrangement exactly.
- The properties panel shows how many objects are selected and how much
  ground they cover; the per-object fields come back as soon as one is
  selected on its own.

**Moving and copying**

- **Arrow keys** nudge the selection by 10 cm, or by 1 m with **Maj**.
  Holding a key down is one undo step, not fifty.
- **`Ctrl`/`Cmd` + C** / **+ V** copy and paste; **+ D** duplicates in
  place. Each successive paste is offset a little further so copies don't
  stack invisibly, and the copies become the new selection. The clipboard
  lives in the page, so it doesn't cross between tabs.

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

**Saving** — your project is saved automatically in this browser a moment
after you stop editing; the toolbar shows the save state, and reopening the
page restores the project (background image included). That copy is local
to this browser, so use **Enregistrer un fichier** for a real, portable
`.kl.json` copy you can back up or move to another machine, and **Ouvrir…**
to load one back. **Nouveau** starts an empty project (it asks first). A
file that isn't a valid project is refused with an explanation and your
current work is left untouched; opening or creating a project clears the
undo history, since undo can't meaningfully cross from one document into
another.

**Exporting to paper** — **🖨 Exporter…** puts the plan on a sheet: pick a
paper size, orientation and scale, and export a **PDF** or a **PNG**. The
dialog tells you how much ground the sheet covers and how big your plan
actually is, and warns you *before* you print if it won't fit at the
chosen scale (with a one-click "Ajuster" to the nearest standard scale
that does). The scale is never changed for you — a sheet labelled 1:200
is at 1:200.

Print the PDF **without** "fit to page" or any scaling and it is
dimensionally true: at 1:200, one metre on the ground is 5 mm on the
paper. Every sheet carries a title block with the project name, location,
scale, paper size, date, and a scale bar you can check with a ruler.

**Layers** — the bottom bar reads left to right in drawing order: the
leftmost layer is at the back, the rightmost in front (the background is
always behind everything).

- **👁 / 🔒** toggle a layer's visibility or lock it — a locked layer's
  objects can be selected but not edited or deleted. Neither is undoable:
  they change how you *look* at the plan, not the plan itself.
- **Click a layer's name** to make it the **active** layer (marked ●).
  New objects are created there. **Double-click** the name to rename it.
- **◀ ▶** move a layer back or forward in the drawing order; **✕**
  deletes it. Deleting a layer never deletes its objects — they move to
  the layer below, and the confirmation says how many will. The last
  remaining layer can't be deleted.
- **＋ Calque** adds one on top.
- The **Calque** dropdown in the properties panel moves the selection —
  one object or a whole group — to another layer.

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
`domain/geometry.ts` — including drift-free round-tripping under
rotation, and the property the eight-handle resize rests on: the opposite
handle stays put for every handle at every rotation, the dragged handle
lands under the pointer, and the aspect-ratio lock holds exactly even when
the drag is clamped to the minimum size; vertex editing, marquee
hit-testing and the copy/paste rules in `domain/selection.ts` and
`domain/clipboard.ts`; the generic undo/redo stack in `history/`; the background
placement/resize/aspect-ratio logic in `domain/background.ts`; and
calibration — deriving `pixelsPerMeter` from a measured distance,
applying it to the background without touching the plan's objects, and
staying stable (not drifting) when the same segment is recalibrated.
`persistence/` is covered most heavily of all: a project with every
object type round-trips unchanged, and the reader is tested against the
files it will really meet — truncated, hand-edited, written by a newer
version, someone else's JSON, `NaN` that JSON turned into `null`, and a
project whose objects reference a layer that isn't there. `printing/`
pins the property the whole export rests on: a metre is the right number
of millimetres on paper at every scale and resolution, the scale bar is
always exactly as long as its label claims, and the PDF's byte offsets
survive accented characters.

## Lint & build

```bash
npm run lint    # oxlint
npm run build   # tsc -b && vite build
```

## Project layout

```
src/
├── domain/       business model + geometry (Project, Layer, PlanObject, resize/rotate math…) — no React/Konva
├── rendering/    meters ↔ pixels conversion, viewport, grid — no React/Konva
├── history/      generic undo/redo stack — no React, no domain knowledge
├── persistence/  project file format + validation, and local storage — no React
├── printing/     paper geometry, sheet layout, and a minimal PDF writer — no React, no DOM
└── ui/           React components + react-konva
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the reasoning behind
this split and the metric coordinate system.
