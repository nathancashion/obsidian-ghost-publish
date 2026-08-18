import { test, expect, describe } from 'bun:test'
import { processCallouts } from './process-callouts.fn'

describe('processCallouts', () => {
    test('converts a titled callout to an html-card block', () => {
        const md = ['> [!question] Research Question', '> **What can we learn?**'].join('\n')
        const out = processCallouts(md)

        expect(out).toContain('<!--kg-card-begin: html-->')
        expect(out).toContain('<div class="callout callout-question" data-callout="question">')
        expect(out).toContain('<div class="callout-title">')
        expect(out).toContain('Research Question')
        expect(out).toContain('<div class="callout-content">')
        // Body stays markdown so the downstream parse still renders it.
        expect(out).toContain('**What can we learn?**')
        expect(out).toContain('<!--kg-card-end: html-->')
        expect(out).not.toContain('[!question]')
    })

    test('falls back to the type name when no title is given', () => {
        const out = processCallouts('> [!note]\n> Body.')
        expect(out).toContain('Note')
        expect(out).toContain('callout-note')
    })

    test('resolves aliases to canonical types but keeps the raw name', () => {
        const faq = processCallouts('> [!faq]\n> Body.')
        expect(faq).toContain('class="callout callout-question"')
        expect(faq).toContain('data-callout="faq"')
        expect(faq).toContain('FAQ')

        expect(processCallouts('> [!cite]\n> Body.')).toContain('callout-quote')
        expect(processCallouts('> [!error]\n> Body.')).toContain('callout-danger')
        expect(processCallouts('> [!tldr]\n> Body.')).toContain('TL;DR')
    })

    test('passes unknown types through for theme styling', () => {
        const out = processCallouts('> [!synth] Synthesis\n> Body.')
        expect(out).toContain('class="callout callout-synth"')
        expect(out).toContain('data-callout="synth"')
        expect(out).toContain('Synthesis')
    })

    test('renders foldable callouts as details elements', () => {
        const collapsed = processCallouts('> [!note]- Hidden\n> Body.')
        expect(collapsed).toContain('<details class="callout callout-note" data-callout="note">')
        expect(collapsed).toContain('<summary class="callout-title">')
        expect(collapsed).toContain('</details>')
        expect(collapsed).not.toContain(' open>')

        const expanded = processCallouts('> [!note]+ Shown\n> Body.')
        expect(expanded).toContain('data-callout="note" open>')
    })

    test('supports title-only callouts', () => {
        const out = processCallouts('> [!warning] Careful')
        expect(out).toContain('Careful')
        expect(out).not.toContain('callout-content')
    })

    test('handles nested callouts', () => {
        const md = ['> [!note] Outer', '> Outer body.', '> > [!tip] Inner', '> > Inner body.'].join(
            '\n'
        )
        const out = processCallouts(md)
        expect(out).toContain('callout-note')
        expect(out).toContain('callout-tip')
        expect(out).toContain('Inner body.')
        expect(out).not.toContain('[!tip]')
    })

    test('leaves ordinary blockquotes untouched', () => {
        const md = '> A normal quote.\n> <cite>— Someone</cite>'
        expect(processCallouts(md)).toBe(md)
    })

    test('keeps surrounding content and separates the block with blank lines', () => {
        const md = ['Before.', '> [!info] Heads up', '> Body.', 'After.'].join('\n')
        const out = processCallouts(md)
        const lines = out.split('\n')

        expect(lines[0]).toBe('Before.')
        expect(lines[1]).toBe('')
        expect(out).toContain('After.')
        expect(out.indexOf('After.')).toBeGreaterThan(out.indexOf('<!--kg-card-end: html-->'))
        // A blank line must precede the trailing prose too.
        expect(out).toContain('<!--kg-card-end: html-->\n\nAfter.')
    })

    test('is a no-op for markdown without callouts', () => {
        const md = 'Plain text with [a link](https://x.com) and an image ![](y.png).'
        expect(processCallouts(md)).toBe(md)
    })
})
