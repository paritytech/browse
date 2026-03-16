import { type AppEntry, type FilterMode, displayName, filterApps, vouchForApp } from "./data";

function renderVouchBadge(count: number | null): string {
  if (count === null || count === 0) return "";
  return `<span class="app-card__vouches" title="${count} vouch${count === 1 ? "" : "es"}">
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M14 8c0-2.2-2.7-4-6-4S2 5.8 2 8c0 1.1.6 2.1 1.6 2.9L3 14l2.5-1.3c.8.2 1.6.3 2.5.3 3.3 0 6-1.8 6-4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    </svg>
    ${count}</span>`;
}

function renderAppCard(app: AppEntry, index: number): string {
  const delay = index * 50;
  const statusClass = app.isLive ? "live" : "";
  const statusLabel = app.isLive ? "available" : "coming soon";
  const name = displayName(app);
  const letter = name[0].toLowerCase();

  return `
    <a class="app-card" style="animation-delay: ${delay}ms" data-label="${app.label}" href="https://${app.label}.dot.li">
      <div class="app-card__icon">
        <span class="app-card__letter">${letter}</span>
      </div>
      <div class="app-card__body">
        <div class="app-card__top">
          <span class="app-card__name">${name}</span>
          <div class="app-card__status">
            <span class="app-card__dot ${statusClass}"></span>
            <span class="app-card__status-text">${statusLabel}</span>
            ${renderVouchBadge(app.vouchCount)}
          </div>
        </div>
        <p class="app-card__desc">${app.description}</p>
        <span class="app-card__dotns">${app.label}.dot</span>
      </div>
      <div class="app-card__actions">
        <button class="vouch-btn" data-vouch="${app.label}" title="Vouch for this product">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 1v14M1 8h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
        <div class="app-card__arrow">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>
    </a>
  `;
}

function renderSkeletons(count: number): string {
  return Array.from({ length: count })
    .map(
      (_, i) => `
    <div class="app-card app-card--skeleton" style="animation-delay: ${i * 50}ms">
      <div class="app-card__icon skeleton-pulse"></div>
      <div class="app-card__body">
        <div class="skeleton-line skeleton-line--title skeleton-pulse"></div>
        <div class="skeleton-line skeleton-line--desc skeleton-pulse"></div>
        <div class="skeleton-line skeleton-line--meta skeleton-pulse"></div>
      </div>
    </div>
  `
    )
    .join("");
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
      <p class="empty-state__text">No products matching "${query}"</p>
      <p class="empty-state__hint">Try a different search term</p>
    </div>
  `;
}

const FILTER_MODES: { id: FilterMode; label: string; enabled: boolean }[] = [
  { id: "all", label: "All", enabled: true },
  { id: "popular", label: "Popular", enabled: true },
  { id: "curated", label: "Curated", enabled: false },
  { id: "attendee", label: "Attendee", enabled: false },
];

export function renderApp(root: HTMLElement): {
  setApps: (apps: AppEntry[]) => void;
  setLoading: (loading: boolean) => void;
  setStatus: (message: string) => void;
  setMode: (mode: FilterMode) => void;
} {
  let currentApps: AppEntry[] = [];
  let currentQuery = "";
  let currentMode: FilterMode = "all";

  root.innerHTML = `
    <div class="page">
      <div class="main">
        <div class="header">
          <h1 class="title"><span class="title__white">browse.</span><span class="title__muted">dot</span></h1>
          <p class="subtitle">products on polkadot</p>
        </div>

        <div class="card-flip" id="card-flip">
          <div class="card front" id="card-front">
            <div class="search-wrap">
              <svg class="search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/>
                <path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
              <input
                id="search-input"
                class="search-input"
                type="text"
                placeholder="Search products..."
                autocomplete="off"
                spellcheck="false"
              />
            </div>

            <div class="filters" id="filters">
              ${FILTER_MODES.map(
                (f) => `
                <button
                  class="pill ${f.id === currentMode ? "pill--selected" : ""} ${!f.enabled ? "pill--disabled" : ""}"
                  data-mode="${f.id}"
                  ${!f.enabled ? "disabled" : ""}
                >
                  ${f.label}${!f.enabled ? '<span class="pill__soon">soon</span>' : ""}
                </button>
              `
              ).join("")}
            </div>

            <div class="app-list" id="app-list">
              ${renderSkeletons(5)}
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
    </div>
  `;

  const listEl = root.querySelector("#app-list") as HTMLElement;
  const countEl = root.querySelector("#list-count") as HTMLElement;
  const searchInput = root.querySelector("#search-input") as HTMLInputElement;
  const filtersEl = root.querySelector("#filters") as HTMLElement;

  // Navigate: use host-api navigateTo when hosted, fall back to regular link.
  // host-rs handles "label.dot" → resolves and opens in a new tab.
  // dotli handles it via window.open to dot.li gateway.
  let hostNavigate: ((label: string) => void) | null = null;
  import("@novasamatech/product-sdk").then((sdk) => {
    // Only use navigateTo in host-rs (dotapp:// protocol).
    // In dotli (http/https), let the <a href> to dot.li gateway work.
    if (sdk.hostApi?.navigateTo && location.protocol === "dotapp:") {
      hostNavigate = (label: string) => {
        sdk.hostApi.navigateTo({ tag: "v1", value: `${label}.dot` });
      };
    }
  }).catch(() => { /* not hosted — links fall through to href */ });

  // Vouch button handler — intercepts before navigation
  listEl.addEventListener("click", (e) => {
    const vouchBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(".vouch-btn[data-vouch]");
    if (vouchBtn) {
      e.preventDefault();
      e.stopPropagation();
      const label = vouchBtn.dataset.vouch!;
      vouchBtn.disabled = true;
      vouchBtn.classList.add("vouch-btn--pending");

      vouchForApp(label).then((result) => {
        vouchBtn.disabled = false;
        vouchBtn.classList.remove("vouch-btn--pending");

        if (result.status === "ok") {
          // Optimistic update: bump the count in the local data
          const app = currentApps.find((a) => a.label === label);
          if (app) {
            app.vouchCount = (app.vouchCount ?? 0) + 1;
            updateList();
          }
        } else {
          // Brief flash to indicate failure
          vouchBtn.classList.add("vouch-btn--error");
          setTimeout(() => vouchBtn.classList.remove("vouch-btn--error"), 1500);
        }
      });
      return;
    }

    // Navigation handler
    const card = (e.target as HTMLElement).closest<HTMLAnchorElement>(".app-card[data-label]");
    if (!card) return;
    const label = card.dataset.label;
    if (!label) return;
    if (hostNavigate) {
      e.preventDefault();
      hostNavigate(label);
    }
    // Otherwise: default <a> behavior opens the dot.li URL
  });

  function updateList() {
    const filtered = filterApps(currentApps, currentQuery, currentMode);

    if (filtered.length === 0 && currentQuery) {
      listEl.innerHTML = renderEmpty(currentQuery);
    } else if (filtered.length === 0) {
      listEl.innerHTML = renderSkeletons(5);
    } else {
      listEl.innerHTML = filtered.map((app, i) => renderAppCard(app, i)).join("");
    }

    if (currentApps.length > 0) {
      const showing = filtered.length;
      const total = currentApps.length;
      countEl.textContent =
        currentQuery ? `${showing} of ${total} products` : `${total} products`;
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
    const modeConfig = FILTER_MODES.find((f) => f.id === mode);
    if (!modeConfig?.enabled) return;

    currentMode = mode;
    filtersEl.querySelectorAll(".pill").forEach((p) => {
      p.classList.toggle("pill--selected", p.getAttribute("data-mode") === mode);
    });
    updateList();
  }

  // Filter pill clicks
  filtersEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn || btn.hasAttribute("disabled")) return;
    switchMode(btn.getAttribute("data-mode") as FilterMode);
  });

  return {
    setApps(apps: AppEntry[]) {
      currentApps = apps;
      updateList();
    },
    setLoading(loading: boolean) {
      if (loading) {
        listEl.innerHTML = renderSkeletons(5);
        countEl.textContent = "";
      }
    },
    setStatus(message: string) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/>
            </svg>
          </div>
          <p class="empty-state__text">${message}</p>
        </div>
      `;
      countEl.textContent = "";
    },
    setMode: switchMode,
  };
}
