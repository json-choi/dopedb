// Drops superseded values from a high-frequency stream so only the newest one is
// applied per animation frame. The frame callbacks are injectable, letting a
// caller drive and assert the commit boundary without a real rAF.
type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

export type FrameCoalescer<T> = {
  push: (value: T) => void;
  flush: () => void;
  cancel: () => void;
};

/** Keep only the latest high-frequency value and commit it at most once per frame. */
export function createFrameCoalescer<T>(
  apply: (value: T) => void,
  requestFrame: RequestFrame = (callback) =>
    window.requestAnimationFrame(callback),
  cancelFrame: CancelFrame = (handle) =>
    window.cancelAnimationFrame(handle),
): FrameCoalescer<T> {
  let frame = 0;
  let pending: T | undefined;
  let hasPending = false;

  const commit = () => {
    frame = 0;
    if (!hasPending) return;
    const value = pending as T;
    pending = undefined;
    hasPending = false;
    apply(value);
  };

  return {
    push(value) {
      pending = value;
      hasPending = true;
      if (!frame) frame = requestFrame(commit);
    },
    flush() {
      if (frame) cancelFrame(frame);
      commit();
    },
    cancel() {
      if (frame) cancelFrame(frame);
      frame = 0;
      pending = undefined;
      hasPending = false;
    },
  };
}
