-- A command's validated snapshot exists only inside one atomic D1 batch.
-- The batch must delete its scope before committing; errors roll back its insert.
CREATE TABLE workspace_atomic_scope (
  id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object')
);
