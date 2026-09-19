// Action Search projection of one connection's documents: the tabs already open and
// the saved SQL documents a member closed and may reopen. Closing a tab keeps the
// document, so both belong to the same searchable list rather than to two features.

import { useQuery } from "@tanstack/react-query";

import { useI18n } from "../../lib/i18n";
import type { CatalogScope } from "../../lib/queries";
import { databaseDisplayLabel, type ConnectionProfile } from "../connections/domain";
import type { SqlDocument } from "../sqlDocuments/domain";
import { sqlDocumentsQuery } from "../sqlDocuments/queries";
import type { WorkbenchDocument } from "../workbench/domain";
import type { ActionSearchItem } from "./domain";

type DocumentItemsInput = {
  open: boolean;
  scope: CatalogScope;
  selected: ConnectionProfile | null;
  documents: readonly WorkbenchDocument[];
  supportsSql: boolean;
  activate: (document: WorkbenchDocument) => void;
  openSaved: (document: SqlDocument) => void;
};

export function useDocumentActionSearchItems({
  open,
  scope,
  selected,
  documents,
  supportsSql,
  activate,
  openSaved,
}: DocumentItemsInput): readonly ActionSearchItem[] {
  const { t } = useI18n();
  // Only read the saved set while the palette is actually open.
  const saved = useQuery({
    ...sqlDocumentsQuery(scope.key, selected?.id ?? ""),
    enabled: open && scope.ready && supportsSql && selected !== null,
  });
  const connectionLabel =
    selected?.name ||
    (selected
      ? databaseDisplayLabel(selected.engine, selected.database)
      : t("app.unnamed"));

  const openItems: ActionSearchItem[] = documents.map((document) => ({
    id: `document:${document.id}`,
    kind: "document",
    label:
      document.kind === "sql"
        ? document.title
        : document.kind === "data"
          ? [document.table.schema, document.table.name]
              .filter(Boolean)
              .join(".")
          : document.kind === "schema"
            ? t("tabs.schema")
            : document.kind === "welcome"
              ? t("onboarding.title")
              : document.kind === "results"
                ? t("sql.executionResults")
                : document.kind === "activity"
                  ? t("tabs.activity")
                  : t("tabs.documents"),
    detail: connectionLabel,
    keywords: [document.kind],
    run: () => activate(document),
  }));

  const openPersistedIds = new Set(
    documents.flatMap((document) =>
      document.kind === "sql" && document.persistedId
        ? [document.persistedId]
        : [],
    ),
  );
  const savedItems: ActionSearchItem[] = (saved.data ?? [])
    .filter((document) => !openPersistedIds.has(document.id))
    .map((document) => ({
      id: `savedQuery:${document.id}`,
      kind: "document",
      label: document.title,
      detail: t("sql.openSavedQuery"),
      keywords: ["sql", "query", "saved", "reopen", "쿼리", "저장", "다시 열기"],
      run: () => openSaved(document),
    }));

  return [...openItems, ...savedItems];
}
