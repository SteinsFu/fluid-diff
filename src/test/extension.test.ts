import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { diffBlock, diffLines, diffWords } from '../diff';
import { copyToIndex, getWebviewContent, revertChunk, undoRevert, RevertHistory } from '../extension';

const ext = () => vscode.extensions.all.find(e => e.packageJSON.name === 'fluid-diff')!;

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');
    suiteSetup(() => ext().activate());

    test('Sample test', () => {
        assert.strictEqual(-1, [1, 2, 3].indexOf(5));
        assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    });

    test('diffLines chunks', () => {
        assert.deepStrictEqual(diffLines(['a', 'b', 'c'], ['a', 'b', 'c']), []);
        assert.deepStrictEqual(diffLines(['a', 'c'], ['a', 'b', 'c']), [
            { tag: 'insert', a0: 1, a1: 1, b0: 1, b1: 2 },
        ]);
        assert.deepStrictEqual(diffLines(['a', 'x', 'c', 'd'], ['a', 'y', 'c']), [
            { tag: 'replace', a0: 1, a1: 2, b0: 1, b1: 2 },
            { tag: 'delete', a0: 3, a1: 4, b0: 3, b1: 3 },
        ]);
    });

    test('diffWords marks', () => {
        assert.deepStrictEqual(diffWords('let total = 0;', 'let sum = 0;'), 
            { a: [[4, 9, 'word-replace']], b: [[4, 7, 'word-replace']] });
        assert.deepStrictEqual(diffWords('a b', 'a b c'), 
            { a: [[3, 3, 'word-gap-insert']], b: [[3, 5, 'word-insert']] });
        assert.deepStrictEqual(diffWords('a b c', 'a c'), 
            { a: [[2, 4, 'word-delete']], b: [[2, 2, 'word-gap-delete']] });
    });

    test('diffLines aligns edited lines, not repeated blank lines', () => {
        // The blank line must match the one before the edited apply_tax, so tax pairs with tax.
        const a = ['def ship():', '    return 5', '', 'def apply_tax(amount, rate=0.07):', '    return amount', '', 'class P:'];
        const b = ['def ship():', '    x = 1', '', '    return x', '', 'def apply_tax(amount, rate=0.08):', '    return amount', '',
            'def apply_discount(total):', '    return total', '', 'class P:'];
        assert.deepStrictEqual(diffLines(a, b), [
            { tag: 'replace', a0: 1, a1: 2, b0: 1, b1: 4 },
            { tag: 'replace', a0: 3, a1: 4, b0: 5, b1: 6 },
            { tag: 'insert', a0: 5, a1: 5, b0: 7, b1: 10 },
        ]);
    });

    test('diffBlock marks edits across line breaks', () => {
        // Splitting a call over two lines only marks the space and new indent, not whole lines.
        assert.deepStrictEqual(diffBlock(['foo(alpha, beta)'], ['foo(alpha,', '    beta)']),
            { a: [[[10, 11, 'word-replace']]], b: [[], [[0, 4, 'word-replace']]] });
    });

    test('all commands are registered', async () => {
        const all = await vscode.commands.getCommands(true);
        for (const id of ['fluidDiffGit', 'fluidDiffSelected', 'selectTheme', 'fromDiffEditor']) {
            assert.ok(all.includes(`fluid-diff.${id}`), id);
        }
    });
});

suite('Webview content', () => {
    const context = () => ({ extensionPath: ext().extensionPath }) as vscode.ExtensionContext;

    test('compare mode: no git actions, every placeholder filled', async () => {
        const html = await getWebviewContent(context(), 'a\nb', 'a\nB', 'plaintext', 'plaintext', 'dark', 'old.txt', 'new.txt');
        assert.ok(html.includes(`JSON.parse('false')`));
        assert.ok(!html.includes('"staged"'));
        assert.ok(!/\{\{\w+\}\}/.test(html));
    });

    test('git mode: chunks already in the index are marked staged', async () => {
        // b->B is fully in the index; d->D is only partly staged (the index holds an intermediate x)
        const html = await getWebviewContent(context(), 'a\nb\nc\nd\ne\nf', 'a\nB\nc\nD\ne\nF', 'plaintext', 'plaintext', 'dark', 'f (HEAD)', 'f', 'a\nB\nc\nx\ne\nf');
        assert.ok(html.includes(`JSON.parse('true')`));
        assert.ok(html.includes('"a0":1,"a1":2,"b0":1,"b1":2,"staged":true,"hasStaged":true'));
        assert.ok(html.includes('"a0":3,"a1":4,"b0":3,"b1":4,"staged":false,"hasStaged":true'));
        assert.ok(html.includes('"a0":5,"a1":6,"b0":5,"b1":6,"staged":false,"hasStaged":false'));
        // one staged line on each side
        assert.strictEqual(html.match(/class="[^"]*\bstaged\b/g)?.length, 2);
    });
});

suite('Git chunk actions', () => {
    let dir = '';
    let file = '';
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    const repo = () => ({ rootUri: vscode.Uri.file(dir), show: async () => '' });
    const HEAD = 'a\nb\nc\nd\ne\n';

    setup(() => {
        // realpath: macOS tmpdir is a symlink, and git paths must be relative to the real root
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fluid-diff-')));
        file = path.join(dir, 'f.txt');
        fs.writeFileSync(file, HEAD);
        git('init', '-q');
        git('add', 'f.txt');
        git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init');
    });
    teardown(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('stage and unstage single chunks without touching the others', async () => {
        const head = HEAD.split('\n');
        // insert X,Y after a (shifts index line numbers once staged), and change d -> D
        const buf = 'a\nX\nY\nb\nc\nD\ne\n'.split('\n');
        const [ins, rep] = diffLines(head, buf);
        assert.deepStrictEqual([ins.tag, rep.tag], ['insert', 'replace']);

        await copyToIndex(repo(), file, buf, ins.b0, ins.b1);
        assert.strictEqual(git('show', ':f.txt'), 'a\nX\nY\nb\nc\nd\ne\n');

        // buffer coordinates still find d -> D even though the index gained two lines
        await copyToIndex(repo(), file, buf, rep.b0, rep.b1);
        assert.strictEqual(git('show', ':f.txt'), 'a\nX\nY\nb\nc\nD\ne\n');

        // unstage the insert by HEAD coordinates; the staged D stays
        await copyToIndex(repo(), file, head, ins.a0, ins.a1);
        assert.strictEqual(git('show', ':f.txt'), 'a\nb\nc\nD\ne\n');

        // staging an already staged chunk is a no-op
        await copyToIndex(repo(), file, buf, rep.b0, rep.b1);
        assert.strictEqual(git('show', ':f.txt'), 'a\nb\nc\nD\ne\n');

        assert.strictEqual(fs.readFileSync(file, 'utf8'), HEAD, 'working file must not change');
    });

    test('stage keeps CRLF line endings of the blob', async () => {
        git('config', 'core.autocrlf', 'false');
        fs.writeFileSync(file, 'a\r\nb\r\nc\r\n');
        git('add', 'f.txt');
        const head = git('show', ':f.txt').split(/\r?\n/);
        const buf = ['a', 'B', 'c', ''];
        const [c] = diffLines(head, buf);
        await copyToIndex(repo(), file, buf, c.b0, c.b1);
        assert.strictEqual(git('show', ':f.txt'), 'a\r\nB\r\nc\r\n');
    });

    test('stage keeps the executable bit', async () => {
        git('update-index', '--chmod=+x', 'f.txt');
        const buf = 'a\nB\nc\nd\ne\n'.split('\n');
        const [c] = diffLines(HEAD.split('\n'), buf);
        await copyToIndex(repo(), file, buf, c.b0, c.b1);
        assert.ok(git('ls-files', '-s', 'f.txt').startsWith('100755 '));
    });
});

suite('Revert chunk', () => {
    test('reverts only the clicked chunk in the buffer', async () => {
        const doc = await vscode.workspace.openTextDocument({ content: 'a\nB\nc\nD\n' });
        const a = 'a\nb\nc\nd\n'.split('\n');
        const b = doc.getText().split('\n');
        const [first] = diffLines(a, b);
        await revertChunk(doc, a, b, first);
        assert.strictEqual(doc.getText(), 'a\nb\nc\nD\n');
    });

    test('undo restores reverts in reverse order, but never over a later edit', async () => {
        const doc = await vscode.workspace.openTextDocument({ content: 'a\nB\nc\nD\n' });
        const head = 'a\nb\nc\nd\n'.split('\n');
        const history: RevertHistory = [];
        const revert = async (k: number) => {
            const b = doc.getText().split('\n');
            const before = doc.getText();
            await revertChunk(doc, head, b, diffLines(head, b)[k]);
            history.push({ before, after: doc.getText() });
        };
        await revert(1);
        await revert(0);
        assert.strictEqual(doc.getText(), 'a\nb\nc\nd\n');
        assert.ok(await undoRevert(doc, history));
        assert.strictEqual(doc.getText(), 'a\nB\nc\nd\n');
        assert.ok(await undoRevert(doc, history));
        assert.strictEqual(doc.getText(), 'a\nB\nc\nD\n');
        assert.ok(await undoRevert(doc, history), 'empty history is a no-op');

        await revert(0);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, new vscode.Position(0, 0), 'typed ');
        await vscode.workspace.applyEdit(edit);
        assert.strictEqual(await undoRevert(doc, history), false);
        assert.strictEqual(doc.getText(), 'typed a\nb\nc\nD\n');
    });
});
