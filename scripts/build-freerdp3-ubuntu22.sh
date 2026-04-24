#!/usr/bin/env bash
#
# build-freerdp3-ubuntu22.sh
# 
# Compiles and installs FreeRDP v3 from source on Ubuntu 22.04 (Jammy)
# and older systems that don't have freerdp3 in their apt repositories.
#

set -euo pipefail

FREERDP_VERSION="3.5.1" # Latest stable v3 at the time of writing

echo "==> Updating apt and installing build dependencies..."
sudo apt-get update
sudo apt-get install -y \
    build-essential \
    cmake \
    git \
    pkg-config \
    libssl-dev \
    libx11-dev \
    libxext-dev \
    libxcursor-dev \
    libxinerama-dev \
    libxi-dev \
    libxdamage-dev \
    libxrandr-dev \
    libxv-dev \
    libxkbfile-dev \
    libjpeg-dev \
    libpng-dev \
    libavutil-dev \
    libavcodec-dev \
    libswscale-dev \
    libcairo2-dev \
    libcups2-dev \
    libpulse-dev \
    libasound2-dev \
    libusb-1.0-0-dev \
    libpcsclite-dev \
    libsystemd-dev \
    libcjson-dev \
    libfuse3-dev

echo "==> Downloading FreeRDP v${FREERDP_VERSION}..."
WORKDIR=$(mktemp -d)
cd "$WORKDIR"

wget "https://github.com/FreeRDP/FreeRDP/releases/download/${FREERDP_VERSION}/freerdp-${FREERDP_VERSION}.tar.gz"
tar -xf "freerdp-${FREERDP_VERSION}.tar.gz"
cd "freerdp-${FREERDP_VERSION}"

echo "==> Configuring FreeRDP build..."
# We disable Wayland and the server component to speed up the build 
# and reduce dependencies, since we only need the client libraries.
cmake -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=/usr/local \
    -DWITH_WAYLAND=OFF \
    -DWITH_SERVER=OFF \
    -DWITH_PROXY=OFF \
    -DWITH_SHADOW=OFF \
    -DWITH_PCSC=OFF \
    -DWITH_PKCS11=OFF \
    -DWITH_MANPAGES=OFF

echo "==> Compiling FreeRDP (this may take a few minutes)..."
cmake --build build -j"$(nproc)"

echo "==> Installing FreeRDP to /usr/local..."
sudo cmake --install build

echo "==> Updating shared library cache..."
sudo ldconfig

echo "==> Cleaning up..."
cd /
rm -rf "$WORKDIR"

echo "==> Done! FreeRDP v3 is installed."
echo "You can now run: ./scripts/build-linux.sh"
