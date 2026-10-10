// Composes the profile editor header, tabs, diagnostics, and check status from
// narrow grouped presentation models.
import type { RefObject } from "react";
import { DiagnosticSummary } from "../../design-system/components/Diagnostics";
import {
  FieldValidationMessage,
  TextInput,
} from "../../design-system/components/FormControls";
import { PanelTabs } from "../../design-system/components/PanelTabs";
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";
import { ConnectionAdvancedTab } from "./ConnectionAdvancedTab";
import { ConnectionGeneralTab } from "./ConnectionGeneralTab";
import { ConnectionOptionsTab } from "./ConnectionOptionsTab";
import { ConnectionSchemaTab } from "./ConnectionSchemaTab";
import { ConnectionSecurityTab } from "./ConnectionSecurityTab";
import {
  ConnectionTestActionBar,
  ConnectionTestFailureNotice,
} from "./ConnectionTestStatus";

export function ConnectionProfilePanel({
  nameInputRef,
  autoFocus = true,
  profile,
  sources,
  drivers,
  schema,
  problems,
  workspaceDialog,
  commands,
}: {
  nameInputRef: RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
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
            ref={nameInputRef}
            id="connection-name"
            density="compact"
            value={profile.form.name}
            disabled={!profile.flags.canEditConnection}
            aria-invalid={
              profile.validation.name?.tone === "danger" || undefined
            }
            aria-describedby={
              profile.validation.name ? "connection-name-validation" : undefined
            }
            onChange={(event) => profile.set("name", event.target.value)}
            onBlur={() => profile.touch("connection-name")}
            placeholder="prod-readonly"
            autoFocus={autoFocus}
          />
          {profile.validation.name ? (
            <FieldValidationMessage
              id="connection-name-validation"
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

      <div className="tw:min-h-0 tw:min-w-0 tw:flex-1 tw:overflow-y-auto tw:p-5 tw:[container-type:inline-size]">
        {!problems.open ? (
          <ConnectionTestFailureNotice commands={commands} />
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

      <ConnectionTestActionBar
        commands={commands}
        activeDriver={drivers.active}
        problemsOpen={problems.open}
      />
    </>
  );
}
