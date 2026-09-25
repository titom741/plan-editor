# Plan Editor

A local, offline web app for drawing scaled 2D layout plans for events:
import a floor plan, calibrate it, then place chapiteaux, scènes,
installations électriques, barrières, zones de sécurité, etc. at their real
dimensions in meters.

Deliberately **not** a general-purpose CAD tool — it's scoped to fast,
simple event-layout drafting.

The **KL-010 to KL-025** programme derived from the 41-point product audit
is implemented locally. Only real-time multi-user synchronization and
connected-browser E2E execution remain dependent on external infrastructure.
The earlier KL-001 to KL-009 missions remain complete. See
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
- **Drag** empty canvas to pan (select tool only). Dès qu'un fond est
  visible, la navigation et la grille restent bornées à son emprise : le
  plan ne peut plus être perdu dans un canevas infini. **Cadrer le plan**
  le recentre intégralement.
- **Click** an object to select it; **drag** it to move it.
- **Drag any of the eight handles** on a selected rectangle — four corners
  and four edge midpoints — to resize it; hold **Maj** to keep its
  proportions. A circle has four handles, one per compass point. The
  handle **above** a selection rotates it.
  Hold **Maj** while rotating to constrain the angle to 15° increments.
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
  stack invisibly, and the copies become the new selection. The system
  clipboard lets KL selections cross between tabs, with an in-memory fallback.

**Creating objects** — pick a tool in the left panel, then:

- **Rectangle / Cercle / Ligne** — press, drag, release on the canvas.
- **Flèche** — the same gesture as a line, and the same object: a line
  that carries a head. Hold `Maj` to constrain the angle to 15° steps.
  Either end can be given or taken away afterwards from the properties
  panel, as it always could.
- **Polygone** — click to add each point, `Entrée` to finish (3+ points),
  `Échap` to cancel.
- **Texte** — click once to place it, then rename its content from the
  properties panel.
- **Symbole** — pick one from the palette that appears under the tools
  (arrows, safety marks, plain shapes, numbers ① to ⑩), then click to
  place it. It is centred on the point you click, sized in metres of
  ground like a text object, and turns on its own centre. The palette is
  fixed rather than free text: every character in it has a glyph in the
  PDF's own fonts, so what you see is what prints.

Every object-creation tool returns to Selection and selects the object you
just drew.

Le fond de plan peut être redressé par rotation et corrigé sans modifier
son fichier source (recadrage, luminosité, contraste, niveaux de gris,
suppression du blanc). Le remplacer conserve sa transformation et ses
réglages. Des plans complémentaires peuvent être importés comme images
ordinaires et superposés sur des calques verrouillables.

**Measurements and snapping**

- **Mesure** — click successive points to read each segment and the running
  total. From three points onward the enclosed area is shown too. `Entrée`
  adds the result to the plan; `Échap` clears the unfinished measurement.
  The resulting line or area can be selected, edited, styled, saved and
  printed, and its dimensions are recalculated when its vertices move.
- **Magnétisme** is enabled by default. Creation points, object anchors,
  resize handles and line/polygon vertices snap to visible grid
  intersections and to object vertices, edge midpoints and centres.
- Les lignes s'accrochent aussi aux intersections/prolongements et aux
  tangentes des cercles ; une sélection de trois objets ou plus peut être
  répartie à espacement régulier.
- Hold **Alt** during a gesture to bypass snapping temporarily, or clear
  the Magnétisme checkbox to disable it until you turn it back on. Hidden
  layers never contribute snap targets, and the objects being moved are
  excluded so a selection cannot snap to itself.
- The grid can be hidden. With **Limiter au fond**, it is clipped to the
  imported reference plan and does not attract the pointer outside it.

**Properties panel** — edit an object's name, position, dimensions,
rotation, or text directly; the canvas updates live as you type, and
dimensions on the canvas label update live as you drag.
It also exposes a custom label, fill/text colour, outline colour and
thickness, opacity, and text font size; all are preserved in project files
and in exports. Lines can be continuous, dashed or dotted, display an arrow
at either end, and use a wider stroke to represent a cable or path.

**Undo / redo** — `Ctrl`/`Cmd`+`Z` to undo, `Ctrl`/`Cmd`+`Shift`+`Z` (or
`Ctrl`/`Cmd`+`Y`) to redo, or the toolbar buttons. Covers creation, moving,
resizing, rotating, deleting, and property edits.

**Saving** — your project is saved automatically in this browser a moment
after you stop editing; the toolbar shows the save state, and reopening the
page restores the project (background image included). That copy is local
to this browser. **Récents…** lists every locally retained project and lets
you open, rename, duplicate or delete it, create a dated version and restore
an earlier version. Click the current project name in the toolbar to rename
it. Use **Enregistrer** for a real, portable
`.kli` copy you can back up or move to another machine, and **Ouvrir…**
to load one back. `.kli` files are JSON: the extension is what macOS
associates the app with, and files written under the earlier `.kl.json`
name still open. In the browser each save asks where the file goes — a
page is never told where a download landed, so it cannot write back to it.
In the macOS app it goes through the system panels, **Enregistrer** writes
straight back to the file you opened, and double-clicking a `.kli` in the
Finder opens it here. **Nouveau** starts an empty project (it asks first). A
file that isn't a valid project is refused with an explanation and your
current work is left untouched; opening or creating a project clears the
undo history, since undo can't meaningfully cross from one document into
another.

**Material library and schedule** — **Bibliothèque…** inserts common event
equipment with real dimensions, a reference, category and ready-made style.
Each object can carry a quantity and unit in the properties panel.
**Nomenclature…** groups items by layer/category/reference and exports a
spreadsheet-ready CSV; ordinary lines are measured in metres and polygons
in square metres when no explicit unit is set.

**Électricité** — the **Électricité** tools place an *Alimentation*
(réseau or groupe), a *Coffret* (arrivée mono/tri, calibre, différentiel,
départs), a *Multiprise* (mono or tri, with its rating) or a *Récepteur* (puissance) with one click, and
draw a *Câble* like a tracé: its ends plug into the devices they land on,
follow them when they move, and a new cable is sized for what it feeds.
Any existing rectangle, circle or line can take an electrical role from the
properties panel, which also shows load, current, voltage drop and alerts
(section too thin, tri fed in mono, overload, missing 30 mA RCD, drop over
5 %, loops…). **Projet › Schéma électrique…** shows the single-line
diagram, the balance per device, the cable to order and every alert, and
exports it all as a PDF. The checks are a conservative planning aid, not a
NF C 15-100 design note.

**Local diagnostic** — **Diagnostic** exports a technical JSON report for
troubleshooting. It stays on the machine unless you choose to share it and
contains no object names, text, coordinates or background image pixels.

**Exporting to paper** — **🖨 Exporter…** puts the plan on a sheet: create,
duplicate and switch between several named sheets, each with its own format,
orientation and scale, then export the active sheet as a
**PDF**, un **PDF multi-feuilles** avec recouvrement ou un **PNG** transparent. The
dialog tells you how much ground the sheet covers and how big your plan
actually is, and warns you *before* you print if it won't fit at the
chosen scale (with a one-click "Ajuster" to the nearest standard scale
that does). The scale is never changed for you — a sheet labelled 1:200
is at 1:200.

Scale is set three ways, because they answer different questions: the
ladder of standard scales, for a plan that will be read with a ruler on
site; a typed denominator, when the ladder is too coarse; and **Remplir
la feuille**, which picks the scale that fills the paper — rounding up
the ladder from the 1:137 the content needs to the 1:200 the ladder
offers leaves a third of the page white.
The dialog previews the actual rendered sheet and lets each sheet carry a
client, author, revision, plan number, comments, logo and custom fields in
its title block.

**Échanges et géoréférencement** — **Échanges…** exporte le plan ou la
sélection en SVG, DXF et GeoJSON. Une origine WGS84 et une rotation peuvent
être associées au projet ; GeoJSON est alors exporté et réimporté en vraies
longitude/latitude. Le DWG et les projections SIG spécialisées passent par
un convertisseur CAO/SIG externe.

**Commentaires et raccourcis** — les commentaires persistent avec le projet,
peuvent viser l'objet sélectionné et être résolus. **Raccourcis…** permet de
consulter et réaffecter les commandes clavier. La synchronisation simultanée
entre comptes n'est pas simulée : elle requiert un backend choisi et configuré.

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
- **▸** opens the layer's element list; click an element there to select it
  on the plan, including when objects overlap.
- The **Calque** dropdown in the properties panel moves the selection —
  one object or a whole group — to another layer.

**Background** — click "Importer un fond de plan…" in the layers bar (or
"Remplacer" in the properties panel once one exists) to choose a PNG/JPEG.
It's placed centered on the current view at an approximate size; select it
to inspect it. It is locked by default so dragging on the reference moves
the view rather than accidentally shifting the plan. Explicitly unlock it
to drag it into place or resize it from its corner (aspect ratio is
always preserved — a background is a photo/scan, not a shape to stretch),
and adjust its opacity from the properties panel.

**Calibration** — to give the plan its true real-world scale, select the
background and click **📏 Par distance**, then click two points on it whose
real distance you know (a door width, a marked dimension, a building
edge) and enter that distance. The background resizes to its true size;
`Échap` cancels at any point, and the whole calibration is a single undo
step. Calibrating never moves your objects and never changes the zoom
level — it corrects the background, not the plan. Recalibrate as often as
you like: each pass measures against the current scale, so repeating it
on the same segment gives the same answer instead of drifting.
Si le document possède une échelle imprimée et un DPI fiable, **1:100 Par
échelle** permet aussi de saisir directement ces deux valeurs.

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

## Where a saved file goes

"Enregistrer sous" takes the best route the host offers, and says which
one it took — the file it wrote is shown in the top bar.

| Host | What you get |
| --- | --- |
| macOS app | A real `NSSavePanel`, and the **full path** is displayed. |
| Chrome, Edge | A folder picker. The file name is shown; **no browser tells a page which folder was chosen** — that is a security boundary, not a missing feature. |
| Safari, Firefox | A plain download, into that browser's downloads folder. |

If you need the path on screen, that is what the macOS app is for.

## Lint & build

```bash
npm run lint    # oxlint
npm run build   # tsc -b, then the app bundle and the service worker
npm run serve   # serve dist/ on the local network, to try the real build
```

## Web deployment

The build is **path-independent**: `dist/` runs wherever it is dropped —
at the root of a domain, in a sub-directory, or from a folder served on
the venue's own network. Every path it emits is relative, the manifest's
`start_url` and `scope` resolve against wherever the manifest itself
lands, and the service worker derives its shell from `registration.scope`
rather than assuming `/`. One build, every host; there is no base URL to
configure and no second build for the sub-directory case.

Pushing to `main` deploys it to GitHub Pages —
<https://titom741.github.io/plan-editor/> — through
`.github/workflows/deploy.yml`, which runs lint, format check, tests and
build first: a bundle that fails a check never reaches the page.

To host it anywhere else, serve `dist/` as static files. The only
requirement is HTTPS (or `localhost`), without which the browser refuses
to register the service worker and the app simply loses its offline
shell.

### Icons

`public/*.svg` are the sources; `scripts/build-icons.sh` rasterises the
PNGs an installed app needs, and the PNGs are committed so the web build
never depends on macOS to produce them. Run it only when an SVG changes.

## macOS app

```bash
scripts/build-macos.sh          # web bundle + Swift shell + a signed .app
scripts/test-macos.sh           # the shell's own Swift tests
```

The shell is a `WKWebView` around the same web build, adding the two
things a browser tab cannot do: real save/open panels, and documents that
open by double-click. The build assembles a proper `.app` — a bare SwiftPM
executable has no `Info.plist`, so it gets no document association — and
signs it ad-hoc; set `SIGN_IDENTITY` to sign it for distribution.

The bundle is served to the web view over a `planeditor://` scheme rather
than opened from `file://`, which is what gives it a real origin: the same
absolute asset paths as on the web, and working `localStorage`/IndexedDB.
See `docs/ARCHITECTURE.md`.

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
