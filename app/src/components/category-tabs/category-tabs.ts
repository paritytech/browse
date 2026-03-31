import { type FilterMode } from "../../data";
import "./styles.css";

export interface CategoryTab {
  id: FilterMode;
  label: string;
  enabled: boolean;
}

export const CATEGORIES: CategoryTab[] = [
  { id: "pcf", label: "PCF", enabled: true },
  { id: "all", label: "All", enabled: true },
];

export function renderCategoryTabs(activeMode: FilterMode): string {
  return `
    <div class="category-tabs" id="category-tabs">
      <div class="category-tabs__indicator" id="tabs-indicator"></div>
      ${CATEGORIES.map(
        (tab) => `
        <button
          class="category-tab${tab.id === activeMode ? " category-tab--active" : ""}${!tab.enabled ? " category-tab--disabled" : ""}"
          data-mode="${tab.id}"
          ${!tab.enabled ? "disabled" : ""}
        >${tab.label}</button>
      `,
      ).join("")}
    </div>
  `;
}

export function initCategoryTabs(): void {
  requestAnimationFrame(() => positionIndicator(false));
}

export function positionIndicator(animate = true): void {
  const container = document.getElementById("category-tabs");
  const indicator = document.getElementById("tabs-indicator");
  if (!container || !indicator) return;

  const active = container.querySelector<HTMLElement>(".category-tab--active");
  if (!active) {
    indicator.style.opacity = "0";
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();

  if (!animate) indicator.style.transition = "none";

  indicator.style.width = `${activeRect.width}px`;
  indicator.style.transform = `translateX(${activeRect.left - containerRect.left}px)`;
  indicator.style.opacity = "1";

  if (!animate) {
    // Force reflow then re-enable transitions
    indicator.offsetHeight;
    indicator.style.transition = "";
  }
}
