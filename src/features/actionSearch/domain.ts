// Pure match model for the action palette. Items are normalized once into an index, then
// ranked into fixed strength buckets so memory and the final merge stay bounded by the
// caller's limit. It holds no state and never runs an item.
export type ActionSearchKind =
  | "action"
  | "connection"
  | "document"
  | "databaseObject"
  | "setting";

export type ActionSearchItem = Readonly<{
  id: string;
  kind: ActionSearchKind;
  label: string;
  detail?: string;
  keywords?: readonly string[];
  shortcut?: string;
  disabled?: boolean;
  run: () => void | Promise<void>;
}>;

function normalized(value: string) {
  return value.trim().toLocaleLowerCase().normalize("NFKC");
}

export type ActionSearchIndex = ReadonlyArray<
  Readonly<{
    item: ActionSearchItem;
    label: string;
    detail: string;
    keywords: string;
  }>
>;

export function indexActionSearchItems(
  items: readonly ActionSearchItem[],
): ActionSearchIndex {
  return items.map((item) => ({
    item,
    label: normalized(item.label),
    detail: normalized(item.detail ?? ""),
    keywords: normalized(item.keywords?.join(" ") ?? ""),
  }));
}

function score(
  item: ActionSearchIndex[number],
  query: string,
) {
  const { label, detail, keywords } = item;
  if (!query) return 0;
  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (label.includes(query)) return 2;
  if (detail.includes(query)) return 3;
  if (keywords.includes(query)) return 4;
  return Number.POSITIVE_INFINITY;
}

export function searchActionItems(
  index: ActionSearchIndex,
  rawQuery: string,
  limit = 40,
) {
  const query = normalized(rawQuery);
  const buckets: Array<ActionSearchItem[]> = [[], [], [], [], []];
  for (const entry of index) {
    const itemScore = score(entry, query);
    if (!Number.isFinite(itemScore)) continue;
    const bucket = buckets[itemScore];
    // Keeping at most the result limit in each score bucket makes memory and
    // final merging bounded without discarding a later, higher-ranked match.
    if (bucket.length < limit) bucket.push(entry.item);
  }
  return buckets.flatMap((bucket) => bucket).slice(0, limit);
}
