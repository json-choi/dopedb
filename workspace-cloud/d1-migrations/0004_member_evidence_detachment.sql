-- SQLite SET NULL on a composite FK would also clear organization_id. Detach
-- only the nullable actor before the parent deletion reaches FK actions, as the
-- PostgreSQL column-scoped SET NULL contract did. Runners must already be revoked.
CREATE TRIGGER workspace_member_detach_evidence BEFORE DELETE ON member
BEGIN
  UPDATE workspace_analysis_runner SET member_id = NULL
    WHERE organization_id = OLD.organization_id AND member_id = OLD.id;
  UPDATE workspace_analysis_article_run SET requested_by_member_id = NULL
    WHERE organization_id = OLD.organization_id AND requested_by_member_id = OLD.id;
  UPDATE workspace_analysis_article_run SET cancel_requested_by_member_id = NULL
    WHERE organization_id = OLD.organization_id AND cancel_requested_by_member_id = OLD.id;
  UPDATE workspace_analysis_publication SET approved_by_member_id = NULL
    WHERE organization_id = OLD.organization_id AND approved_by_member_id = OLD.id;
END;
