import { Brand } from "../../../components/Brand";
import { LocaleSwitcher } from "../../../components/LocaleSwitcher";
import {
  IdentityBody,
  IdentityCard,
  IdentityEyebrow,
  IdentitySingleShell,
  IdentityTitle,
} from "../../../components/Identity";
import { getWorkspaceLocale } from "../../../../lib/workspace-locale-server";
import { workspaceMessages } from "../../../../lib/workspace-messages";
import { DeviceCompletionAction } from "./DeviceCompletionAction";

export default async function DeviceCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const denied = Boolean((await searchParams).denied);
  const locale = await getWorkspaceLocale();
  const copy = workspaceMessages[locale].device;
  return (
    <IdentitySingleShell>
      <div className="tw:flex tw:w-full tw:items-center tw:justify-between tw:gap-4">
        <Brand destination="marketing" />
        <LocaleSwitcher />
      </div>
      <div className="tw:m-auto tw:w-[min(540px,100%)]">
        <IdentityCard>
          <div className="tw:mb-9 tw:grid tw:size-[54px] tw:place-items-center tw:rounded-surface tw:bg-success tw:text-[23px] tw:text-[var(--ds-text-inverse)]">
            {denied ? "×" : "✓"}
          </div>
          <IdentityEyebrow>
            {denied ? copy.completeDeniedEyebrow : copy.completeAuthorizedEyebrow}
          </IdentityEyebrow>
          <IdentityTitle>
            {denied ? copy.completeDenied : copy.completeAuthorized}
          </IdentityTitle>
          <IdentityBody>
            {copy.completeBody}
          </IdentityBody>
          <DeviceCompletionAction
            label={copy.completeOpenApp}
            hint={copy.completeOpenAppHint}
          />
        </IdentityCard>
      </div>
    </IdentitySingleShell>
  );
}
