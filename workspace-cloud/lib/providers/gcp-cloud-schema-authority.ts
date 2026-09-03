// Exact Google IAM boundary for the dedicated Cloud SQL PostgreSQL schema
// principal. The read principal performs this check before a schema lease is
// issued, so the schema principal never validates its own impersonation policy.
import "server-only";

import {
  gcpWifPrincipal,
  type GcpCloudSqlCredential,
} from "./gcp-cloud-sql-core";
import { ProviderRequestError } from "./provider-types";

const IAM_ORIGIN = "https://iam.googleapis.com";

type JsonObject = Record<string, unknown>;

export async function verifyGcpSchemaServiceAccountPolicy(input: {
  credential: GcpCloudSqlCredential;
  controlAccessToken: string;
  request: (url: string, init: RequestInit) => Promise<JsonObject>;
}) {
  const { credential } = input;
  const schemaEmail = credential.schemaServiceAccountEmail;
  if (!schemaEmail || !credential.workloadIdentitySubject) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Reconnect this Cloud SQL integration to configure managed schema access",
      409,
    );
  }
  const policy = await input.request(
    `${IAM_ORIGIN}/v1/projects/${encodeURIComponent(credential.projectId)
    }/serviceAccounts/${encodeURIComponent(schemaEmail)}:getIamPolicy`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.controlAccessToken}`,
        "content-type": "application/json",
        "x-goog-user-project": credential.projectId,
      },
      body: JSON.stringify({ options: { requestedPolicyVersion: 3 } }),
    },
  );
  const bindings = Array.isArray(policy.bindings) ? policy.bindings : [];
  const normalized = bindings.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const binding = value as JsonObject;
    if (
      typeof binding.role !== "string"
      || !Array.isArray(binding.members)
      || binding.members.some((member) => typeof member !== "string")
      || binding.condition !== undefined
    ) return [];
    return [{ role: binding.role, members: [...binding.members].sort() as string[] }];
  }).sort((left, right) => left.role.localeCompare(right.role));
  const expected = [
    {
      role: "roles/iam.serviceAccountViewer",
      members: [`serviceAccount:${credential.readServiceAccountEmail}`],
    },
    {
      role: "roles/iam.workloadIdentityUser",
      members: [gcpWifPrincipal(credential)],
    },
  ];
  if (
    bindings.length !== normalized.length
    || normalized.length !== expected.length
    || normalized.some((binding, index) => (
      binding.role !== expected[index]?.role
      || binding.members.length !== 1
      || binding.members[0] !== expected[index]?.members[0]
    ))
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Cloud SQL schema service-account trust policy has drifted",
      409,
    );
  }
}
