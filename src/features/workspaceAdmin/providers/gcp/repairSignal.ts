// Announces that Settings saved a managed-connection repair so surfaces outside
// Settings can re-read exactly those connections. Only connection ids travel; the
// signal grants no authority and carries no provider data.
const MANAGED_CONNECTIONS_REPAIRED_EVENT = "dopedb:managed-connections-repaired";

export function announceManagedConnectionsRepaired(connectionIds: readonly string[]) {
  if (connectionIds.length === 0) return;
  window.dispatchEvent(
    new CustomEvent<string[]>(MANAGED_CONNECTIONS_REPAIRED_EVENT, {
      detail: [...new Set(connectionIds)],
    }),
  );
}

export function onManagedConnectionsRepaired(
  handler: (connectionIds: readonly string[]) => void,
) {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!Array.isArray(detail)) return;
    handler(detail.filter((id): id is string => typeof id === "string"));
  };
  window.addEventListener(MANAGED_CONNECTIONS_REPAIRED_EVENT, listener);
  return () => window.removeEventListener(MANAGED_CONNECTIONS_REPAIRED_EVENT, listener);
}
