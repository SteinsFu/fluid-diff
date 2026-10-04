#!/usr/bin/env bash
# Regenerates the README demo assets from a real VS Code window:
#   images/theme-{dark,light,dracula}.png   Fluid Diff in each theme (dark is the README hero)
#   images/command.png                      Command Palette filtered to "Fluid Diff: Git"
#   images/demo-{preview,ruler}.gif         scrolling the diff; hovering and clicking ruler marks
#   images/demo-{git,compare,timeline}.gif  one GIF per way of opening Fluid Diff
#
# Usage: scripts/demo/make-demo.sh [stills] [preview] [ruler] [git] [compare] [timeline]   (default: all)
#
# macOS only. Needs: VS Code with the `code` CLI, Xcode command line tools (swift),
# gifski (`brew install gifski`), python3 with Pillow (`pip install pillow`).
# The terminal app needs Screen Recording and Accessibility permission: the GIFs are
# recorded with real clicks and key presses (scenes in scripts/demo/scenes/*.json).
# Hands off the mouse and keyboard while it runs (a few minutes).
#
# Env overrides: CODE_BIN (default: code), PYTHON (default: python3),
# DEMO_DIR (default: /tmp/fluid-diff-demo).
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
CODE=${CODE_BIN:-code}
PY=${PYTHON:-python3}
DEMO=${DEMO_DIR:-/tmp/fluid-diff-demo}
PROFILE="--user-data-dir $DEMO/user"
TARGETS=${*:-stills preview ruler git compare timeline}

wait_for() { # <word> <seconds>
    for _ in $(seq 1 $(($2 * 5))); do
        if grep -q "^error" "$DEMO/ready" 2>/dev/null; then cat "$DEMO/ready" >&2; exit 1; fi
        grep -q "^$1" "$DEMO/ready" 2>/dev/null && return 0
        sleep 0.2
    done
    echo "timed out waiting for '$1'" >&2
    exit 1
}

quit_demo() {
    pkill -f -- "$PROFILE" || true
    while pgrep -f -- "$PROFILE" >/dev/null; do sleep 0.2; done
}

settings() { # <vscode color theme> <fluid-diff theme>
    "$PY" - "$DEMO/user/User/settings.json" "$1" "$2" << 'PY'
import json, sys
path, color_theme, fluid_theme = sys.argv[1:]
json.dump({
    "workbench.colorTheme": color_theme,
    "fluid-diff.theme": fluid_theme,
    "window.autoDetectColorScheme": False,
    "window.restoreWindows": "none",
    "window.menuStyle": "custom",
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": False,
    "workbench.editor.enablePreview": False,
    "workbench.layoutControl.enabled": False,
    "workbench.activity.showAccounts": False,
    "chat.disableAIFeatures": True,
    "security.workspace.trust.enabled": False,
    "update.mode": "none",
    "update.showReleaseNotes": False,
    "extensions.autoUpdate": False,
    "extensions.ignoreRecommendations": True,
    "telemetry.telemetryLevel": "off",
    "files.hotExit": "off",
    "editor.minimap.enabled": False,
    "git.timeline.showUncommitted": True,
}, open(path, "w"), indent=2)
PY
}

# Window bounds and sidebar width. Written while VS Code is closed, since it saves state on exit.
set_layout() {
    "$PY" - "$DEMO/user/User/globalStorage" << 'PY'
import json, os, sqlite3, sys
d = sys.argv[1]
os.makedirs(d, exist_ok=True)
p = os.path.join(d, "storage.json")
data = json.load(open(p)) if os.path.exists(p) else {}
data["windowsState"] = {
    "lastActiveWindow": {
        "folder": "file://" + os.path.realpath(os.path.join(d, "../../../job-queue")),
        "uiState": {"mode": 1, "x": 36, "y": 36, "width": 1640, "height": 980},
    },
    "openedWindows": [],
}
data.pop("backupWorkspaces", None)
json.dump(data, open(p, "w"))
db = os.path.join(d, "state.vscdb")
if os.path.exists(db):
    con = sqlite3.connect(db)
    con.execute("insert or replace into ItemTable (key, value) values ('workbench.sideBar.size', '220')")
    con.commit()
PY
}

# Starts the demo window on <mode> and sets $PID, $WID, $WX, $WY.
launch() { # <mode>
    quit_demo
    set_layout
    rm -rf "$DEMO/ready" "$DEMO/user/Backups"
    echo "$1" > "$DEMO/mode.txt"
    "$CODE" --new-window $PROFILE --extensions-dir "$DEMO/ext" --disable-workspace-trust "$DEMO/job-queue"
    wait_for done 30
    PID=$(pgrep -f -- "MacOS/Code .*$PROFILE" | head -1)
    read -r WID WX WY < <(swift "$HERE/window.swift" "$PID")
}

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

echo "building extension and demo workspace"
(cd "$REPO" && npm run --silent compile)
quit_demo
rm -rf "$DEMO"
mkdir -p "$DEMO/job-queue/src" "$DEMO/job-queue/compare" "$DEMO/user/User" "$DEMO/ext" "$DEMO/raw"
cp "$HERE/sample/job_queue_old.py" "$DEMO/job-queue/src/job_queue.py"
cp "$HERE/sample/job_queue_old.py" "$DEMO/job-queue/compare/job_queue_v1.py"
cp "$HERE/sample/job_queue_new.py" "$DEMO/job-queue/compare/job_queue_v2.py"
git -C "$DEMO/job-queue" init -q
git -C "$DEMO/job-queue" add .
git -C "$DEMO/job-queue" -c user.name=demo -c user.email=demo@example.com commit -qm "Add job queue"
cp "$HERE/sample/job_queue_new.py" "$DEMO/job-queue/src/job_queue.py"
ln -s "$REPO" "$DEMO/ext/fluid-diff"
cp -R "$HERE/driver" "$DEMO/ext/driver"
CURSOR=$(swift "$HERE/input.swift" cursor "$DEMO/cursor.png")

settings "Default Dark Modern" Dark
echo "first launch, so VS Code creates its state files"
launch none

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
