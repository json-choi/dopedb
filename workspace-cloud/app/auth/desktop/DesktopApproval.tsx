// Explicit approval/denial completes the validated local Desktop handoff.
"use client";

import { useState } from "react";
import { IdentityError, IdentityPrimaryButton, IdentitySecondaryButton } from "../../components/Identity";
import { useWorkspaceLocale } from "../../components/WorkspaceLocale";
import { workspaceMessages } from "../../../lib/workspace-messages";
import type { DesktopAuthorization } from "../../../lib/desktop-authorization";

export function DesktopApproval({ request, nonce }: { request: DesktopAuthorization; nonce: string }) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].desktopLogin;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function decide(decision: "approve" | "deny") {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/desktop/authorize", {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request, nonce, decision }),
      });
      const value: unknown = await response.json();
      if (!response.ok || !value || typeof value !== "object" || !("redirect_uri" in value)
        || typeof value.redirect_uri !== "string") throw new Error("Authorization failed");
      const target = new URL(value.redirect_uri);
      if (`${target.origin}${target.pathname}` !== request.redirect_uri || target.searchParams.get("state") !== request.state) {
        throw new Error("Invalid callback");
      }
      window.location.assign(target.href);
    } catch {
      setPending(false);
      setError(copy.approveError);
    }
  }

  return <>
    <IdentityPrimaryButton disabled={pending} onClick={() => void decide("approve")}>
      {pending ? copy.approving : copy.approve}
    </IdentityPrimaryButton>
    <IdentitySecondaryButton disabled={pending} onClick={() => void decide("deny")}>{copy.deny}</IdentitySecondaryButton>
    {error ? <IdentityError>{error}</IdentityError> : null}
  </>;
}
