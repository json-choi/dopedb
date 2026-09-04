import { useMemo, useState, type FormEvent } from "react";

import {
  ModalBackdrop,
  ModalFooter,
  ModalHeader,
  ModalSurface,
} from "../../design-system/components/Modal";
import { Button } from "../../design-system/components/Button";
import { TextInput } from "../../design-system/components/FormControls";
import type { SqlParameter } from "../../features/query/sqlParameters";
import { uniqueSqlParameters } from "../../features/query/sqlParameters";
import { useI18n } from "../../lib/i18n";

export default function SqlParameterDialog({
  parameters,
  initialValues,
  action,
  onCancel,
  onApply,
}: {
  parameters: SqlParameter[];
  initialValues: Record<string, string>;
  action: "apply" | "explain" | "run";
  onCancel: () => void;
  onApply: (values: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const rows = useMemo(() => uniqueSqlParameters(parameters), [parameters]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rows.map((parameter) => [
        parameter.key,
        initialValues[parameter.key] ?? "",
      ]),
    ),
  );
  const complete = rows.every(
    (parameter) => values[parameter.key]?.trim(),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (complete) onApply(values);
  }

  return (
    <ModalBackdrop onMouseDown={onCancel}>
      <ModalSurface
        aria-labelledby="sql-parameters-title"
        onRequestClose={onCancel}
      >
        <form className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col" onSubmit={submit}>
          <ModalHeader
            title={t("sql.parameters")}
            titleId="sql-parameters-title"
          />

          <div className="tw:grid tw:max-h-[50dvh] tw:gap-2 tw:overflow-auto tw:p-4">
            <div className="tw:grid tw:grid-cols-[minmax(100px,0.55fr)_minmax(180px,1fr)] tw:gap-3 tw:text-xs tw:font-medium tw:text-muted-foreground">
              <span>{t("sql.parameterName")}</span>
              <span>{t("sql.parameterValue")}</span>
            </div>
            {rows.map((parameter, index) => (
              <label
                key={parameter.key}
                className="tw:grid tw:grid-cols-[minmax(100px,0.55fr)_minmax(180px,1fr)] tw:items-center tw:gap-3"
              >
                <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
                  <code className="tw:shrink-0 tw:rounded-sm tw:bg-muted tw:px-1.5 tw:py-1 tw:font-mono tw:text-xs">
                    {parameter.token}
                  </code>
                  <span className="tw:min-w-0 tw:truncate tw:text-sm">
                    {parameter.label}
                  </span>
                </span>
                <TextInput
                  density="compact"
                  autoFocus={index === 0}
                  value={values[parameter.key] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [parameter.key]: event.target.value,
                    }))
                  }
                  placeholder={t("sql.parameterValuePlaceholder")}
                  aria-label={t("sql.parameterValueFor", {
                    name: parameter.label,
                  })}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            ))}
            <p className="tw:m-0 tw:border-y tw:border-border-subtle tw:px-1 tw:py-2 tw:text-xs tw:leading-body tw:text-muted-foreground">
              {t("sql.parameterSafety")}
            </p>
          </div>

          <ModalFooter>
            <Button type="button" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!complete}>
              {t(
                action === "run"
                  ? "sql.parameterRun"
                  : action === "explain"
                    ? "sql.parameterExplain"
                    : "sql.parameterApply",
                )}
            </Button>
          </ModalFooter>
        </form>
      </ModalSurface>
    </ModalBackdrop>
  );
}
