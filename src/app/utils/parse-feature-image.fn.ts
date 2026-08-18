/**
 * Extract a single image reference from a frontmatter value.
 *
 * Accepts the shapes notes actually use: a plain string, a wikilink
 * (`[[img.jpg]]`), an embed (`![[img.jpg]]`), a markdown image
 * (`![alt](img.jpg)`), or a YAML list of any of those (first entry wins,
 * matching Ghost's single `feature_image` field). Aliases (`[[img|alt]]`)
 * are dropped — only the target matters.
 *
 * Returns the bare reference (vault path/name or external URL), or an
 * empty string when the value carries no usable reference.
 */
export function parseFeatureImageRef(value: unknown): string {
    const first = Array.isArray(value) ? value.find((v) => typeof v === 'string') : value
    if (typeof first !== 'string') return ''

    let ref = first.trim()
    if (!ref) return ''

    // ![alt](target) / [text](target) → target
    const mdImage = /^!?\[[^\]]*\]\(([^)]+)\)$/.exec(ref)
    if (mdImage?.[1]) ref = mdImage[1].trim()

    // ![[target]] / [[target]] → target (alias after | dropped)
    const wikilink = /^!?\[\[([^\]]+)\]\]$/.exec(ref)
    if (wikilink?.[1]) {
        const inner = wikilink[1]
        ref = (inner.includes('|') ? inner.slice(0, inner.indexOf('|')) : inner).trim()
    }

    return ref
}

/** Whether a reference is already an absolute URL Ghost can use as-is. */
export function isExternalImageUrl(ref: string): boolean {
    return /^https?:\/\//i.test(ref)
}
