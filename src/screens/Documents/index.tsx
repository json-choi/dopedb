// Ad-hoc read-only document query console for MongoDB connections (the "documents"
// tab's counterpart to the SQL console). find/aggregate/count are built from JSON
// textareas, parsed client-side, then run through a durable single-use read plan.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  proposeDocumentQuery,
  runDocumentQuery,
} from "../../features/documentQueries/tauriAdapter";
import type {
  DocumentPage,
  DocumentQuery,
  JsonValue,
  QueryResult,
} from "../../ipc/types";
import { errMessage } from "../../ipc/types";
import type { ConnectionProfile } from "../../features/connections/domain";
import DataGrid from "../../features/queryResults/DataGrid";
import { Icon } from "../../components/Icon";
import ResultToolbar from "../../features/queryResults/ResultToolbar";
import { Button } from "../../design-system/components/Button";
import { InlineNotice } from "../../design-system/components/Status";
import {
  WorkbenchDivider,
  WorkbenchContainedBody,
  ResultMeta,
  WorkbenchEmptyState,
  WorkbenchPane,
  WorkbenchSelect,
  WorkbenchToolbar,
} from "../../design-system/components/Workbench";
import {
  Field,
  TextAreaInput,
  TextInput,
} from "../../design-system/components/FormControls";
import { catalogQuery, useCatalogScope } from "../../lib/queries";
import { documentsToGrid } from "../../lib/documentGrid";
import { stamp } from "../../lib/export";
import { useI18n } from "../../lib/i18n";
import { useQueryRun } from "../../lib/useQueryRun";

type Op = "find" | "aggregate" | "count";

function parseJsonField(text: string, label: string): JsonValue | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    throw new Error(`${label}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function isDocumentQueryShape(value: unknown): value is DocumentQuery {
  return (
    typeof value === "object" &&
    value !== null &&
    "op" in value &&
    "collection" in value
  );
}

export default function Documents({
  connection,
  draft,
}: {
  connection: ConnectionProfile;
  draft?: string | null;
}) {
  const { t } = useI18n();
  const catalogScope = useCatalogScope();
  const catalog = useQuery(catalogQuery(connection.id, catalogScope));
  const tables = useMemo(
    () => catalog.data?.tables ?? [],
    [catalog.data?.tables],
  );

  const [collection, setCollection] = useState("");
  useEffect(() => {
    if (!collection && tables.length > 0) setCollection(tables[0].name);
  }, [tables, collection]);

  const [op, setOp] = useState<Op>("find");
  const [filterText, setFilterText] = useState("");
  const [projectionText, setProjectionText] = useState("");
  const [sortText, setSortText] = useState("");
  const [limit, setLimit] = useState(100);
  const [pipelineText, setPipelineText] = useState("[]");
  const [countFilterText, setCountFilterText] = useState("");

  // Loads an Activity row's replayed query (JSON-serialized DocumentQuery, see
  // App.tsx's loadSql) into the form. `draft` itself is the effect dependency, so a
  // reapplied identical string never loops and there is no separate "consumed" flag.
  useEffect(() => {
    if (draft == null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (e) {
      console.warn("failed to parse document draft:", e);
      return;
    }
    if (!isDocumentQueryShape(parsed)) {
      console.warn("document draft is not a DocumentQuery:", parsed);
      return;
    }
    setCollection(parsed.collection);
    setOp(parsed.op);
    if (parsed.op === "find") {
      setFilterText(
        parsed.filter !== undefined
          ? JSON.stringify(parsed.filter, null, 2)
          : "",
      );
      setProjectionText(
        parsed.projection !== undefined
          ? JSON.stringify(parsed.projection, null, 2)
          : "",
      );
      setSortText(
        parsed.sort !== undefined ? JSON.stringify(parsed.sort, null, 2) : "",
      );
      if (typeof parsed.limit === "number") setLimit(parsed.limit);
    } else if (parsed.op === "aggregate") {
      setPipelineText(JSON.stringify(parsed.pipeline, null, 2));
    } else if (parsed.op === "count") {
      setCountFilterText(
        parsed.filter !== undefined
          ? JSON.stringify(parsed.filter, null, 2)
          : "",
      );
    }
  }, [draft]);

  const {
    running,
    cancelled,
    execute: runQuery,
    cancel,
    track,
  } = useQueryRun();
  const [result, setResult] = useState<{
    page: DocumentPage;
    at: string;
  } | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);

  function buildQuery(): DocumentQuery | null {
    try {
      if (op === "find") {
        return {
          op: "find",
          collection,
          filter: parseJsonField(filterText, t("documents.filter")),
          projection: parseJsonField(projectionText, t("documents.projection")),
          sort: parseJsonField(sortText, t("documents.sort")),
          limit,
        };
      }
      if (op === "aggregate") {
        const pipeline =
          parseJsonField(pipelineText, t("documents.pipeline")) ?? [];
        if (!Array.isArray(pipeline)) throw new Error(t("documents.pipeline"));
        return { op: "aggregate", collection, pipeline };
      }
      return {
        op: "count",
        collection,
        filter: parseJsonField(countFilterText, t("documents.filter")),
      };
    } catch (e) {
      setParseErr(errMessage(e));
      return null;
    }
  }

  async function execute() {
    if (!collection || running) return;
    setParseErr(null);
    setRunErr(null);
    const query = buildQuery();
    if (!query) return;

    try {
      await runQuery(async () => {
        const proposal = await proposeDocumentQuery(
          connection.id,
          query,
          "manual",
        );
        track(proposal.operationId);
        const page = await runDocumentQuery(proposal.operationId);
        setResult({ page, at: new Date().toLocaleTimeString() });
      });
    } catch (e) {
      setRunErr(errMessage(e));
      setResult(null);
    }
  }

  const grid = useMemo(
    () => documentsToGrid(result?.page.documents ?? []),
    [result],
  );
  const gridResult: QueryResult = {
    columns: grid.columns,
    rows: grid.rows,
    rowCount: result?.page.docCount ?? 0,
    truncated: result?.page.truncated ?? false,
    durationMs: result?.page.durationMs ?? 0,
  };

  return (
    <WorkbenchPane>
      <WorkbenchToolbar label={t("documents.title")} compact>
        <div className="ds-control-row scrollbar-sleek tw:flex tw:min-h-0 tw:min-w-0 tw:flex-[0_1_auto] tw:flex-nowrap tw:items-center tw:gap-1 tw:overflow-x-auto tw:overflow-y-hidden">
          <Button
            disabled={!collection || running}
            iconOnly
            onClick={() => void execute()}
            size="compact"
            tone="success"
            title={running ? t("documents.running") : t("documents.run")}
            aria-label={running ? t("documents.running") : t("documents.run")}
            variant="ghost"
          >
            <Icon name={running ? "refresh" : "play"} />
          </Button>
          <Button
            disabled={!running}
            iconOnly
            onClick={cancel}
            size="compact"
            title={t("documents.cancel")}
            aria-label={t("documents.cancel")}
            variant="ghost"
          >
            <Icon name="stop" />
          </Button>
          <WorkbenchDivider />
          <WorkbenchSelect
            label={t("documents.operation")}
            value={op}
            disabled={running}
            onChange={(value) => setOp(value as Op)}
          >
            <option value="find">find</option>
            <option value="aggregate">aggregate</option>
            <option value="count">count</option>
          </WorkbenchSelect>
        </div>
        <span className="tw:min-w-1 tw:flex-1" />
        <WorkbenchSelect
          label={t("documents.collection")}
          icon="database"
          value={collection}
          disabled={running || tables.length === 0}
          onChange={setCollection}
        >
          {catalog.error ? (
            <option value="">{t("documents.collectionsUnavailable")}</option>
          ) : tables.length === 0 ? (
            <option value="">{t("documents.noCollections")}</option>
          ) : null}
          {tables.map((table) => (
            <option key={table.name} value={table.name}>
              {table.name}
            </option>
          ))}
        </WorkbenchSelect>
      </WorkbenchToolbar>

      <WorkbenchContainedBody>
        {/* Without this branch a failed collection introspection is indistinguishable from
            a database that simply has no collections. */}
        {catalog.error ? (
          <InlineNotice
            tone="danger"
            icon="alert"
            role="alert"
            action={
              <Button
                size="compact"
                disabled={catalog.isFetching}
                onClick={() => void catalog.refetch()}
              >
                {t("app.retry")}
              </Button>
            }
          >
            {t("documents.collectionsFailed", {
              error: errMessage(catalog.error),
            })}
          </InlineNotice>
        ) : null}
        <div
          data-result={Boolean(result)}
          data-workbench-scroll-owner="document-controls"
          className="scrollbar-sleek tw:min-h-0 tw:flex-1 tw:overflow-auto tw:overscroll-contain tw:data-[result=true]:max-h-[45%] tw:data-[result=true]:flex-none"
        >
          {op === "find" && (
            <div className="tw:grid tw:shrink-0 tw:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] tw:gap-3 tw:border-b tw:border-border-subtle tw:p-3 tw:@max-[760px]:grid-cols-1">
              <Field label={t("documents.filter")}>
                <TextAreaInput
                  rows={3}
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="{}"
                />
              </Field>
              <Field label={t("documents.projection")}>
                <TextAreaInput
                  rows={3}
                  value={projectionText}
                  onChange={(e) => setProjectionText(e.target.value)}
                  placeholder="{}"
                />
              </Field>
              <Field label={t("documents.sort")}>
                <TextAreaInput
                  rows={3}
                  value={sortText}
                  onChange={(e) => setSortText(e.target.value)}
                  placeholder="{}"
                />
              </Field>
              <div className="tw:w-[120px]">
                <Field label={t("documents.limit")}>
                  <TextInput
                    type="number"
                    min={1}
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value) || 100)}
                  />
                </Field>
              </div>
            </div>
          )}
          {op === "aggregate" && (
            <div className="tw:shrink-0 tw:border-b tw:border-border-subtle tw:p-3">
              <Field label={t("documents.pipeline")}>
                <TextAreaInput
                  rows={8}
                  value={pipelineText}
                  onChange={(e) => setPipelineText(e.target.value)}
                  placeholder="[]"
                />
              </Field>
            </div>
          )}
          {op === "count" && (
            <div className="tw:shrink-0 tw:border-b tw:border-border-subtle tw:p-3">
              <Field label={t("documents.filter")}>
                <TextAreaInput
                  rows={4}
                  value={countFilterText}
                  onChange={(e) => setCountFilterText(e.target.value)}
                  placeholder="{}"
                />
              </Field>
            </div>
          )}

          {parseErr && (
            <div className="tw:px-3 tw:py-2 tw:text-ui tw:text-danger">
              {parseErr}
            </div>
          )}
          {runErr && (
            <div className="tw:px-3 tw:py-2 tw:text-ui tw:text-danger">
              {runErr}
            </div>
          )}
          {cancelled && (
            <div className="tw:px-3 tw:py-2 tw:text-ui tw:text-muted-foreground">
              {t("documents.cancelled")}
            </div>
          )}
        </div>

        {result && (
          <div className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col">
            <ResultMeta>
              {t("documents.docCount", { count: result.page.docCount })}
              {result.page.truncated && ` - ${t("documents.truncated")}`} ·{" "}
              {result.page.durationMs} ms · {result.at}
              {" · "}
              <ResultToolbar
                columns={gridResult.columns}
                rows={gridResult.rows}
                filenameBase={`documents-${collection}-${stamp()}`}
              />
            </ResultMeta>
            {gridResult.columns.length > 0 ? (
              <DataGrid result={gridResult} surface="workbench" />
            ) : (
              <WorkbenchEmptyState icon="table">
                {t("documents.noDocuments")}
              </WorkbenchEmptyState>
            )}
          </div>
        )}
      </WorkbenchContainedBody>
    </WorkbenchPane>
  );
}
