// Hero exploration owns pointer capture and shortcuts; ordinary page scrolling remains native.
export function createGalaxyControls(host: HTMLElement) {
  const abort = new AbortController(), options = { signal: abort.signal };
  const state = { x: 0, y: 0, zoom: 1, exploring: false, enabled: true };
  let drag: { id: number; x: number; y: number } | null = null;
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
  const zoom = (delta: number) => { state.zoom = Math.max(0.75, Math.min(1.45, state.zoom + delta)); };
  function up() {
    const id = drag?.id;
    drag = null;
    if (id !== undefined && host.hasPointerCapture(id)) host.releasePointerCapture(id);
  }
  host.addEventListener("pointerdown", event => {
    if (!state.exploring || !state.enabled || event.button !== 0 || !(event.target instanceof Element) || event.target.closest("a,button,input,textarea,select")) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    host.setPointerCapture(event.pointerId);
  }, options);
  host.addEventListener("pointermove", event => {
    if (!state.enabled) return;
    if (drag?.id === event.pointerId) {
      state.x = clamp(state.x + (event.clientX - drag.x) * 0.016, 6);
      state.y = clamp(state.y - (event.clientY - drag.y) * 0.016, 4);
      drag.x = event.clientX; drag.y = event.clientY;
    } else if (!state.exploring && event.pointerType === "mouse") {
      state.x = (event.clientX / window.innerWidth - 0.5) * 1.5;
      state.y = (0.5 - event.clientY / window.innerHeight) * 0.9;
    }
  }, { ...options, passive: true });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) host.addEventListener(event, up, options);
  host.addEventListener("pointerleave", () => { if (!drag && !state.exploring) state.x = state.y = 0; }, options);
  host.addEventListener("wheel", event => {
    if (!state.exploring || !state.enabled || event.ctrlKey || event.metaKey) return;
    event.preventDefault(); zoom(-clamp(event.deltaY, 100) * 0.001);
  }, { ...options, passive: false });
  window.addEventListener("keydown", event => {
    if (!state.exploring || !state.enabled || event.ctrlKey || event.metaKey || event.altKey ||
      (event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable=true]"))) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "0"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "ArrowLeft") state.x = clamp(state.x - 0.7, 6);
    if (event.key === "ArrowRight") state.x = clamp(state.x + 0.7, 6);
    if (event.key === "ArrowUp") state.y = clamp(state.y + 0.5, 4);
    if (event.key === "ArrowDown") state.y = clamp(state.y - 0.5, 4);
    if (["+", "=", "-"].includes(event.key)) zoom(event.key === "-" ? -0.1 : 0.1);
    if (event.key === "0") reset();
  }, options);
  function reset() { up(); state.x = state.y = 0; state.zoom = 1; }
  return {
    state,
    setExploring(value: boolean) { reset(); state.exploring = value; },
    setEnabled(value: boolean) { state.enabled = value; if (!value) reset(); },
    dispose() { up(); abort.abort(); },
  };
}
