import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import { log } from '../../utils/log'

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
    return `citations:${settings.pandocPath}|${settings.bibliographyPath}|${settings.cslPath}`
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
    const pandoc = resolvePandocBinary(options.pandocPath)
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
