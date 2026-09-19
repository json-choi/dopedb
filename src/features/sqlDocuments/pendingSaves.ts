// Registry for the mounted SQL editor's pending save. Only the active document has
// an editor, so closing its tab has to reach that autosave state machine through
// this registry instead of dropping the debounced write with the unmounted editor.
// It holds one flush per document id and never stores document content itself.

export type SqlDocumentFlushOutcome =
  | { kind: "saved" }
  | { kind: "pending" }
  | { kind: "conflict" }
  | { kind: "error"; message: string };

type SqlDocumentFlush = () => Promise<SqlDocumentFlushOutcome>;

const pending = new Map<string, SqlDocumentFlush>();

export function registerSqlDocumentFlush(
  id: string,
  flush: SqlDocumentFlush,
): () => void {
  pending.set(id, flush);
  return () => {
    if (pending.get(id) === flush) pending.delete(id);
  };
}

/** Resolves as saved when no editor is mounted for the document. */
export async function flushSqlDocumentSave(
  id: string,
): Promise<SqlDocumentFlushOutcome> {
  const flush = pending.get(id);
  return flush ? await flush() : { kind: "saved" };
}
