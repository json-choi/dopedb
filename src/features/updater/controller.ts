// Headless state machine for the app updater. Version lookup, check, download, and relaunch
// all arrive as injected dependencies, so the phase and progress snapshot the UI subscribes
// to is owned here and observable without the Tauri plugin.
export type AppUpdaterPhase =
  | "idle"
  | "checking"
  | "available"
  | "current"
  | "downloading"
  | "installing"
  | "ready"
  | "error";

export type AppUpdaterSnapshot = {
  phase: AppUpdaterPhase;
  currentVersion: string | null;
  availableVersion: string | null;
  releaseNotes: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
};

export type AppUpdaterDownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export type AppUpdateResource = {
  version: string;
  body?: string;
  downloadAndInstall(
    onEvent?: (event: AppUpdaterDownloadEvent) => void,
  ): Promise<void>;
  close(): Promise<void>;
};

export type AppUpdaterDependencies = {
  currentVersion(): Promise<string>;
  check(): Promise<AppUpdateResource | null>;
  relaunch(): Promise<void>;
  errorMessage(error: unknown): string;
  now?(): number;
};

type Listener = () => void;

const INITIAL_SNAPSHOT: AppUpdaterSnapshot = {
  phase: "idle",
  currentVersion: null,
  availableVersion: null,
  releaseNotes: null,
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
};

function positiveFinite(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function appUpdaterProgress(snapshot: AppUpdaterSnapshot) {
  const total = snapshot.totalBytes;
  if (total === null || total <= 0) return null;
  return Math.min(
    100,
    Math.round((Math.max(0, snapshot.downloadedBytes) / total) * 100),
  );
}

export class AppUpdaterController {
  private snapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<Listener>();
  private resource: AppUpdateResource | null = null;
  private checking: Promise<void> | null = null;
  private installing: Promise<void> | null = null;
  private activeInstallResource: AppUpdateResource | null = null;
  private installed = false;
  private relaunchCompleted = false;
  private disposed = false;
  private lastCheckAt = 0;

  constructor(private readonly dependencies: AppUpdaterDependencies) {}

  getSnapshot = () => this.snapshot;

  getLastCheckAt = () => this.lastCheckAt;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  refresh(options: { silent?: boolean } = {}) {
    if (this.disposed) return Promise.resolve();
    if (this.installing) return this.installing;
    if (this.checking) return this.checking;

    const operation = this.runRefresh(options.silent === true).finally(() => {
      this.lastCheckAt = (this.dependencies.now ?? Date.now)();
      if (this.checking === operation) this.checking = null;
    });
    this.checking = operation;
    return operation;
  }

  install() {
    if (this.disposed) return Promise.resolve();
    if (this.installing) return this.installing;
    if (this.checking) return this.checking;
    if (this.relaunchCompleted) return Promise.resolve();

    const resource = this.resource;
    if (!resource && !this.installed) return Promise.resolve();

    const operation = (
      this.installed
        ? this.retryRelaunch()
        : this.runInstall(resource as AppUpdateResource)
    ).finally(() => {
      if (this.installing === operation) this.installing = null;
    });
    this.installing = operation;
    return operation;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    if (this.installing) return;
    const resource = this.resource;
    this.resource = null;
    if (resource) void this.safeClose(resource);
  }

  private async runRefresh(silent: boolean) {
    const previousSnapshot = this.snapshot;
    this.publish({
      ...previousSnapshot,
      phase: "checking",
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
    });

    const versionPromise = this.dependencies.currentVersion();
    void versionPromise.then(
      (currentVersion) => {
        if (!this.disposed && this.snapshot.phase === "checking") {
          this.publish({ ...this.snapshot, currentVersion });
        }
      },
      () => undefined,
    );
    const [versionResult, updateResult] = await Promise.allSettled([
      versionPromise,
      this.dependencies.check(),
    ]);
    const nextResource =
      updateResult.status === "fulfilled" ? updateResult.value : null;

    if (this.disposed) {
      if (nextResource) await this.safeClose(nextResource);
      return;
    }

    if (versionResult.status === "rejected" || updateResult.status === "rejected") {
      if (nextResource) await this.safeClose(nextResource);
      const recoveredSnapshot =
        versionResult.status === "fulfilled"
          ? { ...previousSnapshot, currentVersion: versionResult.value }
          : previousSnapshot;
      if (silent) {
        this.publish(recoveredSnapshot);
        return;
      }
      const error =
        updateResult.status === "rejected"
          ? updateResult.reason
          : versionResult.status === "rejected"
            ? versionResult.reason
            : new Error("update check failed");
      this.publish({
        ...recoveredSnapshot,
        phase: "error",
        error: this.dependencies.errorMessage(error),
      });
      return;
    }

    await this.replaceResource(nextResource);
    this.installed = false;
    this.relaunchCompleted = false;
    this.publish({
      phase: nextResource ? "available" : "current",
      currentVersion: versionResult.value,
      availableVersion: nextResource?.version ?? null,
      releaseNotes: nextResource?.body?.trim() || null,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
    });
  }

  private async runInstall(resource: AppUpdateResource) {
    this.activeInstallResource = resource;
    this.publish({
      ...this.snapshot,
      phase: "downloading",
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
    });

    try {
      await resource.downloadAndInstall((event) => {
        if (this.disposed || this.activeInstallResource !== resource) return;
        if (event.event === "Started") {
          this.publish({
            ...this.snapshot,
            phase: "downloading",
            downloadedBytes: 0,
            totalBytes: positiveFinite(event.data.contentLength),
            error: null,
          });
          return;
        }
        if (event.event === "Progress") {
          const chunk = positiveFinite(event.data.chunkLength) ?? 0;
          this.publish({
            ...this.snapshot,
            phase: "downloading",
            downloadedBytes: this.snapshot.downloadedBytes + chunk,
          });
          return;
        }
        this.publish({ ...this.snapshot, phase: "installing" });
      });
      this.installed = true;
      this.publish({ ...this.snapshot, phase: "ready", error: null });
      await this.attemptRelaunch();
    } catch (error) {
      if (!this.disposed) {
        this.publish({
          ...this.snapshot,
          phase: "error",
          error: this.dependencies.errorMessage(error),
        });
      }
    } finally {
      this.activeInstallResource = null;
      if (this.installed || this.disposed || this.resource !== resource) {
        if (this.resource === resource) this.resource = null;
        await this.safeClose(resource);
      }
    }
  }

  private async retryRelaunch() {
    this.publish({ ...this.snapshot, phase: "ready", error: null });
    try {
      await this.attemptRelaunch();
    } catch (error) {
      if (!this.disposed) {
        this.publish({
          ...this.snapshot,
          phase: "error",
          error: this.dependencies.errorMessage(error),
        });
      }
    }
  }

  private async attemptRelaunch() {
    if (this.relaunchCompleted) return;
    await this.dependencies.relaunch();
    this.relaunchCompleted = true;
  }

  private async replaceResource(next: AppUpdateResource | null) {
    const previous = this.resource;
    this.resource = next;
    if (previous && previous !== next) await this.safeClose(previous);
  }

  private async safeClose(resource: AppUpdateResource) {
    try {
      await resource.close();
    } catch {
      // Resource cleanup cannot replace the authoritative updater outcome.
    }
  }

  private publish(snapshot: AppUpdaterSnapshot) {
    if (this.disposed) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
