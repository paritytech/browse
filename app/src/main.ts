import {
  getPcfApps,
  getAllApps,
  type FilterMode,
  type AppEntry,
  fetchAttestations,
  checkUserVouch,
  vouchForApp,
  unvouchForApp,
} from "./data";
import { renderApp } from "./ui";
import { mountDetail } from "./detail";
import { setupDebugConsole } from "./debug";
import {
  getCachedPcf,
  getCachedAll,
  setCachedPcf,
  setCachedAll,
} from "./cache";
import "./style.css";

const root = document.querySelector("#app") as HTMLElement;
const { setApps, setLoading, setMode, showToast, getListEl, setDetailMode } =
  renderApp(root, (mode) => {
    currentMode = mode;
    const loading = mode === "pcf" ? !pcfLoaded : !allLoaded;
    setLoading(loading);
    if (mode === "all") syncAll();
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

    detailCleanup = mountDetail(
      listEl,
      app,
      {
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
            if (a) a.vouchCount = Math.max(0, (a.vouchCount ?? 0) - 1);
            showToast(`Unvouched ${label}.dot`);
          } else if (result.status === "no-wallet") {
            showToast("Sign in to unvouch");
          } else {
            showToast("Unvouch failed — try again");
          }
        },
        showToast,
      },
      fetchAttestations,
      checkUserVouch,
    );

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

// 1. Show cached data instantly, then sync in background
async function loadData() {
  const [cachedPcf, cachedAll] = await Promise.all([
    getCachedPcf(),
    getCachedAll(),
  ]);
  const hasCache = cachedPcf.length > 0 || cachedAll.length > 0;

  if (hasCache) {
    pcfApps = cachedPcf;
    allApps = cachedAll;
    pcfLoaded = cachedPcf.length > 0;
    allLoaded = cachedAll.length > 0;
    refreshList();
  } else {
    setLoading(true);
  }

  // 2. Always sync PCF in background (fast — single contract call)
  getPcfApps().then((result) => {
    if (result.status === "ok" || result.status === "mock") {
      pcfApps = result.apps;
      setCachedPcf(result.apps);
    }
    pcfLoaded = true;
    refreshList();
    const hash = location.hash.slice(1).toLowerCase();
    if (hash.startsWith("detail/")) route(hash);
  });

  // 3. All sync: always runs in background at concurrency=1 (low CPU)
  syncAll();
}

let allSyncStarted = false;

function syncAll() {
  if (allSyncStarted) return;
  allSyncStarted = true;

  getAllApps((progressApps) => {
    if (progressApps.length > allApps.length) {
      allApps = progressApps;
      setCachedAll(progressApps);
      refreshList();
    }
  }).then((result) => {
    if (result.status === "ok" || result.status === "mock") {
      allApps = result.apps;
      setCachedAll(result.apps);
    }
    allLoaded = true;
    refreshList();
    const hash = location.hash.slice(1).toLowerCase();
    if (hash.startsWith("detail/")) route(hash);
  });
}

loadData();

// Bootstrap: parse initial hash
route(location.hash.slice(1).toLowerCase());
