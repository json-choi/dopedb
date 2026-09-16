// Accumulates numeric-column observations within one result identity for consistent alignment.

import { useEffect, useMemo, useState } from "react";

import type { QueryResult } from "../../ipc/types";
import type { SqlStreamRowSource } from "../queries/domain";
import { dataGridSelectionResetIdentity } from "./useDataGridSelectionReset";

export type DataGridNumericColumnState = "unknown" | "numeric" | "text";

const DECIMAL_VALUE = /^-?\d+(\.\d+)?$/;

function valueIsNumeric(value: unknown) {
  return (
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && DECIMAL_VALUE.test(value))
  );
}

export function observeDataGridNumericColumns(
  columnCount: number,
  rows: readonly (readonly unknown[])[],
  observedColumns?: readonly number[],
): DataGridNumericColumnState[] {
  const states = Array<DataGridNumericColumnState>(columnCount).fill("unknown");
  const columns =
    observedColumns ?? Array.from({ length: columnCount }, (_, index) => index);
  for (const column of columns) {
    for (const row of rows) {
      const value = row[column];
      if (value === null || value === undefined) continue;
      if (!valueIsNumeric(value)) {
        states[column] = "text";
        break;
      }
      states[column] = "numeric";
    }
  }
  return states;
}

export function mergeDataGridNumericColumns(
  previous: readonly DataGridNumericColumnState[],
  observed: readonly DataGridNumericColumnState[],
) {
  return observed.map((state, index) => {
    const prior = previous[index] ?? "unknown";
    if (prior === "text" || state === "text") return "text";
    if (prior === "numeric" || state === "numeric") return "numeric";
    return "unknown";
  });
}

type ResultIdentity = ReturnType<typeof dataGridSelectionResetIdentity>;

export type DataGridNumericColumnAccumulator = {
  identity: ResultIdentity;
  states: DataGridNumericColumnState[];
};

function sameResultIdentity(left: ResultIdentity, right: ResultIdentity) {
  return (
    left.materializedResult === right.materializedResult &&
    left.operationId === right.operationId &&
    left.capability === right.capability &&
    left.columnKey === right.columnKey
  );
}

export function accumulateDataGridNumericColumns(
  previous: DataGridNumericColumnAccumulator,
  identity: ResultIdentity,
  observed: DataGridNumericColumnState[],
): DataGridNumericColumnAccumulator {
  if (!sameResultIdentity(previous.identity, identity)) {
    return { identity, states: observed };
  }
  const states = mergeDataGridNumericColumns(previous.states, observed);
  return states.every((state, index) => state === previous.states[index])
    ? previous
    : { identity, states };
}

export function useDataGridNumericColumns({
  result,
  rowSource,
  observedRows = [],
  observedColumns,
}: {
  result: QueryResult;
  rowSource?: SqlStreamRowSource;
  observedRows?: readonly (readonly unknown[])[];
  observedColumns?: readonly number[];
}) {
  const materializedObservation = useMemo(
    () => observeDataGridNumericColumns(result.columns.length, result.rows),
    [result],
  );
  const observed = rowSource
    ? observeDataGridNumericColumns(
        result.columns.length,
        observedRows,
        observedColumns,
      )
    : materializedObservation;
  const identity = dataGridSelectionResetIdentity(result, rowSource);
  const [accumulator, setAccumulator] =
    useState<DataGridNumericColumnAccumulator>(() => ({
      identity,
      states: observed,
    }));
  const current = accumulateDataGridNumericColumns(
    accumulator,
    identity,
    observed,
  );
  const {
    materializedResult,
    operationId,
    capability,
    columnKey,
  } = identity;
  const observationKey = observed.join("\u0000");

  useEffect(() => {
    const nextIdentity = {
      materializedResult,
      operationId,
      capability,
      columnKey,
    };
    const nextObserved = (
      observationKey ? observationKey.split("\u0000") : []
    ) as DataGridNumericColumnState[];
    setAccumulator((previous) =>
      accumulateDataGridNumericColumns(previous, nextIdentity, nextObserved),
    );
  }, [materializedResult, operationId, capability, columnKey, observationKey]);

  return current.states.map((state) => state === "numeric");
}
