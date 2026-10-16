// Owns only the transient execution-scope chooser. Choices are pinned to an
// editor revision; selecting one delegates to the existing approval/parameter
// path. Preview decorations never change the user's real editor selection.
import { useEffect, useRef, useState, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { sqlRunChoices, type SqlRunChoice, type SqlRunSource } from "./editorStatus";

interface PendingChoice {
  version: number;
  choices: SqlRunChoice[];
  previewIndex: number;
  getAnchorRect: () => DOMRect;
}

export function useSqlRunChooser({
  draft,
  version,
  editorViewRef,
  onExecute,
}: {
  draft: string;
  version: number;
  editorViewRef: RefObject<EditorView | null>;
  onExecute: (source: SqlRunSource) => void;
}) {
  const [pending, setPending] = useState<PendingChoice | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const current = pending?.version === version ? pending : null;

  useEffect(() => setPending(null), [version]);

  function open() {
    const view = editorViewRef.current;
    // Never fall back to running the whole script while the editor is still
    // loading or its latest keystroke has not reached the controller yet.
    if (!view || view.state.doc.toString() !== draft) {
      return sqlRunChoices(draft, 0).length > 0;
    }
    const caret = view.state.selection.main.head;
    const choices = sqlRunChoices(draft, caret);
    if (choices.length === 0) return false;
    anchorRef.current = view.contentDOM;
    setPending({
      version,
      choices,
      previewIndex: 0,
      getAnchorRect: () => {
        const coords = view.coordsAtPos(Math.min(caret, view.state.doc.length));
        return coords
          ? new DOMRect(coords.left, coords.top, 1, coords.bottom - coords.top)
          : view.dom.getBoundingClientRect();
      },
    });
    return true;
  }

  function preview(index: number) {
    if (!current?.choices[index]) return;
    setPending({ ...current, previewIndex: index });
  }

  function confirm(index: number) {
    // The editor can change before React commits a new revision. Check its
    // live text as well, so even an already-queued old menu click cannot run.
    if (editorViewRef.current?.state.doc.toString() !== draft) {
      setPending(null);
      return;
    }
    const source = current?.choices[index]?.source;
    if (!source || draft.slice(source.from, source.to) !== source.sql) return;
    setPending(null);
    editorViewRef.current?.focus();
    onExecute(source);
  }

  return {
    current,
    anchorRef,
    previewSource: current?.choices[current.previewIndex]?.source ?? null,
    open,
    preview,
    confirm,
    close: () => setPending(null),
  };
}
