"use client";

// The view renders the Neon branch controller without owning provider workflow state.
import {
  ControlButton,
  ControlField,
  ControlInput,
  ControlLink,
  ControlSelect,
} from "../../app/components/Controls";
import type { Integration, ManagedConnection } from "./domain";
import {
  deletionBlockerLabel,
  operationBusy,
  operationLabel,
  operationTone,
  safeRunPhaseDescription,
  safeRunPhaseLabel,
  safeRunStepState,
  warningLabel,
  type SourcePointKind,
} from "./neonBranchManagerModel";
import { useNeonBranchManager } from "./useNeonBranchManager";
import { localizedWorkspacePath } from "../../lib/workspace-locale";
import { localizedIntegrationDisplayName } from "../../lib/workspace-provider-copy";

export function NeonBranchManager({
  workspaceId,
  integrations,
  managedConnections,
}: {
  workspaceId: string;
  integrations: readonly Integration[];
  managedConnections: readonly ManagedConnection[];
}) {
  const {
    locale,
    copy,
    common,
    safeRunSteps,
    targets,
    targetKey,
    setTargetKey,
    inventory,
    operations,
    search,
    setSearch,
    sourceBranchId,
    setSourceBranchId,
    targetName,
    setTargetName,
    initSource,
    setInitSource,
    sourcePointKind,
    setSourcePointKind,
    sourcePointValue,
    setSourcePointValue,
    endpoint,
    setEndpoint,
    environment,
    setEnvironment,
    switchEnvironment,
    setSwitchEnvironment,
    showCreate,
    setShowCreate,
    loading,
    mutation,
    error,
    selectedTarget,
    selectedBranch,
    knownEnvironment,
    effectiveEnvironment,
    switchConnections,
    selectedSwitchConnection,
    switchKnownEnvironment,
    visibleBranches,
    safeRun,
    load,
    planCreate,
    planDelete,
    planSwitch,
    mutateOperation,
    switchTargetConflict,
    switchTargetReady,
    canPlanSwitch,
    safeRunSourceConnections,
    safeRunSourceConnection,
    safeRunTargetEnvironment,
    safeRunCanIsolate,
    safeRunCanReturn,
    setSwitchConnectionId,
  } = useNeonBranchManager({ workspaceId, integrations, managedConnections });

  if (targets.length === 0) return null;

  return (
    <section className="tw:grid tw:border tw:border-border" aria-labelledby="neon-branch-title">
      <header className="tw:flex tw:items-start tw:justify-between tw:gap-4 tw:border-b tw:border-border tw:bg-surface-inset tw:px-4 tw:py-3 tw:max-[640px]:grid">
        <div className="tw:grid tw:gap-1">
          <strong id="neon-branch-title" className="tw:text-xs tw:text-foreground">
            {copy.title}
          </strong>
          <small className="tw:max-w-[44rem] tw:text-2xs tw:leading-body tw:text-muted-foreground">
            {copy.description}
          </small>
        </div>
        <div className="tw:flex tw:flex-wrap tw:gap-2">
          <ControlButton onClick={() => void load()} disabled={loading || Boolean(mutation)}>
            {loading ? common.loading : copy.refresh}
          </ControlButton>
          <ControlButton
            tone={showCreate ? "neutral" : "primary"}
            onClick={() => setShowCreate((current) => !current)}
            disabled={loading || !inventory}
          >
            {showCreate ? copy.closeCreate : copy.createSafeBranch}
          </ControlButton>
        </div>
      </header>

      {loading || mutation || operations.some(operationBusy) ? (
        <div className="tw:h-1 tw:overflow-hidden tw:bg-surface-inset" role="progressbar" aria-label={copy.progress}>
          <span className="tw:block tw:h-full tw:w-1/2 tw:animate-pulse tw:bg-primary" />
        </div>
      ) : null}

      <div className="tw:grid tw:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.4fr)] tw:max-[760px]:grid-cols-1">
        <aside className="tw:grid tw:min-w-0 tw:content-start tw:gap-3 tw:border-r tw:border-border tw:p-4 tw:max-[760px]:border-r-0 tw:max-[760px]:border-b">
          {targets.length > 1 ? (
            <ControlField label={copy.neonProject}>
              <ControlSelect
                value={selectedTarget ? `${selectedTarget.integration.id}:${selectedTarget.projectId}` : ""}
                onChange={(event) => setTargetKey(event.target.value)}
                disabled={loading || Boolean(mutation)}
              >
                {targets.map((target) => (
                  <option
                    key={`${target.integration.id}:${target.projectId}`}
                    value={`${target.integration.id}:${target.projectId}`}
                  >
                    {localizedIntegrationDisplayName(
                      target.integration.displayName,
                      locale,
                    )} · {target.projectId}
                  </option>
                ))}
              </ControlSelect>
            </ControlField>
          ) : (
            <div className="tw:grid tw:gap-1">
              <span className="tw:font-mono tw:text-2xs tw:uppercase tw:text-muted-foreground">{copy.project}</span>
              <strong className="tw:truncate tw:text-xs tw:text-foreground">{selectedTarget?.projectId}</strong>
            </div>
          )}
          <ControlInput
            type="search"
            placeholder={copy.searchPlaceholder}
            aria-label={copy.searchAria}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="tw:grid tw:border-t tw:border-border" role="listbox" aria-label={copy.branchesAria}>
            {visibleBranches.map((branch) => (
              <button
                key={branch.id}
                type="button"
                role="option"
                aria-selected={sourceBranchId === branch.id}
                data-selected={sourceBranchId === branch.id}
                className="tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:border-0 tw:border-b tw:border-border tw:bg-transparent tw:px-2 tw:py-2 tw:text-left tw:text-foreground tw:hover:bg-surface-raised tw:data-[selected=true]:bg-selection tw:disabled:cursor-not-allowed tw:disabled:opacity-[var(--ds-disabled-opacity)]"
                disabled={!branch.ready || Boolean(branch.pendingState)}
                onClick={() => setSourceBranchId(branch.id)}
              >
                <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
                  <span className="tw:shrink-0 tw:font-mono tw:text-2xs tw:text-muted-foreground" aria-hidden="true">
                    {branch.depth === 0 ? "●" : `${"· ".repeat(branch.depth)}└`}
                  </span>
                  <span className="tw:min-w-0">
                    <strong className="tw:block tw:truncate tw:text-xs">{branch.name}</strong>
                    <small className="tw:block tw:truncate tw:text-2xs tw:text-muted-foreground">
                      {branch.connections.length > 0
                        ? branch.connections.map((connection) => connection.connectionName).join(", ")
                        : branch.id}
                    </small>
                  </span>
                </span>
                <span className="tw:flex tw:flex-wrap tw:justify-end tw:gap-1">
                  {branch.default ? <span className="tw:border tw:border-border tw:px-1 tw:font-mono tw:text-2xs">default</span> : null}
                  {branch.protected ? <span className="tw:border tw:border-danger/40 tw:px-1 tw:font-mono tw:text-2xs tw:text-danger">protected</span> : null}
                  {branch.initSource === "schema-only" ? <span className="tw:border tw:border-border tw:px-1 tw:font-mono tw:text-2xs">schema</span> : null}
                  {branch.expiresAt ? <span className="tw:border tw:border-warning/40 tw:px-1 tw:font-mono tw:text-2xs tw:text-warning">ephemeral</span> : null}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="tw:grid tw:min-w-0 tw:content-start tw:gap-4 tw:p-4">
          {safeRun ? (
            <section className="tw:grid tw:gap-3 tw:border-b tw:border-border tw:pb-4" aria-labelledby="neon-safe-run-title">
              <div className="tw:flex tw:items-start tw:justify-between tw:gap-3 tw:max-[560px]:grid">
                <div className="tw:grid tw:min-w-0 tw:gap-1">
                  <strong id="neon-safe-run-title" className="tw:truncate tw:text-xs tw:text-foreground">
                    {copy.safeRun.currentTitle} · {safeRun.branch?.name ?? safeRun.createOperation.plan.target.name}
                  </strong>
                  <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                    {safeRunPhaseDescription(safeRun.phase, locale)}
                  </small>
                </div>
                <span
                  className="tw:shrink-0 tw:border tw:border-border tw:px-2 tw:py-1 tw:font-mono tw:text-2xs tw:text-muted-foreground tw:data-[state=attention]:border-danger/40 tw:data-[state=attention]:text-danger tw:data-[state=complete]:border-success/40 tw:data-[state=complete]:text-success tw:data-[state=active]:border-primary/40 tw:data-[state=active]:text-primary"
                  data-state={safeRun.phase === "discarded"
                    ? "complete"
                    : safeRun.phase === "needs_attention"
                      ? "attention"
                      : "active"}
                >
                  {safeRunPhaseLabel(safeRun.phase, locale)}
                </span>
              </div>

              <ol className="tw:m-0 tw:grid tw:list-none tw:grid-cols-4 tw:gap-px tw:p-0 tw:max-[560px]:grid-cols-2" aria-label={copy.safeRun.aria}>
                {safeRunSteps.map((label, index) => {
                  const state = safeRunStepState(safeRun.phase, index + 1);
                  return (
                    <li
                      key={label}
                      className="tw:grid tw:min-w-0 tw:gap-1 tw:border tw:border-border tw:bg-surface-inset tw:px-2 tw:py-2 tw:text-2xs tw:text-muted-foreground tw:data-[state=active]:border-primary/40 tw:data-[state=active]:text-foreground tw:data-[state=complete]:text-primary"
                      data-state={state}
                    >
                      <span className="tw:font-mono tw:text-[10px] tw:uppercase">
                        {String(index + 1).padStart(2, "0")} · {state === "complete"
                          ? copy.stepComplete
                          : state === "active"
                            ? copy.stepCurrent
                            : copy.stepWaiting}
                      </span>
                      <strong className="tw:truncate tw:text-xs tw:font-medium">{label}</strong>
                    </li>
                  );
                })}
              </ol>

              <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:max-[560px]:grid">
                <small className="tw:min-w-0 tw:text-2xs tw:leading-body tw:text-muted-foreground">
                  {safeRun.sourceBranch?.name ?? safeRun.createOperation.plan.source.name}
                  {" → "}
                  {safeRun.branch?.name ?? safeRun.createOperation.plan.target.name}
                  {safeRun.activeConnection
                    ? ` · ${safeRun.activeConnection.connectionName}`
                    : ""}
                </small>
                <div className="tw:flex tw:flex-wrap tw:justify-end tw:gap-2 tw:max-[560px]:justify-start">
                  {safeRun.phase === "access_required" ? (
                    <ControlLink
                      href={localizedWorkspacePath(
                        `/settings?workspace=${encodeURIComponent(workspaceId)}`
                          + `&section=providers&integration=${encodeURIComponent(selectedTarget?.integration.id ?? "")}`,
                        locale,
                      )}
                      data-tone="primary"
                    >
                      {copy.safeRun.openAccess}
                    </ControlLink>
                  ) : null}
                  {safeRun.phase === "ready_to_isolate" && !safeRunCanIsolate ? (
                    <ControlButton
                      onClick={() => {
                        if (!safeRun.branch) return;
                        setSourceBranchId(safeRun.branch.id);
                        setSwitchConnectionId(safeRunSourceConnections[0]?.connectionId ?? "");
                      }}
                      disabled={Boolean(mutation)}
                    >
                      {copy.safeRun.selectConnection}
                    </ControlButton>
                  ) : null}
                  {safeRun.phase === "ready_to_isolate" && safeRunCanIsolate ? (
                    <ControlButton
                      tone="primary"
                      onClick={() => {
                        if (!safeRun.branch || !safeRunSourceConnection || !safeRunTargetEnvironment) return;
                        void planSwitch(
                          safeRunSourceConnection.connectionId,
                          safeRun.branch,
                          safeRunTargetEnvironment,
                          "safe-isolate-plan",
                        );
                      }}
                      disabled={Boolean(mutation)}
                    >
                      {mutation === "safe-isolate-plan" ? copy.safeRun.planning : copy.safeRun.isolationPlan}
                    </ControlButton>
                  ) : null}
                  {safeRun.phase === "isolated_active" && safeRunCanReturn ? (
                    <ControlButton
                      tone="primary"
                      onClick={() => {
                        if (!safeRun.activeConnection || !safeRun.sourceBranch) return;
                        void planSwitch(
                          safeRun.activeConnection.connectionId,
                          safeRun.sourceBranch,
                          safeRun.createOperation.plan.source.environment,
                          "safe-return-plan",
                        );
                      }}
                      disabled={Boolean(mutation)}
                    >
                      {mutation === "safe-return-plan" ? copy.safeRun.planning : copy.safeRun.returnPlan}
                    </ControlButton>
                  ) : null}
                  {safeRun.phase === "ready_to_discard" && safeRun.branch?.deletion?.canPlan ? (
                    <ControlButton
                      tone="danger"
                      onClick={() => void planDelete(safeRun.branch, "safe-delete-plan")}
                      disabled={Boolean(mutation)}
                    >
                      {mutation === "safe-delete-plan" ? copy.safeRun.planning : copy.safeRun.discardPlan}
                    </ControlButton>
                  ) : null}
                </div>
              </div>
              {safeRun.phase === "isolated_active" && !safeRun.switchedFromSource ? (
                <p className="tw:m-0 tw:border tw:border-warning/40 tw:bg-warning/10 tw:px-3 tw:py-2 tw:text-2xs tw:leading-body tw:text-warning">
                  {copy.safeRun.standaloneNotice}
                </p>
              ) : null}
            </section>
          ) : null}

          {selectedBranch && switchConnections.length > 0 ? (
            <section className="tw:grid tw:gap-3 tw:border-b tw:border-border tw:pb-4" aria-labelledby="neon-switch-title">
              <div className="tw:grid tw:gap-1">
                <strong id="neon-switch-title" className="tw:text-xs tw:text-foreground">
                  {copy.switchTitle}
                </strong>
                <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                  {copy.switchDescription}
                </small>
              </div>
              <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:max-[560px]:grid-cols-1">
                <ControlField label={copy.switchConnection}>
                  <ControlSelect
                    value={selectedSwitchConnection?.connectionId ?? ""}
                    onChange={(event) => setSwitchConnectionId(event.target.value)}
                    disabled={Boolean(mutation)}
                  >
                    {switchConnections.map((connection) => (
                      <option key={connection.connectionId} value={connection.connectionId}>
                        {connection.connectionName} · {connection.branchName}
                      </option>
                    ))}
                  </ControlSelect>
                </ControlField>
                <div className="tw:grid tw:content-start tw:gap-2">
                  <span className="tw:font-mono tw:text-2xs tw:font-semibold tw:uppercase tw:text-muted-foreground">
                    {copy.targetBranch}
                  </span>
                  <span className="tw:flex tw:h-control-field tw:min-w-0 tw:items-center tw:border tw:border-border tw:bg-surface-inset tw:px-3 tw:text-xs tw:text-foreground">
                    <span className="tw:truncate">{selectedBranch.name}</span>
                  </span>
                </div>
                {!switchKnownEnvironment ? (
                  <ControlField label={copy.targetEnvironment}>
                    <ControlSelect
                      value={switchEnvironment}
                      onChange={(event) => setSwitchEnvironment(event.target.value as typeof switchEnvironment)}
                      disabled={Boolean(mutation)}
                    >
                      <option value="">{copy.chooseEnvironment}</option>
                      <option value="development">{common.development}</option>
                      <option value="production">{common.production}</option>
                    </ControlSelect>
                  </ControlField>
                ) : null}
              </div>
              {selectedSwitchConnection?.branchId === selectedBranch.id ? (
                <p className="tw:m-0 tw:text-2xs tw:leading-body tw:text-muted-foreground">
                  {copy.alreadyTarget}
                </p>
              ) : !switchTargetReady ? (
                <p className="tw:m-0 tw:border tw:border-warning/40 tw:bg-warning/10 tw:px-3 tw:py-2 tw:text-2xs tw:leading-body tw:text-warning">
                  {copy.targetNotReady}
                </p>
              ) : switchTargetConflict ? (
                <p className="tw:m-0 tw:border tw:border-warning/40 tw:bg-warning/10 tw:px-3 tw:py-2 tw:text-2xs tw:leading-body tw:text-warning">
                  {copy.targetConflict}
                </p>
              ) : (
                <div className="tw:flex tw:items-center tw:justify-between tw:gap-3 tw:max-[560px]:grid">
                  <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                    {copy.activeLeasePrefix}{" "}
                    {selectedSwitchConnection?.activeLeaseCount ?? 0}
                    {locale === "ko" ? "" : " "}{copy.activeLeaseSuffix}
                  </small>
                  {canPlanSwitch ? (
                    <ControlButton
                      tone="primary"
                      onClick={() => void planSwitch()}
                      disabled={Boolean(mutation)}
                    >
                      {mutation === "switch-plan" ? copy.safeRun.planning : copy.createSwitchPlan}
                    </ControlButton>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}

          {selectedBranch?.deletion ? (
            <section className="tw:grid tw:gap-3 tw:border-b tw:border-border tw:pb-4" aria-labelledby="neon-delete-title">
              <div className="tw:flex tw:items-start tw:justify-between tw:gap-3 tw:max-[560px]:grid">
                <div className="tw:grid tw:min-w-0 tw:gap-1">
                  <strong id="neon-delete-title" className="tw:truncate tw:text-xs tw:text-foreground">
                    {copy.ownedBranch} · {selectedBranch.name}
                  </strong>
                  <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                    {copy.deleteDescription}
                  </small>
                </div>
                {selectedBranch.deletion.canPlan ? (
                  <ControlButton
                    tone="danger"
                    onClick={() => void planDelete()}
                    disabled={Boolean(mutation)}
                  >
                    {mutation === "delete-plan" ? copy.safeRun.planning : copy.createDeletePlan}
                  </ControlButton>
                ) : null}
              </div>
              {selectedBranch.deletion.blockerCodes.length > 0 ? (
                <ul className="tw:m-0 tw:grid tw:list-none tw:gap-1 tw:border tw:border-warning/40 tw:bg-warning/10 tw:px-3 tw:py-2 tw:text-2xs tw:leading-body tw:text-warning">
                  {selectedBranch.deletion.blockerCodes.map((code) => (
                    <li key={code}>· {deletionBlockerLabel(code, locale)}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {showCreate ? (
            <section className="tw:grid tw:gap-4 tw:border-b tw:border-border tw:pb-5" aria-labelledby="neon-create-title">
              <div className="tw:grid tw:gap-1">
                <strong id="neon-create-title" className="tw:text-xs tw:text-foreground">{copy.createPlanTitle}</strong>
                <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                  {copy.createPlanDescription}
                </small>
              </div>
              <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:max-[560px]:grid-cols-1">
                <ControlField label={copy.sourceBranch}>
                  <ControlSelect
                    value={sourceBranchId}
                    onChange={(event) => setSourceBranchId(event.target.value)}
                    disabled={Boolean(mutation)}
                  >
                    {inventory?.branches.filter((branch) => branch.ready && !branch.pendingState).map((branch) => (
                      <option key={branch.id} value={branch.id}>{branch.name}</option>
                    ))}
                  </ControlSelect>
                </ControlField>
                <ControlField label={copy.newBranchName}>
                  <ControlInput
                    value={targetName}
                    maxLength={256}
                    placeholder="agent-safe-branch"
                    onChange={(event) => setTargetName(event.target.value)}
                    disabled={Boolean(mutation)}
                  />
                </ControlField>
                <ControlField label={copy.copyScope}>
                  <ControlSelect
                    value={initSource}
                    onChange={(event) => setInitSource(event.target.value as typeof initSource)}
                    disabled={Boolean(mutation)}
                  >
                    <option value="parent-data">{copy.dataAndSchema}</option>
                    <option value="schema-only">{copy.schemaOnly}</option>
                  </ControlSelect>
                </ControlField>
                <ControlField label={copy.endpoint}>
                  <ControlSelect
                    value={endpoint}
                    onChange={(event) => setEndpoint(event.target.value as typeof endpoint)}
                    disabled={Boolean(mutation)}
                  >
                    <option value="read_write">{copy.createReadWriteEndpoint}</option>
                    <option value="none">{copy.checkpointOnly}</option>
                  </ControlSelect>
                </ControlField>
                <ControlField label={copy.copyPoint}>
                  <ControlSelect
                    value={sourcePointKind}
                    onChange={(event) => {
                      setSourcePointKind(event.target.value as SourcePointKind);
                      setSourcePointValue("");
                    }}
                    disabled={Boolean(mutation)}
                  >
                    <option value="head">{copy.executionHead}</option>
                    <option value="timestamp">{copy.exactTimestamp}</option>
                    <option value="lsn">{copy.exactLsn}</option>
                  </ControlSelect>
                </ControlField>
                {sourcePointKind !== "head" ? (
                  <ControlField label={sourcePointKind === "timestamp" ? copy.timestamp : "LSN"}>
                    <ControlInput
                      type={sourcePointKind === "timestamp" ? "datetime-local" : "text"}
                      placeholder={sourcePointKind === "lsn" ? "0/16B6C50" : undefined}
                      value={sourcePointValue}
                      onChange={(event) => setSourcePointValue(event.target.value)}
                      disabled={Boolean(mutation)}
                    />
                  </ControlField>
                ) : null}
                {!knownEnvironment ? (
                  <ControlField label={copy.sourceEnvironment}>
                    <ControlSelect
                      value={environment}
                      onChange={(event) => setEnvironment(event.target.value as typeof environment)}
                      disabled={Boolean(mutation)}
                    >
                      <option value="">{copy.chooseEnvironment}</option>
                      <option value="development">{common.development}</option>
                      <option value="production">{common.production}</option>
                    </ControlSelect>
                  </ControlField>
                ) : (
                  <div className="tw:grid tw:content-start tw:gap-2">
                    <span className="tw:font-mono tw:text-2xs tw:font-semibold tw:uppercase tw:text-muted-foreground">{copy.sourceEnvironment}</span>
                    <span className="tw:flex tw:h-control-field tw:items-center tw:border tw:border-border tw:bg-surface-inset tw:px-3 tw:text-xs tw:text-foreground">
                      {knownEnvironment === "production" ? common.production : common.development}
                    </span>
                  </div>
                )}
              </div>
              {effectiveEnvironment === "production" && initSource === "parent-data" ? (
                <p className="tw:m-0 tw:border tw:border-danger/40 tw:bg-danger/5 tw:px-3 tw:py-2 tw:text-2xs tw:leading-body tw:text-danger">
                  {copy.productionCopyNotice}
                </p>
              ) : null}
              <div className="tw:flex tw:justify-end">
                <ControlButton
                  tone="primary"
                  onClick={() => void planCreate()}
                  disabled={
                    Boolean(mutation)
                    || !selectedBranch
                    || !targetName.trim()
                    || !effectiveEnvironment
                    || (sourcePointKind !== "head" && !sourcePointValue)
                  }
                >
                  {mutation === "plan" ? copy.safeRun.planning : copy.createNoChangePlan}
                </ControlButton>
              </div>
            </section>
          ) : null}

          <section className="tw:grid tw:gap-3" aria-labelledby="neon-operation-title">
            <div className="tw:flex tw:items-end tw:justify-between tw:gap-3">
              <div className="tw:grid tw:gap-1">
                <strong id="neon-operation-title" className="tw:text-xs tw:text-foreground">{copy.historyTitle}</strong>
                <small className="tw:text-2xs tw:text-muted-foreground">{copy.historyDescription}</small>
              </div>
              <span className="tw:font-mono tw:text-2xs tw:text-muted-foreground">{operations.length}</span>
            </div>
            <div className="tw:grid tw:border-t tw:border-border">
              {operations.map((operation) => (
                <article key={operation.id} className="tw:grid tw:gap-3 tw:border-b tw:border-border tw:py-3">
                  <div className="tw:flex tw:items-start tw:justify-between tw:gap-3 tw:max-[560px]:grid">
                    <div className="tw:grid tw:min-w-0 tw:gap-1">
                      <strong className="tw:truncate tw:text-xs tw:text-foreground">
                        {operation.plan.kind === "neon.branch.delete"
                          ? `${operation.plan.target.name} ${copy.deleteSuffix}`
                          : operation.plan.kind === "neon.branch.switch"
                            ? `${operation.plan.source.connectionName} · ${operation.plan.source.name} → ${operation.plan.target.name}`
                          : `${operation.plan.source.name} → ${operation.plan.target.name}`}
                      </strong>
                      <small className="tw:text-2xs tw:leading-body tw:text-muted-foreground">
                        {operation.plan.kind === "neon.branch.delete"
                          ? locale === "ko"
                            ? `${copy.softDelete} · ${copy.endpoints} ${operation.plan.references.endpointIds.length}${common.countSuffix} · ${copy.connections} 0${common.countSuffix} · ${copy.leases} 0${common.countSuffix}`
                            : `${copy.softDelete} · ${operation.plan.references.endpointIds.length} ${copy.endpoints} · 0 ${copy.connections} · 0 ${copy.leases}`
                          : operation.plan.kind === "neon.branch.switch"
                            ? locale === "ko"
                              ? `${operation.plan.source.database} · ${copy.leases} ${operation.plan.impact.activeLeaseCount}${common.countSuffix} ${copy.revokeSuffix} · ${copy.newRevision}`
                              : `${operation.plan.source.database} · ${operation.plan.impact.activeLeaseCount} ${copy.leases} ${copy.revokeSuffix} · ${copy.newRevision}`
                          : <>
                            {operation.plan.target.initSource === "schema-only" ? copy.schemaOnly : copy.dataAndSchema}
                            {operation.plan.target.endpoint === "read_write" ? ` · ${copy.endpointIncluded}` : ` · ${copy.checkpoint}`}
                          </>}
                      </small>
                    </div>
                    <span
                      className="tw:shrink-0 tw:border tw:border-border tw:px-2 tw:py-1 tw:font-mono tw:text-2xs tw:text-muted-foreground tw:data-[tone=danger]:border-danger/40 tw:data-[tone=danger]:text-danger tw:data-[tone=success]:border-success/40 tw:data-[tone=success]:text-success tw:data-[tone=warning]:border-warning/40 tw:data-[tone=warning]:text-warning"
                      data-tone={operationTone(operation.state)}
                    >
                      {operationLabel(operation, locale)}
                    </span>
                  </div>
                  {operation.plan.warningCodes.length > 0 ? (
                    <ul className="tw:m-0 tw:grid tw:list-none tw:gap-1 tw:p-0 tw:text-2xs tw:text-muted-foreground">
                      {operation.plan.warningCodes.map((code) => <li key={code}>· {warningLabel(code, locale)}</li>)}
                    </ul>
                  ) : null}
                  {operation.approvalPolicy === "separate_admin"
                    && operation.requestedByCurrentActor
                    && operation.state === "awaiting_approval" ? (
                      <p className="tw:m-0 tw:border tw:border-warning/40 tw:bg-warning/10 tw:px-3 tw:py-2 tw:text-2xs tw:leading-body tw:text-warning">
                        {copy.separateApproval}
                      </p>
                    ) : null}
                  {operation.plan.kind === "neon.branch.create"
                    && operation.managedAccessState === "bootstrap_required" ? (
                    <p className="tw:m-0 tw:border tw:border-warning/40 tw:bg-warning/10 tw:px-3 tw:py-2 tw:text-2xs tw:leading-body tw:text-warning">
                      {copy.bootstrapRequired}
                    </p>
                  ) : null}
                  {operation.failureCode ? (
                    <code className="tw:text-2xs tw:text-danger">{operation.failureCode}</code>
                  ) : null}
                  {(operation.canApprove || operation.canReject || operation.canExecute) ? (
                    <div className="tw:flex tw:flex-wrap tw:justify-end tw:gap-2">
                      {operation.canReject ? (
                        <ControlButton
                          tone="danger"
                          onClick={() => void mutateOperation(operation, "reject")}
                          disabled={Boolean(mutation)}
                        >
                          {copy.reject}
                        </ControlButton>
                      ) : null}
                      {operation.canApprove ? (
                        <ControlButton
                          tone={operation.plan.kind === "neon.branch.delete" ? "danger" : "primary"}
                          onClick={() => void mutateOperation(operation, "approve")}
                          disabled={Boolean(mutation)}
                        >
                          {copy.approve}
                        </ControlButton>
                      ) : null}
                      {operation.canExecute ? (
                        <ControlButton
                          tone={operation.plan.kind === "neon.branch.delete" ? "danger" : "primary"}
                          onClick={() => void mutateOperation(operation, "execute")}
                          disabled={Boolean(mutation)}
                        >
                          {operation.plan.kind === "neon.branch.delete"
                            ? operationBusy(operation)
                              ? copy.recheckDelete
                              : copy.executeDelete
                            : operation.plan.kind === "neon.branch.switch"
                              ? operationBusy(operation)
                                ? copy.retrySwitch
                                : copy.executeSwitch
                            : operation.needsCredentialFenceRecovery
                            ? copy.recoverCredentials
                            : operationBusy(operation)
                              ? copy.recheckState
                              : copy.executeCreate}
                        </ControlButton>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
              {!loading && operations.length === 0 ? (
                <p className="tw:m-0 tw:border-b tw:border-border tw:py-6 tw:text-center tw:text-2xs tw:text-muted-foreground">
                  {copy.empty}
                </p>
              ) : null}
            </div>
          </section>
        </main>
      </div>

      {error ? (
        <p className="tw:m-0 tw:border-t tw:border-danger/40 tw:bg-danger/5 tw:px-4 tw:py-3 tw:text-2xs tw:leading-body tw:text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
