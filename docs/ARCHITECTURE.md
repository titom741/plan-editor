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
  polygon | text`) sharing `PlanObjectBase` (id, layerId, name, optional
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
"circle" | "line" | "polygon" | "text"`, defined in `ui/tools.ts`) that
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
  (`xM`/`yM`/`widthM`/`heightM`, no rotation — see
  [Layer architecture](#layer-architecture)), so `ui/components/BackgroundImageShape.tsx`
  renders and drags it through the *exact same* `worldToScreen` /
  `metersToPixels` / `screenToWorld` calls as any `PlanObject`, and its
  resize handle reuses `domain/geometry.ts`'s
  `resizeRectangleFromCorner`/`getRectangleResizeHandleWorld` directly
  (passing `rotationDeg: 0`) rather than duplicating that math.
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

`CalibrationSource` still carries unused `knownScale` (a map scale like
1:100) and `geo` cases — `knownDistance` is the only one KL-005
implements, and the union is the seam where the others would slot in.

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
lands on: the first unlocked layer in order, falling back to the very
first layer if everything happens to be locked. There is no UI yet to
*choose* a target layer explicitly — that's KL-006. KL-003 gives the
background the same lock semantics (selectable and read-only when locked,
otherwise fully editable) for consistency.

## Persistence

KL-008 makes a project survive the tab closing. Two mechanisms, with
deliberately different jobs:

- **Autosave**, to browser storage, is the safety net. It costs the user
  nothing and asks nothing of them.
- **A project file** (`.kl.json`) is the real, portable copy. It's the only
  one the user *owns*: browser storage doesn't move to another machine and
  doesn't survive clearing site data.

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

The obvious way to write a PDF is to translate the model into PDF drawing
operators. That would be a **second renderer**: every fill, stroke, label
and rotation re-implemented against a different API, drifting from the
Konva one every time either changed.

Instead `ui/components/PrintCanvas.tsx` renders the plan with the *same*
`PlanObjectShape` the editor uses, into an off-screen stage sized to the
sheet's drawing area, and that raster is embedded in the PDF. What you
print is what you saw, by construction.

`computePrintRaster` is the join: `rendering/` already turns metres into
pixels given a `Viewport`, so printing supplies a viewport whose scale
comes from paper instead of from the user's zoom. Nothing about drawing is
duplicated.

The trade-off, stated plainly: the drawing in the PDF is a raster, so it
doesn't stay crisp magnified far beyond its export resolution and its text
isn't selectable. Everything *around* the drawing — frame, title block,
captions and the scale bar — is real PDF vector at exact point
coordinates, so the bar a user measures is dimensionally true whatever the
raster's resolution.

`printing/pdf.ts` is a hand-written one-page writer (catalog, page,
content stream, a `DCTDecode` JPEG, one standard font). It is small
precisely *because* the drawing is a raster. Two details it gets right and
that are easy to get wrong:

- **Offsets are counted in bytes, not characters.** The cross-reference
  table records where each object starts; one accented character in a
  project name counted as a character would shift every later offset and
  produce a file that opens blank. Everything is assembled as
  `Uint8Array`, and a test pins it.
- **Text is encoded as WinAnsi, not Latin-1.** The two differ exactly
  where French lives: `œ`, the typographic apostrophe, the em dash, the
  ellipsis. Getting this wrong prints "Cœur — l'entrée…" as
  "C?ur ? l'entr?e?".

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
