import "./styles.css";

export function renderSearchBar(placeholder = "Search"): string {
  return `
    <div class="search-bar" id="search-bar">
      <svg class="search-bar__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/>
        <path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
      <span class="search-bar__placeholder">${placeholder}</span>
      <input
        id="search-input"
        class="search-bar__input"
        type="text"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
  `;
}

export function initSearchBar(): void {
  const wrap = document.getElementById("search-bar");
  const input = document.getElementById(
    "search-input",
  ) as HTMLInputElement | null;
  if (!wrap || !input) return;

  input.addEventListener("input", () => {
    wrap.classList.toggle("search-bar--has-value", input.value.length > 0);
  });

  input.addEventListener("focus", () => {
    wrap.classList.add("search-bar--focus");
  });

  input.addEventListener("blur", () => {
    wrap.classList.remove("search-bar--focus");
  });
}
