// Per-column value filter built from the page's own values, with occurrence
// counts. The choice is encoded back into the single filter string the grid owns,
// so the menu keeps no filter state of its own between openings.
import { useMemo, useRef, useState } from "react";
import { Button } from "../../design-system/components/Button";
import { TextInput } from "../../design-system/components/FormControls";
import {
  decodeGridValueFilter,
  encodeGridValueFilter,
  gridFilterValue,
  gridFilterValueKey,
  type GridFilterValue,
} from "../../lib/gridValueFilter";
import { useI18n } from "../../lib/i18n";
import ToolbarMenu from "../../components/ToolbarMenu";

type FilterChoice = {
  key: string;
  value: GridFilterValue;
  label: string;
  count: number;
};

export default function DataGridColumnFilterMenu({
  column,
  values,
  filter,
  onFilter,
}: {
  column: string;
  values: readonly unknown[];
  filter: string;
  onFilter: (value: string) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const currentChoices = useMemo(() => {
    const counts = new Map<string, FilterChoice>();
    for (const rawValue of values) {
      const value = gridFilterValue(rawValue);
      const key = gridFilterValueKey(value);
      const current = counts.get(key);
      if (current) {
        current.count += 1;
      } else {
        counts.set(key, {
          key,
          value,
          label: value ?? "NULL",
          count: 1,
        });
      }
    }
    return [...counts.values()].sort((left, right) =>
      left.label.localeCompare(right.label, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [values]);
  // Applying a value filter replaces the page result with the selected subset. Keep
  // the popup's original value inventory while that filter is active so users can
  // add another value or see the original counts without clearing first.
  const choiceCache = useRef<FilterChoice[]>(currentChoices);
  if (!filter || choiceCache.current.length === 0) {
    choiceCache.current = currentChoices;
  }
  const choices = filter ? choiceCache.current : currentChoices;
  const selectedValues = decodeGridValueFilter(filter) ?? [];
  const selectedKeys = new Set(selectedValues.map(gridFilterValueKey));
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleChoices = normalizedSearch
    ? choices.filter((choice) =>
        choice.label.toLocaleLowerCase().includes(normalizedSearch),
      )
    : choices;
  const allSelected =
    choices.length > 0 && choices.every((choice) => selectedKeys.has(choice.key));

  function update(nextKeys: Set<string>) {
    onFilter(
      encodeGridValueFilter(
        choices
          .filter((choice) => nextKeys.has(choice.key))
          .map((choice) => choice.value),
      ),
    );
  }

  return (
    <span
      className="tw:inline-flex tw:shrink-0"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <ToolbarMenu
        label={t("grid.localFilterLabel", { col: column })}
        icon="filter"
        align="start"
        pressed={Boolean(filter)}
        triggerVariant="gridHeader"
      >
        <div className="tw:grid tw:w-56 tw:gap-1 tw:p-1">
          <div className="tw:px-1 tw:pt-1 tw:text-right tw:text-xs tw:font-semibold tw:text-muted-foreground">
            {t("grid.localFilterTitle", { col: column })}
          </div>
          <TextInput
            density="compact"
            autoFocus
            value={search}
            aria-label={t("grid.localFilterSearch", { col: column })}
            placeholder={t("grid.localFilterSearchPlaceholder")}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:border-b tw:border-border-subtle tw:px-1 tw:py-1 tw:text-xs tw:text-muted-foreground">
            <label className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() =>
                  update(
                    allSelected
                      ? new Set()
                      : new Set(choices.map((choice) => choice.key)),
                  )
                }
              />
              {t("grid.localFilterValue")}
            </label>
            <span>{t("grid.localFilterCount")}</span>
          </div>
          <div className="scrollbar-sleek tw:grid tw:max-h-64 tw:overflow-y-auto">
            {visibleChoices.map((choice) => (
              <label
                key={choice.key}
                className="tw:grid tw:min-w-0 tw:min-h-control-md tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-3 tw:rounded-sm tw:px-1 tw:text-sm tw:hover:bg-muted"
              >
                <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(choice.key)}
                    onChange={() => {
                      const next = new Set(selectedKeys);
                      if (next.has(choice.key)) next.delete(choice.key);
                      else next.add(choice.key);
                      update(next);
                    }}
                  />
                  <span
                    className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap"
                    title={choice.label}
                  >
                    {choice.label}
                  </span>
                </span>
                <span className="tw:text-xs tw:text-muted-foreground">
                  {choice.count}
                </span>
              </label>
            ))}
            {visibleChoices.length === 0 ? (
              <span className="tw:px-2 tw:py-4 tw:text-center tw:text-sm tw:text-muted-foreground">
                {t("grid.localFilterEmpty")}
              </span>
            ) : null}
          </div>
          {filter ? (
            <Button
              size="compact"
              onClick={() => onFilter("")}
            >
              {t("grid.localFilterClear")}
            </Button>
          ) : null}
        </div>
      </ToolbarMenu>
    </span>
  );
}
