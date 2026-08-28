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
  gesture is a design question, not a missing function); and the system
  clipboard — copies live in memory, so
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

  La calibration par échelle connue (1:100 + DPI) et la calibration d'un
  fond tourné ont depuis été ajoutées dans KL-016/KL-017. Le cas `geo`
  reste ouvert.

- **KL-006 — Layers** *(done)*
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

- **KL-007 — Measurements** *(done)*
  An on-canvas ruler measures every segment, the running open length and,
  from three points onward, the enclosed area. `Enter` persists the result
  as an editable, printable line or polygon whose dimensions remain
  derived from geometry; `Escape` clears an unfinished measurement.

  Snapping is enabled by default for creation, movement, resize handles
  and line/polygon vertices. It targets the visible grid plus vertices,
  edge midpoints and centres of objects on visible layers, with a constant
  10 px screen tolerance at every zoom. Object targets take priority over
  the grid; the moving selection is excluded to prevent self-snapping.
  `Alt` bypasses snapping for one gesture and the Magnétisme checkbox turns
  it off persistently for the current editor session.

  Not covered, and still open: angular measurements, alignment guides and
  snapping to projected axes rather than discrete points.

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
  hand-written PDF writer, sheet layout with frame, title block
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

The first roadmap is complete. The product backlog below turns the 41-point
audit into bounded KL missions. A mission is only marked done when its UI,
persistence, tests and documentation are complete.

## Product backlog — audit des 41 améliorations

- **KL-010 — Bibliothèque métier et nomenclature** *(done)*
  Palette de matériels événementiels avec dimensions/styles prédéfinis,
  métadonnées (catégorie, référence, quantité, unité), légende et
  nomenclature regroupée par type/calque, export CSV puis PDF. Couvre les
  points **6, 10 et 26 (CSV)**. La bibliothèque, les quantités et le CSV
  sont implémentés, y compris longueurs, surfaces et regroupement par
  calque ; la nomenclature est exportable en CSV et en PDF textuel.

- **KL-011 — Portefeuille de projets et versions** *(done)*
  Plusieurs projets locaux, projets récents, duplication, renommage,
  suppression, instantanés datés et restauration d'une version. Couvre les
  points **2, 24 et 27**. La conservation et l'ouverture de plusieurs
  projets, le renommage, la duplication, la suppression et les versions
  datées restaurables sont implémentés. Une piste de récupération automatique
  est enregistrée toutes les cinq minutes d'activité et bornée aux vingt
  derniers instantanés, en complément de l'annuler/rétablir de session.

- **KL-012 — Cotations avancées** *(done)*
  Cotes linéaires persistantes, angles, surfaces annotées, unités et styles,
  association dynamique avec la géométrie ; fermeture explicite, retour au
  point précédent et reprise d'une mesure. Couvre les points **3 et 37**.
  Les longueurs ouvertes, angles à trois points et surfaces/périmètres fermés
  sont persistants, modifiables, stylables et imprimables. Retour arrière
  pendant la saisie avec Retour arrière, fermeture explicite par clic sur le
  premier point et reprise par modification des sommets sont disponibles.

- **KL-013 — Transformations de groupe et composants** *(done)*
  Redimensionnement/rotation d'une sélection multiple, groupes nommés,
  composants réutilisables et modèles enregistrables. Couvre les points
  **4 et 11**. Les groupes nommés, la sélection solidaire, le déplacement,
  la duplication, la mise à l'échelle uniforme et la rotation collective
  sont implémentés. Une sélection ou un groupe peut être enregistré dans la
  bibliothèque personnelle locale, réinséré, déplacé, dupliqué et supprimé.

- **KL-014 — Guides, contraintes et géométrie avancée** *(done)*
  Guides d'alignement, axes projetés, prolongements, intersections,
  tangentes, espacement régulier, contrainte de rotation par pas et retour
  visuel de l'accrochage. Couvre les points **7, 8 et 36 (guides/snap)**.
  La rotation et le dessin de ligne contraints par pas de 15° avec Maj,
  les guides horizontaux/verticaux projetés, les intersections de segments
  et prolongements, les tangentes aux cercles et la répartition régulière
  d'une sélection sont implémentés.

- **KL-015 — Nouveaux objets et styles complets** *(done)*
  Arcs, secteurs, flèches, pointillés, câbles avec largeur, portes,
  ouvertures, pictogrammes/images, polices et styles par défaut. Le calcul
  des limites du texte utilisera son étendue rendue. Couvre les points
  **9, 12 et 13**.
  Les traits continus/tirets/pointillés, flèches et largeurs de câbles sont
  désormais disponibles et conservés dans les fichiers/exports. Les polices,
  graisse, italique, alignement et l'étendue estimée du texte sont également
  gérés ; portes, véhicules et symboles techniques ont rejoint la bibliothèque.
  Les images/pictogrammes sont des objets ordinaires de calque. Arcs et
  secteurs métriques éditables sont fournis comme polylignes/polygones dans
  la bibliothèque, ce qui les rend compatibles avec tous les exports.

- **KL-016 — Fonds de plan multiples et traitement d'image** *(done)*
  Plusieurs fonds superposables, rotation/redressement, recadrage,
  luminosité/contraste, niveaux de gris, suppression du blanc et
  remplacement en conservant la transformation. Couvre les points
  **14, 16 et 17**. La rotation/redressement, la luminosité, le contraste,
  les niveaux de gris et le remplacement en conservant la transformation
  sont implémentés. La grille et la navigation sont automatiquement bornées
  à l'emprise tournée du fond, avec cadrage automatique et commande de
  recentrage. Le recadrage non destructif et la suppression paramétrable du
  blanc sont implémentés. Un fond principal reste la référence calibrée ;
  autant de plans complémentaires que nécessaire peuvent être superposés
  comme images ordinaires, placées et verrouillées sur leurs propres calques.

- **KL-017 — Calibration avancée et géoréférencement** *(done)*
  Calibration par échelle connue, coordonnées réelles, système de
  projection et import géoréférencé. Couvre les points **15 et 18**. La
  calibration directe par échelle connue et DPI (par exemple 1:100 à
  300 DPI) est implémentée. Le projet accepte une origine WGS84 et une
  rotation locale ; l'export et l'import GeoJSON convertissent réellement
  mètres locaux et longitude/latitude. Les projections SIG autres que
  WGS84 passent volontairement par un outil SIG externe.

- **KL-018 — Calques avancés** *(done)*
  Glisser-déposer d'objets entre calques, dossiers/sous-calques, opérations
  collectives, styles par défaut et choix de destination ou suppression des
  objets lors de la suppression d'un calque. Couvre les points
  **19, 20, 21 et 22**. Les objets se glissent depuis la liste vers un autre
  calque, les calques se classent en dossiers, disposent d'un style par
  défaut, et leur suppression propose une destination ou l'effacement
  explicite de leur contenu. Visibilité et verrouillage s'appliquent aussi
  collectivement à un dossier.

- **KL-019 — Échanges et presse-papiers interopérables** *(done)*
  Presse-papiers système, échange d'une sélection, SVG, DXF, GeoJSON,
  image transparente et stratégie documentée pour DWG. Couvre les points
  **25 et 26 (hors CSV)**. DWG nécessitera vraisemblablement un convertisseur
  externe ; DXF/SVG/GeoJSON restent locaux et sont maintenant exportables
  pour le plan entier ou la sélection. Le presse-papiers système transporte
  les objets entre onglets KL avec repli sur le presse-papiers mémoire.
  GeoJSON local ou WGS84 est importé nativement et le PNG peut conserver
  la transparence. Les imports CAO SVG/DXF complexes et le DWG utilisent
  la stratégie documentée de conversion externe afin de ne pas interpréter
  partiellement des fichiers métier.

- **KL-020 — Collaboration et révisions** *(local part done; backend required)*
  Partage, comptes, commentaires, synchronisation, historique partagé,
  résolution des conflits et édition simultanée. Couvre le point **23**.
  Les commentaires nommés, liés éventuellement à un objet, résolus/rouverts,
  sont persistants dans le fichier et les versions locales. Le partage avec
  comptes, la synchronisation et l'édition simultanée exigent encore le choix
  d'un backend, d'une politique d'accès et d'un hébergement par le propriétaire.

- **KL-021 — Feuilles, aperçu et cartouche** *(done)*
  Plusieurs feuilles avec réglages indépendants, prévisualisation fidèle,
  cartouche configurable (logo, client, auteur, révision, numéro,
  commentaires et champs personnalisés). Couvre les points **1, 28 et 30**.
  Plusieurs feuilles avec ajout, duplication, suppression, nom, format,
  orientation et échelle indépendants, aperçu fidèle et cartouche
  configurable sont implémentés, y compris logo réellement embarqué dans le
  PDF et champs personnalisés.

- **KL-022 — Impression multipage et PDF vectoriel** *(done)*
  Dessin réellement vectoriel, texte sélectionnable, découpage automatique
  en pages avec recouvrement/repères et stratégie de résolution explicite.
  Couvre les points **5, 29 et 31**. Les objets, contours et textes sont
  désormais écrits en primitives PDF vectorielles et le fond reste la seule
  image raster. Le plan est automatiquement découpé en un PDF multi-pages
  avec 10 mm de recouvrement, cadre d'assemblage et numérotation des pages.

- **KL-023 — Interface adaptative et accessibilité** *(done)*
  Panneaux repliables, tablette/tactile, pincement, poignées adaptées,
  navigation clavier du plan, représentation DOM parallèle accessible,
  aide et personnalisation des raccourcis. Couvre les points
  **32, 33, 34 et 35**.
  Les panneaux latéraux sont repliables, la disposition bascule en colonne
  sur mobile/tablette, le canevas accepte le pincement et une liste DOM
  parallèle rend les objets sélectionnables au clavier et lisibles par les
  aides techniques. Une fenêtre récapitule les raccourcis et permet de
  réaffecter chaque commande, avec restauration des valeurs par défaut.

- **KL-024 — Barre d'état et retours de dessin** *(done)*
  Coordonnées du curseur, distance/angle en direct, cible d'accrochage,
  calque actif/verrouillé plus visible et messages d'état consolidés.
  Couvre le point **36** (hors guides, traités en KL-014). La barre d'état
  affiche coordonnées, sélection, type exact d'accrochage et calque actif ;
  rectangles, cercles et lignes montrent dimensions et angle pendant le geste.

- **KL-025 — Robustesse, performances et diagnostic** *(local work done; browser runner external)*
  Scénarios end-to-end React/Konva, découpage dynamique du bundle, index
  spatial et cache pour les grands plans, limitation à la zone visible,
  mode de rendu simplifié et rapport de diagnostic local exportable sans
  télémétrie automatique. Couvre les points **38, 39, 40 et 41**.
  Les dialogues lourds et l'écriture des exports sont chargés à la demande.
  Un rapport de diagnostic anonymisé et entièrement local est exportable ;
  il exclut noms d'objets, textes, coordonnées et pixels du fond. Les cibles
  d'accrochage utilisent maintenant un index spatial, le rendu est limité au
  viewport et simplifié au-delà de 2 000 objets. L'éditeur/Konva est chargé
  à la demande : le plus gros chunk est passé sous 500 kB. Les 313 tests
  automatisés locaux passent. L'exécution de scénarios React/Konva end-to-end
  reste une étape d'intégration : elle demande l'installation d'un navigateur
  Playwright/Cypress (absent de cet environnement) ou la reconnexion de l'outil
  navigateur, et n'est donc pas déclarée comme exécutée ici.

### Correspondance exhaustive

Les 41 points sont affectés ainsi : 1→KL-021, 2→KL-011, 3→KL-012,
4→KL-013, 5→KL-022, 6→KL-010, 7–8→KL-014, 9→KL-015, 10→KL-010,
11→KL-013, 12–13→KL-015, 14→KL-016, 15→KL-017, 16–17→KL-016,
18→KL-017, 19–22→KL-018, 23→KL-020, 24→KL-011, 25→KL-019,
26→KL-010/KL-019, 27→KL-011, 28→KL-021, 29→KL-022,
30→KL-021, 31→KL-022, 32–35→KL-023, 36→KL-014/KL-024,
37→KL-012 et 38–41→KL-025.

## Audit pass (2026-08-28)

A full read of everything through KL-025, before committing the batch.
No feature work: two real defects fixed, `Editor.tsx` decomposed into
four hooks, three `window.prompt` chains replaced by forms, dead code
removed, and the reusable-component store made to validate what it reads
back. See "How `Editor` is decomposed" in `docs/ARCHITECTURE.md`.

Still open, and deliberately not done here:

- **No formatter.** The code written across KL-010+ is far denser than
  KL-001–009 (single lines of 400–2 000 characters); the worst were
  reformatted by hand, but the repo has no mechanical guard. Adding
  Prettier would settle it — as its own commit, so the reformat diff
  stays separate from real changes.
- **`domain/labels.ts` has no test file**, and it now carries the
  measurement-label branching.
- **`useSelection` / `useLayerActions` are untested**: exercising a hook
  needs a React test renderer, which the project does not have. The rules
  worth testing were moved into `domain/` instead.

## KL-026 — Menus, barre configurable, liste des éléments *(done)*

La barre du haut portait quinze boutons sur une ligne. Les actions vivent
maintenant dans un registre (`ui/commands.ts`) lu par trois consommateurs :
les menus « Fichier » et « Projet » du rail gauche, les boutons épinglés de
la barre du haut, et le dialogue de personnalisation (⚙). Ajout de
« Enregistrer sous… ». Nouveau panneau « Éléments » dans le rail droit :
inventaire filtrable par calque, avec dimensions, sélection partagée avec
le plan. Voir `docs/ARCHITECTURE.md`.

## KL-027 — Étiquettes configurables, rotation au centre *(done)*

Quatre commutateurs (nom, dimensions, référence, quantité) réglables pour
tout le plan (panneau Outils) ou objet par objet (panneau Propriétés) —
ce qui s'imprime dépend du destinataire du plan. Correction au passage
d'un défaut ancien : l'export PDF vectoriel ne dessinait **aucune**
étiquette de forme. La rotation tourne désormais autour du centre de
l'objet, poignée et champ compris, sans changer la convention stockée.
Texte à 2 m par défaut. Suppression du « libellé personnalisé » et de
Position X/Y du panneau. Voir `docs/ARCHITECTURE.md`.

## KL-028 — Outil tracé, main levée, mesures stylables *(done)*

Nouvel outil « Tracé » : clic pour poser un point, appui maintenu et
glisser pour dessiner à main levée, les deux mélangeables dans le même
objet. Entrée ou double-clic termine, Retour arrière annule le dernier
point. Les traits à main levée sont allégés à la validation
(Ramer–Douglas–Peucker, `domain/polyline.ts`), pas pendant le dessin. Les
mesures persistées reçoivent un style d'annotation propre (turquoise,
tirets, sans remplissage), modifiable comme n'importe quel objet ; la
longueur d'une ligne s'affiche via le commutateur « Dimensions » de
KL-027. Voir `docs/ARCHITECTURE.md`.

## KL-029 — Fonds de plan multiples, bibliothèque personnalisable *(done)*

`Project.background` (unique) devient `Project.backgrounds` (pile, du bas
vers le haut) : plusieurs fonds empilés, réordonnables, chacun avec son
nom, son placement, son opacité et ses corrections. Premier passage au
format 2 : les fichiers version 1 sont migrés à la lecture, un build
antérieur refuse un fichier version 2 plutôt que d'en perdre les fonds.
La calibration reste une propriété du plan mais redimensionne le fond sur
lequel elle a été mesurée. Bibliothèque : matériels personnels
(création, édition, suppression) et masquage des matériels intégrés,
stockés par installation. Voir `docs/ARCHITECTURE.md`.

## KL-030 — Subdivision des surfaces *(done)*

« Subdiviser en stands… » sur un rectangle crée un vrai objet par case :
nommé par référence de grille (Stand A1, A2…), sélectionnable, colorable,
supprimable et compté dans la nomenclature. Colonnes, rangées, allée entre
cases et retrait au pourtour ; la taille des cases est calculée en direct
et le bouton se désactive dès que le découpage ne tient plus. La grille
suit la rotation du parent. Une seule étape d'annulation pour l'ensemble.
Voir `docs/ARCHITECTURE.md` pour les deux limites assumées (pas de
groupement avec le parent, rectangles seulement).

## KL-031 — Coquille macOS, PWA, rails redimensionnables *(done)*

Audit et reprise du lot apporté hors session (coquille macOS `WKWebView`,
service worker, renommage en « Plan Editor », rails redimensionnables).
Ce qui a été corrigé :

- **Les en-têtes repliés sortaient du rail.** C'était la cause du
  symptôme, pas le pliage : le rail défilait au lieu de ses panneaux.
  Le rail ne défile plus, chaque panneau ouvert défile dans sa part et
  un panneau replié reste un en-tête toujours visible. L'accordéon
  introduit pour contourner le symptôme est retiré : il contredisait
  « repliable et **empilable** » et rendait le curseur de hauteur inutile
  (deux panneaux n'étaient jamais ouverts ensemble).
- **Le pliage était inversé** : replier un panneau repliait les trois du
  rail. La règle revient dans `panelSections.ts`, testée sans DOM.
- **Largeurs de rails non persistées** et non bornées à la relecture.
  `loadRailSizes` / `clampRailSize` bornent et arrondissent ; un rail
  stocké hors écran ne peut plus rouvrir l'application dans cet état.
  La poignée de largeur de l'inspecteur, absente, a été ajoutée.
- **Le champ « nom du projet » lisait `document.activeElement` pendant le
  rendu** pour deviner s'il était en cours d'édition — un rendu ne peut
  pas dépendre du focus. Remplacé par un état `editingName`. Au passage,
  son `import` traînait en fin de fichier.
- **Référence, quantité et unité avaient disparu du panneau Propriétés**
  alors que ce sont les trois colonnes sur lesquelles `buildSchedule`
  regroupe : la nomenclature ne pouvait plus rapporter qu'une unité de
  chaque. Rétablies dans un bloc « Nomenclature » replié par défaut.
- **« Enregistrer sous » signalait une erreur quand on annulait** le
  dialogue natif. `saveProjectFileAs` renvoie `false` sur `AbortError` :
  annuler n'est pas un échec.
- **Le service worker répondait `index.html` à n'importe quelle requête
  échouée**, y compris un script — une erreur réseau claire devenait une
  erreur de type MIME. Repli réservé aux navigations.
- **`Sources/PlanEditorMac/WebApp/` est une copie de `dist/`** que
  `scripts/build-macos.sh` régénère : sortie de git, où elle aurait
  churné à chaque build web et où oxlint la parcourait.

La barre d'état du canevas (coordonnées, sélection, magnétisme, calque
actif) et la liste accessible des objets sont supprimées volontairement —
décision confirmée, ne pas les rétablir. La barre mangeait le bas du plan
pour des informations déjà lisibles dans les panneaux, et le panneau
Éléments de KL-026 remplace la liste avantageusement : mêmes boutons avec
`aria-pressed`, mais groupés par calque sous un titre, avec un filtre et
les dimensions de chaque objet.
