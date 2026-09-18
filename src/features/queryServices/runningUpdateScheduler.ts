// Rate limiter for running-query snapshots. It is scope-aware: a snapshot queued before the
// active connection scope changed is dropped rather than published into the new scope.
type TimerHandle = unknown;
type ScheduleTimer = (callback: () => void, delayMs: number) => TimerHandle;
type CancelTimer = (handle: TimerHandle) => void;

/**
 * Publishes the latest running snapshot no more than once per interval. Lifecycle
 * transitions stay outside this scheduler so waiting/terminal states can bypass
 * the cadence and commit immediately.
 */
export class RunningQueryUpdateScheduler<T extends { id: string }> {
  private readonly pending = new Map<
    string,
    { scopeKey: string; value: T }
  >();
  private readonly timers = new Map<string, TimerHandle>();
  private readonly lastPublishedAt = new Map<string, number>();

  constructor(
    private readonly intervalMs: number,
    private readonly publish: (value: T) => void,
    private readonly isCurrentScope: (scopeKey: string) => boolean,
    private readonly now: () => number = Date.now,
    private readonly scheduleTimer: ScheduleTimer = (callback, delayMs) =>
      setTimeout(callback, delayMs),
    private readonly cancelTimer: CancelTimer = (handle) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
  ) {}

  publishNow(scopeKey: string, value: T) {
    this.cancel(value.id, false);
    if (!this.isCurrentScope(scopeKey)) return;
    this.publish(value);
    this.lastPublishedAt.set(value.id, this.now());
  }

  push(scopeKey: string, value: T) {
    this.pending.set(value.id, { scopeKey, value });
    if (this.timers.has(value.id)) return;

    const elapsed = this.now() -
      (this.lastPublishedAt.get(value.id) ?? 0);
    const delay = Math.max(0, this.intervalMs - elapsed);
    if (delay === 0) {
      this.publishPending(value.id);
      return;
    }
    const handle = this.scheduleTimer(
      () => {
        this.timers.delete(value.id);
        this.publishPending(value.id);
      },
      delay,
    );
    this.timers.set(value.id, handle);
  }

  cancel(id: string, forgetLast = true) {
    const timer = this.timers.get(id);
    if (timer !== undefined) this.cancelTimer(timer);
    this.timers.delete(id);
    this.pending.delete(id);
    if (forgetLast) this.lastPublishedAt.delete(id);
  }

  reset() {
    for (const timer of this.timers.values()) this.cancelTimer(timer);
    this.timers.clear();
    this.pending.clear();
    this.lastPublishedAt.clear();
  }

  private publishPending(id: string) {
    const pending = this.pending.get(id);
    this.pending.delete(id);
    if (!pending || !this.isCurrentScope(pending.scopeKey)) return;
    this.publish(pending.value);
    this.lastPublishedAt.set(id, this.now());
  }
}
