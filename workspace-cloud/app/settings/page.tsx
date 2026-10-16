// Former Workspace Web console address. Workspace administration now lives in the
// DopeDB desktop app; this page keeps old links, bookmarks and post-invitation
// redirects useful by pointing there. It reads no account or workspace state.
import { Brand } from "../components/Brand";
import { LocaleSwitcher } from "../components/LocaleSwitcher";
import {
  IdentityBody,
  IdentityCard,
  IdentityEyebrow,
  IdentitySecondaryLink,
  IdentitySingleShell,
  IdentityTitle,
} from "../../../src/design-system/components/WorkspaceIdentity";
import { desktopWorkspaceAccessCallbackUrl } from "../../lib/desktop-deep-link";
import { getWorkspaceLocale } from "../../lib/workspace-locale-server";
import { workspaceMessages } from "../../lib/workspace-messages";

export default async function SettingsMovedPage() {
  const locale = await getWorkspaceLocale();
  const copy = workspaceMessages[locale].settingsMoved;
  return (
    <IdentitySingleShell>
      <div className="tw:flex tw:w-full tw:items-center tw:justify-between tw:gap-4">
        <Brand destination="marketing" />
        <LocaleSwitcher />
      </div>
      <div className="tw:m-auto tw:w-[min(540px,100%)]">
        <IdentityCard>
          <IdentityEyebrow>{copy.eyebrow}</IdentityEyebrow>
          <IdentityTitle>{copy.title}</IdentityTitle>
          <IdentityBody>{copy.body}</IdentityBody>
          <IdentitySecondaryLink href={desktopWorkspaceAccessCallbackUrl}>
            {copy.openApp}
          </IdentitySecondaryLink>
          <IdentitySecondaryLink
            href={`https://dopedb.dev${locale === "ko" ? "/ko" : ""}#download`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.download}
          </IdentitySecondaryLink>
        </IdentityCard>
      </div>
    </IdentitySingleShell>
  );
}
