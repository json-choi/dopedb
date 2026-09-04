import {
  useCallback,
  useEffect,
  useRef,
} from "react";

import {
  isTerminalQueryServiceSession,
  type QueryServiceSession,
} from "./domain";
import {
  listQueryServiceSessions,
  saveQueryServiceSession,
  type QueryServiceStorageScope,
} from "./tauriAdapter";
import { clearSqlResultPageCache } from "../queries/resultPageCache";
import { RunningQueryUpdateScheduler } from "./runningUpdateScheduler";
import { QueryServiceStore } from "./store";

export const QUERY_SERVICE_RUNNING_UPDATE_MS = 250;

type QueryServiceScope = {
  key: string;
  ready: boolean;
  workspaceId: string | null;
  accountScope: string | null;
};

export function queryServiceSessionProjection(
  scope: QueryServiceScope,
  currentScopeKey: string,
): "ignore" | "memory" | "persistent" {
  if (!scope.ready || scope.key !== currentScopeKey) return "ignore";
  return storageScope(scope.workspaceId, scope.accountScope)
    ? "persistent"
    : "memory";
}

export function useQueryServices(
  scope: QueryServiceScope,
  onPersistenceError: (error: unknown) => void,
) {
  const storeRef = useRef<QueryServiceStore | null>(null);
  if (!storeRef.current) storeRef.current = new QueryServiceStore(scope.key);
  const store = storeRef.current;
  const scopeKeyRef = useRef(scope.key);
  const storageScopeRef = useRef<QueryServiceStorageScope | null>(null);
  const errorHandlerRef = useRef(onPersistenceError);
  const persistedSnapshots = useRef<Map<string, string>>(new Map());
  scopeKeyRef.current = scope.key;
  storageScopeRef.current = storageScope(
    scope.workspaceId,
    scope.accountScope,
  );
  errorHandlerRef.current = onPersistenceError;
  const runningUpdatesRef = useRef<
    RunningQueryUpdateScheduler<QueryServiceSession> | null
  >(null);
  if (!runningUpdatesRef.current) {
    runningUpdatesRef.current = new RunningQueryUpdateScheduler(
      QUERY_SERVICE_RUNNING_UPDATE_MS,
      (session) => store.merge([session]),
      (scopeKey) => scopeKeyRef.current === scopeKey,
    );
  }
  const runningUpdates = runningUpdatesRef.current;

  useEffect(() => {
    runningUpdates.reset();
    clearSqlResultPageCache();
    persistedSnapshots.current.clear();
    store.replaceScope(scope.key);
    const expectedScope = storageScope(
      scope.workspaceId,
      scope.accountScope,
    );
    if (!scope.ready || !expectedScope) {
      return;
    }
    let cancelled = false;
    void listQueryServiceSessions(expectedScope)
      .then((loaded) => {
        if (cancelled || scopeKeyRef.current !== scope.key) return;
        store.merge(loaded);
      })
      .catch((error) => {
        if (!cancelled && scopeKeyRef.current === scope.key) {
          errorHandlerRef.current(error);
        }
      });
    return () => {
      cancelled = true;
      runningUpdates.reset();
    };
  }, [
    runningUpdates,
    scope.accountScope,
    scope.key,
    scope.ready,
    scope.workspaceId,
    store,
  ]);

  useEffect(() => () => runningUpdates.reset(), [runningUpdates]);

  const updateSession = useCallback(
    (session: QueryServiceSession) => {
      const expectedScope = storageScope(
        scope.workspaceId,
        scope.accountScope,
      );
      const projection = queryServiceSessionProjection(
        {
          key: scope.key,
          ready: scope.ready,
          workspaceId: scope.workspaceId,
          accountScope: scope.accountScope,
        },
        scopeKeyRef.current,
      );
      if (projection === "ignore") {
        return;
      }
      const previous = store.session(session.id);
      const publishNow = () => {
        store.merge([session]);
      };

      if (
        session.status !== "running" ||
        !previous ||
        previous.status !== "running"
      ) {
        if (session.status === "running") {
          runningUpdates.publishNow(scope.key, session);
        } else {
          runningUpdates.cancel(session.id);
          publishNow();
        }
      } else {
        runningUpdates.push(scope.key, session);
      }
      if (!isTerminalQueryServiceSession(session)) return;
      // Personal workspaces intentionally have no account scope to persist
      // against. They still own a live Services projection for the current
      // app session; only the durable snapshot is account-scoped.
      if (projection === "memory" || !expectedScope) return;
      if (store.session(session.id)?.updatedAt !== session.updatedAt) return;
      const serialized = JSON.stringify(session);
      if (persistedSnapshots.current.get(session.id) === serialized) return;
      persistedSnapshots.current.set(session.id, serialized);
      const saveScopeKey = scope.key;
      void saveQueryServiceSession(expectedScope, session).catch(
        (error) => {
          if (
            scopeKeyRef.current !== saveScopeKey ||
            storageScopeRef.current?.workspaceId !==
              expectedScope.workspaceId ||
            storageScopeRef.current?.accountScope !==
              expectedScope.accountScope
          ) {
            return;
          }
          persistedSnapshots.current.delete(session.id);
          errorHandlerRef.current(error);
        },
      );
    },
    [
      scope.accountScope,
      scope.key,
      scope.ready,
      scope.workspaceId,
      runningUpdates,
      store,
    ],
  );

  const activateSession = useCallback(
    (id: string) => store.activate(id),
    [store],
  );

  return {
    store,
    updateSession,
    activateSession,
    activateNewestSession: activateSession,
  };
}

function storageScope(
  workspaceId: string | null,
  accountScope: string | null,
): QueryServiceStorageScope | null {
  if (!workspaceId || !accountScope) return null;
  return {
    workspaceId,
    accountScope,
  };
}
