#!/bin/sh
# Erzeugt src/icons/icon-<Größe>.png aus scripts/icon.svg mit Headless-Chrome (eigenes, temporäres Profil).
set -e
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PROFIL="$(mktemp -d)"
SEITE="$PROFIL/icon.html"
trap 'rm -rf "$PROFIL"' EXIT
for G in 16 48 128; do
  printf '<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:%spx;height:%spx}</style><img src="file://%s/scripts/icon.svg">' "$G" "$G" "$PWD" > "$SEITE"
  "$CHROME" --headless=new --no-first-run --no-default-browser-check --user-data-dir="$PROFIL/p" --hide-scrollbars \
    --default-background-color=00000000 --window-size="$G,$G" --screenshot="$PWD/src/icons/icon-$G.png" "file://$SEITE" >/dev/null 2>&1
done
ls -l src/icons
