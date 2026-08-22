import { TFile } from 'obsidian'
import type { App } from 'obsidian'
import type { GhostApiClient } from '../api/ghost-api-client'
import { log } from '../../utils/log'
import {
    buildImageMarkup,
    captionToAltText,
    isDimensionAlias,
    isExternalUrl,
    normalizeVaultImagePath,
    occupiesOwnLine,
    parseEmbedInner,
    renderCaptionHtml
} from '../utils/image-embeds.fn'

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i

/**
 * `![[target|alias]]`. The inner group tolerates single `]` characters so that
 * captions containing markdown links (`[text](url)`) still match — banning `]`
 * outright silently skipped those embeds and leaked them as literal text.
 */
const EMBED_RE = /!\[\[((?:[^\]]|\](?!\]))+?)\]\]/g

/** `![alt](target "title")`, with optional `<…>` around the target. */
const MD_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+"([^"]*)")?\s*\)/g

const MIME_BY_EXT: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml'
}

/** Resolved Ghost URL per vault target; `null` marks an unusable reference. */
type UploadMap = Map<string, string | null>

async function resolveAndUpload(
    app: App,
    client: GhostApiClient,
    sourcePath: string,
    target: string,
    uploads: UploadMap
): Promise<void> {
    if (uploads.has(target)) return
    if (!IMAGE_EXT_RE.test(target)) {
        uploads.set(target, null)
        return
    }
    const file = app.metadataCache.getFirstLinkpathDest(target, sourcePath)
    if (!(file instanceof TFile)) {
        log(`Image not found in vault: ${target}`, 'warn')
        uploads.set(target, null)
        return
    }
    try {
        const data = await app.vault.readBinary(file)
        const ext = (file.extension || '').toLowerCase()
        const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
        const url = await client.uploadImage(file.name, data, mime)
        uploads.set(target, url)
        log(`Uploaded ${target} → ${url}`, 'debug')
    } catch (e) {
        log(`Image upload failed for ${target}`, 'error', e)
        uploads.set(target, null)
    }
}

/**
 * Upload every vault image referenced by `markdown` to Ghost and rewrite the
 * references to their Ghost URLs.
 *
 * Both syntaxes are handled. `![[image|caption]]` treats the alias as a
 * caption (a bare size hint such as `300` stays a size); `![alt](image.png
 * "caption")` keeps alt as alt and takes the optional markdown title as the
 * caption. A captioned image on its own line becomes a `figure` + `figcaption`
 * image card; everything else stays inline markdown.
 *
 * Non-image transclusions (e.g. note embeds) are dropped — Ghost has no
 * equivalent. External URLs are left untouched.
 */
export async function uploadVaultImages(
    app: App,
    client: GhostApiClient,
    sourcePath: string,
    markdown: string
): Promise<string> {
    const embedRefs = [...markdown.matchAll(EMBED_RE)]
    const mdRefs = [...markdown.matchAll(MD_IMAGE_RE)].filter(
        (m) => !isExternalUrl(normalizeVaultImagePath(m[2]!))
    )
    if (embedRefs.length === 0 && mdRefs.length === 0) return markdown

    const uploads: UploadMap = new Map()
    for (const match of embedRefs) {
        const { target } = parseEmbedInner(match[1]!)
        await resolveAndUpload(app, client, sourcePath, target, uploads)
    }
    for (const match of mdRefs) {
        const target = normalizeVaultImagePath(match[2]!)
        await resolveAndUpload(app, client, sourcePath, target, uploads)
    }

    const withEmbeds = markdown.replace(
        EMBED_RE,
        (full: string, inner: string, offset: number): string => {
            const { target, alias } = parseEmbedInner(inner)
            const url = uploads.get(target)
            if (!url) return ''
            const caption = alias && !isDimensionAlias(alias) ? alias : ''
            const alt = caption ? captionToAltText(caption) : target.replace(IMAGE_EXT_RE, '')
            const captionHtml =
                caption && occupiesOwnLine(markdown, offset, full.length)
                    ? renderCaptionHtml(caption)
                    : ''
            return buildImageMarkup(url, alt, captionHtml)
        }
    )

    return withEmbeds.replace(
        MD_IMAGE_RE,
        (
            full: string,
            alt: string,
            rawTarget: string,
            title: string | undefined,
            offset: number
        ) => {
            const target = normalizeVaultImagePath(rawTarget)
            if (isExternalUrl(target)) return full
            const url = uploads.get(target)
            if (!url) return full
            const captionHtml =
                title && occupiesOwnLine(withEmbeds, offset, full.length)
                    ? renderCaptionHtml(title)
                    : ''
            return buildImageMarkup(url, alt, captionHtml)
        }
    )
}
