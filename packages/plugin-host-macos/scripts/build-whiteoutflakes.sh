#!/usr/bin/env bash
# Build the WhiteoutFlakes model viewer (github.com/FernandoS27/WhiteoutFlakes), which the macOS
# Host Adapter renders Asset Catalog thumbnails and exports models with (model.render,
# model.export). Vulkan via MoltenVK only: its Metal backend renders black on macOS 27 (see
# docs/reference/related-repos.md).
#
#   packages/plugin-host-macos/scripts/build-whiteoutflakes.sh [dir]     # default ~/.cache/sc2-adjutant/whiteoutflakes
#
# Needs Xcode (with `xcodebuild -downloadComponent MetalToolchain`), Homebrew, git and the GitHub CLI
# (`gh`, signed in; it downloads Slang). Re-running
# skips the steps that are already done. The app lands at <dir>/stage/WhiteoutFlakes.app; point the
# machine config's `modelViewerPath` at <dir>/stage/WhiteoutFlakes.app/Contents/MacOS/WhiteoutFlakes.
set -euo pipefail

DIR="${1:-$HOME/.cache/sc2-adjutant/whiteoutflakes}"
# Pins proven together on macOS 27.2 / Xcode 27.1 (2026-10-27). Newer Slang rejects the bundled
# WC3 shaders; the headers match the LunarG SDK upstream CI uses.
WF_COMMIT=d2756ce
SLANG_VERSION=2026.1.2
VULKAN_HEADERS_TAG=v1.4.341
VMA_TAG=v3.3.0

export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
if ! xcrun --sdk macosx metal -v >/dev/null 2>&1; then
  echo "Xcode's Metal toolchain is missing; run: xcodebuild -downloadComponent MetalToolchain" >&2
  exit 1
fi
brew list cmake ninja vulkan-loader molten-vk >/dev/null 2>&1 || brew install cmake ninja vulkan-loader molten-vk

mkdir -p "$DIR"
cd "$DIR"

if [[ ! -d src ]]; then
  git clone --filter=blob:none https://github.com/FernandoS27/WhiteoutFlakes src
  git -C src checkout -q "$WF_COMMIT"
  git -C src submodule update --init --recursive --depth 1
fi

if [[ ! -x slang/bin/slangc ]]; then
  mkdir -p slang
  gh release download "v$SLANG_VERSION" -R shader-slang/slang -p "slang-$SLANG_VERSION-macos-aarch64.tar.gz" -O - | tar -xz -C slang
fi

# A minimal stand-in for the LunarG SDK: pinned headers + VMA; loader and MoltenVK from Homebrew.
if [[ ! -f vksdk/include/vma/vk_mem_alloc.h ]]; then
  rm -rf vksdk vk-dl
  git clone -q --depth 1 --branch "$VULKAN_HEADERS_TAG" https://github.com/KhronosGroup/Vulkan-Headers.git vk-dl/headers
  git clone -q --depth 1 --branch "$VMA_TAG" https://github.com/GPUOpen-LibrariesAndSDKs/VulkanMemoryAllocator.git vk-dl/vma
  mkdir -p vksdk/include/vma
  cp -R vk-dl/headers/include/. vksdk/include/
  cp vk-dl/vma/include/vk_mem_alloc.h vksdk/include/vma/
  rm -rf vk-dl
fi

# Flags follow upstream's .github/workflows/macos-dmg.yml, except: Metal and WebGPU off; the GLFW
# include path (upstream only adds it through the WebGPU target); deployment target 26.0 (Xcode
# 27's libc++ marks floating-point std::from_chars as macOS 26+).
if [[ ! -f build/build.ninja ]]; then
  cmake -S src -B build -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=26.0 \
    -DCMAKE_OSX_ARCHITECTURES=arm64 \
    -DSLANG_DIR="$DIR/slang" \
    -DWDX_BUILD_WC3_SHADERS=OFF \
    -DWDX_USE_PREBUILT_SHADERS=ON \
    -DWDX_BUILD_WC3_DEBUG_SHADERS=OFF \
    -DWDX_ENABLE_TRACY=OFF \
    -DWDX_BUILD_MAX_PLUGIN=OFF \
    -DWDX_ENABLE_METAL=OFF \
    -DWDX_ENABLE_WEBGPU=OFF \
    -DVulkan_INCLUDE_DIR="$DIR/vksdk/include" \
    -DVulkan_LIBRARY="$(brew --prefix vulkan-loader)/lib/libvulkan.dylib" \
    -DCMAKE_CXX_FLAGS="-I$DIR/src/externals/glfw/include"
fi

cmake --build build --target WhiteoutFlakesStandalone --parallel
# On macOS the shaders, fonts and translations are staged beside the .app; install puts them in it.
cmake --install build --prefix stage >/dev/null

APP="$DIR/stage/WhiteoutFlakes.app"
"$APP/Contents/MacOS/WhiteoutFlakes" --backend vulkan --headless-test 2>&1 | grep -E '^\[headless\] (PASS|FAIL)'
echo "Built $APP"
