#!/usr/bin/env bash
#
# Rasterises the PWA icons from their SVG sources.
#
# The PNGs are committed rather than generated at build time: an installed
# web app needs PNG icons (a browser will not rasterise an SVG for the
# system's app list), and `sips` — the only rasteriser guaranteed present
# on a Mac — would make the web build depend on macOS. Run this by hand
# when an SVG changes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/public"

render() {
  local source="$1" size="$2" out="$3"
  sips -s format png -Z "$size" "$source" --out "$out" >/dev/null
  echo "    $out (${size}×${size})"
}

echo "==> Icônes PWA"
render app-icon.svg 192 icon-192.png
render app-icon.svg 512 icon-512.png
render app-icon-maskable.svg 512 icon-maskable-512.png
