"use client";

import { Brand } from "./components/Brand";
import { LocaleSwitcher } from "./components/LocaleSwitcher";
import {
  IdentityBody,
  IdentityCard,
  IdentityEyebrow,
  IdentityPrimaryButton,
  IdentitySingleShell,
  IdentityTitle,
} from "./components/Identity";
import { articleSharingCopy } from "../features/articleSharing/copy";
import { useWorkspaceLocale } from "./components/WorkspaceLocale";

// Runtime failures deliberately share the same non-identifying language as a
// revoked publication while still providing an explicit retry command.
export default function ErrorBoundary({ reset }: { reset: () => void }) {
  const locale = useWorkspaceLocale();
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
          <IdentityTitle>{copy.unexpectedTitle}</IdentityTitle>
          <IdentityBody>{copy.unexpectedBody}</IdentityBody>
          <IdentityPrimaryButton onClick={reset}>{copy.retry}</IdentityPrimaryButton>
        </IdentityCard>
      </div>
    </IdentitySingleShell>
  );
}
