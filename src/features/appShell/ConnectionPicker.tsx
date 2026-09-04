import { useMemo } from "react";

import EngineMark from "../../components/EngineMark";
import { EnvironmentBadge } from "../../design-system/components/EnvironmentBadge";
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import {
  databaseDisplayLabel,
  type ConnectionProfile,
} from "../connections/domain";
import { ProviderTargetLabel } from "../connections/ProviderTargetLabel";
import { useI18n } from "../../lib/i18n";
import {
  buildConnectionSections,
  type SchemaConnectionGroup,
} from "../../lib/schemaDiff";

function connectionEndpoint(connection: ConnectionProfile) {
  if (connection.engine === "sqlite") {
    return databaseDisplayLabel(
      connection.engine,
      connection.database || connection.host,
    )
      || "sqlite";
  }
  return `${connection.host}${connection.port ? `:${connection.port}` : ""}`;
}

export default function ConnectionPicker({
  connections,
  onSelect,
  onNew,
}: {
  connections: ConnectionProfile[];
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { t } = useI18n();
  const sections = useMemo(() => buildConnectionSections(connections), [connections]);
  const grouped = sections.filter((section) => section.kind === "group");
  const singles = sections.filter((section) => section.kind === "single");

  function renderConnectionCard(connection: ConnectionProfile, grouped = false) {
    const name = connection.name || t("app.unnamed");
    const databaseLabel =
      databaseDisplayLabel(connection.engine, connection.database)
      || t("common.unknown");
    const endpoint = connectionEndpoint(connection);
    const showEndpoint = endpoint !== databaseLabel;
    const safetyLabel = connection.allowWrites && !connection.readonlyDefault
      ? t("ide.writeEnabled")
      : t("ide.readOnly");
    return (
      <button
        key={connection.id}
        type="button"
        className="tw:flex tw:min-h-[76px] tw:min-w-0 tw:cursor-pointer tw:flex-col tw:items-stretch tw:justify-between tw:gap-2 tw:rounded-md tw:border tw:border-border-subtle tw:bg-card tw:p-3 tw:font-sans tw:text-left tw:text-foreground tw:transition-[border-color,background] tw:duration-150 tw:hover:border-border-strong tw:hover:bg-selection/40 tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
        onClick={() => onSelect(connection.id)}
        title={`${connection.engine} · ${endpoint} · ${safetyLabel}`}
        aria-label={t("app.openConnection", { name })}
      >
        <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
          {!grouped && <EngineMark engine={connection.engine} />}
          <span className="tw:min-w-0 tw:overflow-hidden tw:text-body tw:font-bold tw:text-ellipsis tw:whitespace-nowrap">
            {name}
          </span>
          {connection.env ? (
            <span className="tw:ml-auto">
              <EnvironmentBadge environment={connection.env} />
            </span>
          ) : null}
        </span>
        <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:text-sm tw:text-muted-foreground tw:[&>span:not(.ds-meta-dot)]:min-w-0 tw:[&>span:not(.ds-meta-dot)]:overflow-hidden tw:[&>span:not(.ds-meta-dot)]:text-ellipsis tw:[&>span:not(.ds-meta-dot)]:whitespace-nowrap">
          <span>{databaseLabel}</span>
          {connection.providerTarget ? (
            <>
              <span className="ds-meta-dot tw:shrink-0" />
              <ProviderTargetLabel target={connection.providerTarget} showState />
            </>
          ) : null}
          {showEndpoint ? (
            <>
              <span className="ds-meta-dot tw:shrink-0" />
              <span>{endpoint}</span>
            </>
          ) : null}
          <span className="ds-meta-dot tw:shrink-0" />
          <span>{safetyLabel}</span>
        </span>
      </button>
    );
  }

  function renderGroup(group: SchemaConnectionGroup) {
    const engine = group.connections[0]?.engine;
    return (
      <section className="tw:grid tw:gap-2 tw:border-l-2 tw:border-primary tw:pl-3" key={group.key}>
        <div className="tw:flex tw:min-h-control-sm tw:items-center tw:justify-between tw:gap-3 tw:max-[760px]:flex-col tw:max-[760px]:items-start tw:max-[760px]:gap-1">
          <div className="tw:inline-flex tw:min-w-0 tw:items-center tw:gap-2 tw:text-title tw:font-bold tw:text-foreground">
            {engine ? (
              <EngineMark engine={engine} />
            ) : (
              <span className="tw:size-[9px] tw:shrink-0 tw:rounded-full tw:border-2 tw:border-primary" />
            )}
            <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
              {group.label}
            </span>
          </div>
        </div>
        <div className="tw:grid tw:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] tw:gap-3 tw:max-[760px]:grid-cols-1">
          {group.connections.map((connection) => renderConnectionCard(connection, true))}
        </div>
      </section>
    );
  }

  return (
    <div className="tw:mx-auto tw:flex tw:min-h-full tw:w-full tw:max-w-[1120px] tw:flex-col tw:gap-5">
      <div className="tw:flex tw:items-center tw:justify-between tw:gap-3 tw:max-[760px]:items-start">
        <h2 className="tw:m-0 tw:text-heading tw:leading-tight">
          {t("app.connectionPickerTitle")}
        </h2>
        <Button
          size="compact"
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            onNew();
          }}
        >
          <Icon name="plus" />
          {t("connections.new")}
        </Button>
      </div>

      {grouped.length > 0 && (
        <section className="tw:grid tw:gap-3">
          <div className="tw:text-xs tw:font-bold tw:tracking-[0.04em] tw:text-muted-foreground tw:uppercase">
            {t("app.connectionPickerGroups")}
          </div>
          {grouped.map((section) =>
            section.kind === "group" ? renderGroup(section.group) : null,
          )}
        </section>
      )}

      {singles.length > 0 && (
        <section className="tw:grid tw:gap-3">
          <div className="tw:text-xs tw:font-bold tw:tracking-[0.04em] tw:text-muted-foreground tw:uppercase">
            {t("app.connectionPickerSingles")}
          </div>
          <div className="tw:grid tw:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] tw:gap-3 tw:max-[760px]:grid-cols-1">
            {singles.map((section) =>
              section.kind === "single"
                ? renderConnectionCard(section.connection)
                : null,
            )}
          </div>
        </section>
      )}
    </div>
  );
}
