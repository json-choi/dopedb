// Presents the native target database and its draft-scoped discovery states.
// Discovery may suggest names, but only explicit input changes select a target.
import { useEffect, useRef } from "react";
import { Icon } from "../../components/Icon";
import InfoTip from "../../components/InfoTip";
import { Button } from "../../design-system/components/Button";
import { PropertyRow, TextInput } from "../../design-system/components/FormControls";
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";

export function ConnectionDatabaseField({ profile, busy }: {
  profile: ConnectionEditorController["profile"];
  busy: boolean;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const { form, set, flags, databaseDiscovery, validation } = profile;
  const { canEditConnection, canDiscoverDatabases, isMongo } = flags;
  useEffect(() => {
    if (databaseDiscovery.databases.length === 0) return;
    const input = inputRef.current;
    if (document.activeElement !== input) return;
    try {
      input?.showPicker?.();
    } catch {
      // Some WebViews require a direct gesture; the focused input retains its list.
    }
  }, [databaseDiscovery.databases]);

  return (
    <PropertyRow
      label={t("connections.database")}
      htmlFor="connection-database"
      validation={validation.database}
      hint={isMongo ? <InfoTip label={t("connections.databaseRequiredHint")} /> : null}
    >
      {({ controlProps }) => (
        <div className="tw:grid tw:gap-1.5">
          <TextInput
            {...controlProps({ "aria-describedby": canDiscoverDatabases ? "connection-database-discovery-status" : undefined })}
            ref={inputRef}
            id="connection-database"
            density="compact"
            value={form.database}
            list={canDiscoverDatabases && databaseDiscovery.databases.length > 0 ? "connection-database-options" : undefined}
            disabled={!canEditConnection || busy}
            required
            onChange={(event) => set("database", event.target.value)}
            onFocus={() => void databaseDiscovery.discover()}
          />
          {canDiscoverDatabases && databaseDiscovery.databases.length > 0 ? (
            <datalist id="connection-database-options">
              {databaseDiscovery.databases.map((database) => <option key={database} value={database}>{database}</option>)}
            </datalist>
          ) : null}
          {canDiscoverDatabases ? (
            <>
              <div id="connection-database-discovery-status" role="status" aria-live="polite" className="tw:text-xs tw:leading-body tw:text-muted-foreground">
                {databaseDiscovery.phase === "loading" ? t("connections.databaseDiscoveryLoading")
                  : databaseDiscovery.phase === "empty" ? t("connections.databaseDiscoveryEmpty")
                    : databaseDiscovery.phase === "error" ? t("connections.databaseDiscoveryFailed") : null}
              </div>
              {databaseDiscovery.phase === "error" || databaseDiscovery.phase === "empty" ? (
                <Button size="compact" onClick={() => void databaseDiscovery.discover()} disabled={busy}>
                  <Icon name="refresh" />{t("connections.databaseDiscoveryRetry")}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </PropertyRow>
  );
}
