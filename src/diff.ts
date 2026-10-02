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

// Character range [start, end) of a string, with the css class that highlights it.
export type WordMark = [start: number, end: number, cls: string];

const WORDS = /[\p{L}\p{N}_]+/gu;
// newline is its own token so block diffs can match text across line breaks
const TOKENS = /[\p{L}\p{N}_]+|\n|[^\S\n]+|[^\p{L}\p{N}_\s]/gu;
const HAS_WORD = /[\p{L}\p{N}_]/u;

// Dice overlap of word multisets, 0 below a 0.5 cutoff; ignores word order.
// Punctuation only counts when a line has no words: comparing all tokens pairs unrelated lines,
// e.g. "foo(a, b)" vs "bar(c, d)" share "(", ",", " ", ")".
function lineSimilarity(): (x: string, y: string) => number {
    const cache = new Map<string, [words: string[], tokens: string[]]>();
    const bags = (s: string) => {
        let v = cache.get(s);
        if (!v) { cache.set(s, v = [s.match(WORDS) ?? [], s.match(TOKENS) ?? []]); }
        return v;
    };
    return (x, y) => {
        const [wx, tx] = bags(x), [wy, ty] = bags(y);
        const [left, right] = (!wx.length || !wy.length) ? [tx, ty] : [wx, wy];
        if (!left.length || !right.length) { return 0; }
        const counts = new Map<string, number>();
        for (const w of left) { counts.set(w, (counts.get(w) ?? 0) + 1); }
        let shared = 0;
        for (const w of right) {
            const c = counts.get(w);
            if (c) { shared++; counts.set(w, c - 1); }
        }
        const s = 2 * shared / (left.length + right.length);
        return s >= 0.5 ? Math.min(s, 0.99) : 0;
    };
}

// Patience-diff anchors: items that occur exactly once in both ranges (and contain a word),
// reduced to their longest in-order run. They pin the alignment so repeated items
// (blank lines, "return total", "}") can't match across unrelated code.
function uniqueAnchors(a: string[], b: string[], a0: number, a1: number, b0: number, b1: number): [number, number][] {
    const seen = new Map<string, [ca: number, cb: number, i: number, j: number]>();
    for (let i = a0; i < a1; i++) {
        const e = seen.get(a[i]);
        if (e) { e[0]++; } else { seen.set(a[i], [1, 0, i, -1]); }  // 1: a count, 0: b count, i: a index, -1: b index
    }
    for (let j = b0; j < b1; j++) {
        const e = seen.get(b[j]);
        if (e) { e[1]++; e[3] = j; }
    }
    // Map keeps first-seen order, so candidates are sorted by i; take the longest increasing run of j.
    // e.g.
    // Text	     Record	         Kept as an anchor?
    // "x = 1"   [1, 0, 0, -1]   no, it's not in b
    // ""        [2, 1, 1, 0]    no, it appears twice in a (and has no word)
    // "return"  [1, 1, 2, 2]    yes, anchor (2, 2)
    const cands = [...seen.values()].filter(e => e[0] === 1 && e[1] === 1 && HAS_WORD.test(a[e[2]]));
    const tails: number[] = [], prev: number[] = [];
    // O(n log n) patience sort
    cands.forEach((e, k) => {
        let lo = 0, hi = tails.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cands[tails[mid]][3] < e[3]) { lo = mid + 1; } else { hi = mid; }
        }
        prev[k] = lo ? tails[lo - 1] : -1;
        tails[lo] = k;
    });
    const res: [number, number][] = [];
    for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) { res.push([cands[k][2], cands[k][3]]); }
    return res.reverse();
}

// Order-preserving alignment of a[a0:a1] and b[b0:b1] that maximizes total score, where equal items
// score 1 and similar items score their similarity. Similar pairs steer which equal items get matched
// (so "def apply_tax(...)" lines up with its edited version) but only equal pairs are pushed to out.
function alignGap(a: string[], b: string[], a0: number, a1: number, b0: number, b1: number,
    out: [number, number][], similar?: (x: string, y: string) => number) {
    const n = a1 - a0, m = b1 - b0;
    // O(n*m) table; a gap this large between unique anchors becomes one replace chunk.
    if (n * m > 25_000_000) { return; }
    const fuzzy = similar && n * m <= 1_000_000;
    const score = (i: number, j: number) =>
        a[a0 + i] === b[b0 + j] ? 1 : fuzzy ? similar(a[a0 + i], b[b0 + j]) : 0;
    const sim = new Float64Array(n * m);
    for (let i = 0; i < n; i++) { for (let j = 0; j < m; j++) { sim[i * m + j] = score(i, j); } }
    // Among equal-score alignments, prefer pairs whose diagonal neighbours also pair: it keeps runs
    // contiguous, e.g. a blank line matches the blank right before "def apply_tax" rather than an earlier one.
    const at = (i: number, j: number) => i >= 0 && j >= 0 && i < n && j < m ? sim[i * m + j] : 0;
    const gain = (i: number, j: number) => {
        const s = sim[i * m + j];
        return s && s + 0.001 * (+(at(i - 1, j - 1) > 0) + +(at(i + 1, j + 1) > 0));
    };
    const w = m + 1;
    const best = new Float64Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            const g = gain(i, j);
            best[i * w + j] = Math.max(best[(i + 1) * w + j], best[i * w + j + 1], g ? g + best[(i + 1) * w + j + 1] : 0);
        }
    }
    for (let i = 0, j = 0; i < n && j < m;) {
        const g = gain(i, j);
        if (g && best[i * w + j] === g + best[(i + 1) * w + j + 1]) {
            if (sim[i * m + j] === 1) { out.push([a0 + i, b0 + j]); }
            i++; j++;
        } else if (best[i * w + j] === best[(i + 1) * w + j]) { i++; }
        else { j++; }
    }
}

// Pushes the equal pairs of a[a0:a1] and b[b0:b1] to out, in order.
function align(a: string[], b: string[], a0: number, a1: number, b0: number, b1: number,
    out: [number, number][], similar?: (x: string, y: string) => number) {
    while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) { out.push([a0++, b0++]); }
    const tail: [number, number][] = [];
    while (a1 > a0 && b1 > b0 && a[a1 - 1] === b[b1 - 1]) { tail.push([--a1, --b1]); }
    if (a0 < a1 && b0 < b1) {
        const anchors = uniqueAnchors(a, b, a0, a1, b0, b1);
        if (!anchors.length) { alignGap(a, b, a0, a1, b0, b1, out, similar); }
        for (const [i, j] of anchors) {
            align(a, b, a0, i, b0, j, out, similar);
            out.push([i, j]);
            a0 = i + 1; b0 = j + 1;
        }
        if (anchors.length) { align(a, b, a0, a1, b0, b1, out, similar); }
    }
    out.push(...tail.reverse());
}

// Runs of unmatched items between equal pairs.
function toChunks(a: string[], b: string[], similar?: (x: string, y: string) => number): Chunk[] {
    const matches: [number, number][] = [];
    align(a, b, 0, a.length, 0, b.length, matches, similar);
    matches.push([a.length, b.length]);
    const chunks: Chunk[] = [];
    let pi = 0, pj = 0;
    for (const [i, j] of matches) {
        if (i > pi || j > pj) {
            chunks.push({ tag: i === pi ? 'insert' : j === pj ? 'delete' : 'replace', a0: pi, a1: i, b0: pj, b1: j });
        }
        pi = i + 1; pj = j + 1;
    }
    return chunks;
}

export function diffLines(a: string[], b: string[]): Chunk[] {
    return toChunks(a, b, lineSimilarity());
}

// Character ranges [start, end) of the words that differ between two versions of a text.
export function diffWords(a: string, b: string): { a: WordMark[]; b: WordMark[] } {
    // css class names for word highlights
    const cls = {
        insert: ['word-gap-insert', 'word-insert'],
        delete: ['word-delete', 'word-gap-delete'],
        replace: ['word-replace', 'word-replace']
    } as const;

    const ta = a.match(TOKENS) ?? [], tb = b.match(TOKENS) ?? [];
    const res = { a: [] as WordMark[], b: [] as WordMark[] };

    // Skip huge inputs (e.g. minified code): the alignment table would be huge.
    if (ta.length * tb.length > 4_000_000) { return res; }
    const offsets = (t: string[]) => t.reduce((o, tok) => (o.push(o[o.length - 1] + tok.length), o), [0]);
    const oa = offsets(ta), ob = offsets(tb);
    const chunks = toChunks(ta, tb);

    // Semantic cleanup (diff-match-patch style): absorb an equality into its neighbours when it is no
    // longer than the edits on either side, so stray matches of common tokens ("self", ".", "return")
    // don't shred rewritten text. Equalities with 2+ words are kept: in code they are real shared text.
    const size = (c: Chunk) => Math.max(oa[c.a1] - oa[c.a0], ob[c.b1] - ob[c.b0]);
    for (let changed = true; changed;) {
        changed = false;
        for (let k = chunks.length - 1; k > 0; k--) {
            const p = chunks[k - 1], c = chunks[k];
            const gap = oa[c.a0] - oa[p.a1];
            const words = ta.slice(p.a1, c.a0).filter(t => HAS_WORD.test(t)).length;
            if (words <= 1 && gap <= size(p) && gap <= size(c)) {
                chunks.splice(k - 1, 2, { tag: 'replace', a0: p.a0, a1: c.a1, b0: p.b0, b1: c.b1 });
                changed = true;
            }
        }
    }

    for (const c of chunks) {
        const [clsA, clsB] = cls[c.tag];
        res.a.push([oa[c.a0], oa[c.a1], clsA]);
        res.b.push([ob[c.b0], ob[c.b1], clsB]);
    }
    return res;
}

// Word marks for a replaced block of lines, diffed as one text so edits that cross line breaks
// (joined, split or inserted lines) line up. Returns the marks of each line.
export function diffBlock(a: string[], b: string[]): { a: WordMark[][]; b: WordMark[][] } {
    const w = diffWords(a.join('\n'), b.join('\n'));
    const perLine = (lines: string[], marks: WordMark[]) => {
        let off = 0;
        return lines.map(l => {
            const s0 = off, e0 = off + l.length;
            off = e0 + 1;
            return marks.flatMap(([s, e, cls]): WordMark[] => {
                if (s === e) { return s >= s0 && s <= e0 ? [[s - s0, s - s0, cls]] : []; }
                const ls = Math.max(s, s0), le = Math.min(e, e0);
                return ls < le ? [[ls - s0, le - s0, cls]] : [];
            });
        });
    };
    return { a: perLine(a, w.a), b: perLine(b, w.b) };
}
