import { getApps, type FilterMode, type AppEntry, fetchAttestations, checkUserVouch, vouchForApp, unvouchForApp } from "./data";
import { renderApp } from "./ui";
import { mountDetail } from "./detail";
import { setupDebugConsole } from "./debug";
import { setChainStatusCallback } from "./chain";
import "./style.css";

const root = document.querySelector("#app") as HTMLElement;
const { setApps, setLoading, setStatus, setMode, showToast, getListEl, setDetailMode } = renderApp(root);
setupDebugConsole(root);
setChainStatusCallback((msg) => setStatus(msg));

// ── State ────────────────────────────────────────────────────

let cachedApps: AppEntry[] = [];
let detailCleanup: (() => void) | null = null;
let isDetailView = false;

// ── Router ───────────────────────────────────────────────────

function route(hash: string) {
  // Tear down any active detail view
  if (detailCleanup) {
    detailCleanup();
    detailCleanup = null;
  }

  const [segment, param] = hash.split("/");

  if (segment === "detail" && param) {
    const app = cachedApps.find((a) => a.label === param);
    if (!app) {
      // Data not loaded yet — will re-route when it arrives
      isDetailView = true;
      return;
    }

    isDetailView = true;
    setDetailMode(true);
    const listEl = getListEl();

    detailCleanup = mountDetail(listEl, app, {
      onBack: () => {
        if (history.length > 1) {
          history.back();
        } else {
          location.hash = "";
        }
      },
      onVouch: async (label) => {
        const result = await vouchForApp(label);
        if (result.status === "ok") {
          const a = cachedApps.find((x) => x.label === label);
          if (a) a.vouchCount = (a.vouchCount ?? 0) + 1;
          showToast(`Vouched for ${label}.dot`);
        } else if (result.status === "no-wallet") {
          showToast("Sign in to vouch");
        } else {
          showToast("Vouch failed — try again");
        }
      },
      onUnvouch: async (label) => {
        const result = await unvouchForApp(label);
        if (result.status === "ok") {
          const a = cachedApps.find((x) => x.label === label);
          if (a) a.vouchCount = Math.max(0, (a.vouchCount ?? 1) - 1);
          showToast(`Unvouched ${label}.dot`);
        } else if (result.status === "no-wallet") {
          showToast("Sign in to unvouch");
        } else {
          showToast("Unvouch failed — try again");
        }
      },
      showToast,
    }, fetchAttestations, checkUserVouch);

    // Wrap cleanup to also restore UI
    const innerCleanup = detailCleanup;
    detailCleanup = () => {
      innerCleanup();
      setDetailMode(false);
    };
  } else {
    // Directory view
    isDetailView = false;
    setApps(cachedApps);
    const mode = segment as FilterMode;
    setMode(mode);
  }
}

window.addEventListener("hashchange", () => {
  route(location.hash.slice(1).toLowerCase());
});

// ── Data loading ─────────────────────────────────────────────

setLoading(true);

let pendingApps: AppEntry[] | null = null;
let rafId: number | null = null;

getApps((partialApps) => {
  pendingApps = partialApps;
  cachedApps = partialApps;
  if (rafId === null) {
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (pendingApps && !isDetailView) setApps(pendingApps);
    });
  }
}).then((result) => {
  if (result.status === "ok" || result.status === "mock") {
    cachedApps = result.apps;
    if (!isDetailView) setApps(result.apps);
    // Re-route in case we landed on #detail/X before data arrived
    const hash = location.hash.slice(1).toLowerCase();
    if (hash.startsWith("detail/")) route(hash);
  } else {
    setStatus(result.message);
  }
});

// Bootstrap: parse initial hash
route(location.hash.slice(1).toLowerCase());
