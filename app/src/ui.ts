import { type AppEntry, type FilterMode, filterApps } from "./data";
import { hostApi } from "@novasamatech/product-sdk";
import { renderSearchBar, initSearchBar } from "./components/search-bar/search-bar";
import { renderCategoryTabs, CATEGORIES, initCategoryTabs, positionIndicator } from "./components/category-tabs/category-tabs";
import { renderProductCard } from "./components/product-card/product-card";

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}



function renderEmpty(query: string): string {
  return `
    <div class="empty-state">
      <div class="empty-state__icon">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="14" cy="14" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M22 22l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
      <p class="empty-state__text">No products matching "${escHtml(query)}"</p>
      <p class="empty-state__hint">Try a different search term</p>
    </div>
  `;
}

export function renderApp(root: HTMLElement, onModeChange?: (mode: FilterMode) => void): {
  setApps: (apps: AppEntry[], extendFrom?: number) => void;
  setLoading: (loading: boolean) => void;
  setStatus: (message: string) => void;
  setMode: (mode: FilterMode) => void;
  showToast: (msg: string) => void;
  getListEl: () => HTMLElement;
  setDetailMode: (active: boolean) => void;
} {
  let currentApps: AppEntry[] = [];
  let currentQuery = "";
  let currentMode: FilterMode = "pcf";
  let shownCount = 0;
  let isLoading = true;

  root.innerHTML = `
    <div class="page">
      <div class="main">
        <div class="header">
          <h1 class="title"><span class="title__white">browse.</span><span class="title__muted">dot</span></h1>
          <p class="subtitle">products on polkadot</p>
        </div>

        <div class="card-flip" id="card-flip">
          <div class="card front" id="card-front">
            ${renderSearchBar()}

            ${renderCategoryTabs(currentMode)}

            <div class="app-list" id="app-list"></div>

            <div class="loading-dots" id="loading-dots">
              <span class="loading-dots__dot"></span>
              <span class="loading-dots__dot"></span>
              <span class="loading-dots__dot"></span>
            </div>

            <div class="list-count" id="list-count"></div>
          </div>

          <div class="card back" id="card-back">
            <div class="debug-header">
              <span class="debug-title">debug</span>
              <span class="debug-count" id="debug-count"></span>
            </div>
            <div class="debug-log" id="debug-log"></div>
          </div>
        </div>

        <div class="footer"></div>
      </div>
      <div class="toast" id="toast"></div>
    </div>
  `;

  const listEl = root.querySelector("#app-list") as HTMLElement;
  const dotsEl = root.querySelector("#loading-dots") as HTMLElement;
  const countEl = root.querySelector("#list-count") as HTMLElement;
  const searchInput = root.querySelector("#search-input") as HTMLInputElement;
  const filtersEl = root.querySelector("#category-tabs") as HTMLElement;
  const toastEl = root.querySelector("#toast") as HTMLElement;

  initSearchBar();
  initCategoryTabs();

  let toastTimeout: ReturnType<typeof setTimeout> | null = null;
  function showToast(message: string) {
    toastEl.textContent = message;
    toastEl.classList.add("toast--visible");
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastEl.classList.remove("toast--visible");
    }, 3000);
  }


  function navigateToDomain(label: string) {
    if (hostApi?.navigateTo) {
      hostApi.navigateTo({ tag: "v1", value: `${label}.dot` });
    } else {
      window.open(`https://${label}.dot.li`, "_blank", "noopener");
    }
  }

  listEl.addEventListener("click", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".product-card[data-label]");
    if (!card) return;
    e.preventDefault();
    const label = card.dataset.label;
    if (label) navigateToDomain(label);
  });

  listEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = (e.target as HTMLElement).closest<HTMLElement>(".product-card[data-label]");
    if (!card) return;
    e.preventDefault();
    const label = card.dataset.label;
    if (label) navigateToDomain(label);
  });

  let lastRenderedLabels: string[] = [];

  function updateList() {
    const filtered = filterApps(currentApps, currentQuery, currentMode);

    if (filtered.length === 0 && currentQuery) {
      listEl.innerHTML = renderEmpty(currentQuery);
      dotsEl.style.display = "none";
      lastRenderedLabels = [];
    } else if (filtered.length === 0) {
      listEl.innerHTML = "";
      dotsEl.style.display = isLoading ? "flex" : "none";
      lastRenderedLabels = [];
    } else {
      const newLabels = filtered.map((a) => a.label);
      const prevSet = new Set(lastRenderedLabels);

      // If the order/set changed entirely (mode switch, search), full re-render
      const isAppend = newLabels.length >= lastRenderedLabels.length &&
        lastRenderedLabels.every((l, i) => newLabels[i] === l);

      if (isAppend && lastRenderedLabels.length > 0) {
        // Append only the new cards
        const newApps = filtered.slice(lastRenderedLabels.length);
        const fragment = document.createDocumentFragment();
        const temp = document.createElement("div");
        temp.innerHTML = newApps.map((app, i) =>
          renderProductCard(app, i)
        ).join("");
        while (temp.firstChild) fragment.appendChild(temp.firstChild);
        listEl.appendChild(fragment);
      } else {
        // Full re-render (mode switch, search change, reorder)
        listEl.innerHTML = filtered.map((app, i) =>
          renderProductCard(app, prevSet.has(app.label) ? -1 : i)
        ).join("");
      }

      lastRenderedLabels = newLabels;
      shownCount = filtered.length;
    }

    const modeTotal = filterApps(currentApps, "", currentMode).length;
    if (modeTotal > 0) {
      countEl.textContent =
        currentQuery ? `${filtered.length} of ${modeTotal} products` : `${modeTotal} products`;
    } else {
      countEl.textContent = "";
    }
  }

  // Search input handler
  searchInput.addEventListener("input", () => {
    currentQuery = searchInput.value;
    updateList();
  });

  function switchMode(mode: FilterMode) {
    if (mode === currentMode) return;
    // Only switch to enabled modes
    const modeConfig = CATEGORIES.find((f) => f.id === mode);
    if (!modeConfig?.enabled) return;

    currentMode = mode;
    filtersEl.querySelectorAll(".category-tab").forEach((p) => {
      p.classList.toggle("category-tab--active", p.getAttribute("data-mode") === mode);
    });
    positionIndicator();
    onModeChange?.(mode);
    updateList();
  }

  // Filter pill clicks
  filtersEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn || btn.hasAttribute("disabled")) return;
    switchMode(btn.getAttribute("data-mode") as FilterMode);
  });

  return {
    setApps(apps: AppEntry[], extendFrom?: number) {
      if (extendFrom !== undefined) shownCount = extendFrom;
      currentApps = apps;
      updateList();
      if (apps.length > 0 && currentMode === "pcf") dotsEl.style.display = "none";
    },
    setLoading(loading: boolean) {
      isLoading = loading;
      dotsEl.style.display = loading ? "flex" : "none";
      if (loading) {
        listEl.innerHTML = "";
        countEl.textContent = "";
      }
    },
    setStatus(message: string) {
      listEl.innerHTML = `<p class="empty-state__text">${message}</p>`;
      countEl.textContent = "";
    },
    setMode: switchMode,
    showToast,
    getListEl: () => listEl,
    setDetailMode(active: boolean) {
      const display = active ? "none" : "";
      const searchWrap = root.querySelector(".search-wrap") as HTMLElement | null;
      const filters = root.querySelector(".category-tabs") as HTMLElement | null;
      const listCount = root.querySelector(".list-count") as HTMLElement | null;
      const loadingDots = root.querySelector("#loading-dots") as HTMLElement | null;
      if (searchWrap) searchWrap.style.display = display;
      if (filters) filters.style.display = display;
      if (listCount) listCount.style.display = display;
      if (loadingDots) loadingDots.style.display = display;
    },
  };
}
