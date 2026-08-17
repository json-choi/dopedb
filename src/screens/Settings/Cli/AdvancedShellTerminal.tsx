// Explicit developer-only Shell Terminal. It opens one ephemeral PTY pinned by the
// backend to the selected connection; ACP Agent sessions remain a separate surface.
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { Icon } from "../../../components/Icon";
import { Button } from "../../../design-system/components/Button";
import {
  ModalBackdrop,
  ModalFooter,
  ModalSurface,
  ModalTitleBar,
} from "../../../design-system/components/Modal";
import {
  InlineNotice,
  StatusBadge,
} from "../../../design-system/components/Status";
import type { ConnectionProfile } from "../../../features/connections/domain";
import PtySurface, {
  type PtyOutputWriter,
} from "../../../features/terminals/PtySurface";
import type {
  TerminalOutputChunk,
  TerminalSessionSummary,
  TerminalStateEvent,
} from "../../../features/terminals/domain";
import {
  closeShellTerminal,
  createShellTerminal,
  resizeShellTerminal,
  terminalOutputChannel,
  writeShellTerminal,
} from "../../../features/terminals/tauriAdapter";
import { errMessage } from "../../../ipc/types";
import { useI18n } from "../../../lib/i18n";
import { useCatalogScope } from "../../../lib/queries";

const BUFFER_LIMIT_BYTES = 512 * 1024;

function lifecycleLabel(
  lifecycle: TerminalSessionSummary["lifecycle"],
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (lifecycle) {
    case "starting":
      return t("terminal.lifecycleStarting");
    case "running":
      return t("terminal.lifecycleRunning");
    case "stopping":
      return t("terminal.lifecycleStopping");
    case "exited":
      return t("terminal.lifecycleExited");
    case "failed":
      return t("terminal.lifecycleFailed");
  }
}

export function AdvancedShellTerminalLauncher({
  connection,
}: {
  connection: ConnectionProfile | null;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <section className="tw:mt-6 tw:grid tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-4">
      <div className="tw:flex tw:items-start tw:gap-3">
        <Icon name="terminal" className="tw:mt-0.5 tw:shrink-0 tw:text-muted-foreground" />
        <div className="tw:min-w-0 tw:flex-1">
          <h3 className="tw:m-0 tw:text-sm tw:font-semibold">
            {t("terminal.title")}
          </h3>
          <p className="tw:mt-1 tw:mb-0 tw:max-w-[620px] tw:text-sm tw:leading-body tw:text-muted-foreground">
            {t("terminal.description")}
          </p>
        </div>
      </div>
      <div className="ds-control-row">
        <Button
          disabled={!connection}
          onClick={() => setOpen(true)}
        >
          {t("terminal.open")}
        </Button>
        {!connection ? (
          <span className="tw:text-sm tw:text-muted-foreground">
            {t("terminal.noConnection")}
          </span>
        ) : null}
      </div>
      {open && connection ? (
        <AdvancedShellTerminalDialog
          connection={connection}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

function AdvancedShellTerminalDialog({
  connection,
  onClose,
}: {
  connection: ConnectionProfile;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const catalogScope = useCatalogScope();
  const [session, setSession] = useState<TerminalSessionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const sessionRef = useRef<TerminalSessionSummary | null>(null);
  const writerRef = useRef<PtyOutputWriter | null>(null);
  const bufferedRef = useRef<TerminalOutputChunk[]>([]);
  const bufferedBytesRef = useRef(0);

  const routeOutput = useCallback((chunk: TerminalOutputChunk) => {
    const active = sessionRef.current;
    if (active && chunk.sessionId !== active.id) return;
    if (writerRef.current) {
      writerRef.current(chunk);
      return;
    }
    bufferedRef.current.push(chunk);
    bufferedBytesRef.current += chunk.bytes.length;
    while (
      bufferedBytesRef.current > BUFFER_LIMIT_BYTES &&
      bufferedRef.current.length > 0
    ) {
      const dropped = bufferedRef.current.shift();
      bufferedBytesRef.current -= dropped?.bytes.length ?? 0;
    }
  }, []);

  const registerOutput = useCallback(
    (_id: TerminalSessionSummary["id"], writer: PtyOutputWriter | null) => {
      writerRef.current = writer;
      if (!writer) return;
      for (const chunk of bufferedRef.current) writer(chunk);
      bufferedRef.current = [];
      bufferedBytesRef.current = 0;
    },
    [],
  );

  useEffect(() => {
    if (!catalogScope.ready || !catalogScope.workspaceId) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const expectedWorkspaceId = catalogScope.workspaceId;
    const channel = terminalOutputChannel(routeOutput);

    void (async () => {
      try {
        unlisten = await listen<TerminalStateEvent>(
          "terminal:state",
          (event) => {
            if (
              disposed ||
              event.payload.session.id !== sessionRef.current?.id
            ) {
              return;
            }
            sessionRef.current = event.payload.session;
            setSession(event.payload.session);
          },
        );
        if (disposed) {
          unlisten();
          unlisten = null;
          return;
        }
        const created = await createShellTerminal(
          {
            connectionId: connection.id,
            profile: "shell",
            size: {
              cols: 100,
              rows: 30,
              pixelWidth: 0,
              pixelHeight: 0,
            },
          },
          channel,
        );
        const exactPin =
          created.connection.connectionId === connection.id &&
          created.connection.workspaceId === expectedWorkspaceId;
        if (disposed || !exactPin) {
          await closeShellTerminal(created.id).catch(() => undefined);
          if (!disposed) setError(t("terminal.scopeChanged"));
          return;
        }
        sessionRef.current = created;
        setSession(created);
      } catch (reason) {
        if (!disposed) {
          setError(t("terminal.createFailed", { error: errMessage(reason) }));
        }
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
      writerRef.current = null;
      bufferedRef.current = [];
      bufferedBytesRef.current = 0;
      const active = sessionRef.current;
      sessionRef.current = null;
      if (active) void closeShellTerminal(active.id).catch(() => undefined);
    };
  }, [catalogScope.ready, catalogScope.workspaceId, connection.id, routeOutput, t]);

  async function close() {
    if (closing) return;
    const active = sessionRef.current;
    if (!active) {
      onClose();
      return;
    }
    setClosing(true);
    setError(null);
    try {
      await closeShellTerminal(active.id);
      if (sessionRef.current?.id === active.id) sessionRef.current = null;
      onClose();
    } catch (reason) {
      setError(t("terminal.closeFailed", { error: errMessage(reason) }));
      setClosing(false);
    }
  }

  const policyLabel = session
    ? session.connection.policy === "readOnly"
      ? t("terminal.readOnly")
      : t("terminal.approvalRequired")
    : null;

  // This dialog deliberately passes no `onEscape`. Closing it kills the PTY, and
  // Escape is a normal terminal key: xterm cancels it on its own textarea, but
  // one keypress from the title bar, the footer, or `document.body` after a
  // backdrop click would still tear down a live shell. "Focus is outside the
  // terminal" cannot separate that accident from intent, because the backdrop
  // click is exactly what leaves focus outside. The explicit title-bar and footer
  // Close commands own the teardown instead.
  return (
    <ModalBackdrop>
      <ModalSurface
        size="wide"
        fill
        aria-labelledby="advanced-shell-terminal-title"
      >
        <ModalTitleBar
          title={t("terminal.title")}
          titleId="advanced-shell-terminal-title"
          closeLabel={t("terminal.close")}
          onClose={() => void close()}
        />
        <div className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:bg-background">
          <div className="tw:flex tw:min-h-[42px] tw:shrink-0 tw:flex-wrap tw:items-center tw:gap-2 tw:border-b tw:border-border-subtle tw:bg-card tw:px-3">
            <Icon name="database" className="tw:text-muted-foreground" />
            <strong className="tw:min-w-0 tw:max-w-[40%] tw:truncate tw:text-sm">
              {t("terminal.pinned", { name: connection.name || connection.database })}
            </strong>
            {policyLabel ? (
              <StatusBadge density="compact">{policyLabel}</StatusBadge>
            ) : null}
            {session ? (
              <StatusBadge
                density="compact"
                tone={session.lifecycle === "running" ? "success" : session.lifecycle === "failed" ? "danger" : "neutral"}
              >
                {lifecycleLabel(session.lifecycle, t)}
              </StatusBadge>
            ) : null}
          </div>
          {error ? (
            <div className="tw:shrink-0 tw:p-3">
              <InlineNotice tone="danger" icon="alert" role="alert">
                {error}
              </InlineNotice>
            </div>
          ) : null}
          <div className="tw:flex tw:min-h-0 tw:flex-1 tw:bg-background">
            {session ? (
              <PtySurface
                session={session}
                active
                fill
                registerOutput={registerOutput}
                writeInput={writeShellTerminal}
                resize={resizeShellTerminal}
                onError={setError}
                ariaLabel={t("terminal.pinned", {
                  name: connection.name || connection.database,
                })}
              />
            ) : error ? null : (
              <div className="tw:grid tw:flex-1 tw:place-items-center tw:text-sm tw:text-muted-foreground">
                {t("terminal.starting")}
              </div>
            )}
          </div>
        </div>
        <ModalFooter>
          <Button
            size="compact"
            variant="default"
            disabled={closing}
            onClick={() => void close()}
          >
            {t("terminal.close")}
          </Button>
        </ModalFooter>
      </ModalSurface>
    </ModalBackdrop>
  );
}
