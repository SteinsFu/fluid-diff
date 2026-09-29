<div align="center">

<img src="images/icon.png" alt="Fluid Diff icon" width="128">

# Fluid Diff

**Side-by-side diff viewer for VS Code, in the style of Meld and Beyond Compare.**

Aligned panes · Word-level highlights · Syntax coloring

</div>

---

## Quick start

1. Open a file tracked by Git.
2. Run **Open Fluid Diff**.
3. Read the diff:

   | Left pane | Right pane |
   | --- | --- |
   | File as committed in `HEAD` | Current editor buffer, unsaved edits included |

## Ways to open it

| Where | How |
| --- | --- |
| Command Palette | `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P`, then type `Open Fluid Diff` |
| Editor title bar | Click **Open Fluid Diff** while a text editor has focus |
| Keyboard shortcut | Bind any key to `easy-diff-viewer.openFluidDiff` |

## Features

- **Aligned panes.** Inserted or deleted lines never push the two sides out of step.
- **Block colors.** Inserted, deleted, and replaced blocks each get their own background.
- **Word highlights.** Inside replaced lines, the exact changed words are marked.
- **Syntax coloring.** Both panes use the language of the active file.

## Requirements

- VS Code `1.128.0` or newer
- Built-in **Git** extension enabled

## Troubleshooting

If a check fails, Fluid Diff shows an error and does not open the panel.

| Error says | Fix |
| --- | --- |
| built-in Git extension is disabled | Enable the **Git** extension in the Extensions view |
| file is not in a git repository | Open a file inside a Git repository |
| No git HEAD version of the file | Commit the file once, then retry |

## Roadmap

- [x] Compare the active file with its `HEAD` version
- [ ] Compare any two selected files

## Development

```bash
npm install
npm run compile   # build once
npm run watch     # rebuild on change
npm test          # compile, lint, then run tests
```

Press `F5` in VS Code to start an Extension Development Host with Fluid Diff loaded.
