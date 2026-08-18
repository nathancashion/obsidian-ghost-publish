# Academic citations pipeline

Goal: publish fully cited academic posts from Obsidian to Ghost with hover
popup citations, following the bibliography-first model in the user's Ghost
blogging-platform spec (Zotero/BetterBibTeX → `.bib` → pandoc citeproc →
Ghost; hover popups via Littlefoot on the theme side).

## Phase 1 — citeproc core (DONE, reworked 2026-08-18)

Quarto-style rendering (user correction of the original footnote-style
design): citations render **inline** per the CSL style, linked
(`link-citations`) to entries in a trailing **References** section that
publishes as a kg html card (id preservation). Theme-side hover popovers
(Forest `default.hbs`) show the full reference on `a[href^="#ref-"]` —
separate from Littlefoot, which stays for real footnotes.

- `services/render-citations.ts`: pandoc --citeproc markdown → markdown;
  `convertReferencesDiv` turns the `::: {#refs}` div into the html card.
- Global settings (`settings.citations`): pandoc path, bibliography path,
  CSL path. Per-preset opt-in (`citationsEnabled`).
- Trigger: bracketed `[@key]` or bare `@key` (word-boundary guarded).
- Hash carries a citation-config fingerprint incl. pipeline version.
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

- ~~CSL style: note-class vs inline~~ — resolved 2026-08-18: inline,
  Quarto-style, with theme popovers. Current style: official Vancouver
  (`~/Development/Ghost/citation-styles/vancouver.csl`); the note-class
  variant (`vancouver-note.csl`) is kept in the same folder but unused.
- Whether Phase 2 pages should be Ghost pages (no feed/email) or posts
  under a dedicated tag. Leaning pages.
- Phase 3 linking now naturally attaches to References entries (append a
  "→ my notes" link inside `#ref-<citekey>` divs) and/or the popover.
