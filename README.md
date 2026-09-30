<div align="center">

<img src="images/icon.png" alt="Fluid Diff icon" width="128">

# Fluid Diff

**Side-by-side diff viewer for VS Code, in the style of Meld and SmartGit.**

Aligned panes · Word-level highlights · Syntax coloring

</div>

---

## Quick start

### Git diff

1. Open a file tracked by Git.
2. Run **Fluid Diff: Git**.
3. Read the diff:

   | Left pane | Right pane |
   | --- | --- |
   | File as committed in `HEAD` | Current editor buffer, unsaved edits included |

### Selected files

1. In the Explorer, select exactly two files.
2. Right-click and run **Fluid Diff: Compare Selected**.
3. Read the diff:

   | Left pane | Right pane |
   | --- | --- |
   | First file in the selection | Second file in the selection |

## Ways to open it

| Where | How |
| --- | --- |
| Command Palette | `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P`, then **Fluid Diff: Git** |
| Editor title bar | Click **Fluid Diff: Git** while a text editor has focus |
| Keyboard shortcut | Bind a key to `fluid-diff.fluidDiffGit` |
| Explorer, one file | Right-click a file and click **Fluid Diff: Git** |
| Explorer, two files | Select exactly two files, right-click, and click **Fluid Diff: Compare Selected** (`fluid-diff.fluidDiffSelected`) |

## Features

- **Aligned panes.** Inserted or deleted lines never push the two sides out of step.
- **Block colors.** Inserted, deleted, and replaced blocks each get their own background.
- **Word highlights.** Inside replaced lines, the exact changed words are marked.
- **Syntax coloring.** Each pane uses the language of its own file.
- **Overview scrollbar rulers.** A ruler beside each pane maps that whole file. Green marks inserts, red marks deletes, and yellow marks replacements. A translucent box shows the visible window. Click a ruler to jump that pane to the clicked spot.
- **Compare any two selected files.** Pick two files in the Explorer and open them side by side. This command reads the two files directly.

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
- [ ] Light Theme

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
