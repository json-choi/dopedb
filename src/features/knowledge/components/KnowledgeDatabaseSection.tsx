// Database grant and exact-revision binding presentation for one environment.
import ConfirmButton from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import { Button } from "../../../design-system/components/Button";
import {
  Field,
  SelectInput,
  TextInput,
} from "../../../design-system/components/FormControls";
import {
  InlineNotice,
  LoadingLabel,
  StatusBadge,
} from "../../../design-system/components/Status";
import type { ConnectionProfile } from "../../connections/domain";
import { errMessage } from "../../../ipc/types";
import { useI18n } from "../../../lib/i18n";
import type { QueryResultPhase } from "../../../lib/queryResultPhase";
import type { EnvironmentConnection } from "../domain";

interface KnowledgeDatabaseSectionProps {
  environmentSelected: boolean;
  connectionsPhase: QueryResultPhase;
  connectionsLoaded: boolean;
  assignableConnections: ConnectionProfile[];
  connectionId: string;
  connectionRole: string;
  connectionAlias: string;
  bindPending: boolean;
  bindingsPhase: QueryResultPhase;
  bindingsLoaded: boolean;
  bindingsError: unknown;
  bindings: EnvironmentConnection[];
  unbindPending: boolean;
  onNewConnection?: () => void;
  onConnectionChange: (connection: ConnectionProfile) => void;
  onRoleChange: (role: string) => void;
  onAliasChange: (alias: string) => void;
  onBind: () => void;
  onRetryBindings: () => void;
  onReconfirm: (binding: EnvironmentConnection) => void;
  onUnbind: (bindingId: string) => void;
}

export function KnowledgeDatabaseSection({
  environmentSelected,
  connectionsPhase,
  connectionsLoaded,
  assignableConnections,
  connectionId,
  connectionRole,
  connectionAlias,
  bindPending,
  bindingsPhase,
  bindingsLoaded,
  bindingsError,
  bindings,
  unbindPending,
  onNewConnection,
  onConnectionChange,
  onRoleChange,
  onAliasChange,
  onBind,
  onRetryBindings,
  onReconfirm,
  onUnbind,
}: KnowledgeDatabaseSectionProps) {
  const { t } = useI18n();
  return (
    <section className="tw:grid tw:gap-3 tw:border-b tw:border-border-subtle tw:pb-5">
      <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-start tw:justify-between tw:gap-3">
        <div className="tw:grid tw:min-w-0 tw:gap-1">
          <h2 className="tw:m-0 tw:text-base tw:font-semibold">
            {t("knowledge.environmentDatabases")}
          </h2>
          <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
            {t("knowledge.environmentDatabasesBody")}
          </p>
        </div>
        {onNewConnection ? (
          <Button size="compact" onClick={onNewConnection}>
            <Icon name="plus" />
            {t("knowledge.newConnection")}
          </Button>
        ) : null}
      </div>
      {connectionsPhase === "coldLoading" ? (
        <LoadingLabel>{t("knowledge.loadingConnections")}</LoadingLabel>
      ) : connectionsLoaded ? (
        <>
          <div className="tw:grid tw:grid-cols-[minmax(0,1.2fr)_minmax(0,.7fr)_minmax(0,1fr)_auto] tw:items-end tw:gap-2 tw:@max-[760px]:grid-cols-2 tw:@max-[520px]:grid-cols-1">
            <Field label={t("knowledge.databaseConnection")}>
              <SelectInput
                value={connectionId}
                onChange={(event) => {
                  const connection = assignableConnections.find(
                    (candidate) => candidate.id === event.target.value,
                  );
                  if (connection) onConnectionChange(connection);
                }}
              >
                {assignableConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label={t("knowledge.role")}>
              <TextInput
                value={connectionRole}
                placeholder={t("knowledge.rolePlaceholder")}
                onChange={(event) => onRoleChange(event.target.value)}
              />
            </Field>
            <Field label={t("knowledge.alias")}>
              <TextInput
                value={connectionAlias}
                onChange={(event) => onAliasChange(event.target.value)}
              />
            </Field>
            <Button
              variant="primary"
              disabled={
                !environmentSelected ||
                !connectionId ||
                !connectionRole.trim() ||
                !connectionAlias.trim() ||
                bindPending
              }
              onClick={onBind}
            >
              {bindPending
                ? t("knowledge.binding")
                : t("knowledge.bindDatabase")}
            </Button>
          </div>
          {assignableConnections.length > 0 ? (
            <div className="tw:grid tw:overflow-hidden tw:rounded-md tw:border tw:border-border-subtle">
              <div className="tw:grid tw:gap-1 tw:border-b tw:border-border-subtle tw:bg-surface-subtle tw:px-3 tw:py-2">
                <strong className="tw:text-sm">
                  {t("knowledge.unassignedConnections")}
                </strong>
                <span className="tw:text-xs tw:text-muted-foreground">
                  {t("knowledge.unassignedConnectionsBody")}
                </span>
              </div>
              {assignableConnections.map((connection) => (
                <div
                  key={connection.id}
                  className="tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-3 tw:border-b tw:border-border-subtle tw:px-3 tw:py-2 tw:last:border-b-0 tw:@max-[560px]:grid-cols-1"
                >
                  <span className="tw:grid tw:min-w-0 tw:gap-1">
                    <strong className="tw:truncate tw:text-sm">
                      {connection.name}
                    </strong>
                    <span className="tw:truncate tw:text-xs tw:text-muted-foreground">
                      {connection.engine} · {connection.database}
                    </span>
                  </span>
                  <Button
                    size="compact"
                    variant={connection.id === connectionId ? "selected" : "ghost"}
                    onClick={() => onConnectionChange(connection)}
                  >
                    {connection.id === connectionId
                      ? t("knowledge.selected")
                      : t("knowledge.reviewBinding")}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {bindingsPhase === "coldLoading" ? (
        <LoadingLabel>{t("knowledge.loadingDatabases")}</LoadingLabel>
      ) : bindingsPhase === "coldError" && bindingsError ? (
        <InlineNotice
          tone="danger"
          icon="alert"
          role="alert"
          action={(
            <Button size="compact" onClick={onRetryBindings}>
              {t("knowledge.retry")}
            </Button>
          )}
        >
          {t("knowledge.databaseBindingsLoadFailed", {
            error: errMessage(bindingsError),
          })}
        </InlineNotice>
      ) : bindingsLoaded ? (
        <>
          {bindingsPhase === "staleError" && bindingsError ? (
            <InlineNotice
              tone="warning"
              icon="alert"
              role="status"
              action={(
                <Button size="compact" onClick={onRetryBindings}>
                  {t("knowledge.retry")}
                </Button>
              )}
            >
              {t("knowledge.databaseBindingsRefreshFailed", {
                error: errMessage(bindingsError),
              })}
            </InlineNotice>
          ) : null}
          {bindings.length === 0 ? (
            <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
              {t("knowledge.emptyDatabases")}
            </p>
          ) : (
            <div className="tw:grid tw:overflow-hidden tw:rounded-md tw:border tw:border-border-subtle">
              {bindings.map((binding) => (
                <div
                  key={binding.id}
                  className="tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-3 tw:border-b tw:border-border-subtle tw:px-3 tw:py-2 tw:last:border-b-0 tw:@max-[560px]:grid-cols-1"
                >
                  <span className="tw:grid tw:min-w-0 tw:gap-0.5">
                    <strong className="tw:truncate tw:text-sm">
                      {binding.alias}
                    </strong>
                    <span className="tw:truncate tw:text-xs tw:text-muted-foreground">
                      {t("knowledge.bindingMeta", {
                        name: binding.connectionName,
                        role: binding.role,
                        revision: binding.connectionRevision,
                      })}
                    </span>
                  </span>
                  <span className="ds-control-row tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2 tw:[--ds-row-control-size:var(--ds-control-md)]">
                    {binding.stale && binding.connectionId ? (
                      <Button
                        size="compact"
                        variant="ghost"
                        disabled={bindPending}
                        onClick={() => onReconfirm(binding)}
                      >
                        {t("knowledge.reconfirm")}
                      </Button>
                    ) : binding.stale ? (
                      <StatusBadge tone="warning">
                        {t("knowledge.reconfirm")}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="success">
                        {t("knowledge.pinned")}
                      </StatusBadge>
                    )}
                    <ConfirmButton
                      size="compact"
                      variant="dangerGhost"
                      disabled={unbindPending}
                      onConfirm={() => onUnbind(binding.id)}
                    >
                      {t("knowledge.remove")}
                    </ConfirmButton>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
