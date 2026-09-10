// User-consented installation of the version-matched CLI sidecar. Read state stays in
// the app-wide query cache; installation updates that cache only after the backend's
// atomic copy and optional user-PATH edit both return a receipt.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { installCli } from "../../../features/skills/tauriAdapter";
import { errMessage } from "../../../ipc/types";
import ConfirmButton from "../../../components/ConfirmButton";
import Skeleton from "../../../components/Skeleton";
import { useToast } from "../../../components/Toast";
import { Button } from "../../../design-system/components/Button";
import { useI18n } from "../../../lib/i18n";
import { cliInstallationStatusQuery, qk } from "../../../lib/queries";
import type { ConnectionProfile } from "../../../features/connections/domain";
import { AdvancedShellTerminalLauncher } from "./AdvancedShellTerminal";

export default function CliSettings({
  connection,
}: {
  connection: ConnectionProfile | null;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const statusQ = useQuery(cliInstallationStatusQuery());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = statusQ.data ?? null;

  async function install() {
    if (!status) return;
    setBusy(true);
    setError(null);
    try {
      const receipt = await installCli(
        status.pathChangeRequired && status.pathChangeSupported,
        status.conflict,
      );
      queryClient.setQueryData(qk.cliInstallation(), receipt.status);
      toast(
        receipt.pathChanged
          ? t("cli.installedWithPath")
          : receipt.binaryChanged
            ? t("cli.installed")
            : t("cli.alreadyCurrent"),
      );
    } catch (reason) {
      const message = errMessage(reason);
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  const ready = !!status?.current && !!status?.pathConfigured;
  const actionLabel = status?.current
    ? status.pathChangeRequired
      ? t("cli.configurePath")
      : t("cli.reinstall")
    : status?.installed
      ? t("cli.update")
      : t("cli.install");

  return (
    <div className="tw:w-full tw:max-w-[760px] tw:p-4">
      {(error || statusQ.error) && (
        <div className="tw:mt-3 tw:text-ui tw:text-danger">
          {t("cli.error", { error: error ?? errMessage(statusQ.error) })}
        </div>
      )}
      {!status && statusQ.isPending ? (
        <Skeleton lines={4} />
      ) : (
        status && (
          <>
            <div className="tw:mt-4 tw:grid tw:gap-2 tw:border-y tw:border-border-subtle tw:py-3 tw:[&>div]:grid tw:[&>div]:grid-cols-[minmax(120px,0.35fr)_minmax(0,1fr)] tw:[&>div]:items-baseline tw:[&>div]:gap-3 tw:[&_code]:break-all tw:max-[620px]:[&>div]:grid-cols-1 tw:max-[620px]:[&>div]:gap-1">
              <div>
                <span className="tw:text-muted-foreground">{t("cli.version")}</span>
                <strong>{status.version}</strong>
              </div>
              <div>
                <span className="tw:text-muted-foreground">{t("cli.inAppPath")}</span>
                <code>{status.inAppDirectory ?? t("common.unknown")}</code>
              </div>
              <div>
                <span className="tw:text-muted-foreground">{t("cli.installPath")}</span>
                <code>{status.installPath}</code>
              </div>
              <div>
                <span className="tw:text-muted-foreground">{t("cli.binaryStatus")}</span>
                <strong>
                  {status.current
                    ? t("cli.current")
                    : status.installed
                      ? t("cli.outdated")
                      : t("cli.notInstalled")}
                </strong>
              </div>
              <div>
                <span className="tw:text-muted-foreground">{t("cli.pathStatus")}</span>
                <strong>
                  {status.pathConfigured ? t("cli.pathReady") : t("cli.pathMissing")}
                </strong>
              </div>
            </div>

            {status.conflict && (
              <div className="tw:mt-3 tw:text-ui tw:text-danger">
                {t("cli.conflict", { path: status.installPath })}
              </div>
            )}
            {status.pathChangePreview && (
              <div className="tw:mt-4">
                <strong>{t("cli.pathChange")}</strong>
                <p className="tw:mt-1 tw:mb-2 tw:text-muted-foreground">
                  {t("cli.pathConsent")}
                </p>
                <pre className="tw:m-0 tw:max-h-[220px] tw:overflow-auto tw:rounded-sm tw:border tw:border-border-subtle tw:bg-muted tw:p-3 tw:font-mono tw:whitespace-pre-wrap tw:break-all">
                  {status.pathChangePreview}
                </pre>
              </div>
            )}

            <div className="ds-action-row ds-control-row tw:mt-4">
              {status.conflict ? (
                <ConfirmButton
                  size="compact"
                  disabled={busy || !status.bundledAvailable}
                  variant="primary"
                  confirmLabel={t("cli.replaceConfirm")}
                  onConfirm={() => void install()}
                >
                  {actionLabel}
                </ConfirmButton>
              ) : (
                <Button
                  size="compact"
                  variant="primary"
                  disabled={busy || !status.bundledAvailable || ready}
                  onClick={() => void install()}
                >
                  {busy ? t("cli.working") : ready ? t("cli.ready") : actionLabel}
                </Button>
              )}
              <Button
                size="compact"
                disabled={busy || statusQ.isFetching}
                onClick={() => {
                  setError(null);
                  void statusQ.refetch();
                }}
              >
                {t("cli.refresh")}
              </Button>
            </div>
            <AdvancedShellTerminalLauncher connection={connection} />
          </>
        )
      )}
    </div>
  );
}
