// Locale-aware date and relative-time labels for account administration rows.
import type { Lang } from "../../../lib/i18n";

const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["week", 7 * 86_400],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

function locale(lang: Lang) {
  return lang === "ko" ? "ko-KR" : "en-US";
}

/** "5 minutes ago" / "5분 전", or null when the moment is under a minute away. */
export function relativeAge(iso: string, lang: Lang, now = Date.now()): string | null {
  const seconds = (Date.parse(iso) - now) / 1_000;
  if (!Number.isFinite(seconds) || Math.abs(seconds) < 60) return null;
  const [unit, size] = RELATIVE_UNITS.find(([, length]) => Math.abs(seconds) >= length)
    ?? (["minute", 60] as const);
  return new Intl.RelativeTimeFormat(locale(lang), { numeric: "auto" })
    .format(Math.round(seconds / size), unit);
}

export function formatDay(iso: string, lang: Lang) {
  return new Intl.DateTimeFormat(locale(lang), { dateStyle: "medium" }).format(new Date(iso));
}

export function formatMoment(iso: string, lang: Lang) {
  return new Intl.DateTimeFormat(locale(lang), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
