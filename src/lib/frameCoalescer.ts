// Latest-wins frame batching for high-frequency UI values such as drag geometry. The frame
// scheduler is injectable, so callers drive it deterministically instead of depending on a
// real animation frame.
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
