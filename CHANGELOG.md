# Changelog

## [1.1.0] - 2026-10-11

### Added

- Stage `+`, unstage `-`, and revert `↶` buttons on each chunk in **Fluid Diff: Git**. Staging writes only that chunk to the index and keeps chunks staged earlier, the file's line endings, and its executable bit.
- Staged chunks are drawn faded, with dashed outlines.
- `Ctrl+Z` (`Cmd+Z` on macOS) in the panel undoes the last revert, unless the file was edited after it.
- **Fluid Diff: Git** refreshes when its tab is shown again, and keeps the scroll position across refreshes.

### Changed

- Lines end with extra padding, so the chunk buttons don't cover the end of long lines when scrolled fully right.

## [1.0.0] - 2026-10-05

### Added

- Side-by-side diff with aligned panes. Inserts and deletes never push the two sides out of step. Connectors link each changed chunk, and scrolling one pane moves the other with it.
- Inserted, deleted, and replaced blocks each get their own background. Inside replaced lines, the changed words are marked.
- Syntax coloring in each pane, using the language of that file.
- An overview ruler beside each pane. Green marks inserts, red marks deletes, and yellow marks replacements. Click a mark to jump to that chunk.
- A path bar above each pane, showing which file that side is.
- **Fluid Diff: Git** compares the open file with its `HEAD` version. Unsaved edits in the editor are included.
- **Fluid Diff: Compare Selected** compares two files chosen in the Explorer.
- **Fluid Diff: From Diff Editor** reopens a built-in single-file diff, such as a past commit from the Timeline view.
- Themes: Auto, Light, Dark, and Dracula. Auto follows the VS Code color theme.
