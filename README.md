<div align="center">

<img src="images/icon.png" alt="Fluid Diff icon" width="128">

# Fluid Diff

**Side-by-side diff viewer for VS Code, in the style of Meld and SmartGit.**

Intuitive Diff UI · Aligned panes · Word-level highlights

<img src="images/theme-dark.png" alt="Side-by-side Fluid Diff in VS Code" width="820">

</div>

## Preview

<p align="center">
  <img src="images/demo-preview.gif" alt="Scrolling through a Fluid Diff: both panes stay aligned" width="820">
  <br>
  <em>Scroll either pane and the other follows, with connectors linking each changed chunk.</em>
</p>

<p align="center">
  <img src="images/demo-ruler.gif" alt="Hovering ruler marks enlarges them; clicking one jumps to that chunk" width="820">
  <br>
  <em>Hover a mark on the ruler to highlight its chunk, then click to jump to it.</em>
</p>

---

## Quick start

### Git diff

1. Open a file tracked by Git.
2. Run **Fluid Diff: Git**.
3. Read the diff:

   | Left pane | Right pane |
   | --- | --- |
   | File as committed in `HEAD` | Current editor buffer, unsaved edits included |

<p align="center">
  <img src="images/demo-git.gif" alt="Open the Command Palette, run Fluid Diff: Git, and read the diff" width="820">
</p>

### Selected files

1. In the Explorer, select exactly two files.
2. Right-click and run **Fluid Diff: Compare Selected**.
3. Read the diff:

   | Left pane | Right pane |
   | --- | --- |
   | First file in the selection | Second file in the selection |

<p align="center">
  <img src="images/demo-compare.gif" alt="Select two files in the Explorer, right-click, and run Fluid Diff: Compare Selected" width="820">
</p>

### From a diff editor

1. Open a single-file diff in VS Code, for example from the Source Control view or the Timeline view.
2. Click the **Fluid Diff: From Diff Editor** icon in the editor title bar. If you don't see the icon, click **...** in the editor title bar and pick **Fluid Diff: From Diff Editor** from the menu.
3. Read the diff:

   | Left pane | Right pane |
   | --- | --- |
   | Original side of the diff | Modified side of the diff |

<p align="center">
  <img src="images/demo-timeline.gif" alt="Open a diff from the Timeline view, then click the Fluid Diff icon in the editor title bar" width="820">
</p>

Multi-file diffs, such as a whole commit opened from the Source Control Graph, are not supported. Open a single file's diff instead.

## Ways to open it

| Where | How |
| --- | --- |
| Command Palette | `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P`, then **Fluid Diff: Git** |
| Editor title bar | Click **Fluid Diff: Git** while a text editor has focus |
| Keyboard shortcut | Bind a key to `fluid-diff.fluidDiffGit` |
| Explorer, one file | Right-click a file and click **Fluid Diff: Git** |
| Explorer, two files | Select exactly two files, right-click, and click **Fluid Diff: Compare Selected** (`fluid-diff.fluidDiffSelected`) |
| Diff editor title bar | Click **Fluid Diff: From Diff Editor** (`fluid-diff.fromDiffEditor`) while a single-file diff is active |

<p align="center">
  <img src="images/command.png" alt="Fluid Diff: Git in the VS Code Command Palette" width="820">
</p>

## Themes

Run **Fluid Diff: Select Theme** from the Command Palette, or set `fluid-diff.theme` in Settings.

| Theme | Look |
| --- | --- |
| `Auto` (default) | Light when VS Code uses a light or high-contrast light theme, Dark otherwise |
| `Light` | Light background, VS Code Light+ syntax colors |
| `Dark` | Dark background, VS Code Dark+ syntax colors |
| `Dracula` | Dracula palette, with comments brightened for readability |

The theme applies to diff panels opened after the change.

| Light | Dark | Dracula |
| --- | --- | --- |
| <img src="images/theme-light.png" alt="Fluid Diff Light theme"> | <img src="images/theme-dark.png" alt="Fluid Diff Dark theme"> | <img src="images/theme-dracula.png" alt="Fluid Diff Dracula theme"> |

## Features

- **Aligned panes.** Inserted or deleted lines never push the two sides out of step.
- **Block colors.** Inserted, deleted, and replaced blocks each get their own background.
- **Word highlights.** Inside replaced lines, the exact changed words are marked.
- **Syntax coloring.** Each pane uses the language of its own file.
- **Overview scrollbar rulers.** A ruler beside each pane maps that whole file. Green marks inserts, red marks deletes, and yellow marks replacements. A translucent box shows the visible window. Click a ruler to jump that pane to the clicked spot.
- **Compare any two selected files.** Pick two files in the Explorer and open them side by side. This command reads the two files directly.
- **Reopen any VS Code diff.** From a built-in single-file diff, such as a past commit in the Timeline view, reopen the same two sides in Fluid Diff.
- **Themes.** Auto, Light, Dark, and Dracula. Auto follows the VS Code color theme.

## Requirements

- VS Code `1.128.0` or newer
- Built-in **Git** extension enabled

## Troubleshooting

These messages come from **Fluid Diff: Git**. If a check fails, the panel stays closed.

| Error says | Fix |
| --- | --- |
| built-in Git extension is disabled | Enable the **Git** extension in the Extensions view |
| file is not in a git repository | Open a file inside a Git repository |
| No git HEAD version of the file | Commit the file once, then retry |

## Roadmap

- [x] Compare the active file with its `HEAD` version
- [x] Compare any two selected files
- [x] Overview scrollbar ruler
- [x] Themes: Auto, Light, Dark, Dracula
- [x] Reopen a built-in single-file diff
- [ ] Open changes from git graph
- [ ] Diffing in Markdown preview
- [ ] For git diff, add stage and revert buttons for each code chunk

## Limits

- A gap bigger than 25M cells (about 5000×5000 lines) with no unique line inside becomes one replace chunk.
- Edit-similarity scoring only runs on gaps up to 1M cells.
- A chunk larger than 4M token pairs gets background color only, no word marks.

## Development

```bash
npm install
npm run compile   # build once
npm run watch     # rebuild on change
npm test          # compile, lint, then run tests
```

Press `F5` in VS Code to start an Extension Development Host with Fluid Diff loaded.

To refresh the README images after a UI change, run `scripts/demo/make-images.sh` on macOS, or pass `stills`, `git`, `compare`, or `timeline` to redo only some of them. See [`scripts/demo/README.md`](scripts/demo/README.md) for requirements. The GIF click positions live in `scripts/demo/scenes/`.
