// First-run start list shown when the workspace has no local connections.
import {
  ToolWindowSection,
} from "../../design-system/components/ToolWindow";
import ConnectionStartList from "../../features/connections/ConnectionStartList";
import type { ConnectionLaunchPreset } from "../../features/connections/presets";
import { useI18n } from "../../lib/i18n";

export function DatabaseExplorerEmptyState({
  creatingDemo,
  onNewConnection,
  onCreateDemoDatabase,
}: {
  creatingDemo: boolean;
  onNewConnection: (preset?: ConnectionLaunchPreset) => void;
  onCreateDemoDatabase: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="tw:p-3">
      <ToolWindowSection title={t("connections.createDataSource")}>
        <ConnectionStartList
          creatingDemo={creatingDemo}
          onCreateDemoDatabase={onCreateDemoDatabase}
          onNewConnection={onNewConnection}
        />
      </ToolWindowSection>
    </div>
  );
}
