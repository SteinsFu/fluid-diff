import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';
import { diffBlock, diffLines, diffWords } from '../diff';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

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
});
