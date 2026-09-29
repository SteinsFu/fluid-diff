// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { diffLines, diffWords, pairLines, Chunk, WordMark } from './diff';

// Subset of the built-in Git extension API we use; full typings live in vscode's extensions/git/src/api/git.d.ts.
interface GitExtension {
    getAPI(version: 1): {
        getRepository(uri: vscode.Uri): { show(ref: string, path: string): Promise<string> } | null;
    };
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    const disposable = vscode.commands.registerCommand('easy-diff-viewer.openFluidDiff', async () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        vscode.window.showInformationMessage('Open Fluid Diff from easy-diff-viewer!');

        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showInformationMessage('Open a file first to view its diff.');
            return;
        }

        // 1. Get current text from the active file
        const currentText = activeEditor.document.getText();
        const fileName = activeEditor.document.fileName;

        // 2. Get the last committed version of the file from git
        let previousText: string;
        try {
            const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
            if (!gitExtension) {
                throw new Error('the built-in Git extension is disabled');
            }
            const repo = (await gitExtension.activate()).getAPI(1).getRepository(activeEditor.document.uri);
            if (!repo) {
                throw new Error('file is not in a git repository');
            }
            previousText = await repo.show('HEAD', fileName);
        } catch (err) {
            vscode.window.showErrorMessage(`No git HEAD version of ${path.basename(fileName)}: ${(err as Error).message}`);
            return;
        }

        // 3. Create and show a new webview panel
        const panel = vscode.window.createWebviewPanel(
            'fluidDiff', // Identifies the type of the webview. Used internally
            'Fluid Diff Viewer', // Title of the panel displayed to the user
            vscode.ViewColumn.One, // Editor column to show the new webview panel in.
            {
                enableScripts: true, // Crucial! allwo JS to run inside HTML webview
            }
        );

        // Mock test data
        // const previousText = fs.readFileSync(path.join(context.extensionPath, 'examples', 'example1_old.py'), 'utf8');
        // const currentText = fs.readFileSync(path.join(context.extensionPath, 'examples', 'example1_new.py'), 'utf8');

        // 4. Set the HTML content of the webview panel
        panel.webview.html = getWebviewContent(context, previousText, currentText);
    });

    context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}


// helper function to generate the HTML content for the webview
function getWebviewContent(context: vscode.ExtensionContext, oldText: string, newText: string): string {
    const oldLines = oldText.split(/\r?\n/);
    const newLines = newText.split(/\r?\n/);
    const chunks = diffLines(oldLines, newLines);

    // Word highlights only for similar line pairs; unpaired lines keep only the chunk background.
    const words = { a: new Map<number, WordMark[]>(), b: new Map<number, WordMark[]>() };
    for (const c of chunks) {
        if (c.tag !== 'replace') { continue; }
        for (const [i, j] of pairLines(oldLines.slice(c.a0, c.a1), newLines.slice(c.b0, c.b1))) {
            const w = diffWords(oldLines[c.a0 + i], newLines[c.b0 + j]);
            words.a.set(c.a0 + i, w.a);
            words.b.set(c.b0 + j, w.b);
        }
    }

    const htmlPath = path.join(context.extensionPath, 'src', 'webview', 'diff-view.html');
    // Function replacers: file text may contain `$&`-style patterns that string replacers expand.
    const htmlContent = fs.readFileSync(htmlPath, 'utf8')
        .replace('{{oldText}}', () => renderLines(oldLines, chunks, 'a', words.a))
        .replace('{{newText}}', () => renderLines(newLines, chunks, 'b', words.b))
        .replace('{{chunks}}', () => JSON.stringify(chunks));
    return htmlContent;
}

function renderLines(lines: string[], chunks: Chunk[], side: 'a' | 'b', words: Map<number, WordMark[]>): string {
    const cls: string[] = lines.map(() => 'line');
    for (const c of chunks) {
        const [s, e] = side === 'a' ? [c.a0, c.a1] : [c.b0, c.b1];
        for (let i = s; i < e; i++) { cls[i] += ` chunk-${c.tag}`; }
        if (s === e) {
            if (s < lines.length) { cls[s] += ' gap-before'; } else if (s > 0) { cls[s - 1] += ' gap-after'; }
        }
    }
    const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const renderText = (l: string, marks: WordMark[] = []) => {
        let out = '', pos = 0;
        for (const [s, e, cls] of marks) {
            out += escape(l.slice(pos, s)) + `<span class="${cls}">${escape(l.slice(s, e))}</span>`;
            pos = e;
        }
        return out + escape(l.slice(pos));
    };
    return lines.map((l, i) =>
        `<div class="${cls[i]}"><span class="line-num">${i + 1}</span>${renderText(l, words.get(i)) || ' '}</div>`
    ).join('');
}