// Presents the local diagnostics owner and explicit support-sharing warnings.
// Collection state belongs to Rust; this surface never uploads or submits logs.
import { Button } from "../../../design-system/components/Button";
import { CheckboxField } from "../../../design-system/components/FormControls";
import { ModalBackdrop, ModalFooter, ModalHeader, ModalSurface } from "../../../design-system/components/Modal";
import { SettingsGroup } from "../../../design-system/components/Settings";
import { InlineNotice } from "../../../design-system/components/Status";
import { formatDiagnosticLog } from "../../../features/diagnostics/domain";
import { useDiagnostics } from "../../../features/diagnostics/useDiagnostics";
import { useI18n } from "../../../lib/i18n";

export default function Diagnostics() {
  const { t } = useI18n();
  const diagnostics = useDiagnostics();
  const { query, toggle, clear, sharing, sharingBusy, actionStatus } = diagnostics;
  const snapshot = query.data;
  const busy = toggle.isPending || clear.isPending || sharingBusy;
  const unavailable = !snapshot || query.isError;

  return (
    <SettingsGroup title={t("settings.diagnosticLogs")}>
      <div className="tw:grid tw:min-w-0 tw:gap-3 tw:py-2">
        <CheckboxField
          checked={snapshot?.enabled ?? false}
          disabled={busy || unavailable}
          onChange={(event) => toggle.mutate(event.target.checked)}
          label={t("settings.diagnosticCollect")}
        />
        <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {t("settings.diagnosticRetention")}
        </p>
        <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {t("settings.diagnosticLocalBody")}
        </p>
        <InlineNotice tone="warning" icon="alert">
          {t("settings.diagnosticPrivacyBody")}
        </InlineNotice>
        {snapshot ? (
          <>
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
              <Button size="compact" disabled={busy || unavailable || !snapshot.entries.length}
                onClick={() => diagnostics.requestShare("copy")}>
                {t("settings.diagnosticCopy")}
              </Button>
              <Button size="compact" disabled={busy || unavailable || !snapshot.entries.length}
                onClick={() => clear.mutate()}>
                {t("settings.diagnosticClear")}
              </Button>
              <Button size="compact" disabled={busy} onClick={() => diagnostics.requestShare("issue")}>
                {t("settings.diagnosticReport")}
              </Button>
            </div>
            <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">
              {t("settings.diagnosticCount", { count: snapshot.entries.length, dropped: snapshot.dropped })}
            </p>
            <pre tabIndex={0} aria-label={t("settings.diagnosticLogs")}
              className="tw:m-0 tw:h-[240px] tw:overflow-auto tw:overscroll-contain tw:border tw:border-border-subtle tw:bg-editor-surface tw:p-3 tw:font-mono tw:text-xs tw:leading-body tw:whitespace-pre-wrap tw:break-all">
              {snapshot.entries.length ? formatDiagnosticLog(snapshot) : t(snapshot.enabled
                ? "settings.diagnosticEmpty" : "settings.diagnosticDisabled")}
            </pre>
          </>
        ) : null}
        {query.isError || toggle.isError || clear.isError || actionStatus === "failed" ? (
          <InlineNotice tone="danger" icon="alert" role="alert"
            action={query.isError ? <Button size="compact" disabled={query.isFetching}
              onClick={() => void query.refetch()}>{t("settings.diagnosticRetry")}</Button> : undefined}>
            {t("settings.diagnosticFailed")}
          </InlineNotice>
        ) : null}
        {actionStatus === "copied" ? <p role="status" className="tw:m-0 tw:text-xs tw:text-muted-foreground">
          {t("settings.diagnosticCopied")}
        </p> : null}
      </div>
      {sharing ? (
        <ModalBackdrop onMouseDown={(event) => {
          if (event.target === event.currentTarget) diagnostics.cancelShare();
        }}>
          <ModalSurface size="alert" role="alertdialog" aria-labelledby="diagnostic-share-title"
            aria-describedby="diagnostic-share-body" onRequestClose={diagnostics.cancelShare}
            dismissible={!sharingBusy}>
            <ModalHeader title={t("settings.diagnosticShareTitle")} titleId="diagnostic-share-title" />
            <div id="diagnostic-share-body" className="tw:grid tw:gap-3 tw:p-4 tw:text-sm tw:leading-body">
              <p className="tw:m-0">{t("settings.diagnosticPrivacyBody")}</p>
              <p className="tw:m-0 tw:font-semibold">{t("settings.diagnosticPublicBody")}</p>
              <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">{t("settings.diagnosticManualSharing")}</p>
              {actionStatus === "failed" ? <p role="alert" className="tw:m-0 tw:text-danger">
                {t("settings.diagnosticFailed")}
              </p> : null}
            </div>
            <ModalFooter>
              <Button autoFocus disabled={sharingBusy} onClick={diagnostics.cancelShare}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" disabled={sharingBusy} onClick={() => void diagnostics.confirmShare()}>
                {t(sharing === "copy" ? "settings.diagnosticConfirmCopy" : "settings.diagnosticConfirmIssue")}
              </Button>
            </ModalFooter>
          </ModalSurface>
        </ModalBackdrop>
      ) : null}
    </SettingsGroup>
  );
}
