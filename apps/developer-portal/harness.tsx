import '@fontsource-variable/inter'
import './src/styles/tokens.css'
import './src/styles/app.css'

document.getElementById('app')!.innerHTML = `
  <div class="app"><div class="shell">
    <aside class="sidebar">
      <span class="sidebar-mark"></span>
      <nav class="nav">
        <button type="button" class="nav-item active">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05"/><path d="M12 22.08V12"/></svg>
          <span class="nav-label">Products</span>
        </button>
        <button type="button" class="nav-item nav-disabled" disabled>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>
          <span class="nav-label">Certificates</span>
          <span class="nav-badge">Coming soon</span>
        </button>
      </nav>
    </aside>
  </div></div>`
