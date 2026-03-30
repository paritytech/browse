import { type AppEntry, displayName } from "../../data";
import "./styles.css";

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a product card matching the Browse mockup:
 *   [ thumbnail ]  Name
 *                  Description text clipped to 2 lines...
 */
export function renderProductCard(app: AppEntry, index: number): string {
  const instant = index < 0;
  const delay = instant ? 0 : index * 100;
  const name = escHtml(displayName(app));
  const letter = escHtml(name[0].toLowerCase());
  const label = escHtml(app.label);
  const desc = escHtml(app.description);

  return `
    <div class="product-card${instant ? " product-card--instant" : ""}" style="animation-delay: ${delay}ms" data-label="${label}" tabindex="0">
      <div class="product-card__thumb">
        <span class="product-card__letter">${letter}</span>
      </div>
      <div class="product-card__body">
        <span class="product-card__name">${name}</span>
        <p class="product-card__desc">${desc}</p>
      </div>
    </div>
  `;
}

export function renderProductCardSkeleton(): string {
  return `
    <div class="product-card product-card--skeleton">
      <div class="product-card__thumb skeleton-pulse"></div>
      <div class="product-card__body">
        <span class="skeleton-line skeleton-line--title skeleton-pulse"></span>
        <span class="skeleton-line skeleton-line--desc skeleton-pulse"></span>
        <span class="skeleton-line skeleton-line--desc skeleton-pulse" style="width:55%"></span>
      </div>
    </div>
  `;
}
