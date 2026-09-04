"use client";

import { useEffect } from "react";
import { IdentityPrimaryButton } from "../../../components/Identity";
import { desktopWorkspaceLoginCallbackUrl } from "../../../../lib/desktop-deep-link";

function openDesktop() {
  window.location.assign(desktopWorkspaceLoginCallbackUrl);
}

export function DeviceCompletionAction({
  label,
  hint,
}: {
  label: string;
  hint: string;
}) {
  useEffect(() => {
    openDesktop();
  }, []);

  return (
    <div>
      <IdentityPrimaryButton onClick={openDesktop}>
        {label}
        <span>→</span>
      </IdentityPrimaryButton>
      <small className="tw:mt-3 tw:block tw:text-xs tw:leading-body tw:text-muted-foreground">
        {hint}
      </small>
    </div>
  );
}
