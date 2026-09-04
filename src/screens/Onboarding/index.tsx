// Welcome document. Only commands with a real application owner
// appear here; provider setup and Agent actions stay in their tool windows.
import { Icon, type IconName } from "../../components/Icon";
import { useI18n } from "../../lib/i18n";
import { Button } from "../../design-system/components/Button";
import { ProductAnalyticsConsentPrompt } from "../../features/productAnalytics/ConsentPrompt";

type WelcomeCommand = {
  id: string;
  icon: IconName;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: (returnFocus: HTMLButtonElement) => void;
};

export default function Onboarding({
  connectionName,
  creatingDemo = false,
  guidedDemoAvailable = false,
  guidedDemo,
  onCreateDemoDatabase,
  onNewConnection,
  onNewQuery,
  onActionSearch,
}: {
  connectionName?: string;
  creatingDemo?: boolean;
  guidedDemoAvailable?: boolean;
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
  onActionSearch: (returnFocus?: HTMLElement | null) => void;
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
  }
  if (connected && onNewQuery) {
    commands.push({
      id: "new-query",
      icon: "play",
      label: t("ide.action.newQuery"),
      onClick: onNewQuery,
    });
  }
  commands.push({
    id: "new-data-source",
    icon: "database",
    label: t("connections.new"),
    onClick: onNewConnection,
  });
  if (!connected && onCreateDemoDatabase) {
    commands.push({
      id: "create-demo-sqlite",
      icon: "download",
      label: creatingDemo
        ? t(
            guidedDemoAvailable
              ? "onboarding.demoStarting"
              : "connections.demoCreating",
          )
        : t(
            guidedDemoAvailable
              ? "onboarding.demoStart"
              : "connections.demoSqlite",
          ),
      disabled: creatingDemo,
      onClick: onCreateDemoDatabase,
    });
  }
  commands.push({
    id: "search-everywhere",
    icon: "search",
    label: t("ide.action.actionSearch"),
    shortcut: "Shift ×2",
    onClick: onActionSearch,
  });

  return (
    <div className="tw:flex tw:h-full tw:min-h-0 tw:flex-col tw:overflow-hidden tw:bg-editor">
      <div className="tw:grid tw:min-h-0 tw:flex-1 tw:place-items-center tw:overflow-auto tw:p-5">
        <main className="tw:w-full tw:max-w-[320px]">
          <h1 className="tw:sr-only">{t("onboarding.title")}</h1>
          <ProductAnalyticsConsentPrompt />
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
            className="tw:overflow-hidden tw:rounded-md tw:border tw:border-border-subtle tw:bg-card"
            aria-label={t("onboarding.title")}
            role="group"
          >
            {commands.map((command) => (
              <div
                key={command.id}
                className="tw:border-b tw:border-border-subtle tw:last:border-b-0"
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
                  <span className="tw:flex tw:w-full tw:min-w-0 tw:items-center tw:justify-between tw:gap-4">
                    <span className="tw:truncate">{command.label}</span>
                    {command.shortcut ? (
                      <span className="tw:shrink-0 tw:font-mono tw:text-xs tw:font-normal tw:text-muted-foreground">
                        {command.shortcut}
                      </span>
                    ) : null}
                  </span>
                </Button>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
