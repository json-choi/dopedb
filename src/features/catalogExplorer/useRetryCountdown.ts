// Counts down to a catalog issue's `retryAt`, when the runtime accepts a new open.
import { useEffect, useState } from "react";

/** Whole seconds left before the runtime accepts a new open; 0 once retry may run. */
export default function useRetryCountdown(retryAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (retryAt === undefined) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= retryAt) window.clearInterval(timer);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  return retryAt === undefined
    ? 0
    : Math.max(0, Math.ceil((retryAt - now) / 1_000));
}
