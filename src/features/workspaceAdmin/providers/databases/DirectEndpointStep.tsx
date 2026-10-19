// First step of the direct-connection flow: where the database lives. The engine,
// host, port, database and SSL mode are the only required fields; verified TLS is the
// default and the weaker mode needs an explicit warning. An SSH alias is a device-local
// `~/.ssh/config` Host. A saved connection of this user can prefill the endpoint only.
import { useQuery } from "@tanstack/react-query";
import { Field, SelectInput, TextInput } from "../../../../design-system/components/FormControls";
import { InlineNotice } from "../../../../design-system/components/Status";
import { connectionsQuery } from "../../../connections/queries";
import { DIRECT_SSL_MODES, directSslmodeUnverified } from "../../../directAccess/domain";
import { useCatalogScope } from "../../../../lib/queries";
import { useI18n } from "../../../../lib/i18n";
import type { DirectDatabaseSetup } from "./useDirectDatabaseSetup";

export default function DirectEndpointStep({ flow }: { flow: DirectDatabaseSetup }) {
  const { t } = useI18n();
  const catalogScope = useCatalogScope();
  const connections = useQuery({ ...connectionsQuery(catalogScope.key), enabled: catalogScope.ready });
  const candidates = (connections.data ?? []).filter(
    (connection) => connection.engine === "postgres" || connection.engine === "mysql",
  );
  const { endpoint, issues, busy } = flow;

  return (
    <div className="tw:grid tw:min-w-0 tw:gap-3">
      {candidates.length > 0 ? (
        <div className="tw:max-w-[480px]">
          <Field
            label={t("directAccess.add.prefillLabel")}
            hint={t("directAccess.add.prefillHint")}
          >
            {(binding) => (
              <SelectInput
                {...binding.controlProps()}
                density="compact"
                value=""
                disabled={busy}
                onChange={(event) => void flow.prefill(event.target.value)}
              >
                <option value="">{t("directAccess.add.prefillPlaceholder")}</option>
                {candidates.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {`${connection.name || t("app.unnamed")} · ${connection.host}`}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
        </div>
      ) : null}

      <div className="tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,160px)_minmax(0,1fr)_minmax(0,96px)] tw:items-start tw:gap-3 tw:@max-[640px]:grid-cols-1">
        <Field label={t("directAccess.add.engine")}>
          {(binding) => (
            <SelectInput
              {...binding.controlProps()}
              density="compact"
              value={endpoint.engine}
              disabled={busy}
              onChange={(event) =>
                flow.chooseEngine(event.target.value === "mysql" ? "mysql" : "postgres")}
            >
              <option value="postgres">{t("directAccess.add.enginePostgres")}</option>
              <option value="mysql">{t("directAccess.add.engineMysql")}</option>
            </SelectInput>
          )}
        </Field>
        <Field
          label={t("directAccess.add.host")}
          validation={endpoint.host && issues.host
            ? { tone: "danger", message: t("directAccess.add.hostInvalid") }
            : undefined}
        >
          {(binding) => (
            <TextInput
              {...binding.controlProps()}
              density="compact"
              value={endpoint.host}
              maxLength={512}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => flow.setEndpoint({ host: event.target.value })}
            />
          )}
        </Field>
        <Field
          label={t("directAccess.add.port")}
          validation={issues.port
            ? { tone: "danger", message: t("directAccess.add.portInvalid") }
            : undefined}
        >
          {(binding) => (
            <TextInput
              {...binding.controlProps()}
              density="compact"
              inputMode="numeric"
              value={endpoint.port}
              maxLength={5}
              disabled={busy}
              onChange={(event) => flow.setEndpoint({ port: event.target.value })}
            />
          )}
        </Field>
      </div>

      <div className="tw:grid tw:min-w-0 tw:grid-cols-2 tw:items-start tw:gap-3 tw:@max-[640px]:grid-cols-1">
        <Field label={t("directAccess.add.database")}>
          {(binding) => (
            <TextInput
              {...binding.controlProps()}
              density="compact"
              value={endpoint.database}
              maxLength={1024}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => flow.setEndpoint({ database: event.target.value })}
            />
          )}
        </Field>
        <Field label={t("directAccess.add.sslmode")}>
          {(binding) => (
            <SelectInput
              {...binding.controlProps()}
              density="compact"
              value={endpoint.sslmode}
              disabled={busy}
              onChange={(event) => flow.setEndpoint({ sslmode: event.target.value })}
            >
              {DIRECT_SSL_MODES[endpoint.engine].map((mode) => (
                <option key={mode} value={mode}>
                  {directSslmodeUnverified(mode)
                    ? `${mode} · ${t("directAccess.add.sslUnverifiedSuffix")}`
                    : `${mode} · ${t("directAccess.add.sslVerifiedSuffix")}`}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
      </div>

      {directSslmodeUnverified(endpoint.sslmode) ? (
        <InlineNotice tone="warning" icon="alert">
          {t("directAccess.add.sslWarning")}
        </InlineNotice>
      ) : null}

      <div className="tw:max-w-[480px]">
        <Field
          label={t("directAccess.add.sshAlias")}
          hint={t("directAccess.add.sshAliasHint")}
          validation={issues.sshAlias
            ? { tone: "danger", message: t("directAccess.add.sshAliasInvalid") }
            : undefined}
        >
          {(binding) => (
            <TextInput
              {...binding.controlProps()}
              density="compact"
              value={endpoint.sshAlias}
              maxLength={255}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => flow.setEndpoint({ sshAlias: event.target.value })}
            />
          )}
        </Field>
      </div>
    </div>
  );
}
