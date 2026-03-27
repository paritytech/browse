import { type AppEntry, type FilterMode, displayName, filterApps, vouchForApp, isHosted } from "./data";

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderVouchBadge(count: number | null): string {
  if (count === null || count === 0) return "";
  return `<span class="app-card__vouches" title="${count} vouch${count === 1 ? "" : "es"}">
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M14 8c0-2.2-2.7-4-6-4S2 5.8 2 8c0 1.1.6 2.1 1.6 2.9L3 14l2.5-1.3c.8.2 1.6.3 2.5.3 3.3 0 6-1.8 6-4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    </svg>
    ${count}</span>`;
}

function renderAppCard(app: AppEntry, index: number): string {
  const instant = index < 0;
  const delay = instant ? 0 : index * 380;
  const statusClass = app.isLive ? "live" : "";
  const statusLabel = app.isLive ? "available" : "coming soon";
  const name = escHtml(displayName(app));
  const letter = escHtml(name[0].toLowerCase());
  const label = escHtml(app.label);

  return `
    <div class="app-card${instant ? " app-card--instant" : ""}" style="animation-delay: ${delay}ms" data-label="${label}" tabindex="0">
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
        <p class="app-card__desc">${escHtml(app.description)}</p>
        <span class="app-card__dotns">${label}.dot</span>
      </div>
      <div class="app-card__actions">
        <button class="vouch-btn" data-vouch="${label}" title="Vouch for this product">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 1v14M1 8h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
        <a class="app-card__arrow" href="https://${label}.dot.li" data-external="${label}" title="Open ${name}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </a>
      </div>
    </div>
  `;
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

const FILTER_MODES: { id: FilterMode; label: string; enabled: boolean }[] = [
  { id: "all", label: "All", enabled: true },
  { id: "popular", label: "Popular", enabled: true },
  { id: "curated", label: "Curated", enabled: false },
  { id: "attendee", label: "Attendee", enabled: false },
];

export function renderApp(root: HTMLElement): {
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
  let currentMode: FilterMode = "all";
  let shownCount = 0;

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
  const filtersEl = root.querySelector("#filters") as HTMLElement;
  const toastEl = root.querySelector("#toast") as HTMLElement;

  let toastTimeout: ReturnType<typeof setTimeout> | null = null;
  function showToast(message: string) {
    toastEl.textContent = message;
    toastEl.classList.add("toast--visible");
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastEl.classList.remove("toast--visible");
    }, 3000);
  }

  // Navigate: use host-api navigateTo when hosted, fall back to regular link.
  let hostNavigate: ((label: string) => void) | null = null;
  if (isHosted()) {
    import("@novasamatech/product-sdk").then((sdk) => {
      if (sdk.hostApi?.navigateTo) {
        hostNavigate = (label: string) => {
          sdk.hostApi.navigateTo({ tag: "v1", value: `${label}.dot` });
        };
      }
    }).catch(() => {});
  }

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
          showToast(`Vouched for ${label}.dot`);
        } else if (result.status === "no-wallet") {
          showToast("Sign in to vouch");
        } else {
          showToast("Vouch failed — try again");
          vouchBtn.classList.add("vouch-btn--error");
          setTimeout(() => vouchBtn.classList.remove("vouch-btn--error"), 1500);
        }
      });
      return;
    }

    // Card click → detail page (but not if clicking external link arrow)
    const card = (e.target as HTMLElement).closest<HTMLElement>(".app-card[data-label]");
    if (!card) return;
    const isExternalLink = (e.target as HTMLElement).closest("[data-external]");
    if (isExternalLink) {
      const label = (isExternalLink as HTMLElement).dataset.external;
      if (label && hostNavigate) {
        e.preventDefault();
        hostNavigate(label);
      }
      return;
    }
    e.preventDefault();
    const label = card.dataset.label;
    if (!label) return;
    location.hash = `detail/${label}`;
  });

  // Keyboard activation for focused cards (Enter/Space)
  listEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = (e.target as HTMLElement).closest<HTMLElement>(".app-card[data-label]");
    if (!card) return;
    e.preventDefault();
    const label = card.dataset.label;
    if (label) location.hash = `detail/${label}`;
  });

  function updateList() {
    const filtered = filterApps(currentApps, currentQuery, currentMode);

    if (filtered.length === 0 && currentQuery) {
      listEl.innerHTML = renderEmpty(currentQuery);
    } else if (filtered.length === 0) {
      listEl.innerHTML = "";
    } else {
      listEl.innerHTML = filtered.map((app, i) =>
        renderAppCard(app, i < shownCount ? -1 : i - shownCount)
      ).join("");
      shownCount = filtered.length;
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
    setApps(apps: AppEntry[], extendFrom?: number) {
      if (extendFrom !== undefined) shownCount = extendFrom;
      currentApps = apps;
      updateList();
    },
    setLoading(loading: boolean) {
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
      const filters = root.querySelector(".filters") as HTMLElement | null;
      const listCount = root.querySelector(".list-count") as HTMLElement | null;
      const loadingDots = root.querySelector("#loading-dots") as HTMLElement | null;
      if (searchWrap) searchWrap.style.display = display;
      if (filters) filters.style.display = display;
      if (listCount) listCount.style.display = display;
      if (loadingDots) loadingDots.style.display = display;
    },
  };
}
