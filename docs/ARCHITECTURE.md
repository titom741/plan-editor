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
├── persistence/  saving and (above all) safely re-reading a project — no React
├── printing/     paper geometry and a minimal PDF writer — no React, no DOM
└── ui/           React components + react-konva — the only layer allowed to import React/Konva
```

The dependency direction is strictly:

```
ui/  ──depends on──▶  rendering/  ──depends on──▶  domain/
ui/  ──depends on──▶  history/
ui/  ──depends on──▶  persistence/  ──depends on──▶  domain/
ui/  ──depends on──▶  printing/     ──depends on──▶  domain/, rendering/
```

`domain/` never imports from `rendering/`, `history/`, `persistence/`, or
`ui/`. `rendering/` never imports from `ui/`. Nothing in `domain/` or
`rendering/` imports `react`, `react-konva`, or `konva`.

`history/` is new in KL-002 — see [Undo/redo](#undoredo) for why it's a
peer of `domain/`/`rendering/` rather than tucked inside either.
`persistence/` is new in KL-008 — see [Persistence](#persistence). It is
the one non-`ui/` layer allowed to touch a browser API, and even there the
concession is confined to a single file. `printing/` is new in KL-009 —
see [Printing and export](#printing-and-export) — and touches nothing but
numbers and bytes.

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
  polygon | text | image | symbol`) sharing `PlanObjectBase` (id, layerId, name, optional
  label override, `xM`/`yM` anchor, `rotationDeg`, style). Every geometric
  field is named with an `M` suffix (`widthM`, `heightM`, `radiusM`,
  `pointsM`) as a naming convention that makes it visually obvious, at every
  call site, that the value is in meters — not pixels.
- **`Calibration`** — how many pixels *of the background image* make up one
  meter, plus a `source` discriminated union
  (`default | knownDistance | knownScale | geo`) so the properties panel
  can explain where the scale came from and a `geo`-sourced calibration can
  be added later without a breaking change. Not a screen scale — see
  [Calibration](#calibration) (KL-005).
- **`Background`** — modeled as its own type (`BackgroundImage | null`),
  deliberately **not** a `Layer` and **not** a `PlanObject`. The UI
  (`LayersPanel`) presents it alongside the layers as a visual
  convenience, but the model keeps it separate. See
  [Layer architecture](#layer-architecture),
  [Background image](#background-image) (KL-003) for its placement fields
  and [Calibration](#calibration) (KL-005) for how its true size is set.
- **`Sheet`** — a printable page: paper size, orientation, print scale and
  margin. A placeholder (`id`, `name`) until KL-009 made it functional —
  see [Printing and export](#printing-and-export).

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
  basePixelsPerMeter: number; // display scale — NOT the project's calibration
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
viewport.zoom` is the single place the "display scale × zoom"
multiplication happens. Nothing else recomputes a pixel scale by hand — not
the grid, not the object shapes, not the tests.

`basePixelsPerMeter` is purely about how big a meter is *drawn*; it is
independent of `Calibration.pixelsPerMeter`, which describes the background
image rather than the screen. See [Calibration](#calibration).

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
- **Frame conversions** — `worldToObjectLocal` / `objectLocalToWorld`
  (added in KL-004), which express a world point in an object's own
  unrotated frame and back. Everything that has to reason about "where
  the pointer is *on the shape*" goes through this pair instead of doing
  its own trigonometry, which is why a rotated object behaves exactly
  like an unrotated one everywhere.
- **Solve functions** — `resizeRectangleFromHandle(object, handle,
  pointerWorld, options)`, `resizeCircleFromHandle(object, pointerWorld)`,
  `computeRotationFromPointer(pivotWorld, pointerWorld)`,
  `moveVertexTo(object, index, pointerWorld)` — each takes the object's
  *current* geometry plus the pointer's current world position and
  returns the new field(s) (`xM`/`yM`/`widthM`/`heightM`, `radiusM`,
  `rotationDeg`, `pointsM`), fresh, every call.

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
KL-002 only exposed *this one* corner handle (plus a single radius handle
for circles) rather than a full 8-handle transformer — enough to satisfy
"resize a rectangle or circle with the mouse," while a fully general
solver was meaningfully more math for a KL-002-scale mission. KL-004
generalises it: see [Advanced editing](#advanced-editing-kl-004) below.
`resizeRectangleFromCorner` and `getRectangleResizeHandleWorld` survive as
one-line wrappers over the general functions, so there is exactly one
implementation of the resize maths and the KL-002 tests still pin it.

## Advanced editing (KL-004)

KL-004 is the mission that goes back for everything KL-002 deferred:
eight resize handles instead of one, editable line/polygon vertices,
multi-selection, copy/paste, and arrow-key nudging.

### The rule that makes eight handles one function

`resizeRectangleFromHandle(object, handle, pointerWorld, options)` covers
all eight handles with a single rule: **the diagonally opposite handle
stays exactly where it is in world space.** Everything else follows from
it — the pointer is un-rotated into the rectangle's own frame relative to
that fixed point, the new width/height read straight off the result, and
the anchor is then placed so the fixed handle lands back where it was.

That last step is the substantive change from KL-002: for six of the eight
handles the anchor *moves*, so the function returns a full placement
(`xM`, `yM`, `widthM`, `heightM`) rather than just a size. Edge handles
fall out of the same formula for free — an edge handle is simply one whose
unit coordinate is `0.5` on the axis it doesn't drive.

`keepAspectRatio` (Shift in the UI) scales both axes together. It clamps
the *scale* rather than each side, because clamping the sides
independently would distort the shape at the minimum size — quietly
breaking the one property the modifier exists to protect.

### Vertices, and why the anchor doesn't move

`getVertexWorld` / `moveVertexTo` / `insertVertexAfter` / `removeVertexAt`
edit a line's or polygon's `pointsM`. Dragging vertex 0 deliberately does
*not* re-normalise the anchor, even though vertex 0 normally sits on it:
the anchor is the rotation pivot, and moving it mid-drag would make the
shape swim under the user's hand. The model has never required a vertex to
sit on the anchor, so nothing else has to change.

`removeVertexAt` refuses rather than obliges when the result would have
fewer than `MIN_LINE_POINTS` / `MIN_POLYGON_POINTS` points. A polygon with
two vertices is not a degenerate polygon, it is not a polygon.

### Selection as a value

`domain/selection.ts` holds the questions that only become geometry once
more than one object can be selected: `toggleSelection` (the Shift-click
rule), `boundsFromCorners` (a marquee dragged up-and-left is the same box
as one dragged down-and-right), `objectIdsWithinBounds`, and
`getSelectionBoundsM`.

Marquee hit-testing is done against each object's axis-aligned bounding
box, not its true outline. A marquee is a rough gesture, and the failure
it produces — catching slightly too much — is the forgiving one.

### Copy/paste

`domain/clipboard.ts`'s `duplicateObjects` gives each copy a fresh id, a
paste offset, and a home: an object whose layer has since been deleted is
rehomed onto the default target layer instead of becoming invisible and
unreachable. Names are carried over unchanged — two objects called
"Chapiteau principal" after a copy is honest, and "(copie) (copie)" on the
second paste would be worse than the ambiguity it avoids.

The editor's clipboard is a `useRef` holding real `PlanObject`s. This is a
single-window, offline app: there is no system clipboard round-trip to
survive, and therefore nothing to serialise or re-validate.

### Group moves are solved from an origin, never accumulated

`Editor.handleBeginObjectDrag` snapshots every selected object's position
when a drag starts; each frame then computes `origin + total delta` for
all of them. Applying this frame's delta to the previous positions would
drift — and drift differently for each member of the group, which is worse
than drifting uniformly, because the arrangement the user built comes
apart.

Arrow-key nudging takes the opposite precaution for the opposite reason:
the new positions are computed *inside* the state updater, from the
project as it is at that moment, so a key repeating faster than React
re-renders can't lose presses to a stale snapshot. Presses less than
`NUDGE_COALESCE_MS` apart collapse into one undo entry, so holding an
arrow down doesn't bury every earlier edit under fifty history steps.

### Two defects the browser found (and the unit tests could not)

1. **The selection didn't follow a paste.** `pasteObjects` read the new
   ids back out of the `commitChange` updater — which only works while
   React takes its eager-evaluation path. It doesn't always. The copies
   appeared, the selection stayed on the originals. Fixed by building the
   copies *before* the state update; `handleCreateObject` had the same
   latent bug and got the same fix.
2. **The marquee panned the plan instead.** Konva decides a node is being
   dragged inside the same `pointerdown` dispatch, so flipping the Stage's
   `draggable` prop from the mousedown handler is a render too late — and
   once Konva is dragging, it stops delivering plain `mousemove` events, so
   the rubber band never followed the pointer either. Fixed by tracking
   Shift globally (`keydown`/`keyup`/`blur`) and having `draggable` already
   be `false` before the mouse goes down.

### Why Shift+drag, and not plain drag, draws the marquee

The fashionable choice would have been plain drag for the marquee with
panning moved to a modifier. This app is panned constantly, by the same
people, all day; changing that would have been a daily regression in
exchange for matching a convention from tools that are used differently.
Shift already means "add to the selection" for a click, so it means the
same thing for a drag.

One consequence had to be handled explicitly: an imported plan covers the
whole canvas, so "empty space" is in practice the *background image*, not
the bare Stage. `PlanCanvas` therefore treats a pointer event on the node
named `BACKGROUND_NODE_NAME` as empty space, and `BackgroundImageShape`
refuses to start its own drag while Shift is held.

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
"circle" | "line" | "arrow" | "polyline" | "polygon" | "text" | "symbol"`,
defined in `ui/tools.ts`) that
`PlanCanvas` switches its pointer behavior on:

- **select** — click an object to select it (click empty canvas to
  deselect), `Shift`/`Ctrl`/`Cmd`+click to add or remove one,
  `Shift`+drag on empty canvas to rubber-band several; drag an object (or
  any member of a multi-selection) to move it, drag a handle to
  resize/rotate, drag a vertex to reshape a line or polygon, drag empty
  canvas to pan.
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
- **arrow** — the line gesture exactly, committed as a `line` whose style
  carries `arrowEnd`. It is not a type of its own: the arrowhead has been
  a line style since KL-002, and a second representation of the same
  thing would have to be kept in step in the renderer, the exporters and
  the file reader for no gain. Only the naming knows the difference (see
  `ObjectNameKind` in `domain/labels.ts`), so a plan of arrows is not a
  plan of "Ligne 7".
- **symbol** — a single click places a `symbol` object carrying the
  character currently chosen in the palette. Anchored on its **centre**
  (like a circle, unlike a text) because it marks the point it is put on,
  and sized in metres of ground so it holds its real size at every zoom.

Every tool switches back to **select** and selects the object it just
created, so "draw one shape, immediately see/tweak its real-world
dimensions in the properties panel" (the mission's worked example) is a
single, unbroken motion.

## Background image

KL-003 lets the user import a PNG/JPEG as the project's background,
position it, and scale it — everything short of the precise, guided
calibration that's KL-005's job. It reuses as much of the existing
pipeline as possible rather than inventing a parallel one:

- **`domain/background.ts`** gives `BackgroundImage` the same
  "anchor + size in meters" shape as `RectangleObject`
  (`xM`/`yM`/`widthM`/`heightM` plus a top-left-anchored rotation — see
  [Layer architecture](#layer-architecture)), so `ui/components/BackgroundImageShape.tsx`
  renders and drags it through the *exact same* `worldToScreen` /
  `metersToPixels` / `screenToWorld` calls as any `PlanObject`, and its
  resize handle reuses `domain/geometry.ts`'s
  `resizeRectangleFromCorner`/`getRectangleResizeHandleWorld` directly
  rather than duplicating that math. KL-016 also applies non-destructive
  brightness, contrast and grayscale corrections in both renderers.
- **Aspect ratio is locked.** A background is a photograph or scan of
  something real — stretching it non-uniformly would distort it and make
  any later calibration meaningless. `resizeBackgroundFromCorner`,
  `resizeBackgroundFromWidth`, and `resizeBackgroundFromHeight` (all in
  `domain/background.ts`) always derive the field the user *didn't* just
  set from the source image's native `widthPx`/`heightPx` ratio, whether
  the resize came from dragging the corner handle or typing into the
  properties panel's Largeur/Hauteur fields — one aspect-ratio rule,
  reached from either interaction path.
- **First-guess placement on import.** `computeDefaultBackgroundPlacement`
  centers the imported image on the viewport's current center and sizes
  it using the project's *current* `Calibration.pixelsPerMeter` as a naive
  scale — reasonable enough to look right immediately, but explicitly not
  a claim about the image's true real-world size. The properties panel
  says as much until the plan is calibrated. Manual corner-drag /
  Largeur-Hauteur resizing stays available as a rough adjustment and never
  touches `Calibration`; getting the size *right* is what
  [Calibration](#calibration) does.
- **Loading the image.** `ui/hooks/useHtmlImage.ts` turns a URL (a
  `data:` URL from `FileReader`, in `App.tsx`'s import handler — kept
  in-memory only, nothing is written to disk; see
  [Points à surveiller](#points-à-surveiller-repris-du-rapport-de-mission))
  into a plain `HTMLImageElement`, which is what react-konva's `<Image>`
  needs. Small enough not to justify a dependency for it.
- **Selection is separate from object selection.** A background isn't a
  `PlanObject`, so it can't share `selectedObjectId`; `App.tsx` tracks a
  separate `isBackgroundSelected` boolean, kept mutually exclusive with
  the object selection (selecting one clears the other). `PlanCanvas` and
  `PropertiesPanel` branch on whichever is set.

## A note on Konva event bubbling (KL-003 bugfix)

While testing background dragging, a real bug surfaced: `<Stage
onDragMove={handleStageDragMove}>` (see [Rendering architecture](#rendering-architecture))
was firing not only when the Stage itself was dragged, but also — via
Konva's normal event bubbling — when *any draggable child* (an object, the
background) was dragged, with `e.target` set to that child. Read naively,
`handleStageDragMove` would treat the child's own position as a pan delta
and fold it into the viewport offset, then forcibly reset the child's
position to `(0, 0)`, fighting its own drag. Depending on timing this
could compound across a single drag gesture into a wildly wrong final
position — a real, reproducible bug, not just a testing artifact.

The fix is a one-line guard: `handleStageDragMove` now returns immediately
unless `e.target === e.target.getStage()`. Every child's own `onDragMove`
handler (`PlanObjectShape`, `BackgroundImageShape`, and the
`SelectionOverlay` handles) also sets `e.cancelBubble = true` as a second,
defense-in-depth layer. Regular object dragging happened not to exhibit
this visibly during KL-002's manual testing — plausibly because Konva's
drag module suppresses this bubbling under normal mouse timing and it only
surfaced under this project's synthetic, script-driven test events — but
the underlying gap was real and is now closed for every draggable node,
not just the background.

## Calibration

KL-005 turns `Calibration` from a placeholder into a real, user-driven
value: the user clicks two points a known distance apart on the
background, types what that distance actually is, and the background's
`widthM`/`heightM` are recomputed from its native pixel resolution.

**What `pixelsPerMeter` means — and what it does not.** As of KL-005 it is
strictly *pixels of the background image per real-world meter*: a property
of the imported photo/scan. It is **not** a screen scale. How big a meter
is drawn on the monitor is `Viewport.basePixelsPerMeter`, seeded from
`DEFAULT_SCREEN_PIXELS_PER_METER` in `rendering/viewport.ts`.

These two were conflated before calibration existed — `App.tsx` seeded the
viewport from `project.calibration.pixelsPerMeter`, harmless only because
nothing ever changed that value. Giving it a real meaning made the
conflation a bug in waiting: calibrating a plan (or, once KL-008 lands,
merely *loading* an already-calibrated one) would have silently jumped the
user's zoom level to an arbitrary number. KL-005 separates them. The
observable result is the correct one: **calibrating corrects the
background, never the camera and never the plan** — the zoom indicator
stays put, every `PlanObject` keeps its exact `xM`/`yM`/`widthM`, and only
the background resizes underneath them.

The pieces:

- **`calibrationFromKnownDistance(pixelDistance, realDistanceM)`**
  (`domain/calibration.ts`) is the whole computation: `pixelsPerMeter =
  pixelDistance / realDistanceM`, recorded with a
  `source: { type: "knownDistance", … }` carrying both inputs, so the
  properties panel can explain where the number came from and a later
  recalibration is traceable.
- **`worldDistanceToImagePixels`** (`domain/background.ts`) bridges the
  measurement to that function. The user measures on the *rendered*
  background, whose current size may still be the wrong first guess — so
  the segment is converted into the image's own pixels (via the
  background's current `widthPx / widthM` ratio) before being handed over.
  Measuring in image pixels is what makes the result independent of the
  scale it was measured at, and what makes recalibration idempotent: fed
  the same physical segment and the same real distance twice, the second
  pass lands on the same `pixelsPerMeter` rather than drifting (there's a
  test pinning exactly this).
- **`applyCalibration(project, calibration)`** (`domain/project.ts`) is
  the only way calibration is committed, because the calibration and the
  background's size are two views of one fact and must never disagree: it
  sets the calibration *and* recomputes `widthM`/`heightM` via
  `resizeBackgroundToCalibration`, leaving the anchor (`xM`/`yM`) and
  every object untouched. One domain call ⇒ one `commitChange` ⇒ **one
  undo step** that restores both.
- **The gesture** spans `PlanCanvas` (a `calibrate` draft in the same
  `Draft` union as the drawing tools — two clicked points, a live
  preview with a running distance readout) and `App.tsx` (which owns the
  `CalibrationDialog` asking for the real distance). `calibrate` is a
  real `ToolId` but deliberately absent from `TOOLS`: it's reachable only
  from the background's properties panel, being meaningless without a
  background. `Escape` cancels at any stage.

`CalibrationSource.knownScale` is now produced by KL-017 from a map scale
(for example 1:100) and the raster DPI. `geo` remains the seam for a future
coordinate-system implementation.

### A design bug this surfaced

Wiring the gesture exposed a second real defect, older than KL-005:
`PlanObjectShape` and `BackgroundImageShape` both set
`e.cancelBubble = true` in their click handlers *unconditionally*. That is
correct for the select tool, but it meant a click that landed on any
existing shape never reached the Stage — so with a non-select tool active,
the click was swallowed. For calibration this was fatal by construction
(you calibrate by clicking *on* the background), and the polygon tool had
the same latent hole: a point could not be added on top of an existing
object. Both components now take a `selectable` prop (true only under the
select tool) and let the event bubble when it's false, so the active tool
sees the click. `draggable` is deliberately a *separate* prop: a locked
background is still selectable, just not movable.

## Layer architecture

`Layer` (structural grouping of `PlanObject`s: Structures, Électricité,
Sécurité, Annotations by default) and `Background` (the imported plan
image) are modeled as **separate types** in `domain/types.ts`, joined only
in the *UI* by `LayersPanel.tsx`, which renders the background as an extra
row above the real layers — clickable to select it, with its own
visibility/lock icons (KL-003), or an "Importer" button when there isn't
one yet. The reasoning for keeping the types separate:

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
lands on *by default*: the first unlocked layer in order, falling back to
the very first layer if everything happens to be locked. KL-003 gives the
background the same lock semantics (selectable and read-only when locked,
otherwise fully editable) for consistency.

### Layer management (KL-006)

KL-006 makes the layer bar do what it looks like it does: create, rename
(double-click), reorder (◀ ▶), delete (✕), pick the **active** layer that
new objects land on, and move a selection between layers from the
properties panel. The bar reads left to right in draw order — leftmost is
drawn first, so it sits at the back — with the background first, because
it is always behind everything.

Four decisions worth recording:

- **`order` is the truth, and it is always contiguous.** Every reordering
  goes through `normalizeLayerOrder`, which rewrites `order` to 0, 1, 2…
  A duplicate `order` would make the draw order depend on
  `Array.prototype.sort`'s tie-breaking — the kind of thing that works
  until the day it doesn't.
- **Deleting a layer keeps its objects**, moving them to the layer below
  (or to the new bottom layer). Deleting a container is not a request to
  destroy its contents. `removeLayer` refuses outright to delete the last
  remaining layer: every object needs a home, and an empty `layers` array
  would leave the next created object nowhere to go. The confirm dialog
  says how many objects will move, so the behaviour is stated before it
  happens rather than discovered afterwards.
- **Visibility and lock stay outside the undo stack; everything else goes
  in.** Toggling an eye is a way of *looking* at the plan. Creating,
  renaming, reordering and deleting a layer are changes *to* it. That
  split was already implicit in KL-002 and is now explicit in `Editor`.
- **Draw order is applied where drawing happens, not in the model.**
  `Editor` sorts objects by their layer's rank into `orderedObjects` and
  hands that to both `PlanCanvas` and `PrintCanvas`, so what you export
  is stacked exactly like what you see. `project.objects` itself stays in
  creation order — reshuffling the stored array on every layer move would
  make the file churn for no reason.

The active layer is a piece of *editor* state, not project state: it is
where the next object goes, not a fact about the document. It is kept
valid by the same "adjust during render" pattern used elsewhere — if the
layer it names no longer exists (another project opened, that layer
deleted), it falls back to `getDefaultTargetLayer`.

## Measurements and snapping

KL-007 adds two pure domain modules. `measure.ts` computes segment and
polyline lengths, closed perimeters and shoelace areas in metres; it also
owns the compact metre/hectare formatting used by the canvas. The ruler
starts as a transient `PlanCanvas` draft. `Enter` converts two points to a
line and three or more to a polygon, after which it is a normal project
object: editable, undoable, persisted and printed. Its displayed length,
perimeter and area come from `getObjectDimensionSummary`, so moving a
vertex can never leave a stale stored measurement behind.

`snapping.ts` describes meaningful world-coordinate targets independently
of Konva: rectangle corners/midpoints/centre, circle cardinal points and
centre, polyline or polygon vertices/midpoints, and text anchors. The UI
adds the current visible grid and supplies tolerance in metres. That
tolerance comes from a constant 10 screen pixels divided by the viewport's
effective pixels per metre, so the magnetic radius feels unchanged while
zooming.

Object targets deliberately beat grid targets, even if a grid crossing is
slightly nearer. Hidden layers are filtered before targets are collected,
and every object in the moving selection is filtered at gesture time so it
cannot pin itself to one of its own points. Holding `Alt` bypasses the
operation without changing the editor-wide Magnétisme setting. Calibration
is the exception: it always reads the raw pointer because snapping against
a grid derived from a scale that is currently being corrected would feed
that error back into the calibration.

## Persistence

KL-008 makes a project survive the tab closing. Two mechanisms, with
deliberately different jobs:

- **Autosave**, to browser storage, is the safety net. It costs the user
  nothing and asks nothing of them.
- **A project file** (`.kli`, `.kl.json` before KL-035) is the real,
  portable copy. It's the only one the user *owns*: browser storage doesn't
  move to another machine and doesn't survive clearing site data.

The UI never conflates the two — the save indicator says "Enregistré" but
its tooltip says *where*, and every storage failure points at exporting a
file, because that is the action that actually protects the work.

### Reading is the hard half

`persistence/projectFile.ts` is pure (no DOM, no storage) and holds all the
validation. Its premise: **anything coming back from storage or a file is
untrusted.** It may come from an older build, a half-written record from a
killed tab, a hand-edited file, or an unrelated `.json` picked by mistake.
So `parseProjectFile` checks every field and *never throws* — it returns a
`ParseResult`, and the UI turns the error code into a sentence.

Three decisions worth stating:

- **Codes, not sentences.** `ParseError` is a discriminated union of codes
  carrying structured details (`{ code: "invalidField", path }`). The app's
  wording is French and belongs in `ui/` (`projectFileActions.ts`), not in
  a layer that has no business owning copy. A code also carries the
  offending path, which a baked-in string would have had to interpolate.
- **Refuse whole, never repair.** A file with one bad object is rejected
  entirely rather than loaded minus that object. Silently dropping part of
  a plan is worse than refusing to open it: the user keeps both their
  current project *and* the file, and is told exactly which field is at
  fault.
- **Referential integrity, not just field shapes.** An object whose
  `layerId` isn't in the file would load, count, and then never draw — the
  canvas renders objects by visible *layer*. That's checked
  (`danglingLayerRef`), because a project that silently lost content is the
  failure mode most likely to go unnoticed until it matters.

Only a *newer* `schemaVersion` is refused outright; older versions are
where migrations would go, and there are none yet.

### Why IndexedDB, not localStorage

A project's own data is a few kilobytes. Its background is not: an imported
plan is a `data:` URL, and base64 inflates it by a third. `localStorage`'s
~5 MB budget is blown by a single ordinary scan — and it fails by
*throwing on write*, so an autosave would silently stop saving exactly when
the project became worth saving. IndexedDB's quota is far larger and it
stores structured values directly, so a large image isn't re-serialized to
a JSON string on every edit. Verified in the browser: a 16.8 MB background
(3× the `localStorage` limit) autosaves and restores intact.

`projectStorage.ts` is the only file in the layer touching a browser API,
and it treats every failure as ordinary: storage can be absent (private
windows), blocked, full, or corrupt, and in each case the editor must still
open and still let the user export. So it resolves to result objects
instead of rejecting, and a corrupt record yields the starting project plus
a notice explaining what happened — never a blank screen.

### Ordering hazards

Two races were designed out rather than papered over:

- **The autosave must not run before the restore finishes.** The editor's
  state is seeded from its initial project, so mounting on a placeholder
  and swapping later would let an autosave write that placeholder over the
  project still being read. `App` resolves the load *first* and mounts
  `Editor` once — which also avoids a flash of the wrong plan and an undo
  stack straddling two documents.
- **There is no `clear` operation.** Every way of leaving a project behind
  replaces it with another that the autosave writes over the same record a
  moment later; a delete would only ever race that write, and losing the
  race would destroy the document the user had just chosen.

Opening a file or starting a new project calls `resetHistory`, which
*discards* the undo stack: an edit history spanning two documents isn't a
history, it's a trap.

## Printing and export

KL-009 turns a plan into a sheet of paper: a PDF whose page is a true
A-series size and whose drawing sits on it at a true scale, so a printed
20 m stage measures exactly 100 mm at 1:200. That property — not file
size, not fidelity of colour — is the whole point of exporting from here
rather than screenshotting.

### `Sheet` becomes real

`Sheet` had been an `{ id, name }` placeholder since KL-001. It now
carries `paperSize`, `orientation`, `scaleDenominator` and `marginMm`, and
`domain/sheets.ts` holds the arithmetic: ISO 216 sizes, the printable area
after margins, `metersToPaperMm` (the definition of 1:S), the ground area
a sheet covers, and `fitScaleDenominator`.

Two decisions there are worth stating:

- **Scales come from a ladder** (1:20 … 1:5000), never a free number. A
  plan marked 1:137 is one nobody can check against a ruler.
- **`fitScaleDenominator` rounds *up* the ladder**, and the UI never calls
  it on its own — "Ajuster" is a button. Silently rescaling to make a plan
  fit would turn the printed "1:200" into a lie, which is worse than a
  plan that doesn't fit and says so.

The sheet is stored on the project, so paper and scale persist like any
other setting. A pre-KL-009 file's bare sheet is read with defaults rather
than bumping `SCHEMA_VERSION` — see `readSheet` for why a version bump
there would buy a migration that could never run.

### One renderer, not two

`ui/components/PrintCanvas.tsx` renders backgrounds and layered image
objects with the same Konva pipeline as the editor. Ordinary shapes and
texts are translated by `ui/exportSheet.ts` into PDF paths and text
operators: they remain sharp and selectable. This hybrid renderer avoids
rasterising the useful vector content while preserving exact image filters.

`computePrintRaster` is the join: `rendering/` already turns metres into
pixels given a `Viewport`, so printing supplies a viewport whose scale
comes from paper instead of from the user's zoom. Nothing about drawing is
duplicated.

Only source images remain resolution-dependent. Shapes, text, frame,
cartouche, captions and scale bar are vector at exact point coordinates.

`printing/pdf.ts` is a small multi-page writer (catalog, page tree,
content streams, JPEG XObjects, paths and two standard fonts). Three details it gets
right and that are easy to get wrong:

- **Offsets are counted in bytes, not characters.** The cross-reference
  table records where each object starts; one accented character in a
  project name counted as a character would shift every later offset and
  produce a file that opens blank. Everything is assembled as
  `Uint8Array`, and a test pins it.
- **Text is encoded as WinAnsi, not Latin-1.** The two differ exactly
  where French lives: `œ`, the typographic apostrophe, the em dash, the
  ellipsis. Getting this wrong prints "Cœur — l'entrée…" as
  "C?ur ? l'entr?e?".
- **Symbols are a second font, addressed by byte (KL-044).** WinAnsi has
  no arrows, no crosses, no numbered markers — so a `symbol` object is
  printed from **ZapfDingbats** (`/F2`), one of the same 14 standard
  fonts no viewer has to download. A dingbat is selected by a *byte* in
  that font's own encoding, unrelated to the character's Unicode code
  point, so `PdfTextItem.dingbat` carries the byte while `text` keeps the
  character for readability, and the two are never mapped here: the table
  lives in `domain/symbols.ts` and was read off a printed proof sheet
  rather than derived. The font gets no `/Encoding` entry — imposing
  WinAnsi on it would select the wrong glyph for every byte — and the
  byte still needs escaping when it lands on `(`, `)` or `\`, which it
  does (an aeroplane is 0x28).

### Three defects the first printed sheet revealed

Worth recording, because none of them showed up in unit tests — they
needed an actual PDF, rendered:

- **The drawing came out solid black.** A Konva stage is transparent where
  nothing is drawn and JPEG has no alpha channel, so every uncovered pixel
  encoded as black. `PrintCanvas` now paints an explicit white ground.
- **The title block printed on top of itself** — project name, location
  and scale bar all at nearly the same coordinates. The block is now laid
  out as three columns and two baselines in `TitleBlockLayout`, so the
  geometry is in one place and testable.
- **The scale bar ran into the date on A4 portrait.** Its allowance is now
  the width actually available between columns rather than a fixed 50 mm,
  and the candidate ladder gained sub-metre steps for fine scales where
  even a 1 m bar is 50 mm of ink. A test now sweeps every paper size ×
  orientation × scale and asserts the bar clears the right column.

## Points à surveiller (repris du rapport de mission)

See the current mission report (delivered alongside this document) for
the full, up-to-date list of deferred functionality and known limitations
— kept there rather than duplicated here so it doesn't drift out of sync.

## Géoréférencement et collaboration locale

Le modèle conserve facultativement une origine WGS84 et une rotation. Les
conversions GeoJSON utilisent un repère tangent local en mètres, adapté à
l'emprise d'un site événementiel ; les autres projections sont laissées à
un SIG spécialisé. Les commentaires et versions sont entièrement locaux et
portables dans `.kli`. Une collaboration simultanée demanderait un
service d'identité, de stockage et de résolution des conflits : aucun faux
partage n'est activé sans ce choix d'infrastructure.

## How `Editor` is decomposed (audit pass)

`Editor.tsx` had grown to some 1 200 lines and thirty `useState` calls —
the point at which the file stops being a component and becomes a place
where things are kept. It is now the wiring it was always meant to be,
with the cohesive parts pulled into hooks that own their own state:

| Hook | Owns | Why it is separate |
| --- | --- | --- |
| `useSelection` | selected ids, background selection, everything derived from them | The selection is held as *ids*, resolved against the live project each render, so a deleted object leaves the selection for free. |
| `useLayerActions` | the active layer, layer CRUD, the dialogs two of them need | The active layer is validated during *render*, so it can never point at a layer that no longer exists. |
| `useClipboard` | the in-memory clipboard and the paste fan-out counter | Two clipboards (in-memory authoritative, system best-effort) with a fallback on every failure path. |
| `useSheetExport` | sheets, page layout, the two-phase raster/PDF export | The mount-wait-rasterise dance needs five pieces of state that mean nothing to the rest of the editor. |

Eight independent `isXOpen` booleans also became one `openDialog:
DialogId | null`. Eight booleans can represent two dialogs stacked on top
of each other — a state the app has no UI for and never wants to reach.

### Locking is a domain rule, not a panel detail

`editableObjects` and `isSelectionLocked` live in `domain/selection.ts`.
They were previously re-derived at each call site, and three of those
sites — group, transform and distribute a multi-selection — had simply
forgotten to, so a locked layer's objects could be scaled, rotated and
redistributed from the properties panel. The rule they share, set by
delete in KL-004, is that **a mixed selection edits the unlocked part and
leaves the rest**, rather than refusing a whole gesture because one object
in it is protected. Copying and duplicating stay available on a fully
locked selection: they read, they don't write.

### Prompts that were doing a dialog's job

Three flows used chained `window.prompt` calls for structured input and
have proper forms now:

- **Deleting a populated layer** asked the user to *type* the destination
  layer's name, failing on a typo, and accepted the literal word
  `SUPPRIMER` to destroy every object on it. It is a `<select>` of the
  layers that exist plus an explicit radio for the destructive branch.
- **The georeference anchor** asked for longitude, latitude and rotation
  in three consecutive prompts, validating only after the third. It is a
  form inside the exchange dialog, validated as you type.
- **A layer's default style** asked for two hex colours as text. Two
  colour pickers.

A single free-text field (renaming a project, naming a group) still uses
`window.prompt`, which is what it is for.

## Commands, menus and the pinned toolbar (KL-026)

The toolbar had grown to fifteen buttons in one row — every action the
app had, none of them findable. The fix was not to shorten the labels but
to stop hard-coding the list in a component.

`ui/commands.ts` is now the single registry: id, menu label, short
toolbar label, icon, group and tooltip. Three consumers read it and
nothing has to be kept in step by hand:

- **`CommandMenu`** renders one group ("Fichier", "Projet") in the left
  rail, with the full label and a 📌 on whatever is currently pinned.
- **`Toolbar`** renders only the pinned ids, plus a ⚙ that opens the
  customisation dialog.
- **`ToolbarCustomizeDialog`** offers exactly the registry, grouped.

`Editor` has one `runCommand(id)` dispatcher, so an action cannot behave
differently depending on where it was invoked from.

Two things stay out of the registry on purpose. `undo`, `redo` and
"Cadrer le plan" are permanent toolbar fixtures: they describe the state
of the *editor* rather than things to do with the document, and their
enabled state has to be readable at all times. And the drawing tools keep
their own `ToolsPanel` — picking a tool changes what the canvas does with
the next click, which is a mode, not a command.

Pinned ids persist in `localStorage` under
`kl-implantation/toolbar/v1`, and unknown ids are dropped on read so a
preference written by a later build can't leave a dead button behind.

### The two rails

The layout's `tools` and `properties` grid areas are now *rails* — a
flex column that owns the area and the scroll — rather than single
panels. The left rail stacks `ToolsPanel` and the command menus; the
right rail stacks `PropertiesPanel` (what is selected) and the new
`ElementsPanel` (everything there is).

`ElementsPanel` exists because the layers bar along the bottom, which can
already expand a layer's contents, is one row high and horizontal: fine
for finding *a* layer, useless for reading a plan of two hundred objects.
The new panel is tall, filterable by name/reference/category, grouped by
layer in drawing order, and shows each object's real dimensions. Its
clicks go through the editor's own selection handler, so selecting there
and selecting on the canvas are the same act — `Shift` extends, and a
click on a grouped object still takes the whole group.

### "Enregistrer sous" renames the project

A browser download cannot report where the file went, so the one
inconsistency worth preventing is a project whose name no longer matches
its file. "Enregistrer sous…" asks for a name, renames the project to it
(one undo step), and saves — so the next suggested file name is the one
the user last chose. KL-035 gave the macOS shell a real path back, but the
rename stays: the file and the document are still meant to carry the same
name, and that is the half of it a browser could never guarantee.

## What an object writes on the plan (KL-027)

The same plan goes to a client (names only), to a fitter (names and
dimensions) and to a buyer (references and quantities). Redrawing it three
times is absurd, so the label is *composed on demand* and nothing about it
is stored on the object.

`domain/display.ts` holds the four switches — name, dimensions, reference,
quantity — at two levels: `Project.labelDisplay` is the plan-wide default
(the tools panel), and an object may carry a full `display` override (the
properties panel). `getObjectDisplayLabel(object, display)` composes one
line per switched-on part. A measurement object states what it measures in
place of a plain size: that *is* its dimension, and it is why the object
exists.

The pre-KL-027 free-text `label` still wins when a file carries one.
Dropping it would silently rewrite plans already drawn. New code never
writes it — inserting a catalogue item used to, which would have made
every cataloged object ignore the switches.

Changing the plan-wide setting goes through the **undo stack**, unlike
layer visibility: it decides what the exported sheet says, so it is a
change to the document, not a way of looking at it.

### The PDF was printing nothing labelled

Adding the switches surfaced an older defect. The hybrid export
rasterises bitmaps and writes every vector shape as real PDF paths — but
it only emitted text for `text` objects, so a sheet came out with every
shape correctly placed and *nothing named*, which is most of what a plan
is for. `exportSheet.ts` now emits each object's composed label through
the same `getObjectDisplayLabel` and the same settings, centred on the
object's **extent** rather than hung off its anchor: a rotated
rectangle's anchor is a corner somewhere out in the field.

## Rotation turns about the centre (KL-027)

The model stores rotation about the **anchor** — for a rectangle, its
top-left corner — and that convention is what keeps rendering, bounds and
PDF export in step. But rotating a chapiteau about its corner swings it
across the plan, which is never what anyone means by "rotate this".

So the *gesture* changed, not the model. `rotateObjectToDeg` measures the
angle from the object's own centre and solves for the anchor that keeps
that centre still:

    anchor = centreWorld − R(newAngle) · centreLocal

Both the rotate handle and the properties panel's rotation field go
through it, so typing an angle and dragging to it land in the same place.
Every file already written keeps its meaning.

`getLocalCenter` gives the pivot per type. A circle's anchor already *is*
its centre. A polyline's is the midpoint of its **extent**, not the mean
of its points: an L-shaped run of barrier with ten points along one arm
and two along the other would otherwise pivot around the crowded arm.

## Text starts at 2 m (KL-027)

`DEFAULT_TEXT_SIZE_M` went from 0.30 m to 2 m. Event plans print at 1:200
and coarser, where a 30 cm glyph is an unreadable smudge.

## The polyline tool: two gestures, one shape (KL-028)

"Tracé" is click-to-place-points *and* press-and-drag-to-draw-freehand,
mixed freely within one object. Cable runs, fencing and site boundaries
are all part straight and part not, and making the user finish one object
to change technique would be the wrong seam.

The draft carries a `pressing` field to tell the two apart: a press starts
as `"click"` and becomes `"freehand"` only once the pointer has travelled
`FREEHAND_THRESHOLD_PX` with the button down, so a click that wobbles by a
pixel doesn't start drawing by hand. `Enter` or a double-click commits,
`Backspace` takes back the last point, `Escape` discards.

Two deliberate asymmetries:

- **Freehand ignores snapping.** Clicked points are pulled onto the grid
  and onto other objects like every other tool's; sampled ones read the
  raw pointer, because snapping each sample would turn a hand-drawn curve
  into a staircase.
- **Thinning happens on commit, not while drawing.** What is on screen is
  exactly what the hand did; only the stored object is simplified.
  `domain/polyline.ts` implements Ramer–Douglas–Peucker with a tolerance
  derived from a screen distance at the current zoom — so the result is as
  fine as what the user could actually see. Hundreds of samples per cable
  run would otherwise bloat the file, slow every hit-test, and make the
  vertex handles unusable.

Both ends of a stroke are always kept, so a simplified line never starts
or finishes anywhere other than where it was drawn.

### Measurements are ordinary objects with an annotation's default look

A measurement persisted with `Enter` has always been a plain line or
polygon carrying `measurement` metadata — selectable, movable, deletable,
and its label recomputed from geometry so moving a vertex keeps the stated
length current. What it lacked was a look of its own: it inherited the
layer's default fill and read as another thing standing on the ground.
`MEASUREMENT_STYLE` gives it the measuring overlay's teal, dashed, with no
fill. It is only a default — colour and stroke width are editable like any
other object's, which is what the tool now offers.

A line's length reaches the plan through the same `dimensions` switch as
every other shape's size (KL-027): `getObjectDimensionSummary` already
returns a polyline's length, so "show dimensions" and "show length" are
one setting, not two.

## Nothing may take the whole editor down (KL-026 fix)

The app had **no error boundary at all**. React unmounts the entire tree
on any render error, and this project lives in memory — so a single
throw anywhere blanked the screen and took the plan with it.

The case that surfaced it: the dialogs are code-split, so a chunk request
that fails — a stale build after a deploy, a dropped connection, a proxy —
throws from inside `Suspense` and blanks the app. Losing an afternoon's
work because a menu entry couldn't be fetched is not an acceptable
failure.

Two boundaries now:

- **Around the editor** (`App`), wrapping the `Suspense` rather than
  sitting inside it — a boundary *inside* Suspense never sees a failed
  chunk. Its fallback says the project is autosaved and offers a reload.
- **Around the lazy dialogs** (`Editor`). The editor behind is intact, so
  this one only explains and gets out of the way. Its "close" clears the
  captured error as well as the dialog: leaving the error in place would
  make the *next* dialog open onto the same message.

## Folding is per-section, and it persists (KL-026 fix)

Folding "Outils" used to hide the command menus with it, because they
were nested inside its conditional. Each side section — tools, the two
command menus, properties, elements — is now independent, and the set of
folded ones is persisted (`kl-implantation/panels/v1`): a fold is a
statement about how someone wants to work, and losing it on every reload
would make folding pointless.

*Independent* means no fold is contagious. It stopped meaning "any number
open at once" in the left rail — see "One menu at a time on the left"
below.

A rail narrows to its 48 px icon width only once *everything* in it is
folded; folding one section of three has to leave room for the two still
open. Panel titles carry both an icon and a name, and CSS drops the name
only at that icon width — a folded menu in a full-width rail still has to
say what it is.

## A stack of backdrops, not one (KL-029)

A site is routinely read against more than one image — a surveyed plan
with a satellite view over it, last year's layout underneath this one — so
`Project.background: BackgroundImage | null` became
`Project.backgrounds: BackgroundImage[]`, bottom first, each with its own
name, placement, opacity and corrections.

This is the first change to need a **schema bump**: `SCHEMA_VERSION` is 2.
Version-1 files are migrated as they are read — `readBackgrounds` takes
the old single `background` and returns a one-element stack — and an older
build meeting a version-2 file refuses it, which is correct: it would
otherwise keep one backdrop and silently drop the rest on the next save.
Four tests cover that migration, including the file that had no background
at all and the one whose backdrop predates having a name.

Three decisions worth stating:

- **Calibration stays a property of the plan, not of an image.** There is
  one `Project.calibration`, because it expresses the plan's scale. What
  is *resized* by it, though, is the backdrop it was measured on:
  `applyCalibration(project, calibration, backgroundId)`. Nothing says a
  satellite view and a surveyed plan were imported at the same
  resolution, so correcting all of them together would be wrong.
- **The grid is bounded by the bottom visible backdrop** — the surveyed
  plan the site is set out against, not whatever image is laid over it.
- **Importing adds; replacing is explicit.** The layers bar's "Ajouter un
  fond…" stacks a new one; the properties panel's "Remplacer" swaps the
  image of the selected entry *in place*, keeping its placement and
  corrections, because the point of replace is a newer revision of a plan
  that is already positioned.

### The camera must not move when the stack is reordered

The auto-fit was keyed on "the first visible background", so reordering
the stack — which changes who is first — re-framed the view and threw the
user away from what they were looking at. It now tracks the ids it has
already accounted for: opening a document frames whatever it contains,
and after that a newly imported backdrop frames the view only when it is
the *only* one. Adding a second over a plan already framed leaves the
camera alone.

### `PrintCanvas` grew a child component

Konva's filters are per node and are applied through `cache()` in a
layout effect, so a backdrop cannot be drawn in a loop from the parent.
Each is a `PrintBackground` of its own, reporting back when its image has
decoded; the stage is rasterised only once every one of them is in —
otherwise an export would silently come out with blank backdrops.

## A library of one's own (KL-029)

The built-in catalogue covers what most event plans need, but every firm
has its own kit. `persistence/catalogStorage.ts` keeps user-defined
materials (`kl-implantation/catalog-items/v1`) and a set of hidden
built-in ids (`.../catalog-hidden/v1`) — per installation, like the
reusable components and the toolbar pins, because they belong to the user
and not to one project. Stored items are validated on read and a
malformed one is skipped, never "repaired".

Creation and editing are a *mode of the library dialog* rather than a
separate one: the moment you want a material of your own is the moment
you have just failed to find it in that list. The form offers rectangles
and circles only — a line or polygon item needs a point list, which is
drawn on the plan and saved as a component, and offering the shape with
no way to give it a geometry would be a dead end.

Hiding is offered alongside deleting because a firm that never handles
heavy goods vehicles should not scroll past one forever, and hiding a
built-in is reversible in a way that editing the built-in list would not
be.

## Stands inside a marquee: text, not objects (KL-030, redone in KL-038)

KL-030 divided a chapiteau into **real objects**, one per cell, on the
reasoning that a stand is a thing: allocated to an exhibitor, priced,
counted in the schedule. That reasoning was sound and the result was
still wrong in use. A tent of thirty stands became thirty objects to
select around, drag by accident and scroll past in the elements panel,
for a grid nobody edits cell by cell once it is drawn. Changing "4
columns" to "5" meant deleting twenty rectangles and starting again.

KL-038 replaced it: the grid is a property of the marquee
(`RectangleObject.stands`) and it draws **text only**. One free label per
cell, shown or hidden by the same switches as every other label. Nothing
is created, so nothing has to be cleaned up.

What that costs, stated plainly: stands no longer appear in the
schedule, and a stand can no longer be coloured or deleted on its own.
That was the deliberate trade — see the mission entry in `ROADMAP.md`.

`domain/stands.ts` is pure, and the geometry survives the rewrite
unchanged, aisles and perimeter walkway included: the point of a scale
plan is that the text lands where the stand will be.

- `measureStandGrid` answers "what size would the cells come out at"
  without building anything. It matters *more* now than when cells were
  drawn — with text only, this number is the sole indication that the
  stands actually fit. It returns `null` for a request that doesn't fit,
  which is what disables the dialog's confirm button.
- `standCells` lays the cells out in the marquee's **local frame**; the
  caller applies the rotation, exactly as it already does for the shape
  itself — the Konva group on screen, `objectLocalToWorld` on paper.
- `standGridToDraw` is the one decision both renderers ask, so screen and
  PDF cannot drift: "what prints is what was on screen" holds only while
  both ask the same question.

Three rules worth keeping in mind:

- **An empty cell writes nothing.** That is how a technical corner or a
  bar is expressed, without inventing a second concept for "no stand
  here".
- **The labels are stored row by row, and resizing re-lays them by (row,
  column).** Padding the flat array would be shorter and would silently
  move the user's text into the wrong squares the moment a column is
  added — `resizeStandLabels` exists for exactly that, and is tested for
  exactly that.
- **A marquee that writes stand names moves its own name above its top
  edge.** Both were centred, so both landed in the middle cell. The rule
  lives in the two renderers but the condition that triggers it does
  not — it is `standGridToDraw` again.

It covers rectangles only. A grid inside a polygon needs clipping, which
is a different problem, and offering the button for a shape it could not
honour would be worse than not offering it.

## The file the user owns, owned properly (KL-035)

The macOS shell of KL-031 wrapped the web build in a `WKWebView` and
stopped there: `WKWebView` implements no File System Access, so *inside
the app* every save fell back to a download into `~/Downloads`. The
desktop app was worse at the one thing a desktop app is for — no folder
choice, no writing back to the file you opened, no double-clicking a
project in the Finder. This mission closes that, and the web build is
unchanged by it: the shell is one host among several, never the primary
one.

### The extension is a single component now

`.kl.json` became `.kli`. Not cosmetics: macOS associates documents by
extension through Launch Services, and it does not match a two-part one —
`.kl.json` is seen as `.json`, and claiming *that* would make this app the
handler for every JSON file on the machine. The contents are still JSON,
which is the part that matters; a project file stays readable in any text
editor.

Files written before the rename open exactly as they did. That is not a
compatibility gesture, it is the rule the whole persistence layer already
follows — a project file is the only copy the user owns, so nothing this
app writes may ever become unreadable by it. `PROJECT_FILE_EXTENSIONS`
lists what the dialogs filter on, current one first, and the bundle
declares plain JSON as a type it *opens* (`LSHandlerRank: None`) without
owning it.

### The web build is served, not opened as a file

The shell as KL-031 left it called `loadFileURL` on the bundled
`index.html`, and the window came up **blank** — in every build, from the
first one. Nothing caught it because nothing looked: the process was
alive, the navigation "finished", and a page whose scripts never ran looks
exactly like one that has not painted yet.

Two independent reasons, either of which is fatal on its own:

1. **Vite emits root-absolute asset paths.** `/assets/index-….js` under
   `file://` resolves to the *filesystem* root. The application's only
   script 404s, React never mounts, and `<div id="root">` stays empty.
2. **A `file://` page has an opaque origin**, and WebKit gives it neither
   `localStorage` nor IndexedDB. Autosave, the material catalogue, saved
   components, shortcuts and rail widths all live in one or the other. A
   desktop app that silently forgets everything is a worse bug than a
   blank one, because it looks like it works.

`WebAppSchemeHandler` serves the bundle over `planeditor://app/` instead.
That is a real origin: storage behaves as it does in a browser, and
`/assets/…` resolves against it exactly as it does on a web server — so
the web build is byte-identical on both hosts, which is the property worth
protecting. Setting Vite's `base` to `./` would have fixed the paths and
left the storage problem standing.

Serving over `http://localhost` would also have worked. It was not chosen:
it opens a listening socket, and "no backend, no network dependency" is a
claim this app can afford to keep literally true.

The handler is deliberately a router and nothing more — a path, a file, a
MIME type — because that is the part that can be wrong. Two rules in it
are load-bearing rather than tidy: a request may not climb out of the
bundle with `..` (a page is not trusted to stay in the directory it was
served from), and the MIME table is not cosmetic (WebKit refuses to
execute a script served as `text/plain`).

Reading is synchronous on the calling thread. The largest asset is a few
hundred kilobytes off a local disk, and doing it inline removes every race
between a read completing and WebKit stopping the task — calling back into
a stopped `WKURLSchemeTask` is a crash, not an error.

### A blank window now leaves a trace

`didFinish` fires for a page whose scripts all failed, so "loaded" was
never the question worth asking. The coordinator now asks the one that
matters — is the React root still empty? — and logs it, along with any
navigation failure. Nothing can be shown to the user from there, but the
next occurrence is diagnosable in Console.app instead of silent, which is
precisely what this one was not.

### One channel, three actions

`ui/nativeBridge.ts` (web) and `FileBridge.swift` (shell) are the two ends
of a `WKScriptMessageHandlerWithReply` channel: `saveAs`, `save`, `open`.
Reply-style is what makes it tractable — the page awaits the answer, so a
cancelled panel is an ordinary resolved value rather than a timeout to
guess at.

Two rules hold the seam together:

- **Nothing assumes the bridge exists.** `isNativeBridgeAvailable()` is
  false in every browser, and each caller falls through to what the web
  has: File System Access where there is a picker, a plain download in
  Safari and Firefox. The fallback is not an error path.
- **A reply that lost its way degrades to a reported failure.** The Swift
  side is trusted to send the right shape, but `readResult` still checks
  it — a bridge that answers nonsense must not take the editor down with
  it.

`saveProjectFileAs` therefore reads as the three routes in decreasing
order of control they give the user (system panel → File System Access →
download), and `cancelled` is a third outcome alongside saved and failed,
because telling someone their save failed when they dismissed the dialog
is a lie.

### Where a plain save goes

`saveDestination` is the file this session is working against: set by a
native save, a native open, or a document handed over by the Finder;
cleared by a new project or a file picked in a browser. Only the shell can
ever fill it in — a browser is never told where a download went, and the
File System Access handle is deliberately not kept either, so outside the
shell every save asks. `saveProjectFile` writes back with no panel when a
destination is known and falls through to `saveProjectFileAs` when it is
not.

### A document double-clicked in the Finder

`AppDelegate.application(_:open:)` reads the file and calls
`window.planEditorOpenFile?.(payload)` on the web view. The `?.` is the
whole error handling: a page still loading, or a build that predates this,
ignores the call instead of throwing inside a web view where nobody would
see it. When the double-click is what *launched* the app there is no page
yet, so the URL is held in `WebViewRegistry.pendingFileURL` and delivered
on `didFinish`.

From `onNativeFileOpened` inward it is the same door as any other open,
refusal of a bad file included — the shell reads bytes, it does not decide
what a project is. The payload is validated anyway: it arrives through a
global that anything running in the page could call.

### What is tested, and where

The bridge is one `postMessage` returning a promise — small enough to
reproduce exactly, which is what `src/testing/nativeBridgeStub.ts` does.
The save, open and Finder paths are therefore covered without a Mac in the
loop. On the Swift side, `handle` is separated from `WKScriptMessage` and
the scheme handler's routing from `WKURLSchemeTask` for the same reason:
what can be wrong silently is reachable from a test, and what is left is
the AppKit call itself. Three suites, all checked by mutation as KL-033
and KL-034 were: five defects introduced in each, fifteen detected.

What stays untested is `NSOpenPanel`/`NSSavePanel`, the
`NSApplicationDelegate` callback, and whether the assembled `.app` really
renders. The first two are AppKit UI and a launch event, neither reachable
from a test process. The third is the one that bit: it was verified by
running the built app and reading back its origin, its React root and its
storage from inside the page — `root=1`, `origin=planeditor://app`,
`localStorage` and IndexedDB both working, four Konva canvases mounted.
That check is a manual step, and the blank-page log line above exists
because a manual step is not a guarantee.

## One menu at a time on the left (KL-036)

The left rail is ordered **Fichier, Projet, Outils**, and opening one
folds whichever was open. The right rail is unchanged and still stacks.

This reverses, for the left rail only, what KL-031 decided when it removed
an accordion there. That removal was right about the bug it was made for —
three open panels pushed the folded headers out of the rail because the
*rail* scrolled instead of its panels, and an accordion only hid the
symptom. The layout bug stayed fixed. What has changed is the reading of
what these three panels are: Fichier, Projet and Outils are places you go
to pick something and leave, not surfaces you read the plan against. The
argument KL-031 made against the accordion — that it made the rail's size
handle pointless, since two panels were never open together — is about the
*right* rail, which has a height split to drag. The left rail has only a
width, and one open menu needs it no less than three.

The rule lives in `panelSections.ts` as a property of the rail, not of the
panel: `PanelRail.exclusive`. Two consequences worth naming, both tested:

- **Folding is still never contagious.** Only *opening* folds anything,
  and only in its own rail. Folding the last open menu leaves the rail
  with nothing open, which is a legitimate state — that is how you give
  the whole width back to the plan.
- **A stored preference is normalised on read.** A user arriving from a
  build whose left rail stacked has all three recorded as open, a state
  this build cannot otherwise reach. `loadCollapsedSections` keeps one:
  the palette, since someone in that state was drawing.

The panel that starts open on a fresh install is Outils for the same
reason — it is used continuously, where the other two are visited.

## One build, every host (KL-037)

The app used to emit root-absolute paths: `/assets/index-….js` in the
HTML, `"/"` for the manifest's `start_url` and `scope`, a hard-coded
`["/", "/index.html", …]` shell in the service worker, and
`register("/sw.js")`. That works at the root of a domain and nowhere
else. Served from `/plan-editor/` — which is what a GitHub Pages project
site is — the page asks the host for `/assets/…`, gets the 404 page, and
renders an empty `<div id="root">`. It is the same failure mode as the
blank macOS window of KL-031, from the same cause, and it would have
shipped for the same reason: nothing loads the built bundle and looks at
it.

Everything is relative now, and each piece resolves against a different
anchor, which is the part worth writing down:

- **`base: "./"` in `vite.config.ts`** — asset URLs resolve against the
  document.
- **`start_url` and `scope` of `"./"`** — resolved against the manifest's
  own URL, so a manifest at `/plan-editor/manifest.webmanifest` scopes the
  app to `/plan-editor/`.
- **`register("./sw.js")`** — resolved against the document, which puts
  the worker at the deployment root and gives it that directory as its
  scope. A worker's URL *is* its scope; this is why it must be a
  fixed name at the top of `dist/` and not a hashed chunk.
- **The worker's own paths** — derived at runtime from
  `registration.scope`, never written down.

The alternative was `base: "/plan-editor/"`, hard-coded. It ties the
bundle to one host, makes the macOS shell and any local serving a second
build, and turns a change of hosting into a code change. Relative costs
nothing here because the app has no router: there is one page, so there
is no deep link whose depth could break relative resolution.

### The service worker became a built module

`public/sw.js` was hand-written and shipped verbatim, which meant the one
piece of code that can permanently serve a user the wrong file was also
the one piece with no tests. It is now `src/pwa/sw.ts`, built by
`vite.sw.config.ts` into `dist/sw.js` — an IIFE, classic script, unhashed
name, `emptyOutDir: false` so it joins the app build rather than replacing
it.

That split buys what KL-034 recommends for hooks: the decisions moved
into a pure module, `src/pwa/swCore.ts`, and the event wiring left in
`sw.ts` is thin enough to read in one pass. `swCore.ts` knows which files
form the shell, which caches to drop, whether a response is worth keeping
and what answers a request the network refused — all as functions over
plain strings, all tested, none of them needing a
`ServiceWorkerGlobalScope` to exist.

`sw.ts` declares the six worker globals it touches instead of adding
`WebWorker` to `lib`: next to `DOM`, that lib makes TypeScript report
every shared global twice.

Two rules changed on the way:

- **Cacheable is measured against the scope, not the origin.**
  `titom741.github.io` carries every project page of the account, so the
  origin is not this app — the sub-directory is. It also sidesteps
  `URL.origin` reporting the string `"null"` for a non-special scheme.
- **The shell is seeded file by file, not with `addAll`.** `addAll` is
  atomic: one missing file fails the install, the worker never activates,
  and the app loses offline support entirely — silently, for a favicon.

Network-first is unchanged, and still for the reason KL-031 gave: the app
is code-split, and a cache-first worker happily pairs a fresh
`index.html` with a chunk that no longer exists.

### Icons

An installed web app needs PNGs — no browser rasterises an SVG for the
system's app list. `scripts/build-icons.sh` renders them with `sips`, and
the results are committed rather than generated during the build, so that
the web build does not require a Mac.

`app-icon-maskable.svg` is a second source, not a second size of the
first. A maskable icon is cropped to whatever shape the launcher wants,
so it is full-bleed square with the artwork inside the 80 % safe zone;
the rounded corners of `app-icon.svg` would be clipped a second time.
Declaring one file as `"any maskable"`, as the manifest did, gets one of
the two wrong whichever way the platform reads it.

## The export tells the truth (KL-039)

Three things the export and save flow promised and did not deliver.

### The print preview was 23 pixels tall

`.export-dialog` is a flex column capped at `92vh`. Every child of a flex
container is shrinkable by default, and `.sheet-preview` carried
`overflow: auto` — which made it the cheapest thing in the dialog to
shrink. It collapsed to a sliver while the page inside it was still a
full 562 × 398: nothing was broken, the preview was simply squeezed to
nothing by its own siblings. `flex: 0 0 auto` on it, and the dialog
scrolls instead.

It also rendered at a fixed 34 DPI, which fits A4 and shows a corner of
anything larger. `previewDpiToFit` derives the resolution from the paper
so the whole sheet lands inside the preview box, A0 included. It is
deliberately unclamped: a minimum DPI was the first attempt and put A0
back at 374 px in a 320 px box — a floor defending against an input no
paper size in `PAPER_SIZES_MM` can produce, at the cost of the case that
actually happens.

### The scale ladder was the only scale

`STANDARD_SCALE_DENOMINATORS` exists for a good reason, written down in
`domain/sheets.ts`: a plan marked 1:137 is one nobody can check with a
ruler. But it is not the only thing a scale is for. A plan meant to use
the whole page wants the scale that fills it, and rounding up the ladder
from the 1:137 the content needs to the 1:200 the ladder offers leaves a
third of the paper white.

So there are two functions, and the dialog offers both:
`fitScaleDenominator` rounds up the ladder, `exactFitScaleDenominator`
gives the scale that fills the sheet. The exact one rounds *up* to a
whole number, so the content clears the margin rather than straddling it.
A typed denominator goes through `clampScaleDenominator` — whole numbers,
inside a usable range, and `null` rather than letting `NaN` into the
layout.

The select keeps an explicit "(personnalisée)" entry for a value off the
ladder. Without it the select would snap back to its first match and
silently undo the scale the user had just chosen.

### "Enregistrer sous" never said where

`SaveDestination` was recorded and displayed nowhere — including in the
macOS shell, which is the one host that *has* a real path, obtained from
`NSSavePanel`, and the reason the bridge was built at all. So the answer
to "where did my file go" was the same everywhere: silence.

The type now names its three routes rather than flattening them:

- `path` — the macOS panel. A real location on disk, and it is shown.
- `picked` — File System Access. The user chose a folder and **the
  browser does not tell the page which one**. That is a deliberate
  boundary, not a gap to engineer around, so the file is named and the
  reason is given.
- `downloaded` — Safari and Firefox. The folder is knowable here, because
  it is always the browser's downloads folder.

`describeSaveDestination` turns each into what the toolbar shows.
Distinguishing them is the whole point: a bare file name in all three
cases would leave the user unable to tell which host they are in, and
quietly imply the web build could do something it cannot.

## Four things the plan got wrong under the hand (KL-040)

Four complaints from daily use, three of them about text and one about
the most-used gesture in the app.

### Panning applied the whole journey at every frame

The canvas pans by making the Konva `Stage` draggable and folding its
displacement into the viewport's offset on each `dragmove`, then snapping
the node back to (0, 0) so the offset stays the single source of truth.
The trap is what the node's position *means*. Konva computes it, every
move, as `pointer − offset`, where `offset` was measured **once**, when
the gesture began (`_createDragElement`). It is therefore the total
displacement since the button went down, not the step since the last
event — and snapping the node back to zero does not reset it, because the
offset it is derived from is never re-measured.

Folding that number in as a step applies the whole journey again at every
frame. A steady drag of *d* pixels per frame moves the plan *d*, then
*2d*, then *3d*: the view accelerates away from the pointer, and a slow
drag that wanders is the erratic motion that was reported.

`rendering/dragPan.ts` fixes it by not asking the node at all. It tracks
the **pointer**, where the step is unambiguous: where it is now minus
where it was last time. The tracker is seeded on `mousedown` (and on a
one-finger `touchstart`) rather than on `dragstart`, because Konva waits
for three pixels of travel before calling a press a drag, and those three
pixels are movement the user made and would see the plan fail to follow.
It is reset on `dragend`, so a fresh press on the far side of the canvas
cannot be read as one enormous step.

Measured in the browser afterwards, on a drag with three intermediate
moves: pointer +645/+430 px, plan +645/+430 px. Exactly 1:1.

### Stand names are sized to their cell, and may break in two

A fixed 12 px cannot be right for both a tent split in two and the same
tent split in six: it is unreadable in the narrow case and timid in the
wide one. `rendering/labelFit.ts` derives the size from the cell instead,
and allows a name to break onto a second line — which is usually what
*buys* the bigger size, since a cell that is narrow is rarely short.

- **The line breaks are ours, not the renderer's.** Konva wraps by itself
  given a width, but it wraps at whatever size it was handed; it cannot
  choose the size *because* of the wrap, which is the whole point. We
  hand it lines and `wrap="none"`.
- **One size for the whole grid.** Cells are identical, so per-cell
  fitting would print "Bar" large and "Boulangerie" small in identical
  squares. `fitLabelsToBox` takes every name at once and returns the one
  size that suits them all, set by the longest.
- **Hyphens are break opportunities.** French stand names are full of
  them — "Sapeurs-pompiers", "Croix-Rouge" — and since one size serves
  the whole grid, a single unbreakable long word drags every cell down
  with it. The hyphen stays on the line above, as the language does it.
- **Below a readable minimum nothing is drawn.** That is what makes a
  zoomed-out plan a plan rather than a grey wash; it replaces the old
  "cell smaller than 26 px" guard with the same idea said once.

Text width is *estimated* (`estimateTextWidthPx`, a per-character table
for Helvetica/Arial) rather than measured on a canvas, so the module
stays pure and testable in Node. An estimate a few percent out costs a
few percent of font size and never a broken layout — the breaks it is
choosing between are the ones that actually get drawn.

The size is chosen in the *target's* pixels, so the print raster gets a
font proportional to its own resolution for free: the ceiling and floor
are passed through `px()`, the cell size comes from the print viewport.

### A caption belongs on the thing it describes

A line's label — a length, most often — was drawn at `pointsM[0]`, the
end the drawing happened to start from. It now sits at
`polylineMidpointM`: the point half-way *along* the polyline, not the
centre of its bounding box. The two agree on a straight segment and
disagree on everything else; on an L-shaped run the box centre is not
even on the line. The polyline tool's live running length moved to the
same place, for the same reason.

### The caption's size is the object's business

`ObjectStyle.labelFontSize` (screen pixels) overrides the per-type
default in `DEFAULT_LABEL_FONT_SIZE_PX`. Screen pixels because a caption
is annotation: it stays legible at every zoom instead of shrinking with
the thing it names, and on paper it is scaled to the print resolution —
unlike a `text` *object*, whose `fontSizeM` is in metres and is part of
the drawing. On a marquee the same number also caps its stand names, up
or down, so "the text size of this object" means one thing.

Sizes out of a file are clamped rather than refused
(`clampLabelFontSizePx`): a hand-edited 10 000 is a caption nobody can
undo, but it is not a reason to reject the plan.

## The PDF was printing every caption at 6 pt (KL-041)

KL-040 sized stand names against their cell, and it had **no effect on
the PDF at all**. The reason is the split in `useSheetExport`: a PNG
rasterises everything, but a PDF rasterises only what vectors cannot
express — bitmap objects — and draws every shape and every caption as
real PDF text. That path, `ui/exportSheet.ts`, wrote them all at a
hardcoded `LABEL_SIZE_PT = 6`.

Six points is 2.1 mm: legible held close, invisible on a sheet read at
arm's length. But the size was not the defect — being deaf was. A stand
cell 50 mm wide on paper was handed the same 6 pt as one of 5 mm; the
label size the user had set on the object was ignored outright; and the
lines were centred by *counting characters* at half an em, which puts
every narrow name visibly off to one side.

**One rule, three units.** The fitter (`rendering/labelFit.ts`) takes a
box and returns a size in the box's own units, so it serves all three
targets: screen pixels, print-raster pixels, and now points.
`printing/standLabels.ts` holds the paper half — the bounds, the padding,
and `fitStandLabelsPt` — and both the exporter and the export dialogue
call it, or the sheet and the warning about the sheet could disagree.

**A caption's size on paper is not a choice.** A CSS pixel is 1/96 inch
and a point is 1/72, so a caption declared in screen pixels has exactly
one printed size: 0.75 pt per pixel. It is the same conversion the raster
half already applies (`renderScale = dpi / 96`, a print pixel being
1/dpi inch), which is what makes the two halves of an export agree by
construction rather than by inspection. The 14 px default label prints at
10.5 pt, and the field added in KL-040 now governs the PDF too.

**The floor is ISO 3098's smallest lettering, 1.8 mm.** Below it a name is
not read, it is guessed at, so the cell prints empty — the same rule the
screen applies at low zoom. That is honest but silent, and silence is
what sends someone to a printer for nothing, so the export dialogue says
it before the export: *« À 1:5000, les noms de stands sont trop petits
pour être imprimés et seront omis. Passer à 1:2817 »*.

That suggested scale is **searched for, not calculated**. A closed form
looks available — halve the denominator and every cell doubles on paper —
and it is wrong, because the breathing room kept around a name is a fixed
two points and does not scale with the cell. The first version of
`measureStandLegibility` divided it out and said 1:338 where the truth was
1:300; a suggestion that does nothing when pressed is worse than none.
Bisection on the denominator needs no assumption but monotonicity: a
smaller drawing never fits more text.

Two placements came along for parity with the screen: a line's caption
sits half-way *along* the line (`polylineMidpointM`) rather than at the
end it was drawn from, and every caption is centred with the fitter's own
width model instead of a character count.

### The captions did not turn with the plan (KL-042)

The raster half gets rotation for free: every label is a child of the
Konva `Group` that carries `rotation={object.rotationDeg}`, so a marquee
pitched at an angle takes its stand names round with it. The vector half
has to say so, and did not — `PdfTextItem` has carried a `rotationDeg`
since the first PDF (a `text` object uses it), but the captions were
written without one, flat on the page while the shape they name was
turned.

Rotating the glyphs alone would have been worse than leaving them
straight. Each line is placed by an offset from an anchor — half its own
width to the left, one step down per line — and those offsets have to
turn with it, or a stand name slides out of the cell it names as soon as
the tent is angled, and a two-line name lies across its neighbour.
`stackedText` therefore rotates its offsets with the same matrix
`printing/pdf.ts` writes into `Tm`, and both take the object's rotation
**negated**: PDF space has y upward, so a shape turned clockwise on
screen is turned anticlockwise on the page.

Two anchors moved to the object's own frame in the process, because
"above" is only meaningful there. A marquee's own name hangs off the
middle of its **top edge** (`objectLocalToWorld` of `(widthM / 2, 0)`)
rather than off the top of its bounding box: for an unturned tent the two
points coincide, which is why nothing caught it, and for a turned one the
bounding box has no top edge to speak of.


### The floor could only be reached by giving up the page (KL-043)

KL-041's floor is honest and it is a dead end. A plan that has to fit one
sheet — the whole point of *« Remplir la feuille »* — is at the scale the
paper dictates, and the only remedies the dialogue offered were a larger
scale or a larger sheet: both of them refusals of the thing being asked
for. The sheet came out with no stand names on it and a notice explaining
why, which is a correct answer to a question nobody asked.

So the export dialogue carries a switch, **« Agrandir les textes trop
petits »**, off by default. It changes nothing that already clears the
floor — that is what makes it a rescue rather than a second, invisible
style setting — and raises what does not to 1.8 mm, where the text spills
over the shape it names rather than vanishing. The dialogue says so in
the same breath, because a plan whose names overlap is a *different* kind
of wrong from one with no names, and only the reader can say which they
would rather have.

**One floor, every kind of text.** Three captions can fall under it, for
three unrelated reasons: a stand name, whose size is decided by its cell;
a `text` object, measured in metres of *ground* and therefore the only
caption that shrinks with the scale; and an object label whose own size
was set low. They share `MIN_READABLE_PT` in `printing/standLabels.ts`,
which is KL-041's floor under a name that does not say "stand" — one
answer to "what is too small to read on paper", not one per kind of
caption, so the millimetre figure the dialogue quotes is true of all of
them.

**The fitter learned to be told, not to decide.** `fitLabelsToBox` takes
`enlargeToMin`, and it is the caller that knows whether a box too small
means "draw nothing" (the screen at low zoom, where the reader can always
zoom in) or "draw it anyway" (paper, which has no zoom). When the floor is
forced, no candidate break fits it, and the one chosen is the one that
came closest — which required clamping `largestSizeFor` at zero. Ranked
by how *negative* they came out, a box with no vertical room prefers two
lines to one on the grounds that each is shorter: exactly backwards.

**The two halves still agree.** The raster half is handed `minTextPx` in
its own pixels, converted from the same floor through the raster's DPI
(a point being 1/72 inch), and a target holding a floor *replaces* the
screen's own minimum rather than adding to it — otherwise a PNG and a PDF
of one sheet would rescue the same cell at two different sizes.

The switch is print state, not document state: it lives in
`useSheetExport` beside the printed grid and the transparent PNG, and is
never written to the project. A `.plan` file records what was drawn, and
an enlarged caption is not what was drawn.

## The electrical layer of a plan (KL-045)

`domain/electrical.ts` adds an optional `electrical` record to
`PlanObjectBase`: a **device** role (`source`, `board`, `strip`, `load`)
on a rectangle or circle, or the `cable` role on a line. It is a property
rather than a new object type for the same reason stands are (KL-038):
everything a shape already does — rendering, bounds, handles, the three
exports, snapping, the file reader — keeps working unchanged, and the
parser only has to check that the role fits the shape (`rolesForType`).

### Cables are kept plugged in at one door

A cable names its devices (`fromId`, `toId`) and its end vertices sit on
their centres. That invariant is enforced by `reconcileCables(previous,
next)`, called from `useProjectHistory` on every `applyLiveEdit` and
`commitChange` — the one path every edit takes — rather than by each
gesture. Per end, first match wins: a new cable or a changed id is
honoured (or, for a new cable naming nothing, plugged into the device its
end was drawn on); an end that moved is re-plugged by geometry
(`findDeviceAt`, with `PLUG_TOLERANCE_M`) or unplugged; otherwise it
follows its device, and a deleted device unplugs it. Both ends never plug
into the same device (the cable would collapse to a point). It returns
`next` untouched when nothing changed, so ordinary edits cost one scan.

Undo/redo bypass it deliberately: they restore snapshots that were
already reconciled when they were made.

### The network is derived, like labels

`analyzeNetwork(project)` builds one tree per source from the named
connections — never from geometry — sums load power upwards, derives
currents (cos φ 0.9, balanced three-phase), accumulates the resistive
voltage drop downwards, and returns sorted issues (error → warning →
info). It is computed once per project change in `Editor` and shared by
the properties panel (one object's slice) and the diagram dialog.

`sizeCableForDevices` is applied **only when a cable is drawn**: sizing it
for the device it feeds is a convenience at creation; resizing cables
later because a coffret changed would silently rewrite the plan.

### Drawing

Cables are sorted below the other objects of their layer in
`orderedObjects`, so their centre-anchored ends don't cross out the box
they plug into. A device's caption hangs under it
(`deviceCaptionAnchorLocal`), on screen (`PlanObjectShape`) and in the
PDF (`exportSheet.labelText`) alike — a 60 cm coffret cannot hold its
name and rating. Electrical summaries only use characters WinAnsi can
encode, since the PDF prints them with the standard fonts.

## The single-line diagram (KL-046)

`printing/synopticLayout.ts` turns an `ElectricalNetwork` into boxes,
orthogonal edges and headings, in millimetres with y downward. It is a
tidy tree laid left to right: one column per depth, leaves stacked one per
row, each parent centred on its children; unfed devices are set apart
under a heading. Text widths are never measured — neither target can say
how wide a word is before drawing it — so box widths are fixed and the PDF
truncates with an ellipsis.

The same layout is drawn twice: as SVG in `ElectricalDialog` (clickable,
selecting the object on the plan) and as vector paths by
`printing/synopticPdf.ts`, which picks A4 when the diagram fits at ≥ 80 %
and A3 otherwise, never enlarges it, and paginates the balance, cable
totals and alerts on A4 pages that each carry the planning-aid disclaimer.
A box's colour is the severity of the first issue about it or its feeder;
`analyzeNetwork` sorts issues errors first, so the first is the worst.

## The electrical menu and sticky panel titles (KL-047)

The left rail's exclusive sections are now `file`, `project`, `tools` and
`electrical` (`ui/panelSections.ts`); `ElectricalPanel` renders the
electrical tools, which `ToolsPanel` no longer shows (it filters on
`ToolDefinition.group`). Every rail panel scrolls as a whole, and its
`.panel__title` is `position: sticky` inside that scroll box, with an
upward box-shadow in the background colour to cover the panel's top
padding — one CSS rule rather than restructuring five components around a
separate scrolling body.

Electrical equipment is presented by its role, not its shape: the type
line, the element list icon, and the label switches offered (no `stands`
on equipment, no `electrical` on plain shapes). `standGridToDraw` refuses
equipment, so screen, raster and PDF agree without each checking.
