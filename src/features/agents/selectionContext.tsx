// Carries the table the user last selected to whichever agent surface is mounted,
// so a grid needs no reference to the dock. It holds one selection and nothing
// durable; the selection does not survive a restart.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AcpTableContext } from "./domain";

type AgentSelection = AcpTableContext & {
  connectionId: string;
};

type AgentSelectionContextValue = {
  selection: AgentSelection | null;
  select: (selection: AgentSelection) => void;
  clear: () => void;
};

const AgentSelectionContext = createContext<AgentSelectionContextValue>({
  selection: null,
  select: () => undefined,
  clear: () => undefined,
});

export function AgentSelectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [selection, setSelection] = useState<AgentSelection | null>(null);
  const select = useCallback((next: AgentSelection) => setSelection(next), []);
  const clear = useCallback(() => setSelection(null), []);
  const value = useMemo(
    () => ({ selection, select, clear }),
    [clear, select, selection],
  );
  return (
    <AgentSelectionContext.Provider value={value}>
      {children}
    </AgentSelectionContext.Provider>
  );
}

export function useAgentSelection() {
  return useContext(AgentSelectionContext);
}
