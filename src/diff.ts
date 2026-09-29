export type ChunkTag = 'insert' | 'delete' | 'replace';

// Half-open line ranges: old lines [a0, a1) map to new lines [b0, b1).
// An empty range (a0 === a1) marks the gap where lines were inserted.
export interface Chunk {
	tag: ChunkTag;
	a0: number;
	a1: number;
	b0: number;
	b1: number;
}

// Character ranges [start, end) of a string.
export type Range = [start: number, end: number];

export function diffLines(a: string[], b: string[]): Chunk[] {
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) { start++; }
	let endA = a.length, endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

	// ponytail: full O(n*m) LCS (longest common subsequence) table over the trimmed middle; fine for typical edits,
	// swap for Myers O((n+m)d) if large files with scattered changes get slow.
	const n = endA - start, m = endB - start;
	const w = m + 1;
	const lcs = new Uint32Array((n + 1) * w);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i * w + j] = a[start + i] === b[start + j]
				? lcs[(i + 1) * w + j + 1] + 1
				: Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
		}
	}

	// chunking: run-length encoding of matching lines; groups of matching lines are chunks.
	const chunks: Chunk[] = [];
	let i = 0, j = 0, runI = 0, runJ = 0;
	const flush = () => {
		if (i === runI && j === runJ) { return; }
		const tag: ChunkTag = i === runI ? 'insert' : j === runJ ? 'delete' : 'replace';
		chunks.push({ tag, a0: start + runI, a1: start + i, b0: start + runJ, b1: start + j });
	};
	while (i < n || j < m) {
		if (i < n && j < m && a[start + i] === b[start + j]) {
			flush();
			i++; j++;
			runI = i; runJ = j;
		} else if (j >= m || (i < n && lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
			i++;
		} else {
			j++;
		}
	}
	flush();
	return chunks;
}

// Character ranges [start, end) of the words that differ between two versions of a line.
export function diffWords(a: string, b: string): { a: Range[]; b: Range[] } {
	const tokenize = (s: string) => s.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? [];
	const ta = tokenize(a), tb = tokenize(b);
	const res = { a: [] as Range[], b: [] as Range[] };
	// Skip very long lines (e.g. minified code): the LCS table would be huge.
	if (ta.length * tb.length > 1_000_000) { return res; }
	const offsets = (t: string[]) => t.reduce((o, tok) => (o.push(o[o.length - 1] + tok.length), o), [0]);
	const oa = offsets(ta), ob = offsets(tb);
	for (const c of diffLines(ta, tb)) {
		if (c.a1 > c.a0) { res.a.push([oa[c.a0], oa[c.a1]]); }
		if (c.b1 > c.b0) { res.b.push([ob[c.b0], ob[c.b1]]); }
	}
	return res;
}
