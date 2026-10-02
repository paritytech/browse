import { render } from 'preact'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import '@fontsource-variable/martian-mono'

import { App } from './App'
import { resetBrowseSdk } from './lib/client'
import { redirectToApp } from './lib/navigate'
import { addPendingRecommend } from './lib/pending-recommend'
import { parseSharedApp } from './lib/share-link'
import { applyInitialTheme } from './lib/theme'
import { prefetchAllApps } from './state/apps/queries'
import './styles/tokens.css'
import './styles/main.css'

const queryClient = new QueryClient()

if (import.meta.env.DEV) {
  window.__queryClient = queryClient
}

// A `?app=<domain>` share link is a pass-through: record the intent so we can
// ask for a recommendation on a later visit, strip the params so a reload or
// return never re-fires, then send the user into the app. navigateTo opens the
// app as a new page and leaves browse mounted behind it, so browse still
// renders below and shows the deferred prompt when the user comes back.
const sharedApp = parseSharedApp(window.location.search)
if (sharedApp) {
  addPendingRecommend(sharedApp.label, sharedApp.from)
  const url = new URL(window.location.href)
  url.searchParams.delete('app')
  url.searchParams.delete('from')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  redirectToApp(sharedApp.label)
}

// The host tears the network WebSocket down while the app is backgrounded and
// rebuilds it on return, which orphans the existing subscription. Drop the
// stale SDK on foreground so the next network access rebuilds on the fresh
// connection instead of hanging on the dead one.
document.addEventListener('visibilitychange', () => {
  console.warn(
    'debug network connection',
    JSON.stringify({ event: 'visibilitychange', state: document.visibilityState })
  )
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
