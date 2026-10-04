# Demo images and videos

These scripts regenerate the screenshots and GIFs used in the top-level `README.md`, and two narrated demo videos. They record a real VS Code window, so run them again whenever the UI changes.

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
| `videos/clips/*.mp4` | 60 fps recording of every GIF scene, plus `words`, `theme`, `preview-light` and `preview-dracula`, which have no GIF |
| `videos/fluid-diff-short.mp4` | Vertical 1080×1920 reel at 60 fps, under 60 seconds, with headlines, word-by-word captions and upbeat house music |
| `videos/fluid-diff-long.mp4` | Horizontal 1920×1080 tour of every feature at 60 fps, over 60 seconds, with chapter titles, subtitles and lo-fi music |

`make-images.sh` makes the `images/` outputs and `make-videos.sh` makes the `videos/` outputs. Neither touches the other's files. The GIFs come from `screencapture` window shots, which only reach about 7 fps, so the video clips are recorded separately with ffmpeg screen capture at 60 fps.

`videos/` is git-ignored.

## Requirements

- macOS
- VS Code with the `code` command on your `PATH`
- Xcode command line tools, for `swift`
- Screen Recording and Accessibility permission for your terminal app, in System Settings > Privacy & Security. The GIFs and clips are recorded with real clicks and key presses.
- Images: `gifski` (`brew install gifski`) and `python3` with Pillow (`pip install pillow`)
- Videos: `ffmpeg` (`brew install ffmpeg`), `python3` with Pillow, numpy, scipy and edge-tts (`pip install pillow numpy scipy edge-tts`), and internet access, since edge-tts uses Microsoft's online neural voices. If the packages live in a conda env, pass `PYTHON=/path/to/env/bin/python`

## Run it

From the repo root:

```bash
scripts/demo/make-images.sh      # README images: compiles the extension, then makes all of them (about 2 minutes)
scripts/demo/make-videos.sh    # videos: records every clip, then cuts both videos (about 20 minutes)
```

To redo only some outputs, name them:

```bash
scripts/demo/make-images.sh stills              # theme PNGs and command.png
scripts/demo/make-images.sh git compare         # just these two GIFs
scripts/demo/make-videos.sh ruler render      # re-record one clip, then re-cut both videos
scripts/demo/make-videos.sh preview-light     # records scenes/preview.json in the Light theme
scripts/demo/make-videos.sh render            # re-cut both videos from the existing clips, no VS Code
```

Clip names: `preview`, `ruler`, `git`, `compare`, `timeline`, `words`, `theme`, `preview-light`, `preview-dracula`. The scene is the part before any `-`, and `-light` or `-dracula` picks the theme.

While it runs, don't touch the mouse or keyboard, and don't switch apps. Stage Manager shrinks the demo window if it loses focus.

Both scripts start their own VS Code instance with a separate profile in `/tmp/fluid-diff-demo`, so your normal VS Code settings and windows are not affected.

Environment overrides:

| Variable | Default |
| --- | --- |
| `CODE_BIN` | `code` |
| `PYTHON` | `python3` |
| `DEMO_DIR` | `/tmp/fluid-diff-demo` |

## How it works

| File | Role |
| --- | --- |
| `common.sh` | Shared by both scripts: builds the demo git repo, writes VS Code settings and window size, launches VS Code |
| `make-images.sh` | Takes the screenshots and records the GIFs |
| `make-videos.sh` | Records the 60 fps clips, then runs `video.py` for both videos |
| `driver/` | Small helper extension loaded into the demo VS Code. It opens the files and preloads the Fluid Diff panel for each scene |
| `sample/job_queue_old.py`, `sample/job_queue_new.py` | The file pair shown in every diff |
| `scenes/*.json` | Mouse and keyboard steps for each GIF |
| `input.swift` | Plays a scene with real input events and logs them. Also exports the macOS arrow cursor image |
| `window.swift` | Finds the demo window ID and position |
| `compose.py` | Adds the white background and shadow to stills. For GIFs, draws the cursor, click ripples and key badges, and applies the zoom. For clips, does the same on the 60 fps screen recording, which already shows the real cursor |
| `video.py` | Cuts a video from the clips: narration, captions, titles, layout, music at one steady level under the voice |
| `music.py` | Synthesizes the background music, so there are no audio files or licenses to track: `upbeat` (124 BPM house) and `lofi` (80 BPM lo-fi hip-hop) |
| `videos/short.json`, `videos/long.json` | Storyboards: which clip plays in each segment, the narration line, and the on-screen title |

## Editing a video

Each storyboard has a `voice` and `rate` for [edge-tts](https://github.com/rany2/edge-tts) (list voices with `edge-tts --list-voices`), optional `min_seconds` / `max_seconds` limits that `video.py` enforces, `music` (a `music.py` style, or an audio file path relative to the storyboard, looped) with `music_volume`, and a list of segments:

| Field | Effect |
| --- | --- |
| `clip` | Clip name in `videos/clips/`, for example `ruler` or `preview-light` |
| `say` | Narration line. The segment lasts until both the clip and the line are done. If the clip ends first, its last frame holds |
| `title` | Headline (short) or chapter title (long). Words wrapped in `*stars*` are drawn in the accent color |
| `start`, `end` | Part of the clip to play, in clip seconds. Default: the whole clip |
| `speed` | Playback speed. `0.2` with a short `start`–`end` range makes a near-still shot |
| `focus` | `[x, y, scale]`: zoom into the clip around `x`, `y` (fractions of the clip) |

Narration is cached in `videos/clips/tts/`, so editing one line only fetches that line again. After editing, run `scripts/demo/make-videos.sh render`.

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

If a UI change moves a button, update its coordinates in the scene file and rerun that GIF only, for example `scripts/demo/make-images.sh timeline`, and its clip with `scripts/demo/make-videos.sh timeline render`.

To find coordinates, look at a raw frame in `/tmp/fluid-diff-demo/raw/<scene>/frames/`. Frames are at 2× scale with the window shadow around the window. Subtract the shadow offset, roughly 112 px on the left and 76 px on top, then divide by 2.
