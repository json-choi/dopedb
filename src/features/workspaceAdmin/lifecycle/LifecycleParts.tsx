// Presentation pieces repeated across the Backups & deletion section: the flat section
// frame with its heading action, a label/value fact list, and the inline failure notice
// that offers a retry or, when a command's outcome is unknown, a refresh first.
import { Fragment, type ReactNode } from "react";
import { Button } from "../../../design-system/components/Button";
import { SettingsSectionHeader } from "../../../design-system/components/SettingsList";
import { InlineNotice } from "../../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../../lib/i18n";
import { isWorkspaceSessionRejected } from "../requests";
import { lifecycleOutcomeUnknown } from "./domain";
import { describeLifecycleFailure } from "./messages";

export function LifecycleSection({
  title,
  description,
  trailing,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="tw:grid tw:min-w-0 tw:content-start tw:gap-2 tw:border-t tw:border-border-subtle tw:pt-2">
      <SettingsSectionHeader title={title} trailing={trailing} />
      {description ? (
        <p className="tw:m-0 tw:max-w-[680px] tw:text-ui tw:leading-body tw:text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children}
    </section>
  );
}

export function LifecycleFacts({
  items,
}: {
  items: ReadonlyArray<{ id: string; label: ReactNode; value: ReactNode }>;
}) {
  return (
    <dl className="tw:m-0 tw:grid tw:max-w-[560px] tw:grid-cols-[minmax(0,1fr)_auto] tw:gap-x-6 tw:gap-y-1.5 tw:text-ui">
      {items.map((item) => (
        <Fragment key={item.id}>
          <dt className="tw:min-w-0 tw:text-muted-foreground">{item.label}</dt>
          <dd className="tw:m-0 tw:text-right tw:font-medium tw:tabular-nums tw:text-foreground">
            {item.value}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function FailureNotice({
  error,
  fallback,
  tone = "danger",
  retry,
  refresh,
  disabled = false,
}: {
  error: unknown;
  fallback: I18nKey;
  tone?: "danger" | "warning";
  /** Reloads a failed read or resends the same command request. */
  retry?: () => void;
  /** Offered only when the command may have run, so the user looks before retrying. */
  refresh?: () => void;
  disabled?: boolean;
}) {
  const { lang, t } = useI18n();
  const action = isWorkspaceSessionRejected(error) ? null : retry ? (
    <Button size="compact" disabled={disabled} onClick={retry}>
      {t("workspaceAdmin.retry")}
    </Button>
  ) : refresh && lifecycleOutcomeUnknown(error) ? (
    <Button size="compact" disabled={disabled} onClick={refresh}>
      {t("common.refresh")}
    </Button>
  ) : null;
  return (
    <InlineNotice
      tone={tone}
      icon="alert"
      role={tone === "danger" ? "alert" : "status"}
      action={action}
    >
      {describeLifecycleFailure(error, { lang, t }, fallback)}
    </InlineNotice>
  );
}
