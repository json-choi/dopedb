// Canonical observation and approval surfaces for protocol-driven Agent work.
// Protocol adapters provide semantic state and actions; these primitives own
// repeated card geometry, spacing, and status treatment.
import type { ReactNode } from "react";
import claudeIcon from "../../assets/agent-icons/claude.svg";
import codexIcon from "../../assets/agent-icons/codex.png";

import { Icon } from "../../components/Icon";
import { StatusDot, type StatusTone } from "./Status";

export function AgentProviderMark({
  provider,
}: {
  provider: "claude" | "codex";
}) {
  return (
    <span
      className="tw:grid tw:size-4 tw:shrink-0 tw:place-items-center tw:text-foreground"
      aria-hidden="true"
    >
      <img
        src={provider === "claude" ? claudeIcon : codexIcon}
        alt=""
        width={16}
        height={16}
        className="tw:block tw:size-4 tw:object-contain"
        draggable={false}
      />
    </span>
  );
}

export function AgentToolCallCard({
  title,
  status,
  tone,
  children,
  details,
}: {
  title: ReactNode;
  status: ReactNode;
  tone: StatusTone;
  children?: ReactNode;
  details?: ReactNode;
}) {
  return (
    <section className="tw:grid tw:max-w-full tw:min-w-0 tw:gap-2 tw:overflow-hidden tw:rounded-md tw:border tw:border-border-subtle tw:bg-card tw:p-3">
      <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
        <StatusDot tone={tone} />
        <strong className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-sm">
          {title}
        </strong>
        <span className="tw:shrink-0 tw:whitespace-nowrap tw:text-xs tw:text-muted-foreground">
          {status}
        </span>
      </div>
      {children ? (
        <div className="tw:max-w-full tw:min-w-0 tw:overflow-hidden">
          {children}
        </div>
      ) : null}
      {details ? (
        <div className="tw:max-w-full tw:min-w-0 tw:overflow-hidden">
          {details}
        </div>
      ) : null}
    </section>
  );
}

export function AgentActivityLine({
  label,
  status,
  tone = "neutral",
}: {
  label: string;
  status?: ReactNode;
  tone?: StatusTone;
}) {
  return (
    <div className="tw:flex tw:max-w-full tw:min-w-0 tw:items-center tw:gap-2 tw:overflow-hidden tw:py-1 tw:text-xs tw:text-muted-foreground">
      <StatusDot tone={tone} />
      <span className="tw:min-w-0 tw:flex-1 tw:truncate" title={label}>
        {label}
      </span>
      {status ? (
        <span className="tw:shrink-0 tw:whitespace-nowrap">{status}</span>
      ) : null}
    </div>
  );
}

export function AgentPermissionCard({
  title,
  description,
  pending,
  status,
  actions,
}: {
  title: ReactNode;
  description: ReactNode;
  pending: boolean;
  status?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section
      data-pending={pending || undefined}
      className="tw:grid tw:max-w-full tw:min-w-0 tw:gap-3 tw:overflow-hidden tw:rounded-md tw:border tw:border-border-subtle tw:bg-card tw:p-3"
    >
      <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
        <Icon
          name={pending ? "shield" : "check"}
          className="tw:shrink-0 tw:data-[pending=true]:text-muted-foreground"
          data-pending={pending || undefined}
        />
        <strong className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-sm">
          {title}
        </strong>
        {status ? (
          <span className="tw:shrink-0 tw:text-xs tw:text-muted-foreground">
            {status}
          </span>
        ) : null}
      </div>
      <div className="tw:min-w-0 tw:break-words tw:text-sm tw:font-medium tw:leading-body">
        {description}
      </div>
      {actions}
    </section>
  );
}
