import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Icon, type IconName } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { CommandMenuItem } from "../../design-system/components/CommandMenu";
import { useModalBehavior } from "../../design-system/components/Modal";
import { useI18n } from "../../lib/i18n";
import {
  indexActionSearchItems,
  searchActionItems,
  type ActionSearchItem,
  type ActionSearchKind,
} from "./domain";

const kindIcon: Record<ActionSearchKind, IconName> = {
  action: "target",
  connection: "database",
  document: "list",
  databaseObject: "table",
  setting: "gear",
};

const kindLabelKey: Record<
  ActionSearchKind,
  | "ide.search.category.action"
  | "ide.search.category.connection"
  | "ide.search.category.document"
  | "ide.search.category.databaseObject"
  | "ide.search.category.setting"
> = {
  action: "ide.search.category.action",
  connection: "ide.search.category.connection",
  document: "ide.search.category.document",
  databaseObject: "ide.search.category.databaseObject",
  setting: "ide.search.category.setting",
};

type ActionSearchScope =
  | "all"
  | "database"
  | "document"
  | "action"
  | "setting";

const searchScopeTabs = [
  { id: "all", labelKey: "ide.search.scope.all" },
  { id: "database", labelKey: "ide.search.scope.database" },
  { id: "document", labelKey: "ide.search.scope.document" },
  { id: "action", labelKey: "ide.search.scope.action" },
  { id: "setting", labelKey: "ide.search.scope.setting" },
] as const satisfies ReadonlyArray<{
  id: ActionSearchScope;
  labelKey:
    | "ide.search.scope.all"
    | "ide.search.scope.database"
    | "ide.search.scope.document"
    | "ide.search.scope.action"
  | "ide.search.scope.setting";
}>;

export type ActionSearchCloseReason = "dismiss" | "selection";

function belongsToScope(
  kind: ActionSearchKind,
  scope: ActionSearchScope,
) {
  if (scope === "all") return true;
  if (scope === "database") {
    return kind === "connection" || kind === "databaseObject";
  }
  return kind === scope;
}

export default function ActionSearch({
  items,
  onClose,
}: {
  items: readonly ActionSearchItem[];
  onClose: (reason: ActionSearchCloseReason) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ActionSearchScope>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  useModalBehavior({
    surfaceRef,
    onRequestClose: () => onClose("dismiss"),
    restoreFocus: false,
  });
  const index = useMemo(
    () => indexActionSearchItems(items),
    [items],
  );
  const scopedIndex = useMemo(
    () =>
      scope === "all"
        ? index
        : index.filter(({ item }) =>
            belongsToScope(item.kind, scope),
          ),
    [index, scope],
  );
  const actionIndex = useMemo(
    () => index.filter(({ item }) => item.kind === "action"),
    [index],
  );
  const trimmedQuery = query.trimStart();
  const commandMode = trimmedQuery.startsWith("/");
  const hasQuery = trimmedQuery.length > 0;
  const searchableQuery = commandMode
    ? trimmedQuery.slice(1)
    : query;
  const visibleItems = useMemo(
    () =>
      hasQuery
        ? searchActionItems(
            commandMode ? actionIndex : scopedIndex,
            searchableQuery,
            12,
          )
        : [],
    [
      actionIndex,
      commandMode,
      hasQuery,
      scopedIndex,
      searchableQuery,
    ],
  );

  useEffect(() => {
    setActiveIndex((current) =>
      Math.min(current, Math.max(0, visibleItems.length - 1)),
    );
  }, [visibleItems.length]);

  async function choose(item: ActionSearchItem) {
    if (item.disabled) return;
    onClose("selection");
    await item.run();
  }

  function closeAndRestoreFocus() {
    onClose("dismiss");
  }

  function selectScope(nextScope: ActionSearchScope) {
    setScope(nextScope);
    setActiveIndex(0);
  }

  function moveScope(
    event: KeyboardEvent<HTMLButtonElement>,
    tabIndex: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (tabIndex + 1) % searchScopeTabs.length;
    } else if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowUp"
    ) {
      nextIndex =
        (tabIndex - 1 + searchScopeTabs.length) %
        searchScopeTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = searchScopeTabs.length - 1;
    }
    if (nextIndex === null) return;
    const nextTab = searchScopeTabs[nextIndex];
    if (!nextTab) return;
    event.preventDefault();
    selectScope(nextTab.id);
    const tabs =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]',
      );
    window.requestAnimationFrame(() => tabs?.[nextIndex]?.focus());
  }

  return createPortal(
    <div
      className="tw:fixed tw:inset-0 tw:z-[var(--ds-z-modal)] tw:flex tw:items-start tw:justify-center tw:bg-transparent tw:px-4 tw:pt-[clamp(48px,20.45dvh,190px)] tw:pb-6"
      role="presentation"
      onMouseDown={closeAndRestoreFocus}
    >
      <section
        ref={surfaceRef}
        className="tw:flex tw:max-h-full tw:w-[min(672px,100%)] tw:flex-col tw:overflow-hidden tw:rounded-md tw:border tw:border-border-strong tw:bg-popover tw:text-popover-foreground tw:shadow-popover"
        role="dialog"
        aria-modal="true"
        aria-label={t("ide.action.actionSearch")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          className="tw:flex tw:min-h-10 tw:shrink-0 tw:items-center tw:gap-1 tw:overflow-x-auto tw:px-2 tw:pt-2"
          role="tablist"
          aria-label={t("ide.search.scopes")}
        >
          {searchScopeTabs.map((tab, tabIndex) => (
            <Button
              key={tab.id}
              size="xs"
              variant={scope === tab.id ? "selected" : "ghost"}
              role="tab"
              aria-selected={scope === tab.id}
              tabIndex={scope === tab.id ? 0 : -1}
              onClick={() => {
                selectScope(tab.id);
                window.requestAnimationFrame(() =>
                  inputRef.current?.focus(),
                );
              }}
              onKeyDown={(event) => moveScope(event, tabIndex)}
            >
              {t(tab.labelKey)}
            </Button>
          ))}
        </div>

        <div className="tw:shrink-0 tw:p-1.5">
          <div className="tw:flex tw:h-control-md tw:items-center tw:gap-2 tw:rounded-none tw:border tw:border-input tw:bg-background tw:px-2 tw:shadow-control tw:focus-within:border-ring tw:focus-within:ring-2 tw:focus-within:ring-ring/30">
            <Icon
              name="search"
              className="tw:shrink-0 tw:text-muted-foreground"
            />
            <input
              ref={inputRef}
              data-modal-initial-focus
              type="search"
              value={query}
              className="tw:h-full tw:min-w-0 tw:flex-1 tw:border-0 tw:bg-transparent tw:font-sans tw:text-sm tw:text-foreground tw:outline-none tw:placeholder:text-muted-foreground"
              placeholder={t("ide.search.placeholder")}
              aria-controls={
                hasQuery ? "search-everywhere-results" : undefined
              }
              aria-expanded={hasQuery}
              aria-activedescendant={
                visibleItems[activeIndex]
                  ? `search-everywhere-${visibleItems[activeIndex].id}`
                  : undefined
              }
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "ArrowDown" &&
                  visibleItems.length > 0
                ) {
                  event.preventDefault();
                  setActiveIndex((current) =>
                    Math.min(
                      visibleItems.length - 1,
                      current + 1,
                    ),
                  );
                } else if (
                  event.key === "ArrowUp" &&
                  visibleItems.length > 0
                ) {
                  event.preventDefault();
                  setActiveIndex((current) =>
                    Math.max(0, current - 1),
                  );
                } else if (event.key === "Enter") {
                  const active = visibleItems[activeIndex];
                  if (active) {
                    event.preventDefault();
                    void choose(active);
                  }
                }
              }}
            />
          </div>
        </div>

        {hasQuery ? (
          <div
            id="search-everywhere-results"
            className="tw:min-h-0 tw:max-h-[480px] tw:flex-1 tw:overflow-y-auto tw:border-t tw:border-border-subtle tw:p-1.5"
            role="listbox"
            aria-label={t("ide.search.results")}
          >
            {visibleItems.map((item, itemIndex) => (
              <CommandMenuItem
                id={`search-everywhere-${item.id}`}
                key={item.id}
                role="option"
                aria-label={[
                  item.label,
                  t(kindLabelKey[item.kind]),
                  item.detail,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                aria-selected={itemIndex === activeIndex}
                disabled={item.disabled}
                leading={
                  <Icon
                    name={kindIcon[item.kind]}
                    className="tw:text-muted-foreground"
                  />
                }
                trailing={
                  item.shortcut ? (
                    <kbd className="tw:rounded-xs tw:border tw:border-border-subtle tw:bg-background tw:px-1.5 tw:py-1 tw:font-mono tw:text-2xs tw:text-muted-foreground">
                      {item.shortcut}
                    </kbd>
                  ) : undefined
                }
                onMouseEnter={() => setActiveIndex(itemIndex)}
                onClick={() => void choose(item)}
              >
                <strong className="tw:font-medium">{item.label}</strong>
                <small className="tw:ml-2 tw:text-2xs tw:text-muted-foreground">
                  {t(kindLabelKey[item.kind])}
                  {item.detail ? ` · ${item.detail}` : ""}
                </small>
              </CommandMenuItem>
            ))}
            {visibleItems.length === 0 ? (
              <div className="tw:grid tw:min-h-24 tw:place-items-center tw:p-6 tw:text-sm tw:text-muted-foreground">
                {t("ide.search.empty")}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
