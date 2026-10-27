#!/usr/bin/env bash
# Kreative Studio + Moss Film Looks - one-command installer for macOS and Linux
# NOT TESTED YET - please report problems as an Issue on GitHub.
#
# Use (Terminal, from your ComfyUI folder or anywhere):
#   curl -fsSL https://raw.githubusercontent.com/Lo-res/ComfyUI-Kreative-Studio/main/install.sh | bash
# or tell it where ComfyUI is:
#   curl -fsSL https://raw.githubusercontent.com/Lo-res/ComfyUI-Kreative-Studio/main/install.sh | KREATIVE_COMFYUI=/path/to/ComfyUI bash
#
# What it does:
#   1. finds your ComfyUI folder (or asks for it)
#   2. downloads Lo's 3 packs + the 7 other packs the workflow needs (skips any you already have)
#   3. installs their Python packages with ComfyUI's own Python
#   4. copies the Moss Film Looks v8 workflow into your workflows folder
# It does NOT download the models - see section 3 of the README for those.

set -u

PACKS=(
  "ComfyUI-Kreative-Studio|Lo-res/ComfyUI-Kreative-Studio"
  "ComfyUI-Kreative-Moss|Lo-res/ComfyUI-Kreative-Moss"
  "comfyui_aerochrome|Lo-res/comfyui_aerochrome"
  "rgthree-comfy|rgthree/rgthree-comfy"
  "ComfyUI-Impact-Pack|ltdrdata/ComfyUI-Impact-Pack"
  "ComfyUI-Impact-Subpack|ltdrdata/ComfyUI-Impact-Subpack"
  "ComfyUI-SeedVR2_VideoUpscaler|numz/ComfyUI-SeedVR2_VideoUpscaler"
  "comfyui-propost|digitaljohn/comfyui-propost"
  "ComfyUI_essentials|cubiq/ComfyUI_essentials"
)
WORKFLOW="moss-image-sft_v8.json"

c_cyan='\033[36m'; c_green='\033[32m'; c_yellow='\033[33m'; c_red='\033[31m'; c_grey='\033[90m'; c_off='\033[0m'
say() { printf "%b%s%b\n" "${2:-}" "$1" "$c_off"; }

say ""
say "=== Kreative Studio + Moss Film Looks installer (macOS / Linux) ===" "$c_cyan"
say "This installer is NEW and NOT TESTED YET. If anything goes wrong, follow the manual steps in the README." "$c_yellow"
say ""

# ---- 1. find ComfyUI --------------------------------------------------------
is_comfy() { [ -n "${1:-}" ] && [ -f "$1/main.py" ] && [ -d "$1/custom_nodes" ]; }

COMFY="${KREATIVE_COMFYUI:-}"
if ! is_comfy "$COMFY"; then
  for c in "$PWD" "$PWD/ComfyUI" "$(dirname "$PWD")" "$HOME/ComfyUI" "$HOME/Documents/ComfyUI"; do
    if is_comfy "$c"; then COMFY="$c"; break; fi
  done
fi
while ! is_comfy "$COMFY"; do
  # read from the terminal even when the script itself comes through a pipe
  printf "Full path to your ComfyUI folder (the one that contains main.py): "
  read -r COMFY < /dev/tty || { say "No ComfyUI folder given - stopping." "$c_red"; exit 1; }
  COMFY="${COMFY%/}"; COMFY="${COMFY/#\~/$HOME}"
  is_comfy "$COMFY" || say "  That folder has no main.py / custom_nodes. Try again." "$c_red"
done
COMFY="$(cd "$COMFY" && pwd)"
NODES="$COMFY/custom_nodes"
say "ComfyUI folder: $COMFY" "$c_green"

# ---- ComfyUI's own Python --------------------------------------------------
PY=""
for c in "$COMFY/venv/bin/python" "$COMFY/.venv/bin/python" "$(dirname "$COMFY")/venv/bin/python" "$(dirname "$COMFY")/.venv/bin/python"; do
  if [ -x "$c" ]; then PY="$c"; break; fi
done
if [ -z "$PY" ] && [ -n "${VIRTUAL_ENV:-}" ] && [ -x "$VIRTUAL_ENV/bin/python" ]; then PY="$VIRTUAL_ENV/bin/python"; fi
if [ -z "$PY" ] && [ -n "${CONDA_PREFIX:-}" ] && [ -x "$CONDA_PREFIX/bin/python" ]; then PY="$CONDA_PREFIX/bin/python"; fi
if [ -z "$PY" ]; then
  if command -v python3 >/dev/null 2>&1; then
    PY="$(command -v python3)"
    say "Could not find ComfyUI's own Python, so using: $PY" "$c_yellow"
    say "  If ComfyUI uses a different Python, activate it and run this again, or install the packages yourself (see README)." "$c_yellow"
  else
    say "No Python found. The packs will be downloaded, but their Python packages will NOT be installed." "$c_yellow"
  fi
else
  say "Python: $PY" "$c_green"
fi

if command -v git >/dev/null 2>&1; then HAS_GIT=1; say "Download method: git" "$c_green"
else HAS_GIT=0; say "Download method: ZIP (git not found)" "$c_green"; fi
say ""

# ---- 2. packs ---------------------------------------------------------------
TMP="$(mktemp -d 2>/dev/null || mktemp -d -t kreative)"
trap 'rm -rf "$TMP"' EXIT
FAILED=()

for entry in "${PACKS[@]}"; do
  name="${entry%%|*}"; repo="${entry#*|}"
  dest="$NODES/$name"
  if [ -e "$dest" ]; then say "[skip] $name is already installed" "$c_grey"; continue; fi
  say "[get ] $name"
  ok=1
  if [ "$HAS_GIT" = 1 ]; then
    git clone --depth 1 "https://github.com/$repo.git" "$dest" >/dev/null 2>&1 || ok=0
  else
    if curl -fsSL "https://github.com/$repo/archive/HEAD.zip" -o "$TMP/$name.zip" \
       && mkdir -p "$TMP/$name" && unzip -q "$TMP/$name.zip" -d "$TMP/$name"; then
      inner="$(find "$TMP/$name" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
      [ -n "$inner" ] && mv "$inner" "$dest" || ok=0
    else
      ok=0
    fi
  fi
  if [ "$ok" = 0 ] || [ ! -d "$dest" ]; then say "  FAILED: $name" "$c_red"; FAILED+=("$name"); continue; fi

  # ---- 3. Python packages ----
  if [ -n "$PY" ] && [ -f "$dest/requirements.txt" ]; then
    say "       installing Python packages for $name ..." "$c_grey"
    "$PY" -m pip install -r "$dest/requirements.txt" --disable-pip-version-check \
      || { say "  pip reported a problem for $name" "$c_yellow"; FAILED+=("$name (packages)"); }
  fi
done

# ---- 4. workflow ------------------------------------------------------------
WF_SRC="$NODES/ComfyUI-Kreative-Studio/workflows/$WORKFLOW"
WF_DIR="$COMFY/user/default/workflows"
if [ -f "$WF_SRC" ]; then
  mkdir -p "$WF_DIR"
  if [ -e "$WF_DIR/$WORKFLOW" ]; then
    say "[skip] the workflow is already in your workflows folder (left as it is)" "$c_grey"
  else
    cp "$WF_SRC" "$WF_DIR/$WORKFLOW" && say "[ ok ] workflow copied to $WF_DIR" "$c_green"
  fi
fi

say ""
if [ "${#FAILED[@]}" -gt 0 ]; then
  say "Finished with problems: ${FAILED[*]}" "$c_yellow"
  say "Install those by hand - see section 2 of the README." "$c_yellow"
else
  say "All done." "$c_green"
fi
say "Next:" "$c_cyan"
say "  1. Download the models - README section 3 (about 20 GB)."
say "  2. Restart ComfyUI and refresh your browser."
say "  3. Open 'moss-image-sft_v8' from the Workflows sidebar."
say ""
say "Note: the workflow is tuned for NVIDIA graphics cards. On a Mac it may run slowly or not at all." "$c_yellow"
say ""
