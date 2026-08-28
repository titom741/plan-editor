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

## Limites actuelles

`WKWebView` n'expose pas File System Access : « Enregistrer sous »
retombe donc sur le téléchargement, sans dialogue natif de choix de
dossier. L'étape suivante est un pont Swift (`NSOpenPanel` /
`NSSavePanel`) pour les ouvertures et enregistrements natifs, puis la
signature et la notarisation pour distribuer un `.app`.
