// Translated copy for a failed SQL run or script statement, chosen by the error's
// typed kind. Only the database's or parser's own diagnostic is shown verbatim,
// framed by the translated message; any other kind's reported reason is offered
// through a "Copy details" action instead of inline English. The script result
// view and the table editor's staged-change failure share this mapping.
import type { ScriptStatementError } from "../../ipc/types";
import type { useI18n } from "../../lib/i18n";
import { connectionOperationErrorTitle } from "../connections/connectionTestFailure";
import { manualTransactionRefusalKey } from "../queries/useManualTransaction";
import { sqlDiagnosticDetail } from "../queries/sqlWorkbenchModel";
import {
  writeBlockRecoveryKind,
  type ConnectionWriteAuthority,
} from "../safetySettings/policy";
import type { QueryServiceError } from "./domain";

type Translate = ReturnType<typeof useI18n>["t"];

export type SqlErrorCopy = {
  title: string;
  /** Translated explanation; null when a dedicated notice already explains it. */
  message: string | null;
  /** Verbatim database or parser diagnostic, framed by the translated message. */
  detail: string | null;
  /**
   * The reported reason of a kind without its own diagnostic. It is never shown
   * inline (it may be English backend text); a "Copy details" action offers it.
   */
  copyable?: string | null;
};

/** Copy for a failed run, by its typed kind. */
export function sqlErrorCopy(
  error: Pick<QueryServiceError, "kind" | "message" | "code" | "retryAfterSeconds">,
  t: Translate,
  writeBlocked: boolean,
): SqlErrorCopy {
  switch (error.kind) {
    case "sqlPolicyBlocked":
      return {
        title: t("sql.policyBlock.title"),
        message: t("sql.policyBlock.message"),
        detail: null,
      };
    case "sqlParseFailed":
      return {
        title: t("sql.parseError.title"),
        message: t("sql.parseError.message"),
        detail: sqlDiagnosticDetail(error.message) || null,
      };
    case "sessionStatementBlocked":
      return {
        title: t("safety.sessionStatementBlocked.title"),
        message: t("safety.sessionStatementBlocked.message"),
        detail: null,
      };
    case "manualTransaction":
      return {
        title: t("sql.manualTransactionBlocked.title"),
        message: t(
          manualTransactionRefusalKey(error.code) ??
            "ide.manualTransaction.actionFailed",
        ),
        detail: null,
      };
    case "outcomeUnknown":
      return {
        title: t("sql.outcomeUnknown.title"),
        message: t("sql.outcomeUnknown.message"),
        detail: null,
      };
    case "managedConnectionRecoveryRequired":
      return { title: t("sql.managedRecovery.title"), message: null, detail: null };
    case "retryLater":
      return {
        title: t("sql.errorTitle"),
        message: error.retryAfterSeconds === undefined
          ? t("schema.connectionRetryLater")
          : t("schema.connectionRetryAfter", { seconds: error.retryAfterSeconds }),
        detail: null,
      };
    case "sharedConnectionChanged":
      return {
        title: t("sql.errorTitle"),
        message: t("schema.sharedConnectionChanged"),
        detail: null,
      };
    case "db":
      return {
        title: t("sql.errorTitle"),
        message: t("sql.databaseError.message"),
        detail: sqlDiagnosticDetail(error.message) || null,
      };
    case "timeout":
      return { title: t("sql.errorTitle"), message: t("sql.timeoutError.message"), detail: null };
    // A dedicated notice explains each credential recovery and offers its command.
    case "credentialBindingRequired":
      return { title: t("sql.credentialRequired.title"), message: null, detail: null };
    case "keychain":
      return { title: t("sql.credentialStoreDenied.title"), message: null, detail: null };
    case "authenticationRequired":
      return { title: t("sql.authenticationRequired.title"), message: null, detail: null };
    default:
      break;
  }
  if (error.kind === "safety" && /timed out/i.test(error.message)) {
    return { title: t("sql.errorTitle"), message: t("sql.timeoutError.message"), detail: null };
  }
  if (
    error.kind &&
    (error.kind.startsWith("ssh") || error.kind.startsWith("connection"))
  ) {
    return {
      title: connectionOperationErrorTitle(t, { kind: error.kind, message: "" }),
      message: t("sql.connectionError.message"),
      detail: null,
    };
  }
  if (writeBlocked) {
    return { title: t("sql.writeBlock.title"), message: t("sql.writeBlock.message"), detail: null };
  }
  // Only database and parser diagnostics are shown verbatim. Every other kind gets
  // translated copy; its reported reason stays reachable through "Copy details".
  const copyable = error.message.trim() || null;
  const typed = (message: string) => ({
    title: t("sql.errorTitle"),
    message,
    detail: null,
    copyable,
  });
  switch (error.kind) {
    case "resultRowTooLarge":
      return { title: t("sql.errorTitle"), message: t("sql.resultRowTooLarge"), detail: null };
    case "unsupportedColumnType":
      return typed(t("sql.unsupportedColumnType"));
    case "network":
      return typed(t("sql.networkError.message"));
    case "config":
      return typed(t("sql.configError.message"));
    case "notFound":
      return typed(t("sql.notFoundError.message"));
    case "blocked":
      return typed(t("sql.blockedError.message"));
    default:
      return typed(t("sql.genericError.message"));
  }
}

/** Copy for one failed script statement, in the same vocabulary a single run uses. */
export function scriptStatementErrorCopy(
  statement: { sql: string; error: ScriptStatementError },
  connection: ConnectionWriteAuthority | null,
  t: Translate,
): SqlErrorCopy {
  const { error, sql } = statement;
  switch (error.kind) {
    case "skipped":
      return { title: t("sql.scriptStatementSkipped"), message: null, detail: null };
    case "optimisticConflict":
      return { title: t("sql.errorTitle"), message: t("sql.scriptStatementConflict"), detail: null };
    case "transactionBeginFailed":
      return { title: t("sql.errorTitle"), message: t("sql.scriptTransactionBeginFailed"), detail: null };
    case "unknown":
      // Saved before statement errors were typed: the stored text has no kind, so
      // it is offered through "Copy details" rather than shown inline.
      return {
        title: t("sql.errorTitle"),
        message: t("sql.genericError.message"),
        detail: null,
        copyable: error.message.trim() || null,
      };
    default: {
      const writeBlocked = connection !== null &&
        writeBlockRecoveryKind(connection, { kind: error.kind, message: error.message, sql }) !== null;
      return sqlErrorCopy(error, t, writeBlocked);
    }
  }
}
