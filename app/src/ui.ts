import { type AppEntry, type FilterMode, displayName, filterApps } from "./data";

function renderAppCard(app: AppEntry, index: number): string {
  const delay = index * 50;
  const statusClass = app.isLive ? "live" : "";
  const statusLabel = app.isLive ? "available" : "coming soon";
  const name = displayName(app);
  const letter = name[0].toLowerCase();

  return `
    <a class="app-card" style="animation-delay: ${delay}ms" href="https://${app.label}.dot.li" target="_blank" rel="noopener">
      <div class="app-card__icon">
        <span class="app-card__letter">${letter}</span>
      </div>
      <div class="app-card__body">
        <div class="app-card__top">
          <span class="app-card__name">${name}</span>
          <div class="app-card__status">
            <span class="app-card__dot ${statusClass}"></span>
            <span class="app-card__status-text">${statusLabel}</span>
          </div>
        </div>
        <p class="app-card__desc">${app.description}</p>
        <span class="app-card__dotns">${app.label}.dot</span>
      </div>
      <div class="app-card__arrow">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
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
  { id: "curated", label: "Curated", enabled: false },
  { id: "attendee", label: "Attendee", enabled: false },
  { id: "popular", label: "Popular", enabled: false },
];

export function renderApp(root: HTMLElement): {
  setApps: (apps: AppEntry[]) => void;
  setLoading: (loading: boolean) => void;
  setStatus: (message: string) => void;
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

  function updateList() {
    const filtered = filterApps(currentApps, currentQuery);

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

  // Filter pill clicks
  filtersEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn || btn.hasAttribute("disabled")) return;

    const mode = btn.getAttribute("data-mode") as FilterMode;
    if (mode === currentMode) return;

    currentMode = mode;
    filtersEl.querySelectorAll(".pill").forEach((p) => {
      p.classList.toggle("pill--selected", p.getAttribute("data-mode") === mode);
    });
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
  };
}
