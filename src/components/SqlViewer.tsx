// CodeMirror 6 SQL viewer/editor, shared by read-only SQL surfaces and the SQL
// screen. Read-only by default; when a `catalog` is passed it feeds schema-aware
// autocomplete (table + column names), and `onRun` binds Mod-Enter to execute.
// The editor reports its selection (so toolbar Run can run exactly it), carries an
// accessible name, and underlines the range a failed run points at.
import { useCallback, useMemo } from "react";
import { useTheme } from "../design-system/theme";
import CodeMirror from "@uiw/react-codemirror";
import {
  MySQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  keywordCompletionSource,
  schemaCompletionSource,
  sql,
  type SQLDialect,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import {
  autocompletion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { Prec, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  WidgetType,
  type ViewUpdate,
} from "@codemirror/view";
import type { Catalog } from "../ipc/types";
import type { ConnectionEngine } from "../features/connections/domain";
import {
  SQL_EDITOR_INDENT_SIZE,
  sqlExecutionMarkerPosition,
  sqlRunSourceFromSelection,
  type SqlCursorPosition,
  type SqlExecutionStatus,
  type SqlRunSource,
} from "../features/queries/editorStatus";
import {
  DEFAULT_SQL_RESOLVE_MODE,
  resolveSqlNamespaceAtCaret,
  type SqlResolveMode,
} from "../features/queries/resolveMode";

const SQL_RICH_EDITING_MAX_BYTES = 256 * 1024;

// Catalog → CodeMirror schema map. Namespaced tables stay below their schema so
// `defaultSchema` controls which ones complete as bare names. Registering every
// PostgreSQL table at the root would leak candidates from unrelated schemas.
function buildSchema(catalog: Catalog): SQLNamespace {
  const ns: Record<string, SQLNamespace> = {};
  for (const t of catalog.tables) {
    const cols = t.columns.map((c) => c.name);
    if (t.schema) {
      const s = (ns[t.schema] ??= {}) as Record<string, SQLNamespace>;
      s[t.name] = cols;
    } else {
      ns[t.name] = cols;
    }
  }
  return ns;
}

function editorDialect(engine: ConnectionEngine | undefined): SQLDialect {
  if (engine === "postgres") return PostgreSQL;
  if (engine === "mysql") return MySQL;
  if (engine === "sqlite") return SQLite;
  return StandardSQL;
}

export interface SqlViewerProps {
  value: string;
  editable?: boolean;
  onChange?: (v: string) => void;
  onRun?: (source?: SqlRunSource) => void;
  catalog?: Catalog;
  engine?: ConnectionEngine;
  resolveMode?: SqlResolveMode;
  defaultSchema?: string;
  namespaceOptions?: readonly string[];
  minHeight?: string;
  onCursorChange?: (position: SqlCursorPosition) => void;
  onBlur?: () => void;
  executionStatus?: SqlExecutionStatus | null;
  /** Receives the production CodeMirror view for deterministic packaged profiling. */
  onEditorReady?: (view: EditorView) => void;
  /** The current non-empty selection, or undefined when the selection is empty. */
  onSelectionChange?: (source: SqlRunSource | undefined) => void;
  /** Accessible name of the editing surface. */
  ariaLabel?: string;
  /** Document range a failed run points at; underlined until the text changes. */
  errorRange?: { from: number; to: number } | null;
}

function cursorPosition(state: EditorState): SqlCursorPosition {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return {
    line: line.number,
    column: head - line.from + 1,
  };
}

function selectedRunSource(state: EditorState): SqlRunSource | undefined {
  const { from, to, empty } = state.selection.main;
  // A caret move must not copy the whole document; slice only a real selection.
  if (empty) return undefined;
  const source = sqlRunSourceFromSelection(state.sliceDoc(from, to), 0, to - from);
  return source && { ...source, from: source.from + from, to: source.to + from };
}

class SqlExecutionWidget extends WidgetType {
  constructor(private readonly status: SqlExecutionStatus) {
    super();
  }

  eq(other: SqlExecutionWidget): boolean {
    return (
      this.status.state === other.status.state &&
      this.status.label === other.status.label
    );
  }

  toDOM(): HTMLElement {
    const root = document.createElement("span");
    root.dataset.state = this.status.state;
    root.className =
      "tw:ml-3 tw:inline-flex tw:select-none tw:items-center tw:gap-1.5 tw:font-sans tw:text-xs tw:text-muted-foreground tw:data-[state=completed]:text-success tw:data-[state=failed]:text-danger tw:data-[state=waiting]:text-warning";
    root.title = this.status.label;
    // Keep the decoration non-editable; Services owns its accessible status.
    root.setAttribute("aria-hidden", "true");
    root.contentEditable = "false";

    const mark = document.createElement("span");
    mark.className = "tw:font-bold";
    mark.textContent =
      this.status.state === "completed"
        ? "✓"
        : this.status.state === "failed"
          ? "!"
          : this.status.state === "cancelled"
            ? "■"
            : "●";

    const label = document.createElement("span");
    label.textContent = this.status.label;
    root.append(mark, label);
    return root;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function errorRangeExtension(
  length: number,
  range: { from: number; to: number } | null | undefined,
): Extension {
  if (!range) return [];
  const from = Math.max(0, Math.min(range.from, length));
  const to = Math.max(from, Math.min(range.to, length));
  if (to === from) return [];
  return EditorView.decorations.of(
    Decoration.set([
      Decoration.mark({
        class:
          "tw:underline tw:decoration-wavy tw:decoration-danger tw:underline-offset-4",
        attributes: { "data-sql-error": "true" },
      }).range(from, to),
    ]),
  );
}

function executionStatusExtension(
  value: string,
  status: SqlExecutionStatus | null | undefined,
): Extension {
  if (!status) return [];
  const markerPosition = sqlExecutionMarkerPosition(value, status);
  if (markerPosition === null) return [];
  return EditorView.decorations.of(
    Decoration.set([
      Decoration.widget({
        widget: new SqlExecutionWidget(status),
        side: 1,
      }).range(markerPosition),
    ]),
  );
}

export default function SqlViewer({
  value,
  editable = false,
  onChange,
  onRun,
  catalog,
  engine,
  resolveMode = DEFAULT_SQL_RESOLVE_MODE,
  defaultSchema,
  namespaceOptions = [],
  minHeight = "80px",
  onCursorChange,
  onBlur,
  executionStatus,
  onEditorReady,
  onSelectionChange,
  ariaLabel,
  errorRange,
}: SqlViewerProps) {
  const { resolved: colorScheme } = useTheme();
  const richLanguageEditing = value.length <= SQL_RICH_EDITING_MAX_BYTES;
  const extensions = useMemo(() => {
    const dialect = editorDialect(engine);
    // Lezer syntax trees, schema completion, and wrapped-line layout scale with
    // the whole document. Keep the large-file path responsive and bounded while
    // preserving editing, cursor movement, execution, and worker-based format.
    const ext: Extension[] = richLanguageEditing
      ? [sql({ dialect }), EditorView.lineWrapping]
      : [];
    if (catalog && richLanguageEditing) {
      const schema = buildSchema(catalog);
      const schemaCompletion: CompletionSource = (context) => {
        const resolvedDefaultSchema = defaultSchema
          ? resolveSqlNamespaceAtCaret({
              sqlBeforeCaret: context.state.sliceDoc(0, context.pos),
              engine: engine ?? "sqlite",
              mode: resolveMode,
              selectedNamespace: defaultSchema,
              namespaceOptions,
            })
          : undefined;
        return schemaCompletionSource({
          dialect,
          schema,
          defaultSchema: resolvedDefaultSchema,
        })(context);
      };
      ext.push(
        autocompletion({
          override: [
            schemaCompletion,
            keywordCompletionSource(dialect, true),
          ],
        }),
      );
    }
    if (onRun) {
      ext.push(
        Prec.highest(
          keymap.of([
            {
              key: "Mod-Enter",
              run: (view) => {
                // Run just the selection when there is one; otherwise the whole draft.
                onRun(selectedRunSource(view.state));
                return true;
              },
            },
          ]),
        ),
      );
    }
    if (onBlur) {
      ext.push(
        EditorView.domEventHandlers({
          blur: () => {
            onBlur();
            return false;
          },
        }),
      );
    }
    if (ariaLabel) {
      ext.push(EditorView.contentAttributes.of({ "aria-label": ariaLabel }));
    }
    return ext;
  }, [
    ariaLabel,
    catalog,
    defaultSchema,
    engine,
    namespaceOptions,
    onBlur,
    onRun,
    richLanguageEditing,
    resolveMode,
  ]);
  const reportCursor = useCallback(
    (state: EditorState) => {
      onCursorChange?.(cursorPosition(state));
    },
    [onCursorChange],
  );
  const handleCreateEditor = useCallback(
    (view: EditorView) => {
      reportCursor(view.state);
      onSelectionChange?.(selectedRunSource(view.state));
      onEditorReady?.(view);
    },
    [onEditorReady, onSelectionChange, reportCursor],
  );
  const handleUpdate = useCallback(
    (update: ViewUpdate) => {
      if (!update.selectionSet && !update.docChanged) return;
      if (onCursorChange && update.selectionSet) reportCursor(update.state);
      onSelectionChange?.(selectedRunSource(update.state));
    },
    [onCursorChange, onSelectionChange, reportCursor],
  );
  const executionValue = executionStatus ? value : "";
  const executionExtension = useMemo(
    () => executionStatusExtension(executionValue, executionStatus),
    [executionStatus, executionValue],
  );
  const errorExtension = useMemo(
    () => errorRangeExtension(value.length, errorRange),
    [errorRange, value.length],
  );
  const allExtensions = useMemo(
    () => [...extensions, executionExtension, errorExtension],
    [errorExtension, executionExtension, extensions],
  );

  return (
    <CodeMirror
      value={value}
      theme={colorScheme}
      editable={editable}
      readOnly={!editable}
      onChange={onChange}
      onCreateEditor={handleCreateEditor}
      onUpdate={handleUpdate}
      extensions={allExtensions}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        tabSize: SQL_EDITOR_INDENT_SIZE,
      }}
      className="dopedb-sql-viewer tw:text-ui"
      style={{ minHeight }}
    />
  );
}
