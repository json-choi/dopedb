// Owns the one xterm renderer used by the explicit connection-pinned advanced
// Shell and bridges bounded PTY input, output, resize, focus, and teardown.
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

import { useTheme } from "../../design-system/theme";
import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import type {
  TerminalLifecycle,
  TerminalOutputChunk,
  TerminalSessionId,
  TerminalSize,
} from "./domain";
import { resolvePtyTheme } from "./ptyTheme";
import "@xterm/xterm/css/xterm.css";

const INPUT_CHUNK_BYTES = 32 * 1024;
const INPUT_FLUSH_MS = 4;
const RESIZE_FLUSH_MS = 40;

export type PtyOutputWriter = (chunk: TerminalOutputChunk) => void;

export interface PtySurfaceSession {
  id: TerminalSessionId;
  lifecycle: TerminalLifecycle;
  size: TerminalSize;
}

export interface PtySurfaceHandle {
  focus(): void;
}

interface PtySurfaceProps {
  session: PtySurfaceSession;
  active: boolean;
  registerOutput: (
    id: TerminalSessionId,
    writer: PtyOutputWriter | null,
  ) => void;
  writeInput: (id: TerminalSessionId, bytes: number[]) => Promise<void>;
  resize: (id: TerminalSessionId, size: TerminalSize) => Promise<void>;
  onError: (message: string) => void;
  onReady?: () => void;
  onPromptVisible?: () => void;
  ariaLabel: string;
  ariaLabelledBy?: string;
  fill?: boolean;
  id?: string;
  role?: "region" | "tabpanel";
}

function boundedPixelSize(value: number): number {
  return Math.max(0, Math.min(32_000, Math.round(value)));
}

function terminalHasVisibleText(terminal: Terminal): boolean {
  const buffer = terminal.buffer.active;
  const firstLine = Math.max(0, buffer.viewportY);
  const lastLine = Math.min(buffer.length, firstLine + terminal.rows);
  for (let index = firstLine; index < lastLine; index += 1) {
    if (buffer.getLine(index)?.translateToString(true).trim()) return true;
  }
  return false;
}

function flushInput(
  id: TerminalSessionId,
  bytes: number[],
  chain: MutableRefObject<Promise<void>>,
  writeInput: PtySurfaceProps["writeInput"],
  onError: (message: string) => void,
  formatError: (error: unknown) => string,
) {
  while (bytes.length > 0) {
    const chunk = bytes.splice(0, INPUT_CHUNK_BYTES);
    chain.current = chain.current
      .then(() => writeInput(id, chunk))
      .catch((error) => {
        onError(formatError(error));
      });
  }
}

const PtySurface = forwardRef<PtySurfaceHandle, PtySurfaceProps>(
  function PtySurface(
    {
      session,
      active,
      registerOutput,
      writeInput,
      resize,
      onError,
      onReady,
      onPromptVisible,
      ariaLabel,
      ariaLabelledBy,
      fill = false,
      id,
      role = "region",
    },
    forwardedRef,
  ) {
    const { t } = useI18n();
    const { resolved: colorScheme } = useTheme();
    const hostRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    useEffect(() => {
      if (terminalRef.current) terminalRef.current.options.theme = resolvePtyTheme(getComputedStyle(document.documentElement));
    }, [colorScheme]);
    const inputChainRef = useRef(Promise.resolve());
    const lifecycleRef = useRef(session.lifecycle);
    lifecycleRef.current = session.lifecycle;
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    useImperativeHandle(
      forwardedRef,
      () => ({
        focus() {
          terminalRef.current?.focus();
        },
      }),
      [],
    );

    useEffect(() => {
      let disposed = false;
      let resizeObserver: ResizeObserver | null = null;
      let inputTimer: number | null = null;
      let resizeTimer: number | null = null;
      let fitFrame: number | null = null;
      let inputBytes: number[] = [];
      let lastResize = "";
      const disposables: Array<{ dispose(): void }> = [];
      const encoder = new TextEncoder();

      function formatInputError(error: unknown) {
        return t("terminal.inputFailed", { error: errMessage(error) });
      }

      function sendInput() {
        if (inputTimer !== null) {
          window.clearTimeout(inputTimer);
          inputTimer = null;
        }
        flushInput(
          session.id,
          inputBytes,
          inputChainRef,
          writeInput,
          onError,
          formatInputError,
        );
      }

      async function mountTerminal() {
        try {
          const [{ Terminal: XtermTerminal }, { FitAddon: XtermFitAddon }] =
            await Promise.all([
              import("@xterm/xterm"),
              import("@xterm/addon-fit"),
            ]);
          if (disposed || !hostRef.current) return;

          const style = getComputedStyle(document.documentElement);
          const terminal = new XtermTerminal({
            allowProposedApi: false,
            allowTransparency: false,
            cols: session.size.cols,
            rows: session.size.rows,
            convertEol: false,
            cursorBlink: true,
            cursorStyle: "bar",
            disableStdin:
              lifecycleRef.current === "exited" ||
              lifecycleRef.current === "failed",
            drawBoldTextInBrightColors: false,
            fontFamily:
              style.getPropertyValue("--ds-font-mono").trim() ||
              "ui-monospace, monospace",
            fontSize: 12,
            letterSpacing: 0,
            lineHeight: 1.35,
            minimumContrastRatio: 4.5,
            rightClickSelectsWord: true,
            screenReaderMode: true,
            scrollback: 5_000,
            scrollOnUserInput: true,
            smoothScrollDuration: 0,
            theme: resolvePtyTheme(style),
            windowOptions: {},
          });
          // Terminal output is untrusted. Consume OSC-8 before any PTY output
          // reaches xterm so hyperlink text stays visible but intentionally inert.
          disposables.push(terminal.parser.registerOscHandler(8, () => true));
          const fit = new XtermFitAddon();
          terminal.loadAddon(fit);
          terminal.open(hostRef.current);
          terminalRef.current = terminal;
          fitRef.current = fit;

          registerOutput(session.id, (chunk) => {
            if (disposed || chunk.sessionId !== session.id) return;
            terminal.write(Uint8Array.from(chunk.bytes), () => {
              if (!disposed && terminalHasVisibleText(terminal)) {
                onPromptVisible?.();
              }
            });
          });

          disposables.push(
            terminal.onData((value) => {
              const encoded = encoder.encode(value);
              for (const byte of encoded) inputBytes.push(byte);
              if (inputBytes.length >= INPUT_CHUNK_BYTES) {
                sendInput();
              } else if (inputTimer === null) {
                inputTimer = window.setTimeout(sendInput, INPUT_FLUSH_MS);
              }
            }),
          );
          disposables.push(
            terminal.onBinary((value) => {
              for (let index = 0; index < value.length; index += 1) {
                inputBytes.push(value.charCodeAt(index) & 0xff);
              }
              if (inputBytes.length >= INPUT_CHUNK_BYTES) {
                sendInput();
              } else if (inputTimer === null) {
                inputTimer = window.setTimeout(sendInput, INPUT_FLUSH_MS);
              }
            }),
          );
          disposables.push(
            terminal.onResize(({ cols, rows }) => {
              if (!hostRef.current || cols < 10 || rows < 2) return;
              const key = `${cols}:${rows}`;
              if (key === lastResize) return;
              lastResize = key;
              if (resizeTimer !== null) window.clearTimeout(resizeTimer);
              resizeTimer = window.setTimeout(() => {
                resizeTimer = null;
                const rect = hostRef.current?.getBoundingClientRect();
                void resize(session.id, {
                  cols,
                  rows,
                  pixelWidth: boundedPixelSize(rect?.width ?? 0),
                  pixelHeight: boundedPixelSize(rect?.height ?? 0),
                }).catch((error) => {
                  onError(errMessage(error));
                });
              }, RESIZE_FLUSH_MS);
            }),
          );

          const fitWhenVisible = () => {
            if (
              disposed ||
              !hostRef.current ||
              hostRef.current.hidden ||
              hostRef.current.clientWidth === 0 ||
              hostRef.current.clientHeight === 0
            ) {
              return;
            }
            try {
              fit.fit();
            } catch (error) {
              onError(errMessage(error));
            }
          };
          resizeObserver = new ResizeObserver(fitWhenVisible);
          resizeObserver.observe(hostRef.current);
          fitFrame = window.requestAnimationFrame(fitWhenVisible);
          setLoading(false);
          onReady?.();
        } catch (error) {
          if (disposed) return;
          const message = errMessage(error);
          setLoadError(message);
          setLoading(false);
          onError(message);
        }
      }

      void mountTerminal();
      return () => {
        disposed = true;
        if (inputTimer !== null) window.clearTimeout(inputTimer);
        if (resizeTimer !== null) window.clearTimeout(resizeTimer);
        if (fitFrame !== null) window.cancelAnimationFrame(fitFrame);
        sendInput();
        resizeObserver?.disconnect();
        registerOutput(session.id, null);
        for (const disposable of disposables) disposable.dispose();
        fitRef.current?.dispose();
        terminalRef.current?.dispose();
        fitRef.current = null;
        terminalRef.current = null;
      };
    }, [
      onError,
      onPromptVisible,
      onReady,
      registerOutput,
      resize,
      session.id,
      session.size.cols,
      session.size.rows,
      t,
      writeInput,
    ]);

    useEffect(() => {
      if (!terminalRef.current) return;
      terminalRef.current.options.disableStdin =
        session.lifecycle === "exited" || session.lifecycle === "failed";
    }, [session.lifecycle]);

    useEffect(() => {
      if (!active || !terminalRef.current || !fitRef.current) return;
      const frame = window.requestAnimationFrame(() => {
        try {
          fitRef.current?.fit();
          terminalRef.current?.focus();
        } catch (error) {
          onError(errMessage(error));
        }
      });
      return () => window.cancelAnimationFrame(frame);
    }, [active, onError]);

    return (
      <div
        ref={hostRef}
        data-fill={fill || undefined}
        className="tw:relative tw:min-h-0 tw:min-w-0 tw:w-full tw:flex-1 tw:overflow-hidden tw:bg-background tw:p-2 tw:data-[fill=true]:h-full tw:[&_.xterm]:h-full tw:[&_.xterm-viewport]:[scrollbar-color:var(--ds-border-strong)_transparent] tw:[&_.xterm-viewport]:[scrollbar-width:thin]"
        data-pty-id={session.id}
        role={role}
        id={id}
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel}
        hidden={!active}
      >
        {loading && (
          <div className="tw:absolute tw:inset-2 tw:z-base tw:grid tw:place-items-center tw:bg-background tw:p-3 tw:text-muted-foreground">
            {t("common.loading")}
          </div>
        )}
        {loadError && (
          <div
            className="tw:absolute tw:inset-2 tw:z-base tw:grid tw:place-items-center tw:bg-background tw:p-3 tw:text-ui tw:text-danger"
            role="alert"
          >
            {loadError}
          </div>
        )}
      </div>
    );
  },
);

export default PtySurface;
