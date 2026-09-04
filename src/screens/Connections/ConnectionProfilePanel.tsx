// Composes the profile editor header, tabs, diagnostics, and action status from
// narrow grouped presentation models.
import { DiagnosticSummary } from "../../design-system/components/Diagnostics";
import { Button } from "../../design-system/components/Button";
import {
  FieldValidationMessage,
  TextInput,
} from "../../design-system/components/FormControls";
import { ModalDetailActionBar } from "../../design-system/components/Modal";
import { PanelTabs } from "../../design-system/components/PanelTabs";
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";
import { ConnectionAdvancedTab } from "./ConnectionAdvancedTab";
import { ConnectionGeneralTab } from "./ConnectionGeneralTab";
import { ConnectionOptionsTab } from "./ConnectionOptionsTab";
import { ConnectionSchemaTab } from "./ConnectionSchemaTab";
import { ConnectionSecurityTab } from "./ConnectionSecurityTab";

export function ConnectionProfilePanel({
  profile,
  sources,
  drivers,
  schema,
  problems,
  workspaceDialog,
  commands,
}: {
  profile: ConnectionEditorController["profile"];
  sources: ConnectionEditorController["catalog"]["sources"];
  drivers: ConnectionEditorController["catalog"]["drivers"];
  schema: ConnectionEditorController["schema"];
  problems: ConnectionEditorController["dialogs"]["problems"];
  workspaceDialog: ConnectionEditorController["dialogs"]["workspace"];
  commands: ConnectionEditorController["commands"];
}) {
  const { t } = useI18n();

  return (
    <>
      <div className="tw:grid tw:shrink-0 tw:grid-cols-[75px_minmax(0,1fr)] tw:items-center tw:gap-3 tw:border-b tw:border-border-subtle tw:bg-card tw:px-4 tw:py-3">
        <label
          htmlFor="connection-name"
          className="tw:text-sm tw:text-foreground"
        >
          {t("connections.name")}
        </label>
        <span className="tw:grid tw:min-w-0 tw:max-w-[360px] tw:gap-1">
          <TextInput
            id="connection-name"
            density="compact"
            value={profile.form.name}
            disabled={!profile.flags.canEditConnection}
            aria-invalid={
              profile.validation.name?.tone === "danger" || undefined
            }
            onChange={(event) => profile.set("name", event.target.value)}
            placeholder="prod-readonly"
            autoFocus
          />
          {profile.validation.name ? (
            <FieldValidationMessage
              validation={profile.validation.name}
            />
          ) : null}
        </span>
      </div>

      {!problems.open ? (
        <PanelTabs
          tabs={profile.tabs.items}
          active={profile.tabs.active}
          onChange={profile.tabs.setActive}
          label={t("connections.tabList")}
        />
      ) : null}

      <div className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:p-5">
        {!problems.open && commands.testFailure ? (
          <section
            className="tw:mx-auto tw:mb-4 tw:grid tw:w-full tw:max-w-[840px] tw:gap-1.5 tw:rounded-sm tw:border tw:border-danger/40 tw:bg-danger-muted tw:p-3"
            role="alert"
          >
            <strong className="tw:text-sm tw:font-semibold tw:text-danger">
              {commands.testFailureTitle(commands.testFailure.code)}
            </strong>
            <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-foreground">
              {commands.testFailureRecovery(commands.testFailure.code)}
            </p>
            {commands.managedConnection.canOpenSettings ? (
              <div className="tw:mt-1">
                <Button
                  size="compact"
                  tone="primary"
                  disabled={commands.managedConnection.openingSettings}
                  onClick={() => void commands.managedConnection.openSettings()}
                >
                  {commands.managedConnection.openingSettings
                    ? t("connections.managedWorkspace.opening")
                    : t("connections.managedWorkspace.open")}
                </Button>
              </div>
            ) : null}
            <details className="tw:min-w-0 tw:text-xs">
              <summary className="tw:cursor-pointer tw:text-muted-foreground">
                {t("connections.testFailure.technicalDetails")}
              </summary>
              <pre className="tw:mt-2 tw:mb-0 tw:max-h-40 tw:overflow-auto tw:whitespace-pre-wrap tw:[overflow-wrap:anywhere] tw:font-mono tw:text-xs tw:text-foreground">
                {commands.testFailure.detail}
              </pre>
            </details>
          </section>
        ) : null}
        {problems.open ? (
          <DiagnosticSummary
            title={t("connections.problems")}
            items={problems.items}
            emptyMessage={t("connections.problemsEmpty")}
            onSelect={problems.openDiagnostic}
          />
        ) : null}
        {!problems.open && profile.tabs.active === "general" ? (
          <ConnectionGeneralTab
            profile={profile}
            sources={sources}
            drivers={drivers}
            workspaceDialog={workspaceDialog}
            managedConnection={commands.managedConnection}
            busy={commands.busy}
          />
        ) : null}
        {!problems.open && profile.tabs.active === "options" ? (
          <ConnectionOptionsTab profile={profile} />
        ) : null}
        {!problems.open && profile.tabs.active === "sshSsl" ? (
          <ConnectionSecurityTab profile={profile} />
        ) : null}
        {!problems.open && profile.tabs.active === "schemas" ? (
          <ConnectionSchemaTab profile={profile} schema={schema} />
        ) : null}
        {!problems.open && profile.tabs.active === "advanced" ? (
          <ConnectionAdvancedTab
            profile={profile}
            activeDriver={drivers.active}
          />
        ) : null}
      </div>

      <ModalDetailActionBar>
        <button
          type="button"
          className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:font-sans tw:text-sm tw:font-medium tw:text-info tw:disabled:cursor-default tw:disabled:text-muted-foreground"
          disabled={commands.busy || problems.hasTestBlocking}
          onClick={() => void commands.test()}
        >
          {commands.running === "test"
            ? t("connections.testing")
            : t("connections.test")}
        </button>
        {commands.message ? (
          <span
            data-error={commands.messageIsError || undefined}
            className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-sm tw:text-muted-foreground tw:data-[error=true]:text-danger"
            role={commands.messageIsError ? "alert" : "status"}
            title={commands.message}
          >
            {commands.message}
          </span>
        ) : drivers.active ? (
          <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-sm tw:text-muted-foreground">
            {drivers.active.name} {drivers.active.version}
          </span>
        ) : null}
      </ModalDetailActionBar>
    </>
  );
}
