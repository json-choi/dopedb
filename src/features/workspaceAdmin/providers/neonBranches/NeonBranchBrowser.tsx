// Branch tree of one Neon project with search and state, protection and default
// markers, beside the selected branch's connection-switch and discard planning.
// Selection and drafts belong to the controller; this view renders and forwards.
import { useId } from "react";
import { Icon } from "../../../../components/Icon";
import { Button } from "../../../../design-system/components/Button";
import { Field, SelectInput, TextInput } from "../../../../design-system/components/FormControls";
import {
  InlineNotice,
  LoadingLabel,
  StatusBadge,
  StatusDot,
} from "../../../../design-system/components/Status";
import { useI18n } from "../../../../lib/i18n";
import type { NeonBranchInventoryItem, NeonEnvironment } from "./domain";
import {
  formatNeonTime,
  neonBlockerKey,
  neonBranchStateKey,
  neonBranchStateTone,
  neonEnvironmentKey,
  neonEnvironmentTone,
} from "./model";
import type { NeonBranchController } from "./useNeonBranchManager";

const MISSING_TARGET_NAMES = 5;

export default function NeonBranchBrowser({ controller }: { controller: NeonBranchController }) {
  const { t, lang } = useI18n();
  const titleId = useId();
  const { inventory, inventoryPhase, inventoryError, visibleBranches, selectedBranch, search } = controller;
  const missingTargets = inventory?.missingTargets ?? [];
  const missingNames = missingTargets.slice(0, MISSING_TARGET_NAMES).map((item) => item.connectionName);

  return (
    <div className="tw:grid tw:min-w-0 tw:grid-cols-[minmax(220px,0.85fr)_minmax(0,1.3fr)] tw:items-start tw:gap-5 tw:border-t tw:border-border-subtle tw:pt-3 tw:@max-[680px]:grid-cols-1">
      <section aria-labelledby={titleId} className="tw:grid tw:min-w-0 tw:content-start tw:gap-2">
        <div className="tw:flex tw:min-w-0 tw:items-baseline tw:justify-between tw:gap-2">
          <h4 id={titleId} className="tw:m-0 tw:text-ui tw:font-semibold tw:text-foreground">
            {t("workspaceNeonBranches.branches")}
          </h4>
          {inventory ? (
            <span className="tw:shrink-0 tw:text-2xs tw:text-muted-foreground">
              {t("workspaceNeonBranches.observedAt", {
                time: formatNeonTime(inventory.observedAt, lang, false),
              })}
            </span>
          ) : null}
        </div>
        <TextInput
          type="search"
          density="compact"
          value={search}
          placeholder={t("workspaceNeonBranches.searchPlaceholder")}
          aria-label={t("workspaceNeonBranches.searchAria")}
          onChange={(event) => controller.setSearch(event.target.value)}
        />
        {missingTargets.length > 0 ? (
          <InlineNotice tone="warning" icon="alert">
            {t("workspaceNeonBranches.missingTargets", {
              count: missingTargets.length,
              names: missingTargets.length > MISSING_TARGET_NAMES
                ? `${missingNames.join(", ")}, …`
                : missingNames.join(", "),
            })}
          </InlineNotice>
        ) : null}
        {inventoryPhase === "coldLoading" ? (
          <p className="tw:m-0 tw:py-2 tw:text-sm">
            <LoadingLabel>{t("workspaceNeonBranches.loadingBranches")}</LoadingLabel>
          </p>
        ) : null}
        {inventoryError ? (
          <InlineNotice
            tone="danger"
            icon="alert"
            role="alert"
            action={(
              <Button
                size="compact"
                disabled={controller.busy || controller.refreshing}
                onClick={controller.refresh}
              >
                {t("workspaceAdmin.retry")}
              </Button>
            )}
          >
            {inventoryError}
          </InlineNotice>
        ) : null}
        {inventory && visibleBranches.length > 0 ? (
          <ul
            aria-label={t("workspaceNeonBranches.branchesAria")}
            className="tw:m-0 tw:grid tw:max-h-[340px] tw:list-none tw:content-start tw:gap-0.5 tw:overflow-y-auto tw:p-0"
          >
            {visibleBranches.map((branch) => (
              <NeonBranchRow
                key={branch.id}
                branch={branch}
                selected={branch.id === selectedBranch?.id}
                onSelect={controller.selectBranch}
              />
            ))}
          </ul>
        ) : null}
        {inventory && visibleBranches.length === 0 ? (
          <p className="tw:m-0 tw:py-2 tw:text-sm tw:text-muted-foreground">
            {t(search.trim()
              ? "workspaceNeonBranches.noSearchResults"
              : "workspaceNeonBranches.noBranches")}
          </p>
        ) : null}
      </section>

      <div className="tw:grid tw:min-w-0 tw:content-start tw:gap-4">
        <SelectedBranchSummary controller={controller} />
        <SwitchConnectionSection controller={controller} />
        <DiscardBranchSection controller={controller} />
      </div>
    </div>
  );
}

function NeonBranchRow({
  branch,
  selected,
  onSelect,
}: {
  branch: NeonBranchInventoryItem;
  selected: boolean;
  onSelect: (branchId: string) => void;
}) {
  const { t, lang } = useI18n();
  const state = branch.pendingState ?? branch.currentState;
  const detail = branch.connections.length > 0
    ? branch.connections.map((connection) => connection.connectionName).join(", ")
    : branch.id;
  return (
    <li className="tw:min-w-0">
      <Button
        presentation="listItem"
        labelBehavior="wrap"
        active={selected}
        aria-pressed={selected}
        disabled={!branch.ready || Boolean(branch.pendingState)}
        onClick={() => onSelect(branch.id)}
      >
        {branch.depth > 0 ? (
          <span
            aria-hidden="true"
            data-depth={Math.min(branch.depth, 4)}
            className="tw:shrink-0 tw:data-[depth=1]:w-2 tw:data-[depth=2]:w-5 tw:data-[depth=3]:w-8 tw:data-[depth=4]:w-11"
          />
        ) : null}
        <Icon name="branch" className="tw:shrink-0 tw:self-start tw:mt-0.5 tw:text-muted-foreground" />
        <span className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-1">
          <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
            <span className="tw:min-w-0 tw:truncate">{branch.name}</span>
            {state !== "ready" ? (
              <span className="tw:inline-flex tw:shrink-0 tw:items-center tw:gap-1 tw:text-2xs tw:font-normal tw:text-muted-foreground">
                <StatusDot tone={neonBranchStateTone(state)} />
                {t(neonBranchStateKey[state])}
              </span>
            ) : null}
          </span>
          <span className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-1">
            {branch.default ? (
              <StatusBadge density="compact">{t("workspaceNeonBranches.markerDefault")}</StatusBadge>
            ) : null}
            {branch.protected ? (
              <StatusBadge density="compact" tone="warning">
                {t("workspaceNeonBranches.markerProtected")}
              </StatusBadge>
            ) : null}
            {branch.initSource === "schema-only" ? (
              <StatusBadge density="compact">{t("workspaceNeonBranches.markerSchemaOnly")}</StatusBadge>
            ) : null}
            {branch.expiresAt ? (
              <StatusBadge
                density="compact"
                title={t("workspaceNeonBranches.expiresAt", { time: formatNeonTime(branch.expiresAt, lang) })}
              >
                {t("workspaceNeonBranches.markerEphemeral")}
              </StatusBadge>
            ) : null}
            <span className="tw:min-w-0 tw:truncate tw:text-2xs tw:font-normal tw:text-muted-foreground">
              {detail}
            </span>
          </span>
        </span>
      </Button>
    </li>
  );
}

function SelectedBranchSummary({ controller }: { controller: NeonBranchController }) {
  const { t } = useI18n();
  const { selectedBranch: branch, knownEnvironment } = controller;
  if (!controller.inventory) return null;
  if (!branch) {
    return (
      <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
        {t("workspaceNeonBranches.selectBranchHint")}
      </p>
    );
  }
  return (
    <div className="tw:grid tw:min-w-0 tw:gap-1">
      <span className="tw:text-2xs tw:font-semibold tw:uppercase tw:tracking-[0.05em] tw:text-muted-foreground">
        {t("workspaceNeonBranches.selectedBranch")}
      </span>
      <strong className="tw:truncate tw:text-ui tw:font-semibold tw:text-foreground">{branch.name}</strong>
      <span className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1 tw:text-xs tw:text-muted-foreground">
        <code className="tw:min-w-0 tw:truncate tw:font-mono">{branch.id}</code>
        <span className="tw:inline-flex tw:items-center tw:gap-1.5">
          <StatusDot tone={knownEnvironment ? neonEnvironmentTone[knownEnvironment] : "neutral"} />
          {t(knownEnvironment
            ? neonEnvironmentKey[knownEnvironment]
            : "workspaceNeonBranches.environmentUnknown")}
        </span>
        <span>{t("workspaceNeonBranches.connectionCount", { count: branch.connections.length })}</span>
      </span>
    </div>
  );
}

function SwitchConnectionSection({ controller }: { controller: NeonBranchController }) {
  const { t } = useI18n();
  const titleId = useId();
  const {
    busy,
    pending,
    selectedBranch,
    switchConnections,
    selectedSwitchConnection,
    switchTargetReady,
    switchTargetConflict,
  } = controller;
  if (!selectedBranch || switchConnections.length === 0) return null;
  const error = controller.errorFor("switch");

  return (
    <section
      data-primary-flow
      aria-labelledby={titleId}
      className="tw:grid tw:min-w-0 tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-3"
    >
      <div className="tw:grid tw:min-w-0 tw:gap-1">
        <h4 id={titleId} className="tw:m-0 tw:text-ui tw:font-semibold tw:text-foreground">
          {t("workspaceNeonBranches.switchTitle")}
        </h4>
        <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
          {t("workspaceNeonBranches.switchDescription")}
        </p>
      </div>
      <div className="tw:grid tw:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] tw:gap-3">
        <Field label={t("workspaceNeonBranches.switchConnection")}>
          <SelectInput
            density="compact"
            value={selectedSwitchConnection?.connectionId ?? ""}
            disabled={busy}
            onChange={(event) => controller.chooseSwitchConnection(event.target.value)}
          >
            {switchConnections.map((connection) => (
              <option key={connection.connectionId} value={connection.connectionId}>
                {connection.connectionName} · {connection.branchName}
              </option>
            ))}
          </SelectInput>
        </Field>
        {!controller.knownEnvironment ? (
          <Field label={t("workspaceNeonBranches.targetEnvironment")}>
            <SelectInput
              density="compact"
              value={controller.switchEnvironmentChoice}
              disabled={busy}
              onChange={(event) => controller.chooseSwitchEnvironment(
                event.target.value as NeonEnvironment | "",
              )}
            >
              <option value="">{t("workspaceNeonBranches.chooseEnvironment")}</option>
              <option value="development">{t("workspaceNeonBranches.environmentDevelopment")}</option>
              <option value="production">{t("workspaceNeonBranches.environmentProduction")}</option>
            </SelectInput>
          </Field>
        ) : null}
      </div>
      {selectedSwitchConnection?.branchId === selectedBranch.id ? (
        <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
          {t("workspaceNeonBranches.alreadyTarget")}
        </p>
      ) : !switchTargetReady ? (
        <InlineNotice tone="warning" icon="alert">{t("workspaceNeonBranches.targetNotReady")}</InlineNotice>
      ) : switchTargetConflict ? (
        <InlineNotice tone="warning" icon="alert">{t("workspaceNeonBranches.targetConflict")}</InlineNotice>
      ) : (
        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
          <p className="tw:m-0 tw:min-w-0 tw:flex-1 tw:basis-[220px] tw:text-xs tw:leading-body tw:text-muted-foreground">
            {t("workspaceNeonBranches.activeLeases", {
              count: selectedSwitchConnection?.activeLeaseCount ?? 0,
            })}
          </p>
          {controller.canPlanSwitch ? (
            <Button size="compact" variant="primary" disabled={busy} onClick={controller.planSelectedSwitch}>
              {t(pending?.kind === "switchPlan"
                ? "workspaceNeonBranches.planning"
                : "workspaceNeonBranches.createSwitchPlan")}
            </Button>
          ) : null}
        </div>
      )}
      {error ? <InlineNotice tone="danger" icon="alert" role="alert">{error}</InlineNotice> : null}
    </section>
  );
}

function DiscardBranchSection({ controller }: { controller: NeonBranchController }) {
  const { t } = useI18n();
  const titleId = useId();
  const branch = controller.selectedBranch;
  if (!branch?.deletion) return null;
  const error = controller.errorFor("delete");
  const blockers = branch.deletion.blockerCodes;

  return (
    <section
      aria-labelledby={titleId}
      className="tw:grid tw:min-w-0 tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-3"
    >
      <div className="tw:flex tw:items-start tw:justify-between tw:gap-3 tw:@max-[520px]:flex-col">
        <div className="tw:grid tw:min-w-0 tw:gap-1">
          <h4 id={titleId} className="tw:m-0 tw:truncate tw:text-ui tw:font-semibold tw:text-foreground">
            {t("workspaceNeonBranches.ownedBranch", { name: branch.name })}
          </h4>
          <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
            {t("workspaceNeonBranches.deleteDescription")}
          </p>
        </div>
        {branch.deletion.canPlan ? (
          <Button
            size="compact"
            tone="danger"
            disabled={controller.busy}
            onClick={controller.planSelectedDelete}
          >
            {t(controller.pending?.kind === "deletePlan"
              ? "workspaceNeonBranches.planning"
              : "workspaceNeonBranches.createDeletePlan")}
          </Button>
        ) : null}
      </div>
      {blockers.length > 0 ? (
        <InlineNotice tone="warning" icon="lock">
          <span className="tw:grid tw:gap-1">
            {blockers.map((code) => {
              const key = neonBlockerKey(code);
              return (
                <span key={code}>
                  {key ? t(key) : <code className="tw:font-mono">{code}</code>}
                </span>
              );
            })}
          </span>
        </InlineNotice>
      ) : null}
      {error ? <InlineNotice tone="danger" icon="alert" role="alert">{error}</InlineNotice> : null}
    </section>
  );
}
