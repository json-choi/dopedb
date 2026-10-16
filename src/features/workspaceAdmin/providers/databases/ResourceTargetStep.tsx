// Second step of the add-database flow: one select per provider level. A level is
// enabled and discovered only once the level above it has a value, and each level
// shows its own loading, empty and failure state; the final level is filtered to
// resources that are ready and whose environment is known.
import { Button } from "../../../../design-system/components/Button";
import { Field, SelectInput } from "../../../../design-system/components/FormControls";
import { InlineNotice, LoadingLabel } from "../../../../design-system/components/Status";
import { useI18n } from "../../../../lib/i18n";
import type { Resource } from "../domain";
import {
  LEAF_INDEX,
  RESOURCE_LEVEL_LABELS,
  ResourceListShapeError,
} from "./model";
import { providerErrorDetail, suggestsProviderReconnect } from "./serverMessages";
import type { ManagedDatabaseImport } from "./useManagedDatabaseImport";

export default function ResourceTargetStep({
  flow,
  onConnectAccount,
}: {
  flow: ManagedDatabaseImport;
  onConnectAccount: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const { discovery, busy } = flow;
  const { levels, selection, queries, options } = discovery;

  if (!levels) {
    return (
      <InlineNotice tone="warning" icon="alert">
        {t("workspaceProviderDatabases.unsupportedProvider")}
      </InlineNotice>
    );
  }

  function optionLabel(item: Resource, leaf: boolean) {
    if (item.production === true) {
      return `${item.name} · ${t("workspaceProviderDatabases.productionSuffix")}`;
    }
    if (item.production === "unknown" && leaf) {
      return `${item.name} · ${t("workspaceProviderDatabases.environmentRequiredSuffix")}`;
    }
    if (item.ready === false) {
      return `${item.name} · ${t("workspaceProviderDatabases.notReadySuffix")}`;
    }
    return item.name;
  }

  const failedIndex = levels.findIndex((_, index) => queries[index].isError);
  const failed = failedIndex >= 0 ? queries[failedIndex] : null;
  const failedLevel = failedIndex >= 0
    ? t("workspaceProviderDatabases.levelError", {
        level: t(RESOURCE_LEVEL_LABELS[levels[failedIndex].kind]),
      })
    : "";
  const failedDetail = failed ? providerErrorDetail(failed.error, i18n) : null;

  return (
    <div className="tw:grid tw:min-w-0 tw:gap-3">
      <div className="tw:grid tw:min-w-0 tw:grid-cols-3 tw:items-start tw:gap-3 tw:@max-[640px]:grid-cols-1">
        {levels.map((level, index) => {
          const query = queries[index];
          const leaf = index === LEAF_INDEX;
          const label = t(RESOURCE_LEVEL_LABELS[level.kind]);
          const available = index === 0 || Boolean(selection[levels[index - 1].key]);
          return (
            <div key={level.key} className="tw:grid tw:min-w-0 tw:gap-1.5">
              <Field label={label}>
                <SelectInput
                  density="compact"
                  value={selection[level.key] ?? ""}
                  disabled={busy || !available || query.isFetching}
                  onChange={(event) => flow.chooseResource(index, event.target.value)}
                >
                  <option value="">{t("workspaceProviderDatabases.select")}</option>
                  {options[index].map((item) => (
                    <option key={item.id} value={item.value}>
                      {optionLabel(item, leaf)}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              {available && query.isFetching ? (
                <span className="tw:text-xs">
                  <LoadingLabel>
                    {t("workspaceProviderDatabases.levelLoading", { level: label })}
                  </LoadingLabel>
                </span>
              ) : null}
              {available && query.isSuccess && !query.isFetching && options[index].length === 0 ? (
                <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
                  {t(leaf
                    ? "workspaceProviderDatabases.leafEmpty"
                    : "workspaceProviderDatabases.levelEmpty")}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {failed && !failed.isFetching ? (
        <InlineNotice
          tone="danger"
          icon="alert"
          role="alert"
          action={
            <span className="tw:flex tw:flex-wrap tw:gap-2">
              {suggestsProviderReconnect(failed.error) ? (
                <Button size="compact" onClick={onConnectAccount}>
                  {t("workspaceProviderDatabases.goToAccounts")}
                </Button>
              ) : null}
              <Button size="compact" disabled={busy} onClick={() => void failed.refetch()}>
                {t("workspaceAdmin.retry")}
              </Button>
            </span>
          }
        >
          {failed.error instanceof ResourceListShapeError
            ? t("workspaceProviderDatabases.resourcesShapeError")
            : failedDetail
              ? `${failedLevel} ${failedDetail}`
              : failedLevel}
        </InlineNotice>
      ) : null}
    </div>
  );
}
