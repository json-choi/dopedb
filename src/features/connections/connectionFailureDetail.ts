// Projects the closed connection-failure detail identity into the localized technical
// sentence shown under a failed connection. The lookup is a typed record over a closed
// set, so no key is assembled at runtime and an unrecognized wire value renders nothing
// rather than an internal enum.
import type { I18nKey } from "../../lib/i18n";

import type { ConnectionTestFailureDetail } from "./domain";

const DETAIL_KEYS: Readonly<Record<ConnectionTestFailureDetail, I18nKey>> = {
  accountDatabaseNotAllowed: "connections.failureDetail.accountDatabaseNotAllowed",
  attemptTimedOut: "connections.failureDetail.attemptTimedOut",
  credentialNotAuthenticated: "connections.failureDetail.credentialNotAuthenticated",
  credentialStoreUnavailable: "connections.failureDetail.credentialStoreUnavailable",
  driverRejectedConfiguration: "connections.failureDetail.driverRejectedConfiguration",
  managedRepairRequired: "connections.failureDetail.managedRepairRequired",
  mongoRejectedConnection: "connections.failureDetail.mongoRejectedConnection",
  networkFailed: "connections.failureDetail.networkFailed",
  networkRefused: "connections.failureDetail.networkRefused",
  networkReset: "connections.failureDetail.networkReset",
  networkTargetNotFound: "connections.failureDetail.networkTargetNotFound",
  networkTimedOut: "connections.failureDetail.networkTimedOut",
  poolDeadlineExhausted: "connections.failureDetail.poolDeadlineExhausted",
  serverConnectionLostBeforeReady:
    "connections.failureDetail.serverConnectionLostBeforeReady",
  serverConnectionUnavailable: "connections.failureDetail.serverConnectionUnavailable",
  serverMissingDatabase: "connections.failureDetail.serverMissingDatabase",
  serverRejectedAttempt: "connections.failureDetail.serverRejectedAttempt",
  serverRejectedAuthorization: "connections.failureDetail.serverRejectedAuthorization",
  serverRejectedDatabaseName: "connections.failureDetail.serverRejectedDatabaseName",
  serverRejectedLogin: "connections.failureDetail.serverRejectedLogin",
  serverUnreachable: "connections.failureDetail.serverUnreachable",
  sshAuthentication: "connections.failureDetail.sshAuthentication",
  sshHostKey: "connections.failureDetail.sshHostKey",
  sshHostUnreachable: "connections.failureDetail.sshHostUnreachable",
  sshLaunch: "connections.failureDetail.sshLaunch",
  sshTimeout: "connections.failureDetail.sshTimeout",
  sshUnclassified: "connections.failureDetail.sshUnclassified",
  tlsRejected: "connections.failureDetail.tlsRejected",
  transport: "connections.testFailure.transportDetail",
  unclassified: "connections.failureDetail.unclassified",
};

/** The localized technical sentence, or an empty string when there is none to show. */
export function connectionFailureDetailMessage(
  t: (key: I18nKey) => string,
  detail: ConnectionTestFailureDetail | null,
): string {
  return detail ? t(DETAIL_KEYS[detail]) : "";
}
