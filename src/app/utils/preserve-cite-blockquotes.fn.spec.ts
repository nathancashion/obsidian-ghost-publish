import { test, expect, describe } from 'bun:test'
import { preserveCiteBlockquotes } from './preserve-cite-blockquotes.fn'

describe('preserveCiteBlockquotes', () => {
    test('wraps a blockquote carrying a cite attribution', () => {
        const html = '<blockquote><p>Quoted.\n<cite>— Karim Khan</cite></p></blockquote>'
        const out = preserveCiteBlockquotes(html)
        expect(out).toBe(
            '<!--kg-card-begin: html-->\n' +
                '<blockquote><p>Quoted.\n<cite>— Karim Khan</cite></p></blockquote>\n' +
                '<!--kg-card-end: html-->'
        )
    })

    test('leaves plain blockquotes as native Ghost quote cards', () => {
        const html = '<blockquote><p>Just a quote.</p></blockquote>'
        expect(preserveCiteBlockquotes(html)).toBe(html)
    })

    test('is a no-op for html without cite tags', () => {
        const html = '<p>Body text.</p>\n<blockquote><p>Quote.</p></blockquote>'
        expect(preserveCiteBlockquotes(html)).toBe(html)
    })

    test('keeps surrounding content and wraps only the cited quote', () => {
        const html =
            '<p>Before.</p>\n' +
            '<blockquote><p>Plain.</p></blockquote>\n' +
            '<blockquote><p>Cited.<cite>Author</cite></p></blockquote>\n' +
            '<p>After.</p>'
        const out = preserveCiteBlockquotes(html)
        expect(out).toContain('<p>Before.</p>')
        expect(out).toContain('<p>After.</p>')
        expect(out).toContain('<blockquote><p>Plain.</p></blockquote>')
        expect((out.match(/<!--kg-card-begin: html-->/g) ?? []).length).toBe(1)
        expect(out).toContain(
            '<!--kg-card-begin: html-->\n<blockquote><p>Cited.<cite>Author</cite></p></blockquote>\n<!--kg-card-end: html-->'
        )
    })

    test('handles nested blockquotes as one card', () => {
        const html =
            '<blockquote><p>Outer.</p><blockquote><p>Inner.<cite>Author</cite></p></blockquote></blockquote>'
        const out = preserveCiteBlockquotes(html)
        expect((out.match(/<!--kg-card-begin: html-->/g) ?? []).length).toBe(1)
        expect(out.startsWith('<!--kg-card-begin: html-->')).toBe(true)
        expect(out.trimEnd().endsWith('<!--kg-card-end: html-->')).toBe(true)
    })

    test('never nests markers inside an existing html card', () => {
        // The footnotes / References sections already ship as html cards and
        // may contain cited quotes; re-wrapping would corrupt the card.
        const html =
            '<!--kg-card-begin: html-->\n' +
            '<section class="footnotes"><ol><li id="fn-1"><blockquote><p>Q.<cite>A</cite></p></blockquote></li></ol></section>\n' +
            '<!--kg-card-end: html-->'
        expect(preserveCiteBlockquotes(html)).toBe(html)
    })
})
