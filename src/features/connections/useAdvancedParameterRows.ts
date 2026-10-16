// Owns the Connection editor's free-form driver parameter rows. Each row keeps a
// stable id across key edits and moves, while the profile draft receives only the
// effective parameter map: blank and reserved keys never reach it, and the rows
// rebuild only when something outside them replaces those parameters.
import { useEffect, useRef, useState, type SetStateAction } from "react";

import { isIntrospectionParameter } from "../catalogExplorer/scopeFilter";
import { CONTROLLED_CONNECTION_PARAMETERS } from "./connectionEditorModel";
import type { ConnectionProfile } from "./domain";

/** One editable free-form driver parameter. Its id survives key edits and moves. */
export type AdvancedParameterRow = Readonly<{
  id: number;
  key: string;
  value: string;
}>;

export type AdvancedParameterIssue = "reserved" | "duplicate";

function isFreeFormParameter(key: string): boolean {
  return !isIntrospectionParameter(key) &&
    !CONTROLLED_CONNECTION_PARAMETERS.has(key);
}

function freeFormParameters(
  extraParams: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(extraParams).filter(([key]) => isFreeFormParameter(key)),
  );
}

/** Blank and reserved keys contribute nothing; a later duplicate key wins. */
function rowParameters(
  rows: readonly AdvancedParameterRow[],
): Record<string, string> {
  const parameters: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim() && isFreeFormParameter(row.key)) {
      parameters[row.key] = row.value;
    }
  }
  return parameters;
}

function sameParameters(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every((key) => key in right && right[key] === left[key]);
}

export function useAdvancedParameterRows(
  extraParams: Readonly<Record<string, string>>,
  setFormValue: (value: SetStateAction<ConnectionProfile>) => void,
) {
  const nextRowId = useRef(0);
  const [rows, setRows] = useState<AdvancedParameterRow[]>(() =>
    Object.entries(freeFormParameters(extraParams)).map(
      ([key, value]) => ({ id: ++nextRowId.current, key, value }),
    ),
  );

  // URL import, source switches, and saves replace free-form parameters outside
  // the rows. Rebuild the rows only then, keeping ids for keys that survive.
  useEffect(() => {
    const external = freeFormParameters(extraParams);
    if (sameParameters(rowParameters(rows), external)) return;
    const idsByKey = new Map(
      rows
        .filter((row) => row.key.trim())
        .map((row) => [row.key, row.id] as const),
    );
    setRows(
      Object.entries(external).map(([key, value]) => ({
        id: idsByKey.get(key) ?? ++nextRowId.current,
        key,
        value,
      })),
    );
  }, [rows, extraParams]);

  /** Rows own free-form parameters; the profile receives only their effective map. */
  function commit(next: AdvancedParameterRow[]) {
    setRows(next);
    setFormValue((current) => ({
      ...current,
      extraParams: {
        ...Object.fromEntries(
          Object.entries(current.extraParams).filter(
            ([key]) => !isFreeFormParameter(key),
          ),
        ),
        ...rowParameters(next),
      },
    }));
  }

  /** Edits rename in place, so focus and row order survive every keystroke. */
  function update(id: number, key: string, value: string) {
    commit(rows.map((row) => (row.id === id ? { id, key, value } : row)));
  }

  function add() {
    const used = new Set([
      ...rows.map((row) => row.key),
      ...Object.keys(extraParams),
    ]);
    let suffix = 1;
    let key = "parameter";
    while (used.has(key)) {
      suffix += 1;
      key = `parameter${suffix}`;
    }
    commit([...rows, { id: ++nextRowId.current, key, value: "" }]);
  }

  function remove(id: number) {
    commit(rows.filter((row) => row.id !== id));
  }

  function issue(row: AdvancedParameterRow): AdvancedParameterIssue | null {
    if (!row.key.trim()) return null;
    if (!isFreeFormParameter(row.key)) return "reserved";
    return rows.some(
      (candidate) => candidate.id !== row.id && candidate.key === row.key,
    )
      ? "duplicate"
      : null;
  }

  return { rows, update, add, remove, issue };
}
