import { useQueryClient } from "@tanstack/react-query";

import type { CatalogTable } from "../../ipc/types";
import { errMessage } from "../../ipc/types";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../lib/i18n";
import {
  databaseCatalogQuery,
  type CatalogScope,
} from "../../lib/queries";
import { filterCatalogOverview } from "../catalogExplorer/scopeFilter";
import {
  databaseDisplayLabel,
  type ConnectionProfile,
} from "../connections/domain";
import type { SettingsSection } from "../settings/domain";
import type { WorkbenchDocument } from "../workbench/domain";
import { useCachedCatalogOverviews } from "./catalogCache";
import type { ActionSearchItem } from "./domain";

type ActionSearchItemsInput = {
  open: boolean;
  scope: CatalogScope;
  connections: readonly ConnectionProfile[];
  selected: ConnectionProfile | null;
  documents: readonly WorkbenchDocument[];
  supportsSql: boolean;
  commands: {
    newConnection: () => void;
    newQuery: () => void | Promise<void>;
    toggleDatabaseExplorer: () => void;
    showLocalHistory: () => void;
    toggleServices: () => void;
    openAgent: () => void;
    openSettings: (section?: SettingsSection) => void;
    selectConnection: (id: string) => void;
    activateDocument: (document: WorkbenchDocument) => void;
    openTable: (connection: ConnectionProfile, table: CatalogTable) => void;
  };
};

/** Builds the searchable command/catalog projection without leaking query cache ownership to AppShell. */
export function useActionSearchItems({
  open,
  scope,
  connections,
  selected,
  documents,
  supportsSql,
  commands,
}: ActionSearchItemsInput): readonly ActionSearchItem[] {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const catalogTargets = useCachedCatalogOverviews(
    queryClient,
    connections,
    scope.key,
    open && scope.ready,
  );
  const visibleDatabase = (connection: ConnectionProfile, database: string) =>
    databaseDisplayLabel(connection.engine, database);

  const actions: ActionSearchItem[] = [
    {
      id: "action:new-data-source",
      kind: "action",
      label: t("connections.new"),
      keywords: ["database", "connection", "source", "연결"],
      run: commands.newConnection,
    },
    {
      id: "action:new-query",
      kind: "action",
      label: t("ide.action.newQuery"),
      keywords: ["sql", "console", "query", "쿼리"],
      shortcut: "⌘N",
      disabled: !selected || !supportsSql,
      run: commands.newQuery,
    },
    {
      id: "action:database-explorer",
      kind: "action",
      label: t("ide.action.databaseExplorer"),
      keywords: ["tool window", "schema", "tables", "탐색기"],
      run: commands.toggleDatabaseExplorer,
    },
    {
      id: "action:local-history",
      kind: "action",
      label: t("localHistory.title"),
      keywords: ["tool window", "revision", "restore", "history", "기록"],
      disabled: !selected || !supportsSql,
      run: commands.showLocalHistory,
    },
    {
      id: "action:services",
      kind: "action",
      label: t("services.title"),
      keywords: ["tool window", "output", "result", "session"],
      run: commands.toggleServices,
    },
    {
      id: "action:ai-chat",
      kind: "action",
      label: t("agent.acpTitle"),
      keywords: ["codex", "agent", "acp"],
      disabled: !selected,
      run: commands.openAgent,
    },
    {
      id: "action:settings",
      kind: "action",
      label: t("common.settings"),
      keywords: ["preferences", "설정"],
      shortcut: "⌘,",
      run: () => commands.openSettings(),
    },
  ];

  const connectionItems: ActionSearchItem[] = connections.map(
    (connection) => ({
      id: `connection:${connection.id}`,
      kind: "connection",
      label: connection.name || t("app.unnamed"),
      detail: [
        connection.engine,
        connection.providerTarget?.branchName ??
          connection.providerTarget?.branchId,
        connection.host,
        visibleDatabase(connection, connection.database),
      ]
        .filter(Boolean)
        .join(" · "),
      keywords: [
        connection.provider,
        connection.providerTarget?.branchId ?? "",
        connection.providerTarget?.branchName ?? "",
        connection.env ?? "",
        connection.username,
      ],
      run: () => commands.selectConnection(connection.id),
    }),
  );

  const documentItems: ActionSearchItem[] = documents.map((document) => {
    const label =
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
              : document.kind === "activity"
                ? t("tabs.activity")
                : t("tabs.documents");
    return {
      id: `document:${document.id}`,
      kind: "document",
      label,
      detail:
        selected?.name ||
        (selected
          ? visibleDatabase(selected, selected.database)
          : t("app.unnamed")),
      keywords: [document.kind],
      run: () => commands.activateDocument(document),
    };
  });

  const connectionById = new Map(
    connections.map((connection) => [connection.id, connection]),
  );
  const databaseObjects: ActionSearchItem[] = catalogTargets.flatMap(
    (target) => {
      const connection = connectionById.get(target.connectionId);
      if (!connection) return [];
      const overview = filterCatalogOverview(
        { ...connection, database: target.database },
        target.overview,
      );
      return overview.relations.map((relation) => ({
        id: `object:${connection.id}:${target.database}:${relation.schema ?? ""}:${relation.name}:${relation.kind}`,
        kind: "databaseObject" as const,
        label: [relation.schema, relation.name].filter(Boolean).join("."),
        detail: [
          connection.name || visibleDatabase(connection, connection.database),
          target.database !== connection.database
            ? visibleDatabase(connection, target.database)
            : null,
          t(
            relation.kind === "view"
              ? "schemaDiff.objectView"
              : "schemaDiff.objectTable",
          ),
        ]
          .filter(Boolean)
          .join(" · "),
        keywords: [
          connection.engine,
          target.database,
          relation.comment ?? "",
        ],
        run: async () => {
          try {
            const catalog = await queryClient.fetchQuery(
              databaseCatalogQuery(connection.id, target.database, scope),
            );
            const table = catalog.tables.find(
              (candidate) =>
                candidate.name === relation.name &&
                candidate.schema === relation.schema &&
                candidate.kind === relation.kind,
            );
            if (table) commands.openTable(connection, table);
            else commands.selectConnection(connection.id);
          } catch (error) {
            toast(errMessage(error), "error");
          }
        },
      }));
    },
  );

  const settings: ActionSearchItem[] = (
    [
      ["agent-tools", t("settings.agentTools"), false],
      ["cli", t("settings.cli"), false],
      ["privacy", t("settings.privacy"), false],
      ["safety", t("settings.safety"), !selected],
      ["language", t("settings.languageTitle"), false],
      ["updates", t("settings.updates"), false],
    ] satisfies ReadonlyArray<readonly [SettingsSection, string, boolean]>
  ).map(([section, label, disabled]) => ({
    id: `setting:${section}`,
    kind: "setting",
    label,
    detail: t("common.settings"),
    disabled,
    keywords: [section],
    run: () => commands.openSettings(section),
  }));

  return [
    ...actions,
    ...connectionItems,
    ...documentItems,
    ...databaseObjects,
    ...settings,
  ];
}
