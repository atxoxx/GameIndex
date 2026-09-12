#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
appimage_dir="$repo_root/src-tauri/target/release/bundle/appimage"
appdir="$(find "$appimage_dir" -maxdepth 1 -type d -name '*.AppDir' -print -quit)"
appimage="$(find "$appimage_dir" -maxdepth 1 -type f -name '*.AppImage' -print -quit)"
if [[ -z "$appimage" ]]; then
  appimage="$appimage_dir/GameIndex_1.2.1_amd64.AppImage"
fi
linuxdeploy="${TAURI_LINUXDEPLOY:-${XDG_CACHE_HOME:-$HOME/.cache}/tauri/linuxdeploy-x86_64.AppImage}"

if [[ -z "$appdir" ]]; then
  echo "[ERROR] AppDir not found in $appimage_dir" >&2
  exit 1
fi
if [[ -z "$appimage" ]]; then
  echo "[ERROR] AppImage not found in $appimage_dir" >&2
  exit 1
fi
if [[ ! -x "$linuxdeploy" ]]; then
  echo "[ERROR] linuxdeploy not found: $linuxdeploy" >&2
  exit 1
fi

# These libraries belong to the host display stack. Bundling build-machine
# versions makes the host Mesa/NVIDIA EGL implementation negotiate against an
# incompatible Wayland/X11 ABI on newer distributions.
for lib_dir in "$appdir/usr/lib" "$appdir/usr/lib64"; do
  [[ -d "$lib_dir" ]] || continue
  find "$lib_dir" -maxdepth 1 \( -type f -o -type l \) -print0 | while IFS= read -r -d '' library; do
    case "$(basename -- "$library")" in
      libwayland-*.so*|libxkbcommon.so*|libxcb-randr.so*|libxcb-render.so*|libxcb-shm.so*|libXau.so*|libXdmcp.so*)
        rm -f -- "$library"
        ;;
    esac
  done
done

# The stock hook forces X11 even in a native Wayland session. Preserve an
# explicit user choice; otherwise use Wayland with X11 fallback when available.
while IFS= read -r hook; do
  python3 - "$hook" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
old = "export GDK_BACKEND=x11 # Crash with Wayland backend on Wayland - We tested it without it and ended up with this: https://github.com/tauri-apps/tauri/issues/8541"
new = "if [[ -z \"${GDK_BACKEND:-}\" && -n \"${WAYLAND_DISPLAY:-}\" ]]; then\n  export GDK_BACKEND=wayland,x11\nelif [[ -z \"${GDK_BACKEND:-}\" ]]; then\n  export GDK_BACKEND=x11\nfi"
if old in text:
    path.write_text(text.replace(old, new, 1))
PY
done < <(find "$appdir/apprun-hooks" -type f -name 'linuxdeploy-plugin-gtk.sh' -print)

rm -f -- "$appimage"
OUTPUT="$appimage" "$linuxdeploy" \
  --appimage-extract-and-run \
  --appdir "$appdir" \
  --exclude-library 'libwayland-*.so*' \
  --exclude-library 'libxkbcommon.so*' \
  --exclude-library 'libxcb-randr.so*' \
  --exclude-library 'libxcb-render.so*' \
  --exclude-library 'libxcb-shm.so*' \
  --exclude-library 'libXau.so*' \
  --exclude-library 'libXdmcp.so*' \
  --output appimage

echo "[DONE] $appimage"
