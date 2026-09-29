import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';
import { diffLines, diffWords } from '../diff';

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

	test('diffWords ranges', () => {
		assert.deepStrictEqual(diffWords('let total = 0;', 'let sum = 0;'), { a: [[4, 9]], b: [[4, 7]] });
		assert.deepStrictEqual(diffWords('a b', 'a b c'), { a: [], b: [[3, 5]] });
	});
});
