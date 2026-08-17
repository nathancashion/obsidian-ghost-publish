# Academic citations pipeline

Goal: publish fully cited academic posts from Obsidian to Ghost with hover
popup citations, following the bibliography-first model in the user's Ghost
blogging-platform spec (Zotero/BetterBibTeX → `.bib` → pandoc citeproc →
Ghost; hover popups via Littlefoot on the theme side).

## Phase 1 — citeproc core (DONE)

- `services/render-citations.ts`: pipe the note body through
  `pandoc --citeproc` (markdown → markdown) against a configured
  bibliography + CSL style. Note-class styles emit citations as markdown
  footnotes, which flow through the existing footnote pipeline
  (BR-PROC-5/6) and get Littlefoot popovers on the theme.
- Global settings (`settings.citations`): pandoc path, bibliography path,
  CSL path. Per-preset opt-in (`citationsEnabled`).
- Trigger: at least one bracketed `[@key]` citation in the body.
- Bibliography section suppressed (footnotes carry full citations).
- Covered by `render-citations.spec.ts` incl. a real-pandoc integration
  test (skipped when pandoc is unavailable).

## Phase 2 — annotated bibliography pages (TODO)

The PainScience model: per-paper markdown notes (commentary + abstract +
link) published as standalone pages, sourced from the same citekeys.

- A dedicated preset (or preset option) that publishes bibliography notes
  as Ghost pages; citekey recorded in frontmatter; stable slug derived
  from the citekey.
- Consider a `bibliography-note` template/command that scaffolds a note
  from a `.bib` entry (full citation + abstract fetched from the entry).

## Phase 3 — citation → bibliography-page linking (TODO)

After citeproc, post-process rendered citation footnotes: when a published
bibliography page exists for a citekey, append a link to it inside the
footnote ("→ my notes"). The plugin's ghost-metadata-cache already knows
published URLs. Requires keeping a citekey → post mapping.

## Phase 4 — update logging (CONSIDER, from spec §4.4)

Frontmatter-driven changelog section rendered at the foot of academic
posts. Cheap, but deferred until the spec decides it's wanted.

## Open questions

- CSL style: assumed note-class (footnote citations). If the user prefers
  author-date inline citations, popups need a different mechanism than
  footnotes.
- Whether Phase 2 pages should be Ghost pages (no feed/email) or posts
  under a dedicated tag. Leaning pages.
