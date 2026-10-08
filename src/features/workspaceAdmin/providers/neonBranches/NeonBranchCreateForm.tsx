// Create-safe-branch plan form. Submitting only records a no-change plan; approval and
// the provider change happen later from the operation history. The draft, source
// branch and environment choice belong to the controller.
import { Button } from "../../../../design-system/components/Button";
import { Field, SelectInput, TextInput } from "../../../../design-system/components/FormControls";
import { InlineNotice, StatusDot } from "../../../../design-system/components/Status";
import { useI18n } from "../../../../lib/i18n";
import type { NeonEnvironment } from "./domain";
import { neonEnvironmentKey, neonEnvironmentTone, type NeonSourcePointKind } from "./model";
import type { NeonBranchController, NeonCreateDraft } from "./useNeonBranchManager";

export default function NeonBranchCreateForm({
  id,
  controller,
}: {
  id: string;
  controller: NeonBranchController;
}) {
  const { t } = useI18n();
  const {
    busy,
    draft,
    selectedBranch,
    sourceBranches,
    knownEnvironment,
    effectiveEnvironment,
    nameError,
    pointError,
  } = controller;
  if (!controller.showCreate) return null;
  const error = controller.errorFor("create");
  const titleId = `${id}-title`;

  return (
    <section
      id={id}
      data-primary-flow
      aria-labelledby={titleId}
      className="tw:grid tw:min-w-0 tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-3"
    >
      <div className="tw:grid tw:min-w-0 tw:gap-1">
        <h4 id={titleId} className="tw:m-0 tw:text-ui tw:font-semibold tw:text-foreground">
          {t("workspaceNeonBranches.createPlanTitle")}
        </h4>
        <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
          {t("workspaceNeonBranches.createPlanDescription")}
        </p>
      </div>
      <form
        className="tw:grid tw:min-w-0 tw:gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          controller.planCreate();
        }}
      >
        <div className="tw:grid tw:grid-cols-[repeat(auto-fit,minmax(200px,1fr))] tw:gap-3">
          <Field label={t("workspaceNeonBranches.sourceBranch")}>
            <SelectInput
              density="compact"
              value={selectedBranch?.id ?? ""}
              disabled={busy}
              onChange={(event) => controller.selectBranch(event.target.value)}
            >
              {sourceBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </SelectInput>
          </Field>
          <Field
            label={t("workspaceNeonBranches.newBranchName")}
            validation={nameError ? { tone: "danger", message: t(nameError) } : undefined}
          >
            {(binding) => (
              <TextInput
                {...binding.controlProps()}
                density="compact"
                value={draft.targetName}
                maxLength={256}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("workspaceNeonBranches.namePlaceholder")}
                disabled={busy}
                onChange={(event) => controller.updateDraft({ targetName: event.target.value })}
              />
            )}
          </Field>
          <Field label={t("workspaceNeonBranches.copyScope")}>
            <SelectInput
              density="compact"
              value={draft.initSource}
              disabled={busy}
              onChange={(event) => controller.updateDraft({
                initSource: event.target.value as NeonCreateDraft["initSource"],
              })}
            >
              <option value="parent-data">{t("workspaceNeonBranches.dataAndSchema")}</option>
              <option value="schema-only">{t("workspaceNeonBranches.schemaOnly")}</option>
            </SelectInput>
          </Field>
          <Field label={t("workspaceNeonBranches.endpoint")}>
            <SelectInput
              density="compact"
              value={draft.endpoint}
              disabled={busy}
              onChange={(event) => controller.updateDraft({
                endpoint: event.target.value as NeonCreateDraft["endpoint"],
              })}
            >
              <option value="read_write">{t("workspaceNeonBranches.createReadWriteEndpoint")}</option>
              <option value="none">{t("workspaceNeonBranches.checkpointOnly")}</option>
            </SelectInput>
          </Field>
          <Field label={t("workspaceNeonBranches.copyPoint")}>
            <SelectInput
              density="compact"
              value={draft.pointKind}
              disabled={busy}
              onChange={(event) => controller.updateDraft({
                pointKind: event.target.value as NeonSourcePointKind,
                pointValue: "",
              })}
            >
              <option value="head">{t("workspaceNeonBranches.executionHead")}</option>
              <option value="timestamp">{t("workspaceNeonBranches.exactTimestamp")}</option>
              <option value="lsn">{t("workspaceNeonBranches.exactLsn")}</option>
            </SelectInput>
          </Field>
          {draft.pointKind !== "head" ? (
            <Field
              label={t(draft.pointKind === "timestamp"
                ? "workspaceNeonBranches.timestamp"
                : "workspaceNeonBranches.lsn")}
              validation={pointError ? { tone: "danger", message: t(pointError) } : undefined}
            >
              {(binding) => (
                <TextInput
                  {...binding.controlProps()}
                  density="compact"
                  type={draft.pointKind === "timestamp" ? "datetime-local" : "text"}
                  step={draft.pointKind === "timestamp" ? 1 : undefined}
                  monospace={draft.pointKind === "lsn"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={draft.pointKind === "lsn"
                    ? t("workspaceNeonBranches.lsnPlaceholder")
                    : undefined}
                  value={draft.pointValue}
                  disabled={busy}
                  onChange={(event) => controller.updateDraft({ pointValue: event.target.value })}
                />
              )}
            </Field>
          ) : null}
          {knownEnvironment ? (
            <div className="tw:grid tw:min-w-0 tw:content-start tw:gap-1.5 tw:text-sm tw:font-medium tw:text-muted-foreground">
              <span>{t("workspaceNeonBranches.sourceEnvironment")}</span>
              <span className="tw:inline-flex tw:min-h-control-md tw:items-center tw:gap-2 tw:text-ui tw:font-normal tw:text-foreground">
                <StatusDot tone={neonEnvironmentTone[knownEnvironment]} />
                {t(neonEnvironmentKey[knownEnvironment])}
              </span>
            </div>
          ) : (
            <Field label={t("workspaceNeonBranches.sourceEnvironment")}>
              <SelectInput
                density="compact"
                value={controller.createEnvironmentChoice}
                disabled={busy || !selectedBranch}
                onChange={(event) => controller.chooseCreateEnvironment(
                  event.target.value as NeonEnvironment | "",
                )}
              >
                <option value="">{t("workspaceNeonBranches.chooseEnvironment")}</option>
                <option value="development">{t("workspaceNeonBranches.environmentDevelopment")}</option>
                <option value="production">{t("workspaceNeonBranches.environmentProduction")}</option>
              </SelectInput>
            </Field>
          )}
        </div>
        {effectiveEnvironment === "production" && draft.initSource === "parent-data" ? (
          <InlineNotice tone="danger" icon="alert">
            {t("workspaceNeonBranches.productionCopyNotice")}
          </InlineNotice>
        ) : null}
        {error ? <InlineNotice tone="danger" icon="alert" role="alert">{error}</InlineNotice> : null}
        <div className="ds-control-row tw:flex tw:justify-end tw:gap-[var(--ds-control-gap)]">
          <Button type="submit" size="compact" variant="primary" disabled={!controller.canPlanCreate}>
            {t(controller.pending?.kind === "createPlan"
              ? "workspaceNeonBranches.planning"
              : "workspaceNeonBranches.createNoChangePlan")}
          </Button>
        </div>
      </form>
    </section>
  );
}
