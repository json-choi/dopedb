// Exact-commit webhook persistence keeps only its replay and ordering safety
// contract in the shared PostgreSQL harness; graph construction is not involved.
import { randomUUID } from "node:crypto";

import { expect } from "vitest";

import type { ProviderImportPostgresHarness } from "./fixture";

export async function runSourceRevisionScenarios(
  fixture: ProviderImportPostgresHarness,
) {
  const { recordGithubSourceRevisions } = await import("../knowledge/source-revisions");
  const projectId = randomUUID();
  const environmentId = randomUUID();
  const installationId = randomUUID();
  const sourceId = randomUUID();
  const beforeCommitSha = "6".repeat(40);
  const afterCommitSha = "7".repeat(40);

  await fixture.sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO "workspace_control"."knowledge_project"
        ("id", "organization_id", "name")
      VALUES (${projectId}, ${fixture.organizationId}, 'Source revision fixture')
    `;
    await transaction`
      INSERT INTO "workspace_control"."knowledge_project_environment"
        ("id", "organization_id", "project_id", "name", "production", "risk_class")
      VALUES (
        ${environmentId}, ${fixture.organizationId}, ${projectId},
        'main', false, 'development'
      )
    `;
    await transaction`
      INSERT INTO "workspace_control"."knowledge_github_installation"
        ("id", "organization_id", "installation_id", "account_id", "account_login")
      VALUES (${installationId}, ${fixture.organizationId}, 101, '101', 'fixture')
    `;
    await transaction`
      INSERT INTO "workspace_control"."knowledge_source" (
        "id", "organization_id", "project_id", "project_environment_id",
        "environment_revision", "display_name", "provider", "visibility",
        "github_installation_id", "repository_id", "repository_full_name",
        "ref_name", "commit_sha", "sync_state"
      ) VALUES (
        ${sourceId}, ${fixture.organizationId}, ${projectId}, ${environmentId}, 1,
        'fixture/source', 'github', 'shared_graph', ${installationId},
        '1004', 'fixture/source', 'main', ${beforeCommitSha}, 'ready'
      )
    `;
  });

  const deliveryId = randomUUID();
  const revision = {
    organizationId: fixture.organizationId,
    sourceId,
    deliveryId,
    beforeCommitSha,
    afterCommitSha,
  };
  expect(await recordGithubSourceRevisions([revision])).toEqual([{
    eventId: expect.any(String),
    sourceId,
    advanced: true,
  }]);
  expect(await recordGithubSourceRevisions([revision])).toEqual([]);
  expect(await recordGithubSourceRevisions([{
    ...revision,
    deliveryId: randomUUID(),
    afterCommitSha: "8".repeat(40),
  }])).toEqual([{
    eventId: expect.any(String),
    sourceId,
    advanced: false,
  }]);

  const [state] = await fixture.sql<Array<{
    commitSha: string;
    syncRevision: number;
    consumedEvents: number;
    failedEvents: number;
    jobs: number;
  }>>`
    SELECT source."commit_sha" AS "commitSha",
      source."sync_revision"::int AS "syncRevision",
      count(DISTINCT event."id") FILTER (WHERE event."state" = 'consumed')::int
        AS "consumedEvents",
      count(DISTINCT event."id") FILTER (WHERE event."state" = 'failed')::int
        AS "failedEvents",
      count(DISTINCT job."id")::int AS "jobs"
    FROM "workspace_control"."knowledge_source" source
    LEFT JOIN "workspace_control"."knowledge_source_event" event
      ON event."source_id" = source."id"
    LEFT JOIN "workspace_control"."knowledge_source_sync_job" job
      ON job."source_id" = source."id"
    WHERE source."id" = ${sourceId}
    GROUP BY source."commit_sha", source."sync_revision"
  `;
  expect(state).toEqual({
    commitSha: afterCommitSha,
    syncRevision: 2,
    consumedEvents: 1,
    failedEvents: 1,
    jobs: 0,
  });
}
