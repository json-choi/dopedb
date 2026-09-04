import sanitizeHtml from "sanitize-html";

const UNSAFE_DISPLAY = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069\ufeff]/u;
const ARTICLE_HTML_TAGS = [
  "p", "h2", "h3", "h4", "blockquote", "ul", "ol", "li", "strong", "em",
  "code", "pre", "a", "hr", "br", "table", "thead", "tbody", "tr", "th", "td",
] as const;

export function sanitizeAnalysisArticleHtml(value: unknown): string {
  if (typeof value !== "string" || value.length > 250_000 || UNSAFE_DISPLAY.test(value)) {
    throw new Error("Invalid Analysis Article HTML");
  }
  const html = sanitizeHtml(value, {
    allowedTags: [...ARTICLE_HTML_TAGS],
    allowedAttributes: {
      a: ["href", "title"],
      th: ["colspan", "rowspan", "scope"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: true,
  });
  if (new TextEncoder().encode(html).byteLength > 256 * 1024) {
    throw new Error("Analysis Article HTML is too large");
  }
  return html;
}
