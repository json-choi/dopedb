// One shared definition of the Settings sections that search can reach. The Settings
// sidebar filter and Action Search read the same localized terms, so a word that finds
// a section in one surface finds it in the other instead of only in English.
import type { I18nKey } from "../../lib/i18n";
import type { SettingsSection } from "./domain";

/** Which pane of the Settings modal owns a section. */
export type SettingsScope = "application" | "dataSource";

export type SettingsSearchEntry = Readonly<{
  id: SettingsSection;
  scope: SettingsScope;
  /** Catalogue key for the section's own name. */
  label: I18nKey;
  /**
   * Catalogue key holding that section's space-separated search terms. Keeping the
   * terms in the catalogue is what makes them follow the active language, and every
   * term must name something the section really owns so search never offers a
   * feature the screen does not have.
   */
  terms: I18nKey;
}>;

/** Ordered exactly as the Settings sidebar lists them. */
export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  {
    id: "agent-tools",
    scope: "application",
    label: "settings.agentTools",
    terms: "settings.keywords.agentTools",
  },
  {
    id: "advanced",
    scope: "application",
    label: "settings.advanced",
    terms: "settings.keywords.advanced",
  },
  {
    id: "cli",
    scope: "application",
    label: "settings.cli",
    terms: "settings.keywords.cli",
  },
  {
    id: "appearance",
    scope: "application",
    label: "settings.appearance",
    terms: "settings.keywords.appearance",
  },
  {
    id: "language",
    scope: "application",
    label: "settings.languageTitle",
    terms: "settings.keywords.language",
  },
  {
    id: "privacy",
    scope: "application",
    label: "settings.privacy",
    terms: "settings.keywords.privacy",
  },
  {
    id: "updates",
    scope: "application",
    label: "settings.updates",
    terms: "settings.keywords.updates",
  },
  {
    id: "safety",
    scope: "dataSource",
    label: "settings.safety",
    terms: "settings.keywords.safety",
  },
];

/** Lowercase and NFKC so a Korean and an English query are compared the same way. */
export function normalizeSettingsSearch(value: string): string {
  return value.trim().toLocaleLowerCase().normalize("NFKC");
}

/** One section's search terms in the active language. */
export function settingsSearchTerms(
  entry: SettingsSearchEntry,
  t: (key: I18nKey) => string,
): readonly string[] {
  return t(entry.terms).split(/\s+/).filter(Boolean);
}

/** True when the section's visible name or its localized terms contain the query. */
export function settingsSectionMatches(
  label: string,
  terms: readonly string[],
  query: string,
): boolean {
  const needle = normalizeSettingsSearch(query);
  if (!needle) return true;
  return normalizeSettingsSearch(`${label} ${terms.join(" ")}`).includes(needle);
}
