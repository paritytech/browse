import { render } from 'preact'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import '@fontsource-variable/martian-mono'

import { App } from './App'
import { resetBrowseSdk } from './lib/client'
import { applyInitialTheme } from './lib/theme'
import { prefetchAllApps } from './state/apps/queries'
import './styles/tokens.css'
import './styles/main.css'

const queryClient = new QueryClient()

if (import.meta.env.DEV) {
  window.__queryClient = queryClient
}

// The host tears the network WebSocket down while the app is backgrounded and
// rebuilds it on return, which orphans the existing subscription. Drop the
// stale SDK on foreground so the next network access
// rebuilds on the fresh connection instead of hanging on the dead one.
document.addEventListener('visibilitychange', () => {
  console.warn(
    'debug network connection',
    JSON.stringify({ event: 'visibilitychange', state: document.visibilityState })
  )
  if (document.visibilityState === 'visible') resetBrowseSdk()
})

applyInitialTheme()
prefetchAllApps(queryClient)

render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
  document.getElementById('app')!
)
