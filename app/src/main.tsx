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
// stale SDK on foreground so the next network access rebuilds on the fresh
// connection instead of hanging on the dead one.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resetBrowseSdk(true)
})

// The mobile host reliably calls __resumeConnections__ on willEnterForeground,
// but visibilitychange sometimes doesn't fire after a
// real-device resume. Wrap the resume signal to also reset the SDK so we
// don't keep using chainHead subscription IDs from the previous server
// session.
queueMicrotask(() => {
  const originalResume = window.__resumeConnections__
  window.__resumeConnections__ = () => {
    resetBrowseSdk(true)
    originalResume?.()
  }
})

applyInitialTheme()
prefetchAllApps(queryClient)

render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
  document.getElementById('app')!
)
