// One result owns the footer action host. Grid controls portal into that host;
// zoom state and reset behavior remain local to the mounted result viewport.
import { createContext, useState, type ReactNode } from "react";

export const DataGridStatusContext = createContext<{
  host: HTMLDivElement | null;
  setHost: (host: HTMLDivElement | null) => void;
} | null>(null);

export function DataGridStatusScope({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return (
    <DataGridStatusContext.Provider value={{ host, setHost }}>
      {children}
    </DataGridStatusContext.Provider>
  );
}
