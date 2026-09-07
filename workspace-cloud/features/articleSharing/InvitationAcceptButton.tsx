"use client";
import { useState } from "react";
import { IdentityError, IdentityPrimaryButton } from "../../app/components/Identity";
import { useWorkspaceLocale } from "../../app/components/WorkspaceLocale";
import { localizedWorkspacePath } from "../../lib/workspace-locale";
import { articleSharingCopy } from "./copy";

export function InvitationAcceptButton({ id, destination }: { id: string; destination: string }) {
  const locale = useWorkspaceLocale();
  const copy = articleSharingCopy[locale];
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function accept() {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/v1/article-invitations/${id}`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("acceptance_failed");
      window.location.assign(localizedWorkspacePath(destination, locale));
    } catch {
      setFailed(true);
      setPending(false);
    }
  }
  return <>
    <IdentityPrimaryButton disabled={pending} onClick={() => void accept()}>{pending ? copy.accepting : copy.accept}</IdentityPrimaryButton>
    {failed ? <IdentityError>{copy.failed}</IdentityError> : null}
  </>;
}
