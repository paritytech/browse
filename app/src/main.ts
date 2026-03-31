import { getPcfApps, getAllApps, type FilterMode, type AppEntry, fetchAttestations, checkUserVouch, vouchForApp, unvouchForApp } from "./data";
import { renderApp } from "./ui";
import { mountDetail } from "./detail";
import { setupDebugConsole } from "./debug";
import "./style.css";

const root = document.querySelector("#app") as HTMLElement;
const { setApps, setLoading, setStatus, setMode, showToast, getListEl, setDetailMode } = renderApp(root, (mode) => {
  currentMode = mode;
  const loading = mode === "pcf" ? !pcfLoaded : !allLoaded;
  setLoading(loading);
});
setupDebugConsole(root);

// ── State ────────────────────────────────────────────────────

let pcfApps: AppEntry[] = [];
let allApps: AppEntry[] = [];
let pcfLoaded = false;
let allLoaded = false;
let currentMode: FilterMode = "pcf";
let detailCleanup: (() => void) | null = null;
let isDetailView = false;

function cachedApps(): AppEntry[] {
  return [...pcfApps, ...allApps];
}

function refreshList(extendFrom?: number) {
  if (isDetailView) return;
  const loading = currentMode === "pcf" ? !pcfLoaded : !allLoaded;
  setLoading(loading);
  setApps(cachedApps(), extendFrom);
}

// ── Router ───────────────────────────────────────────────────

function route(hash: string) {
  if (detailCleanup) {
    detailCleanup();
    detailCleanup = null;
  }

  const [segment, param] = hash.split("/");

  if (segment === "detail" && param) {
    const app = cachedApps().find((a) => a.label === param);
    if (!app) {
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
          const a = cachedApps().find((x) => x.label === label);
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
          const a = cachedApps().find((x) => x.label === label);
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

    const innerCleanup = detailCleanup;
    detailCleanup = () => {
      innerCleanup();
      setDetailMode(false);
    };
  } else {
    isDetailView = false;
    currentMode = (segment as FilterMode) || "pcf";
    const loading = currentMode === "pcf" ? !pcfLoaded : !allLoaded;
    setLoading(loading);
    setApps(cachedApps());
    setMode(currentMode);
  }
}

window.addEventListener("hashchange", () => {
  route(location.hash.slice(1).toLowerCase());
});

// ── Data loading ─────────────────────────────────────────────

setLoading(true);

// PCF: prioritized — fires first, renders as soon as it arrives
getPcfApps().then((result) => {
  if (result.status === "ok" || result.status === "mock") {
    pcfApps = result.apps;
  }
  pcfLoaded = true;
  refreshList();
  const hash = location.hash.slice(1).toLowerCase();
  if (hash.startsWith("detail/")) route(hash);
});

// All: independent, slower — appends when ready
getAllApps().then((result) => {
  if (result.status === "ok" || result.status === "mock") {
    const prevCount = cachedApps().length;
    allApps = result.apps;
    allLoaded = true;
    refreshList(prevCount);
    const hash = location.hash.slice(1).toLowerCase();
    if (hash.startsWith("detail/")) route(hash);
  } else {
    allLoaded = true;
    if (pcfApps.length === 0) setStatus(result.message);
    refreshList();
  }
});

// Bootstrap: parse initial hash
route(location.hash.slice(1).toLowerCase());
