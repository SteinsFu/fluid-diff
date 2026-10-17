// Git mode: repository access, stage/unstage of single chunks, and revert/undo in the buffer.
import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { diffLines, splitLines, Chunk } from './diff';

// ===== Repository =====

// Subset of the built-in Git extension API we use; full typings live in vscode's extensions/git/src/api/git.d.ts.
export interface GitRepo {
    rootUri: vscode.Uri;
    show(ref: string, path: string): Promise<string>;
}
interface GitExtension {
    getAPI(version: 1): {
        getRepository(uri: vscode.Uri): GitRepo | null;
    };
}

// The repository holding `uri`. Throws with a user-facing reason if there is none.
export async function getGitRepo(uri: vscode.Uri): Promise<GitRepo> {
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExtension) {
        throw new Error('the built-in Git extension is disabled');
    }
    const repo = (await gitExtension.activate()).getAPI(1).getRepository(uri);
    if (!repo) {
        throw new Error('file is not in a git repository');
    }
    return repo;
}

const execFileP = promisify(execFile);

async function git(cwd: string, args: string[], input?: string): Promise<string> {
    const p = execFileP('git', args, { cwd, maxBuffer: 64 << 20 });  // 64MB buffer (64 * 2^20 bytes) for large files
    if (input !== undefined) { p.child.stdin!.end(input); }
    return (await p).stdout;
}

const relPath = (repo: GitRepo, fileName: string) => path.relative(repo.rootUri.fsPath, fileName).split(path.sep).join('/');

// The file's content in the index (staging area): `git show :path/to/file`
export const readIndex = (repo: GitRepo, fileName: string) => git(repo.rootUri.fsPath, ['show', `:${relPath(repo, fileName)}`]);

// ===== Stage / unstage =====

// Make the index match `source` (buffer to stage, HEAD to unstage) wherever it overlaps lines [lo, hi) of `source`.
export async function copyToIndex(repo: GitRepo, fileName: string, source: string[], lo: number, hi: number) {
    const cwd = repo.rootUri.fsPath;
    const rel = relPath(repo, fileName);
    const raw = await readIndex(repo, fileName);
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';    // keep the blob's line endings, or one chunk would rewrite every line
    const index = splitLines(raw);
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
    const [sha, entry] = await Promise.all([
        git(cwd, ['hash-object', '-w', '--stdin', `--path=${rel}`], index.join(eol)),
        git(cwd, ['ls-files', '-s', '--', rel]),
    ]);
    const mode = entry.split(' ')[0] || '100644';
    await git(cwd, ['update-index', '--add', '--cacheinfo', `${mode},${sha.trim()},${rel}`]);
}

// ===== Revert / undo in the buffer =====

// Replace the chunk's lines in the buffer `b` with its HEAD lines from `a`. Mutates `b`.
export async function revertChunk(doc: vscode.TextDocument, a: string[], b: string[], c: Chunk) {
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
