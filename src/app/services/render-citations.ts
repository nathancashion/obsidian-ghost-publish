import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import { marked } from 'marked'
import { log } from '../../utils/log'

/**
 * Academic citation rendering via pandoc + citeproc (desktop-only),
 * Quarto-style: citations render **inline** in the prose (author-date,
 * numeric, … — whatever the configured CSL style dictates), each linked
 * to its entry in a trailing **References** section.
 *
 * Notes cite Zotero/BetterBibTeX entries with pandoc citation syntax
 * (`@citekey`, `[@citekey]`, `[see @citekey, p. 3]`). The markdown body
 * is piped through `pandoc --citeproc` with `link-citations`, so each
 * rendered citation carries a `#ref-<citekey>` link. The `::: {#refs}`
 * div pandoc emits is converted here into a raw-HTML References section
 * wrapped in kg html-card markers: Ghost's `source=html` importer strips
 * `id` attributes from ordinary markup (same failure mode as BR-PROC-6),
 * and the `id="ref-<citekey>"` entries are what citation links target and
 * what the theme's hover-popover script reads.
 *
 * The pandoc writer keeps `fenced_divs` (we parse the refs div) but drops
 * `bracketed_spans`, so csl-entry span wrappers unwrap to plain text
 * instead of leaking `[…]{.csl-…}` syntax through `marked`.
 *
 * The markdown → markdown round trip is why this step runs late in the
 * sync pipeline: wikilinks, vault images, and embed markers are already
 * resolved to plain markdown that pandoc passes through unchanged.
 */

export interface CitationRenderOptions {
    /** pandoc executable — bare command resolved via PATH, or full path. */
    pandocPath: string
    /** Bibliography file (.bib / CSL JSON): absolute, `~/…`, or vault-relative. */
    bibliographyPath: string
    /** CSL style file: absolute, `~/…`, or vault-relative. Empty → pandoc default. */
    cslPath: string
    /** Absolute vault root, used to resolve vault-relative config paths. */
    vaultBasePath: string
}

/** Bracketed pandoc citation: `[@key]`, `[-@key]`, `[see @key, p. 3]`. */
const BRACKETED_CITATION_RE = /\[[^\]]*@[^\s\]]+[^\]]*\]/
/**
 * Bare in-text citation: `@key` not preceded by a word character (which
 * excludes email addresses like `a@b.com`). An escaped `\@handle` still
 * matches on purpose: the pandoc run is what strips the escape, so a note
 * containing one must be processed. The cost of this looseness is that an
 * unescaped `@handle` mention in a citations-enabled note is treated as a
 * citekey (pandoc renders unresolved keys as `**handle?**`) — escape such
 * mentions as `\@handle`.
 */
const BARE_CITATION_RE = /(?:^|[^\w])@[A-Za-z0-9_]/

const PANDOC_TIMEOUT_MS = 60_000
const PANDOC_MAX_BUFFER = 32 * 1024 * 1024

/** Whether the markdown contains at least one pandoc citation. */
export function hasCitations(markdown: string): boolean {
    return BRACKETED_CITATION_RE.test(markdown) || BARE_CITATION_RE.test(markdown)
}

/**
 * Stable fingerprint of the configuration that shapes citation rendering.
 * Folded into the note's content hash so flipping the preset toggle or
 * changing pandoc/bibliography/CSL paths invalidates the "unchanged"
 * short-circuit — otherwise a config change after a successful sync would
 * silently never re-render (BR-SYNC-1). Empty when citations are off, so
 * non-citation presets keep their existing hashes.
 */
export function citationConfigFingerprint(
    citationsEnabled: boolean,
    settings: Pick<CitationRenderOptions, 'pandocPath' | 'bibliographyPath' | 'cslPath'>
): string {
    if (!citationsEnabled) return ''
    // The version marker invalidates hashes when the citation pipeline
    // itself changes output shape (v2: inline citations + References
    // section replaced the earlier footnote-style rendering).
    return `citations:v2:${settings.pandocPath}|${settings.bibliographyPath}|${settings.cslPath}`
}

/**
 * Resolve the pandoc executable. A configured value containing a path
 * separator is used as-is (after `~/` expansion). A bare command is looked
 * up on `PATH` — plus common install locations that GUI apps don't inherit
 * on macOS (Obsidian is launched with the minimal launchd PATH, which
 * excludes Homebrew's `/opt/homebrew/bin`).
 */
export function resolvePandocBinary(
    pandocPath: string,
    pathEnv: string | undefined = process.env['PATH']
): string {
    const trimmed = pandocPath.trim() || 'pandoc'
    if (trimmed.includes('/') || trimmed.includes('\\')) {
        return resolveConfigPath('', trimmed)
    }
    const dirs = [
        ...(pathEnv ? pathEnv.split(delimiter) : []),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin'
    ]
    for (const dir of dirs) {
        if (!dir) continue
        const candidate = join(dir, trimmed)
        if (existsSync(candidate)) return candidate
    }
    // Not found anywhere: hand the bare command to execFile so its ENOENT
    // surfaces the actionable "pandoc not found" message.
    return trimmed
}

/**
 * Resolve a configured file path: absolute wins, `~/` expands to the home
 * directory, anything else is vault-relative. Empty input stays empty.
 */
export function resolveConfigPath(vaultBasePath: string, configuredPath: string): string {
    const trimmed = configuredPath.trim()
    if (!trimmed) return ''
    if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2))
    if (isAbsolute(trimmed)) return trimmed
    return vaultBasePath ? join(vaultBasePath, trimmed) : trimmed
}

/**
 * Build the pandoc argument list. Markdown → markdown keeps the rest of
 * the pipeline unchanged. `link-citations` makes every rendered citation
 * link to its `#ref-<citekey>` entry. The writer keeps `fenced_divs` (the
 * refs div is parsed by `convertReferencesDiv`) but drops
 * `bracketed_spans` so csl span wrappers can't leak `[…]{.csl-…}` syntax
 * that `marked` renders literally.
 */
export function buildPandocArgs(bibliographyPath: string, cslPath: string): string[] {
    const args = [
        // `smart` off on both sides keeps pandoc typography-neutral: the
        // reader must not rewrite `---`/quotes, and the writer must not
        // ASCII-ize the em dashes and curly quotes the author typed. Notes
        // with citations then render exactly like notes without them.
        '--from=markdown-smart',
        // `raw_attribute` off: with it, inline HTML the author wrote (e.g.
        // `<cite>` in a blockquote) round-trips as `` `<cite>`{=html} ``,
        // which `marked` then renders as literal code in the post.
        '--to=markdown-bracketed_spans-raw_attribute-smart',
        '--wrap=none',
        '--citeproc',
        `--bibliography=${bibliographyPath}`,
        '--metadata=link-citations:true'
    ]
    if (cslPath) {
        args.push(`--csl=${cslPath}`)
    }
    return args
}

/** Matches the opening line of a pandoc fenced div with an id, capturing it. */
const DIV_OPEN_RE = /^:{3,}\s*\{#([^\s}]+)[^}]*\}\s*$/
/** Matches any fenced-div opening line (id or classes only). */
const DIV_ANY_OPEN_RE = /^:{3,}\s*\{[^}]*\}\s*$/
/** Matches a bare fenced-div closing line. */
const DIV_CLOSE_RE = /^:{3,}\s*$/

/**
 * Replace pandoc's `::: {#refs}` fenced div with a raw-HTML References
 * section wrapped in kg html-card markers. Each `::: {#ref-<citekey>}`
 * entry becomes `<div class="csl-entry" id="ref-<citekey>">…</div>` with
 * its body rendered from markdown — preserving the ids that inline
 * citation links target and that the theme's hover-popover script reads.
 * `marked` passes the raw HTML block (and the kg comments) through to the
 * final post untouched. Markdown without a refs div is returned as-is.
 */
export function convertReferencesDiv(markdown: string): string {
    const lines = markdown.split('\n')
    const start = lines.findIndex((line) => DIV_OPEN_RE.exec(line)?.[1] === 'refs')
    if (start === -1) return markdown

    // Find the matching close of the #refs div, tracking nested divs.
    let depth = 0
    let end = -1
    for (let i = start; i < lines.length; i++) {
        const line = lines[i] ?? ''
        if (DIV_ANY_OPEN_RE.test(line)) depth++
        else if (DIV_CLOSE_RE.test(line)) {
            depth--
            if (depth === 0) {
                end = i
                break
            }
        }
    }
    if (end === -1) return markdown

    // Collect the csl entries inside the refs div.
    const entries: { id: string; body: string }[] = []
    let current: { id: string; body: string[] } | null = null
    for (let i = start + 1; i < end; i++) {
        const line = lines[i] ?? ''
        const open = DIV_OPEN_RE.exec(line)
        if (open) {
            const id = open[1]
            if (id !== undefined) current = { id, body: [] }
            continue
        }
        if (DIV_CLOSE_RE.test(line)) {
            if (current) {
                entries.push({ id: current.id, body: current.body.join('\n').trim() })
                current = null
            }
            continue
        }
        if (current) current.body.push(line)
    }
    if (entries.length === 0) return markdown

    const entriesHtml = entries.map(({ id, body }) => {
        const rendered = marked.parse(body, { async: false }).trim()
        return `<div class="csl-entry" id="${id}">${rendered}</div>`
    })
    const section =
        `<!--kg-card-begin: html-->\n` +
        `<section class="references" id="refs" data-references>\n` +
        `<h2>References</h2>\n` +
        entriesHtml.join('\n') +
        `\n</section>\n` +
        `<!--kg-card-end: html-->`

    return [...lines.slice(0, start), section, ...lines.slice(end + 1)].join('\n')
}

/**
 * Render citations in `markdown` via pandoc/citeproc: inline citations
 * (per the configured CSL style) linking into a trailing References
 * section. Throws with a user-actionable message when configuration is
 * missing or pandoc fails; the sync orchestrator surfaces it as a failed
 * note (BR-SYNC-5).
 */
export async function renderCitations(
    markdown: string,
    options: CitationRenderOptions
): Promise<string> {
    const bibliography = resolveConfigPath(options.vaultBasePath, options.bibliographyPath)
    if (!bibliography) {
        throw new Error(
            'Citations are enabled for this preset, but no bibliography file is configured (Settings → Academic citations).'
        )
    }
    const csl = resolveConfigPath(options.vaultBasePath, options.cslPath)
    const pandoc = resolvePandocBinary(options.pandocPath)
    const out = await runPandoc(pandoc, buildPandocArgs(bibliography, csl), markdown)
    return convertReferencesDiv(out)
}

/** Run pandoc with `stdin` piped in, resolving with stdout. */
function runPandoc(command: string, args: string[], stdin: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = execFile(
            command,
            args,
            { timeout: PANDOC_TIMEOUT_MS, maxBuffer: PANDOC_MAX_BUFFER },
            (error, stdout, stderr) => {
                if (error) {
                    if (error.code === 'ENOENT') {
                        reject(
                            new Error(
                                `pandoc not found (looked for \`${command}\`). Install pandoc or set its full path in Settings → Academic citations.`
                            )
                        )
                        return
                    }
                    const detail = stderr.trim() || error.message
                    reject(new Error(`pandoc failed: ${detail}`))
                    return
                }
                if (stderr.trim()) {
                    // Non-fatal citeproc diagnostics, e.g. "reference X not
                    // found" for an unescaped @handle or a stale citekey.
                    log(`pandoc warnings: ${stderr.trim()}`, 'warn')
                }
                resolve(stdout)
            }
        )
        child.stdin?.write(stdin)
        child.stdin?.end()
    })
}
