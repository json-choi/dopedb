/** Shared contracts for the static English and Korean message catalogues. */

/** Languages currently shipped by the desktop application. */
export type Lang = "en" | "ko";

/** Device preference stays independent of the currently resolved catalogue language. */
export type LangPreference = Lang | "system";

/** A catalogue carries the same string-keyed messages for every supported language. */
export type MessageCatalog = Readonly<{
  en: Readonly<Record<string, string>>;
  ko: Readonly<Record<string, string>>;
}>;

type ExactKoreanMessages<English extends Readonly<Record<string, string>>> = {
  readonly [Key in keyof English]: string;
};

type NotInferred<Value> = [Value][Value extends Value ? 0 : never];

/**
 * Defines one bounded catalogue while making Korean omissions and extra keys a TypeScript
 * error at the catalogue boundary, rather than a runtime fallback surprise.
 */
export function defineCatalog<const English extends Readonly<Record<string, string>>>(
  en: English,
  ko: ExactKoreanMessages<NotInferred<English>>,
): Readonly<{ en: English; ko: ExactKoreanMessages<English> }> {
  return { en, ko };
}
