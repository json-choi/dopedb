// Third step of the direct-connection flow: which namespaces members may reach, the
// write ceiling, the exact grant plan the administrator device will run for a member,
// and the name shown in the workspace. Only namespaces the administrator can grant on
// are selectable; the plan comes from the same native planner that applies it.
import {
  CheckboxField,
  Field,
  TextInput,
} from "../../../../design-system/components/FormControls";
import { InlineNotice, LoadingLabel } from "../../../../design-system/components/Status";
import { EnvironmentKindSelect } from "../../../../components/EnvironmentKindSelect";
import { useI18n } from "../../../../lib/i18n";
import type { DirectDatabaseSetup } from "./useDirectDatabaseSetup";

function PlanBlock({ title, statements }: { title: string; statements: readonly string[] }) {
  return (
    <div className="tw:grid tw:min-w-0 tw:gap-1">
      <strong className="tw:text-xs tw:font-semibold tw:text-foreground">{title}</strong>
      <ul className="tw:m-0 tw:grid tw:list-none tw:gap-0.5 tw:rounded-sm tw:border tw:border-border-subtle tw:p-2 tw:font-mono tw:text-xs tw:text-foreground">
        {statements.map((statement, index) => (
          <li key={`${index}:${statement}`} className="tw:[overflow-wrap:anywhere]">
            {statement}
          </li>
        ))}
      </ul>
    </div>
  );
}


export default function DirectScopeStep({ flow }: { flow: DirectDatabaseSetup }) {
  const { t } = useI18n();
  const { report, busy } = flow;
  const namespaces = report?.namespaces ?? [];
  const ungrantable = namespaces.filter((namespace) => !namespace.grantable);
  const noun = flow.endpoint.engine === "mysql"
    ? t("directAccess.add.scopeNounMysql")
    : t("directAccess.add.scopeNounPostgres");

  return (
    <div className="tw:grid tw:min-w-0 tw:gap-4">
      <fieldset className="tw:m-0 tw:grid tw:min-w-0 tw:gap-2 tw:border-0 tw:p-0">
        <legend className="tw:p-0 tw:text-sm tw:font-medium tw:text-foreground">{noun}</legend>
        {flow.grantable.map((namespace) => (
          <CheckboxField
            key={namespace.name}
            checked={flow.selection.includes(namespace.name)}
            disabled={busy}
            onChange={(event) => flow.toggleNamespace(namespace.name, event.target.checked)}
            label={namespace.publicCreate
              ? `${namespace.name} · ${t("directAccess.add.publicCreateSuffix")}`
              : namespace.name}
          />
        ))}
        {ungrantable.length > 0 ? (
          <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
            {t("directAccess.add.ungrantable", {
              names: ungrantable.map((namespace) => namespace.name).join(", "),
            })}
          </p>
        ) : null}
        {flow.selection.length === 0 ? (
          <InlineNotice tone="warning" icon="alert">
            {t("directAccess.add.scopeEmpty")}
          </InlineNotice>
        ) : null}
      </fieldset>

      <div className="tw:grid tw:min-w-0 tw:gap-1">
        <CheckboxField
          checked={flow.writeCeiling}
          disabled={busy}
          onChange={(event) => flow.setWriteCeiling(event.target.checked)}
          label={t("directAccess.add.writeCeiling")}
        />
        <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {t("directAccess.add.writeCeilingHint")}
        </p>
      </div>

      <div className="tw:grid tw:min-w-0 tw:gap-2">
        <h6 className="tw:m-0 tw:text-sm tw:font-semibold tw:text-foreground">
          {t("directAccess.add.planTitle")}
        </h6>
        <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {t("directAccess.add.planHint")}
        </p>
        {flow.probing ? (
          <span className="tw:text-sm">
            <LoadingLabel>{t("directAccess.add.planLoading")}</LoadingLabel>
          </span>
        ) : report && flow.selection.length > 0 ? (
          <>
            <PlanBlock title={t("directAccess.add.planRead")} statements={report.planRead} />
            {flow.writeCeiling ? (
              <PlanBlock title={t("directAccess.add.planWrite")} statements={report.planWrite} />
            ) : null}
          </>
        ) : null}
      </div>

      <div className="tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_minmax(0,160px)] tw:items-start tw:gap-3 tw:@max-[640px]:grid-cols-1">
        <Field
          label={t("directAccess.add.name")}
          validation={flow.name && !flow.nameValid
            ? { tone: "danger", message: t("workspaceProviderDatabases.nameInvalid") }
            : undefined}
        >
          {(binding) => (
            <TextInput
              {...binding.controlProps()}
              density="compact"
              value={flow.name}
              maxLength={120}
              disabled={busy}
              onChange={(event) => flow.setName(event.target.value)}
            />
          )}
        </Field>
        <EnvironmentKindSelect
          label={t("directAccess.add.environment")}
          emptyLabel={t("directAccess.add.environmentNone")}
          value={flow.environment}
          disabled={busy}
          onChange={flow.setEnvironment}
        />
      </div>
    </div>
  );
}
