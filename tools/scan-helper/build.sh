#!/usr/bin/env bash
# Builds TrendLIX Scan Helper for HR's computers into dist/:
#   dist/TrendLIX-Scan-Helper-mac.zip      macOS universal binary (Apple silicon + Intel)
#   dist/TrendLIX-Scan-Helper-windows.zip  Windows x64 and ARM64 .exe
#
# Usage: ./build.sh            (version 1.0.0)
#        VERSION=1.0.1 ./build.sh
# Needs Go, and on macOS lipo (Xcode command line tools) for the universal binary.
set -euo pipefail

cd "$(dirname "$0")"
VERSION="${VERSION:-1.0.0}"
GO="${GO:-$(command -v go || echo /usr/local/go/bin/go)}"
LDFLAGS="-s -w -X main.version=${VERSION}"
FLAGS=(-trimpath -buildvcs=false -ldflags "$LDFLAGS")

rm -rf dist
mkdir -p dist/work/mac dist/work/windows

build() { # GOOS GOARCH output
  echo "building $1/$2"
  CGO_ENABLED=0 GOOS="$1" GOARCH="$2" "$GO" build "${FLAGS[@]}" -o "$3" .
}

# macOS: one universal binary.
build darwin arm64 dist/work/helper-darwin-arm64
build darwin amd64 dist/work/helper-darwin-amd64
if command -v lipo >/dev/null; then
  lipo -create -output dist/work/mac/TrendLIX-Scan-Helper dist/work/helper-darwin-arm64 dist/work/helper-darwin-amd64
else
  echo "lipo not found: the Mac zip will hold the Apple silicon build only" >&2
  cp dist/work/helper-darwin-arm64 dist/work/mac/TrendLIX-Scan-Helper
fi
chmod 755 dist/work/mac/TrendLIX-Scan-Helper
if command -v codesign >/dev/null; then
  # Ad hoc signature (Apple silicon refuses to run unsigned code). This is not
  # notarization: the first run still needs right-click > Open.
  codesign --force --sign - dist/work/mac/TrendLIX-Scan-Helper
fi
cp README.md dist/work/mac/

# Windows: x64 (also runs on ARM PCs) and native ARM64.
build windows amd64 dist/work/windows/TrendLIX-Scan-Helper.exe
build windows arm64 dist/work/windows/TrendLIX-Scan-Helper-ARM64.exe
cp README.md dist/work/windows/

(cd dist/work/mac && zip -X -q ../../TrendLIX-Scan-Helper-mac.zip TrendLIX-Scan-Helper README.md)
(cd dist/work/windows && zip -X -q ../../TrendLIX-Scan-Helper-windows.zip TrendLIX-Scan-Helper.exe TrendLIX-Scan-Helper-ARM64.exe README.md)

echo
echo "TrendLIX Scan Helper ${VERSION}:"
ls -l dist/*.zip dist/work/mac/TrendLIX-Scan-Helper dist/work/windows/*.exe | awk '{ printf "  %-45s %6.1f MB\n", $NF, $5/1048576 }'
