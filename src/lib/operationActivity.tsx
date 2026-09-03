// App-level, bounded activity ledger for authenticated Terminal broker commands.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";

const CAP = 200;

export interface OperationActivity {
  id: number;
  ts: string;
  iso: string;
  tool: string;
  detail: string;
  error: boolean;
  connectionId?: string;
  payload: Record<string, unknown>;
}

interface OperationActivityValue {
  feed: OperationActivity[];
  latest: OperationActivity | null;
  unseen: number;
  markSeen: () => void;
}

interface BrokerOperationEvent {
  requestId: string;
  terminalSessionId: string;
  connectionId: string | null;
  command: string;
  state: "completed" | "failed";
  errorCode: string | null;
}

const Ctx = createContext<OperationActivityValue | null>(null);

export function useOperationActivity(): OperationActivityValue {
  const value = useContext(Ctx);
  if (!value) {
    throw new Error(
      "useOperationActivity must be used within OperationActivityProvider",
    );
  }
  return value;
}

export function OperationActivityProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [feed, setFeed] = useState<OperationActivity[]>([]);
  const [latest, setLatest] = useState<OperationActivity | null>(null);
  const [unseen, setUnseen] = useState(0);
  const idRef = useRef(0);

  useEffect(() => {
    const pending = listen<BrokerOperationEvent>(
      "operation:changed",
      (event) => {
        const {
          command,
          connectionId,
          errorCode,
          requestId,
          state,
          terminalSessionId,
        } = event.payload;
        const now = new Date();
        const item: OperationActivity = {
          id: idRef.current++,
          ts: now.toLocaleTimeString(),
          iso: now.toISOString(),
          tool: command,
          detail: errorCode ? `${state}: ${errorCode}` : state,
          error: state === "failed",
          connectionId: connectionId ?? undefined,
          payload: {
            requestId,
            terminalSessionId,
            connectionId,
            command,
            state,
            errorCode,
          },
        };
        setFeed((current) => [item, ...current].slice(0, CAP));
        setLatest(item);
        setUnseen((count) => count + 1);
      },
    ).catch((error) =>
      console.error("operation activity listen failed:", error),
    );
    return () => {
      void pending.then((unlisten) => unlisten && unlisten());
    };
  }, []);

  const markSeen = useCallback(() => setUnseen(0), []);

  return (
    <Ctx.Provider value={{ feed, latest, unseen, markSeen }}>
      {children}
    </Ctx.Provider>
  );
}
