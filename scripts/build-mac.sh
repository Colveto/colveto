#!/usr/bin/env bash
# Fabrique les installateurs Mac (Apple Silicon et Intel) dans ../colveto-release.
# Ne lancez pas ce script depuis un dossier synchronisé par iCloud (Bureau,
# Documents) : iCloud ajoute des attributs aux fichiers et casse la signature.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$(cd .. && pwd)/colveto-release"
npm ci
npm run build
for arch in arm64 x64; do
  npx @electron/rebuild -f -w better-sqlite3 --arch "$arch"
  npx electron-builder --mac dmg "--$arch" --config.directories.output="$OUT"
done
npx @electron/rebuild -f -w better-sqlite3   # remet le module natif de cette machine
echo "Installateurs : $OUT"
