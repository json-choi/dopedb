// Shows why an access-lowering change did not finish and what the administrator can do:
// enter the missing administrator credential and revoke now, or leave it pending for a
// device that has the credential. Failed database steps, a still-required revocation
// and a refused workspace change are explained per member and database; all state lives
// in `useAccessLowering`.
import { Button } from "../../../design-system/components/Button";
import { InlineNotice } from "../../../design-system/components/Status";
import { useI18n } from "../../../lib/i18n";
import { DIRECT_FAILURE_KEYS } from "../../directAccess/messages";
import DirectAdminCredentialForm from "./DirectAdminCredentialForm";
import type { AccessLowering } from "./useAccessLowering";

export default function AccessLoweringPrompt({
  lowering,
  memberName,
}: {
  lowering: AccessLowering;
  /** Display name of a member id; unknown members read as "a member". */
  memberName: (memberId: string) => string | null;
}) {
  const { t } = useI18n();
  const { incomplete, sessionsMayPersist } = lowering;
  if (!incomplete) {
    return sessionsMayPersist ? (
      <div className="tw:grid tw:min-w-0 tw:gap-2" role="status">
        <InlineNotice tone="warning" icon="alert">
          {t("directAccess.lowering.sessionsMayPersist")}
        </InlineNotice>
        <div className="ds-control-row tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <Button size="compact" onClick={lowering.dismiss}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    ) : null;
  }
  const { outcome, credentialsOpen, retrying, error } = incomplete;
  const blocked = outcome.blockedNoCredential;
  const waiting = blocked.length === 0 && outcome.failed.length === 0 && outcome.mutation === "not_attempted";

  return (
    <div data-primary-flow className="tw:grid tw:min-w-0 tw:gap-2" role="alert">
      {blocked.map((connectionId) => (
        <InlineNotice key={connectionId} tone="warning" icon="alert">
          {t("directAccess.lowering.blocked", { database: lowering.databaseName(connectionId) })}
        </InlineNotice>
      ))}
      {outcome.failed.map((failure) => (
        <InlineNotice key={`${failure.connectionId}:${failure.memberId}`} tone="danger" icon="alert">
          {t("directAccess.lowering.failed", {
            member: memberName(failure.memberId) ?? t("directAccess.lowering.aMember"),
            database: lowering.databaseName(failure.connectionId),
            reason: t(DIRECT_FAILURE_KEYS[failure.failureCode]),
          })}
        </InlineNotice>
      ))}
      {sessionsMayPersist ? (
        <InlineNotice tone="warning" icon="alert">
          {t("directAccess.lowering.sessionsMayPersist")}
        </InlineNotice>
      ) : null}
      {waiting ? (
        <InlineNotice tone="warning" icon="alert">
          {t("directAccess.lowering.deferred")}
        </InlineNotice>
      ) : null}
      {outcome.mutation === "revocation_required" ? (
        <InlineNotice tone="danger" icon="alert">
          {t("directAccess.lowering.revocationRequired")}
        </InlineNotice>
      ) : null}
      {outcome.mutation === "rejected" ? (
        <InlineNotice tone="danger" icon="alert">
          {t("directAccess.lowering.rejected")}
        </InlineNotice>
      ) : null}
      {blocked.length > 0 && !credentialsOpen ? (
        <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {t("directAccess.lowering.pendingNote")}
        </p>
      ) : null}
      {credentialsOpen ? (
        <DirectAdminCredentialForm
          databases={blocked.map((id) => ({ id, name: lowering.databaseName(id) }))}
          busy={retrying}
          error={error}
          onSubmit={(credentials) => void lowering.submitCredentials(credentials)}
          onCancel={lowering.closeCredentials}
        />
      ) : (
        <div className="ds-control-row tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          {blocked.length > 0 ? (
            <>
              <Button size="compact" variant="primary" onClick={lowering.openCredentials}>
                {t("directAccess.lowering.enterCredential")}
              </Button>
              <Button size="compact" onClick={lowering.leavePending}>
                {t("directAccess.lowering.leavePending")}
              </Button>
            </>
          ) : (
            <Button size="compact" onClick={lowering.dismiss}>
              {t("common.close")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
