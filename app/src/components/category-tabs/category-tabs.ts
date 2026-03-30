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
