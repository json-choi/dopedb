// Canonical sectioned dialog shared by Settings and Workspace management: a grouped
// section rail with optional search, a one-line section select at narrow widths, a
// "group › section" heading, the active section body and a Done footer. Callers own
// the entries, the active section and every body; this shell owns only layout, search
// filtering and the move to the first match when a search hides the active section.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { Button } from "./Button";
import { SelectInput } from "./FormControls";
import { ModalBackdrop, ModalFooter, ModalHeader, ModalSurface } from "./Modal";
import { TreeSearch } from "./TreeControls";

export interface SectionDialogGroup<GroupId extends string> {
  id: GroupId;
  label: string;
}

export interface SectionDialogEntry<Id extends string, GroupId extends string> {
  id: Id;
  label: string;
  group: GroupId;
  keywords?: string;
  disabled?: boolean;
  /** A short live state shown after the label, such as update progress. */
  status?: string | null;
}

export function SectionDialog<Id extends string, GroupId extends string>({
  title,
  titleId,
  groups,
  entries,
  active,
  onSelect,
  onClose,
  doneLabel,
  selectLabel,
  search,
  children,
}: {
  title: string;
  titleId: string;
  groups: readonly SectionDialogGroup<GroupId>[];
  entries: readonly SectionDialogEntry<Id, GroupId>[];
  active: Id;
  onSelect: (id: Id) => void;
  onClose: () => void;
  doneLabel: string;
  /** Accessible name of the section select shown at narrow widths. */
  selectLabel: string;
  search?: { placeholder: string; clearLabel: string; noResults: string };
  children: ReactNode;
}) {
  const [filter, setFilter] = useState("");
  const filteredEntries = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase().normalize("NFKC");
    if (!query) return entries;
    return entries.filter((entry) =>
      `${entry.label} ${entry.keywords ?? ""}`
        .toLocaleLowerCase()
        .normalize("NFKC")
        .includes(query),
    );
  }, [entries, filter]);

  useEffect(() => {
    if (!filter || filteredEntries.some((entry) => entry.id === active)) return;
    const next = filteredEntries.find((entry) => !entry.disabled);
    if (next) onSelect(next.id);
  }, [active, filter, filteredEntries, onSelect]);

  const activeEntry = entries.find((entry) => entry.id === active) ?? entries[0];
  const groupLabel = (id: GroupId | undefined) =>
    groups.find((group) => group.id === id)?.label ?? "";
  const visibleGroups = groups.filter((group) =>
    entries.some((entry) => entry.group === group.id),
  );

  return (
    <ModalBackdrop>
      <ModalSurface
        size="settings"
        aria-labelledby={titleId}
        onRequestClose={onClose}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            (event.target as HTMLElement).closest("input, textarea, select")
          ) {
            event.preventDefault();
          }
        }}
      >
        <div className="tw:flex tw:h-full tw:min-h-0 tw:flex-col tw:bg-background">
          <ModalHeader title={title} titleId={titleId} />

          <div className="tw:grid tw:min-h-0 tw:flex-1 tw:grid-cols-[202px_minmax(0,1fr)] tw:@max-[700px]:grid-cols-1">
            <aside className="tw:flex tw:min-h-0 tw:flex-col tw:border-r tw:border-border-subtle tw:bg-card tw:@max-[700px]:hidden">
              {search ? (
                <div className="tw:p-2">
                  <TreeSearch
                    value={filter}
                    autoFocus
                    placeholder={search.placeholder}
                    clearLabel={search.clearLabel}
                    onChange={setFilter}
                    onEscape={() => {
                      if (filter) setFilter("");
                      else onClose();
                    }}
                  />
                </div>
              ) : null}
              <nav
                data-searchable={search ? "true" : "false"}
                className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:data-[searchable=false]:pt-2"
              >
                {groups.map((group) => {
                  const groupEntries = filteredEntries.filter(
                    (entry) => entry.group === group.id,
                  );
                  if (groupEntries.length === 0) return null;
                  return (
                    <section key={group.id} className="tw:grid tw:gap-0.5 tw:pb-2">
                      <div className="tw:flex tw:min-h-[var(--ds-tree-row-height)] tw:items-center tw:gap-1 tw:px-2 tw:text-ui tw:font-semibold">
                        <Icon name="chevronDown" className="tw:text-muted-foreground" />
                        <span className="tw:min-w-0 tw:truncate" title={group.label}>
                          {group.label}
                        </span>
                      </div>
                      {groupEntries.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          data-active={active === entry.id}
                          aria-current={active === entry.id ? "page" : undefined}
                          className="tw:flex tw:min-h-[var(--ds-tree-row-height)] tw:cursor-pointer tw:items-center tw:justify-between tw:gap-2 tw:rounded-none tw:border-0 tw:bg-transparent tw:pr-3 tw:pl-12 tw:font-sans tw:text-left tw:text-ui tw:text-foreground tw:data-[active=true]:bg-selection tw:data-[active=true]:text-selection-foreground tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-inset tw:focus-visible:ring-ring tw:disabled:cursor-default tw:disabled:opacity-50 tw:not-disabled:hover:bg-muted"
                          onClick={() => onSelect(entry.id)}
                          disabled={entry.disabled}
                        >
                          <span className="tw:min-w-0 tw:truncate">{entry.label}</span>
                          {entry.status ? (
                            <span className="tw:shrink-0 tw:text-xs tw:text-muted-foreground">
                              {entry.status}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </section>
                  );
                })}
                {search && filteredEntries.length === 0 ? (
                  <p className="tw:m-0 tw:px-3 tw:py-4 tw:text-sm tw:text-muted-foreground">
                    {search.noResults}
                  </p>
                ) : null}
              </nav>
            </aside>

            <section className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-col">
              <div className="tw:hidden tw:h-title-toolbar tw:shrink-0 tw:items-center tw:border-b tw:border-border-subtle tw:bg-background tw:px-3 tw:@max-[700px]:flex">
                <SelectInput
                  density="compact"
                  aria-label={selectLabel}
                  value={active}
                  onChange={(event) => {
                    setFilter("");
                    onSelect(event.target.value as Id);
                  }}
                >
                  {visibleGroups.map((group) => (
                    <optgroup key={group.id} label={group.label}>
                      {entries
                        .filter((entry) => entry.group === group.id)
                        .map((entry) => (
                          <option key={entry.id} value={entry.id} disabled={entry.disabled}>
                            {entry.label}
                            {entry.status ? ` · ${entry.status}` : ""}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </SelectInput>
              </div>
              <div className="tw:flex tw:h-[42px] tw:min-h-[42px] tw:shrink-0 tw:items-center tw:gap-2 tw:bg-background tw:px-4 tw:text-ui tw:font-semibold tw:@max-[700px]:hidden">
                <span className="tw:min-w-0 tw:truncate tw:text-muted-foreground">
                  {groupLabel(activeEntry?.group)}
                </span>
                <Icon name="chevronRight" className="tw:shrink-0 tw:text-muted-foreground" />
                <span className="tw:min-w-0 tw:truncate">{activeEntry?.label}</span>
              </div>
              <div className="tw:min-h-0 tw:min-w-0 tw:flex-1 tw:overflow-auto tw:p-[var(--ds-pane-pad)] tw:[container-type:inline-size] tw:@max-[700px]:p-3">
                {children}
              </div>
            </section>
          </div>

          <ModalFooter>
            <Button size="compact" variant="primary" onClick={onClose}>
              {doneLabel}
            </Button>
          </ModalFooter>
        </div>
      </ModalSurface>
    </ModalBackdrop>
  );
}
