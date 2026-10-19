// The one date and time formatter of workspace administration: every panel renders
// timestamps in the UI language through it. An unparseable value is shown as given
// rather than throwing inside render.
import type { Lang } from "../../lib/i18n";

export function adminLocale(lang: Lang): string {
  return lang === "ko" ? "ko-KR" : "en-US";
}

export function formatAdminDate(
  value: string | number,
  lang: Lang,
  options: Intl.DateTimeFormatOptions,
): string {
  const time = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(time)) return String(value);
  return new Intl.DateTimeFormat(adminLocale(lang), options).format(new Date(time));
}
