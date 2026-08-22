import { describe, expect, it } from 'bun:test'
import { TFile } from 'obsidian'
import type { App } from 'obsidian'
import type { GhostApiClient } from '../api/ghost-api-client'
import { uploadVaultImages } from './upload-vault-images'

const GHOST = 'https://blog.example.com/content/images'

/**
 * Vault stub: every name in `present` resolves to a TFile and uploads to a
 * predictable Ghost URL. Anything else resolves to null, as a missing
 * attachment would.
 */
function harness(present: string[]): { app: App; client: GhostApiClient; uploaded: string[] } {
    const uploaded: string[] = []
    const app = {
        metadataCache: {
            getFirstLinkpathDest: (link: string): TFile | null => {
                if (!present.includes(link)) return null
                const file = new TFile()
                Object.assign(file, { name: link, extension: link.split('.').pop() ?? '' })
                return file
            }
        },
        vault: {
            readBinary: async (): Promise<ArrayBuffer> => new ArrayBuffer(8)
        }
    } as unknown as App

    const client = {
        uploadImage: async (name: string): Promise<string> => {
            uploaded.push(name)
            return `${GHOST}/${name}`
        }
    } as unknown as GhostApiClient

    return { app, client, uploaded }
}

const run = (md: string, present: string[]): Promise<string> => {
    const { app, client } = harness(present)
    return uploadVaultImages(app, client, 'note.md', md)
}

describe('uploadVaultImages — wikilink embeds', () => {
    it('uploads a plain embed and emits markdown', async () => {
        const out = await run('![[cat.png]]', ['cat.png'])
        expect(out).toBe(`![cat](${GHOST}/cat.png)`)
    })

    it('renders an aliased embed as a captioned Ghost image card', async () => {
        const out = await run('![[cat.png|A napping cat]]', ['cat.png'])
        expect(out).toBe(
            '<figure class="kg-card kg-image-card kg-card-hascaption">' +
                `<img src="${GHOST}/cat.png" alt="A napping cat">` +
                '<figcaption>A napping cat</figcaption>' +
                '</figure>'
        )
    })

    // The regression this whole change exists for: `[^\]]` stopped at the `]`
    // closing the link text, so the embed never matched and leaked as literal
    // text that marked then rendered as a bare link.
    it('handles a caption containing a markdown link', async () => {
        const out = await run(
            '![[fig.jpeg|Figure 1 from [O’Bryan et al., 2025](https://ex.com/p#f1)]]',
            ['fig.jpeg']
        )
        expect(out).toContain(`<img src="${GHOST}/fig.jpeg"`)
        expect(out).toContain(
            '<figcaption>Figure 1 from <a href="https://ex.com/p#f1">O’Bryan et al., 2025</a></figcaption>'
        )
        expect(out).not.toContain('![[')
    })

    it('handles a caption containing author-written HTML', async () => {
        const out = await run('![[fig.jpeg|From <a href="https://ex.com">source</a>]]', [
            'fig.jpeg'
        ])
        expect(out).toContain('<figcaption>From <a href="https://ex.com">source</a></figcaption>')
    })

    it('keeps a size alias as a size, not a caption', async () => {
        const out = await run('![[cat.png|300]]', ['cat.png'])
        expect(out).toBe(`![cat](${GHOST}/cat.png)`)
        expect(out).not.toContain('figcaption')
    })

    it('degrades an inline captioned embed to alt text rather than splitting the paragraph', async () => {
        const out = await run('See ![[cat.png|A napping cat]] there', ['cat.png'])
        expect(out).toBe(`See ![A napping cat](${GHOST}/cat.png) there`)
    })

    it('preserves a caption containing pipes', async () => {
        const out = await run('![[cat.png|Left | right]]', ['cat.png'])
        expect(out).toContain('<figcaption>Left | right</figcaption>')
    })

    it('drops non-image transclusions and missing images', async () => {
        expect(await run('![[Some Note]]', [])).toBe('')
        expect(await run('![[ghost.png]]', [])).toBe('')
    })

    it('uploads each unique image once', async () => {
        const { app, client, uploaded } = harness(['cat.png'])
        await uploadVaultImages(app, client, 'note.md', '![[cat.png]]\n\n![[cat.png|Again]]')
        expect(uploaded).toEqual(['cat.png'])
    })
})

describe('uploadVaultImages — standard markdown images', () => {
    it('uploads a vault-relative markdown image', async () => {
        const out = await run('![a cat](cat.png)', ['cat.png'])
        expect(out).toBe(`![a cat](${GHOST}/cat.png)`)
    })

    it('takes the markdown title as the caption and keeps alt as alt', async () => {
        const out = await run('![a cat](cat.png "Photographed in 2026")', ['cat.png'])
        expect(out).toBe(
            '<figure class="kg-card kg-image-card kg-card-hascaption">' +
                `<img src="${GHOST}/cat.png" alt="a cat">` +
                '<figcaption>Photographed in 2026</figcaption>' +
                '</figure>'
        )
    })

    it('decodes percent-encoded and angle-bracketed paths', async () => {
        expect(await run('![x](My%20Cat.png)', ['My Cat.png'])).toBe(`![x](${GHOST}/My Cat.png)`)
        expect(await run('![x](<My Cat.png>)', ['My Cat.png'])).toBe(`![x](${GHOST}/My Cat.png)`)
    })

    it('leaves external images untouched', async () => {
        const md = '![x](https://example.com/a.png)'
        expect(await run(md, [])).toBe(md)
    })

    it('leaves an unresolvable local image in place rather than deleting it', async () => {
        const md = '![x](missing.png)'
        expect(await run(md, [])).toBe(md)
    })

    it('does not re-process the URLs emitted by the embed pass', async () => {
        const { app, client, uploaded } = harness(['cat.png'])
        const out = await uploadVaultImages(app, client, 'note.md', '![[cat.png|A cat]]')
        expect(uploaded).toEqual(['cat.png'])
        expect(out).toContain(`<img src="${GHOST}/cat.png"`)
    })
})
