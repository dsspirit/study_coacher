#!/usr/bin/env bash
# 下载 Fusion Pixel 像素字体（OFL 协议）供工作台使用。
# 产物：app/static/fonts/fusion-pixel-12px-proportional-zh_hans.woff2
# 失败不影响功能：工作台自动降级系统等宽字体（visual-spec 降级链）。
# 可重复跑；已有文件时除非 --force 否则跳过。
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FONT_DIR="$SKILL_DIR/app/static/fonts"
FONT_FILE="$FONT_DIR/fusion-pixel-12px-proportional-zh_hans.woff2"

if [[ -f "$FONT_FILE" && "${1:-}" != "--force" ]]; then
  echo "字体已存在：$FONT_FILE（$(du -h "$FONT_FILE" | cut -f1)），跳过。要重下加 --force"
  exit 0
fi

mkdir -p "$FONT_DIR" "$(mktemp -d)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 解析最新 release 里的 12px proportional woff2 包（实测命名：fusion-pixel-font-12px-proportional-otf.woff2-v<版本>.zip，内含分语言文件）
URL=$(curl -fsSL "https://api.github.com/repos/TakWolf/fusion-pixel-font/releases/latest" \
  | grep -o 'https://[^"]*fusion-pixel-font-12px-proportional-otf\.woff2-v[^"]*\.zip' | head -1)
if [[ -z "$URL" ]]; then
  echo "未在最新 release 找到 12px proportional woff2 包（页面结构可能变了），手动下载后放到："
  echo "$FONT_FILE"
  exit 1
fi

echo "下载：$URL"
curl -fsSL --retry 3 -o "$TMP/font.zip" "$URL"
unzip -o -j "$TMP/font.zip" '*fusion-pixel-12px-proportional-zh_hans*' -d "$TMP" >/dev/null
SRC=$(ls "$TMP"/fusion-pixel-12px-proportional-zh_hans* 2>/dev/null | head -1)
if [[ -z "$SRC" ]]; then
  echo "zip 里没有 zh_hans 文件，内容如下："
  unzip -l "$TMP/font.zip" | head -20
  exit 1
fi
cp "$SRC" "$FONT_FILE"
unzip -o -j "$TMP/font.zip" 'OFL.txt' -d "$FONT_DIR" >/dev/null 2>&1 || true

if [[ -f "$FONT_FILE" ]]; then
  echo "完成：$FONT_FILE（$(du -h "$FONT_FILE" | cut -f1)）"
else
  echo "复制失败"
  exit 1
fi
