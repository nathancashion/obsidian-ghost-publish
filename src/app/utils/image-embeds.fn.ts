import { marked } from 'marked'
import { escapeHtml } from './escape-html.fn'

/** Vanilla Obsidian treats a numeric embed alias as a size hint, not a caption. */
const DIMENSION_ALIAS_RE = /^\d+(?:x\d+)?$/

/** Protocol-ish prefixes that must never be resolved against the vault. */
const EXTERNAL_URL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

export interface ParsedEmbed {
    target: string
    /** Text after the first `|`, or null when the embed carries no alias. */
    alias: string | null
}

/**
 * Split an embed's inner text on its **first** `|` only. Everything after it
 * is the alias, which may itself contain `|` (link titles, inline tables).
 */
export function parseEmbedInner(inner: string): ParsedEmbed {
    const idx = inner.indexOf('|')
    if (idx === -1) return { target: inner.trim(), alias: null }
    return { target: inner.slice(0, idx).trim(), alias: inner.slice(idx + 1).trim() }
}

/** `300` / `640x480` — a width/height hint, which is not a caption. */
export function isDimensionAlias(alias: string): boolean {
    return DIMENSION_ALIAS_RE.test(alias)
}

export function isExternalUrl(target: string): boolean {
    return EXTERNAL_URL_RE.test(target)
}

/**
 * Strip the `<…>` wrapper and percent-encoding Obsidian writes into markdown
 * link targets, yielding a path that `getFirstLinkpathDest` can resolve.
 */
export function normalizeVaultImagePath(target: string): string {
    const unwrapped = target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target
    try {
        return decodeURIComponent(unwrapped)
    } catch {
        return unwrapped
    }
}

/**
 * Render caption markdown to inline HTML. Captions routinely carry links and
 * emphasis, and `<figcaption>` content is never markdown-processed downstream,
 * so it has to be converted here. Author-written inline HTML passes through.
 */
export function renderCaptionHtml(caption: string): string {
    return marked.parseInline(caption, { async: false }).trim()
}

/** Plain-text reduction of a caption, for the `alt` attribute. */
export function captionToAltText(caption: string): string {
    return caption
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/[*_`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * Ghost-ready markup for one image.
 *
 * With a caption, emits the same `figure > img + figcaption` shape Ghost's own
 * renderer produces, which its HTML importer parses straight back into a native
 * (still editable) image card carrying the caption. Without one, plain markdown
 * is emitted and `promoteImagesToGhostCards` cards it later.
 */
export function buildImageMarkup(url: string, alt: string, captionHtml: string): string {
    if (!captionHtml) return `![${alt}](${url})`
    const cls = 'kg-card kg-image-card kg-card-hascaption'
    return (
        `<figure class="${cls}">` +
        `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">` +
        `<figcaption>${captionHtml}</figcaption>` +
        `</figure>`
    )
}

/**
 * True when the match at `offset` sits alone on its line. A `<figure>` is a
 * block element: emitting one mid-paragraph would split the paragraph, so
 * inline embeds keep the markdown form instead.
 */
export function occupiesOwnLine(source: string, offset: number, length: number): boolean {
    const before = source.slice(0, offset)
    const after = source.slice(offset + length)
    return /(?:^|\n)[ \t]*$/.test(before) && /^[ \t]*(?:\n|$)/.test(after)
}
