// Builds the webview HTML: diff chunks, syntax-colored or markdown-rendered panes, and the page template.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { diffLines, diffBlock, splitLines, Chunk, WordMark } from './diff';

// One side of the diff
export interface Side {
    text: string;
    lang: string;   // VS Code languageId
    path: string;   // shown in the path bar
}

export interface RenderOptions {
    indexText?: string;   // git index content: enables Git mode (revert/stage buttons, staged marks)
    preview?: boolean;    // render markdown instead of raw lines, if both sides are markdown
    baseHref?: string;    // resolves relative links and images in the markdown preview
    cspSource?: string;   // webview.cspSource, allowed to serve images and styles
}

export async function getWebviewContent(a: Side, b: Side, theme: string, opts: RenderOptions = {}): Promise<string> {
    const linesA = splitLines(a.text);
    const linesB = splitLines(b.text);
    const chunks = diffLines(linesA, linesB);
    const isMd = a.lang === 'markdown' && b.lang === 'markdown';
    const preview = !!opts.preview && isMd;
    const hasGitActions = opts.indexText !== undefined;
    if (hasGitActions) {
        markStaged(chunks, linesA, linesB, splitLines(opts.indexText!));
    }

    const [htmlA, htmlB] = preview
        ? await renderPreview(linesA, linesB, chunks)
        : await renderRaw(linesA, linesB, a.lang, b.lang, chunks, theme);

    const { html, css, js, diffJs } = loadAssets();
    const vars: Record<string, string> = {
        theme,
        mode: preview ? 'preview' : 'raw',
        nonce: randomBytes(16).toString('base64'),
        cspSource: opts.cspSource ?? '',
        baseHref: opts.baseHref ?? '',
        pathA: escapeHtml(a.path),
        pathB: escapeHtml(b.path),
        textA: htmlA,
        textB: htmlB,
        css,
        js,
        // Preview word marks run diffBlock in the webview on rendered text
        diffJs: preview ? diffJs : '',
        // `<` escaped so no value can close the <script> early
        config: JSON.stringify({ chunks, hasGitActions, isMd }).replace(/</g, '\\u003c'),
    };
    // Function replacer: file text may contain `$&`-style patterns that string replacers expand.
    return html.replace(/\{\{(\w+)\}\}/g, (token, key: string) => vars[key] ?? token);
}

// Template files, read once per session
const WEBVIEW_DIR = path.join(__dirname, '..', 'src', 'webview');
const read = (file: string) => fs.readFileSync(file, 'utf8');
let assets: { html: string; css: string; js: string; diffJs: string } | undefined;
const loadAssets = () => assets ??= {
    html: read(path.join(WEBVIEW_DIR, 'diff-view.html')),
    css: read(path.join(WEBVIEW_DIR, 'diff-view.css')),
    js: read(path.join(WEBVIEW_DIR, 'diff-view.js')),
    diffJs: read(path.join(__dirname, 'diff.js')),  // compiled diff.ts has no imports, so it runs in the webview as is
};

const escapeHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Git mode: flag chunks whose change the index already holds fully (staged) or partly (hasStaged).
function markStaged(chunks: Chunk[], head: string[], buffer: string[], index: string[]) {
    const pending = diffLines(index, buffer);   // not staged yet, in buffer coordinates
    const staged = diffLines(head, index);      // already staged, in HEAD coordinates
    for (const c of chunks) {
        c.staged = !pending.some(pc => pc.b0 <= c.b1 && c.b0 <= pc.b1);
        c.hasStaged = staged.some(sc => sc.a0 <= c.a1 && c.a0 <= sc.a1);
    }
}

// ===== Markdown preview =====

async function renderPreview(linesA: string[], linesB: string[], chunks: Chunk[]): Promise<[string, string]> {
    for (const c of chunks) {
        [c.va0, c.va1] = trimBlank(linesA, c.a0, c.a1);
        [c.vb0, c.vb1] = trimBlank(linesB, c.b0, c.b1);
    }
    return Promise.all([renderMarkdown(linesA), renderMarkdown(linesB)]);
}

const renderMarkdown = async (lines: string[]) =>
    await vscode.commands.executeCommand<string>('markdown.api.render', lines.join('\n'))
    + `<div data-line="${lines.length}"></div>`;  // end-of-file marker

// Display range of lines [s, e) without its leading and trailing blank lines
function trimBlank(lines: string[], s: number, e: number): [number, number] {
    while (s < e && !lines[s].trim()) { s++; }
    while (e > s && !lines[e - 1].trim()) { e--; }
    return [s, e];
}

// ===== Raw text =====

async function renderRaw(linesA: string[], linesB: string[], langA: string, langB: string, chunks: Chunk[], theme: string): Promise<[string, string]> {
    const [colorsA, colorsB] = await Promise.all([
        syntaxColors(linesA, langA, theme),
        syntaxColors(linesB, langB, theme),
    ]);
    // Word highlights only for replace chunks: the background already tells insert/delete apart
    const wordsA = new Map<number, WordMark[]>(), wordsB = new Map<number, WordMark[]>();
    for (const c of chunks) {
        if (c.tag !== 'replace') { continue; }
        const w = diffBlock(linesA.slice(c.a0, c.a1), linesB.slice(c.b0, c.b1));
        w.a.forEach((marks, i) => wordsA.set(c.a0 + i, marks));
        w.b.forEach((marks, j) => wordsB.set(c.b0 + j, marks));
    }
    return [
        renderLines(linesA, chunks, 'a', wordsA, colorsA),
        renderLines(linesB, chunks, 'b', wordsB, colorsB),
    ];
}

function renderLines(lines: string[], chunks: Chunk[], side: 'a' | 'b', words: Map<number, WordMark[]>, colors: ColoredTok[][]): string {
    const cls = lines.map(() => 'line');
    for (const c of chunks) {
        const [s, e] = side === 'a' ? [c.a0, c.a1] : [c.b0, c.b1];
        const staged = c.staged ? ' staged' : '';
        for (let i = s; i < e; i++) { cls[i] += ` chunk-${c.tag}${staged}`; }
        if (s < e) {
            cls[s] += ' chunk-start';
            cls[e - 1] += ' chunk-end';
        } else if (s < lines.length) {
            cls[s] += ' gap-before';
        } else if (s > 0) {
            cls[s - 1] += ' gap-after';
        }
    }
    return lines.map((l, i) =>
        `<div class="${cls[i]}"><span class="line-num">${i + 1}</span>${renderText(l, words.get(i), colors[i]) || ' '}</div>`
    ).join('');
}

// HTML for one line: word marks as spans, each holding the syntax-colored tokens it covers
function renderText(line: string, marks: WordMark[] = [], colors: ColoredTok[] = []): string {
    let k = 0;  // index of the first token that may overlap the next painted range
    // Syntax-colored HTML for characters [s, e)
    const paint = (s: number, e: number) => {
        if (!colors.length) { return escapeHtml(line.slice(s, e)); }
        while (k < colors.length && colors[k].end <= s) { k++; }
        let out = '';
        for (let i = k; i < colors.length && colors[i].start < e; i++) {
            const t = colors[i];
            const text = escapeHtml(line.slice(Math.max(s, t.start), Math.min(e, t.end)));
            out += t.color ? `<span style="color:${t.color}">${text}</span>` : text;
        }
        return out;
    };
    let out = '', pos = 0;
    for (const [s, e, cls] of marks) {
        out += paint(pos, s) + `<span class="${cls}">${paint(s, e)}</span>`;
        pos = e;
    }
    return out + paint(pos, line.length);
}

// ===== Syntax colors (shiki) =====

// Character range [start, end) of a line in one color; no color means the default foreground
type ColoredTok = { start: number; end: number; color?: string };

// Fluid Diff theme -> shiki theme, with palette tweaks
const SHIKI_THEMES: Record<string, { name: string; colorReplacements?: Record<string, string> }> = {
    // better palette on top of Light+: navy keywords, black identifiers, green strings, gray comments
    light: {
        name: 'light-plus',
        colorReplacements: {
            '#0000ff': '#000080', '#af00db': '#000080',
            '#001080': '#000000', '#0070c1': '#000000', '#795e26': '#000000',
            '#267f99': '#20999d', '#a31515': '#067d17', '#098658': '#1750eb',
            '#008000': '#8c8c8c',
        },
    },
    dark: { name: 'dark-plus' },
    // the dracula comment color is too dark
    dracula: { name: 'dracula', colorReplacements: { '#6272a4': '#8E99CB' } },
};

// VS Code languageIds that differ from shiki's names
const LANG_ALIASES: Record<string, string> = {
    typescriptreact: 'tsx',
    javascriptreact: 'jsx',
    'cuda-cpp': 'cpp',
    dockercompose: 'yaml',
    restructuredtext: 'rst',
    juliamarkdown: 'markdown',
    snippets: 'jsonc',
};

async function syntaxColors(lines: string[], lang: string, theme: string): Promise<ColoredTok[][]> {
    const shiki = await import('shiki');
    const { name, colorReplacements } = SHIKI_THEMES[theme] ?? SHIKI_THEMES.dark;
    lang = LANG_ALIASES[lang] ?? lang;
    const { tokens, fg } = await shiki.codeToTokens(lines.join('\n'), {
        lang: lang in shiki.bundledLanguages ? lang as keyof typeof shiki.bundledLanguages : 'text',
        theme: name,
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
