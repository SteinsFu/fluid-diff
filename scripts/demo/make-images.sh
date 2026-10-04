#!/usr/bin/env bash
# Regenerates the README demo assets from a real VS Code window:
#   images/theme-{dark,light,dracula}.png   Fluid Diff in each theme (dark is the README hero)
#   images/command.png                      Command Palette filtered to "Fluid Diff: Git"
#   images/demo-{preview,ruler}.gif         scrolling the diff; hovering and clicking ruler marks
#   images/demo-{git,compare,timeline}.gif  one GIF per way of opening Fluid Diff
# The narrated videos are make-videos.sh.
#
# Usage: scripts/demo/make-images.sh [stills] [preview] [ruler] [git] [compare] [timeline]   (default: all)
#
# macOS only. Needs: VS Code with the `code` CLI, Xcode command line tools (swift),
# gifski (`brew install gifski`), python3 with Pillow (`pip install pillow`).
# The terminal app needs Screen Recording and Accessibility permission: the GIFs are
# recorded with real clicks and key presses (scenes in scripts/demo/scenes/*.json).
# Hands off the mouse and keyboard while it runs (a few minutes).
#
# Env overrides: see common.sh.
set -euo pipefail
source "$(dirname "$0")/common.sh"
TARGETS=${*:-stills preview ruler git compare timeline}

shoot() { # <mode> <out.png>
    launch "$1"
    screencapture -x -l"$WID" "$DEMO/raw.png"
    "$PY" "$HERE/compose.py" still "$DEMO/raw.png" "$2"
}

record() { # <scene>
    local raw="$DEMO/raw/$1"
    rm -rf "$raw" "$DEMO/stop"
    mkdir -p "$raw/frames"
    launch "gif-$1"
    (
        i=0
        while [ ! -f "$DEMO/stop" ]; do
            screencapture -x -l"$WID" "$raw/frames/$(printf %05d $i).png"
            i=$((i + 1))
        done
    ) &
    local capture=$!
    sleep 0.5
    swift "$HERE/input.swift" play "$HERE/scenes/$1.json" "$PID" "$WX" "$WY" "$raw/events.jsonl"
    sleep 1.2
    touch "$DEMO/stop"
    wait $capture
    swift "$HERE/window.swift" "$PID" > /dev/null # park the cursor again
    rm -rf "$raw/out"
    "$PY" "$HERE/compose.py" gif "$raw/frames" "$raw/events.jsonl" "$DEMO/cursor.png" $CURSOR "$raw/out"
    gifski --quiet --fps 15 --quality 85 -o "$REPO/images/demo-$1.gif" "$raw"/out/*.png
}

setup
CURSOR=$(swift "$HERE/input.swift" cursor "$DEMO/cursor.png")

for target in $TARGETS; do
    echo "$target"
    case $target in
        stills)
            shoot palette "$REPO/images/command.png"
            shoot diff "$REPO/images/theme-dark.png"
            settings "Default Dark Modern" Dracula
            shoot diff "$REPO/images/theme-dracula.png"
            settings "Default Light Modern" Light
            shoot diff "$REPO/images/theme-light.png"
            settings "Default Dark Modern" Dark
            ;;
        preview | ruler | git | compare | timeline) record "$target" ;;
        *) echo "unknown target: $target" >&2; exit 1 ;;
    esac
done
quit_demo
ls -lh "$REPO"/images/*.png "$REPO"/images/*.gif
