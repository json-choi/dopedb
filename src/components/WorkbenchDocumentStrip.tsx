import { useEffect, useRef, useState } from "react";

import type { ConnectionProfile } from "../features/connections/domain";
import type { WorkbenchDocument } from "../features/workbench/domain";
import {
  IdeTab,
  IdeTabStrip,
} from "../design-system/components/IdeTabs";
import { Button } from "../design-system/components/Button";
import { tableLabel } from "../lib/tableRef";
import { useI18n } from "../lib/i18n";
import { Icon, type IconName } from "./Icon";
import ToolbarMenu, { ToolbarMenuItem } from "./ToolbarMenu";

export default function WorkbenchDocumentStrip({
  documents,
  activeId,
  engine,
  connectionName,
  onActivate,
  onRename,
  onClose,
}: {
  documents: WorkbenchDocument[];
  activeId: string | null;
  engine: ConnectionProfile["engine"];
  connectionName: string;
  onActivate: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onClose: (id: string) => void;
}) {
  const { t } = useI18n();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const activeTabRef = useRef<HTMLDivElement>(null);
  const visibleDocuments = documents;
  const hasVisibleActiveDocument = visibleDocuments.some(
    (document) => document.id === activeId,
  );
  const keyboardFallbackId = visibleDocuments[0]?.id ?? null;

  function label(document: WorkbenchDocument, index: number) {
    if (document.kind === "data") {
      return `${tableLabel(engine, document.table)} [${connectionName}]`;
    }
    if (document.kind === "welcome") return t("onboarding.title");
    if (document.kind === "schema") return t("tabs.schema");
    if (document.kind === "activity") return t("tabs.activity");
    if (document.kind === "documents") return `${t("tabs.documents")} ${index + 1}`;
    if (document.kind === "sql") {
      const title = document.title || `${t("tabs.sql")} ${index + 1}`;
      return `${title} [${connectionName}]`;
    }
    return t("tabs.schema");
  }

  function icon(document: WorkbenchDocument): IconName {
    if (document.kind === "data") return "table";
    if (document.kind === "welcome") return "gear";
    if (document.kind === "schema") return "grid";
    if (document.kind === "activity") return "chart";
    if (document.kind === "documents") return "list";
    return "play";
  }

  let queryIndex = 0;
  const presentedDocuments = visibleDocuments.map((document) => {
    const index =
      document.kind === "sql" || document.kind === "documents" ? queryIndex++ : 0;
    return { document, title: label(document, index) };
  });

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeId, visibleDocuments.length]);

  function finishRename(id: string) {
    const title = renameValue.trim();
    if (title) onRename(id, title);
    setRenamingId(null);
  }

  return (
    <IdeTabStrip
      label={t("app.workbenchNavigation")}
      actions={
        <ToolbarMenu
          label={t("tabs.openDocuments")}
          icon="moreVertical"
          disabled={presentedDocuments.length === 0}
        >
          {presentedDocuments.map(({ document, title }) => {
            const active = document.id === activeId;
            return (
              <ToolbarMenuItem
                key={document.id}
                icon={active ? "check" : icon(document)}
                aria-current={active ? "page" : undefined}
                onClick={() => onActivate(document.id)}
                title={title}
              >
                <span className="tw:max-w-[320px] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                  {title}
                </span>
              </ToolbarMenuItem>
            );
          })}
        </ToolbarMenu>
      }
    >
        {presentedDocuments.map(({ document, title }) => {
          const active = activeId === document.id;
          const renaming =
            document.kind === "sql" && renamingId === document.id;
          return (
            <IdeTab
              tabRef={active ? activeTabRef : undefined}
              active={active}
              title={title}
              // `IdeTab` defaults to `active ? 0 : -1`, but `activeId` is the
              // workbench-wide document and this strip only renders the selected
              // connection's documents. Without this fallback a strip whose
              // active document belongs to another connection would expose no
              // Tab stop at all.
              tabIndex={
                active || (!hasVisibleActiveDocument && document.id === keyboardFallbackId)
                  ? 0
                  : -1
              }
              onActivate={() => onActivate(document.id)}
              onDoubleClick={() => {
                if (document.kind !== "sql") return;
                setRenameValue(document.title);
                setRenamingId(document.id);
              }}
              editing={renaming ? (
                <input
                  autoFocus
                  className="tw:m-1 tw:min-w-0 tw:flex-1 tw:border-border-strong tw:bg-background tw:px-1 tw:text-sm tw:text-foreground"
                  value={renameValue}
                  aria-label={t("sql.documentTitle")}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onBlur={() => finishRename(document.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      finishRename(document.id);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setRenamingId(null);
                    }
                  }}
                />
              ) : undefined}
              trailing={
                <Button
                  iconOnly
                  size="xs"
                  variant="ghost"
                  onClick={() => onClose(document.id)}
                  title={t("common.close")}
                  aria-label={`${t("common.close")}: ${title}`}
                >
                  <Icon name="close" />
                </Button>
              }
              key={document.id}
            >
              <Icon name={icon(document)} />
              <span>{title}</span>
            </IdeTab>
          );
        })}
    </IdeTabStrip>
  );
}
