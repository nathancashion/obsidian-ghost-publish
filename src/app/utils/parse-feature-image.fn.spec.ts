import { test, expect, describe } from 'bun:test'
import { isExternalImageUrl, parseFeatureImageRef } from './parse-feature-image.fn'

describe('parseFeatureImageRef', () => {
    test('reads a plain string', () => {
        expect(parseFeatureImageRef('cover.jpg')).toBe('cover.jpg')
        expect(parseFeatureImageRef('  Attachments/cover.jpg  ')).toBe('Attachments/cover.jpg')
    })

    test('takes the first entry of a YAML list', () => {
        expect(parseFeatureImageRef(['first.jpg', 'second.jpg'])).toBe('first.jpg')
    })

    test('unwraps wikilinks and embeds, dropping aliases', () => {
        expect(parseFeatureImageRef('[[cover.jpg]]')).toBe('cover.jpg')
        expect(parseFeatureImageRef('![[cover.jpg]]')).toBe('cover.jpg')
        expect(parseFeatureImageRef('![[cover.jpg|A cover]]')).toBe('cover.jpg')
    })

    test('unwraps markdown images', () => {
        expect(parseFeatureImageRef('![A cover](cover.jpg)')).toBe('cover.jpg')
        expect(parseFeatureImageRef('![](https://example.com/x.jpg)')).toBe(
            'https://example.com/x.jpg'
        )
    })

    test('returns empty for unusable values', () => {
        expect(parseFeatureImageRef(undefined)).toBe('')
        expect(parseFeatureImageRef(null)).toBe('')
        expect(parseFeatureImageRef('')).toBe('')
        expect(parseFeatureImageRef('   ')).toBe('')
        expect(parseFeatureImageRef([])).toBe('')
        expect(parseFeatureImageRef([42])).toBe('')
        expect(parseFeatureImageRef({ path: 'cover.jpg' })).toBe('')
    })
})

describe('isExternalImageUrl', () => {
    test('detects absolute http(s) URLs', () => {
        expect(isExternalImageUrl('https://example.com/x.jpg')).toBe(true)
        expect(isExternalImageUrl('http://example.com/x.jpg')).toBe(true)
    })

    test('treats vault references as non-external', () => {
        expect(isExternalImageUrl('cover.jpg')).toBe(false)
        expect(isExternalImageUrl('Attachments/cover.jpg')).toBe(false)
    })
})
