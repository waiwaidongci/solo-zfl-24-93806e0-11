#!/bin/bash
# 无 root 环境下为 chromium-headless-shell 准备系统库：
# 解析 Debian bookworm arm64 包索引 -> 下载 deb -> 解压到 /workspace/.syslibs
set -e
LIBS_DIR=/workspace/.syslibs
mkdir -p "$LIBS_DIR/debs"
cd "$LIBS_DIR"

if [ ! -f Packages ]; then
  echo ">> 下载包索引..."
  curl -sfL https://deb.debian.org/debian/dists/bookworm/main/binary-arm64/Packages.xz -o Packages.xz
  xz -dk Packages.xz || unxz -k Packages.xz
fi

PKGS="libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libasound2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxi6 libxtst6 libx11-xcb1 libxcb-dri3-0 libwayland-server0 libxshmfence1 libglu1-mesa libopengl0"

for pkg in $PKGS; do
  file=$(awk -v pkg="$pkg" '
    /^Package: / { p=$2 }
    /^Filename: / { if (p==pkg) { print $2; exit } }
  ' Packages)
  if [ -z "$file" ]; then echo "!! 未找到包 $pkg"; continue; fi
  deb="debs/$(basename "$file")"
  if [ ! -f "$deb" ]; then
    echo ">> 下载 $pkg"
    curl -sfL "https://deb.debian.org/debian/$file" -o "$deb"
  fi
  dpkg-deb -x "$deb" "$LIBS_DIR"
done
echo ">> 完成，库文件："
ls "$LIBS_DIR/usr/lib/aarch64-linux-gnu/" | grep -E "\.so" | head -40
