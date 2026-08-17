import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/**
 * Academic citation rendering via pandoc + citeproc (desktop-only).
 *
 * Notes can cite Zotero/BetterBibTeX entries with pandoc citation syntax
 * (`[@citekey]`, `[-@citekey]`, `[see @citekey, p. 3]`). Before the HTML
 * build, the markdown body is piped through `pandoc --citeproc`, which
 * resolves the keys against the configured bibliography and rewrites the
 * citations in the configured CSL style. With a note-class CSL style
 * (e.g. Chicago full note), citations come back as regular markdown
 * footnotes — which then flow through the existing footnote pipeline and
 * publish as popup-compatible footnote HTML (BR-PROC-5/6).
 *
 * The markdown → markdown round trip is why this step runs late in the
 * sync pipeline: wikilinks, vault images, and embed markers are already
 * resolved to plain markdown that pandoc passes through unchanged.
 *
 * The post's own bibliography section is suppressed
 * (`suppress-bibliography`): note-style footnotes already carry the full
 * citation, and standalone annotated bibliography pages are a separate
 * concern.
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

/**
 * Bracketed pandoc citation (`[@key]`, `[-@key]`, `[see @key, p. 3]`).
 * Bare in-text `@key` citations deliberately do NOT trigger processing —
 * `@handle` mentions are too common in prose. Once at least one bracketed
 * citation opts the note in, pandoc renders bare keys too.
 */
const BRACKETED_CITATION_RE = /\[[^\]]*@[^\s\]]+[^\]]*\]/

const PANDOC_TIMEOUT_MS = 60_000
const PANDOC_MAX_BUFFER = 32 * 1024 * 1024

/** Whether the markdown contains at least one bracketed citation. */
export function hasCitations(markdown: string): boolean {
    return BRACKETED_CITATION_RE.test(markdown)
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
 * the pipeline unchanged; `fenced_divs` / `bracketed_spans` are disabled
 * in the writer so citeproc's `::: {#refs}` / `[…]{.csl-…}` wrappers can
 * never leak syntax that `marked` renders literally.
 */
export function buildPandocArgs(bibliographyPath: string, cslPath: string): string[] {
    const args = [
        '--from=markdown',
        '--to=markdown-fenced_divs-bracketed_spans',
        '--wrap=none',
        '--citeproc',
        `--bibliography=${bibliographyPath}`,
        '--metadata=suppress-bibliography:true'
    ]
    if (cslPath) {
        args.push(`--csl=${cslPath}`)
    }
    return args
}

/**
 * Render citations in `markdown` via pandoc/citeproc. Throws with a
 * user-actionable message when configuration is missing or pandoc fails;
 * the sync orchestrator surfaces it as a failed note (BR-SYNC-5).
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
    const pandoc = options.pandocPath.trim() || 'pandoc'
    return runPandoc(pandoc, buildPandocArgs(bibliography, csl), markdown)
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
                resolve(stdout)
            }
        )
        child.stdin?.write(stdin)
        child.stdin?.end()
    })
}
