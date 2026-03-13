// Debug console — triple-click anywhere to flip the card.

const MAX_ENTRIES = 200;
const entries: { time: number; level: string; msg: string }[] = [];
const t0 = performance.now();

// Whether the debug panel is currently visible (flipped open).
let panelVisible = false;
// Cached reference to the log DOM element, set once setupDebugConsole runs.
let logEl: HTMLElement | null = null;
let countEl: HTMLElement | null = null;

export function dlog(msg: string, level: "info" | "warn" | "error" = "info") {
  const time = performance.now() - t0;

  // Enforce hard cap: drop oldest entry from both array and DOM.
  if (entries.length >= MAX_ENTRIES) {
    entries.shift();
    if (logEl && logEl.firstChild) {
      logEl.removeChild(logEl.firstChild);
    }
  }

  entries.push({ time, level, msg });

  if (level === "error") console.error(`[browse.dot] ${msg}`);
  else if (level === "warn") console.warn(`[browse.dot] ${msg}`);
  else console.log(`[browse.dot] ${msg}`);

  // Append to DOM only when panel is visible — O(1) per call.
  if (panelVisible && logEl) {
    logEl.appendChild(makeEntryEl({ time, level, msg }));
    if (countEl) countEl.textContent = `${entries.length} entries`;
    // Defer scroll to avoid forced layout during the same task.
    requestAnimationFrame(() => {
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    });
  }
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function makeEntryEl(e: { time: number; level: string; msg: string }): HTMLElement {
  const div = document.createElement("div");
  div.className = `debug-entry debug-entry--${e.level}`;
  const timeSpan = document.createElement("span");
  timeSpan.className = "debug-time";
  timeSpan.textContent = formatTime(e.time);
  div.appendChild(timeSpan);
  div.appendChild(document.createTextNode(e.msg));
  return div;
}

/** One-shot render of all buffered entries using a DocumentFragment (called on flip-open). */
function renderAll() {
  if (!logEl || !countEl) return;
  const frag = document.createDocumentFragment();
  for (const e of entries) {
    frag.appendChild(makeEntryEl(e));
  }
  logEl.innerHTML = "";
  logEl.appendChild(frag);
  countEl.textContent = `${entries.length} entries`;
  requestAnimationFrame(() => {
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  });
}

export function setupDebugConsole(_root: HTMLElement) {
  const flipEl = document.getElementById("card-flip");
  logEl = document.getElementById("debug-log");
  countEl = document.getElementById("debug-count");
  if (!flipEl || !logEl || !countEl) return;

  function toggle() {
    panelVisible = !panelVisible;
    if (panelVisible) {
      // One-shot render of buffered entries.
      renderAll();
      // Defer the scrollHeight measurement so the browser has laid out the
      // newly-rendered content before we read its dimensions.
      requestAnimationFrame(() => {
        const backEl = document.getElementById("card-back");
        if (backEl) flipEl!.style.minHeight = backEl.scrollHeight + "px";
      });
    } else {
      flipEl!.style.minHeight = "";
    }
    flipEl!.classList.toggle("flipped", panelVisible);
  }

  // Triple-click on the background (outside the card) to flip
  let clickCount = 0;
  let clickTimer: ReturnType<typeof setTimeout> | null = null;

  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    // Only count clicks on the background — .page, .main, .header, .footer, body
    const isBackground =
      target.classList.contains("page") ||
      target.classList.contains("main") ||
      target.classList.contains("header") ||
      target.classList.contains("footer") ||
      target.classList.contains("subtitle") ||
      target.classList.contains("title") ||
      target === document.body;
    if (!isBackground) return;

    clickCount++;
    if (clickCount === 3) {
      clickCount = 0;
      if (clickTimer) clearTimeout(clickTimer);
      toggle();
    } else {
      if (clickTimer) clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        clickCount = 0;
      }, 500);
    }
  });
}
