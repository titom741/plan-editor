# Architecture

This document explains how the codebase is organized and, above all, **why the
meters/pixels boundary is enforced the way it is**. If you only read one
section, read [Metric coordinate system](#metric-coordinate-system).

## Layer overview

```
src/
├── domain/       business model + geometry — no React, no Konva, no DOM
├── rendering/    meters ↔ pixels conversion, viewport, grid — no React, no Konva
├── history/      generic undo/redo stack — no React, no domain knowledge
└── ui/           React components + react-konva — the only layer allowed to import React/Konva
```

The dependency direction is strictly:

```
ui/  ──depends on──▶  rendering/  ──depends on──▶  domain/
ui/  ──depends on──▶  history/
```

`domain/` never imports from `rendering/`, `history/`, or `ui/`. `rendering/`
never imports from `ui/`. Nothing in `domain/` or `rendering/` imports
`react`, `react-konva`, or `konva`.

`history/` is new in KL-002 — see [Undo/redo](#undoredo) for why it's a
peer of `domain/`/`rendering/` rather than tucked inside either.

This is enforced by convention and code review in KL-001 (no lint rule wires
it up yet — see [Points to watch](../README.md) in the final report). The
payoff:

- **Testability** — `domain/` and `rendering/` are plain TypeScript modules
  tested with `vitest` in a Node environment, no DOM, no browser, no mocking
  of Konva.
- **Portability** — the business model and the geometry engine could power a
  different renderer (SVG, a desktop shell, a PDF exporter) without change.
- **Clarity** — a bug in "where things are drawn" (rendering/ui) is never
  confused with a bug in "what the project actually contains" (domain).

## Domain model

`src/domain/types.ts` defines the whole business model:

- **`Project`** — id, name, description, location, timestamps, `units`,
  `calibration`, `background`, `layers`, `objects`, `sheets`.
- **`Layer`** — id, name, visible, locked, order. Created in a fixed default
  set (`Structures`, `Électricité`, `Sécurité`, `Annotations`) by
  `createDefaultLayers()`.
- **`PlanObject`** — a discriminated union (`rectangle | circle | line |
  polygon | text`) sharing `PlanObjectBase` (id, layerId, name, optional
  label override, `xM`/`yM` anchor, `rotationDeg`, style). Every geometric
  field is named with an `M` suffix (`widthM`, `heightM`, `radiusM`,
  `pointsM`) as a naming convention that makes it visually obvious, at every
  call site, that the value is in meters — not pixels.
- **`Calibration`** — `pixelsPerMeter` plus a `source` discriminated union
  (`default | knownDistance | knownScale | geo`) so a later calibration UI
  can explain where the scale came from and a `geo`-sourced calibration can
  be added later without a breaking change.
- **`Background`** — modeled as its own type (`BackgroundImage | null`),
  deliberately **not** a `Layer` and **not** a `PlanObject`. It has no
  meaning in meters until the project is calibrated, and it isn't something
  users draw or edit like a business object. The UI (`LayersPanel`)
  presents it alongside the layers as a visual convenience, but the model
  keeps it separate. See [Layer architecture](#layer-architecture).
- **`Sheet`** — prepared (id, name) but not wired into any feature yet; see
  ROADMAP KL-009.

Object construction goes through factory functions in `domain/objects.ts`
(`createRectangleObject`, `createCircleObject`, …) rather than object
literals scattered across the UI, so every object gets a stable id
(`domain/ids.ts`, `crypto.randomUUID()`-based) and consistent defaults.

Labels are **derived, not stored**: `domain/labels.ts` computes
`"<name>\n<width> × <height> m"` (or the user's explicit `label` override)
from the object's current geometry every time it's needed. This means
resizing an object (KL-002 onward) can never leave a stale dimension string
behind, because none is ever persisted. `domain/labels.ts` also owns
`nextObjectName(project, type)`, the `"Rectangle 3"`-style default naming
for newly-created objects.

`domain/project.ts` provides the mutation helpers editing goes through —
`addObject`, `removeObject`, `patchObject(project, id, patch)` — each
returning a new `Project` rather than mutating in place (needed for the
undo stack to hold distinct snapshots) and each a no-op (returns the same
`project` reference) if the target id doesn't exist, since editing code
can legitimately race with a deletion (e.g. a resize-handle drag ending
just after its object was removed).

## Metric coordinate system

This is the architectural rule the rest of the mission is built around:

> **The domain model never uses pixels.** Every `PlanObject` and every
> `Calibration` is expressed in meters (`xM`, `yM`, `widthM`, `heightM`,
> `radiusM`, `pointsM`) and degrees (`rotationDeg`). Zooming or panning the
> canvas changes what the *viewport* looks at — it never rewrites the model.

Two coordinate systems are involved:

```
World coordinates              Screen coordinates
x = meters, y = meters    →    x = pixels, y = pixels
(the business model)           (what Konva actually draws)
```

All conversion between them goes through **one module**,
`src/rendering/viewport.ts`, which owns a `Viewport`:

```ts
interface Viewport {
  basePixelsPerMeter: number; // from the project's calibration
  zoom: number;               // runtime, starts at 1
  offsetXPx: number;          // screen position of world (0, 0)
  offsetYPx: number;
}
```

and four pure functions:

```ts
metersToPixels(meters, viewport)      // scalar: length in meters → pixels
pixelsToMeters(pixels, viewport)      // scalar: length in pixels → meters
worldToScreen({ xM, yM }, viewport)   // point: world → screen
screenToWorld({ x, y }, viewport)     // point: screen → world
```

`getEffectivePixelsPerMeter(viewport) = viewport.basePixelsPerMeter *
viewport.zoom` is the single place the "calibration × zoom" multiplication
happens. Nothing else recomputes a pixel scale by hand — not the grid, not
the object shapes, not the tests.

**No component in `ui/` is allowed to compute a screen position from meters
by hand.** `PlanObjectShape.tsx` (the component that turns a `PlanObject`
into Konva nodes) calls `worldToScreen` for the object's anchor and
`metersToPixels` for every length (width, height, radius, line points,
font size). This is what makes the "10 × 5 m chapiteau" demo meaningful:
the *only* thing that changes when you zoom is the pixel output of that one
function — `widthM`/`heightM` on the object are never touched.

### Zoom and pan

`zoomViewportAt(viewport, screenPoint, factor)` returns a new `Viewport`
with `zoom` scaled by `factor`, clamped to `[DEFAULT_MIN_ZOOM,
DEFAULT_MAX_ZOOM]`, and `offsetXPx`/`offsetYPx` adjusted so the world point
currently under `screenPoint` stays under the cursor after the zoom — the
standard "zoom toward the pointer" behavior. `panViewport(viewport, dx,
dy)` just translates the offset. Both are pure functions: given the same
inputs they return the same output, with no side effects, which is what
makes them straightforward to unit test (see
[`src/rendering/viewport.test.ts`](../src/rendering/viewport.test.ts) and
[`src/rendering/zoom-invariance.test.ts`](../src/rendering/zoom-invariance.test.ts)).

The React-facing wrapper, `src/ui/hooks/useViewport.ts`, owns the
`Viewport` as `useState` and exposes `zoomAt` / `pan` actions that just
call the pure functions above and set state. It also tracks the canvas
container's pixel size — needed to give the `Stage` explicit
`width`/`height` and to compute the grid. That hook is the *only* place
the pure viewport module touches React.

Sizing the canvas turned out to need two mechanisms, not one: a
**callback ref** measures the container's `getBoundingClientRect()` the
instant it's attached to the DOM (during React's commit phase, before the
first paint), seeding a correct size immediately; a `ResizeObserver`
effect then tracks every *subsequent* size change (window resizes, layout
shifts). Relying on `ResizeObserver` alone — which is spec-guaranteed to
fire once immediately on `.observe()` — turned out to be fragile in
practice: in at least one environment encountered during KL-002 testing,
that guaranteed first callback simply never arrived, leaving the canvas
permanently blank (0×0) with no error. The callback-ref measurement is a
redundant, low-cost safety net against exactly that.

### Grid

`src/rendering/grid.ts` computes grid lines from the metric system, not
from a fixed pixel step: `pickGridSpacingM` chooses a "nice" spacing (0.1,
0.2, 0.5, 1, 2, 5, 10 m, …) such that, at the current zoom, consecutive
lines land at least ~60px apart on screen — so the grid stays legible
whether you're zoomed into a 2 m barrier gap or zoomed out over a 300 m
festival site. `computeGridLines` then walks whole multiples of that
spacing in world coordinates and projects each one through `worldToScreen`
to get the actual screen-pixel line — grid lines are never hardcoded in
pixels.

## Geometry engine

`src/domain/geometry.ts` (new in KL-002) is where dragging a resize or
rotate handle turns into new `PlanObject` fields. It has two layers:

- **Vector primitives** — `rotateVector`, `subtractPoints`, `addVector`,
  `vectorLength`, `normalizeAngleDeg` — plain 2D math, in meters, no
  knowledge of any specific shape.
- **Solve functions** — `resizeRectangleFromCorner(object, pointerWorld)`,
  `resizeCircleFromHandle(object, pointerWorld)`,
  `computeRotationFromPointer(pivotWorld, pointerWorld)` — each takes the
  object's *current* geometry plus the pointer's current world position
  and returns the new field(s) (`widthM`/`heightM`, `radiusM`,
  `rotationDeg`), fresh, every call.

That "fresh every call" property is what keeps editing **drift-free**: a
resize handle drag doesn't accumulate a chain of small deltas (each with
its own rounding error) — every pointer-move event recomputes
`widthM`/`heightM` directly from the object's unchanging anchor and
rotation plus the pointer's *current* world position (itself a single
`screenToWorld` conversion, not a running sum). Undo restores the exact
pre-drag object; redo replays to the exact final drag position; the
result is identical whether the object was resized once by 5 m or through
five separate 1 m drags. This is exercised directly in
[`domain/geometry.test.ts`](../src/domain/geometry.test.ts) (round-tripping
a resize/rotate through its own handle-position function should be a
no-op) and end-to-end in
[`rendering/zoom-invariance.test.ts`](../src/rendering/zoom-invariance.test.ts).

Resizing a rectangle is anchored on its top-left corner (`xM`, `yM`) —
the same point `PlanObjectShape` already rotates the shape around (see
below) — by design: dragging the bottom-right resize handle keeps that
anchor fixed and only changes `widthM`/`heightM`, which is both the
simplest possible formula and matches the object's existing rotation
pivot, so resize and rotate never disagree about which point is "fixed."
KL-002 only exposes *this one* corner handle (plus a single radius handle
for circles) rather than a full 8-handle transformer — enough to satisfy
"resize a rectangle or circle with the mouse," while a fully general
"drag any corner, opposite corner stays put, works under rotation" solver
is meaningfully more math for a KL-002-scale mission. See
[Points à surveiller](#points-à-surveiller-repris-du-rapport-de-mission)
in the mission report for what's deferred.

## Undo/redo

`src/history/historyStack.ts` is a generic `{ past, present, future }`
stack (`createHistory`, `pushHistory`, `replacePresent`, `undo`, `redo`) —
no `Project`, no React, nothing editor-specific. It lives in its own
top-level `history/` folder rather than inside `domain/` because it isn't
business geometry (nothing here is about event layouts), and rather than
inside `ui/` because it has nothing to do with rendering or React either —
it's a third, independent kind of concern (generic application state
management), so it gets its own peer folder instead of being bent to fit
one of the other two. It's fully unit-tested on its own in
[`history/historyStack.test.ts`](../src/history/historyStack.test.ts).

`src/ui/hooks/useProjectHistory.ts` binds that generic stack to a
`Project`, exposing three ways to change it, matching the three shapes an
edit takes in this editor:

- **`commitChange(updater)`** — snapshot + apply in one step, for atomic
  edits: creating or deleting an object.
- **`beginEdit()` + `applyLiveEdit(updater)`** — for a *gesture* that
  updates continuously (dragging, resizing, rotating, typing into a
  properties-panel field): `beginEdit()` once, at the start, snapshots the
  "before" state; every subsequent `applyLiveEdit` call during that same
  gesture just replaces the current state, adding no further undo steps.
  A whole drag — however many pointer-move events it generates — collapses
  into exactly one undo entry. `PropertiesPanel` applies the same pattern
  to typing: the first keystroke after a field gains focus calls
  `beginEdit()`, subsequent keystrokes (until the field is refocused)
  don't.
- **`setProjectDirect(updater)`** — bypasses history entirely, for changes
  that shouldn't be undoable (KL-002 uses this for layer visibility/lock
  toggles).

## Rendering architecture

`ui/components/PlanCanvas.tsx` owns the `react-konva` `Stage` and three
`Layer`s: a non-interactive grid layer, the objects layer (also holding
the selection overlay), and a non-interactive draft-preview layer on top
(the in-progress shape while drawing). It:

- Converts wheel events to `zoomAt(pointer, factor)` calls.
- Makes the `Stage` itself draggable — but only while the **select**
  tool is active (see [Interaction model](#interaction-model)) — purely
  as an input source: on every `dragmove` it reads the Stage's
  accumulated displacement, folds it into the viewport via `onPan`, and
  immediately resets the Stage's own position back to `(0, 0)`. This way
  panning has exactly one source of truth (the `Viewport`'s
  `offsetXPx`/`offsetYPx`) instead of two competing transforms (Konva's
  internal drag position *and* our own offset).
- Filters objects by their layer's `visible` flag before rendering, and
  by `locked` before allowing them to be dragged or edited.

`ui/components/PlanObjectShape.tsx` is the single place that pattern-matches
on `PlanObject["type"]` and turns each variant into Konva primitives
(`Rect`, `Circle`, `Line`, `Text`), converting every geometric field through
`rendering/viewport.ts` as described above. Its `Group` is `draggable`
when the select tool is active and the object's layer isn't locked; on
`dragmove` it converts the Group's new *screen* position back to world
coordinates via `screenToWorld` and reports that to `ui/App.tsx` as a live
update — the same "recompute fresh from the current pointer position, never
accumulate" principle as the geometry engine.

`ui/components/SelectionOverlay.tsx` draws the resize/rotate handles for
the current selection and is the only place `ui/` calls into
`domain/geometry.ts`'s solve functions: each handle is a small draggable
Konva `Circle` whose `dragmove` converts its screen position to world
coordinates and feeds that straight into
`resizeRectangleFromCorner`/`resizeCircleFromHandle`/`computeRotationFromPointer`.
No resize/rotate math lives in this component — it only positions handles
(via the same vector primitives) and wires their drags to `domain/geometry.ts`.

### Interaction model

`ui/App.tsx` owns one `activeTool: ToolId` (`"select" | "rectangle" |
"circle" | "line" | "polygon" | "text"`, defined in `ui/tools.ts`) that
`PlanCanvas` switches its pointer behavior on:

- **select** — click an object to select it (click empty canvas to
  deselect), drag an object to move it, drag a handle to resize/rotate,
  drag empty canvas to pan.
- **rectangle / circle / line** — press-drag-release on the canvas draws
  a live dashed preview (`DraftPreview`, local `PlanCanvas` state, never
  touching `Project`) and commits an actual object only on release, and
  only if the drag exceeded a minimum size (guards against an accidental
  single click being read as a zero-size shape).
- **polygon** — click to add each vertex, with a live rubber-band preview
  to the cursor; `Enter` finalizes (3+ points required), `Escape` cancels.
- **text** — a single click places a text object with placeholder
  content, immediately selected, ready to rename from the properties
  panel.

Every tool switches back to **select** and selects the object it just
created, so "draw one shape, immediately see/tweak its real-world
dimensions in the properties panel" (the mission's worked example) is a
single, unbroken motion.

## Calibration concept

`domain/calibration.ts` provides `createDefaultCalibration()` — a
`pixelsPerMeter` of 20 with `source: { type: "default" }` — used until a
background is imported and calibrated (KL-005). The `CalibrationSource`
union already has cases for `knownDistance` (user measures two points on
the background and enters the real distance), `knownScale` (user enters a
map scale like 1:100), and `geo` (reserved, not implemented) — but no
calibration *UI* exists yet, deliberately, per the mission's "don't
over-design" instruction. Recalibrating a project only ever needs to change
`Calibration.pixelsPerMeter`, which flows into `Viewport.basePixelsPerMeter`
— no object's `xM`/`yM`/`widthM`/etc. changes as a result.

## Layer architecture

`Layer` (structural grouping of `PlanObject`s: Structures, Électricité,
Sécurité, Annotations by default) and `Background` (the imported plan
image) are modeled as **separate types** in `domain/types.ts`, joined only
in the *UI* by `LayersPanel.tsx`, which renders the background as an extra,
non-toggleable row above the real layers. The reasoning:

- The background isn't addressable the way a layer is — you don't draw
  business objects "on" it in the data model, you draw them in *world
  coordinates* that happen to line up with the (calibrated) background
  image.
- The background has calibration-specific concerns (`pixelsPerMeter`
  source, image dimensions) that don't apply to a `Layer`.
- Keeping them separate means a future "multiple backgrounds" or "no
  background at all" project doesn't require reshaping `Layer`.

`PlanObject.layerId` is a plain string reference (no back-references, no
class hierarchy) — a `Layer` is deleted or reordered without touching
objects except through explicit, testable operations.

As of KL-002, a locked layer's objects can be selected (read their
properties) but not dragged, resized, rotated, edited from the properties
panel, or deleted — `PropertiesPanel` shows a "🔒 read-only" notice and
disables its inputs instead. `domain/layers.ts`'s
`getDefaultTargetLayer(layers)` picks which layer a newly-created object
lands on: the first unlocked layer in order, falling back to the very
first layer if everything happens to be locked. There is no UI yet to
*choose* a target layer explicitly — that's KL-006.

## Points à surveiller (repris du rapport de mission)

See the KL-002 mission report (delivered alongside this document) for the
full, current list of deferred functionality and known limitations —
kept there rather than duplicated here so it doesn't drift out of sync.
