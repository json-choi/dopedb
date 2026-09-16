// One process-wide owner for connection Safety saves. The claim outlives the
// screen so leaving and reopening Settings cannot start an overlapping write.
const activeSaves = new Map<string, symbol>();
const listeners = new Set<() => void>();

function publish() {
  for (const listener of listeners) listener();
}

export function claimSafetySave(connectionId: string): symbol | null {
  if (activeSaves.has(connectionId)) return null;
  const token = Symbol(connectionId);
  activeSaves.set(connectionId, token);
  publish();
  return token;
}

export function ownsSafetySave(connectionId: string, token: symbol) {
  return activeSaves.get(connectionId) === token;
}

export function releaseSafetySave(connectionId: string, token: symbol) {
  if (!ownsSafetySave(connectionId, token)) return false;
  activeSaves.delete(connectionId);
  publish();
  return true;
}

export function safetySaveInFlight(connectionId: string) {
  return activeSaves.has(connectionId);
}

export function subscribeSafetySaves(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
