import * as vscode from 'vscode';
import * as path from 'path';
import { diffLines, splitLines, Chunk } from './diff';
import { getWebviewContent, Side } from './render';
import { copyToIndex, getGitRepo, readIndex, revertChunk, undoRevert, GitRepo, RevertHistory } from './git';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('fluid-diff.fluidDiffGit', diffWithHead),
        // Explorer context menu with two files selected
        vscode.commands.registerCommand('fluid-diff.fluidDiffSelected', async (_uri: vscode.Uri, uris?: vscode.Uri[]) => {
            if (uris?.length === 2) { await diffFiles(uris[0], uris[1]); }
        }),
        vscode.commands.registerCommand('fluid-diff.fromDiffEditor', async () => {
            const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
            if (input instanceof vscode.TabInputTextDiff) { await diffFiles(input.original, input.modified); }
        }),
        vscode.commands.registerCommand('fluid-diff.selectTheme', async () => {
            const theme = await vscode.window.showQuickPick(THEMES, { placeHolder: 'Select a theme' });
            if (theme) {
                await vscode.workspace.getConfiguration('fluid-diff').update('theme', theme, vscode.ConfigurationTarget.Global);
            }
        }),
    );
}

export function deactivate() {}

// ===== Commands =====

// Compare two files (or two sides of a diff editor), no git actions
async function diffFiles(uriA: vscode.Uri, uriB: vscode.Uri) {
    const [docA, docB] = await Promise.all([
        vscode.workspace.openTextDocument(uriA),
        vscode.workspace.openTextDocument(uriB),
    ]);
    await showPanel(`Fluid Diff - ${path.basename(docA.fileName)} vs ${path.basename(docB.fileName)}`, docB.fileName,
        async () => ({ a: sideOf(docA), b: sideOf(docB) }));
}

// Compare the active file's buffer with its git HEAD version, with revert/stage/unstage buttons per chunk
async function diffWithHead() {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc) {
        vscode.window.showInformationMessage('Open a file first to view its diff.');
        return;
    }
    const fileName = doc.fileName;
    let repo: GitRepo;
    try {
        repo = await getGitRepo(doc.uri);
        await repo.show('HEAD', fileName);
    } catch (err) {
        vscode.window.showErrorMessage(`No git HEAD version of ${path.basename(fileName)}: ${(err as Error).message}`);
        return;
    }

    const reverts: RevertHistory = [];
    const load = async () => {
        const [head, indexText] = await Promise.all([repo.show('HEAD', fileName), readIndex(repo, fileName)]);
        return { a: sideOf(doc, head, `${fileName} (HEAD)`), b: sideOf(doc), indexText };
    };
    const onAction = async ({ type, chunk }: Message) => {
        if (type === 'undo') {
            if (!await undoRevert(doc, reverts)) {
                vscode.window.showWarningMessage('Fluid Diff: File was edited after the revert; use undo in the editor instead.');
            }
            return;
        }
        const a = splitLines(await repo.show('HEAD', fileName));
        const b = splitLines(doc.getText());
        if (!chunk || !diffLines(a, b).some(c => sameRange(c, chunk))) {
            vscode.window.showWarningMessage('Fluid Diff: File changed since render; view refreshed.');
        } else if (type === 'revert') {
            const before = doc.getText();
            await revertChunk(doc, a, b, chunk);
            reverts.push({ before, after: doc.getText() });
        } else if (type === 'stage') {
            await copyToIndex(repo, fileName, b, chunk.b0, chunk.b1);
        } else if (type === 'unstage') {
            await copyToIndex(repo, fileName, a, chunk.a0, chunk.a1);
        }
    };
    await showPanel(`Fluid Diff - ${path.basename(fileName)}`, fileName, load, onAction);
}

// ===== Panel =====

// Messages posted by the webview
type Message = { type: 'toggleMode' | 'undo' | 'revert' | 'stage' | 'unstage'; chunk?: Chunk };

const sideOf = (doc: vscode.TextDocument, text = doc.getText(), label = doc.fileName): Side =>
    ({ text, lang: doc.languageId, path: label });

const sameRange = (c: Chunk, d: Chunk) => c.a0 === d.a0 && c.a1 === d.a1 && c.b0 === d.b0 && c.b1 === d.b1;

const showError = (err: unknown) => vscode.window.showErrorMessage(`Fluid Diff: ${(err as Error).message}`);

// Open a Fluid Diff panel. It re-renders from `load` when shown again (the files, index or HEAD may have
// changed meanwhile), on the raw/preview toggle, and after every `onAction` (the git chunk buttons).
// `baseFile` is the file whose folder resolves relative links in the markdown preview.
async function showPanel(
    title: string,
    baseFile: string,
    load: () => Promise<{ a: Side; b: Side; indexText?: string }>,
    onAction?: (msg: Message) => Promise<void>,
) {
    const panel = vscode.window.createWebviewPanel('fluidDiff', title, vscode.ViewColumn.One, { enableScripts: true });
    const baseHref = panel.webview.asWebviewUri(vscode.Uri.file(path.dirname(baseFile))) + '/';
    let preview = false;

    const render = async () => {
        const { a, b, indexText } = await load();
        panel.webview.html = await getWebviewContent(a, b, getTheme(),
            { indexText, preview, baseHref, cspSource: panel.webview.cspSource });
    };

    panel.onDidChangeViewState(() => {
        if (panel.visible) { render().catch(showError); }
    });
    panel.webview.onDidReceiveMessage(async (msg: Message) => {
        try {
            if (msg.type === 'toggleMode') {
                preview = !preview;
            } else {
                await onAction?.(msg);
            }
            await render();
        } catch (err) {
            showError(err);
        }
    });
    await render();
}

// ===== Theme =====

const THEMES = ['Auto', 'Light', 'Dark', 'Dracula'] as const;

// The configured theme in lowercase; Auto follows the VS Code theme
function getTheme(): string {
    const config = vscode.workspace.getConfiguration('fluid-diff').get<string>('theme', 'Auto');
    if (config === 'Auto') {
        const kind = vscode.window.activeColorTheme.kind;
        return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight ? 'light' : 'dark';
    }
    return (THEMES as readonly string[]).includes(config) ? config.toLowerCase() : 'dark';
}
