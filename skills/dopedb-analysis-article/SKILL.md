---
name: dopedb-analysis-article
description: Adapt and save visual analysis as a DopeDB Analysis Article, using available authoring skills and the Article's saved-query contract.
---

# Analysis Article authoring

Use an available HTML, visualization, or document-design skill when it fits the
analysis. Follow its authoring workflow, then adapt the result to DopeDB's HTML
contract below. Do not assume a particular skill is installed; if none fits,
compose the Article directly.

Keep the Article short and focused on the key metrics and findings. Let the
question determine the layout and number of visuals rather than following a
fixed template. Preserve verified measurements, observation periods, denominators,
and limitations needed to interpret the findings. Do not repeat the Article title,
SQL, query IDs, or execution metadata in the body; the app provides review tools.

## Save through DopeDB

Use the session's Article tools to save the result; a local HTML file or chat
render alone does not create or update an Article. For an edit, use the existing
Article ID. Presentation-only edits can change its title and HTML while preserving
its one exact read-only saved query and successful observation; no new read is
needed. Manual query reruns do not rewrite the HTML or charts.

## Supported output

Return an HTML fragment, not Markdown fences or a full HTML document. The app
supplies document typography, spacing, and responsive behavior; inline styles are
removed. Supported content includes h2–h4, paragraphs, lists, tables, section,
aside, div, span, figure, figcaption, caption, and definition lists.

Optional app layout hooks are section.article-metrics with div.article-metric
items, span.article-kicker labels, span.article-value values, and aside.article-note.
They are available when useful, not a required layout.

Use static inline SVG for charts, with a viewBox and an accessible title, desc,
or aria-label. Supported drawing elements are svg, g, path, rect, circle, ellipse,
line, polyline, polygon, text, and tspan. Coordinate and presentation attributes
include x/y, sizes, points, path d, opacity, fill, stroke, stroke-width, font-size,
font-weight, and text-anchor.

Adapt unsupported output before saving: scripts, event handlers, forms,
animation, foreignObject, images, use references, external fonts, stylesheets,
and URL-based SVG paint are not supported. Charts are static observations, not
live queries or automatically refreshed results.
