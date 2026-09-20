// Document category of the action palette. It owns the label each workbench
// document kind gets and the reopen entry for persisted SQL documents the member
// closed, which is the only way back onto the strip. It runs nothing itself.

import { databaseDisplayLabel, type ConnectionProfile } from "../connections/domain";
import type {
  SqlWorkbenchDocument,
  WorkbenchDocument,
} from "../workbench/domain";
import type { I18nKey } from "../../lib/i18n";
import type { ActionSearchItem } from "./domain";

type Translate = (
  key: I18nKey,
  vars?: Record<string, string | number>,
) => string;

function documentLabel(t: Translate, document: WorkbenchDocument): string {
  switch (document.kind) {
    case "sql":
      return document.title;
    case "data":
      return [document.table.schema, document.table.name]
        .filter(Boolean)
        .join(".");
    case "schema":
      return t("tabs.schema");
    case "welcome":
      return t("onboarding.title");
    case "results":
      return t("sql.executionResults");
    case "activity":
      return t("tabs.activity");
    case "documents":
      return t("tabs.documents");
  }
}

function connectionLabel(
  t: Translate,
  selected: ConnectionProfile | null,
): string {
  if (!selected) return t("app.unnamed");
  return (
    selected.name || databaseDisplayLabel(selected.engine, selected.database)
  );
}

export function documentSearchItems({
  t,
  selected,
  documents,
  closedDocuments,
  activateDocument,
}: {
  t: Translate;
  selected: ConnectionProfile | null;
  documents: readonly WorkbenchDocument[];
  closedDocuments: readonly SqlWorkbenchDocument[];
  activateDocument: (document: WorkbenchDocument) => void;
}): ActionSearchItem[] {
  const detail = connectionLabel(t, selected);
  return [
    ...documents.map((document) => ({
      id: `document:${document.id}`,
      kind: "document" as const,
      label: documentLabel(t, document),
      detail,
      keywords: [document.kind],
      run: () => activateDocument(document),
    })),
    // Closing a tab keeps its document, so a closed one stays reachable here.
    ...closedDocuments.map((document) => ({
      id: `document:closed:${document.id}`,
      kind: "document" as const,
      label: document.title,
      detail: [t("ide.search.closedDocument"), detail].join(" · "),
      keywords: ["sql", "closed", "reopen", "닫힌", "다시 열기"],
      run: () => activateDocument(document),
    })),
  ];
}
