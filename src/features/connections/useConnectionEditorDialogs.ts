// Owns Connection editor dialog visibility and return-focus anchors without
// mixing provider/workspace modal state into profile or catalog controllers.
import { useRef, useState } from "react";

import type { ProviderKind } from "../providers/domain";

export function useConnectionEditorDialogs() {
  const [providerCredentialsOpen, setProviderCredentialsOpen] =
    useState<ProviderKind | "all" | null>(null);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const workspaceButtonRef = useRef<HTMLButtonElement | null>(null);
  const providerReturnFocusRef = useRef<HTMLElement | null>(null);

  function openProviderCredentials(
    provider?: ProviderKind,
    returnFocus?: HTMLElement | null,
  ) {
    providerReturnFocusRef.current =
      returnFocus ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setProviderCredentialsOpen(provider ?? "all");
  }

  return {
    problems: {
      open: problemsOpen,
      setOpen: setProblemsOpen,
    },
    providerCredentials: {
      open: providerCredentialsOpen,
      show: openProviderCredentials,
      close: () => setProviderCredentialsOpen(null),
      returnFocusRef: providerReturnFocusRef,
    },
    workspace: {
      open: workspaceDialogOpen,
      setOpen: setWorkspaceDialogOpen,
      buttonRef: workspaceButtonRef,
    },
  };
}

export type ConnectionEditorDialogs = ReturnType<
  typeof useConnectionEditorDialogs
>;
