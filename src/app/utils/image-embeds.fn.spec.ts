import { describe, expect, it } from 'bun:test'
import {
    buildImageMarkup,
    captionToAltText,
    isDimensionAlias,
    isExternalUrl,
    normalizeVaultImagePath,
    occupiesOwnLine,
    parseEmbedInner,
    renderCaptionHtml
} from './image-embeds.fn'

describe('parseEmbedInner', () => {
    it('returns a null alias when there is no pipe', () => {
        expect(parseEmbedInner('cat.png')).toEqual({ target: 'cat.png', alias: null })
    })

    it('splits on the first pipe only, so captions may contain pipes', () => {
        expect(parseEmbedInner('cat.png|a | b | c')).toEqual({
            target: 'cat.png',
            alias: 'a | b | c'
        })
    })

    it('trims around the separator', () => {
        expect(parseEmbedInner(' cat.png | A caption ')).toEqual({
            target: 'cat.png',
            alias: 'A caption'
        })
    })
})

describe('isDimensionAlias', () => {
    it('treats bare numbers and NxN as size hints', () => {
        expect(isDimensionAlias('300')).toBe(true)
        expect(isDimensionAlias('640x480')).toBe(true)
    })

    it('treats prose as a caption', () => {
        expect(isDimensionAlias('Figure 1')).toBe(false)
        expect(isDimensionAlias('300 dpi')).toBe(false)
    })
})

describe('isExternalUrl', () => {
    it('detects protocols and protocol-relative URLs', () => {
        expect(isExternalUrl('https://example.com/a.png')).toBe(true)
        expect(isExternalUrl('data:image/png;base64,AAA')).toBe(true)
        expect(isExternalUrl('//cdn.example.com/a.png')).toBe(true)
    })

    it('treats vault paths as local', () => {
        expect(isExternalUrl('attachments/a.png')).toBe(false)
        expect(isExternalUrl('a.png')).toBe(false)
    })
})

describe('normalizeVaultImagePath', () => {
    it('decodes percent-encoding', () => {
        expect(normalizeVaultImagePath('My%20Image.png')).toBe('My Image.png')
    })

    it('unwraps angle brackets', () => {
        expect(normalizeVaultImagePath('<My Image.png>')).toBe('My Image.png')
    })

    it('leaves malformed encoding alone rather than throwing', () => {
        expect(normalizeVaultImagePath('100%.png')).toBe('100%.png')
    })
})

describe('renderCaptionHtml', () => {
    it('converts markdown links, which plain figcaption content would not', () => {
        expect(renderCaptionHtml('Figure 1 from [O’Bryan et al.](https://ex.com/p)')).toBe(
            'Figure 1 from <a href="https://ex.com/p">O’Bryan et al.</a>'
        )
    })

    it('passes author-written inline HTML through', () => {
        expect(renderCaptionHtml('See <a href="https://ex.com">source</a>')).toBe(
            'See <a href="https://ex.com">source</a>'
        )
    })

    it('does not wrap the result in a paragraph', () => {
        expect(renderCaptionHtml('Just text')).toBe('Just text')
    })
})

describe('captionToAltText', () => {
    it('reduces a markdown link to its text', () => {
        expect(captionToAltText('Figure 1 from [O’Bryan et al.](https://ex.com/p)')).toBe(
            'Figure 1 from O’Bryan et al.'
        )
    })

    it('strips inline HTML and emphasis markers', () => {
        expect(captionToAltText('A **bold** <em>claim</em>')).toBe('A bold claim')
    })
})

describe('buildImageMarkup', () => {
    it('emits plain markdown when there is no caption', () => {
        expect(buildImageMarkup('https://g.io/a.png', 'a cat', '')).toBe(
            '![a cat](https://g.io/a.png)'
        )
    })

    it('emits a Ghost image card with a figcaption when captioned', () => {
        expect(buildImageMarkup('https://g.io/a.png', 'a cat', 'A <em>cat</em>')).toBe(
            '<figure class="kg-card kg-image-card kg-card-hascaption">' +
                '<img src="https://g.io/a.png" alt="a cat">' +
                '<figcaption>A <em>cat</em></figcaption>' +
                '</figure>'
        )
    })

    it('escapes the alt attribute', () => {
        expect(buildImageMarkup('https://g.io/a.png', 'a "quoted" cat', 'x')).toContain(
            'alt="a &quot;quoted&quot; cat"'
        )
    })
})

describe('occupiesOwnLine', () => {
    const probe = (source: string, needle: string): boolean =>
        occupiesOwnLine(source, source.indexOf(needle), needle.length)

    it('is true for a match alone on its line', () => {
        expect(probe('before\n![[a.png]]\nafter', '![[a.png]]')).toBe(true)
    })

    it('is true at the very start and end of the source', () => {
        expect(probe('![[a.png]]', '![[a.png]]')).toBe(true)
    })

    it('tolerates surrounding whitespace', () => {
        expect(probe('x\n   ![[a.png]]  \ny', '![[a.png]]')).toBe(true)
    })

    it('is false mid-paragraph', () => {
        expect(probe('see ![[a.png]] here', '![[a.png]]')).toBe(false)
    })
})
