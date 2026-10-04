# Demo images

These scripts regenerate the screenshots and GIFs used in the top-level `README.md`. They record a real VS Code window, so run them again whenever the UI changes.

| Output | Content |
| --- | --- |
| `images/theme-dark.png` | Fluid Diff in the Dark theme (also the README hero image) |
| `images/theme-light.png`, `images/theme-dracula.png` | Fluid Diff in the other themes |
| `images/command.png` | Command Palette filtered to "Fluid Diff: Git" |
| `images/demo-preview.gif` | Scrolling through the diff, first over the right pane, then the left |
| `images/demo-ruler.gif` | Hovering ruler marks, then clicking one to jump to its chunk |
| `images/demo-git.gif` | Command Palette, then **Fluid Diff: Git** |
| `images/demo-compare.gif` | Explorer selection, right-click, then **Fluid Diff: Compare Selected** |
| `images/demo-timeline.gif` | Timeline diff, then the **Fluid Diff: From Diff Editor** title-bar icon |

## Requirements

- macOS
- VS Code with the `code` command on your `PATH`
- Xcode command line tools, for `swift`
- `gifski`: `brew install gifski`
- `python3` with Pillow: `pip install pillow`
- Screen Recording and Accessibility permission for your terminal app, in System Settings > Privacy & Security. The GIFs are recorded with real clicks and key presses.

## Run it

From the repo root:

```bash
scripts/demo/make-demo.sh      # compiles the extension, then makes everything (about 2 minutes)
```

To redo only some outputs, name them:

```bash
scripts/demo/make-demo.sh stills          # theme PNGs and command.png
scripts/demo/make-demo.sh git compare     # just these two GIFs
```

While it runs, don't touch the mouse or keyboard, and don't switch apps. Stage Manager shrinks the demo window if it loses focus.

The script starts its own VS Code instance with a separate profile in `/tmp/fluid-diff-demo`, so your normal VS Code settings and windows are not affected.

Environment overrides:

| Variable | Default |
| --- | --- |
| `CODE_BIN` | `code` |
| `PYTHON` | `python3` |
| `DEMO_DIR` | `/tmp/fluid-diff-demo` |

## How it works

| File | Role |
| --- | --- |
| `make-demo.sh` | Builds the demo git repo, writes VS Code settings and window size, launches VS Code, takes screenshots, records the GIFs |
| `driver/` | Small helper extension loaded into the demo VS Code. It opens the files and preloads the Fluid Diff panel for each scene |
| `sample/job_queue_old.py`, `sample/job_queue_new.py` | The file pair shown in every diff |
| `scenes/*.json` | Mouse and keyboard steps for each GIF |
| `input.swift` | Plays a scene with real input events and logs them. Also exports the macOS arrow cursor image |
| `window.swift` | Finds the demo window ID and position |
| `compose.py` | Adds the white background and shadow to stills. For GIFs, draws the cursor, click ripples and key badges, and applies the zoom |

## Editing a GIF

Each scene in `scenes/` is a list of steps. Coordinates are in points, measured from the top-left corner of the VS Code window. The window is 1640×980 points.

| Step | Effect |
| --- | --- |
| `{"at": [x, y]}` | Put the cursor at a position without animating |
| `{"move": [x, y], "ms": 600}` | Glide the cursor to a position |
| `{"click": "left"}` or `{"click": "right", "mods": ["cmd"]}` | Click, optionally holding modifier keys |
| `{"keys": "cmd+shift+p"}` | Press a shortcut. The GIF shows it as a badge |
| `{"type": "Fluid Diff: Git", "ms": 75}` | Type text, `ms` per character |
| `{"scroll": 1100, "ms": 2000}` | Scroll down by that many pixels at the cursor. Negative scrolls up |
| `{"wait": 1000}` | Pause in milliseconds |
| `{"zoom": [x, y, scale]}` | Ease the camera toward a point. Use `scale` 1 to zoom back out |

If a UI change moves a button, update its coordinates in the scene file and rerun that GIF only, for example `scripts/demo/make-demo.sh timeline`.

To find coordinates, look at a raw frame in `/tmp/fluid-diff-demo/raw/<scene>/frames/`. Frames are at 2× scale with the window shadow around the window. Subtract the shadow offset, roughly 112 px on the left and 76 px on top, then divide by 2.
