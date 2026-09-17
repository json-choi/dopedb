// Owns Cloudflare D1 browser OAuth and bounded account/database discovery through
// the official Wrangler CLI. The editor never receives or stores an OAuth token.
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { errDetails } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import { useCatalogScope } from "../../lib/queries";
import {
  cloudflareD1AccountsQuery,
  cloudflareD1AuthStateQuery,
  cloudflareD1DatabasesQuery,
} from "./queries";
import {
  authenticateCloudflareD1Account,
  clearCloudflareD1Auth,
} from "./tauriAdapter";
import type { ConnectionProfile } from "./domain";
import type { ConnectionProfileState } from "./useConnectionProfileState";

export function useCloudflareD1OnboardingController(
  profileState: ConnectionProfileState,
  cliAvailable: boolean,
) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const createdAuthProfile = useRef<ConnectionProfile | null>(null);
  const { form } = profileState;
  const profile = form.value;
  const applicable =
    profile.engine === "sqlite" &&
    profile.provider === "cloudflareD1" &&
    profile.workspaceAccess === "local";
  const enabled = applicable && cliAvailable && catalogScope.ready;
  const auth = useQuery({
    ...cloudflareD1AuthStateQuery(profile, catalogScope.key),
    enabled,
  });
  const accounts = useQuery({
    ...cloudflareD1AccountsQuery(profile, catalogScope.key),
    enabled: enabled && auth.data?.authenticated === true,
  });
  const accountId = profile.host.trim();
  const databases = useQuery({
    ...cloudflareD1DatabasesQuery(profile, accountId, catalogScope.key),
    enabled:
      enabled &&
      auth.data?.authenticated === true &&
      /^[a-f0-9]{32}$/iu.test(accountId),
  });

  useEffect(() => {
    if (
      applicable &&
      !profile.host.trim() &&
      accounts.data?.length === 1
    ) {
      form.set("host", accounts.data[0].id);
    }
  }, [accounts.data, applicable, form, profile.host]);

  useEffect(() => {
    const database = databases.data?.length === 1 ? databases.data[0] : null;
    if (applicable && profile.host.trim() && !profile.database.trim() && database) {
      form.setValue((current) => ({
        ...current,
        database: database.id,
        name: current.name.trim() ? current.name : database.name,
      }));
    }
  }, [applicable, databases.data, form, profile.database, profile.host]);

  async function refreshOnboarding() {
    await queryClient.invalidateQueries({
      queryKey: ["cloudflareD1Onboarding", profile.id],
    });
  }

  const connect = useMutation({
    mutationFn: () => authenticateCloudflareD1Account(profile),
    onSuccess: async () => {
      createdAuthProfile.current = profile;
      await refreshOnboarding();
    },
  });

  function selectAccount(nextAccountId: string) {
    form.setValue((current) => ({
      ...current,
      host: nextAccountId,
      database:
        current.host.trim() === nextAccountId.trim() ? current.database : "",
    }));
  }

  function selectDatabase(databaseId: string) {
    const selected = databases.data?.find((database) => database.id === databaseId);
    form.setValue((current) => ({
      ...current,
      database: databaseId,
      name: current.name.trim() ? current.name : (selected?.name ?? current.name),
    }));
  }

  function localizedError(error: unknown, resource: "auth" | "accounts" | "databases") {
    if (!error) return null;
    const kind = errDetails(error).kind;
    if (kind === "timeout") return t("connections.cloudflareD1ErrorTimeout");
    if (kind === "network") return t("connections.cloudflareD1ErrorNetwork");
    if (kind === "blocked") return t("connections.cloudflareD1PermissionError");
    return t(
      resource === "accounts"
        ? "connections.cloudflareD1AccountsLoadFailed"
        : resource === "databases"
          ? "connections.cloudflareD1DatabasesLoadFailed"
          : "connections.cloudflareD1AuthenticationFailed",
    );
  }

  return {
    cliAvailable,
    enabled,
    auth: auth.data ?? null,
    accounts: accounts.data ?? [],
    databases: databases.data ?? [],
    accountsLoaded: accounts.isSuccess,
    databasesLoaded: databases.isSuccess,
    checking: enabled && auth.isPending,
    authenticating: connect.isPending,
    pending: (enabled && auth.isPending) || connect.isPending,
    accountsPending: accounts.isFetching,
    databasesPending: databases.isFetching,
    authenticationError: localizedError(connect.error ?? auth.error, "auth"),
    accountsError: localizedError(accounts.error, "accounts"),
    databasesError: localizedError(databases.error, "databases"),
    connect: () => {
      if (applicable && cliAvailable) connect.mutate();
    },
    selectAccount,
    selectDatabase,
    refreshAccounts: () => void accounts.refetch(),
    refreshDatabases: () => void databases.refetch(),
    finalizeSavedProfile: async (saved: ConnectionProfile) => {
      const created = createdAuthProfile.current;
      if (!created) return;
      if (saved.engine === "sqlite" && saved.provider === "cloudflareD1") {
        createdAuthProfile.current = null;
        return;
      }
      await clearCloudflareD1Auth(created);
      createdAuthProfile.current = null;
    },
    discardUnpersistedAuth: async () => {
      const created = createdAuthProfile.current;
      if (profileState.identity.persisted || !created) return;
      await clearCloudflareD1Auth(created);
      createdAuthProfile.current = null;
    },
  };
}

export type CloudflareD1OnboardingController = ReturnType<
  typeof useCloudflareD1OnboardingController
>;
