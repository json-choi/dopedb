"use client";

// The render boundary for this app. It reports only that the page failed: the
// thrown error, its message, and its digest stay on the server.
import { ControlButton, ControlLink } from "./components/Controls";
import { StatusPage } from "./components/StatusPage";
import { useWorkspaceLocale } from "./components/WorkspaceLocale";
import { localizedWorkspacePath } from "../lib/workspace-locale";
import { workspaceMessages } from "../lib/workspace-messages";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].appError;
  return (
    <StatusPage
      title={copy.title}
      description={copy.description}
      actions={
        <>
          <ControlButton tone="primary" onClick={reset}>
            {copy.retry}
          </ControlButton>
          <ControlLink href={localizedWorkspacePath("/settings", locale)}>
            {copy.action}
          </ControlLink>
        </>
      }
    />
  );
}
