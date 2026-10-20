ALTER TABLE `knowledge_project_environment` ADD `kind` text DEFAULT 'development' NOT NULL;
--> statement-breakpoint
-- The kind is the environment. Production wins whenever the legacy flag or class says
-- so; `custom` becomes development; every other class carries over unchanged.
UPDATE knowledge_project_environment SET kind = CASE
  WHEN production = 1 OR risk_class = 'production' THEN 'production'
  WHEN risk_class IN ('staging', 'test') THEN risk_class
  ELSE 'development' END;
--> statement-breakpoint
-- Keep the replaced names and classes in the audit trail before they are rewritten.
INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
SELECT organization_id, NULL, 'knowledge.environment.normalize', 'knowledge_environment', id,
  json_object('name', name, 'riskClass', risk_class, 'production', production, 'kind', kind),
  '00000000-0000-4000-8000-000000000012'
FROM knowledge_project_environment
WHERE lower(name) <> kind OR risk_class <> kind OR production <> (kind = 'production');
--> statement-breakpoint
-- Bump the Project revision where kinds collide so every client reloads the folded list.
UPDATE knowledge_project SET revision = revision + 1
WHERE id IN (SELECT project_id FROM knowledge_project_environment WHERE id IN (SELECT d.id FROM knowledge_project_environment d WHERE d.id <> (SELECT min(o.id) FROM knowledge_project_environment o WHERE o.project_id = d.project_id AND o.kind = d.kind)));
--> statement-breakpoint
-- Fold a duplicated kind into the lowest id of that kind: sources, bindings, heads, grants,
-- proposals, graph revisions, and Articles move to the survivor and take its revision.
-- Graph revisions are immutable, so their guard is lifted for this one re-point only.
UPDATE knowledge_source SET project_environment_id = (SELECT min(o.id) FROM knowledge_project_environment o JOIN knowledge_project_environment d ON d.project_id = o.project_id AND d.kind = o.kind WHERE d.id = knowledge_source.project_environment_id),
  environment_revision = (SELECT owner.revision FROM knowledge_project_environment owner WHERE owner.id = (SELECT min(o.id) FROM knowledge_project_environment o JOIN knowledge_project_environment d ON d.project_id = o.project_id AND d.kind = o.kind WHERE d.id = knowledge_source.project_environment_id))
WHERE project_environment_id IN (SELECT d.id FROM knowledge_project_environment d WHERE d.id <> (SELECT min(o.id) FROM knowledge_project_environment o WHERE o.project_id = d.project_id AND o.kind = d.kind));
--> statement-breakpoint
UPDATE knowledge_environment_connection SET project_environment_id = (SELECT min(o.id) FROM knowledge_project_environment o JOIN knowledge_project_environment d ON d.project_id = o.project_id AND d.kind = o.kind WHERE d.id = knowledge_environment_connection.project_environment_id),
  environment_revision = (SELECT owner.revision FROM knowledge_project_environment owner WHERE owner.id = (SELECT min(o.id) FROM knowledge_project_environment o JOIN knowledge_project_environment d ON d.project_id = o.project_id AND d.kind = o.kind WHERE d.id = knowledge_environment_connection.project_environment_id))
WHERE project_environment_id IN (SELECT d.id FROM knowledge_project_environment d WHERE d.id <> (SELECT min(o.id) FROM knowledge_project_environment o WHERE o.project_id = d.project_id AND o.kind = d.kind));
--> statement-breakpoint
UPDATE knowledge_environment_head SET project_environment_id = (SELECT min(o.id) FROM knowledge_project_environment o JOIN knowledge_project_environment d ON d.project_id = o.project_id AND d.kind = o.kind WHERE d.id = knowledge_environment_head.project_environment_id),
  environment_revision = (SELECT owner.revision FROM knowledge_project_environment owner WHERE owner.id = (SELECT min(o.id) FROM knowledge_project_environment o JOIN knowledge_project_environment d ON d.project_id = o.project_id AND d.kind = o.kind WHERE d.id = knowledge_environment_head.project_environment_id))
WHERE project_environment_id IN (SELECT d.id FROM knowledge_project_environment d WHERE d.id <> (SELECT min(o.id) FROM knowledge_project_environment o WHERE o.project_id = d.project_id AND o.kind = d.kind));
--> statement-breakpoint
UPDATE knowledge_grant SET project_environment_id = (SELECT min(o.id) FROM knowledge_project_environment o JOIN knowledge_project_environment d ON d.project_id = o.project_id AND d.kind = o.kind WHERE d.id = knowledge_grant.project_environment_id),
  environment_revision = (SELECT owner.revision FROM knowledge_project_environment owner WHERE owner.id = (SELECT min(o.id) FROM knowledge_project_environment o JOIN knowledge_project_environment d ON d.project_id = o.project_id AND d.kind = o.kind WHERE d.id = knowledge_grant.project_environment_id))
WHERE project_environment_id IN (SELECT d.id FROM knowledge_project_environment d WHERE d.id <> (SELECT min(o.id) FROM knowledge_project_environment o WHERE o.project_id = d.project_id AND o.kind = d.kind));
--> statement-breakpoint
UPDATE workspace_analysis_article SET project_environment_id = (SELECT min(o.id) FROM knowledge_project_environment o JOIN knowledge_project_environment d ON d.project_id = o.project_id AND d.kind = o.kind WHERE d.id = workspace_analysis_article.project_environment_id),
  environment_revision = (SELECT owner.revision FROM knowledge_project_environment owner WHERE owner.id = (SELECT min(o.id) FROM knowledge_project_environment o JOIN knowledge_project_environment d ON d.project_id = o.project_id AND d.kind = o.kind WHERE d.id = workspace_analysis_article.project_environment_id))
WHERE project_environment_id IN (SELECT d.id FROM knowledge_project_environment d WHERE d.id <> (SELECT min(o.id) FROM knowledge_project_environment o WHERE o.project_id = d.project_id AND o.kind = d.kind));
--> statement-breakpoint
UPDATE knowledge_mapping_proposal SET project_environment_id = (SELECT min(o.id) FROM knowledge_project_environment o JOIN knowledge_project_environment d ON d.project_id = o.project_id AND d.kind = o.kind WHERE d.id = knowledge_mapping_proposal.project_environment_id)
WHERE project_environment_id IN (SELECT d.id FROM knowledge_project_environment d WHERE d.id <> (SELECT min(o.id) FROM knowledge_project_environment o WHERE o.project_id = d.project_id AND o.kind = d.kind));
--> statement-breakpoint
DROP TRIGGER knowledge_graph_revision_reject_update;
--> statement-breakpoint
UPDATE knowledge_graph_revision SET project_environment_id = (SELECT min(o.id) FROM knowledge_project_environment o JOIN knowledge_project_environment d ON d.project_id = o.project_id AND d.kind = o.kind WHERE d.id = knowledge_graph_revision.project_environment_id),
  environment_revision = (SELECT owner.revision FROM knowledge_project_environment owner WHERE owner.id = (SELECT min(o.id) FROM knowledge_project_environment o JOIN knowledge_project_environment d ON d.project_id = o.project_id AND d.kind = o.kind WHERE d.id = knowledge_graph_revision.project_environment_id))
WHERE project_environment_id IN (SELECT d.id FROM knowledge_project_environment d WHERE d.id <> (SELECT min(o.id) FROM knowledge_project_environment o WHERE o.project_id = d.project_id AND o.kind = d.kind));
--> statement-breakpoint
CREATE TRIGGER knowledge_graph_revision_reject_update BEFORE UPDATE ON knowledge_graph_revision
BEGIN SELECT RAISE(ABORT, 'knowledge graph revisions are immutable'); END;
--> statement-breakpoint
DELETE FROM knowledge_project_environment WHERE id IN (SELECT d.id FROM knowledge_project_environment d WHERE d.id <> (SELECT min(o.id) FROM knowledge_project_environment o WHERE o.project_id = d.project_id AND o.kind = d.kind));
--> statement-breakpoint
-- Legacy columns stay only so pre-kind Desktops keep reading a name and class; they are
-- derived from the kind on every write. Park names first so the swap cannot collide.
UPDATE knowledge_project_environment SET name = id;
--> statement-breakpoint
UPDATE knowledge_project_environment SET
  name = CASE kind WHEN 'production' THEN 'Production' WHEN 'staging' THEN 'Staging'
    WHEN 'test' THEN 'Test' ELSE 'Development' END,
  production = (kind = 'production'), risk_class = kind;
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_environment_project_kind_idx` ON `knowledge_project_environment` (`project_id`,`kind`);
--> statement-breakpoint
CREATE TRIGGER knowledge_project_environment_kind_insert BEFORE INSERT ON knowledge_project_environment
WHEN NEW.kind NOT IN ('development', 'staging', 'production', 'test')
BEGIN SELECT RAISE(ABORT, 'invalid Project environment kind'); END;
--> statement-breakpoint
CREATE TRIGGER knowledge_project_environment_kind_update BEFORE UPDATE OF kind ON knowledge_project_environment
WHEN NEW.kind NOT IN ('development', 'staging', 'production', 'test')
BEGIN SELECT RAISE(ABORT, 'invalid Project environment kind'); END;
