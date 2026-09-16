// Connects the update controller to official Tauri checks, downloads, and app relaunch.

import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import { errMessage } from "../../ipc/types";
import { AppUpdaterController } from "./controller";

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function useAppUpdater() {
  const effectGeneration = useRef(0);
  const controller = useMemo(
    () =>
      new AppUpdaterController({
        currentVersion: getVersion,
        check,
        relaunch,
        errorMessage: errMessage,
      }),
    [],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const scheduleDispose = useCallback(
    (generation: number) => {
      queueMicrotask(() => {
        if (effectGeneration.current === generation) controller.dispose();
      });
    },
    [controller],
  );

  useEffect(() => {
    const generation = ++effectGeneration.current;
    let disposed = false;
    let secondFrame = 0;
    let idleCallback: number | undefined;
    const scheduleVisibleRefresh = () => {
      if (disposed || document.hidden) return;
      const run = () => {
        if (!disposed && !document.hidden) {
          void controller.refresh({ silent: true });
        }
      };
      if (typeof window.requestIdleCallback === "function") {
        idleCallback = window.requestIdleCallback(run, { timeout: 1_500 });
      } else {
        run();
      }
    };
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(scheduleVisibleRefresh);
    });
    const interval = window.setInterval(() => {
      if (!document.hidden) void controller.refresh({ silent: true });
    }, UPDATE_CHECK_INTERVAL_MS);
    const onVisibility = () => {
      if (
        !document.hidden &&
        Date.now() - controller.getLastCheckAt() >= UPDATE_CHECK_INTERVAL_MS
      ) {
        scheduleVisibleRefresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      if (idleCallback !== undefined) window.cancelIdleCallback(idleCallback);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      scheduleDispose(generation);
    };
  }, [controller, scheduleDispose]);

  const refresh = useCallback(() => controller.refresh(), [controller]);
  const install = useCallback(() => controller.install(), [controller]);

  return { snapshot, refresh, install };
}
