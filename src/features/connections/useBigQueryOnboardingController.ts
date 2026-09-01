// Owns BigQuery's local Google Cloud CLI authentication and bounded resource
// discovery. The editor receives only authentication availability and bounded
// resource identifiers.
import { useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { errDetails } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import { qk, useCatalogScope } from "../../lib/queries";
import {
  BIGQUERY_AUTH_MODE_PARAMETER,
  bigQueryAuthMode,
  isValidBigQueryProjectId,
} from "./bigQueryOnboardingModel";
import type { BigQueryAuthMode, ConnectionProfile } from "./domain";
import {
  bigQueryAuthStateQuery,
  bigQueryDatasetsQuery,
  bigQueryProjectsQuery,
} from "./queries";
import {
  authenticateBigQueryGoogleAccount,
  authenticateBigQueryServiceAccount,
  clearBigQueryServiceAccountAuth,
  installDriver,
  pickConnectionFile,
} from "./tauriAdapter";
import type { ConnectionProfileState } from "./useConnectionProfileState";

export function useBigQueryOnboardingController(
  profileState: ConnectionProfileState,
  cliAvailable: boolean,
) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const createdServiceAccountProfile = useRef<ConnectionProfile | null>(null);
  const [preparingCli, setPreparingCli] = useState(false);
  const [cliError, setCliError] = useState<unknown>(null);
  const { form } = profileState;
  const profile = form.value;
  const mode = bigQueryAuthMode(profile);
  const applicable =
    profile.engine === "bigquery" && profile.workspaceAccess === "local";
  const enabled = applicable && cliAvailable && catalogScope.ready;
  const auth = useQuery({
    ...bigQueryAuthStateQuery(profile, catalogScope.key),
    enabled,
  });
  const projects = useQuery({
    ...bigQueryProjectsQuery(profile, catalogScope.key),
    enabled: enabled && auth.data?.authenticated === true,
  });
  const projectId = profile.host.trim();
  const datasets = useQuery({
    ...bigQueryDatasetsQuery(profile, projectId, catalogScope.key),
    enabled:
      enabled &&
      auth.data?.authenticated === true &&
      isValidBigQueryProjectId(projectId),
  });

  async function refreshOnboarding() {
    await queryClient.invalidateQueries({
      queryKey: ["bigQueryOnboarding", profile.id],
    });
  }

  async function ensureCli() {
    if (cliAvailable) {
      setCliError(null);
      return;
    }
    setPreparingCli(true);
    setCliError(null);
    try {
      await installDriver("google-bq-cli");
      await queryClient.invalidateQueries({ queryKey: qk.drivers() });
    } catch (error) {
      setCliError(error);
      throw error;
    } finally {
      setPreparingCli(false);
    }
  }

  const googleAccount = useMutation({
    mutationFn: async () => {
      await ensureCli();
      return authenticateBigQueryGoogleAccount(profile);
    },
    onSuccess: refreshOnboarding,
  });
  const serviceAccount = useMutation({
    mutationFn: async () => {
      await ensureCli();
      const credentialFile = await pickConnectionFile();
      return credentialFile
        ? authenticateBigQueryServiceAccount(profile, credentialFile)
        : null;
    },
    onSuccess: async (result) => {
      if (result) {
        createdServiceAccountProfile.current = profile;
        await refreshOnboarding();
      }
    },
  });

  function setMode(nextMode: BigQueryAuthMode) {
    if (nextMode === mode) return;
    googleAccount.reset();
    serviceAccount.reset();
    form.setExtraParameter(
      BIGQUERY_AUTH_MODE_PARAMETER,
      nextMode === "serviceAccount" ? nextMode : "",
    );
  }

  function selectProject(nextProjectId: string) {
    form.setValue((current) => ({
      ...current,
      host: nextProjectId,
      database:
        current.host.trim() === nextProjectId.trim()
          ? current.database
          : "",
    }));
  }

  function localizedError(
    error: unknown,
    scope: "authentication" | "projects" | "datasets" | "runtime",
  ) {
    if (!error) return null;
    const kind = errDetails(error).kind;
    if (kind === "timeout") {
      return t("connections.bigQueryErrorTimeout");
    }
    if (kind === "network") {
      return t("connections.bigQueryErrorNetwork");
    }
    if (kind === "blocked") {
      return t(
        scope === "datasets"
          ? "connections.bigQueryDatasetsPermissionError"
          : scope === "projects"
            ? "connections.bigQueryProjectsPermissionError"
            : scope === "runtime"
              ? "connections.bigQueryRuntimeVerificationError"
              : "connections.bigQueryAuthenticationPermissionError",
      );
    }
    return t(
      scope === "datasets"
        ? "connections.bigQueryDatasetsLoadFailed"
        : scope === "projects"
          ? "connections.bigQueryProjectsLoadFailed"
          : scope === "runtime"
            ? "connections.bigQueryRuntimePreparationFailed"
            : "connections.bigQueryAuthenticationFailed",
    );
  }

  const authenticationError = cliError
    ? localizedError(cliError, "runtime")
    : localizedError(
        googleAccount.error ?? serviceAccount.error ?? auth.error,
        "authentication",
      );

  return {
    mode,
    enabled,
    auth: auth.data ?? null,
    projects: projects.data ?? [],
    datasets: datasets.data ?? [],
    projectsLoaded: projects.isSuccess,
    datasetsLoaded: datasets.isSuccess,
    preparingCli,
    pending:
      (enabled && auth.isPending) ||
      googleAccount.isPending ||
      serviceAccount.isPending,
    projectsPending: projects.isFetching,
    datasetsPending: datasets.isFetching,
    authenticationError,
    projectsError: localizedError(projects.error, "projects"),
    datasetsError: localizedError(datasets.error, "datasets"),
    setMode,
    selectProject,
    selectDataset: (datasetId: string) => form.set("database", datasetId),
    connectGoogleAccount: () => {
      if (applicable) googleAccount.mutate();
    },
    connectServiceAccount: () => {
      if (applicable) serviceAccount.mutate();
    },
    finalizeSavedProfile: async (saved: ConnectionProfile) => {
      const created = createdServiceAccountProfile.current;
      if (!created) return;
      if (
        saved.engine === "bigquery" &&
        bigQueryAuthMode(saved) === "serviceAccount"
      ) {
        createdServiceAccountProfile.current = null;
        return;
      }
      await clearBigQueryServiceAccountAuth(created);
      createdServiceAccountProfile.current = null;
    },
    discardUnpersistedAuth: async () => {
      const created = createdServiceAccountProfile.current;
      if (
        profileState.identity.persisted ||
        !created
      ) {
        return;
      }
      await clearBigQueryServiceAccountAuth(created);
      createdServiceAccountProfile.current = null;
    },
    refreshProjects: () => void projects.refetch(),
    refreshDatasets: () => void datasets.refetch(),
    refresh: () => void refreshOnboarding(),
  };
}

export type BigQueryOnboardingController = ReturnType<
  typeof useBigQueryOnboardingController
>;
