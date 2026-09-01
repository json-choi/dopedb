import "server-only";

import { createHash } from "node:crypto";
import type { GcpSetupCredential } from "./gcp-cloud-oauth";
import { ProviderRequestError } from "./provider-types";
import { verifyVercelOidcToken } from "./vercel-oidc";
import {
  IAM_ORIGIN,
  POOL_ID,
  PROVIDER_ID,
  RESOURCE_MANAGER_ORIGIN,
  checkGcpSetupPermissions,
  GcpUpstreamRequestError,
  googleRequest,
  iamServiceAccountPropagationPending,
  object,
  quotaProjectCredential,
  waitOperation,
  type GcpCloudBootstrapInput,
  type GcpSetupPermissionCheck,
  type JsonObject,
} from "./gcp-cloud-bootstrap-core";

export async function confirmProject(
  credential: GcpSetupCredential,
  projectId: string,
  projectNumber: string,
) {
  const project = (await googleRequest(
    credential,
    `${RESOURCE_MANAGER_ORIGIN}/v3/projects/${encodeURIComponent(projectId)}`,
  ))!;
  if (
    project.state !== "ACTIVE"
    || project.projectId !== projectId
    || project.name !== `projects/${projectNumber}`
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Google Cloud project identity changed during setup",
      409,
    );
  }
}

export async function ensurePool(
  credential: GcpSetupCredential,
  projectNumber: string,
) {
  const parent = `projects/${projectNumber}/locations/global`;
  const name = `${parent}/workloadIdentityPools/${POOL_ID}`;
  let pool = await googleRequest(
    credential,
    `${IAM_ORIGIN}/v1/${name.split("/").map(encodeURIComponent).join("/")}`,
    {},
    true,
  );
  if (!pool) {
    const operation = (await googleRequest(
      credential,
      `${IAM_ORIGIN}/v1/${parent.split("/").map(encodeURIComponent).join("/")
      }/workloadIdentityPools?workloadIdentityPoolId=${POOL_ID}`,
      {
        method: "POST",
        body: JSON.stringify({
          displayName: "DopeDB Vercel",
          description: "Keyless DopeDB production deployment identities",
          disabled: false,
        }),
      },
    ))!;
    await waitOperation(credential, IAM_ORIGIN, "v1", operation);
    pool = await googleRequest(
      credential,
      `${IAM_ORIGIN}/v1/${name.split("/").map(encodeURIComponent).join("/")}`,
    );
  }
  if (pool?.name !== name || pool.state !== "ACTIVE" || pool.disabled === true) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "The DopeDB workload identity pool is not active",
      409,
    );
  }
}

export async function ensureProvider(
  credential: GcpSetupCredential,
  projectNumber: string,
  identity: Awaited<ReturnType<typeof verifyVercelOidcToken>>,
) {
  const pool = `projects/${projectNumber}/locations/global/workloadIdentityPools/${POOL_ID}`;
  const name = `${pool}/providers/${PROVIDER_ID}`;
  let provider = await googleRequest(
    credential,
    `${IAM_ORIGIN}/v1/${name.split("/").map(encodeURIComponent).join("/")}`,
    {},
    true,
  );
  if (!provider) {
    const operation = (await googleRequest(
      credential,
      `${IAM_ORIGIN}/v1/${pool.split("/").map(encodeURIComponent).join("/")
      }/providers?workloadIdentityPoolProviderId=${PROVIDER_ID}`,
      {
        method: "POST",
        body: JSON.stringify({
          displayName: "DopeDB Vercel",
          description: "DopeDB production Vercel Functions only",
          attributeMapping: { "google.subject": "assertion.sub" },
          attributeCondition: `assertion.project_id == '${identity.projectId}' && assertion.environment == 'production'`,
          oidc: {
            issuerUri: identity.issuer,
            allowedAudiences: [identity.audience],
          },
          disabled: false,
        }),
      },
    ))!;
    await waitOperation(credential, IAM_ORIGIN, "v1", operation);
    provider = await googleRequest(
      credential,
      `${IAM_ORIGIN}/v1/${name.split("/").map(encodeURIComponent).join("/")}`,
    );
  }
  const oidc = provider?.oidc && typeof provider.oidc === "object"
    ? provider.oidc as JsonObject
    : null;
  const mapping = provider?.attributeMapping
    && typeof provider.attributeMapping === "object"
    ? provider.attributeMapping as JsonObject
    : null;
  const audiences = oidc && Array.isArray(oidc.allowedAudiences)
    ? oidc.allowedAudiences
    : [];
  const requiredCondition =
    `assertion.project_id == '${identity.projectId}' && assertion.environment == 'production'`;
  if (
    provider?.name !== name
    || provider.state !== "ACTIVE"
    || provider.disabled === true
    || oidc?.issuerUri !== identity.issuer
    || audiences.length !== 1
    || audiences[0] !== identity.audience
    || mapping?.["google.subject"] !== "assertion.sub"
    || provider.attributeCondition !== requiredCondition
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "The existing DopeDB workload provider has a different trust policy",
      409,
    );
  }
}

export function setupFingerprint(input: GcpCloudBootstrapInput) {
  return createHash("sha256")
    .update(`${input.workspaceId}:${input.projectId}:${input.instanceId}`)
    .digest("hex")
    .slice(0, 14);
}

export function serviceAccountId(
  kind: "read" | "write",
  fingerprint: string,
) {
  const short = kind === "read" ? "r" : "w";
  return `dopedb-${short}-${fingerprint}`;
}

export async function ensureServiceAccount(
  credential: GcpSetupCredential,
  projectId: string,
  accountId: string,
  description: string,
  displayName: string,
) {
  const email = `${accountId}@${projectId}.iam.gserviceaccount.com`;
  const resource = `projects/${projectId}/serviceAccounts/${email}`;
  let account = await googleRequest(
    credential,
    `${IAM_ORIGIN}/v1/${resource.split("/").map(encodeURIComponent).join("/")}`,
    {},
    true,
  );
  if (!account) {
    account = await googleRequest(
      credential,
      `${IAM_ORIGIN}/v1/projects/${encodeURIComponent(projectId)}/serviceAccounts`,
      {
        method: "POST",
        body: JSON.stringify({
          accountId,
          serviceAccount: { displayName, description },
        }),
      },
    );
  }
  if (
    account?.email !== email
    || account.description !== description
    || account.disabled === true
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "A service account name is already in use by another configuration",
      409,
    );
  }
  return email;
}

export type IamBinding = {
  role: string;
  members: string[];
  condition?: { title?: string; description?: string; expression?: string };
};

export type GcpTemporaryPermissionGrant = {
  projectId: string;
  bindings: IamBinding[];
};

export function policyBindings(policy: JsonObject): IamBinding[] {
  if (!Array.isArray(policy.bindings)) return [];
  return policy.bindings.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as JsonObject;
    if (typeof row.role !== "string" || !Array.isArray(row.members)) return [];
    const members = row.members.filter((member): member is string => (
      typeof member === "string"
    ));
    const condition = row.condition && typeof row.condition === "object"
      && !Array.isArray(row.condition)
      ? row.condition as IamBinding["condition"]
      : undefined;
    return [{ role: row.role, members, ...(condition ? { condition } : {}) }];
  });
}

export function addBinding(
  bindings: IamBinding[],
  expected: IamBinding,
) {
  const matching = bindings.find((binding) => (
    binding.role === expected.role
    && (binding.condition?.expression ?? "") === (expected.condition?.expression ?? "")
  ));
  if (matching) {
    if (!matching.members.includes(expected.members[0])) {
      matching.members.push(expected.members[0]);
      matching.members.sort();
      return true;
    }
    return false;
  }
  const expectedCondition = expected.condition;
  if (
    expectedCondition?.title
    && bindings.some((binding) => (
      binding.condition?.title === expectedCondition.title
      && binding.condition?.expression !== expectedCondition.expression
    ))
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "An IAM condition name is already used by a different policy",
      409,
    );
  }
  bindings.push(expected);
  return true;
}

export async function updateIamPolicy(
  credential: GcpSetupCredential,
  resourceUrl: string,
  additions: IamBinding[],
) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const policy = (await googleRequest(
      credential,
      `${resourceUrl}:getIamPolicy`,
      {
        method: "POST",
        body: JSON.stringify({ options: { requestedPolicyVersion: 3 } }),
      },
    ))!;
    const bindings = policyBindings(policy);
    let changed = false;
    for (const addition of additions) {
      changed = addBinding(bindings, addition) || changed;
    }
    if (!changed) return;
    try {
      await googleRequest(
        credential,
        `${resourceUrl}:setIamPolicy`,
        {
          method: "POST",
          body: JSON.stringify({
            policy: {
              version: 3,
              bindings,
              ...(typeof policy.etag === "string" ? { etag: policy.etag } : {}),
            },
          }),
        },
      );
      return;
    } catch (error) {
      if (
        error instanceof GcpUpstreamRequestError
        && error.iamServiceAccountPropagationPending
      ) {
        if (attempt === 11) {
          throw new ProviderRequestError(
            "gcpCloudSql",
            "새 Google Cloud 서비스 계정이 아직 IAM에 반영되지 않았습니다. 잠시 뒤 다시 시도하세요.",
            503,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        continue;
      }
      if (error instanceof ProviderRequestError && error.status === 409 && attempt < 2) {
        continue;
      }
      throw error;
    }
  }
}

export async function removeIamPolicyBindings(
  credential: GcpSetupCredential,
  resourceUrl: string,
  removals: IamBinding[],
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const policy = (await googleRequest(
      credential,
      `${resourceUrl}:getIamPolicy`,
      {
        method: "POST",
        body: JSON.stringify({ options: { requestedPolicyVersion: 3 } }),
      },
    ))!;
    let bindings = policyBindings(policy);
    let changed = false;
    for (const removal of removals) {
      for (const binding of bindings) {
        if (
          binding.role !== removal.role
          || (binding.condition?.expression ?? "")
            !== (removal.condition?.expression ?? "")
        ) {
          continue;
        }
        const nextMembers = binding.members.filter(
          (member) => !removal.members.includes(member),
        );
        if (nextMembers.length !== binding.members.length) {
          binding.members = nextMembers;
          changed = true;
        }
      }
    }
    if (!changed) return;
    bindings = bindings.filter((binding) => binding.members.length > 0);
    try {
      await googleRequest(
        credential,
        `${resourceUrl}:setIamPolicy`,
        {
          method: "POST",
          body: JSON.stringify({
            policy: {
              version: 3,
              bindings,
              ...(typeof policy.etag === "string" ? { etag: policy.etag } : {}),
            },
          }),
        },
      );
      return;
    } catch (error) {
      if (!(error instanceof ProviderRequestError) || error.status !== 409 || attempt === 2) {
        throw error;
      }
    }
  }
}

export async function grantTemporaryGcpSetupPermissions(input: {
  credential: GcpSetupCredential;
  projectId: string;
  setupId: string;
  check: GcpSetupPermissionCheck;
}): Promise<GcpTemporaryPermissionGrant | null> {
  if (input.check.missing.length === 0) return null;
  if (
    input.check.account !== input.credential.email
    || input.check.projectId !== input.projectId
    || !input.check.canAutoGrant
    || !/^[0-9a-f-]{36}$/i.test(input.setupId)
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Google Cloud 프로젝트 IAM 관리자가 누락된 설정 역할을 승인해야 합니다.",
      403,
    );
  }
  const expiresAt = new Date(Date.now() + 15 * 60 * 1_000).toISOString();
  const condition = {
    title: `dopedb-setup-${input.setupId.slice(0, 8)}`,
    description: "Temporary DopeDB managed connection bootstrap",
    expression: `request.time < timestamp("${expiresAt}")`,
  };
  const member = `user:${input.credential.email}`;
  const bindings = input.check.missing.map((requirement) => ({
    role: requirement.role,
    members: [member],
    condition,
  }));
  const resourceUrl =
    `${RESOURCE_MANAGER_ORIGIN}/v1/projects/${encodeURIComponent(input.projectId)}`;
  const credential = quotaProjectCredential(input.credential, input.projectId);
  let applied = false;
  try {
    await updateIamPolicy(credential, resourceUrl, bindings);
    applied = true;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const confirmed = await checkGcpSetupPermissions(
        credential,
        input.projectId,
      );
      if (confirmed.missing.length === 0) {
        return { projectId: input.projectId, bindings };
      }
      if (attempt < 11) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
    throw new ProviderRequestError(
      "gcpCloudSql",
      "임시 Google Cloud 설정 권한이 제한 시간 안에 활성화되지 않았습니다.",
      409,
    );
  } catch (error) {
    if (applied) {
      try {
        await removeIamPolicyBindings(
          credential,
          resourceUrl,
          bindings,
        );
      } catch {
        throw new ProviderRequestError(
          "gcpCloudSql",
          "임시 Google Cloud 설정 권한을 바로 제거하지 못했습니다. 해당 권한은 15분 뒤 자동 만료됩니다.",
          409,
        );
      }
    }
    throw error;
  }
}

export async function revokeTemporaryGcpSetupPermissions(
  credential: GcpSetupCredential,
  grant: GcpTemporaryPermissionGrant,
) {
  const scopedCredential = quotaProjectCredential(credential, grant.projectId);
  await removeIamPolicyBindings(
    scopedCredential,
    `${RESOURCE_MANAGER_ORIGIN}/v1/projects/${encodeURIComponent(grant.projectId)}`,
    grant.bindings,
  );
}

export async function grantWorkloadIdentity(
  credential: GcpSetupCredential,
  projectId: string,
  serviceAccountEmail: string,
  principal: string,
) {
  const resource = `${IAM_ORIGIN}/v1/projects/${encodeURIComponent(projectId)
  }/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}`;
  await updateIamPolicy(credential, resource, [{
    role: "roles/iam.workloadIdentityUser",
    members: [principal],
  }]);
}

export async function grantCloudSqlRoles(
  credential: GcpSetupCredential,
  input: GcpCloudBootstrapInput,
  readEmail: string,
  writeEmail: string | null,
  fingerprint: string,
) {
  const target = `projects/${input.projectId}/instances/${input.instanceId}`;
  const expression = `resource.service == 'sqladmin.googleapis.com' && (resource.name == '${target}' || resource.name.startsWith('${target}/'))`;
  const condition = {
    title: `dopedb-${fingerprint}`,
    description: "DopeDB managed access restricted to one Cloud SQL instance",
    expression,
  };
  const additions: IamBinding[] = [
    {
      role: "roles/serviceusage.serviceUsageConsumer",
      members: [
        `serviceAccount:${readEmail}`,
        ...(writeEmail ? [`serviceAccount:${writeEmail}`] : []),
      ],
    },
    {
      role: "roles/cloudsql.client",
      members: [`serviceAccount:${readEmail}`],
      condition,
    },
    {
      role: "roles/cloudsql.instanceUser",
      members: [`serviceAccount:${readEmail}`],
      condition,
    },
    {
      role: "roles/cloudsql.viewer",
      members: [`serviceAccount:${readEmail}`],
      condition,
    },
    ...(writeEmail ? [
      {
        role: "roles/cloudsql.client",
        members: [`serviceAccount:${writeEmail}`],
        condition,
      },
      {
        role: "roles/cloudsql.instanceUser",
        members: [`serviceAccount:${writeEmail}`],
        condition,
      },
    ] : []),
  ];
  await updateIamPolicy(
    credential,
    `${RESOURCE_MANAGER_ORIGIN}/v1/projects/${encodeURIComponent(input.projectId)}`,
    additions,
  );
}
