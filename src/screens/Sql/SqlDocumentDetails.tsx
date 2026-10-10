// Details strip under the SQL editor: autosave conflict and failure, a format that
// failed or was discarded because the text changed, and the Explain result. A failed
// or missing plan is explained in translated copy with the database's own diagnostic,
// never the backend's English note or wire values.
import { Icon } from "../../components/Icon";
import { WorkbenchButton } from "../../design-system/components/Workbench";
import type { PreviewReport } from "../../features/queries/domain";
import {
  sqlDiagnosticDetail,
  type SqlWorkbenchPlanError,
} from "../../features/queries/sqlWorkbenchModel";
import type { DocumentSaveState } from "../../features/sqlDocuments/useSqlDocumentAutosave";
import { useI18n } from "../../lib/i18n";

type Translate = ReturnType<typeof useI18n>["t"];

/** Translated framing plus the database's own diagnostic for a failed Explain. */
function planErrorCopy(error: SqlWorkbenchPlanError, t: Translate) {
  switch (error.kind) {
    case "sqlParseFailed":
      return { message: t("sql.parseError.message"), detail: sqlDiagnosticDetail(error.message) };
    case "sqlPolicyBlocked":
      return { message: t("sql.policyBlock.message"), detail: null };
    case "sessionStatementBlocked":
      return { message: t("safety.sessionStatementBlocked.message"), detail: null };
    case "db":
      return { message: t("sql.explainFailed"), detail: sqlDiagnosticDetail(error.message) };
    case "timeout":
      return { message: t("sql.explainTimedOut"), detail: null };
    default:
      return { message: t("sql.explainFailed"), detail: null };
  }
}

const EXPLAIN_FAILED_NOTE = "EXPLAIN failed: ";
// The backend's fixed timeout note (safety/l3_preview.rs `EXPLAIN_TIMED_OUT`).
const EXPLAIN_TIMED_OUT_NOTE = `${EXPLAIN_FAILED_NOTE}the plan request timed out`;

/** Why a plan has no text, in translated copy rather than the backend note. */
function missingPlanCopy(plan: PreviewReport, t: Translate) {
  if (plan.note === EXPLAIN_TIMED_OUT_NOTE) {
    return { message: t("sql.explainTimedOut"), detail: null };
  }
  if (plan.note?.startsWith(EXPLAIN_FAILED_NOTE)) {
    return {
      message: t("sql.explainFailed"),
      detail: plan.note.slice(EXPLAIN_FAILED_NOTE.length),
    };
  }
  if (plan.mode === "skipped" && plan.note?.includes("Safety settings")) {
    return { message: t("sql.explainDisabled"), detail: null };
  }
  return { message: t("sql.noPlanAvailable"), detail: null };
}

function Diagnostic({ children }: { children: string }) {
  return (
    <pre className="tw:m-0 tw:mt-1 tw:overflow-auto tw:font-mono tw:text-sm tw:whitespace-pre-wrap tw:[overflow-wrap:anywhere]">
      {children}
    </pre>
  );
}

export default function SqlDocumentDetails({
  conflict,
  onLoadSaved,
  onKeepMine,
  saveState,
  saveError,
  formatError,
  plan,
  planError,
  onClosePlan,
}: {
  conflict: boolean;
  onLoadSaved: () => void;
  onKeepMine: () => void;
  saveState: DocumentSaveState;
  saveError: string | null;
  formatError: "failed" | "edited" | null;
  plan: PreviewReport | null;
  planError: SqlWorkbenchPlanError | null;
  onClosePlan: () => void;
}) {
  const { t } = useI18n();
  const failedPlan = planError ? planErrorCopy(planError, t) : null;
  const missingPlan = plan && !plan.plan ? missingPlanCopy(plan, t) : null;
  return (
    <div
      data-workbench-scroll-owner="document-details"
      className="scrollbar-sleek tw:max-h-[50%] tw:min-h-0 tw:shrink-0 tw:overflow-auto tw:overscroll-contain tw:bg-background"
    >
      {conflict && (
        <div
          className="tw:mx-3 tw:flex tw:min-h-control-lg tw:items-center tw:justify-between tw:gap-3 tw:border-y tw:border-warning tw:py-2 tw:text-sm tw:text-warning tw:max-[760px]:flex-col tw:max-[760px]:items-start"
          role="alert"
        >
          <span>{t("sql.saveConflictBody")}</span>
          <div className="ds-control-row">
            <WorkbenchButton variant="default" onClick={onLoadSaved}>
              {t("sql.loadSaved")}
            </WorkbenchButton>
            <WorkbenchButton variant="default" onClick={onKeepMine}>
              {t("sql.keepMine")}
            </WorkbenchButton>
          </div>
        </div>
      )}
      {saveError && saveState === "error" && (
        <div className="tw:mx-3 tw:mt-2 tw:text-ui tw:text-danger">
          {t("sql.saveFailed")}: {saveError}
        </div>
      )}
      {formatError ? (
        <div className="tw:mx-3 tw:mt-2 tw:text-ui tw:text-danger" role="alert">
          {t(formatError === "edited" ? "sql.formatSkippedEdited" : "sql.formatFailed")}
        </div>
      ) : null}
      {failedPlan ? (
        <div className="tw:mx-3 tw:mt-2 tw:text-ui tw:text-danger" role="alert">
          <p className="tw:m-0">{failedPlan.message}</p>
          {failedPlan.detail ? <Diagnostic>{failedPlan.detail}</Diagnostic> : null}
        </div>
      ) : null}
      {plan && (
        <details
          open
          className="tw:my-2 tw:border-y tw:border-border-subtle tw:bg-background"
        >
          <summary className="tw:flex tw:min-h-workbench-toolbar tw:cursor-pointer tw:items-center tw:gap-2 tw:px-3 tw:py-1 tw:font-semibold">
            {t("sql.queryPlan")}
            <span className="tw:ml-auto">
              <WorkbenchButton
                iconOnly
                size="xs"
                onClick={(event) => {
                  event.preventDefault();
                  onClosePlan();
                }}
                title={t("common.close")}
                aria-label={t("common.close")}
              >
                <Icon name="close" />
              </WorkbenchButton>
            </span>
          </summary>
          {plan.plan ? (
            <pre className="tw:m-0 tw:overflow-x-auto tw:border-t tw:border-border-subtle tw:bg-background tw:p-3 tw:font-mono tw:text-sm tw:whitespace-pre">
              {plan.plan}
            </pre>
          ) : (
            <div className="tw:border-t tw:border-border-subtle tw:px-3 tw:py-2 tw:text-muted-foreground">
              <p className="tw:m-0">{missingPlan?.message}</p>
              {missingPlan?.detail ? <Diagnostic>{missingPlan.detail}</Diagnostic> : null}
            </div>
          )}
        </details>
      )}
    </div>
  );
}
