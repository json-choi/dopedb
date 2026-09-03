// Fast client-side guidance shown before the authoritative backend classifier runs.
// These signals never grant execution; they only explain obvious risk shapes early.

import type { SafetySettings } from "../../ipc/types";
import type { I18nKey } from "../../lib/i18n";

export interface RunSignal {
  tone: "muted" | "warning" | "danger";
  text: string;
  title?: string;
  icon?: "alert" | "info";
}

interface RunSignalMessage {
  key: I18nKey;
  vars?: Record<string, string | number>;
}

export interface RunSignalAnalysis {
  tone: RunSignal["tone"];
  icon?: RunSignal["icon"];
  text: RunSignalMessage;
  title?: RunSignalMessage;
}

export type RunSignalSafety = Pick<
  SafetySettings,
  "allowWrites" | "allowSchemaChanges" | "maxRows"
>;

type Translate = (
  key: I18nKey,
  vars?: Record<string, string | number>,
) => string;

function compactSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function likelyChangesSchema(sql: string): boolean {
  const compact = compactSql(sql);
  return /^(create|alter|drop|truncate|comment|reindex)\b/i.test(compact)
    || /^select\b.*\binto\b/i.test(compact);
}

function likelyMutates(sql: string): boolean {
  return likelyChangesSchema(sql) || /^(insert|update|delete|merge|replace|grant|revoke|vacuum|analyze|call|execute)\b/i.test(
    compactSql(sql),
  );
}

function likelyRead(sql: string): boolean {
  return /^(select|with|show|describe|desc|explain)\b/i.test(compactSql(sql));
}

function lacksWhereOnBulkMutation(sql: string): boolean {
  const compact = compactSql(sql);
  return /^(update|delete)\b/i.test(compact) && !/\bwhere\b/i.test(compact);
}

function likelyHeavyRead(sql: string): boolean {
  const compact = compactSql(sql);
  return likelyRead(compact) && /\b(cross\s+join|generate_series)\b/i.test(compact);
}

function likelyUnboundedRead(sql: string): boolean {
  const compact = compactSql(sql);
  return likelyRead(compact) && !/\blimit\s+\d+\b/i.test(compact);
}

export function analyzeRunSignal(
  sql: string,
  statements: string[],
  safety: RunSignalSafety,
): RunSignalAnalysis | null {
  if (!sql.trim()) return null;
  const effectiveStatements = statements.length > 0 ? statements : [sql];
  const writes = effectiveStatements.some(likelyMutates);
  const changesSchema = effectiveStatements.some(likelyChangesSchema);

  if (effectiveStatements.length > 1) {
    if (changesSchema && !safety.allowSchemaChanges) {
      return {
        tone: "danger",
        icon: "alert",
        text: { key: "sql.signalSchemaDisabled" },
        title: { key: "sql.schemaDisabledScript" },
      };
    }
    if (writes && !safety.allowWrites) {
      return {
        tone: "danger",
        icon: "alert",
        text: { key: "sql.signalWritesDisabled" },
        title: { key: "sql.writesDisabledScript" },
      };
    }
    if (effectiveStatements.length >= 12) {
      return {
        tone: "warning",
        icon: "alert",
        text: {
          key: "sql.signalLargeScript",
          vars: { count: effectiveStatements.length },
        },
        title: { key: "sql.scriptNote" },
      };
    }
    if (writes) {
      return {
        tone: "warning",
        icon: "alert",
        text: { key: "sql.signalWriteScript" },
        title: { key: "sql.scriptNote" },
      };
    }
    return {
      tone: "muted",
      icon: "info",
      text: {
        key: "sql.signalReadScript",
        vars: { count: effectiveStatements.length },
      },
    };
  }

  const statement = effectiveStatements[0] ?? sql;
  if (lacksWhereOnBulkMutation(statement)) {
    return {
      tone: "warning",
      icon: "alert",
      text: { key: "sql.signalNoWhere" },
    };
  }
  if (/^explain\s+analyze\b/i.test(compactSql(statement))) {
    return {
      tone: "warning",
      icon: "alert",
      text: { key: "sql.signalExplainAnalyze" },
    };
  }
  if (likelyMutates(statement)) {
    if (likelyChangesSchema(statement) && !safety.allowSchemaChanges) {
      return {
        tone: "danger",
        icon: "alert",
        text: { key: "sql.signalSchemaDisabled" },
      };
    }
    if (!safety.allowWrites) {
      return {
        tone: "danger",
        icon: "alert",
        text: { key: "sql.signalWritesDisabled" },
      };
    }
    return {
      tone: "warning",
      icon: "alert",
      text: { key: "sql.signalWriteStatement" },
    };
  }
  if (likelyHeavyRead(statement)) {
    return {
      tone: "warning",
      icon: "alert",
      text: { key: "sql.signalHeavyRead" },
    };
  }
  if (likelyUnboundedRead(statement)) {
    return {
      tone: "muted",
      icon: "info",
      text: {
        key: "sql.signalReadCap",
        vars: { count: safety.maxRows },
      },
    };
  }
  return null;
}

export function localizeRunSignal(
  analysis: RunSignalAnalysis | null,
  t: Translate,
): RunSignal | null {
  if (!analysis) return null;
  return {
    tone: analysis.tone,
    icon: analysis.icon,
    text: t(analysis.text.key, analysis.text.vars),
    title: analysis.title
      ? t(analysis.title.key, analysis.title.vars)
      : undefined,
  };
}
