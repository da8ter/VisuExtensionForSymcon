#!/bin/sh
# Packt libs/extension/ als ZIP für ein GitHub-Release nach dist/ (Version aus dem Manifest).
set -e
cd "$(dirname "$0")/.."
V="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' libs/extension/manifest.json)"
mkdir -p dist
rm -f "dist/VisuExtensionForSymcon-$V.zip"
(cd libs/extension && zip -qr "../../dist/VisuExtensionForSymcon-$V.zip" . -x '.DS_Store' -x '*/.DS_Store')
ls -l "dist/VisuExtensionForSymcon-$V.zip"
