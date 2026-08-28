#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm run build
rm -rf macos/PlanEditorMac/Sources/PlanEditorMac/WebApp
cp -R dist macos/PlanEditorMac/Sources/PlanEditorMac/WebApp
swift build --package-path macos/PlanEditorMac -c release
echo "Build macOS terminé : macos/PlanEditorMac/.build/arm64-apple-macosx/release/PlanEditorMac"
