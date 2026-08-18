---
title: Tips & best practices
nav_order: 90
---

# Tips and best practices

## One preset, one workflow

Treat each preset as a distinct publication workflow. Common ideas:

- **Blog post** — tag `blog-post`, status `published`, no newsletter (or one for major posts only).
- **News** — tag `news`, optional newsletter for opted-in subscribers, often with `canonical_url` enabled.
- **Microblog** — tag `microblog`, status `published`, no canonical URL, no listing note.
- **Draft** — status `draft`, no tags (or a `draft` tag), so you can review in Ghost Admin before clicking publish.

A note can only be assigned to **one preset at a time** (the preset id is stored in frontmatter). To re-publish a note under a different preset, remove it from the queue first.

## Idempotency via content hash

Each successful sync writes a SHA-256 of the body to the configured content-hash frontmatter key. Re-running the sync without editing the note short-circuits to `unchanged`. Edit anything in the body to force a re-publish.

## Newsletter emails fire once

If a note has the email flag set and no `emailed_at`, the first sync creates the post as a draft, then transitions it to published with the newsletter slug — that's the only Ghost transition that fires the email. After that, `emailed_at` is set and subsequent updates never re-send.

To re-trigger the email, you'd need to delete the post in Ghost AND clear the `emailed_at` frontmatter field. The plugin won't do this for you.

## YouTube and bookmark cards

- **YouTube card:** write `![](https://www.youtube.com/watch?v=…)` or the `youtu.be/…` short form on its own line.
- **Bookmark card:** start a paragraph with `LINK:` followed by a URL — either inline (`LINK: https://…`) or as a list (`LINK:` then `- https://…` on the next line). Wikilinks resolve via the known-URL map or your public mirror.

The plugin first inserts a marker paragraph, then upgrades it post-creation via Ghost's lexical API. If the oembed lookup fails, the marker stays.

## Footnotes

Markdown footnotes are published as proper footnotes:

- **Reference + definition:** `A claim.[^1]` somewhere in the body, with `[^1]: The source.` on its own line (definitions can span multiple indented lines).
- **Inline footnote:** `A statement.^[An aside written inline.]`

Footnotes are numbered by the order their references first appear, not the order the definitions are written. A definition that is never referenced is dropped, and a reference with no matching definition is left as literal text. The rendered post gets superscript anchors and a footnotes section at the bottom.

The footnotes section is published as a verbatim HTML card. Ghost's editor conversion otherwise strips the `id` anchors that footnote references point at, which silently breaks in-page footnote navigation and theme footnote scripts (e.g. [Littlefoot](https://littlefoot.js.org/) popovers). With the HTML card, both work like footnotes written in a native Markdown card.

## Academic citations

Presets with **Render citations** enabled resolve [pandoc citations](https://pandoc.org/MANUAL.html#citation-syntax) against your bibliography before publishing (desktop-only; requires pandoc):

- `@doe2020` — bare in-text citation (author names appear in your sentence)
- `[@doe2020]` — full citation
- `[-@doe2020]` — suppress the author
- `[see @doe2020, p. 12; also @roe2019]` — prefixes, locators, multiple keys

Configure the pandoc path, bibliography (`.bib` — a Zotero/BetterBibTeX auto-export works well), and CSL style under **Settings → Academic citations**. Citations render **inline**, exactly as the CSL style dictates — author-date styles give `Doe et al. (2020)`, numeric styles like Vancouver give `(1)` — with each citation linked to its entry in a **References** section appended to the post (Quarto-style). The entry ids survive publishing, so a small theme script can show the full reference in a hover popover. Your own footnotes (`[^1]`, `^[aside]`) are unaffected and keep their separate footnote popups.

Because bare `@key` counts as a citation, an `@handle` mention in a citations-enabled note would be misread as a citekey (and render as `**handle?**`) — escape such mentions as `\@handle`. Email addresses are fine unescaped.

Changing citation settings (or the preset toggle) re-syncs affected notes automatically — the content hash covers the citation config. One thing it can't see is edits **inside** your `.bib` file: to republish a note after fixing a library entry, touch the note body or delete its content-hash property.

## Feature images

Set the feature-image property (default `ghost_publish_feature_image`, configurable in settings) to give the post a Ghost feature image:

```yaml
ghost_publish_feature_image: cover.jpg
```

The value can be a vault image name or path, a wikilink (`[[cover.jpg]]`), an embed (`![[cover.jpg]]`), a markdown image, or an external URL. Vault images are uploaded to Ghost on sync; external URLs are used as-is. If the property is a list, the first usable entry wins — so if your notes already carry something like `image:` with a list of attachments, just point the setting at that property name instead of adding a new one.

The image is only sent when it resolves, so a missing file never clears an image you set in Ghost Admin, and never fails the sync — it logs a warning and publishes without it.

## Blockquote attributions

`<cite>` inside a blockquote is preserved:

```markdown
> The quote itself.
> <cite>— Jane Doe, in [Some Article](https://example.com)</cite>
```

Ghost's editor format has no `<cite>` equivalent and would otherwise drop the tag, so quotes using it are published as verbatim HTML cards. Quotes without `<cite>` stay native Ghost quote cards, editable in Ghost Admin as usual. Style the attribution in your theme with `blockquote cite`.

## Bring your own frontmatter

If you already use a specific naming convention, set the frontmatter properties in settings to match. Every key is configurable. The plugin reads / writes only what you tell it to.

## Troubleshooting

### "Missing Ghost configuration"

Fill in Ghost URL and Admin API key in settings. The Admin key can come from `GHOST_ADMIN_KEY` if you'd prefer to keep it out of the plugin data file.

### "canonical URL not reachable"

Either your mirror hasn't finished publishing the note, the path contains a character that needs different encoding, or your Notes base URL is wrong. Compare the resolved URL (debug mode → developer console) to a working one.

### A post got recreated rather than updated

A Ghost id was present on the note but Ghost returned 404 — usually because the post was deleted in Ghost Admin. The new id replaces the old one in frontmatter.

### Refresh button does nothing

Verify the Ghost URL has no trailing slash and the Admin key is `id:secret`. If the request fails, the notice surfaces the Ghost error message — usually an auth issue (wrong secret, missing scopes).

### "Preset not found" notice

Happens if the panel had a stale active preset id (e.g. you deleted a preset while the panel was open). Click the panel's refresh button.
