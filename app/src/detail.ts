import { type AppEntry, displayName, type AttestationDetail, type FetchAttestationsResult } from "./data";
import { hostApi } from "@novasamatech/product-sdk";

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface DetailCallbacks {
  onBack: () => void;
  onVouch: (label: string) => Promise<void>;
  onUnvouch: (label: string) => Promise<void>;
  showToast: (msg: string) => void;
}

// ── Render helpers (return HTML strings) ─────────────────────

function renderBackButton(): string {
  return `<button class="detail-back" id="detail-back" aria-label="Back to directory">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M10 3l-5 5 5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    Back
  </button>`;
}

function renderHero(app: AppEntry): string {
  const name = escHtml(displayName(app));
  const letter = escHtml(name[0].toLowerCase());
  const label = escHtml(app.label);
  const statusClass = app.isLive ? "live" : "";
  const statusLabel = app.isLive ? "available" : "coming soon";

  return `<div class="detail-hero">
    <div class="detail-icon">
      <span class="detail-icon__letter">${letter}</span>
    </div>
    <div class="detail-title-block">
      <span class="detail-name">${name}</span>
      <span class="detail-domain">${label}.dot</span>
      <div class="detail-status">
        <span class="app-card__dot ${statusClass}"></span>
        <span class="app-card__status-text">${statusLabel}</span>
      </div>
    </div>
    <button class="detail-open" id="detail-open" title="Open ${name}">
      Open
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>`;
}

function renderDescription(app: AppEntry): string {
  if (!app.description || app.description === "No description") return "";
  return `<p class="detail-desc">${escHtml(app.description)}</p>`;
}

function renderContentHash(app: AppEntry): string {
  if (!app.contentHash) return "";
  return `<div class="detail-hash">
    <span class="detail-hash__label">IPFS</span>
    ${escHtml(app.contentHash)}
  </div>`;
}

function renderVouchSection(vouchCount: number | null, hasVouched: boolean | null): string {
  const count = vouchCount ?? 0;
  const label = count === 1 ? "vouch" : "vouches";

  let buttonHtml: string;
  if (hasVouched === null) {
    buttonHtml = `<button class="vouch-toggle" id="vouch-toggle" disabled>Sign in to vouch</button>`;
  } else if (hasVouched) {
    buttonHtml = `<button class="vouch-toggle vouch-toggle--active" id="vouch-toggle">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Vouched
    </button>`;
  } else {
    buttonHtml = `<button class="vouch-toggle" id="vouch-toggle">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M8 1v14M1 8h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      Vouch
    </button>`;
  }

  return `<div class="detail-vouch-section">
    <div class="detail-vouch-count">
      <span class="detail-vouch-count__number">${count}</span>
      <span class="detail-vouch-count__label">${label}</span>
    </div>
    ${buttonHtml}
  </div>`;
}

function renderAttesterSkeleton(): string {
  return Array.from({ length: 3 })
    .map(() => `<div class="attester-row attester-row--skeleton">
      <span class="attester-row__addr skeleton-pulse" style="width:60%;height:12px;border-radius:4px;background:var(--color-border-subtle)"></span>
      <span class="attester-row__date skeleton-pulse" style="width:50px;height:10px;border-radius:4px;background:var(--color-border-subtle)"></span>
    </div>`)
    .join("");
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "—";
  const d = new Date(timestamp * 1000);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function renderRatingDots(rating: number): string {
  return Array.from({ length: 5 })
    .map((_, i) => `<span class="rating-dot ${i < rating ? "rating-dot--filled" : ""}"></span>`)
    .join("");
}

function renderAttesterList(attestations: AttestationDetail[]): string {
  if (attestations.length === 0) {
    return `<div class="attester-empty">No vouches yet — be the first!</div>`;
  }

  return `<div class="attester-list">${attestations
    .map(
      (a) => `<div class="attester-row">
        <span class="attester-row__addr" title="${escHtml(a.attester)}">${escHtml(a.attester.slice(0, 6))}...${escHtml(a.attester.slice(-4))}</span>
        <span class="attester-row__date">${formatDate(a.timestamp)}</span>
        <span class="attester-row__rating">${renderRatingDots(a.rating)}</span>
      </div>`,
    )
    .join("")}</div>`;
}

// ── Mount ────────────────────────────────────────────────────

/**
 * Mount the detail page into `container`.
 * Returns a cleanup function to call before unmounting.
 */
export function mountDetail(
  container: HTMLElement,
  app: AppEntry,
  callbacks: DetailCallbacks,
  fetchAttestationsFn: (label: string) => Promise<FetchAttestationsResult>,
  checkUserVouchFn: (label: string) => Promise<boolean | null>,
): () => void {
  let cancelled = false;
  let hasVouched: boolean | null = null;

  // Render initial static content + skeletons
  container.innerHTML = `
    <div class="detail-page">
      ${renderBackButton()}
      ${renderHero(app)}
      ${renderDescription(app)}
      ${renderContentHash(app)}
      <hr class="detail-divider" />
      <div id="detail-vouch-section">
        ${renderVouchSection(app.vouchCount, null)}
      </div>
      <hr class="detail-divider" />
      <span class="detail-section-title">Vouchers</span>
      <div id="detail-attester-list">
        ${renderAttesterSkeleton()}
      </div>
    </div>
  `;

  // Wire back button
  const backBtn = container.querySelector("#detail-back") as HTMLElement;
  const onBackClick = () => callbacks.onBack();
  backBtn?.addEventListener("click", onBackClick);

  // Wire open button
  const openBtn = container.querySelector("#detail-open") as HTMLButtonElement | null;
  const onOpenClick = () => {
    if (hostApi?.navigateTo) {
      hostApi.navigateTo({ tag: "v1", value: `${app.label}.dot` });
    } else {
      window.open(`https://${app.label}.dot.li`, "_blank", "noopener");
    }
  };
  openBtn?.addEventListener("click", onOpenClick);

  // Wire vouch toggle
  function wireVouchToggle() {
    const toggleBtn = container.querySelector("#vouch-toggle") as HTMLButtonElement | null;
    if (!toggleBtn) return;

    const onToggle = async () => {
      if (toggleBtn.disabled) return;
      toggleBtn.disabled = true;
      toggleBtn.classList.add("vouch-toggle--pending");

      if (hasVouched) {
        await callbacks.onUnvouch(app.label);
      } else {
        await callbacks.onVouch(app.label);
      }

      if (cancelled) return;

      // Re-check vouch state and attestation list in parallel
      const [newVouched, attestResult] = await Promise.all([
        checkUserVouchFn(app.label),
        fetchAttestationsFn(app.label),
      ]);
      if (cancelled) return;

      hasVouched = newVouched;
      const newCount = attestResult.status === "ok" ? attestResult.total : (app.vouchCount ?? 0);
      // Deliberately mutate shared AppEntry so directory view stays in sync
      app.vouchCount = newCount;

      // Re-render vouch section and attester list
      const vouchSection = container.querySelector("#detail-vouch-section");
      if (vouchSection) vouchSection.innerHTML = renderVouchSection(newCount, hasVouched);

      const attesterListEl = container.querySelector("#detail-attester-list");
      if (attesterListEl && attestResult.status === "ok") {
        attesterListEl.innerHTML = renderAttesterList(attestResult.attestations);
      }

      wireVouchToggle(); // re-wire the new button
    };

    toggleBtn.addEventListener("click", onToggle);
  }

  wireVouchToggle();

  // Async: fetch attestations + check user vouch in parallel
  Promise.all([
    fetchAttestationsFn(app.label),
    checkUserVouchFn(app.label),
  ]).then(([attestResult, userVouched]) => {
    if (cancelled) return;

    hasVouched = userVouched;

    // Update vouch section with resolved state
    const vouchSection = container.querySelector("#detail-vouch-section");
    const count = attestResult.status === "ok" ? attestResult.total : (app.vouchCount ?? 0);
    if (vouchSection) vouchSection.innerHTML = renderVouchSection(count, hasVouched);

    // Replace skeleton with attester list
    const attesterListEl = container.querySelector("#detail-attester-list");
    if (attesterListEl) {
      if (attestResult.status === "ok") {
        attesterListEl.innerHTML = renderAttesterList(attestResult.attestations);
      } else if (attestResult.status === "empty") {
        attesterListEl.innerHTML = renderAttesterList([]);
      } else {
        attesterListEl.innerHTML = `<div class="attester-empty">Failed to load vouchers</div>`;
      }
    }

    wireVouchToggle(); // re-wire with updated state
  });

  // Return cleanup function
  return () => {
    cancelled = true;
    backBtn?.removeEventListener("click", onBackClick);
    openBtn?.removeEventListener("click", onOpenClick);
  };
}
