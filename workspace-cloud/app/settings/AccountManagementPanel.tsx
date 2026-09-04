// Account identity and authenticated-device security belong to the user, not to
// any selected workspace, so this surface stays outside organization settings.
"use client";

import { ActiveSessions } from "./ActiveSessions";
import { useWorkspaceLocale } from "../components/WorkspaceLocale";
import { workspaceMessages } from "../../lib/workspace-messages";

export function AccountManagementPanel({
  currentSessionId,
  user,
}: {
  currentSessionId: string;
  user: { email: string; name: string };
}) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].account;
  return (
    <section className="tw:grid tw:overflow-hidden tw:rounded-surface tw:border tw:border-border tw:bg-surface">
      <header className="tw:grid tw:grid-cols-[auto_minmax(0,1fr)] tw:items-center tw:gap-3 tw:border-b tw:border-border tw:px-5 tw:py-4">
        <span className="tw:grid tw:size-10 tw:place-items-center tw:rounded-control tw:bg-selection tw:text-sm tw:font-semibold tw:text-primary">
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="tw:grid tw:min-w-0 tw:gap-1">
          <strong className="tw:text-sm tw:font-medium tw:text-foreground">{user.name}</strong>
          <small className="tw:overflow-hidden tw:text-xs tw:text-ellipsis tw:whitespace-nowrap tw:text-muted-foreground">
            {user.email}
          </small>
        </div>
      </header>
      <section className="tw:grid tw:p-5">
        <header className="tw:mb-3 tw:grid tw:gap-1">
          <div className="tw:grid tw:gap-1">
            <h2 className="tw:m-0 tw:text-sm tw:font-semibold tw:text-foreground">
              {copy.sessionsTitle}
            </h2>
            <small className="tw:text-xs tw:leading-body tw:text-muted-foreground">
              {copy.sessionsDescription}
            </small>
          </div>
        </header>
        <ActiveSessions currentSessionId={currentSessionId} />
      </section>
    </section>
  );
}
