// Desktop-owned local diagnostics wire shape; logs never enter workspace sync.
export type DiagnosticEntry = {
  timestamp: string;
  level: string;
  source: string;
  text: string;
};

export type DiagnosticSnapshot = {
  enabled: boolean;
  generation: number;
  appVersion: string;
  platform: string;
  architecture: string;
  dropped: number;
  entries: DiagnosticEntry[];
};

export type FrontendDiagnostic = Pick<DiagnosticEntry, "level" | "source" | "text">;

export function formatDiagnosticLog(snapshot: DiagnosticSnapshot) {
  return [
    `DopeDB ${snapshot.appVersion} | ${snapshot.platform} ${snapshot.architecture}`,
    `UTC timestamps | dropped entries: ${snapshot.dropped}`,
    ...snapshot.entries.map((entry) => `${entry.timestamp} ${entry.level} [${entry.source}] ${entry.text}`),
  ].join("\n");
}
