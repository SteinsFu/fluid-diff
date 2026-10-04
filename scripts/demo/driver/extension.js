// Sets up each demo scene for make-images.sh and make-videos.sh. It is copied to <demo>/ext/driver,
// so the demo root is two levels up. The scripts pick the scene in <demo>/mode.txt
// and waits for this file to write <demo>/ready. GIF input comes from input.swift.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const signal = (s) => fs.writeFileSync(path.join(ROOT, 'ready'), s + '\n');
const run = (cmd, ...args) => vscode.commands.executeCommand(cmd, ...args);

// Workspace paths, not ROOT: ROOT comes from __dirname, which macOS resolves to /private/tmp.
const file = (...parts) => vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, ...parts);
const MAIN = file('src', 'job_queue.py');
const V1 = file('compare', 'job_queue_v1.py');
const V2 = file('compare', 'job_queue_v2.py');

async function open(uri) {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
}

// The first webview open is slow, so do one off camera before recording.
async function warm(cmd, ...args) {
    await run(cmd, ...args);
    await delay(1500);
    await run('workbench.action.closeActiveEditor');
}

// quickOpen keeps the old text while the palette is open, so reopen it for each new query.
async function showQuery(text) {
    await run('workbench.action.closeQuickOpen');
    await delay(40);
    await run('workbench.action.quickOpen', text);
}

async function activate() {
    try {
        const mode = fs.readFileSync(path.join(ROOT, 'mode.txt'), 'utf8').trim();
        // Fluid Diff: Git fails until the Git extension has found the repo.
        const git = (await vscode.extensions.getExtension('vscode.git').activate()).getAPI(1);
        while (git.repositories.length === 0) { await delay(100); }
        await delay(700);
        await run('workbench.action.closeAllEditors');
        await open(MAIN);
        await run('workbench.action.closePanel');
        await run('workbench.action.closeAuxiliaryBar');
        await run('notifications.clearAll');
        if (mode === 'palette') {
            await delay(300);
            await showQuery('>Fluid Diff: Git');
            await delay(300);
        } else if (mode === 'diff') {
            await run('fluid-diff.fluidDiffGit');
            await delay(600);
        } else if (mode === 'gif-preview' || mode === 'gif-ruler' || mode === 'gif-words') {
            await run('fluid-diff.fluidDiffGit');
            await delay(1500);
        } else if (mode === 'gif-git' || mode === 'gif-theme') {
            await warm('fluid-diff.fluidDiffGit');
        } else if (mode === 'gif-compare') {
            await warm('fluid-diff.fluidDiffSelected', V1, [V1, V2]);
            await run('revealInExplorer', V2);
            await run('workbench.action.focusActiveEditorGroup');
        } else if (mode === 'gif-timeline') {
            await warm('fluid-diff.fluidDiffGit');
        }
        await delay(400);
        signal('done');
    } catch (err) {
        signal('error ' + (err && err.stack || err));
    }
}

function deactivate() {}

module.exports = { activate, deactivate };
