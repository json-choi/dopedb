// Builds scoped connection and BigQuery discovery query keys and read options.

import { queryOptions } from "@tanstack/react-query";

import { isTransientDbError } from "../../lib/queries";
import type { ConnectionProfile } from "./domain";
import { bigQueryAuthMode } from "./bigQueryOnboardingModel";
import {
  discoverBigQueryDatasets,
  discoverBigQueryProjects,
  discoverCloudflareD1Accounts,
  discoverCloudflareD1Databases,
  getCloudflareD1AuthState,
  getBigQueryAuthState,
  listConnections,
} from "./tauriAdapter";

export const connectionQueryKeys = {
  all: (scopeKey: string) => ["connections", scopeKey] as const,
  bigQueryAuth: (profile: ConnectionProfile, scopeKey: string) =>
    [
      "bigQueryOnboarding",
      profile.id,
      scopeKey,
      bigQueryAuthMode(profile),
      "auth",
    ] as const,
  bigQueryProjects: (profile: ConnectionProfile, scopeKey: string) =>
    [
      "bigQueryOnboarding",
      profile.id,
      scopeKey,
      bigQueryAuthMode(profile),
      "projects",
    ] as const,
  bigQueryDatasets: (
    profile: ConnectionProfile,
    projectId: string,
    scopeKey: string,
  ) =>
    [
      "bigQueryOnboarding",
      profile.id,
      scopeKey,
      bigQueryAuthMode(profile),
      "datasets",
      projectId,
    ] as const,
  cloudflareD1Auth: (profile: ConnectionProfile, scopeKey: string) =>
    ["cloudflareD1Onboarding", profile.id, scopeKey, "auth"] as const,
  cloudflareD1Accounts: (profile: ConnectionProfile, scopeKey: string) =>
    ["cloudflareD1Onboarding", profile.id, scopeKey, "accounts"] as const,
  cloudflareD1Databases: (
    profile: ConnectionProfile,
    accountId: string,
    scopeKey: string,
  ) =>
    [
      "cloudflareD1Onboarding",
      profile.id,
      scopeKey,
      "databases",
      accountId,
    ] as const,
};

export function connectionsQuery(scopeKey: string) {
  return queryOptions({
    queryKey: connectionQueryKeys.all(scopeKey),
    queryFn: listConnections,
    retry: (failureCount, error) =>
      failureCount < 3 && isTransientDbError(error),
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
  });
}

export function bigQueryAuthStateQuery(
  profile: ConnectionProfile,
  scopeKey: string,
) {
  return queryOptions({
    queryKey: connectionQueryKeys.bigQueryAuth(profile, scopeKey),
    queryFn: () => getBigQueryAuthState(profile),
    staleTime: 10_000,
    retry: false,
  });
}

export function bigQueryProjectsQuery(
  profile: ConnectionProfile,
  scopeKey: string,
) {
  return queryOptions({
    queryKey: connectionQueryKeys.bigQueryProjects(profile, scopeKey),
    queryFn: () => discoverBigQueryProjects(profile),
    staleTime: 30_000,
    retry: false,
  });
}

export function bigQueryDatasetsQuery(
  profile: ConnectionProfile,
  projectId: string,
  scopeKey: string,
) {
  return queryOptions({
    queryKey: connectionQueryKeys.bigQueryDatasets(
      profile,
      projectId,
      scopeKey,
    ),
    queryFn: () => discoverBigQueryDatasets(profile, projectId),
    staleTime: 30_000,
    retry: false,
  });
}

export function cloudflareD1AuthStateQuery(
  profile: ConnectionProfile,
  scopeKey: string,
) {
  return queryOptions({
    queryKey: connectionQueryKeys.cloudflareD1Auth(profile, scopeKey),
    queryFn: () => getCloudflareD1AuthState(profile),
    staleTime: 10_000,
    retry: false,
  });
}

export function cloudflareD1AccountsQuery(
  profile: ConnectionProfile,
  scopeKey: string,
) {
  return queryOptions({
    queryKey: connectionQueryKeys.cloudflareD1Accounts(profile, scopeKey),
    queryFn: () => discoverCloudflareD1Accounts(profile),
    staleTime: 30_000,
    retry: false,
  });
}

export function cloudflareD1DatabasesQuery(
  profile: ConnectionProfile,
  accountId: string,
  scopeKey: string,
) {
  return queryOptions({
    queryKey: connectionQueryKeys.cloudflareD1Databases(
      profile,
      accountId,
      scopeKey,
    ),
    queryFn: () => discoverCloudflareD1Databases(profile, accountId),
    staleTime: 30_000,
    retry: false,
  });
}
