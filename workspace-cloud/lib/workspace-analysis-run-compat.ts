// Bounded envelope adapter for Desktop versions that still send an empty
// fragmentManifest. Hosted result fragments are never accepted or returned.

export function parseLegacyAnalysisRunCompletionEnvelope(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const fields = ["state", "queryReceipts", "fragmentManifest", "error"];
  if (Object.keys(row).length !== fields.length
    || fields.some((field) => !Object.prototype.hasOwnProperty.call(row, field))
    || !Array.isArray(row.fragmentManifest) || row.fragmentManifest.length !== 0) {
    return null;
  }
  return {
    state: row.state,
    queryReceipts: row.queryReceipts,
    error: row.error,
  };
}
