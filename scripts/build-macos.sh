#!/usr/bin/env bash
#
# Builds the macOS app: the web bundle, the Swift shell around it, and a
# real .app so the document type declaration in Info.plist takes effect.
#
# A bare SwiftPM executable has no Info.plist, so it gets no icon, no
# document association and cannot be signed for distribution. Assembling
# the bundle by hand is a dozen lines and avoids carrying an Xcode project
# alongside the package.
#
# Usage:
#   scripts/build-macos.sh                 # build, ad-hoc signature
#   SIGN_IDENTITY="Developer ID Application: …" scripts/build-macos.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PACKAGE="macos/PlanEditorMac"
APP_NAME="Plan Editor"
BUNDLE_ID="com.planeditor.app"
CONFIGURATION="release"
BUILD_DIR="$PACKAGE/.build/$CONFIGURATION"
APP="$PACKAGE/.build/$APP_NAME.app"

echo "==> Bundle web"
npm run build

echo "==> Ressources de la cible Swift"
rm -rf "$PACKAGE/Sources/PlanEditorMac/WebApp"
cp -R dist "$PACKAGE/Sources/PlanEditorMac/WebApp"

echo "==> Compilation Swift"
swift build --package-path "$PACKAGE" -c "$CONFIGURATION"

echo "==> Assemblage de $APP_NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BUILD_DIR/PlanEditorMac" "$APP/Contents/MacOS/PlanEditorMac"
# The resource bundle SwiftPM produces carries the web app; Bundle.module
# looks for it next to the executable.
cp -R "$BUILD_DIR/PlanEditorMac_PlanEditorMac.bundle" "$APP/Contents/Resources/"

VERSION="$(node -p "require('./package.json').version")"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleExecutable</key><string>PlanEditorMac</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Plan Editor</string>

  <!-- Owning the type is what gives a .kli file its icon and makes a
       double-click open this app. It is declared as conforming to JSON,
       because that is exactly what the file is. -->
  <key>UTExportedTypeDeclarations</key>
  <array>
    <dict>
      <key>UTTypeIdentifier</key><string>com.planeditor.project</string>
      <key>UTTypeDescription</key><string>Projet d'implantation</string>
      <key>UTTypeConformsTo</key>
      <array><string>public.json</string></array>
      <key>UTTypeTagSpecification</key>
      <dict>
        <key>public.filename-extension</key>
        <array><string>kli</string></array>
      </dict>
    </dict>
  </array>

  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>Projet d'implantation</string>
      <key>CFBundleTypeRole</key><string>Editor</string>
      <key>LSHandlerRank</key><string>Owner</string>
      <key>LSItemContentTypes</key>
      <array><string>com.planeditor.project</string></array>
    </dict>
    <!-- Plain JSON is opened, never owned: claiming it would make this app
         the handler for every JSON file on the machine, which is also why
         the pre-rename .kl.json files cannot have their own declaration. -->
    <dict>
      <key>CFBundleTypeName</key><string>Projet d'implantation (ancien format)</string>
      <key>CFBundleTypeRole</key><string>Viewer</string>
      <key>LSHandlerRank</key><string>None</string>
      <key>LSItemContentTypes</key>
      <array><string>public.json</string></array>
    </dict>
  </array>
</dict>
</plist>
PLIST

echo "==> Signature"
if [ -n "${SIGN_IDENTITY:-}" ]; then
  # The hardened runtime is required for notarisation. JIT is what
  # JavaScriptCore needs to run the app at a usable speed.
  cat > "$PACKAGE/.build/entitlements.plist" <<'ENTITLEMENTS'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
</dict>
</plist>
ENTITLEMENTS
  codesign --force --deep --options runtime \
    --entitlements "$PACKAGE/.build/entitlements.plist" \
    --sign "$SIGN_IDENTITY" "$APP"
  codesign --verify --strict --verbose=2 "$APP"
else
  # Ad-hoc: enough to run locally, not enough to hand to anyone else.
  codesign --force --deep --sign - "$APP"
  echo "    signature ad-hoc — définissez SIGN_IDENTITY pour distribuer"
fi

echo
echo "Terminé : $APP"
echo "Ouvrir : open \"$APP\""
