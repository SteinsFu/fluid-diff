// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { diffLines, diffBlock, Chunk, WordMark } from './diff';

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

    // Command 1: Open Fluid Diff: Git
    const fluidDiffGitDisposable = vscode.commands.registerCommand('fluid-diff.fluidDiffGit', async () => {

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
            `Fluid Diff - ${path.basename(fileName)}`, // Title of the panel displayed to the user
            vscode.ViewColumn.One, // Editor column to show the new webview panel in.
            {
                enableScripts: true, // Crucial! allwo JS to run inside HTML webview
            }
        );

        // 4. Set the HTML content of the webview panel
        const theme = getTheme();
        const lang = activeEditor.document.languageId;
        panel.webview.html = await getWebviewContent(context, previousText, currentText, lang, lang, theme, `${fileName} (HEAD)`, fileName);

        // Mock test data
        // panel.webview.html = await getWebviewContent(context,
        //     fs.readFileSync(path.join(context.extensionPath, 'examples', 'example1_old.py'), 'utf8'),
        //     fs.readFileSync(path.join(context.extensionPath, 'examples', 'example1_new.py'), 'utf8'),
        //     'python', 'python', 
        //     theme
        // );
    });

    // Command 2: Compare Selected
    const fluidDiffSelectedDisposable = vscode.commands.registerCommand('fluid-diff.fluidDiffSelected', async (uri, uris?: vscode.Uri[]) => {
        if (!uris || uris.length !== 2) return;

        // 1. Get the documents and languages
        const [uri1, uri2] = uris;
        const doc1 = await vscode.workspace.openTextDocument(uri1);
        const doc2 = await vscode.workspace.openTextDocument(uri2);
        const lang1 = doc1.languageId;
        const lang2 = doc2.languageId;

        // 2. Create and show a new webview panel
        const panel = vscode.window.createWebviewPanel(
            'fluidDiff',
            `Fluid Diff - ${path.basename(uri1.fsPath)} vs ${path.basename(uri2.fsPath)}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true, // Crucial! allwo JS to run inside HTML webview
            }
        );

        // 3. Set the HTML content of the webview panel
        const theme = getTheme();
        panel.webview.html = await getWebviewContent(context, doc1.getText(), doc2.getText(), lang1, lang2, theme, doc1.fileName, doc2.fileName);
    });

    // Command 3: Select Theme
    const selectThemeDisposable = vscode.commands.registerCommand('fluid-diff.selectTheme', async () => {
        const theme = await vscode.window.showQuickPick(THEMES, {
            placeHolder: 'Select a theme',
        });
        if (theme) {
            vscode.workspace.getConfiguration('fluid-diff').update('theme', theme, vscode.ConfigurationTarget.Global);
        }
    });

    // Command 4: From Diff Editor
    const fromDiffEditorDisposable = vscode.commands.registerCommand('fluid-diff.fromDiffEditor', async () => {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
        if (input instanceof vscode.TabInputTextDiff) {
            const oldDoc = await vscode.workspace.openTextDocument(input.original);
            const newDoc = await vscode.workspace.openTextDocument(input.modified);
            const lang1 = oldDoc.languageId;
            const lang2 = newDoc.languageId;
            const theme = getTheme();
            const panel = vscode.window.createWebviewPanel(
                'fluidDiff',
                `Fluid Diff - ${path.basename(oldDoc.fileName)} vs ${path.basename(newDoc.fileName)}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true, // Crucial! allwo JS to run inside HTML webview
                }
            );
            panel.webview.html = await getWebviewContent(context, oldDoc.getText(), newDoc.getText(), lang1, lang2, theme, oldDoc.fileName, newDoc.fileName);
        }
    });

    context.subscriptions.push(fluidDiffGitDisposable, fluidDiffSelectedDisposable, selectThemeDisposable, fromDiffEditorDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}


// helper function to generate the HTML content for the webview
async function getWebviewContent(context: vscode.ExtensionContext, textA: string, textB: string, langA: string, langB: string, theme: string, pathA: string, pathB: string): Promise<string> {
    const linesA = textA.split(/\r?\n/);
    const linesB = textB.split(/\r?\n/);
    const chunks = diffLines(linesA, linesB);

    // syntax-color the lines
    const [coloreToksA, coloreToksB] = await Promise.all([
        syntaxColoredLines(linesA.join('\n'), langA, theme),
        syntaxColoredLines(linesB.join('\n'), langB, theme),
    ])

    // Word highlights only for replace chunks (pure insert/delete chunks are not highlighted cuz background color is enough to distinguish)
    const words = { a: new Map<number, WordMark[]>(), b: new Map<number, WordMark[]>() };
    for (const c of chunks) {
        if (c.tag !== 'replace') { continue; }
        const w = diffBlock(linesA.slice(c.a0, c.a1), linesB.slice(c.b0, c.b1));
        w.a.forEach((marks, i) => words.a.set(c.a0 + i, marks));
        w.b.forEach((marks, j) => words.b.set(c.b0 + j, marks));
    }

    const htmlPath = path.join(context.extensionPath, 'src', 'webview', 'diff-view.html');
    // Function replacers: file text may contain `$&`-style patterns that string replacers expand.
    const htmlContent = fs.readFileSync(htmlPath, 'utf8').replace(
        /\{\{(textA|textB|chunks|theme|pathA|pathB)\}\}/g,
        (token) => token === '{{textA}}' ? renderLines(linesA, chunks, 'a', words.a, coloreToksA)
            : token === '{{textB}}' ? renderLines(linesB, chunks, 'b', words.b, coloreToksB)
            : token === '{{chunks}}' ? JSON.stringify(chunks)
            : token === '{{pathA}}' ? escape(pathA)
            : token === '{{pathB}}' ? escape(pathB)
            : theme
    );
    return htmlContent;
}

const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderLines(lines: string[], chunks: Chunk[], side: 'a' | 'b', words: Map<number, WordMark[]>, coloredToks: ColoredTok[][]): string {
    const cls: string[] = lines.map(() => 'line');
    for (const c of chunks) {
        const [s, e] = side === 'a' ? [c.a0, c.a1] : [c.b0, c.b1];
        for (let i = s; i < e; i++) { cls[i] += ` chunk-${c.tag}`; }
        if (s < e) { cls[s] += ' chunk-start'; cls[e - 1] += ' chunk-end'; }
        if (s === e) {
            if (s < lines.length) { cls[s] += ' gap-before'; } else if (s > 0) { cls[s - 1] += ' gap-after'; }
        }
    }
    const renderText = (l: string, marks: WordMark[] = [], coloredToks: ColoredTok[] = []) => {
        // k is the index of the next coloredTok to paint
        let k = 0;  
        // function to color HTML for characters [s, e)
        const paint = (s: number, e: number) => {
            // [s, e) is the diff-marked text region; coloredToks.start and .end are syntax color regions
            if (!coloredToks.length) 
                return escape(l.slice(s, e));
            while (k < coloredToks.length && coloredToks[k].end <= s) 
                k++;
            let out = '';
            for (let i = k; i < coloredToks.length && coloredToks[i].start < e; i++) {
                const t = coloredToks[i];
                const text = escape(l.slice(Math.max(s, t.start), Math.min(e, t.end)));
                // color will be undefined for default color (foreground)
                out += t.color ? `<span style="color:${t.color}">${text}</span>` : text;
            }
            return out;
        }
        // paint diff-marked text with syntax-colored tokens
        let out = '', pos = 0;
        for (const [s, e, cls] of marks) {
            out += paint(pos, s) + `<span class="${cls}">${paint(s, e)}</span>`;
            pos = e;
        }
        return out + paint(pos, l.length);
    };
    return lines.map((l, i) =>
        `<div class="${cls[i]}"><span class="line-num">${i + 1}</span>${renderText(l, words.get(i), coloredToks[i] || []) || ' '}</div>`
    ).join('');
}

type ColoredTok = { start: number; end: number; color?: string }

async function syntaxColoredLines(text: string, lang: string, theme: string): Promise<ColoredTok[][]> {
    let colorReplacements: Record<string, string> | undefined;
    if (theme === 'dracula') {
        colorReplacements = { '#6272a4': '#8E99CB' };  // dracula comment color is too dark, so we replace it with a lighter color
    } else if (theme === 'light') {
        // better color palette on top of Light+: navy keywords, black identifiers, green strings, gray comments
        colorReplacements = {
            '#0000ff': '#000080', '#af00db': '#000080',
            '#001080': '#000000', '#0070c1': '#000000', '#795e26': '#000000',
            '#267f99': '#20999d', '#a31515': '#067d17', '#098658': '#1750eb',
            '#008000': '#8c8c8c',
        };
        theme = 'light-plus';
    } else if (theme === 'dark') {
        theme = 'dark-plus';
    }
    const shiki = await import('shiki');
    // VS Code languageIds that differ from shiki's names
    lang = ({
        typescriptreact: 'tsx',
        javascriptreact: 'jsx',
        'cuda-cpp': 'cpp',
        dockercompose: 'yaml',
        restructuredtext: 'rst',
        juliamarkdown: 'markdown',
        snippets: 'jsonc',
    } as Record<string, string>)[lang] ?? lang;
    const safeLang = lang in shiki.bundledLanguages ? lang as keyof typeof shiki.bundledLanguages : 'text';
    const { tokens, fg } = await shiki.codeToTokens(text, { 
            lang: safeLang, 
            theme: theme,
            colorReplacements,
        });
    return tokens.map(line => {
        const out: ColoredTok[] = [];
        let pos = 0;
        for (const t of line) {
            const color = t.color === fg ? undefined : t.color;
            const end = pos + t.content.length;
            const last = out[out.length - 1];
            // merge same-color tokens
            if (last && last.color === color) {
                last.end = end;
            } else {
                out.push({ start: pos, end, color });
            }
            pos = end;
        }
        return out;
    });
}


// UI Theme
const THEMES = ['Auto', 'Light', 'Dark', 'Dracula'] as const;

function getTheme(): string {
    const config = vscode.workspace.getConfiguration('fluid-diff').get<string>('theme', 'Auto');
    if (config === 'Auto') {
        const vscodeTheme = vscode.window.activeColorTheme.kind;
        if (vscodeTheme === vscode.ColorThemeKind.Light || vscodeTheme === vscode.ColorThemeKind.HighContrastLight)
            return 'light';
        return 'dark';
    }
    if ((THEMES as readonly string[]).includes(config)) {
        return config.toLowerCase();
    }
    return 'dark';
}