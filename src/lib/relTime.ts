// Relative and absolute timestamps for feed/audit rows in the app's resolved UI
// language, so Settings → Language (not the OS locale) owns the wording.
import type { Lang } from "./i18n";

const relativeFormats = new Map<Lang, Intl.RelativeTimeFormat>();
const fullFormats = new Map<Lang, Intl.DateTimeFormat>();

function relativeFormat(lang: Lang) {
  let format = relativeFormats.get(lang);
  if (!format) {
    format = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
    relativeFormats.set(lang, format);
  }
  return format;
}

export function relTime(value: string | number, lang: Lang, now = Date.now()): string {
  const date = new Date(value);
  const elapsed = (now - date.getTime()) / 1000;
  if (Number.isNaN(elapsed)) return "—";
  const relative = relativeFormat(lang);
  if (elapsed < 45) return relative.format(0, "second");
  if (elapsed < 3_600) return relative.format(-Math.max(1, Math.round(elapsed / 60)), "minute");
  if (elapsed < 86_400) return relative.format(-Math.round(elapsed / 3_600), "hour");
  if (elapsed < 604_800) return relative.format(-Math.round(elapsed / 86_400), "day");
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(lang, sameYear
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" });
}

export function fullTime(value: string | number, lang: Lang): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  let format = fullFormats.get(lang);
  if (!format) {
    format = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "medium" });
    fullFormats.set(lang, format);
  }
  return format.format(date);
}
