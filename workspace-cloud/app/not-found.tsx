import { Brand } from "./components/Brand";
import { LocaleSwitcher } from "./components/LocaleSwitcher";
import {
  IdentityBody,
  IdentityCard,
  IdentityEyebrow,
  IdentitySecondaryLink,
  IdentitySingleShell,
  IdentityTitle,
} from "../../src/design-system/components/WorkspaceIdentity";
import { articleSharingCopy } from "../features/articleSharing/copy";
import { localizedWorkspacePath } from "../lib/workspace-locale";
import { getWorkspaceLocale } from "../lib/workspace-locale-server";

// Shared, invitation, and public Article misses use one neutral recovery page so
// a missing resource cannot disclose whether it once existed or who could read it.
export default async function NotFound() {
  const locale = await getWorkspaceLocale();
  const copy = articleSharingCopy[locale];
  return (
    <IdentitySingleShell>
      <div className="tw:flex tw:w-full tw:items-center tw:justify-between tw:gap-4">
        <Brand destination="marketing" />
        <LocaleSwitcher />
      </div>
      <div className="tw:m-auto tw:w-[min(620px,100%)] tw:py-8">
        <IdentityCard>
          <IdentityEyebrow>{copy.unavailableEyebrow}</IdentityEyebrow>
          <IdentityTitle>{copy.unavailableTitle}</IdentityTitle>
          <IdentityBody>{copy.unavailablePublicBody}</IdentityBody>
          <IdentitySecondaryLink href={localizedWorkspacePath("/settings", locale)}>
            {copy.workspace}
          </IdentitySecondaryLink>
        </IdentityCard>
      </div>
    </IdentitySingleShell>
  );
}
