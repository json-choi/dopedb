PRAGMA foreign_keys = ON;

CREATE TABLE workspace_background_task (
  task TEXT PRIMARY KEY NOT NULL
    CHECK (task IN ('credential', 'maintenance')),
  due_at_ms INTEGER NOT NULL CHECK (due_at_ms >= 0),
  lease_until_ms INTEGER NOT NULL DEFAULT 0 CHECK (lease_until_ms >= 0),
  lease_token TEXT CHECK (lease_token IS NULL OR length(lease_token) = 36),
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count BETWEEN 0 AND 20),
  last_error_kind TEXT CHECK (
    last_error_kind IS NULL
    OR last_error_kind IN ('transport', 'response', 'receipt', 'storage')
  ),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  CHECK (
    (lease_until_ms = 0 AND lease_token IS NULL)
    OR (lease_until_ms > 0 AND lease_token IS NOT NULL)
  )
) WITHOUT ROWID, STRICT;

-- Deployment explicitly kicks both tasks after the Vercel receipt contract is
-- live. A far-future seed prevents a newly deployed Worker from touching the
-- workspace database before that hand-off has completed.
INSERT INTO workspace_background_task (
  task, due_at_ms, lease_until_ms, lease_token, generation,
  failure_count, last_error_kind, updated_at_ms
) VALUES
  ('credential', 32503680000000, 0, NULL, 0, 0, NULL, 0),
  ('maintenance', 32503680000000, 0, NULL, 0, 0, NULL, 0);
