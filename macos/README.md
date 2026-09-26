# Plan Editor pour macOS

Cette cible SwiftPM embarque l'application web existante dans une fenêtre
macOS via `WKWebView`. L'application web reste la source fonctionnelle
unique : rien n'est réécrit en SwiftUI, et une correction faite dans
`src/` arrive dans l'app macOS au prochain build.

## Construire

Depuis la racine du dépôt :

```bash
scripts/build-macos.sh
```

Le script construit le bundle web, le copie dans les ressources de la
cible Swift, puis lance `swift build -c release`.

`Sources/PlanEditorMac/WebApp/` est cette copie : elle est générée, donc
ignorée par git. Un dépôt fraîchement cloné n'a pas de bundle web tant
que le script n'a pas tourné, et `swift build` échouera avant.

## Ouvrir dans Xcode

Lancer d'abord `scripts/build-macos.sh` (pour les ressources web), puis
ouvrir `macos/PlanEditorMac/Package.swift` dans Xcode, sélectionner le
schéma **PlanEditorMac** et lancer avec ⌘R.

## Fichiers

Un pont Swift (`FileBridge.swift`) expose `NSSavePanel` et `NSOpenPanel` à
l'application web : « Enregistrer sous » et « Ouvrir » passent par les
fenêtres natives et affichent le chemin complet. Le réglage **Dossier
d'enregistrement** (menu Fichier) choisit, via un `NSOpenPanel` de
dossier, le dossier où ces fenêtres s'ouvrent ; il est conservé avec les
préférences de l'application web et renvoyé au pont à chaque ouverture.

## Limites actuelles

La signature Developer ID et la notarisation restent à faire pour
distribuer le `.app` : le script signe en ad hoc par défaut.
