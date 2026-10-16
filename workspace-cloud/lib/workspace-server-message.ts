// Shows a server or identity-service sentence only when it is written in the
// current workspace language; otherwise the caller's localized fallback is used.
import type { WorkspaceLocale } from "./workspace-locale";

export function localizedServerMessage(
  message: string,
  locale: WorkspaceLocale,
  fallback = message,
): string {
  const containsKorean = /[가-힣]/.test(message);
  if (locale === "ko") return containsKorean ? message : fallback;
  return containsKorean ? fallback : message;
}
