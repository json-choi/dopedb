-- Encrypted snapshot envelopes can exceed D1's 2 MB row limit. Keep their
-- bounded chunks in the same transaction and retention cascade as the metadata.
CREATE TABLE workspace_backup_chunk (
  organization_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  manifest TEXT NOT NULL,
  part INTEGER NOT NULL CHECK (typeof(part) = 'integer' AND part >= 0 AND part < 128),
  ciphertext TEXT NOT NULL CHECK (length(ciphertext) > 0 AND length(ciphertext) <= 524288),
  PRIMARY KEY (backup_id, manifest, part),
  FOREIGN KEY (organization_id, backup_id) REFERENCES workspace_metadata_backup (organization_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER workspace_backup_chunk_insert_guard BEFORE INSERT ON workspace_backup_chunk
WHEN NOT EXISTS (SELECT 1 FROM workspace_metadata_backup backup
  WHERE backup.id = NEW.backup_id AND backup.organization_id = NEW.organization_id AND backup.ciphertext = NEW.manifest)
BEGIN SELECT RAISE(ABORT, 'backup chunk requires its exact envelope manifest'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_backup_chunk_no_update BEFORE UPDATE ON workspace_backup_chunk
BEGIN SELECT RAISE(ABORT, 'backup chunks are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_backup_chunk_delete_guard BEFORE DELETE ON workspace_backup_chunk
WHEN EXISTS (SELECT 1 FROM workspace_metadata_backup backup
  WHERE backup.id = OLD.backup_id AND backup.organization_id = OLD.organization_id AND backup.ciphertext = OLD.manifest)
BEGIN SELECT RAISE(ABORT, 'current backup chunks are immutable'); END;
