#!/usr/bin/env bash
# 构建 APK：web 产物同步进 android 的 assets，再交给 Gradle。
# 用法：scripts/build-apk.sh [debug|release]（默认 debug）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VARIANT="${1:-debug}"
ASSETS="$ROOT/android/app/src/main/assets/www"

echo "==> 构建 Web 产物"
cd "$ROOT/web"
[ -d node_modules ] || pnpm install
pnpm build

echo "==> 同步到 android/app/src/main/assets/www"
rm -rf "$ASSETS"
mkdir -p "$ASSETS"
cp -r "$ROOT/web/dist/." "$ASSETS/"

echo "==> 构建 APK ($VARIANT)"
cd "$ROOT/android"
if [ "$VARIANT" = "release" ]; then
  ./gradlew assembleRelease
else
  ./gradlew assembleDebug
fi

find "$ROOT/android/app/build/outputs/apk" -name "*.apk" -newermt '-10 minutes' -print
