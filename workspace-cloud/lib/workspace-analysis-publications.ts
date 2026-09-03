// Immutable public HTML snapshots. SQL, connection identity, result rows,
// credentials, and any rerun command are deliberately absent from this shape.
import {
  sanitizeAnalysisArticleHtml,
  type AnalysisArticleDefinition,
} from "./workspace-analysis-articles";

export type AnalysisPublicationRequest = Readonly<{
  id: string;
  runId: string;
  slug: string;
  replacePublicationId: string | null;
  visibility: "unlisted" | "public";
  searchIndexable: boolean;
}>;

export type AnalysisPublicSnapshot = Readonly<{
  version: 2;
  title: string;
  html: string;
  publishedAt: string;
  searchIndexable: boolean;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{7,127}$/;
const UNSAFE_DISPLAY = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069\ufeff]/u;

function exactRecord(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(row, field))
    ? row : null;
}

function text(value: unknown, maximum: number, empty = false) {
  if (typeof value !== "string" || value.length > maximum || UNSAFE_DISPLAY.test(value)) return null;
  return empty || value.trim().length > 0 ? value : null;
}

function escapeHtmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function paragraph(value: string) {
  return value.trim() ? `<p>${escapeHtmlText(value).replaceAll("\n", "<br>")}</p>` : "";
}

export function parseAnalysisPublicationRequest(value: unknown): AnalysisPublicationRequest {
  const row = exactRecord(value, [
    "id", "runId", "slug", "replacePublicationId", "visibility", "searchIndexable",
  ]);
  if (!row || typeof row.id !== "string" || !UUID.test(row.id)
    || typeof row.runId !== "string" || !UUID.test(row.runId)
    || typeof row.slug !== "string" || !SLUG.test(row.slug)
    || !(row.replacePublicationId === null
      || (typeof row.replacePublicationId === "string" && UUID.test(row.replacePublicationId)))
    || !(row.visibility === "unlisted" || row.visibility === "public")
    || typeof row.searchIndexable !== "boolean"
    || (row.searchIndexable && row.visibility !== "public")) {
    throw new Error("Invalid Analysis Article publication request");
  }
  return {
    id: row.id,
    runId: row.runId,
    slug: row.slug,
    replacePublicationId: row.replacePublicationId as string | null,
    visibility: row.visibility,
    searchIndexable: row.searchIndexable,
  };
}

export function buildAnalysisPublicSnapshot(input: {
  request: AnalysisPublicationRequest;
  definition: AnalysisArticleDefinition;
  publishedAt: Date;
}): AnalysisPublicSnapshot {
  return parseAnalysisPublicSnapshot({
    version: 2,
    title: input.definition.title,
    html: input.definition.html,
    publishedAt: input.publishedAt.toISOString(),
    searchIndexable: input.request.searchIndexable,
  });
}

function parseCurrentSnapshot(value: unknown): AnalysisPublicSnapshot | null {
  const row = exactRecord(value, ["version", "title", "html", "publishedAt", "searchIndexable"]);
  const title = text(row?.title, 160);
  const publishedAt = typeof row?.publishedAt === "string" ? new Date(row.publishedAt) : null;
  if (!row || row.version !== 2 || title === null || !publishedAt
    || Number.isNaN(publishedAt.valueOf()) || typeof row.searchIndexable !== "boolean") return null;
  return {
    version: 2,
    title,
    html: sanitizeAnalysisArticleHtml(row.html),
    publishedAt: publishedAt.toISOString(),
    searchIndexable: row.searchIndexable,
  };
}

function migrateLegacySnapshot(value: unknown): AnalysisPublicSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.version !== 1) return null;
  const title = text(row.title, 160);
  const description = text(row.description, 2_000, true);
  const summary = text(row.summary, 20_000, true);
  const publishedAt = typeof row.dataAsOf === "string" ? new Date(row.dataAsOf) : null;
  if (title === null || description === null || summary === null || !publishedAt
    || Number.isNaN(publishedAt.valueOf()) || typeof row.searchIndexable !== "boolean"
    || !Array.isArray(row.blocks)) return null;
  const parts = [paragraph(description), paragraph(summary)];
  for (const valueBlock of row.blocks.slice(0, 128)) {
    if (!valueBlock || typeof valueBlock !== "object" || Array.isArray(valueBlock)) continue;
    const block = valueBlock as Record<string, unknown>;
    const config = block.config && typeof block.config === "object" && !Array.isArray(block.config)
      ? block.config as Record<string, unknown> : null;
    if (block.kind === "heading" && typeof config?.text === "string") {
      parts.push(`<h2>${escapeHtmlText(config.text.slice(0, 1_000))}</h2>`);
    } else if ((block.kind === "markdown" || block.kind === "callout")
      && typeof config?.markdown === "string") {
      parts.push(paragraph(config.markdown.slice(0, 100_000)));
    } else if (block.kind === "divider") {
      parts.push("<hr>");
    }
  }
  return {
    version: 2,
    title,
    html: sanitizeAnalysisArticleHtml(parts.join("")),
    publishedAt: publishedAt.toISOString(),
    searchIndexable: row.searchIndexable,
  };
}

export function parseAnalysisPublicSnapshot(value: unknown): AnalysisPublicSnapshot {
  const snapshot = parseCurrentSnapshot(value) ?? migrateLegacySnapshot(value);
  if (!snapshot) throw new Error("Invalid public Analysis Article snapshot");
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 300 * 1024) {
    throw new Error("Public Analysis Article snapshot is too large");
  }
  return snapshot;
}
