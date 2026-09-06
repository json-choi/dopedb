import sanitizeHtml from "sanitize-html";

const UNSAFE_DISPLAY = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069\ufeff]/u;
const ARTICLE_HTML_TAGS = [
  "p", "h2", "h3", "h4", "blockquote", "ul", "ol", "li", "strong", "em",
  "code", "pre", "a", "hr", "br", "table", "thead", "tbody", "tr", "th", "td",
  "section", "aside", "div", "span", "figure", "figcaption", "caption", "dl", "dt", "dd",
] as const;
const SVG_TAGS = ["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "title", "desc"];
const SVG_ATTRIBUTES = [
  "viewBox", "xmlns", "role", "aria-label", "x", "y", "x1", "x2", "y1", "y2",
  "cx", "cy", "r", "rx", "ry", "width", "height", "d", "points", "fill", "stroke",
  "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity",
  "stroke-opacity", "font-size", "font-weight", "text-anchor", "dominant-baseline", "class",
];
const NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function svgAttribute(name: string, value: string): string | null {
  if (name === "class") return value;
  if (name === "viewBox") {
    const parts = value.trim().split(/[\s,]+/);
    return parts.length === 4 && parts.every((part) => NUMBER.test(part) && Math.abs(Number(part)) <= 100_000)
      && Number(parts[2]) > 0 && Number(parts[3]) > 0 ? parts.join(" ") : null;
  }
  if (name === "xmlns") return value === "http://www.w3.org/2000/svg" ? value : null;
  if (name === "role") return value === "img" ? value : null;
  if (name === "aria-label") return value.slice(0, 500);
  if (name === "fill" || name === "stroke") {
    return /^(?:none|currentColor|#[\da-f]{3}|#[\da-f]{6}|#[\da-f]{8})$/i.test(value) ? value : null;
  }
  if (name === "d") return value.length <= 100_000 && /^[mlhvcsqtaz\de.,+\s-]+$/i.test(value) ? value : null;
  if (name === "points") return value.length <= 100_000 && /^[\de.,+\s-]+$/i.test(value) ? value : null;
  if (name === "text-anchor") return /^(?:start|middle|end)$/.test(value) ? value : null;
  if (name === "dominant-baseline") return /^(?:auto|middle|central|hanging)$/.test(value) ? value : null;
  if (name === "stroke-linecap") return /^(?:butt|round|square)$/.test(value) ? value : null;
  if (name === "stroke-linejoin") return /^(?:miter|round|bevel)$/.test(value) ? value : null;
  return NUMBER.test(value) && Math.abs(Number(value)) <= 100_000 ? value : null;
}

function sanitizeSvgAttributes(tagName: string, attributes: Record<string, string>) {
  if (!SVG_TAGS.includes(tagName)) return { tagName, attribs: attributes };
  const attribs: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    const name = key === "viewbox" ? "viewBox" : key;
    if (!SVG_ATTRIBUTES.includes(name)) continue;
    const safeValue = svgAttribute(name, value);
    if (safeValue !== null) attribs[name] = safeValue;
  }
  return { tagName, attribs };
}

export function sanitizeAnalysisArticleHtml(value: unknown): string {
  if (typeof value !== "string" || value.length > 250_000 || UNSAFE_DISPLAY.test(value)) {
    throw new Error("Invalid Analysis Article HTML");
  }
  const html = sanitizeHtml(value, {
    allowedTags: [...ARTICLE_HTML_TAGS, ...SVG_TAGS],
    allowedAttributes: {
      a: ["href", "title"],
      th: ["colspan", "rowspan", "scope"],
      td: ["colspan", "rowspan"],
      section: ["class"],
      aside: ["class"],
      div: ["class"],
      span: ["class"],
      ...Object.fromEntries(SVG_TAGS.map((tag) => [tag, SVG_ATTRIBUTES])),
    },
    allowedClasses: {
      section: ["article-metrics"],
      aside: ["article-note"],
      div: ["article-metric"],
      span: ["article-kicker", "article-value"],
      ...Object.fromEntries(SVG_TAGS.map((tag) => [tag, ["article-accent", "article-muted"]])),
    },
    transformTags: { "*": sanitizeSvgAttributes },
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "foreignobject", "iframe", "object", "embed"],
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
