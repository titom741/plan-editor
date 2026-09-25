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

## KL-032 — Combler les trous de tests *(done)*

Quatre modules sans fichier de test, choisis par le risque plutôt que par
la taille : `domain/labels.ts`, `domain/snapping.ts`,
`persistence/catalogStorage.ts` et `persistence/componentStorage.ts`.
450 tests au total.

`snapping.ts` était le vrai trou : le magnétisme décide où atterrit chaque
point d'un plan, et rien ne le couvrait. Les tests fixent notamment la
règle documentée — un point d'objet l'emporte sur une intersection de
grille plus proche — et le fait qu'un guide d'alignement ne contraint
qu'un axe en laissant l'autre exactement sous le curseur.

Un défaut trouvé en écrivant les tests : `parseItem` acceptait une forme
sans sa géométrie. Un rectangle sans dimensions se relisait, s'affichait
en « 0 × 0 m » et s'insérait en placeholder 1 × 1 m portant le nom et la
référence de l'utilisateur. Le stockage le refuse maintenant, comme le
dit déjà son propre commentaire : une entrée cassée est écartée, pas
réparée.

`src/testing/memoryStorage.ts` remplace les `localStorage` en mémoire
recopiés dans chaque fichier de test, et ajoute un stockage qui refuse
toute écriture — le cas « navigation privée / quota plein » que ces
modules affirment tolérer et que personne ne vérifiait.

Reste ouvert : les hooks React, faute d'un moteur de rendu de test que le
projet évite volontairement — voir KL-034 pour ce qui a pu être couvert
sans.

## KL-033 — Tests de l'autosauvegarde *(done)*

`persistence/projectStorage.ts` était le dernier gros module sans test, et
celui où un défaut coûte le travail de l'utilisateur. Couvert par
`src/testing/fakeIndexedDb.ts` : un faux maison limité à la surface que ce
module touche, plutôt qu'une dépendance (`fake-indexeddb`) pour un seul
fichier. Deux comportements y sont fidèles à dessein — les requêtes se
résolvent de façon asynchrone (les appelants posent `onsuccess` après coup,
un faux synchrone sauterait tous les gestionnaires), et `getAll` et
`getAllKeys` s'accordent sur l'ordre, hypothèse dont dépend le zip par
index dans les deux fonctions de listage.

28 tests couvrant la reprise après onglet tué (un enregistrement à moitié
écrit est signalé « corrupt », pas remplacé par un projet vierge), le quota
plein, le stockage indisponible, le double classement autosave + `project:`,
le renommage, la duplication, et la purge bornée des versions automatiques.

Les tests ont été validés par mutation : huit défauts introduits
volontairement dans le module, huit détectés. Deux d'entre eux passaient
initialement à travers, et les tests correspondants ont été refaits — celui
sur la clé de version ne semait aucun enregistrement, donc le garde-fou
pouvait disparaître sans rien casser ; celui sur l'intervalle des versions
automatiques appelait trois fois la fonction dans la même milliseconde,
donc les trois écritures partageaient une clé et s'écrasaient.

## KL-034 — Le reste de ce qui est testable sans DOM *(done)*

`ui/projectFileActions.ts`, `domain/objects.ts` et `domain/ids.ts`.
507 tests.

`projectFileActions.ts` est le plus important des trois : le fichier
`.kl.json` est le seul exemplaire du projet que l'utilisateur **possède**
— l'autosauvegarde vit dans le navigateur, qu'un cache vidé, un autre
navigateur ou une autre machine n'auront pas. Les tests couvrent le
nom de fichier proposé (accents pliés, ponctuation réduite, repli sur
« projet » quand il ne reste rien d'utilisable, troncature à 60), les six
messages d'erreur d'ouverture, la lecture d'un fichier illisible, et les
trois chemins d'« Enregistrer sous » : dialogue natif, annulation (qui
renvoie `false` et n'est pas une erreur), et repli sur le téléchargement
là où il n'y a pas de dialogue natif — Safari et la coquille WKWebView.

`src/testing/downloadCapture.ts` remplace les quatre morceaux de DOM que
traverse un téléchargement (`URL.createObjectURL`, sa révocation,
`document.createElement`, le clic) et retient le nom de fichier et les
octets. Il vérifie aussi que l'URL blob est bien libérée au tick suivant
et pas immédiatement — la révocation synchrone annule le téléchargement
dans certains navigateurs.

Suites validées par mutation, comme KL-033 : sept défauts introduits dans
`projectFileActions.ts`, sept détectés.

### Ce qui restera non testé, et pourquoi

Les hooks de `ui/hooks/` sont du câblage React au-dessus de modules déjà
couverts : `useSheetExport` délègue à `printing/sheetLayout.ts`,
`useProjectHistory` à `history/`, `useSelection` à `domain/selection.ts`.
Les tester demanderait un moteur de rendu de test pour vérifier
essentiellement des `useMemo` — mauvais rapport. Les composants `.tsx`
sont dans le même cas. Si un jour une décision non triviale s'installe
dans un hook, la bonne réponse est de l'extraire dans un module pur et de
tester celui-là, comme `panelSections.ts` l'a fait pour le pliage des
panneaux.

## KL-035 — Le fichier appartient vraiment à l'utilisateur *(done)*

La coquille macOS de KL-031 enfermait le web dans un `WKWebView` et
s'arrêtait là : `WKWebView` n'implémente aucun File System Access, donc
**dans l'application** chaque enregistrement retombait sur un
téléchargement vers `~/Téléchargements`. L'application de bureau était
moins bonne que le navigateur sur la seule chose pour laquelle on installe
une application de bureau : choisir le dossier, réécrire le fichier qu'on
a ouvert, double-cliquer un projet dans le Finder.

- **`.kl.json` devient `.kli`.** macOS associe les documents par extension
  via Launch Services, et ne reconnaît pas une extension en deux morceaux :
  `.kl.json` est vu comme `.json`, et revendiquer *celui-là* ferait de
  l'application le gestionnaire de tous les fichiers JSON de la machine.
  Le contenu reste du JSON. Les fichiers écrits avant le renommage
  s'ouvrent exactement comme avant — rien de ce que cette application a
  écrit ne doit devenir illisible par elle.
- **La fenêtre était vide, dans tous les builds, depuis KL-031.** Le
  `loadFileURL` sur `index.html` ne pouvait pas marcher : Vite émet des
  chemins absolus (`/assets/…`), qui sous `file://` désignent la racine du
  disque — le script de l'application ne se chargeait jamais. Et une page
  `file://` a une origine opaque, donc ni `localStorage` ni IndexedDB :
  l'autosauvegarde, la bibliothèque, les composants, les raccourcis et la
  largeur des rails n'auraient rien retenu. `WebAppScheme.swift` sert
  désormais le bundle sur `planeditor://app/` — une vraie origine, où les
  chemins absolus et le stockage se comportent comme sur un serveur web,
  sans toucher au build web. Un `base: "./"` côté Vite aurait réparé les
  chemins et laissé le stockage cassé ; un serveur `http://localhost`
  aurait ouvert une socket d'écoute, ce que « aucun backend, aucune
  dépendance réseau » interdit de faire à la légère.
- **Un pont `WKScriptMessageHandlerWithReply`** (`ui/nativeBridge.ts` /
  `FileBridge.swift`) : `saveAs`, `save`, `open`. La page attend la
  réponse, donc un panneau annulé est une valeur ordinaire et non un
  délai d'attente à deviner. Rien ne suppose le pont présent : dans un
  navigateur, `isNativeBridgeAvailable()` est faux et les chemins web
  d'origine s'appliquent.
- **Trois issues pour « Enregistrer sous », par ordre décroissant de
  contrôle laissé à l'utilisateur** : `NSSavePanel`, File System Access,
  téléchargement. `cancelled` devient un résultat à part entière : dire à
  quelqu'un que son enregistrement a échoué parce qu'il a fermé le
  dialogue est un mensonge.
- **« Enregistrer » réécrit le fichier ouvert**, sans dialogue, quand la
  session sait où il est. Seule la coquille peut le savoir ; ailleurs
  chaque enregistrement redemande.
- **Double-clic dans le Finder.** Un `.kli` ouvre l'application, ou est
  livré à la page déjà chargée. Lancé *par* le double-clic, l'URL attend
  que la page se déclare prête. À partir de là c'est la même porte que
  n'importe quelle ouverture, refus d'un fichier invalide compris.
- **Un vrai `.app`.** `scripts/build-macos.sh` assemble le bundle et son
  `Info.plist` (un exécutable SwiftPM nu n'en a pas, donc pas d'icône ni
  d'association de document) et le signe — ad hoc par défaut,
  `SIGN_IDENTITY` pour distribuer.

Tests : `src/testing/nativeBridgeStub.ts` reproduit le pont côté web, ce
qui couvre enregistrement, ouverture et livraison Finder sans Mac dans la
boucle ; `FileBridgeTests.swift` et `WebAppSchemeTests.swift`
(`scripts/test-macos.sh`) couvrent la moitié Swift qui n'est pas de
l'AppKit — routage, refus de sortir du bundle par `..`, types MIME.
535 tests JS et 15 tests Swift, les trois suites validées par mutation
(cinq défauts introduits dans chacune, quinze détectés).

Reste non testé, et volontairement : `NSOpenPanel`/`NSSavePanel` et le
rappel `NSApplicationDelegate` — de l'interface AppKit et un événement de
lancement, hors d'atteinte d'un processus de test. La logique en a été
sortie jusqu'à ce qu'il ne reste que l'appel au panneau.

Le rendu de l'application assemblée, lui, a été vérifié en la lançant et
en relisant depuis la page son origine, sa racine React et son stockage
(`origin=planeditor://app`, `localStorage` et IndexedDB opérationnels,
quatre canevas Konva montés). C'est une étape manuelle : d'où la ligne de
journal ajoutée quand la page se charge en restant vide, puisque
précisément personne n'avait regardé.

Reste ouvert : la coquille ne garde pas de `FileSystemFileHandle` dans les
navigateurs qui en proposent, donc « Enregistrer » y redemande toujours ;
et l'application n'est pas notarisée.

## KL-036 — Un seul menu ouvert à la fois dans le rail gauche *(done)*

Le rail gauche est réordonné en **Fichier, Projet, Outils**, et ouvrir un
menu replie celui qui était ouvert. Le rail droit est inchangé : Propriétés
et Éléments restent empilables, parce qu'ils se lisent *pendant* l'édition,
côte à côte.

C'est un retour en arrière assumé sur KL-031, qui avait retiré l'accordéon
de ce rail. KL-031 avait raison sur le bug qu'il corrigeait — les en-têtes
repliés sortaient du rail parce que le *rail* défilait au lieu de ses
panneaux, et l'accordéon ne faisait que masquer le symptôme ; ce correctif
de mise en page reste en place. Ce qui change est la lecture de ce que sont
ces trois panneaux : des endroits où l'on va chercher quelque chose et d'où
l'on repart. Et l'argument de KL-031 — l'accordéon rendait le curseur de
taille inutile — porte sur le rail *droit*, qui a un partage de hauteur ;
le rail gauche n'a qu'une largeur, dont un menu ouvert a autant besoin que
trois.

La règle est une propriété du rail (`PanelRail.exclusive`) et non du
panneau. Replier ne reste jamais contagieux : seule l'ouverture replie, et
seulement dans son propre rail ; replier le dernier menu ouvert laisse le
rail vide, ce qui est un état légitime — c'est ainsi qu'on rend toute la
largeur au plan. Un état enregistré par un build qui empilait les trois est
normalisé à la lecture, en gardant la palette ouverte. Sur une installation
neuve, c'est Outils qui est ouvert : c'est le panneau utilisé en continu.

17 tests sur `panelSections.ts`, validés par mutation (six défauts
introduits, six détectés).

## KL-037 — Un build déployable partout *(done)*

L'application n'avait jamais été déployée : `dist/` est ignoré par git,
aucun hébergeur n'était choisi, et le build ne pouvait de toute façon
servir qu'à la racine d'un domaine. Chemins absolus dans le HTML,
`start_url`/`scope` à `"/"`, coquille du service worker écrite en dur en
`["/", "/index.html", …]`, `register("/sw.js")`. Servi depuis
`/plan-editor/`, tout cela demande à l'hôte des fichiers qui n'y sont pas
et rend un `<div id="root">` vide — le symptôme exact de la fenêtre
blanche de KL-031, et pour la même raison de fond : personne ne charge le
bundle construit pour le regarder.

- **Le build devient relatif** (`base: "./"`, manifeste et worker résolus
  contre leur propre URL). Un seul build tourne à la racine d'un domaine,
  sous `/plan-editor/`, depuis un dossier servi sur le réseau du site, et
  derrière le schéma `planeditor://app/` de la coquille macOS. Un
  `base: "/plan-editor/"` en dur aurait lié le bundle à un hôte et fait de
  chaque autre cas un second build.
- **Le service worker devient un module construit et testé.**
  `public/sw.js`, écrit à la main et livré tel quel, était le seul code
  capable de servir durablement le mauvais fichier à un utilisateur, et le
  seul sans test. Il est découpé en `src/pwa/swCore.ts` (les décisions,
  pures) et `src/pwa/sw.ts` (le câblage), construit par
  `vite.sw.config.ts` vers `dist/sw.js` — nom fixe et non haché, puisque
  l'URL d'un worker *est* sa portée. Deux règles ont changé au passage :
  ce qui est mis en cache se mesure à la portée et non à l'origine
  (`titom741.github.io` héberge toutes les pages du compte), et la
  coquille est semée fichier par fichier — `addAll` est atomique, un
  favicon manquant supprimerait tout le hors-ligne en silence.
- **Icônes PWA en PNG** (192, 512) plus une variante *maskable* à part,
  pleine page et dessin dans la zone sûre à 80 % : déclarer un seul
  fichier `"any maskable"` comme le faisait le manifeste donne
  nécessairement tort à l'un des deux usages. `scripts/build-icons.sh` les
  rend avec `sips` ; les PNG sont committés pour que le build web ne
  dépende pas de macOS.
- **GitHub Pages** (`.github/workflows/deploy.yml`) : lint, format,
  tests et build avant le déploiement — un bundle qui échoue à un contrôle
  n'atteint pas la page. C'est aussi la première fois que ces contrôles
  tournent ailleurs que sur la machine de développement.

560 tests, dont 20 nouveaux sur `swCore.ts`, validés par mutation (sept
défauts introduits, sept détectés).

Le build assemblé a été **vérifié servi depuis un sous-répertoire**, pas
seulement construit : racine React montée, quatre canevas Konva, worker
enregistré sur la portée `/plan-editor/`, coquille en cache aux bonnes
URL, `localStorage` opérationnel, aucune erreur de console. C'est
manuel — l'automatiser reste à faire.

Restent ouverts, sans numéro réservé : la distribution du `.app` macOS
(binaire universel, icône, version réelle, notarisation, DMG) et un smoke
test du bundle en intégration continue.

## KL-038 — Les stands redeviennent du texte *(done)*

KL-030 découpait un chapiteau en **vrais objets**, un par case. Le
raisonnement tenait — un stand est une chose : attribuée à un exposant,
tarifée, comptée dans la nomenclature — et le résultat était quand même
mauvais à l'usage. Un chapiteau de trente stands devenait trente objets
qu'il fallait éviter de sélectionner, qu'on déplaçait par mégarde, et qui
noyaient le panneau Éléments ; passer de « 4 colonnes » à « 5 » voulait
dire supprimer vingt rectangles et recommencer.

La grille est désormais une **propriété du chapiteau**
(`RectangleObject.stands`) et n'écrit que du **texte** : un libellé libre
par case, saisi colonne par colonne, affiché ou masqué par la case
« Stands » qui rejoint Nom, Dimensions, Référence et Quantité — au niveau
du plan comme objet par objet. Rien n'est créé, donc rien n'est à
nettoyer.

Ce que ça coûte, dit franchement : **les stands ne sont plus comptés dans
la nomenclature**, et un stand ne peut plus être coloré ni supprimé
individuellement. C'est le compromis assumé ; les plans déjà subdivisés
gardent leurs objets, rien ne casse et rien ne devient illisible.

- **Une case vide n'écrit rien** — c'est ainsi qu'on réserve un coin
  technique ou une buvette, sans inventer un second concept.
- **Les libellés sont stockés rangée par rangée, et le redimensionnement
  les repose par (rangée, colonne).** Compléter le tableau à plat aurait
  été plus court et aurait déplacé en silence le texte de l'utilisateur
  dans les mauvaises cases dès l'ajout d'une colonne.
- **Un chapiteau qui écrit des stands remonte son propre nom au-dessus de
  son bord.** Les deux étaient centrés, donc les deux atterrissaient dans
  la case du milieu. Écran et PDF posent la même question à
  `standGridToDraw`, sinon l'un des deux dérive.
- **Format de fichier inchangé.** `stands` est un champ optionnel, ce que
  la règle du parseur admet sans bump de `SCHEMA_VERSION` ; l'interrupteur
  absent d'un `labelDisplay` écrit avant cette mission vaut « activé »,
  car un réglage manquant n'est pas un réglage corrompu. Une grille
  *présente* reste validée strictement — un tableau de libellés qui ne
  correspond pas à la grille est refusé, pas rafistolé.

La géométrie de KL-030 survit intacte, allée et retrait au pourtour
compris : l'intérêt d'un plan à l'échelle est que le texte tombe là où le
stand sera.

590 tests, dont 29 nouveaux sur `stands.ts`, validés par mutation : douze
défauts introduits, douze détectés. L'un d'eux est passé au premier
essai — retirer le garde-fou « seulement un rectangle » ne cassait rien,
puisqu'un cercle n'a de toute façon pas de champ `stands`. Le test a été
refait avec un cercle portant une grille parasite, comme un fichier
édité à la main peut en produire.

Vérifié dans le navigateur, pas seulement construit : grille saisie,
libellés dessinés à leur place, case vide muette, nom du chapiteau remonté
au-dessus, et retour au centre dès que la case « Stands » est décochée.

## KL-039 — L'export dit la vérité *(done)*

Trois promesses de l'export et de l'enregistrement qui n'étaient pas
tenues, remontées à l'usage.

- **L'aperçu avant impression ne s'affichait pas.** Il n'était pas cassé,
  il était écrasé : `.export-dialog` est un flex colonne borné à `92vh`,
  tous ses enfants sont compressibles par défaut, et `.sheet-preview`
  portait `overflow: auto` — ce qui en faisait le moins cher à compresser.
  Il tombait à 23 px de haut pendant que la page qu'il contenait faisait
  toujours 562 × 398. `flex: 0 0 auto`, et c'est le dialogue qui défile.
  Au passage, il rendait à 34 DPI fixes : tout ce qui dépasse l'A4 était
  montré par un coin. `previewDpiToFit` déduit la résolution du papier,
  A0 compris.
- **L'échelle n'existait que par paliers.** L'échelle libre reste
  discutable — un plan marqué 1:137 ne se vérifie pas à la règle, et
  `domain/sheets.ts` le dit toujours — mais ce n'est pas le seul usage :
  un plan fait pour occuper la page veut l'échelle qui la remplit, et
  arrondir du 1:137 nécessaire au 1:200 du palier laisse un tiers de
  papier blanc. Les deux coexistent : un champ « 1: exactement » borné et
  arrondi à l'entier, et un bouton **« Remplir la feuille »**. Le menu
  déroulant garde une entrée « (personnalisée) » explicite, sinon il
  reviendrait sur le premier palier et annulerait en silence le choix
  qu'on vient de faire.
- **« Enregistrer sous » ne disait jamais où.** `SaveDestination` était
  bien mémorisé et affiché **nulle part** — y compris dans l'app macOS,
  le seul hôte qui obtient un vrai chemin, par `NSSavePanel`, et la raison
  même d'être du pont. Le type nomme maintenant ses trois routes :
  `path` (panneau macOS — le chemin est affiché), `picked` (File System
  Access — le navigateur **ne communique pas** le dossier à la page ;
  c'est une barrière de sécurité, pas un trou à contourner, donc on nomme
  le fichier et on dit pourquoi) et `downloaded` (Safari, Firefox — là le
  dossier est connu, ce sont les téléchargements). Le chemin ou le nom
  s'affiche dans la barre du haut.

**À retenir, sans détour : aucun navigateur ne donnera jamais le chemin
complet.** Pour l'avoir dans l'application, c'est la coquille macOS — qui
le récupérait déjà et se contentait de ne pas le montrer.

610 tests, dont 19 nouveaux, validés par mutation : dix défauts
introduits, dix détectés.

Vérifié dans le navigateur : feuille A3 entière visible dans l'aperçu avec
son cadre et son cartouche, « Remplir la feuille » qui passe le plan de
démonstration de 1:200 à 1:25 (la feuille couvre alors 10 m × 6,9 m pour
un plan de 10 × 5 m), et 1:137 saisi à la main correctement signalé comme
personnalisé.

## KL-040 — Le texte, et la main sur le plan *(done)*

Quatre reproches d'usage, trois sur le texte et un sur le geste le plus
fréquent de l'application.

- **Le déplacement du plan partait tout seul.** Le pan repose sur le
  `Stage` Konva rendu draggable : à chaque `dragmove` on reversait sa
  position dans l'offset du viewport, puis on le remettait à (0, 0). Sauf
  que cette position est le déplacement **total depuis l'appui**, pas le
  pas depuis l'événement précédent — Konva la calcule comme
  `pointeur − offset`, où l'offset est mesuré une seule fois, au début du
  geste, et remettre le nœud à zéro ne le remesure pas. On appliquait
  donc tout le trajet à chaque image : un glissement régulier de *d*
  pixels par image déplaçait le plan de *d*, puis *2d*, puis *3d*.
  `rendering/dragPan.ts` ne demande plus rien au nœud et suit le
  pointeur, où le pas est sans ambiguïté. Amorcé au `mousedown` (et au
  `touchstart` à un doigt) plutôt qu'au `dragstart` : Konva attend trois
  pixels avant d'appeler un appui un glissement, et ces trois pixels sont
  du mouvement que l'utilisateur a fait.
- **Les noms de stands sont dimensionnés par leur case.** 12 px fixes ne
  peuvent pas convenir à la fois à un chapiteau coupé en deux et au même
  coupé en six. `rendering/labelFit.ts` déduit la taille de la case et
  autorise un nom à passer sur deux lignes — c'est justement ce qui
  *permet* la taille supérieure, une case étroite étant rarement basse.
  Une seule taille pour toute la grille, fixée par le nom le plus long :
  des cases identiques qui écriraient « Bar » en grand et
  « Boulangerie » en petit se liraient comme une erreur. Les traits
  d'union sont sécables — « Sapeurs-pompiers » à lui seul rabaissait
  toute la grille. Sous une taille minimale, on n'écrit rien : c'est ce
  qui fait qu'un plan dézoomé reste un plan et pas un aplat gris.
- **La longueur d'une ligne se lit au milieu de la ligne.** Elle était
  écrite au premier point, celui par lequel le tracé a commencé.
  `polylineMidpointM` donne le point à mi-*longueur* — pas le centre de
  la boîte englobante, qui sur un tracé en L ne tombe même pas sur le
  trait. La longueur courante de l'outil tracé a suivi.
- **La taille du texte d'une forme se règle.** `style.labelFontSize`, en
  pixels écran, avec un champ « Taille du texte (px) » dans les
  propriétés. En pixels écran parce qu'une étiquette est une annotation :
  elle reste lisible à tous les zooms, contrairement au texte d'un objet
  `text`, qui est en mètres et fait partie du dessin. Sur un chapiteau,
  le même réglage plafonne aussi ses stands.

652 tests, dont 42 nouveaux, validés par mutation : douze défauts
introduits, douze détectés. Deux ont survécu au premier essai — un milieu
de polyligne dégénérée (tous les points confondus, où le ratio devient
0/0 et l'étiquette part en NaN) et une case large et basse, où c'est la
hauteur qui borne la taille. Les deux tests manquaient ; ils ont été
écrits, et les douze défauts sont détectés.

Vérifié dans le navigateur, pas seulement construit : glissement de
645 × 430 px mesuré au pointeur, plan déplacé de 645 × 430 px (1:1, sans
accélération) ; « Boulangerie Dupont » et « Sapeurs-pompiers » coupés en
deux lignes dans une grille de 6 × 2, tous les stands à la même taille ;
« Ligne 1 / 51.75 m » au milieu du tracé, et la même étiquette passée à
30 px depuis le panneau. Contrôlé aussi dans l'aperçu avant impression,
où le rendu passe par `renderScale` : noms de stands sur deux lignes à
1:200, et rien du tout à 1:949, où les cases ne sont plus lisibles.

## KL-041 — Le PDF écrit les étiquettes à leur taille *(done)*

Remonté à l'usage, une phrase : « lorsque j'exporte, le texte des stands
est trop petit pour qu'il soit visible sur le PDF ».

C'était un défaut, pas un réglage. KL-040 dimensionne les noms de stands
d'après leur case, et **cela n'avait aucun effet sur le PDF** : un PDF ne
rasterise que ce que le vectoriel ne sait pas dire (les images), et écrit
formes et étiquettes en vrai texte PDF. Ce chemin-là, `ui/exportSheet.ts`,
les écrivait toutes à un `LABEL_SIZE_PT = 6` en dur.

Six points font 2,1 mm. Mais la taille n'était pas le défaut : c'est
d'être sourd. Une case de stand de 50 mm sur le papier recevait les mêmes
6 pt qu'une de 5 mm, la taille réglée sur l'objet était ignorée, et les
lignes étaient centrées **en comptant les caractères** — ce qui décale
visiblement tout nom étroit.

- **Une seule règle, trois unités.** Le calculateur de
  `rendering/labelFit.ts` prend une boîte et rend une taille dans l'unité
  de cette boîte : pixels écran, pixels d'impression, et maintenant
  points. `printing/standLabels.ts` porte la moitié papier — bornes,
  retrait, `fitStandLabelsPt` — et l'export comme le dialogue l'appellent,
  sinon la feuille et l'avertissement sur la feuille se contrediraient.
- **La taille d'une étiquette sur le papier ne se choisit pas.** Un pixel
  CSS fait 1/96 de pouce, un point 1/72 : 0,75 pt par pixel, exactement la
  conversion que la moitié raster applique déjà. Le défaut de 14 px sort
  donc à 10,5 pt, et le champ ajouté en KL-040 gouverne aussi le PDF.
- **Le plancher est celui de l'ISO 3098, 1,8 mm.** En dessous, un nom
  n'est pas lu mais deviné : la case sort vide, comme à l'écran en
  dézoomé. C'est honnête et muet, et le muet est ce qui envoie chez
  l'imprimeur pour rien — le dialogue d'export le dit donc avant :
  « À 1:5000, les noms de stands sont trop petits pour être imprimés et
  seront omis. Passer à 1:2817 ».
- **L'échelle proposée est cherchée, pas calculée.** La forme fermée
  semble évidente (diviser le dénominateur par deux double chaque case)
  et elle est fausse : le retrait autour du nom vaut deux points fixes et
  ne suit pas la case. La première version annonçait 1:338 là où la vérité
  était 1:300 — une proposition qui ne fait rien quand on la presse est
  pire que pas de proposition. Dichotomie sur le dénominateur, qui ne
  suppose que la monotonie.
- **Deux placements alignés sur l'écran** au passage : l'étiquette d'une
  ligne se lit à mi-longueur du tracé et non au point de départ, et tout
  texte est centré avec le modèle de largeur du calculateur.

674 tests, dont 22 nouveaux, validés par mutation : treize défauts
introduits, treize détectés. Deux ont survécu au premier essai — un test
d'emplacement trop faible (il comparait des points à des pixels et
passait quoi qu'il arrive) et une branche morte dans le verdict, dont la
suppression a été la vraie correction.

Mesuré, pas supposé, en relisant les octets du PDF produit : chapiteau de
20 × 10 m coupé en huit stands, sur A3 paysage. Avant, 6 pt partout. Après :
1:100 → 15 pt (le plafond), 1:200 → 11,2 pt, 1:500 → rien (les cases font
8,8 mm), et le nom du chapiteau à 10,5 pt au lieu de 6. Vérifié aussi dans
le navigateur : le dialogue affiche « Noms de stands — 5,3 mm (15 pt) » à
1:200, l'avertissement à 1:5000, et le bouton « Passer à 1:2817 » donne
exactement 1,8 mm (5 pt) — le plancher, au point près.

## KL-042 — Les étiquettes tournent avec le plan *(done)*

Suite de KL-041, remontée à l'usage : « les noms de stands sont
horizontaux et ne suivent pas l'orientation du chapiteau ».

Même partage que la fois précédente. La moitié raster a la rotation
gratuitement : chaque étiquette est un enfant du groupe Konva qui porte
`rotation={object.rotationDeg}`. La moitié vectorielle doit la dire, et ne
la disait pas — `PdfTextItem` transporte un `rotationDeg` depuis le
premier PDF (un objet `text` s'en sert), mais les étiquettes étaient
écrites sans, à plat sur la page pendant que la forme nommée était
tournée.

- **Tourner les lettres seules aurait été pire que de ne rien tourner.**
  Chaque ligne est posée par un décalage depuis un point d'ancrage — une
  demi-largeur à gauche, un pas par ligne — et ces décalages doivent
  tourner aussi, sinon le nom sort de la case qu'il désigne dès que le
  chapiteau est de biais, et un nom sur deux lignes se couche en travers
  de son voisin. `stackedText` tourne donc ses décalages avec la matrice
  que `printing/pdf.ts` écrit dans `Tm`.
- **L'angle est celui de l'objet, nié.** Le PDF a son y vers le haut :
  une forme tournée dans le sens horaire à l'écran est tournée dans
  l'autre sens sur la page. C'est déjà la convention d'un objet `text` et
  du DXF.
- **Deux ancrages sont passés dans le repère propre de l'objet**, parce
  que « au-dessus » n'a de sens que là. Le nom d'un chapiteau se pose au
  milieu de son **bord haut** — `objectLocalToWorld` de `(largeur/2, 0)`
  — et non au sommet de sa boîte englobante : sur un chapiteau droit les
  deux points se confondent, ce qui explique que personne ne l'ait vu, et
  sur un chapiteau tourné la boîte englobante n'a pas de bord haut.

679 tests, dont 5 nouveaux, validés par mutation : six défauts introduits,
six détectés. Deux ont survécu au premier essai, et tous deux parce que le
test était trop faible : comparer la *valeur absolue* du pas de ligne
laissait passer une matrice transposée (le texte miroir), et un chapiteau
droit ne distingue pas son coin de son bord haut — il a fallu deux
étiquettes de largeur identique pour que l'alignement soit vérifiable.

Mesuré en relisant les octets du PDF, chapiteau de 20 × 10 m en huit
stands sur A3 à 1:200 : à 0° les textes sortent à 0,0° sur la page, à 30°
ils sortent à −30,0°, à 90° à −90,0° — noms de stands, nom du chapiteau et
étiquettes multi-lignes comprises. Vérifié aussi dans le navigateur, où
l'étiquette d'un chapiteau tourné à 30° rend bien à 30° à l'écran : c'est
la moitié qui marchait déjà, et elle marche toujours.

## KL-043 — Le texte peut refuser de disparaître *(done)*

Remonté à l'usage : « sous Exporter, il faudrait une option pour modifier
automatiquement la taille du texte, pour qu'il soit visible à
l'impression pleine page ».

Le plancher de KL-041 est honnête et c'est une impasse. Un plan qui doit
tenir sur une feuille — c'est toute la raison d'être de « Remplir la
feuille » — est à l'échelle que le papier impose, et les seuls remèdes
que proposait le dialogue étaient une échelle plus grande ou une feuille
plus grande : deux refus de ce qui est demandé. La planche sortait sans
un seul nom de stand, avec un avertissement expliquant pourquoi — une
réponse juste à une question que personne n'a posée.

Le dialogue porte donc une case, **« Agrandir les textes trop petits
(1,8 mm minimum) »**, décochée par défaut.

- **C'est un secours, pas un second réglage de style.** Elle ne touche
  pas à ce qui passe déjà le plancher : une planche dont les étiquettes
  sont lisibles sort identique, cochée ou non. Ce qui ne le passe pas est
  remonté à 1,8 mm, où le texte déborde de ce qu'il nomme au lieu de
  disparaître — et le dialogue le dit dans la même phrase, parce qu'un
  plan dont les noms se chevauchent est *un autre* genre de faux qu'un
  plan sans noms, et que seul le lecteur peut dire lequel il préfère.
- **Un seul plancher, pour tous les textes.** Trois légendes peuvent
  passer dessous, pour trois raisons sans rapport : un nom de stand, dont
  la taille est décidée par sa case ; un objet `text`, mesuré en mètres
  de *terrain* et donc la seule légende qui rétrécit avec l'échelle ; et
  l'étiquette d'un objet dont la taille propre a été réglée bas. Elles
  partagent `MIN_READABLE_PT` — le plancher de KL-041 sous un nom qui ne
  dit pas « stand » —, sinon le millimétrage affiché ne serait vrai que
  d'une des trois.
- **Le calculateur se fait dire, il ne décide pas.** `fitLabelsToBox`
  reçoit `enlargeToMin` : c'est l'appelant qui sait si une boîte trop
  petite veut dire « ne rien dessiner » (l'écran dézoomé, où le lecteur
  peut toujours zoomer) ou « dessiner quand même » (le papier, qui n'a
  pas de zoom). Quand le plancher est forcé, aucune découpe n'y tient et
  celle retenue est la moins mauvaise — ce qui a obligé à borner
  `largestSizeFor` à zéro : classées par leur *négativité*, une boîte sans
  hauteur préfère deux lignes à une, sous prétexte qu'elles sont plus
  courtes. Exactement à l'envers.
- **Les deux moitiés restent d'accord.** La moitié raster reçoit
  `minTextPx` dans ses propres pixels, converti du même plancher par la
  résolution du raster (un point valant 1/72 de pouce), et une cible qui
  tient un plancher *remplace* le minimum de l'écran au lieu de s'y
  ajouter — sans quoi le PNG et le PDF d'une même planche sauveraient la
  même case à deux tailles différentes.
- **C'est un réglage d'impression, pas de document.** Il vit dans
  `useSheetExport` à côté de la grille imprimée et du PNG transparent, et
  n'est jamais écrit dans le projet : un fichier `.plan` est le compte
  rendu de ce qui a été dessiné, et une légende agrandie n'est pas ce qui
  a été dessiné.

699 tests, dont 20 nouveaux, validés par mutation : douze défauts
introduits, douze détectés. Un a survécu au premier essai — la borne à
zéro de `largestSizeFor`, indiscernable tant qu'on ne teste que des
boîtes trop étroites, où « moins de lignes » et « moins négatif » donnent
la même réponse. Il a fallu une boîte large et sans hauteur, celle d'un
chapiteau d'un stand de profondeur, pour que le classement soit
observable.

Mesuré en relisant les octets du PDF produit : chapiteau de 20 × 10 m en
vingt stands sur A3, tramé sur 6400 px. Sans la case, aucun nom n'est
écrit ; avec, ils sortent à 5,1 pt — 1,8 mm au point près. Un objet
`text` de 4 cm de terrain passe de 4,0 pt (le plancher d'impression) à
5,1 pt, une étiquette réglée à 6 px de 4,5 pt à 5,1 pt, et une étiquette
au défaut de 14 px reste à 10,5 pt, cochée ou non. Vérifié aussi dans le
navigateur, sur le projet de démonstration à 1:949 (« Remplir la
feuille ») : décochée, « À 1:949, les noms de stands sont trop petits
pour être imprimés et seront omis. Passer à 1:719 […] Ou les agrandir
quand même » ; cochée, la ligne devient « Noms de stands — 1,8 mm (5 pt)
— agrandis, ils débordent ».

La moitié raster (PNG) est câblée sur le même plancher et le même calcul,
mais n'est pas couverte par un test : le dépôt n'a pas de rendu DOM en
test, et aucun composant n'y est monté. Elle a été relue, pas mesurée.

## KL-044 — La flèche et le symbole *(done)*

Demandé à l'usage : « il faudrait ajouter dans les formes flèche et
symbole ». Deux ajouts qui se ressemblent dans la barre d'outils et ne se
ressemblent pas du tout dans le modèle.

- **La flèche n'est pas un type.** La pointe est un style de ligne depuis
  KL-002 (`arrowStart` / `arrowEnd`), Konva la dessine, le panneau de
  propriétés la coche. Ce qui manquait n'était pas l'objet, c'était le
  geste : on ne pouvait obtenir une flèche qu'en traçant une ligne puis
  en allant chercher la case. L'outil *Flèche* fait donc le geste de la
  ligne et pose une ligne, `arrowEnd` déjà mis. Un second type aurait
  fallu le tenir en phase dans le rendu, les trois exports et le lecteur
  de fichiers, pour rien. Seul le **nommage** distingue les deux
  (`ObjectNameKind`) : un plan de flèches ne doit pas s'appeler « Ligne 7 ».
- **Ce que la flèche a révélé.** Depuis KL-039 le PDF dessine les formes
  en vecteur et ne rastérise que les images — et la moitié vectorielle ne
  traçait *que la hampe*. Toute flèche exportée depuis a donc été
  imprimée en simple trait, la seule chose qui en faisait une flèche
  manquante. Elle sort désormais avec une pointe pleine (`arrowHead`).
- **Le symbole est un type.** `SymbolObject` porte un caractère et une
  hauteur en mètres de terrain. Son ancre est son **centre**, comme un
  cercle et contrairement à un texte : un symbole marque le point où on
  le pose, et doit tourner sur ce point au lieu de l'emporter.
- **La palette est fermée, et c'est le cœur de la mission.** L'écran
  dessine ce que la police du système contient, emoji compris ; le PDF
  écrit avec les 14 polices standard, qu'aucun lecteur n'a besoin de
  télécharger — et elles ne couvrent que le Latin-1 et un jeu de
  dingbats. Laisser saisir n'importe quel caractère, c'est accepter qu'un
  plan sur deux s'imprime avec un « ? » à la place du symbole : la seule
  issue qu'un plan ne peut pas se permettre. La palette est donc
  l'intersection des deux alphabets, choisie une fois — flèches, marques
  de sécurité, repères, et les numéros ① à ⑩, utiles pour numéroter des
  postes qu'une légende reprend ensuite.
- **ZapfDingbats est adressé à l'octet.** Le glyphe n'a aucun rapport
  avec le code Unicode du caractère : la table de `domain/symbols.ts` a
  été **relevée sur une planche de contrôle imprimée**, pas déduite. Le
  PDF déclare la police en `/F2`, sans `/Encoding` — lui imposer WinAnsi
  changerait le glyphe de chaque octet — et l'octet doit encore être
  échappé quand il tombe sur `(`, `)` ou `\` : l'avion est 0x28.
- **Le fichier refuse un caractère hors palette** plutôt que de
  l'accepter. Il se dessinerait à l'écran et laisserait un trou sur le
  papier ; un fichier qui se lit bien et s'imprime faux est pire qu'un
  fichier refusé. `SCHEMA_VERSION` ne bouge pas pour autant : un plan
  sans symbole reste lisible par une version antérieure, et la monter
  rendrait *tous* les plans illisibles pour elle afin d'améliorer le
  message d'erreur des quelques-uns qui en portent.

**Un défaut que seule une planche imprimée pouvait montrer**, comme en
KL-009 : l'étiquette du symbole sortait *en travers de son propre
glyphe*. Le calcul la centrait sur l'objet, ce qui est juste pour un
chapiteau et faux pour une marque ponctuelle — alors que l'écran, lui, la
posait dessous. Les deux moitiés se contredisaient ; elle passe dessous
des deux côtés, et un test l'épingle.

733 tests, dont 34 nouveaux, validés par mutation : treize défauts
introduits, douze détectés du premier coup. Le survivant mérite d'être
noté — on pouvait déplacer le pivot d'un symbole sans qu'aucun test ne
bronche, alors que « il tourne sur le point qu'il marque » est justement
ce que la documentation promet. Trois tests de rotation le couvrent
maintenant, et la mutation rejouée est détectée.

Méthode, à ne pas refaire : la première passe de mutation révoquait
chaque défaut par `git checkout --`, sur un arbre non commité — ce qui ne
défait pas la mutation mais efface le travail. Huit fichiers ont dû être
réécrits. Le script instantane désormais `src/` avant de toucher quoi que
ce soit et restaure depuis cette copie, en vérifiant à la fin que l'arbre
est redevenu identique.

Mesuré en relisant les octets du PDF et en regardant la planche produite,
A3 à 1:200 : les neuf symboles sortent en glyphes pleins (aucun « ? »),
l'étoile à l'octet 0x48, la flèche d'accès porte sa pointe, et le ➔
tourné à 45° pivote bien sur son point. Vérifié aussi dans le navigateur.

## KL-045 — Le schéma électrique d'implantation *(done)*

Demandé à l'usage : « modifier la partie électrique pour pouvoir faire des
schémas électriques d'implantation propres : coffret avec caractéristiques
(mono, tri, ampérage, section de câble…), câble (longueur, section),
multiprise, alimentation ». Jusqu'ici l'électricité se résumait à deux
entrées de bibliothèque sans aucune caractéristique.

- **Une propriété, pas un type.** Un coffret reste un rectangle, un câble
  une ligne : ils bougent, tournent, s'impriment et s'exportent comme
  tout le reste. Ce qu'ils gagnent, c'est un enregistrement `electrical`
  (`domain/electrical.ts`) : alimentation (réseau, groupe, calibre,
  phases), coffret (arrivée, calibre, différentiel, départs par groupes de
  prises), câble (phases, section, prise/protection, longueur saisie),
  multiprise (prises, calibre), récepteur (puissance, phases). Même choix
  que les stands en KL-038.
- **Les câbles tiennent leurs extrémités.** Un câble nomme l'équipement à
  chaque bout, et `reconcileCables` le maintient vrai après *chaque*
  modification — il est appelé dans `useProjectHistory`, la seule porte
  par laquelle passent toutes les éditions. Déplacer ou redimensionner un
  coffret emmène ses câbles ; tirer un bout sur un autre équipement le
  rebranche ; le lâcher dans le vide le débranche ; supprimer l'équipement
  le débranche. Les extrémités se posent sur le centre, et les câbles sont
  dessinés sous les équipements de leur calque pour ne pas les barrer.
- **Le réseau est lu, pas deviné.** `analyzeNetwork` part de chaque
  alimentation et construit l'arbre ; il cumule la puissance vers l'amont
  et la chute de tension vers l'aval, et signale : section trop faible
  pour la protection, triphasé alimenté en mono, multiprise sur un départ
  tri, surcharge d'un câble ou d'un équipement, départ plus gros que ce
  qui le protège, plus de câbles que de prises, absence de différentiel
  30 mA, chute de tension au-delà de 5 %, boucle, deux alimentations
  reliées, câble non raccordé, équipement non alimenté. Les contrôles sont
  une aide au pré-dimensionnement, conservatrice (1,5 mm² → 10 A,
  2,5 → 16/20 A, 6 → 32 A, 16 → 63 A, 35 → 125 A ; cos φ 0,9 ;
  ρ = 0,0225), pas une note de calcul NF C 15-100.
- **Outils dédiés.** Un groupe « Électricité » dans les outils :
  Alimentation, Coffret, Multiprise, Récepteur se posent d'un clic, à une
  emprise réelle ; le Câble se trace comme un tracé et se branche où ses
  bouts tombent. Un câble tracé est **dimensionné pour ce qu'il alimente**
  à sa création (5G16 63 A vers un coffret 63 A tri) — jamais après :
  réécrire le plan dans le dos de l'utilisateur serait pire qu'une alerte.
  Ils vont sur le calque « Électricité » s'il existe et n'est pas
  verrouillé.
- **Le panneau** a une section Électricité : rôle (n'importe quel
  rectangle, cercle ou ligne existant peut en prendre un — c'est ainsi
  que les anciens plans se mettent à niveau), caractéristiques, départ et
  arrivée d'un câble, puissance aval, courant, chute de tension, et les
  alertes qui le concernent.
- **Sur le plan**, une ligne d'étiquette « Électricité » (interrupteur
  global et par objet, comme les autres) : « 63 A tri · Diff. 30 mA »,
  « 5G6 · 32 A ». La légende d'un équipement **pend sous lui**, à l'écran
  comme dans le PDF : un coffret de 60 cm ne peut pas contenir son nom et
  son calibre, et on lisait « limen » pour « Alimentation ».
- **Bibliothèque** : groupe 60 kVA, branchement 63 A, coffrets 63 A tri /
  32 A tri / 16 A mono, multiprise, câbles 3G2.5 / 5G6 / 5G16, point
  lumineux, frigo, friteuse, sono, chambre froide.
- **Nomenclature** : un câble compte les mètres qu'il court, et les câbles
  sont regroupés par désignation (« Câble 5G6 — H07RN-F 5G6 ») : douze
  « Câble N » font une commande de deux lignes, pas de douze.
- **Fichier** : `electrical` est lu aussi strictement que la géométrie,
  et un rôle que la forme ne peut pas porter est refusé. Un câble qui
  nomme un équipement absent est accepté (un bout débranché est un état
  légitime). `SCHEMA_VERSION` ne bouge pas : champ optionnel.
- **Copier-coller** : un câble copié avec ses équipements se branche sur
  les copies ; copié seul, il est débranché plutôt que de repartir vers
  les originaux.

789 tests, dont 56 nouveaux, validés par mutation : vingt défauts
introduits, dix-neuf détectés du premier coup. Le survivant était le tri
des alertes par gravité : le test les produisait déjà dans l'ordre, si
bien que supprimer le tri ne changeait rien. Il produit maintenant un
avertissement avant l'erreur, et la mutation rejouée est détectée.

Vérifié dans le navigateur : pose des équipements, câble tracé
alimentation → coffret branché aux deux centres, câble coffret →
multiprise dimensionné en 3G2.5 16 A mono, boucle signalée sur un câble
en double, « Coffret 1 est triphasé mais alimenté en monophasé » sur le
câble créé avant le dimensionnement, câbles qui suivent le centre du
coffret quand on le redimensionne.

## KL-046 — Le synoptique unifilaire *(done)*

La seconde moitié de la demande de KL-045 : un schéma électrique qui se
lit sans le plan. **Projet › Schéma électrique…** ouvre le synoptique
unifilaire du réseau, le bilan par équipement, le récapitulatif des câbles
et toutes les alertes, et exporte le tout en PDF.

- **Une mise en page, deux dessins.** `printing/synopticLayout.ts` place
  les boîtes et les liaisons en millimètres, une fois ; le dialogue les
  dessine en SVG, le PDF en chemins vectoriels. Ce que l'on voit est ce
  qui s'imprime — la leçon de KL-042, appliquée d'emblée.
- **De gauche à droite, une colonne par niveau** : l'alimentation, puis ce
  qu'elle alimente, puis la suite. Une feuille par ligne, chaque parent
  centré sur ses enfants, liaisons orthogonales portant la désignation du
  câble, son calibre et sa longueur (« 5G16 · 63 A · 30 m »). Chaque boîte
  dit sa puissance aval, son courant et sa chute de tension cumulée, et
  prend la couleur de la pire alerte qui la concerne ou concerne son câble
  d'arrivée. Les équipements non alimentés sont regroupés à part.
- **Le PDF** : le synoptique en première page, sur A4 s'il y tient à au
  moins 80 %, sur A3 sinon — et jamais agrandi, un schéma de deux boîtes
  gonflé à la page se lit comme une affiche. Puis le bilan hiérarchique,
  les câbles à commander par désignation, et les alertes, paginés. Chaque
  page porte l'avertissement : aide au pré-dimensionnement, pas une note de
  calcul. Une alerte sur un câble le nomme par ce qu'il alimente
  (« Câble vers Friteuse ») : « Câble » tout court ne dit pas lequel.
- **Le dialogue** : un clic sur une boîte, une liaison ou une alerte
  sélectionne l'objet sur le plan et ferme le dialogue.

804 tests, dont 15 nouveaux, validés par mutation : onze défauts
introduits, neuf détectés du premier coup. Le premier survivant — un coude
qui ne descend pas — tenait à un test qui vérifiait l'abscisse du coude et
pas ses ordonnées. Le second était un **mutant équivalent** : les alertes
arrivant déjà triées par gravité, « la première trouvée » et « la pire »
sont la même chose ; le code a été simplifié pour le dire, et le test
ajouté en chemin (une boîte portant à la fois une erreur et un
avertissement sort en rouge) reste.

Mesuré sur un PDF réel (groupe 80 A, deux coffrets, multiprise, sept
récepteurs, un oublié), rendu en image : synoptique lisible sur A4 à
l'échelle 1, erreurs en rouge (friteuse 3,5 kW sur un départ 16 A,
2,5 mm² derrière 32 A), sono à 7,7 % de chute en orange, 194 m de 3G2.5 à
commander. Vérifié aussi dans le navigateur.

## KL-047 — L'électricité a son propre menu *(done)*

Retour d'usage sur KL-045 : « il faut que l'appareillage électrique soit
spécifique (pas de stand). Dans le menu de gauche, Électricité doit devenir
un onglet propre, pas imbriqué dans Outils. Le titre de l'onglet doit
toujours rester visible ; c'est ce qui est à l'intérieur qui doit défiler. »

- **Un menu Électricité**, le quatrième du rail gauche, qui s'ouvre seul
  comme les autres (ouvrir Électricité replie Outils). Il porte les cinq
  outils, l'interrupteur « Caractéristiques sur le plan », un résumé
  (puissance installée, erreurs, avertissements) et le bouton du schéma
  électrique. Outils ne garde que le dessin. Une préférence enregistrée
  avant ce menu ne le mentionne pas, ce qui le lirait comme ouvert à côté
  d'Outils : la règle « un seul ouvert » garde la palette, et un test le dit.
- **Les titres ne défilent plus.** Chaque panneau des rails (Fichier,
  Projet, Outils, Électricité, Propriétés) garde son titre collé en haut de
  sa propre zone de défilement ; seul le contenu passe dessous, sur une
  bande opaque qui couvre aussi la marge haute du panneau.
- **L'appareillage est un objet à part entière.** Un coffret s'affiche
  « Type : Coffret », pas « Rectangle », et la liste des éléments le montre
  avec l'icône de son outil. Il n'a ni bouton « Stands… », ni case
  « Stands » dans son étiquette ; à l'inverse, un objet ordinaire n'a plus
  de case « Électricité » qui ne pourrait rien y changer. Une grille de
  stands restée d'avant — un rectangle devenu coffret — est gardée dans le
  fichier mais jamais dessinée (`standGridToDraw`), et lui donner un rôle
  électrique depuis le panneau l'efface.
- Au passage : les boutons isolés du panneau (« Schéma électrique… »,
  « + Ajouter un départ ») prenaient 120 px de haut, hérités d'une règle
  faite pour une rangée de boutons ; la colonne calibre des départs était
  trop étroite pour « 32 A ».

807 tests, dont 3 nouveaux, validés par mutation : trois défauts, trois
détectés. Vérifié dans le navigateur à 1440 × 700 : titre d'Électricité et
de Propriétés en place après 70 et 500 px de défilement, panneau d'un
coffret sans stands.

## KL-048 — Des récepteurs raccordés sans les dessiner *(done)*

Demandé à l'usage : « pouvoir ajouter directement les récepteurs pour
éviter de devoir dessiner chaque consommateur. Il faut que cette dernière
reste possible, mais il faut pouvoir faire les deux. » Et, dans le coffret,
un bouton « Ajouter un départ » moins haut.

- **Une liste sur le coffret et sur la multiprise.** « Récepteurs
  raccordés » : un nom, une quantité, une puissance unitaire, mono ou tri.
  On ajoute d'un choix dans une liste, qui propose les récepteurs de la
  bibliothèque (frigo, friteuse, sono, éclairage, chambre froide si
  l'arrivée est tri) ou un récepteur libre. Trente projecteurs sont une
  ligne, pas trente cercles et trente câbles.
- **Les deux se mélangent.** Un récepteur dessiné et câblé reste le moyen
  de le placer *quelque part* ; les listés et les dessinés d'un même
  coffret comptent dans le même bilan, la même puissance installée, les
  mêmes prises.
- **Chaque unité prend une prise**, choisie parmi les calibres qui
  existent en prise (16, 32, 63, 125 A) d'après le courant de plaque
  P / U : une friteuse de 3,5 kW va sur une prise 16 A, qui accepte
  3 680 W. Le premier essai prenait la liste des calibres de disjoncteurs
  et le courant majoré du cos φ, et proposait une « prise 20 A » — qui
  n'existe pas. Un récepteur *dessiné* suit la même règle pour
  dimensionner son câble, si bien qu'une friteuse listée et une friteuse
  dessinée se branchent sur la même chose.
- **Contrôles** : les unités listées comptent dans les prises du coffret
  et de la multiprise, déclenchent l'exigence du différentiel 30 mA, et
  un récepteur tri est refusé sur une multiprise ou une arrivée mono.
- **Sur le plan**, l'étiquette du coffret dit « … · 11 récepteurs
  (5 kW) ». **Dans le synoptique**, chaque récepteur listé est une feuille
  du coffret, reliée en tirets et étiquetée par sa prise (« Prise 16 A
  mono ») ; un clic sélectionne le coffret. Le bilan (dialogue et PDF) les
  range sous leur coffret.
- **Fichier** : `loads` est facultatif sur un coffret et une multiprise,
  lu aussi strictement que le reste (une quantité de 0 est refusée).
- Les boutons « + Ajouter un départ » et « + Ajouter un récepteur… » sont
  compacts : 22 px au lieu de 33.

821 tests, dont 14 nouveaux, validés par mutation : douze défauts, douze
détectés. Vérifié dans le navigateur : ajout d'une friteuse et d'un point
lumineux sur un coffret depuis la liste, puis synoptique avec deux liaisons
en tirets et deux lignes de bilan sous le coffret.

## KL-049 — Des multiprises monophasées ou triphasées *(done)*

Demandé à l'usage : « il faut pouvoir choisir entre mono et triphasé pour
les multiprises (et calibre) ».

- **Une multiprise a des phases**, mono par défaut, et un calibre — qui
  existait déjà mais tombait sous le nombre de prises ; phases et calibre
  sont maintenant en tête, parce que c'est ce que la multiprise *est*.
- **Toutes ses prises sont de ses phases.** Une fiche monophasée n'entre
  pas dans une prise P17 tri, et un boîtier qui offre les deux est un
  coffret. D'où les contrôles : une multiprise tri alimentée en mono est
  signalée comme tout équipement tri ; un câble ou un récepteur listé
  d'autres phases que la multiprise est refusé, dans les deux sens ; la
  liste des récepteurs proposés ne montre que ceux qui s'y branchent.
- Un câble tracé vers une multiprise tri 32 A naît en 5G6 32 A.
- **Sur le plan** : « 6 prises 32 A tri » ; les multiprises mono disent
  désormais « mono » aussi, pour que les deux se lisent sans ambiguïté.
- **Bibliothèque** : multiprises tri 16 A et 32 A, trois prises.
- **Fichier** : une multiprise écrite avant cette mission n'a pas de
  `phases` et se lit monophasée — c'est ce qu'elle était. Une valeur
  présente est validée strictement.

828 tests, dont 7 nouveaux, validés par mutation : six défauts, six
détectés. Vérifié dans le navigateur : multiprise passée en tri 32 A, son
étiquette sur le plan, et la liste de récepteurs réduite à la chambre
froide.

## KL-050 — Des récepteurs triphasés dans la bibliothèque *(done)*

Demandé à l'usage : « ajoute d'autres récepteurs triphasés dans la
bibliothèque ». La chambre froide était la seule ; une multiprise ou un
coffret tri n'avait donc presque rien à proposer dans « + Ajouter un
récepteur… ».

Onze récepteurs tri courants en événementiel s'y ajoutent : friteuse pro
9 kW, plancha pro 7 kW, four professionnel 10 kW, lave-vaisselle pro 7 kW,
remorque frigorifique 5 kW, chauffage soufflant 9 kW, climatiseur mobile
7 kW, éclairage scène (gradateur) 12 kW, sonorisation grande scène 10 kW,
borne de recharge 11 kW, manège / attraction 15 kW. Les puissances sont
des ordres de grandeur à ajuster à la plaque de l'appareil ; chacun se
pose sur le plan ou s'ajoute à un coffret ou une multiprise tri, et tombe
sur une prise 16 ou 32 A tri.

830 tests, dont 2 nouveaux : identifiants uniques dans la bibliothèque,
et pour chaque récepteur tri une forme, une puissance, un nom imprimable
en PDF et une prise qui existe. Validés par mutation : trois défauts, deux
détectés du premier coup — passer deux récepteurs en mono tenait sous un
seuil trop lâche ; un nom qui dit « tri » doit maintenant être triphasé.
