// Device-local appearance preference. The resolved scheme is shared by CSS,
// CodeMirror, terminal canvases and rendered diagrams without remounting sessions.
import { useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ColorScheme = "light" | "dark";
const STORAGE_KEY = "dopedb.theme";
const media = typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function preference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}
function readPreference() {
  try { return preference(localStorage.getItem(STORAGE_KEY)); }
  catch { return "system" as const; }
}
function snapshot(value: ThemePreference) {
  return { preference: value, resolved: (value === "system" ? media?.matches ? "dark" : "light" : value) as ColorScheme };
}
let current = snapshot(readPreference());
function apply() {
  if (typeof document !== "undefined") document.documentElement.dataset.theme = current.resolved;
}
function update(value: ThemePreference) {
  const next = snapshot(value);
  if (current.preference === next.preference && current.resolved === next.resolved) return;
  current = next;
  apply();
  listeners.forEach((listener) => listener());
}
export function setThemePreference(value: ThemePreference) {
  update(preference(value));
  // A storage-restricted WebView still supports appearance for this session.
  try { localStorage.setItem(STORAGE_KEY, current.preference); } catch { /* Session-local fallback. */ }
}
const systemChanged = () => update(current.preference);
const storageChanged = (event: StorageEvent) => {
  if (event.key === STORAGE_KEY || event.key === null) update(readPreference());
};
apply();
media?.addEventListener("change", systemChanged);
if (typeof window !== "undefined") window.addEventListener("storage", storageChanged);
if (import.meta.hot) import.meta.hot.dispose(() => {
  media?.removeEventListener("change", systemChanged);
  window.removeEventListener("storage", storageChanged);
});
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => current;
export function useTheme() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
