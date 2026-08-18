/**
 * Wrap blockquotes containing `<cite>` in Ghost html-card markers.
 *
 * Ghost's `source=html` importer converts blockquotes into lexical quote
 * nodes, whose inline formats cover bold/italic/etc. but not `<cite>` —
 * the tag is silently dropped and the attribution renders as plain text.
 * Wrapping the blockquote in `<!--kg-card-begin: html-->` markers makes
 * the importer store it verbatim (same mechanism as the footnotes and
 * References sections), so the semantic tag and its theme styling survive.
 *
 * Only blockquotes that actually use `<cite>` are wrapped; everything
 * else stays a native Ghost quote card (editable in Ghost Admin).
 */

const CARD_BEGIN = '<!--kg-card-begin: html-->'
const CARD_END = '<!--kg-card-end: html-->'

/** Wrap `<cite>`-bearing blockquotes outside existing html cards. */
export function preserveCiteBlockquotes(html: string): string {
    if (!html.includes('<cite')) return html

    let out = ''
    let pos = 0

    // Content already inside an html card is copied verbatim: re-wrapping
    // it would nest card markers and corrupt the card.
    while (pos < html.length) {
        const cardStart = html.indexOf(CARD_BEGIN, pos)
        if (cardStart === -1) {
            out += wrapOutsideCards(html.slice(pos))
            break
        }
        out += wrapOutsideCards(html.slice(pos, cardStart))
        const cardEnd = html.indexOf(CARD_END, cardStart)
        if (cardEnd === -1) {
            out += html.slice(cardStart)
            break
        }
        out += html.slice(cardStart, cardEnd + CARD_END.length)
        pos = cardEnd + CARD_END.length
    }

    return out
}

/** Wrap every top-level `<cite>`-bearing blockquote in `segment`. */
function wrapOutsideCards(segment: string): string {
    if (!segment.includes('<cite')) return segment

    let out = ''
    let pos = 0

    for (;;) {
        const start = segment.indexOf('<blockquote', pos)
        if (start === -1) {
            out += segment.slice(pos)
            break
        }
        const end = findBlockquoteEnd(segment, start)
        if (end === -1) {
            out += segment.slice(pos)
            break
        }
        const block = segment.slice(start, end)
        out += segment.slice(pos, start)
        out += block.includes('<cite') ? `${CARD_BEGIN}\n${block}\n${CARD_END}` : block
        pos = end
    }

    return out
}

/**
 * Index just past the `</blockquote>` matching the tag at `start`,
 * accounting for nested blockquotes. Returns -1 when unterminated.
 */
function findBlockquoteEnd(html: string, start: number): number {
    const OPEN = /<blockquote[\s>]/g
    const CLOSE = /<\/blockquote\s*>/g
    let depth = 0
    let cursor = start

    for (;;) {
        OPEN.lastIndex = cursor
        CLOSE.lastIndex = cursor
        const open = OPEN.exec(html)
        const close = CLOSE.exec(html)
        if (!close) return -1

        if (open && open.index < close.index) {
            depth++
            cursor = open.index + open[0].length
            continue
        }
        depth--
        cursor = close.index + close[0].length
        if (depth === 0) return cursor
    }
}
