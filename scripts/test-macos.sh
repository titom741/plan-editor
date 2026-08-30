#!/usr/bin/env bash
# Runs the Swift test suite for the macOS shell.
set -euo pipefail
cd "$(dirname "$0")/../macos/PlanEditorMac"
exec swift test "$@"
