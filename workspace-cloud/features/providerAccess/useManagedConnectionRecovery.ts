"use client";

// Starts a target-pinned GCP OAuth repair from either the database row or the
// connected-account row. Only non-secret identifiers survive the round trip.
import { useCallback } from "react";

import type { ManagedConnection, Provider } from "./domain";
import { connectProviderIntegration } from "./integrationMutations";
import { saveManagedConnectionRecoveryIntent } from "./managedConnectionRecovery";
import { providerResponseError } from "./transport";
import type { WorkspaceLocale } from "../../lib/workspace-locale";
import { workspaceMessages } from "../../lib/workspace-messages";

type ProviderAccessCopy = (typeof workspaceMessages)[WorkspaceLocale]["providerAccess"];

function googleAuthorizationUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "accounts.google.com"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function useManagedConnectionRecovery({
  workspaceId,
  providers,
  mutation,
  locale,
  copy,
  setMutation,
  setError,
}: {
  workspaceId: string;
  providers: Provider[];
  mutation: string;
  locale: WorkspaceLocale;
  copy: ProviderAccessCopy;
  setMutation: (value: string) => void;
  setError: (value: string) => void;
}) {
  return useCallback(async (managed: ManagedConnection) => {
    if (mutation || managed.provider !== "gcpCloudSql") return;
    const provider = providers.find((item) => item.id === managed.provider);
    if (!provider?.configured) {
      setError(copy.reconnectStartError);
      return;
    }
    setMutation(`repair:${managed.connectionId}`);
    setError("");
    try {
      const response = await connectProviderIntegration(
        workspaceId,
        provider.id,
        undefined,
      );
      if (!response?.ok) {
        setError(await providerResponseError(response, copy.connectError, locale));
        return;
      }
      const body = await response.json().catch(() => null);
      const authorizationUrl = googleAuthorizationUrl(body?.authorizationUrl);
      if (!authorizationUrl) {
        setError(copy.authorizationUrlError);
        return;
      }
      try {
        saveManagedConnectionRecoveryIntent(window.sessionStorage, {
          workspaceId,
          connectionId: managed.connectionId,
          integrationId: managed.integrationId,
          provider: "gcpCloudSql",
        });
      } catch {
        setError(copy.reconnectStartError);
        return;
      }
      window.location.assign(authorizationUrl);
    } finally {
      setMutation("");
    }
  }, [
    copy,
    locale,
    mutation,
    providers,
    setError,
    setMutation,
    workspaceId,
  ]);
}
