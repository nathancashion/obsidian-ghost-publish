/**
 * Convert Obsidian callouts to HTML Ghost can publish.
 *
 * Obsidian writes callouts as blockquotes with a type marker:
 *
 * ```
 * > [!question] Optional title
 * > Body **markdown**.
 * ```
 *
 * Ghost has no equivalent, so the marker would publish literally. Each
 * callout becomes a semantic `<div class="callout callout-<type>">`
 * wrapped in kg html-card markers (ids and structure survive Ghost's
 * importer that way — same mechanism as footnotes and References).
 *
 * The body is left as **markdown** between blank lines inside the HTML
 * block: both pandoc and `marked` parse markdown in that position, so
 * citations, footnotes, images, and nested callouts inside a callout all
 * still work. This is why the conversion runs early in the pipeline,
 * before the citation step.
 *
 * Foldable callouts (`[!type]-` / `[!type]+`) become `<details>` /
 * `<details open>`, which degrades gracefully without JavaScript.
 */

/** Alias → canonical type, following Obsidian's built-in callout set. */
const TYPE_ALIASES: Record<string, string> = {
    summary: 'abstract',
    tldr: 'abstract',
    hint: 'tip',
    important: 'tip',
    check: 'success',
    done: 'success',
    help: 'question',
    faq: 'question',
    caution: 'warning',
    attention: 'warning',
    fail: 'failure',
    missing: 'failure',
    error: 'danger',
    cite: 'quote'
}

/** Display titles for canonical types whose capitalized name reads oddly. */
const TYPE_TITLES: Record<string, string> = {
    tldr: 'TL;DR',
    faq: 'FAQ',
    todo: 'To do'
}

const CALLOUT_OPEN_RE = /^ {0,3}> ?\[!([A-Za-z0-9_-]+)\]([+-])?[ \t]*(.*)$/
const QUOTE_LINE_RE = /^ {0,3}>/

interface Callout {
    /** Raw type as written, lower-cased (`faq`, `synth`, …). */
    rawType: string
    /** Canonical type after alias resolution — drives styling. */
    type: string
    /** Title markdown; falls back to the type's display name. */
    title: string
    /** Body markdown with one blockquote level stripped. */
    body: string
    /** `-` collapsed, `+` expanded, `''` not foldable. */
    fold: string
}

/** Title Obsidian shows when a callout declares no title of its own. */
function defaultTitle(rawType: string, type: string): string {
    const known = TYPE_TITLES[rawType] ?? TYPE_TITLES[type]
    if (known) return known
    return rawType.charAt(0).toUpperCase() + rawType.slice(1)
}

/** Strip one blockquote level (`> `) from a line. */
function stripQuote(line: string): string {
    return line.replace(/^ {0,3}> ?/, '')
}

/**
 * Parse the callout starting at `lines[start]`. Returns the callout and
 * the index just past its last line, or `undefined` when the line does
 * not open a callout.
 */
function parseCallout(
    lines: string[],
    start: number
): { callout: Callout; end: number } | undefined {
    const open = CALLOUT_OPEN_RE.exec(lines[start] ?? '')
    if (!open) return undefined

    const rawType = (open[1] ?? '').toLowerCase()
    const fold = open[2] ?? ''
    const title = (open[3] ?? '').trim()

    let end = start + 1
    const bodyLines: string[] = []
    while (end < lines.length && QUOTE_LINE_RE.test(lines[end] ?? '')) {
        bodyLines.push(stripQuote(lines[end] ?? ''))
        end++
    }

    const type = TYPE_ALIASES[rawType] ?? rawType
    return {
        callout: {
            rawType,
            type,
            title: title || defaultTitle(rawType, type),
            body: bodyLines.join('\n').trim(),
            fold
        },
        end
    }
}

/** Render one callout to an html-card-wrapped HTML block. */
function renderCallout(callout: Callout): string {
    const { type, rawType, title, body, fold } = callout
    const classes = `callout callout-${type}`
    const attrs = `class="${classes}" data-callout="${rawType}"`

    const wrapperOpen = fold ? `<details ${attrs}${fold === '+' ? ' open' : ''}>` : `<div ${attrs}>`
    const wrapperClose = fold ? '</details>' : '</div>'
    const titleTag = fold ? 'summary' : 'div'

    const parts = [
        '<!--kg-card-begin: html-->',
        wrapperOpen,
        `<${titleTag} class="callout-title">`,
        '',
        title,
        '',
        `</${titleTag}>`
    ]
    if (body) {
        parts.push('<div class="callout-content">', '', processCallouts(body), '', '</div>')
    }
    parts.push(wrapperClose, '<!--kg-card-end: html-->')
    return parts.join('\n')
}

/**
 * Replace every Obsidian callout in `markdown` with its HTML equivalent.
 * Nested callouts are handled by recursing into each body. Ordinary
 * blockquotes are left untouched.
 */
export function processCallouts(markdown: string): string {
    if (!markdown.includes('[!')) return markdown

    const lines = markdown.split('\n')
    const out: string[] = []
    let i = 0

    while (i < lines.length) {
        const parsed = parseCallout(lines, i)
        if (!parsed) {
            out.push(lines[i] ?? '')
            i++
            continue
        }
        // Blank lines around the block keep it a standalone HTML block for
        // both pandoc and marked; without them it can fuse with neighbours.
        if (out.length > 0 && (out[out.length - 1] ?? '').trim() !== '') out.push('')
        out.push(renderCallout(parsed.callout))
        if (parsed.end < lines.length && (lines[parsed.end] ?? '').trim() !== '') out.push('')
        i = parsed.end
    }

    return out.join('\n')
}
