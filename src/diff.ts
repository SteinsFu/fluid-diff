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

// export type Range = [start: number, end: number];
export type WordMark = [start: number, end: number, cls: string];

// Character ranges [start, end) of a string.
// Index pairs [i, j] of lines in a and b that look like edits of each other.
// Pairs keep order (never cross) and maximize total similarity; dissimilar lines stay unpaired.
export function pairLines(a: string[], b: string[]): [number, number][] {
    const n = a.length, m = b.length;
    if (n * m > 1_000_000) { return []; }
    // word-overlap (Dice) similarity with a fixed 0.5 cutoff; ignores word order and
    // punctuation. Swap for a per-pair token LCS ratio if pairing misfires on real code.
    const MIN_SIMILARITY = 0.5;
    const words = (s: string) => s.match(/[\p{L}\p{N}_]+/gu) ?? [];
    const wa = a.map(words), wb = b.map(words);
    const sim = new Float64Array(n * m);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < m; j++) {
            if (!wa[i].length || !wb[j].length) { continue; }
            const counts = new Map<string, number>();
            for (const w of wa[i]) { counts.set(w, (counts.get(w) ?? 0) + 1); }
            let shared = 0;
            for (const w of wb[j]) {
                const c = counts.get(w);
                if (c) { shared++; counts.set(w, c - 1); }
            }
            const s = 2 * shared / (wa[i].length + wb[j].length);
            if (s >= MIN_SIMILARITY) { sim[i * m + j] = s; }
        }
    }

    // best[i][j] = highest total similarity pairing a[i:] with b[j:].
    const w = m + 1;
    const best = new Float64Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            const s = sim[i * m + j];
            best[i * w + j] = Math.max(best[(i + 1) * w + j], best[i * w + j + 1], s ? s + best[(i + 1) * w + j + 1] : 0);
        }
    }
    const pairs: [number, number][] = [];
    for (let i = 0, j = 0; i < n && j < m;) {
        const s = sim[i * m + j];
        if (s && best[i * w + j] === s + best[(i + 1) * w + j + 1]) { pairs.push([i, j]); i++; j++; }
        else if (best[i * w + j] === best[(i + 1) * w + j]) { i++; }
        else { j++; }
    }
    return pairs;
}

export function diffLines(a: string[], b: string[]): Chunk[] {
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) { start++; }
    let endA = a.length, endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

    // full O(n*m) LCS (longest common subsequence) table over the trimmed middle; fine for typical edits,
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
export function diffWords(a: string, b: string): { a: WordMark[]; b: WordMark[] } {
    // css class names for word highlights
    const cls = {
        insert: ['word-gap-insert', 'word-insert'],
        delete: ['word-delete', 'word-gap-delete'],
        replace: ['word-replace', 'word-replace']
    } as const;

    // tokenize the lines into words
    const tokenize = (s: string) => s.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? [];
    const ta = tokenize(a), tb = tokenize(b);
    const res = { a: [] as WordMark[], b: [] as WordMark[] };

    // Skip very long lines (e.g. minified code): the LCS table would be huge.
    if (ta.length * tb.length > 1_000_000) { return res; }
    const offsets = (t: string[]) => t.reduce((o, tok) => (o.push(o[o.length - 1] + tok.length), o), [0]);
    const oa = offsets(ta), ob = offsets(tb);
    for (const c of diffLines(ta, tb)) {
        const [clsA, clsB] = cls[c.tag];
        res.a.push([oa[c.a0], oa[c.a1], clsA]);
        res.b.push([ob[c.b0], ob[c.b1], clsB]);
    }
    return res;
}
