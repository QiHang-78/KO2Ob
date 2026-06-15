#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist/release"
OBSIDIAN_DIR="$ROOT_DIR/obsidian-plugin"
KOREADER_DIR="$ROOT_DIR/koreader-plugin/koreaderobsidiansync.koplugin"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd npm
require_cmd zip

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/obsidian-plugin" "$DIST_DIR/koreader-plugin"

echo "Building Obsidian plugin..."
(cd "$OBSIDIAN_DIR" && npm run build)

echo "Preparing Obsidian plugin release files..."
cp "$OBSIDIAN_DIR/main.js" "$DIST_DIR/obsidian-plugin/"
cp "$OBSIDIAN_DIR/manifest.json" "$DIST_DIR/obsidian-plugin/"
cp "$OBSIDIAN_DIR/styles.css" "$DIST_DIR/obsidian-plugin/"
cp "$OBSIDIAN_DIR/versions.json" "$DIST_DIR/obsidian-plugin/"

echo "Preparing KOReader plugin release files..."
cp "$KOREADER_DIR/_meta.lua" "$DIST_DIR/koreader-plugin/"
cp "$KOREADER_DIR/main.lua" "$DIST_DIR/koreader-plugin/"

echo "Creating release archives..."
(
  cd "$DIST_DIR/obsidian-plugin"
  zip -q -r ../koreader-obsidian-plugin-0.1.0.zip .
)
(
  cd "$ROOT_DIR/koreader-plugin"
  zip -q -r "$DIST_DIR/koreader-koplugin-0.1.0.zip" "koreaderobsidiansync.koplugin"
)

cat <<EOF

Release artifacts created in:
  $DIST_DIR

Artifacts:
  $DIST_DIR/koreader-obsidian-plugin-0.1.0.zip
  $DIST_DIR/koreader-koplugin-0.1.0.zip

Manual Obsidian install files:
  $DIST_DIR/obsidian-plugin/main.js
  $DIST_DIR/obsidian-plugin/manifest.json
  $DIST_DIR/obsidian-plugin/styles.css
  $DIST_DIR/obsidian-plugin/versions.json
EOF
