// Settings → Application → Account for the signed-in account. Identity comes from the
// native auth snapshot; sessions and owned workspaces awaiting deletion are read from
// the control plane per account. Switching, adding and signing out of accounts stay in
// the title-bar account menu.
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "../../../lib/i18n";
import { workspaceAuthStateQuery } from "../../workspaces/queries";
import AccountSessions from "./AccountSessions";
import DeletionPendingWorkspaces from "./DeletionPendingWorkspaces";

export default function AccountPanel() {
  const { t } = useI18n();
  const auth = useQuery(workspaceAuthStateQuery());
  const user = auth.data?.user;
  if (!user) return null;

  return (
    <div className="tw:grid tw:w-full tw:max-w-[800px] tw:gap-6 tw:p-4 tw:@max-[700px]:p-0">
      <header className="tw:grid tw:min-w-0 tw:gap-0.5">
        <p className="tw:m-0 tw:truncate tw:text-ui tw:font-semibold tw:text-foreground">
          {user.displayName || user.email}
        </p>
        {user.displayName ? (
          <p className="tw:m-0 tw:truncate tw:text-sm tw:text-muted-foreground">
            {user.email}
          </p>
        ) : null}
        <p className="tw:mt-2 tw:mb-0 tw:text-ui tw:leading-body tw:text-muted-foreground">
          {t("workspaceAccount.description")}
        </p>
      </header>
      <AccountSessions key={`sessions:${user.id}`} accountId={user.id} />
      <DeletionPendingWorkspaces key={`deletion:${user.id}`} accountId={user.id} />
    </div>
  );
}
