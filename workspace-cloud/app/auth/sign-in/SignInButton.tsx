"use client";

// Shared Google sign-in command; Desktop starts once automatically and retains manual retry.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  IdentityError,
  IdentityPrimaryButton,
} from "../../components/Identity";
import { authClient } from "../../../lib/auth-client";
import { localizedWorkspacePath } from "../../../lib/workspace-locale";
import { workspaceMessages } from "../../../lib/workspace-messages";
import { localizedProviderMessage } from "../../../lib/workspace-provider-copy";
import { useWorkspaceLocale } from "../../components/WorkspaceLocale";

export function SignInButton({ returnTo, autoStart = false }: { returnTo: string; autoStart?: boolean }) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].signIn;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const started = useRef(false);
  const inFlight = useRef(false);

  const signIn = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: returnTo,
        errorCallbackURL: localizedWorkspacePath(
          `/auth/sign-in?error=oauth_failed&returnTo=${encodeURIComponent(returnTo)}`,
          locale,
        ),
      });
      if (result.error) {
        inFlight.current = false;
        setPending(false);
        setError(result.error.message
          ? localizedProviderMessage(result.error.message, locale, copy.errors.start)
          : copy.errors.start);
      }
    } catch {
      inFlight.current = false;
      setPending(false);
      setError(copy.errors.start);
    }
  }, [returnTo, locale, copy.errors.start]);

  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    void signIn();
  }, [autoStart, signIn]);

  return (
    <>
      <IdentityPrimaryButton onClick={signIn} disabled={pending}>
        <span className="tw:grid tw:size-6 tw:place-items-center tw:rounded-full tw:bg-[var(--ds-white)] tw:font-[Arial] tw:text-[13px] tw:font-bold tw:text-[var(--ds-google-blue)]">
          G
        </span>
        <span>{pending ? copy.continuing : copy.continue}</span>
        <span aria-hidden="true">↗</span>
      </IdentityPrimaryButton>
      {error ? <IdentityError>{error}</IdentityError> : null}
    </>
  );
}
