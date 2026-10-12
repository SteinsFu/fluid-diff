// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { diffLines, diffBlock, Chunk, WordMark } from './diff';
import { execFile } from 'child_process';
import { promisify } from 'util';

// Subset of the built-in Git extension API we use; full typings live in vscode's extensions/git/src/api/git.d.ts.
interface GitRepo {
    rootUri: vscode.Uri;
    show(ref: string, path: string): Promise<string>;
}
interface GitExtension {
    getAPI(version: 1): {
        getRepository(uri: vscode.Uri): GitRepo | null;
    }
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

        // 1. Get file name
        const doc = activeEditor.document
        const fileName = doc.fileName;

        // 2. Check if the file is in a git repository
        let repo: GitRepo;
        try {
            const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
            if (!gitExtension) {
                throw new Error('the built-in Git extension is disabled');
            }
            const r = (await gitExtension.activate()).getAPI(1).getRepository(doc.uri);
            if (!r) {
                throw new Error('file is not in a git repository');
            }
            await r.show('HEAD', fileName);
            repo = r; 
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
        
        const render = async () => { 
            const getIndexText = async () => await git(repo.rootUri.fsPath, ['show', `:${relPath(repo, fileName)}`]);
            panel.webview.html = await getWebviewContent(
                context, 
                await repo.show('HEAD', fileName), 
                doc.getText(), 
                lang, 
                lang, 
                theme, 
                `${fileName} (HEAD)`, 
                fileName,
                await getIndexText()
            );
        }
        await render();

        // Refresh when the tab is shown again: the buffer, index or HEAD may have changed meanwhile
        panel.onDidChangeViewState(() => {
            if (panel.visible) {
                render().catch(err => vscode.window.showErrorMessage(`Fluid Diff: ${(err as Error).message}`));
            }
        });

        // 5. Message listeners: rebuild the webview when git buttons are clicked
        const reverts: RevertHistory = [];
        panel.webview.onDidReceiveMessage(async ({ type, chunk }: { type: string; chunk: Chunk }) => {
            try {
                if (type === 'undo') {
                    if (!await undoRevert(doc, reverts)) {
                        vscode.window.showWarningMessage('Fluid Diff: File was edited after the revert; use undo in the editor instead.');
                    }
                    await render();
                    return;
                }
                const a = (await repo.show('HEAD', fileName)).split(/\r?\n/);
                const b = doc.getText().split(/\r?\n/);
                const same = (c: Chunk) => c.a0 === chunk.a0 && c.a1 === chunk.a1 && c.b0 === chunk.b0 && c.b1 === chunk.b1;
                if (!diffLines(a, b).some(same)) {
                    // the chunk no longer exists, redraw the webview
                    vscode.window.showWarningMessage(`Fluid Diff: File changed since render; view refreshed.`);
                } else if (type === 'revert') {
                    const before = doc.getText();
                    await revertChunk(doc, a, b, chunk);
                    reverts.push({ before, after: doc.getText() });
                } else if (type === 'stage') {
                    await copyToIndex(repo, fileName, b, chunk.b0, chunk.b1)
                } else if (type === 'unstage') {
                    await copyToIndex(repo, fileName, a, chunk.a0, chunk.a1)
                }
                await render();
            } catch (err) {
                vscode.window.showErrorMessage(`Fluid Diff: ${(err as Error).message}`);
            }
        })

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
export async function getWebviewContent(
    context: vscode.ExtensionContext, 
    textA: string, textB: string, 
    langA: string, langB: string, 
    theme: string, 
    pathA: string, pathB: string, 
    gitIndexText?: string,       // if index text is provided, Git mode => show revert/stage buttons
): Promise<string> {
    const linesA = textA.split(/\r?\n/);
    const linesB = textB.split(/\r?\n/);
    const chunks = diffLines(linesA, linesB);

    // mark staged chunks (for git mode only)
    if (gitIndexText !== undefined) {
        const index = gitIndexText.split(/\r?\n/);
        const pending = diffLines(index, linesB);   // not staged yet, in buffer coordinates
        const staged = diffLines(linesA, index);    // already staged, in HEAD coordinates
        for (const c of chunks) {
            c.staged = !pending.some(pc => pc.b0 <= c.b1 && c.b0 <= pc.b1);
            c.hasStaged = staged.some(sc => sc.a0 <= c.a1 && c.a0 <= sc.a1);
        }
    }

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
            /\{\{(textA|textB|chunks|theme|pathA|pathB|hasGitActions)\}\}/g,
        (token) => token === '{{textA}}' ? renderLines(linesA, chunks, 'a', words.a, coloreToksA)
            : token === '{{textB}}' ? renderLines(linesB, chunks, 'b', words.b, coloreToksB)
            : token === '{{chunks}}' ? JSON.stringify(chunks)
            : token === '{{pathA}}' ? escape(pathA)
            : token === '{{pathB}}' ? escape(pathB)
            : token === '{{hasGitActions}}' ? String(gitIndexText !== undefined)
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
        if (c.staged) {
            for (let i = s; i < e; i++) {
                cls[i] += ' staged';
            }
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


export async function revertChunk(doc: vscode.TextDocument, a: string[], b: string[], c: Chunk) {
    // replace the chunk in b with the chunk in a
    b.splice(c.b0, c.b1 - c.b0, ...a.slice(c.a0, c.a1));
    await setText(doc, b.join(doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'));
}

async function setText(doc: vscode.TextDocument, text: string) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, doc.validateRange(new vscode.Range(0, 0, doc.lineCount, 0)), text);
    await vscode.workspace.applyEdit(edit);
}

// Text before and after each revert clicked in the Fluid Diff UI, latest last.
export type RevertHistory = { before: string; after: string }[];

// Undo the latest revert. Refuses (returns false) if the file was edited after it, so that edit isn't lost.
export async function undoRevert(doc: vscode.TextDocument, history: RevertHistory): Promise<boolean> {
    const last = history.pop();
    if (!last) { return true; }
    if (doc.getText() !== last.after) {
        history.length = 0;
        return false;
    }
    await setText(doc, last.before);
    return true;
}

const execFileP = promisify(execFile);
const relPath = (repo: GitRepo, fileName: string) => path.relative(repo.rootUri.fsPath, fileName).split(path.sep).join('/');

async function git(cwd: string, args: string[], input?: string): Promise<string> {
    const p = execFileP('git', args, { cwd, maxBuffer: 64 << 20 });  // 64MB buffer (64 * 2^20 bytes) for large files
    if (input !== undefined) { p.child.stdin!.end(input); }
    return (await p).stdout;
}


// helper function to stage or unstage a chunk
// make the index match `source` (buffer to stage, HEAD to unstage) wherever it overlaps lines [lo, hi) of `source`.
export async function copyToIndex(repo: GitRepo, fileName: string, source: string[], lo: number, hi: number) {
    const cwd = repo.rootUri.fsPath;
    const rel = relPath(repo, fileName);
    const raw = await git(cwd, ['show', `:${rel}`]);     // git show :path/to/file.txt => get the file's content from the index (staging area)
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';    // keep the blob's line endings, or one chunk would rewrite every line
    const index = raw.split(/\r?\n/);
    // "touching" counts as overlap, so an index chunk right next to this one gets staged too
    const hits = diffLines(index, source).filter(ic => ic.b0 <= hi && lo <= ic.b1);
    if (!hits.length) {
        // No hits means the index already equals the source in that area
        return;
    }
    // reverse() to replace chunks bottom-up to avoid line number shifting issues
    for (const ic of hits.reverse()) {
        index.splice(ic.a0, ic.a1 - ic.a0, ...source.slice(ic.b0, ic.b1));
    }
    // 1. `hash-object -w --stdin --path=rel` reads the text from stdin, saves it into .git/objects (that's the -w), and prints its SHA.
    // 2. `ls-files -s -- rel` prints the current index entry, for example `100644 3f2a... 0 src/x.ts`. The first word is the mode, and keeping it means an executable file stays executable.
    // 3. `update-index --cacheinfo mode,sha,path` repoints this path's index entry at the new blob
    const sha = (await git(cwd, ['hash-object', '-w', '--stdin', `--path=${rel}`], index.join(eol))).trim();
    const mode = (await git(cwd, ['ls-files', '-s', '--', rel])).split(' ')[0] || '100644'; 
    await git(cwd, ['update-index', '--add', '--cacheinfo', `${mode},${sha},${rel}`]);
}