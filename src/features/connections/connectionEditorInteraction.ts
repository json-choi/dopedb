// Pure keyboard ownership and async request identity rules for the Connection
// editor. Secrets never participate in either decision.
export type ConnectionEditorEnterCommand = "normalizeUrl" | "save" | null;

const SAVE_INPUT_TYPES = new Set([
  "text",
  "password",
  "number",
  "url",
  "email",
  "tel",
]);

export function connectionEditorEnterCommand({
  key,
  defaultPrevented,
  isComposing,
  busy,
  editorOwnsTarget,
  nestedFormOwnsTarget,
  inputType,
  inputId,
}: {
  key: string;
  defaultPrevented: boolean;
  isComposing: boolean;
  busy: boolean;
  editorOwnsTarget: boolean;
  nestedFormOwnsTarget: boolean;
  inputType: string | null;
  inputId: string | null;
}): ConnectionEditorEnterCommand {
  if (
    key !== "Enter" ||
    defaultPrevented ||
    isComposing ||
    busy ||
    !editorOwnsTarget ||
    nestedFormOwnsTarget
  ) {
    return null;
  }
  if (inputId === "connection-url") return "normalizeUrl";
  return inputType !== null && SAVE_INPUT_TYPES.has(inputType) ? "save" : null;
}

export function connectionTestResultIsCurrent(
  startedRevision: number,
  currentRevision: number,
  requestId: number,
  currentRequestId: number,
) {
  return startedRevision === currentRevision && requestId === currentRequestId;
}
