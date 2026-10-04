// Settings coordinates the native collection owner, bounded polling, and
// explicit support actions. Snapshot errors remain visible; no log upload exists.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { configureDiagnosticCapture } from "./client";
import { formatDiagnosticLog, type DiagnosticSnapshot } from "./domain";
import {
  clearDiagnostics, diagnosticQueryKey, diagnosticSnapshotQuery,
  openDiagnosticIssue, setDiagnosticEnabled,
} from "./tauriAdapter";

export function useDiagnostics() {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...diagnosticSnapshotQuery(),
    refetchInterval: (state) => state.state.data?.enabled ? 1_000 : false,
  });
  const [sharing, setSharing] = useState<"copy" | "issue" | null>(null);
  const [actionStatus, setActionStatus] = useState<"copied" | "failed" | null>(null);
  const [sharingBusy, setSharingBusy] = useState(false);
  const apply = (snapshot: DiagnosticSnapshot) => {
    configureDiagnosticCapture(snapshot.enabled, snapshot.generation);
    queryClient.setQueryData(diagnosticQueryKey, snapshot);
    setActionStatus(null);
  };
  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      await queryClient.cancelQueries({ queryKey: diagnosticQueryKey });
      return setDiagnosticEnabled(enabled);
    },
    onSuccess: apply,
  });
  const clear = useMutation({
    mutationFn: async () => {
      await queryClient.cancelQueries({ queryKey: diagnosticQueryKey });
      return clearDiagnostics();
    },
    onSuccess: apply,
  });
  useEffect(() => {
    if (query.data) configureDiagnosticCapture(query.data.enabled, query.data.generation);
  }, [query.data]);

  async function confirmShare() {
    if (sharingBusy) return;
    setSharingBusy(true);
    setActionStatus(null);
    try {
      if (sharing === "copy" && query.data) {
        await navigator.clipboard.writeText(formatDiagnosticLog(query.data));
        setActionStatus("copied");
      } else if (sharing === "issue") {
        await openDiagnosticIssue();
      }
      setSharing(null);
    } catch {
      setActionStatus("failed");
    } finally {
      setSharingBusy(false);
    }
  }

  return {
    query, toggle, clear, sharing, sharingBusy, actionStatus,
    requestShare: (action: "copy" | "issue") => { setActionStatus(null); setSharing(action); },
    cancelShare: () => { if (!sharingBusy) setSharing(null); },
    confirmShare,
  };
}
