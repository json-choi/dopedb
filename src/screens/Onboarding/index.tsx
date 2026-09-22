// Welcome document. Only commands with a real application owner
// appear here; provider setup and Agent actions stay in their tool windows.
import { Icon, type IconName } from "../../components/Icon";
import { useI18n } from "../../lib/i18n";
import { Button } from "../../design-system/components/Button";
import CosmicBackdrop from "../../features/cosmicScene/CosmicBackdrop";
import {
  databaseEngineLabel,
  type LocalDatabaseListener,
} from "../../features/connections/domain";
import type { LocalListenerDiscovery } from "../../features/connections/useLocalListenerDiscovery";

function listenerLabel(listener: LocalDatabaseListener): string {
  const version = listener.serverVersion ? ` ${listener.serverVersion}` : "";
  return `${databaseEngineLabel(listener.engine)}${version} · ${listener.host}:${listener.port}`;
}

type WelcomeCommand = {
  id: string;
  icon: IconName;
  label: string;
  disabled?: boolean;
  onClick: (returnFocus: HTMLButtonElement) => void;
};

export default function Onboarding({
  connectionName,
  creatingDemo = false,
  guidedDemoAvailable = false,
  guidedDemo,
  localDiscovery,
  onCreateDemoDatabase,
  onNewConnection,
  onNewQuery,
  onUseLocalListener,
}: {
  connectionName?: string;
  creatingDemo?: boolean;
  guidedDemoAvailable?: boolean;
  /** Loopback listener suggestions offered before the first connection. */
  localDiscovery?: LocalListenerDiscovery;
  onUseLocalListener?: (listener: LocalDatabaseListener) => void;
  guidedDemo?: {
    writeEnabled: boolean;
    onBrowseOrders: () => void;
    onAnalyzeRevenue: () => void;
    onPracticeApproval: () => void;
    onOpenSafety: () => void;
  };
  onCreateDemoDatabase?: () => void;
  onNewConnection: () => void;
  onNewQuery?: () => void;
}) {
  const { t } = useI18n();
  const connected = Boolean(connectionName);
  const commands: WelcomeCommand[] = [];
  if (guidedDemo) {
    commands.push(
      {
        id: "demo-browse-orders",
        icon: "table",
        label: t("onboarding.demoBrowseOrders"),
        onClick: guidedDemo.onBrowseOrders,
      },
      {
        id: "demo-analyze-revenue",
        icon: "chart",
        label: t("onboarding.demoAnalyzeRevenue"),
        onClick: guidedDemo.onAnalyzeRevenue,
      },
      {
        id: "demo-practice-approval",
        icon: guidedDemo.writeEnabled ? "unlock" : "lock",
        label: guidedDemo.writeEnabled
          ? t("onboarding.demoPracticeApproval")
          : t("onboarding.demoEnableWrites"),
        onClick: guidedDemo.writeEnabled
          ? guidedDemo.onPracticeApproval
          : guidedDemo.onOpenSafety,
      },
    );
  } else if (connected && onNewQuery) {
    commands.push({
      id: "new-query",
      icon: "play",
      label: t("ide.action.newQuery"),
      onClick: onNewQuery,
    });
  } else if (!connected) {
    if (localDiscovery && onUseLocalListener) {
      if (localDiscovery.status === "idle" || localDiscovery.status === "running") {
        commands.push({
          id: "discover-local-listeners",
          icon: "search",
          label: t(
            localDiscovery.status === "running"
              ? "onboarding.localDiscoveryRunning"
              : "onboarding.localDiscoveryStart",
          ),
          disabled: localDiscovery.status === "running",
          onClick: localDiscovery.run,
        });
      }
      for (const listener of localDiscovery.listeners) {
        commands.push({
          id: `local-listener-${listener.engine}-${listener.port}`,
          icon: "database",
          label: listenerLabel(listener),
          onClick: () => onUseLocalListener(listener),
        });
      }
    }
    commands.push({
      id: "new-data-source",
      icon: "database",
      label: t("connections.new"),
      onClick: onNewConnection,
    });
    if (guidedDemoAvailable && onCreateDemoDatabase) {
      commands.push({
        id: "create-demo-sqlite",
        icon: "download",
        label: t(
          creatingDemo ? "onboarding.demoStarting" : "onboarding.demoStart",
        ),
        disabled: creatingDemo,
        onClick: onCreateDemoDatabase,
      });
    }
  }

  let localDiscoveryNotice: string | null = null;
  if (!connected && localDiscovery) {
    if (localDiscovery.status === "failed") {
      localDiscoveryNotice = t("onboarding.localDiscoveryFailed");
    } else if (
      localDiscovery.status === "ready" &&
      localDiscovery.listeners.length === 0
    ) {
      localDiscoveryNotice = t("onboarding.localDiscoveryNone");
    }
  }

  return (
    <div role="group" tabIndex={0} aria-label={t("onboarding.cosmicScene")}
      className="tw:relative tw:flex tw:h-full tw:min-h-0 tw:cursor-grab tw:flex-col tw:overflow-hidden tw:bg-[var(--ds-cosmic-night)] tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-inset tw:focus-visible:ring-ring tw:data-[dragging=true]:cursor-grabbing tw:[--ds-background:var(--ds-cosmic-night)] tw:[--ds-editor-surface:var(--ds-cosmic-night)] tw:[--ds-foreground:var(--ds-primary-foreground)] tw:[--ds-muted:var(--ds-cosmic-night-soft)] tw:[--ds-muted-foreground:var(--ds-cosmic-muted)] tw:[--ds-ring:var(--ds-cosmic-electric)] tw:[--ds-selection:var(--ds-cosmic-night-soft)]">
      <CosmicBackdrop />
      <div className="tw:pointer-events-none tw:relative tw:z-10 tw:flex tw:min-h-0 tw:flex-1 tw:items-end tw:justify-center tw:overflow-auto tw:p-5 tw:pb-16">
        <main className="tw:pointer-events-auto tw:w-full tw:max-w-[320px] tw:cursor-default">
          <h1 className="tw:sr-only">{t("onboarding.title")}</h1>
          {!connected || guidedDemo ? (
            <p className="tw:mt-0 tw:mb-3 tw:text-center tw:text-sm tw:leading-body tw:text-muted-foreground">
              {t(
                guidedDemo
                  ? "onboarding.demoLead"
                  : "onboarding.firstRunLead",
              )}
            </p>
          ) : null}
          <div
            className="tw:grid tw:gap-[2px]"
            aria-label={t("onboarding.title")}
            role="group"
          >
            {commands.map((command) => (
              <div
                key={command.id}
                className="tw:min-w-0"
              >
                <Button
                  presentation="menuItem"
                  size="compact"
                  variant="ghost"
                  disabled={command.disabled}
                  onClick={(event) => {
                    event.currentTarget.focus({ preventScroll: true });
                    command.onClick(event.currentTarget);
                  }}
                >
                  <Icon name={command.icon} />
                  <span className="tw:min-w-0 tw:truncate">{command.label}</span>
                </Button>
              </div>
            ))}
          </div>
          {localDiscoveryNotice ? (
            <p
              className="tw:mt-3 tw:mb-0 tw:text-center tw:text-ui tw:leading-body tw:text-muted-foreground"
              role="status"
            >
              {localDiscoveryNotice}
            </p>
          ) : null}
        </main>
      </div>
    </div>
  );
}
