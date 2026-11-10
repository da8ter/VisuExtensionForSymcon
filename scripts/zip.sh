#!/bin/sh
# Packt src/ als ZIP für ein GitHub-Release nach dist/ (Version aus dem Manifest).
set -e
cd "$(dirname "$0")/.."
V="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' src/manifest.json)"
mkdir -p dist
rm -f "dist/VisuExtensionForSymcon-$V.zip"
(cd src && zip -qr "../dist/VisuExtensionForSymcon-$V.zip" . -x '.DS_Store' -x '*/.DS_Store')
ls -l "dist/VisuExtensionForSymcon-$V.zip"
