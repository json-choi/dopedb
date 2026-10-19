// Copies a link to the clipboard and keeps a brief "copied" or a lasting "failed" state
// per copy target, so presentation holds no timers or clipboard error handling.
import { useEffect, useRef, useState } from "react";

export type LinkCopyState = { target: string; status: "copied" | "failed" } | null;

export function useLinkCopy() {
  const [state, setState] = useState<LinkCopyState>(null);
  const timer = useRef<{ id?: number }>({});
  useEffect(() => {
    const pending = timer.current;
    return () => window.clearTimeout(pending.id);
  }, []);

  async function copyLink(target: string, url: string) {
    window.clearTimeout(timer.current.id);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable");
      await navigator.clipboard.writeText(url);
      setState({ target, status: "copied" });
      timer.current.id = window.setTimeout(() => {
        setState((current) =>
          current?.target === target && current.status === "copied" ? null : current,
        );
      }, 2_000);
    } catch {
      setState({ target, status: "failed" });
    }
  }

  return { state, copyLink };
}
