// The one list of ways to start a first connection, shared by the Welcome
// document and the empty Database Explorer: loopback listeners the person asked
// to find, the popular sources of the connection source catalog, "All data
// sources" (the source picker) and the sample database. It only reports the
// choice; the shell owns opening the editor or creating the sample.
import EngineMark from "../../components/EngineMark";
import { Icon } from "../../components/Icon";
import { ToolWindowAction } from "../../design-system/components/ToolWindow";
import { useI18n } from "../../lib/i18n";
import { POPULAR_CONNECTION_SOURCES } from "./connectionEditorModel";
import { databaseEngineLabel, type LocalDatabaseListener } from "./domain";
import type { ConnectionLaunchPreset } from "./presets";
import type { LocalListenerDiscovery } from "./useLocalListenerDiscovery";

function listenerLabel(listener: LocalDatabaseListener): string {
  const version = listener.serverVersion ? ` ${listener.serverVersion}` : "";
  return `${databaseEngineLabel(listener.engine)}${version} · ${listener.host}:${listener.port}`;
}

export default function ConnectionStartList({
  creatingDemo,
  localDiscovery,
  onCreateDemoDatabase,
  onNewConnection,
  onUseLocalListener,
}: {
  creatingDemo: boolean;
  /** Loopback listener suggestions; omitted where discovery is not offered. */
  localDiscovery?: LocalListenerDiscovery;
  /** Omitted where no sample database can be created. */
  onCreateDemoDatabase?: () => void;
  onNewConnection: (preset?: ConnectionLaunchPreset) => void;
  onUseLocalListener?: (listener: LocalDatabaseListener) => void;
}) {
  const { t } = useI18n();
  const discovery = localDiscovery && onUseLocalListener ? localDiscovery : null;
  const discoveryRunning = discovery?.status === "running";
  const showDiscoveryCommand = discovery !== null && (
    discovery.status === "idle" ||
    discoveryRunning ||
    discovery.status === "failed" ||
    discovery.listeners.length === 0
  );
  let discoveryNotice: string | null = null;
  if (discovery?.status === "failed") {
    discoveryNotice = t("onboarding.localDiscoveryFailed");
  } else if (discovery?.status === "ready" && discovery.listeners.length === 0) {
    discoveryNotice = t("onboarding.localDiscoveryNone");
  }
  const focusThen = (run: () => void) => (
    event: { currentTarget: HTMLButtonElement },
  ) => {
    event.currentTarget.focus({ preventScroll: true });
    run();
  };

  return (
    <>
      <div className="tw:grid tw:gap-[2px]">
        {discovery && showDiscoveryCommand ? (
          <ToolWindowAction
            leading={<Icon name={discovery.status === "idle" || discoveryRunning ? "search" : "refresh"} />}
            disabled={discoveryRunning}
            onClick={focusThen(discovery.run)}
          >
            {t(
              discoveryRunning
                ? "onboarding.localDiscoveryRunning"
                : discovery.status === "idle"
                  ? "onboarding.localDiscoveryStart"
                  : "connections.localDiscoveryRetry",
            )}
          </ToolWindowAction>
        ) : null}
        {discovery?.listeners.map((listener) => (
          <ToolWindowAction
            key={`${listener.engine}-${listener.port}`}
            leading={<EngineMark engine={listener.engine} />}
            trailing={<Icon name="chevronRight" />}
            onClick={focusThen(() => onUseLocalListener?.(listener))}
          >
            {listenerLabel(listener)}
          </ToolWindowAction>
        ))}
        {POPULAR_CONNECTION_SOURCES.map((source) => (
          <ToolWindowAction
            key={`${source.engine}-${source.provider}`}
            leading={<EngineMark engine={source.engine} />}
            trailing={<Icon name="chevronRight" />}
            onClick={focusThen(() =>
              onNewConnection({
                engine: source.engine,
                provider: source.provider,
                source: "standard",
              }),
            )}
          >
            {source.label}
          </ToolWindowAction>
        ))}
        <ToolWindowAction
          leading={<Icon name="moreVertical" />}
          trailing={<Icon name="chevronRight" />}
          onClick={focusThen(() => onNewConnection())}
        >
          {t("connections.allDataSources")}
        </ToolWindowAction>
        {onCreateDemoDatabase ? (
          <ToolWindowAction
            leading={<EngineMark engine="sqlite" />}
            trailing={<Icon name="download" />}
            disabled={creatingDemo}
            onClick={focusThen(onCreateDemoDatabase)}
          >
            {creatingDemo
              ? t("onboarding.demoStarting")
              : t("onboarding.demoStart")}
          </ToolWindowAction>
        ) : null}
      </div>
      {discoveryNotice ? (
        <p
          className="tw:mt-3 tw:mb-0 tw:text-center tw:text-ui tw:leading-body tw:text-muted-foreground"
          role="status"
        >
          {discoveryNotice}
        </p>
      ) : null}
    </>
  );
}
