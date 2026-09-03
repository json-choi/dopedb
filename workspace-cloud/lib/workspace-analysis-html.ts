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

function escapeHtmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function paragraphs(value: string) {
  return value
    .split(/\n{2,}/u)
    .map((paragraph) => `<p>${escapeHtmlText(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

export function legacyArticleHtml(
  question: string,
  summary: string,
  blocks: readonly LegacyNarrativeBlock[],
) {
  const parts: string[] = [];
  if (summary.trim()) parts.push(paragraphs(summary));
  if (question.trim() && question.trim() !== summary.trim()) parts.push(paragraphs(question));
  for (const block of blocks) {
    if (block.kind === "heading" && typeof block.config.text === "string") {
      const level = block.config.level === 3 ? 4 : block.config.level === 2 ? 3 : 2;
      parts.push(`<h${level}>${escapeHtmlText(block.config.text)}</h${level}>`);
    } else if ((block.kind === "markdown" || block.kind === "callout")
      && typeof block.config.markdown === "string") {
      parts.push(paragraphs(block.config.markdown));
    } else if (block.kind === "divider") {
      parts.push("<hr>");
    }
  }
  return sanitizeAnalysisArticleHtml(parts.join(""));
}

export type LegacyNarrativeBlock = Readonly<{
  kind: string;
  config: Readonly<Record<string, unknown>>;
}>;
