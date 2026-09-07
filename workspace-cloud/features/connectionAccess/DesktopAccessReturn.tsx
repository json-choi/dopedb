"use client";

// Browser navigation after a real, target-matching save. The callback carries no
// credentials or authority; the Desktop's existing refresh owns permission checks.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ControlLink } from "../../app/components/Controls";
import { ConsoleNotice } from "../../app/components/Console";
import { useWorkspaceLocale } from "../../app/components/WorkspaceLocale";
import { workspaceMessages } from "../../lib/workspace-messages";
import {
  completeDesktopAccessReturn,
  desktopWorkspaceAccessCallbackUrl,
  readDesktopAccessReturn,
  saveDesktopAccessReturn,
  type DesktopAccessReturnIntent,
} from "../../lib/desktop-deep-link";

const ReturnContext = createContext({ connectionId: null as string | null, complete: (_connectionId: string) => {} });
export function useDesktopAccessReturn() { return useContext(ReturnContext); }

export function DesktopAccessReturn({
  userId, workspaceId, connectionId, fromDesktop, children,
}: {
  userId: string;
  workspaceId: string;
  connectionId: string | null;
  fromDesktop: boolean;
  children: ReactNode;
}) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].settings;
  const [intent, setIntent] = useState<DesktopAccessReturnIntent | null>(null);
  const opened = useRef<number | null>(null);
  const currentScope = useRef({ userId, workspaceId, active: true });
  useEffect(() => {
    currentScope.current = { userId, workspaceId, active: true };
    let next = readDesktopAccessReturn(window.sessionStorage, userId, workspaceId);
    if (fromDesktop && connectionId && new URL(window.location.href).searchParams.get("desktop") === "1") {
      next = { userId, workspaceId, connectionId, phase: "pending", createdAt: Date.now() };
      saveDesktopAccessReturn(window.sessionStorage, next);
      const url = new URL(window.location.href);
      url.searchParams.delete("desktop");
      window.history.replaceState(window.history.state, "", url);
    }
    setIntent(next);
    return () => { currentScope.current.active = false; };
  }, [userId, workspaceId, connectionId, fromDesktop]);

  useEffect(() => {
    if (!intent || intent.userId !== userId || intent.workspaceId !== workspaceId
      || intent.phase !== "complete" || opened.current === intent.createdAt) return;
    opened.current = intent.createdAt;
    const next = { ...intent, phase: "opened" as const };
    saveDesktopAccessReturn(window.sessionStorage, next);
    setIntent(next);
    // Browser refusal is recoverable through the visible link below.
    try { window.location.assign(desktopWorkspaceAccessCallbackUrl); } catch { /* Keep the return link. */ }
  }, [intent, userId, workspaceId]);

  const complete = useCallback((targetId: string) => {
    if (!currentScope.current.active || currentScope.current.userId !== userId
      || currentScope.current.workspaceId !== workspaceId) return;
    if (intent?.userId !== userId || intent.workspaceId !== workspaceId) return;
    const next = completeDesktopAccessReturn(intent, targetId);
    if (!next) return;
    saveDesktopAccessReturn(window.sessionStorage, next);
    setIntent(next);
  }, [intent, userId, workspaceId]);
  const active = intent?.userId === userId && intent.workspaceId === workspaceId ? intent : null;
  return (
    <ReturnContext value={{ connectionId: active?.connectionId ?? null, complete }}>
      {active ? (
        <ConsoleNotice>
          <span className="tw:block">{active.phase === "pending" ? copy.desktopReturnPending : copy.desktopReturnComplete}</span>
          <span className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-3">
            <ControlLink href={desktopWorkspaceAccessCallbackUrl}>{copy.desktopReturnAction}</ControlLink>
            <small>{copy.desktopReturnHint}</small>
          </span>
        </ConsoleNotice>
      ) : null}
      {children}
    </ReturnContext>
  );
}
