import { TFile } from 'obsidian'
import type { App } from 'obsidian'
import type { GhostApiClient } from '../api/ghost-api-client'
import { isExternalImageUrl, parseFeatureImageRef } from '../utils/parse-feature-image.fn'
import { log } from '../../utils/log'

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i

const MIME_BY_EXT: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml'
}

/**
 * Resolve the note's feature-image frontmatter value to a URL Ghost can
 * store in `feature_image`: external URLs pass through, vault references
 * are resolved against the vault and uploaded.
 *
 * Returns an empty string when no image is configured or the reference
 * cannot be resolved — a missing feature image must never fail the sync
 * (the post still publishes, just without the image).
 */
export async function uploadFeatureImage(
    app: App,
    client: GhostApiClient,
    sourcePath: string,
    frontmatterValue: unknown
): Promise<string> {
    const ref = parseFeatureImageRef(frontmatterValue)
    if (!ref) return ''
    if (isExternalImageUrl(ref)) return ref

    if (!IMAGE_EXT_RE.test(ref)) {
        log(`Feature image is not a supported image type: ${ref}`, 'warn')
        return ''
    }

    const file = app.metadataCache.getFirstLinkpathDest(ref, sourcePath)
    if (!(file instanceof TFile)) {
        log(`Feature image not found in vault: ${ref}`, 'warn')
        return ''
    }

    try {
        const data = await app.vault.readBinary(file)
        const ext = (file.extension || '').toLowerCase()
        const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
        const url = await client.uploadImage(file.name, data, mime)
        log(`Uploaded feature image ${ref} → ${url}`, 'debug')
        return url
    } catch (e) {
        log(`Feature image upload failed for ${ref}`, 'error', e)
        return ''
    }
}
