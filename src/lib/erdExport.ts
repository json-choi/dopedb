// Deterministic ERD export independent of the React Flow DOM. SVG is the source
// artifact; PNG and PDF are derived locally so schema metadata never leaves the app.
import type { CatalogSnapshot } from "../ipc/types";
import { ERD_EXPORT_PALETTE } from "../design-system/artifactPalettes";
import type {
  ErdCanvasLayout,
  ErdLayoutMode,
  ErdVirtualRelation,
} from "../features/erd/domain";
import type { ErdGraph } from "./erdGraph";
import type { ErdPositions } from "./erdLayout";
import { relationDisplayName } from "./erdGraph";

const NODE_WIDTH = 272;

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function nodeHeight(columnCount: number, compact: boolean) {
  return compact ? 58 : Math.min(340, 76 + columnCount * 24);
}

function safeName(value: string) {
  return (
    value
      .trim()
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "erd"
  );
}

function bounds(graph: ErdGraph, positions: ErdPositions, compact: boolean) {
  if (graph.nodes.length === 0) {
    return { minX: 0, minY: 0, width: 640, height: 360 };
  }
  const margin = 48;
  const xs = graph.nodes.map((node) => positions[node.id]?.x ?? 0);
  const ys = graph.nodes.map((node) => positions[node.id]?.y ?? 0);
  const maxXs = graph.nodes.map(
    (node) => (positions[node.id]?.x ?? 0) + NODE_WIDTH,
  );
  const maxYs = graph.nodes.map(
    (node) =>
      (positions[node.id]?.y ?? 0) +
      nodeHeight(node.relation.columns.length, compact),
  );
  const minX = Math.min(...xs) - margin;
  const minY = Math.min(...ys) - margin;
  return {
    minX,
    minY,
    width: Math.max(640, Math.max(...maxXs) - minX + margin),
    height: Math.max(360, Math.max(...maxYs) - minY + margin),
  };
}

export function createErdSvg(
  graph: ErdGraph,
  positions: ErdPositions,
  compact: boolean,
): string {
  const frame = bounds(graph, positions, compact);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = graph.edges
    .map((edge) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) return "";
      const from = positions[edge.source] ?? { x: 0, y: 0 };
      const to = positions[edge.target] ?? { x: 0, y: 0 };
      const x1 = from.x + NODE_WIDTH / 2;
      const y1 =
        from.y + nodeHeight(source.relation.columns.length, compact) / 2;
      const x2 = to.x + NODE_WIDTH / 2;
      const y2 = to.y + nodeHeight(target.relation.columns.length, compact) / 2;
      const offset = Math.max(40, Math.abs(x2 - x1) * 0.45);
      const path = `M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x2 - offset} ${y2}, ${x2} ${y2}`;
      return `<path d="${path}" fill="none" stroke="${edge.virtual ? ERD_EXPORT_PALETTE.virtualEdge : ERD_EXPORT_PALETTE.edge}" stroke-width="${edge.virtual ? 2 : 1.25}"${edge.virtual ? ' stroke-dasharray="7 5"' : ""}/>`;
    })
    .join("");
  const nodes = graph.nodes
    .map((node) => {
      const position = positions[node.id] ?? { x: 0, y: 0 };
      const height = nodeHeight(node.relation.columns.length, compact);
      const label = escapeXml(relationDisplayName(node.relation.object));
      const columns = compact
        ? ""
        : node.relation.columns
            .slice(0, 11)
            .map(
              (column, index) =>
                `<text x="${position.x + 16}" y="${position.y + 67 + index * 24}" fill="${ERD_EXPORT_PALETTE.columnName}" font-size="12" font-family="ui-monospace, monospace">${escapeXml(column.name)}<tspan x="${position.x + NODE_WIDTH - 16}" text-anchor="end" fill="${ERD_EXPORT_PALETTE.columnType}">${escapeXml(column.nativeType)}</tspan></text>`,
            )
            .join("");
      return `<g><rect x="${position.x}" y="${position.y}" width="${NODE_WIDTH}" height="${height}" rx="8" fill="${ERD_EXPORT_PALETTE.nodeSurface}" stroke="${ERD_EXPORT_PALETTE.nodeBorder}"/><text x="${position.x + 16}" y="${position.y + 34}" fill="${ERD_EXPORT_PALETTE.nodeTitle}" font-size="14" font-weight="600" font-family="'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif">${label}</text>${columns}</g>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="${frame.minX} ${frame.minY} ${frame.width} ${frame.height}"><rect x="${frame.minX}" y="${frame.minY}" width="${frame.width}" height="${frame.height}" fill="${ERD_EXPORT_PALETTE.canvas}"/>${edges}${nodes}</svg>`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function downloadErdSvg(
  name: string,
  graph: ErdGraph,
  positions: ErdPositions,
  compact: boolean,
) {
  downloadBlob(
    new Blob([createErdSvg(graph, positions, compact)], {
      type: "image/svg+xml;charset=utf-8",
    }),
    `${safeName(name)}.svg`,
  );
}

async function svgToPngData(
  graph: ErdGraph,
  positions: ErdPositions,
  compact: boolean,
) {
  const svg = createErdSvg(graph, positions, compact);
  const source = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = source;
    await image.decode();
    const maxSide = 12_000;
    const scale = Math.min(
      2,
      maxSide / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.floor(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG canvas is unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    URL.revokeObjectURL(source);
  }
}

export async function downloadErdPng(
  name: string,
  graph: ErdGraph,
  positions: ErdPositions,
  compact: boolean,
) {
  const png = await svgToPngData(graph, positions, compact);
  const response = await fetch(png.dataUrl);
  downloadBlob(await response.blob(), `${safeName(name)}.png`);
}

export async function downloadErdPdf(
  name: string,
  graph: ErdGraph,
  positions: ErdPositions,
  compact: boolean,
) {
  const [{ jsPDF }, png] = await Promise.all([
    import("jspdf"),
    svgToPngData(graph, positions, compact),
  ]);
  const landscape = png.width >= png.height;
  const pageWidth = landscape ? 841.89 : 595.28;
  const pageHeight = landscape ? 595.28 : 841.89;
  const scale = Math.min(
    (pageWidth - 36) / png.width,
    (pageHeight - 36) / png.height,
  );
  const pdf = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "pt",
    format: "a4",
    compress: true,
  });
  pdf.addImage(
    png.dataUrl,
    "PNG",
    18,
    18,
    png.width * scale,
    png.height * scale,
    undefined,
    "FAST",
  );
  pdf.save(`${safeName(name)}.pdf`);
}

export interface ErdShareDocument {
  schemaVersion: 1;
  catalogFingerprint: string;
  database: string;
  mode: ErdLayoutMode;
  layout: ErdCanvasLayout;
  virtualRelations: ErdVirtualRelation[];
  exportedAt: string;
}

export function createErdShareDocument(
  snapshot: CatalogSnapshot,
  mode: ErdLayoutMode,
  layout: ErdCanvasLayout,
  virtualRelations: ErdVirtualRelation[],
): ErdShareDocument {
  return {
    schemaVersion: 1,
    catalogFingerprint: snapshot.fingerprint,
    database: snapshot.database,
    mode,
    layout,
    virtualRelations,
    exportedAt: new Date().toISOString(),
  };
}

export function downloadErdShare(name: string, document: ErdShareDocument) {
  downloadBlob(
    new Blob([JSON.stringify(document, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
    `${safeName(name)}.erd.json`,
  );
}
