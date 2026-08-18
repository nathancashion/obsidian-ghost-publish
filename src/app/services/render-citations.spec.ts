import { test, expect, describe } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    buildPandocArgs,
    citationConfigFingerprint,
    convertReferencesDiv,
    hasCitations,
    renderCitations,
    resolveConfigPath,
    resolvePandocBinary
} from './render-citations'
import { parseMarkdownWithFootnotes } from './footnotes'

describe('hasCitations', () => {
    test('detects bracketed citations', () => {
        expect(hasCitations('As shown.[@doe2020]')).toBe(true)
        expect(hasCitations('Suppressed author.[-@doe2020]')).toBe(true)
        expect(hasCitations('Complex.[see @doe2020, p. 3; also @roe2019]')).toBe(true)
    })

    test('detects bare in-text citations', () => {
        expect(hasCitations('@doe2020 showed this first.')).toBe(true)
        expect(hasCitations('As @hayGlobalRegionalNational2026 report…')).toBe(true)
        expect(hasCitations('(@doe2020 agrees.)')).toBe(true)
    })

    test('escaped mentions still trigger processing (pandoc strips the escape)', () => {
        expect(hasCitations('Ping \\@handle about this.')).toBe(true)
    })

    test('ignores prose without citations', () => {
        expect(hasCitations('Plain text with a [link](https://example.com).')).toBe(false)
        expect(hasCitations('A footnote.[^1]\n\n[^1]: Body.')).toBe(false)
        expect(hasCitations('Mail me at first.last@example.com today.')).toBe(false)
        expect(hasCitations('')).toBe(false)
    })
})

describe('resolveConfigPath', () => {
    test('keeps absolute paths', () => {
        expect(resolveConfigPath('/vault', '/refs/library.bib')).toBe('/refs/library.bib')
    })

    test('expands ~/ to the home directory', () => {
        expect(resolveConfigPath('/vault', '~/refs/library.bib')).toBe(
            join(homedir(), 'refs/library.bib')
        )
    })

    test('resolves relative paths against the vault base', () => {
        expect(resolveConfigPath('/vault', 'refs/library.bib')).toBe('/vault/refs/library.bib')
    })

    test('passes relative paths through when no vault base is known', () => {
        expect(resolveConfigPath('', 'refs/library.bib')).toBe('refs/library.bib')
    })

    test('empty input stays empty', () => {
        expect(resolveConfigPath('/vault', '  ')).toBe('')
    })
})

describe('citationConfigFingerprint', () => {
    const settings = { pandocPath: 'pandoc', bibliographyPath: '~/lib.bib', cslPath: '~/note.csl' }

    test('empty when citations are disabled (preserves existing hashes)', () => {
        expect(citationConfigFingerprint(false, settings)).toBe('')
    })

    test('changes when any configured path changes', () => {
        const base = citationConfigFingerprint(true, settings)
        expect(base).not.toBe('')
        expect(
            citationConfigFingerprint(true, { ...settings, bibliographyPath: '~/other.bib' })
        ).not.toBe(base)
        expect(citationConfigFingerprint(true, { ...settings, cslPath: '~/other.csl' })).not.toBe(
            base
        )
        expect(
            citationConfigFingerprint(true, { ...settings, pandocPath: '/usr/bin/pandoc' })
        ).not.toBe(base)
        expect(citationConfigFingerprint(true, { ...settings })).toBe(base)
    })
})

describe('resolvePandocBinary', () => {
    test('uses explicit paths as-is, with ~/ expansion', () => {
        expect(resolvePandocBinary('/opt/homebrew/bin/pandoc')).toBe('/opt/homebrew/bin/pandoc')
        expect(resolvePandocBinary('~/bin/pandoc')).toBe(join(homedir(), 'bin/pandoc'))
    })

    test('resolves a bare command against PATH-like directories', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gp-bin-'))
        writeFileSync(join(dir, 'pandoc'), '#!/bin/sh\n')
        expect(resolvePandocBinary('pandoc', dir)).toBe(join(dir, 'pandoc'))
    })

    test('falls back to the bare command when nowhere to be found', () => {
        expect(resolvePandocBinary('definitely-not-a-real-binary', '/nonexistent-dir')).toBe(
            'definitely-not-a-real-binary'
        )
    })
})

describe('buildPandocArgs', () => {
    test('builds a citeproc markdown round trip with linked citations', () => {
        const args = buildPandocArgs('/refs/library.bib', '')
        expect(args).toContain('--citeproc')
        expect(args).toContain('--bibliography=/refs/library.bib')
        // Typography must survive untouched in both directions.
        expect(args).toContain('--from=markdown-smart')
        // Citations must link to their References entries for the theme's
        // hover popovers; the bibliography is rendered, not suppressed.
        expect(args).toContain('--metadata=link-citations:true')
        expect(args.some((a) => a.includes('suppress-bibliography'))).toBe(false)
        // Writer keeps fenced_divs (the refs div is parsed downstream) but
        // must not emit bracketed spans (marked renders []{.class}
        // literally) nor raw attributes (they turn author-written inline
        // HTML like <cite> into literal `<cite>`{=html} code).
        expect(args).toContain('--to=markdown-bracketed_spans-raw_attribute-smart')
        expect(args.some((a) => a.startsWith('--csl='))).toBe(false)
    })

    test('adds the CSL style only when configured', () => {
        const args = buildPandocArgs('/refs/library.bib', '/styles/vancouver.csl')
        expect(args).toContain('--csl=/styles/vancouver.csl')
    })
})

describe('convertReferencesDiv', () => {
    const PANDOC_OUTPUT = [
        'Prose with a citation ([Doe 2020](#ref-doe2020)).',
        '',
        '::: {#refs .references .csl-bib-body .hanging-indent}',
        '::: {#ref-doe2020 .csl-entry}',
        'Doe J. 2020. *A Fine Paper*. [https://doi.org/x](https://doi.org/x)',
        ':::',
        '',
        '::: {#ref-roe2019 .csl-entry}',
        'Roe R. 2019. Another Paper.',
        ':::',
        ':::'
    ].join('\n')

    test('replaces the refs div with an html-card References section', () => {
        const out = convertReferencesDiv(PANDOC_OUTPUT)
        expect(out).toContain('<!--kg-card-begin: html-->')
        expect(out).toContain('<section class="references" id="refs" data-references>')
        expect(out).toContain('<h2>References</h2>')
        expect(out).toContain('<div class="csl-entry" id="ref-doe2020">')
        expect(out).toContain('<div class="csl-entry" id="ref-roe2019">')
        // Entry markdown is rendered (italics, links)…
        expect(out).toContain('<em>A Fine Paper</em>')
        expect(out).toContain('<a href="https://doi.org/x">')
        // …no fenced-div syntax leaks…
        expect(out).not.toContain(':::')
        // …and the prose (with its citation link) is untouched.
        expect(out).toContain('Prose with a citation ([Doe 2020](#ref-doe2020)).')
    })

    test('passes markdown without a refs div through unchanged', () => {
        const md = 'Plain prose.\n\n> A quote.\n'
        expect(convertReferencesDiv(md)).toBe(md)
    })
})

describe('renderCitations', () => {
    /** Await a promise that must reject; returns the rejection as an Error. */
    async function captureRejection(promise: Promise<unknown>): Promise<Error> {
        try {
            await promise
        } catch (e) {
            return e instanceof Error ? e : new Error(String(e))
        }
        throw new Error('expected promise to reject')
    }

    test('fails fast without a bibliography', async () => {
        const error = await captureRejection(
            renderCitations('Text.[@key]', {
                pandocPath: 'pandoc',
                bibliographyPath: '',
                cslPath: '',
                vaultBasePath: '/vault'
            })
        )
        expect(error.message).toMatch(/no bibliography file is configured/)
    })

    const pandocAvailable = (() => {
        try {
            return spawnSync('pandoc', ['--version']).status === 0
        } catch {
            return false
        }
    })()

    const BIB = `@article{doe2020,
  author  = {Doe, Jane},
  title   = {A Fine Paper},
  journal = {Journal of Tests},
  year    = {2020}
}
`

    test.skipIf(!pandocAvailable)(
        'renders citations inline with a linked References section',
        async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gp-citations-'))
            writeFileSync(join(dir, 'library.bib'), BIB)

            // pandoc default style: chicago author-date, inline.
            const out = await renderCitations('Bare cite: @doe2020 says so. Bracketed.[@doe2020]', {
                pandocPath: 'pandoc',
                bibliographyPath: 'library.bib',
                cslPath: '',
                vaultBasePath: dir
            })

            // Citations render inline (author-date) and link to the entry…
            expect(out).toContain('](#ref-doe2020)')
            expect(out).not.toContain('[^1]')
            // …the References section is an html card with the entry id…
            expect(out).toContain('<!--kg-card-begin: html-->')
            expect(out).toContain('<div class="csl-entry" id="ref-doe2020">')
            expect(out).toMatch(/a fine paper/i)
            // …and no fenced-div syntax leaks through.
            expect(out).not.toContain(':::')

            // The downstream footnote renderer must pass the raw-HTML
            // References section through to the final post untouched.
            const html = parseMarkdownWithFootnotes(out)
            expect(html).toContain('<section class="references" id="refs" data-references>')
            expect(html).toContain('<div class="csl-entry" id="ref-doe2020">')
            expect(html).toContain('<!--kg-card-begin: html-->')
        }
    )

    test.skipIf(!pandocAvailable)(
        'passes author-written inline HTML through verbatim',
        async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gp-citations-'))
            writeFileSync(join(dir, 'library.bib'), BIB)

            const out = await renderCitations(
                '> A quoted claim.[@doe2020] “Curly” too.\n> <cite>— Jane Doe</cite>',
                {
                    pandocPath: 'pandoc',
                    bibliographyPath: 'library.bib',
                    cslPath: '',
                    vaultBasePath: dir
                }
            )

            expect(out).toContain('<cite>— Jane Doe</cite>')
            // No raw_attribute markers, which marked renders as literal code.
            expect(out).not.toContain('{=html}')
            // Typography survives: no ASCII-ization of em dashes / quotes.
            expect(out).toContain('“Curly”')
            expect(out).not.toContain('---')
        }
    )

    test.skipIf(!pandocAvailable)('reports unresolvable pandoc failures', async () => {
        const error = await captureRejection(
            renderCitations('Text.[@key]', {
                pandocPath: 'pandoc',
                bibliographyPath: '/nonexistent/library.bib',
                cslPath: '',
                vaultBasePath: ''
            })
        )
        expect(error.message).toMatch(/pandoc failed/)
    })

    test('reports a missing pandoc binary with an actionable message', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gp-citations-'))
        writeFileSync(join(dir, 'library.bib'), BIB)
        const error = await captureRejection(
            renderCitations('Text.[@key]', {
                pandocPath: '/nonexistent/pandoc-binary',
                bibliographyPath: 'library.bib',
                cslPath: '',
                vaultBasePath: dir
            })
        )
        expect(error.message).toMatch(/pandoc not found/)
    })
})
