#!/usr/bin/env bash
# Records the demo clips from a real VS Code window, then cuts the narrated videos:
#   videos/clips/<clip>.mp4              60 fps recording of scripts/demo/scenes/<scene>.json
#   videos/fluid-diff-{short,long}.mp4   videos cut from the clips by video.py (storyboards in videos/*.json)
# Never touches images/: the README images are make-images.sh.
#
# Usage: scripts/demo/make-videos.sh [<clip>...] [render]   (default: every clip, then render)
#   clips: preview ruler git compare timeline words theme preview-light preview-dracula
#          (the scene is the part before any "-"; -light / -dracula pick the theme)
#   render alone skips VS Code and re-cuts both videos from the existing clips.
#
# macOS only. Needs: VS Code with the `code` CLI, Xcode command line tools (swift),
# ffmpeg (`brew install ffmpeg`), python3 with Pillow, numpy, scipy and edge-tts
# (`pip install pillow numpy scipy edge-tts`; edge-tts needs internet for the voices).
# The terminal app needs Screen Recording and Accessibility permission: the clips are
# recorded with real clicks and key presses. Hands off the mouse and keyboard while it runs.
#
# Env overrides: see common.sh.
set -euo pipefail
source "$(dirname "$0")/common.sh"
CLIPS=$REPO/videos/clips
ALL_CLIPS="preview ruler git compare timeline words theme preview-light preview-dracula"
TARGETS=${*:-$ALL_CLIPS render}

# A screen recording, since `screencapture -l` only manages ~7 fps.
clip() { # <name>
    local scene=${1%%-*} raw="$DEMO/raw/clip-$1"
    [ -f "$HERE/scenes/$scene.json" ] || { echo "unknown clip: $1" >&2; exit 1; }
    rm -rf "$raw"
    mkdir -p "$raw" "$CLIPS"
    case $1 in
        *-light) settings "Default Light Modern" Light ;;
        *-dracula) settings "Default Dark Modern" Dracula ;;
        *) settings "Default Dark Modern" Dark ;;
    esac
    launch "gif-$scene"
    ffmpeg -nostdin -y -loglevel error -f avfoundation -capture_cursor 1 -framerate 60 -pixel_format nv12 \
        -use_wallclock_as_timestamps 1 -i "Capture screen 0" -copyts \
        -vf "crop=$((WW * SCALE)):$((WH * SCALE)):$((WX * SCALE)):$((WY * SCALE))" \
        -c:v h264_videotoolbox -b:v 60M "$raw/screen.mkv" &
    local capture=$!
    sleep 2
    swift "$HERE/input.swift" play "$HERE/scenes/$scene.json" "$PID" "$WX" "$WY" "$raw/events.jsonl"
    sleep 1.2
    kill -INT $capture
    wait $capture || true
    swift "$HERE/window.swift" "$PID" > /dev/null # park the cursor again
    "$PY" "$HERE/compose.py" video "$raw/screen.mkv" "$raw/events.jsonl" "$SCALE" "$CLIPS/$1.mp4"
}

render() {
    for v in short long; do
        "$PY" "$HERE/video.py" "$HERE/videos/$v.json" "$CLIPS" "$REPO/videos/fluid-diff-$v.mp4"
    done
}

[ "$TARGETS" = render ] || setup
for target in $TARGETS; do
    echo "$target"
    case $target in
        render) quit_demo; render ;;
        *) clip "$target" ;;
    esac
done
quit_demo
ls -lh "$REPO"/videos/*.mp4 2>/dev/null || true
