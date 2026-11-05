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
    mathCss?: string;     // KaTeX stylesheet for math in the markdown preview
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
        mathStyle: preview && opts.mathCss ? `<link rel="stylesheet" href="${escapeHtml(opts.mathCss)}">` : '',
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
        // Empty for the built-in themes, which keep the 20px line box
        lineHeightStyle: theme === 'vscode' ? `--line-height: ${editorLineHeight()}px` : '',
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

async function renderMarkdown(lines: string[]) {
    const tex = texMath(lines);
    let html = await vscode.commands.executeCommand<string>('markdown.api.render', tex.lines.join('\n'));
    // The math plugin renders display math without the data-line that maps blocks to source lines; each
    // `$$` pair opens one, in order. On a count mismatch (e.g. an escaped `\$$`) blocks stay untagged.
    const opens = tex.dollars.filter((_, i) => i % 2 === 0);
    if (html.split('<p class="katex-block"').length - 1 === opens.length) {
        let k = 0;
        html = html.replace(/<p class="katex-block"/g, m => `${m} data-line="${opens[k++]}"`);
    }
    return html + `<div data-line="${lines.length}"></div>`;  // end-of-file marker
}

// LaTeX delimiters `\[ \]` and `\( \)` as the `$$` and `$` the math plugin reads (markdown takes `\[` as an
// escaped `[`). Only columns shift, so block line numbers stay put. Fenced code and inline code are left alone.
// Also returns the line of every `$$` in the result.
const TEX_DELIMS: Record<string, string> = { '\\[': '$$', '\\]': '$$', '\\(': '$', '\\)': '$' };
function texMath(lines: string[]): { lines: string[]; dollars: number[] } {
    let fence = '';
    const dollars: number[] = [];
    const out = lines.map((line, i) => {
        const f = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
        if (f && !fence) { fence = f; return line; }
        if (fence) {
            if (f && f[0] === fence[0] && f.length >= fence.length) { fence = ''; }
            return line;
        }
        line = line.replace(/(`+).*?\1|(?<!\\)\\[[\]()]/g, m => TEX_DELIMS[m] ?? m);
        for (const m of line.matchAll(/(`+).*?\1|\$\$/g)) { if (m[0] === '$$') { dollars.push(i); } }
        return line;
    });
    return { lines: out, dollars };
}

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

function editorLineHeight(): number {
    const ed = vscode.workspace.getConfiguration('editor');
    const fontSize = ed.get<number>('fontSize', 14);
    const lh = ed.get<number>('lineHeight', 0) ?? 0;
    return lh > 0 ? lh : Math.round(fontSize * 1.35);
}

// One side of a VS Code color theme after `include` is flattened
export interface VsCodeTheme {
    name?: string;
    type?: string;
    colors?: Record<string, string>;
    tokenColors?: object[];
    semanticTokenColors?: Record<string, string>;
}

// Parent first, then the including file. Later token rules win.
export function mergeTheme(base: VsCodeTheme, extra: VsCodeTheme): VsCodeTheme {
    return {
        name: extra.name ?? base.name,
        type: extra.type ?? base.type,
        colors: { ...base.colors, ...extra.colors },
        tokenColors: [...(base.tokenColors ?? []), ...(extra.tokenColors ?? [])],
        semanticTokenColors: { ...base.semanticTokenColors, ...extra.semanticTokenColors },
    };
}

// Theme JSON is often JSONC. No dependency: strip comments and trailing commas, then JSON.parse.
function parseJsonc(text: string): unknown {
    let out = '';
    let i = 0;
    let str = false;
    let esc = false;
    const src = text.replace(/^\uFEFF/, '');
    while (i < src.length) {
        const c = src[i];
        if (str) {
            out += c;
            if (esc) { esc = false; }
            else if (c === '\\') { esc = true; }
            else if (c === '"') { str = false; }
            i++;
            continue;
        }
        if (c === '"') { str = true; out += c; i++; continue; }
        if (c === '/' && src[i + 1] === '/') {
            while (i < src.length && src[i] !== '\n') { i++; }
            continue;
        }
        if (c === '/' && src[i + 1] === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { i++; }
            i += 2;
            continue;
        }
        out += c;
        i++;
    }
    let json = '';
    str = false;
    esc = false;
    for (let j = 0; j < out.length; j++) {
        const c = out[j];
        if (str) {
            json += c;
            if (esc) { esc = false; }
            else if (c === '\\') { esc = true; }
            else if (c === '"') { str = false; }
            continue;
        }
        if (c === '"') { str = true; json += c; continue; }
        if (c === ',') {
            let k = j + 1;
            while (k < out.length && /\s/.test(out[k])) { k++; }
            if (out[k] === '}' || out[k] === ']') { continue; }
        }
        json += c;
    }
    return JSON.parse(json);
}

interface ThemeFile {
    include?: string;
    name?: string;
    type?: string;
    colors?: Record<string, string>;
    tokenColors?: object[] | string;
    semanticTokenColors?: Record<string, string>;
}

function readTheme(file: string, seen = new Set<string>()): VsCodeTheme | undefined {
    console.log('readTheme', file);
    const abs = path.resolve(file);
    if (seen.has(abs) || abs.endsWith('.tmTheme')) { return; }
    seen.add(abs);
    let raw: ThemeFile;
    try {
        raw = parseJsonc(fs.readFileSync(abs, 'utf8')) as ThemeFile;
    } catch {
        return;
    }
    if (typeof raw.tokenColors === 'string') { return; }
    const theme: VsCodeTheme = {
        name: raw.name,
        type: raw.type,
        colors: raw.colors,
        tokenColors: raw.tokenColors,
        semanticTokenColors: raw.semanticTokenColors,
    };
    if (!raw.include) { return theme; }
    const parent = readTheme(path.resolve(path.dirname(abs), raw.include), seen);
    if (!parent) { return; }
    return mergeTheme(parent, theme);
}

// TextMate token colors only. Semantic token colors are not applied.
// Upgrade: map semantic tokens onto each side when that side has a URI.
function followedTheme(): (VsCodeTheme & { name: string; type: 'light' | 'dark' }) | undefined {
    const label = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme');
    if (!label) { return; }
    let file: string | undefined;
    let uiTheme: string | undefined;
    for (const ext of vscode.extensions.all) {
        const themes = ext.packageJSON?.contributes?.themes as { id?: string; label?: string; path?: string; uiTheme?: string }[] | undefined;
        const match = themes?.find(t => t.label === label || t.id === label);
        if (match?.path) {
            file = path.join(ext.extensionPath, match.path);
            uiTheme = match.uiTheme;
            break;
        }
    }
    if (!file) { return; }
    const theme = readTheme(file);
    if (!theme) { return; }
    const type = theme.type === 'light' || theme.type === 'dark' ? theme.type
        : uiTheme === 'vs' || uiTheme === 'hc-light' ? 'light' : 'dark';
    return { ...theme, name: label, type };
}

function shikiTheme(theme: string): { theme: string | (VsCodeTheme & { name: string; type: 'light' | 'dark' }); colorReplacements?: Record<string, string> } {
    if (theme === 'vscode') {
        const loaded = followedTheme();
        if (loaded) { return { theme: loaded }; }
        const kind = vscode.window.activeColorTheme.kind;
        const light = kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
        return { theme: light ? 'light-plus' : 'dark-plus' };
    }
    const spec = SHIKI_THEMES[theme] ?? SHIKI_THEMES.dark;
    return { theme: spec.name, colorReplacements: spec.colorReplacements };
}

async function syntaxColors(lines: string[], lang: string, theme: string): Promise<ColoredTok[][]> {
    const shiki = await import('shiki');
    const picked = shikiTheme(theme);
    lang = LANG_ALIASES[lang] ?? lang;
    const { tokens, fg } = await shiki.codeToTokens(lines.join('\n'), {
        lang: lang in shiki.bundledLanguages ? lang as keyof typeof shiki.bundledLanguages : 'text',
        theme: picked.theme,
        colorReplacements: picked.colorReplacements,
    } as Parameters<typeof shiki.codeToTokens>[1]);
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
