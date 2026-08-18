import { escapeHtml } from '../utils/escape-html.fn'
import { preserveCiteBlockquotes } from '../utils/preserve-cite-blockquotes.fn'
import { promoteImagesToGhostCards } from '../utils/promote-images.fn'
import { parseMarkdownWithFootnotes } from './footnotes'

/**
 * Convert the processed markdown body into Ghost-ready HTML. When a
 * canonical URL is supplied, a short callout linking back to the public
 * mirror is prepended; otherwise the HTML is returned bare.
 */
export function buildPostHtml(markdown: string, title: string, canonicalUrl: string): string {
    const rendered = parseMarkdownWithFootnotes(markdown)
    const body = preserveCiteBlockquotes(promoteImagesToGhostCards(rendered))
    if (!canonicalUrl) return body

    const callout =
        `<p><em>Canonical version: ` +
        `<a href="${canonicalUrl}">${escapeHtml(title)}</a>.</em></p>\n\n`
    return callout + body
}
