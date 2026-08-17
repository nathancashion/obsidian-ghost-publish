import { test, expect, describe } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    buildPandocArgs,
    citationConfigFingerprint,
    hasCitations,
    renderCitations,
    resolveConfigPath,
    resolvePandocBinary
} from './render-citations'

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
    test('builds a citeproc markdown round trip with the bibliography', () => {
        const args = buildPandocArgs('/refs/library.bib', '')
        expect(args).toContain('--citeproc')
        expect(args).toContain('--bibliography=/refs/library.bib')
        expect(args).toContain('--from=markdown')
        // Writer must not emit fenced divs / bracketed spans — marked would
        // render the ::: and []{.class} syntax literally.
        expect(args).toContain('--to=markdown-fenced_divs-bracketed_spans')
        expect(args.some((a) => a.startsWith('--csl='))).toBe(false)
    })

    test('adds the CSL style only when configured', () => {
        const args = buildPandocArgs('/refs/library.bib', '/styles/note.csl')
        expect(args).toContain('--csl=/styles/note.csl')
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

    // A minimal CSL note-class style: citations render as footnotes whose
    // text is the entry title. Mirrors the real setup (Chicago full note)
    // closely enough to prove the citation → footnote → pipeline handoff.
    const NOTE_CSL = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="note" version="1.0">
  <info>
    <title>Test note style</title>
    <id>test-note-style</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation>
    <layout><text variable="title"/></layout>
  </citation>
  <bibliography>
    <layout><text variable="title"/></layout>
  </bibliography>
</style>
`

    const BIB = `@article{doe2020,
  author  = {Doe, Jane},
  title   = {A Fine Paper},
  journal = {Journal of Tests},
  year    = {2020}
}
`

    test.skipIf(!pandocAvailable)(
        'renders bracketed citations as footnotes via a note-class style',
        async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gp-citations-'))
            writeFileSync(join(dir, 'library.bib'), BIB)
            writeFileSync(join(dir, 'note.csl'), NOTE_CSL)

            const out = await renderCitations('A cited claim.[@doe2020]', {
                pandocPath: 'pandoc',
                bibliographyPath: 'library.bib',
                cslPath: 'note.csl',
                vaultBasePath: dir
            })

            // Citation became a markdown footnote carrying the citation text
            // (pandoc sentence-cases unprotected BibTeX titles)…
            expect(out).toContain('[^1]')
            expect(out).toMatch(/a fine paper/i)
            // …the body text survived…
            expect(out).toContain('A cited claim.')
            // …and the bibliography section was suppressed (title appears
            // once, in the footnote — not a second time in a refs section).
            expect(out.match(/a fine paper/gi)?.length).toBe(1)
            expect(out).not.toContain(':::')
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
