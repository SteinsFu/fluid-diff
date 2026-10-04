# Shared by make-images.sh and make-videos.sh: the demo workspace and the demo VS Code window.
# Sourced, not run. Callers set -euo pipefail first.
#
# Env overrides: CODE_BIN (default: code), PYTHON (default: python3),
# DEMO_DIR (default: /tmp/fluid-diff-demo).

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
CODE=${CODE_BIN:-code}
PY=${PYTHON:-python3}
DEMO=${DEMO_DIR:-/tmp/fluid-diff-demo}
PROFILE="--user-data-dir $DEMO/user"

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

# Starts the demo window on <mode> and sets $PID, $WID, and the window frame $WX $WY $WW $WH
# in points, with $SCALE pixels per point.
launch() { # <mode>
    quit_demo
    set_layout
    rm -rf "$DEMO/ready" "$DEMO/user/Backups"
    echo "$1" > "$DEMO/mode.txt"
    "$CODE" --new-window $PROFILE --extensions-dir "$DEMO/ext" --disable-workspace-trust "$DEMO/job-queue"
    wait_for done 30
    PID=$(pgrep -f -- "MacOS/Code .*$PROFILE" | head -1)
    read -r WID WX WY WW WH SCALE < <(swift "$HERE/window.swift" "$PID")
}

# Compiles the extension, builds the demo git repo and profile, and launches VS Code once.
setup() {
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
    settings "Default Dark Modern" Dark
    echo "first launch, so VS Code creates its state files"
    launch none
}
