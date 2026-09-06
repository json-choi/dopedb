---
name: dopedb-analysis-article
description: Create or edit visual Analysis Articles through a DopeDB session, with measured charts, readable HTML, and the existing Article's saved query.
---

# Analysis Article authoring

Deliver a readable visual analysis in the workspace's Article tools. Use the
existing Article ID for an edit. Its title and HTML can change while its query
and successful observation stay unchanged; presentation edits need no new read.
Other authoring skills can help produce content, but a local file or chat render
does not save an Article.

## Choose the visual that answers the question

- A funnel shows the same cohort progressing through ordered stages. Scale bars
  to counts, label counts and denominators, and distinguish stage conversion
  from conversion against the starting cohort.
- A time series uses a line with a stated time zone and interval. Comparisons
  usually use bars; a scatter plot can show the relationship between measures.
- Use a diagram for a process or relationship, not as evidence of measured values.
- Choose only the visuals the findings need. Include a caption and readable
  values or a compact table. For a zero denominator, show an unavailable rate.

Lead with the finding, then its visual evidence and interpretation. Keep methods,
observation dates, and material limits available without burying the finding in
query IDs, hashes, raw SQL, or file paths. The app already shows the saved query.
Do not repeat the Article title as the first body heading.

## HTML and visual vocabulary

Return an HTML fragment, without Markdown fences or a second HTML document.
Headings h2–h4, paragraphs, lists, tables, section, aside, div, span, figure,
figcaption, caption, and definition lists are supported. The app supplies the
typography, spacing, colors, and responsive behavior; inline styles are removed.

Optional layout classes:

- section.article-metrics contains div.article-metric items; use span.article-kicker
  for the label and span.article-value for the measured value.
- aside.article-note highlights an interpretation or limitation.
- SVG elements can use article-accent or article-muted for theme-aware emphasis.

Charts and diagrams use inline static SVG with a viewBox, role="img", title,
desc, and/or aria-label. Allowed drawing elements are svg, g, path, rect, circle,
ellipse, line, polyline, polygon, text, and tspan. Draw in absolute coordinates;
use plain text labels, x/y, sizes, points, path d, numeric opacity, fill, stroke,
stroke-width, font-size, font-weight, and text-anchor. Prefer currentColor and
the emphasis classes. Include enough room for labels at narrow widths.

For example, a measured comparison can use:

```html
<figure>
  <svg viewBox="0 0 600 150" role="img" aria-label="Example: 80 starters and 40 completions">
    <title>Example conversion</title>
    <text x="0" y="28" fill="currentColor" font-size="18">Started · 80</text>
    <rect x="170" y="8" width="400" height="32" rx="4" fill="currentColor" class="article-accent" />
    <text x="0" y="88" fill="currentColor" font-size="18">Completed · 40</text>
    <rect x="170" y="68" width="200" height="32" rx="4" fill="currentColor" class="article-accent" />
  </svg>
  <figcaption>40 of 80 starters completed the process (50%).</figcaption>
</figure>
```

Replace example values with verified measurements. Scripts, event handlers,
forms, animation, foreignObject, images, use references, external fonts,
stylesheets, and URL-based SVG paint are not supported. Charts are snapshots:
they do not query a database, refresh automatically, or publish themselves.
