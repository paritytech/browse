import { getApps, type FilterMode, type AppEntry } from "./data";
import { renderApp } from "./ui";
import { setupDebugConsole } from "./debug";
import { setChainStatusCallback } from "./chain";
import "./style.css";

const root = document.querySelector("#app") as HTMLElement;
const { setApps, setLoading, setStatus, setMode } = renderApp(root);
setupDebugConsole(root);

// ── URL preset: hash fragment selects a mode ────────────────
// browse.dot#popular  → Popular mode
// browse.dot#curated  → Curated mode
// browse.dot#attendee → Attendee mode
// Extensible: future fragments like #attendee/event-id can carry context.
const hash = location.hash.slice(1).toLowerCase();
if (hash) {
  const mode = hash.split("/")[0] as FilterMode;
  setMode(mode); // silently ignored if mode is invalid or disabled
}

setChainStatusCallback((msg) => setStatus(msg));
setLoading(true);

// Debounce progressive updates to one render per animation frame.
// Store scans fire onProgress rapidly; collapsing them avoids DOM thrashing.
let pendingApps: AppEntry[] | null = null;
let rafId: number | null = null;

getApps((partialApps) => {
  pendingApps = partialApps;
  if (rafId === null) {
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (pendingApps) setApps(pendingApps);
    });
  }
}).then((result) => {
  if (result.status === "ok" || result.status === "mock") {
    setApps(result.apps);
  } else {
    setStatus(result.message);
  }
});
