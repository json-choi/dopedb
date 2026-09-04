import { openUrl } from "@tauri-apps/plugin-opener";

import { Icon, type IconName } from "../../../components/Icon";
import InfoTip from "../../../components/InfoTip";
import { useToast } from "../../../components/Toast";
import { Button } from "../../../design-system/components/Button";
import { ProgressBar } from "../../../design-system/components/Progress";
import { StatusBadge, type StatusTone } from "../../../design-system/components/Status";
import {
  appUpdaterProgress,
  type AppUpdaterPhase,
  type AppUpdaterSnapshot,
} from "../../../features/updater/controller";
import { useI18n } from "../../../lib/i18n";
import { DOPEDB_RELEASES_URL } from "../../../lib/externalLinks";
import { errMessage } from "../../../ipc/types";

function bytes(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function stateIcon(state: AppUpdaterPhase): IconName {
  switch (state) {
    case "checking":
      return "refresh";
    case "available":
    case "downloading":
    case "installing":
      return "download";
    case "current":
    case "ready":
      return "check";
    case "error":
      return "alert";
    case "idle":
    default:
      return "info";
  }
}

function stateTone(state: AppUpdaterPhase): StatusTone {
  if (state === "available" || state === "ready") return "success";
  if (state === "error") return "danger";
  return "neutral";
}

export default function Updates({
  snapshot,
  onRefresh,
  onInstall,
}: {
  snapshot: AppUpdaterSnapshot;
  onRefresh: () => Promise<void>;
  onInstall: () => Promise<void>;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const progress = appUpdaterProgress(snapshot);
  const busy =
    snapshot.phase === "checking" ||
    snapshot.phase === "downloading" ||
    snapshot.phase === "installing" ||
    snapshot.phase === "ready";
  const stateLabel =
    snapshot.phase === "available"
      ? t("updates.available")
      : snapshot.phase === "current"
        ? t("updates.current")
        : snapshot.phase === "checking"
          ? t("updates.checking")
          : snapshot.phase === "downloading"
            ? t("updates.downloading")
            : snapshot.phase === "installing"
              ? t("updates.installing")
              : snapshot.phase === "ready"
                ? t("updates.relaunching")
                : snapshot.phase === "error"
                  ? t("updates.error")
                  : t("updates.idle");

  const openReleases = async () => {
    try {
      await openUrl(DOPEDB_RELEASES_URL);
    } catch (reason) {
      toast(
        t("updates.openReleasesFailed", { error: errMessage(reason) }),
        "error",
      );
    }
  };

  return (
    <div className="tw:w-full tw:max-w-[720px] tw:p-4 tw:max-[760px]:max-w-none">
      <div className="tw:mb-3 tw:flex tw:items-start tw:justify-between tw:gap-4 tw:max-[760px]:flex-col tw:max-[760px]:items-stretch">
        <div className="tw:inline-flex tw:items-center tw:gap-2">
          <h2>{t("updates.title")}</h2>
          <InfoTip label={t("updates.description")} />
        </div>
        <Button
          size="compact"
          disabled={busy}
          onClick={() => void onRefresh()}
        >
          {t("updates.checkAgain")}
        </Button>
      </div>

      <div className="tw:grid tw:border-t tw:border-border-subtle">
        <div className="tw:flex tw:min-h-control-lg tw:items-center tw:justify-between tw:gap-4 tw:border-b tw:border-border-subtle tw:py-2 tw:max-[760px]:flex-col tw:max-[760px]:items-start tw:max-[760px]:gap-1">
          <span className="tw:text-muted-foreground">
            {t("updates.installedVersion")}
          </span>
          <strong>{snapshot.currentVersion ?? t("common.unknown")}</strong>
        </div>
        <div className="tw:flex tw:min-h-control-lg tw:items-center tw:justify-between tw:gap-4 tw:border-b tw:border-border-subtle tw:py-2 tw:max-[760px]:flex-col tw:max-[760px]:items-start tw:max-[760px]:gap-1">
          <span className="tw:text-muted-foreground">
            {t("updates.latestRelease")}
          </span>
          <strong>
            {snapshot.availableVersion ??
              (snapshot.phase === "checking"
                ? t("updates.checking")
                : t("updates.none"))}
          </strong>
        </div>
        <div className="tw:flex tw:min-h-control-lg tw:items-center tw:justify-between tw:gap-4 tw:border-b tw:border-border-subtle tw:py-2 tw:max-[760px]:flex-col tw:max-[760px]:items-start tw:max-[760px]:gap-1">
          <span className="tw:text-muted-foreground">
            {t("updates.status")}
          </span>
          <StatusBadge
            iconOnly
            tone={stateTone(snapshot.phase)}
            title={stateLabel}
            aria-label={stateLabel}
            role="img"
          >
            <Icon name={stateIcon(snapshot.phase)} />
          </StatusBadge>
        </div>

        {(snapshot.phase === "downloading" ||
          snapshot.phase === "installing") && (
          <div className="tw:grid tw:gap-2 tw:border-b tw:border-border-subtle tw:py-3">
            <ProgressBar
              value={progress}
              label={t("updates.downloadingFallback")}
            />
            <div className="tw:text-muted-foreground">
              {progress === null
                ? t("updates.received", {
                    amount:
                      bytes(snapshot.downloadedBytes) ??
                      t("updates.downloadingFallback"),
                  })
                : `${progress}% (${bytes(snapshot.downloadedBytes)} / ${bytes(snapshot.totalBytes)})`}
            </div>
          </div>
        )}

        {snapshot.releaseNotes && (
          <details className="tw:border-b tw:border-border-subtle tw:py-3">
            <summary className="tw:cursor-pointer tw:text-muted-foreground">
              {t("updates.releaseNotes")}
            </summary>
            <pre className="tw:mt-2 tw:mb-0 tw:font-mono tw:text-sm tw:whitespace-pre-wrap tw:text-foreground">
              {snapshot.releaseNotes}
            </pre>
          </details>
        )}

        {snapshot.error && (
          <div
            role="alert"
            className="tw:border-b tw:border-border-subtle tw:py-3 tw:text-ui tw:text-danger"
          >
            {t("updates.failed", { error: snapshot.error })}
          </div>
        )}

        <div className="ds-action-row ds-control-row tw:pt-3">
          <Button
            variant="primary"
            disabled={!snapshot.availableVersion || busy}
            onClick={() => void onInstall()}
          >
            {snapshot.phase === "error" && snapshot.availableVersion
              ? t("updates.retry")
              : snapshot.phase === "downloading" ||
                  snapshot.phase === "installing" ||
                  snapshot.phase === "ready"
                ? stateLabel
                : t("updates.updateAndRelaunch")}
          </Button>
          <Button onClick={() => void openReleases()}>
            {t("updates.openReleases")}
          </Button>
        </div>
      </div>
    </div>
  );
}
