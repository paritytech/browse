import { render } from 'preact'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import '@fontsource-variable/martian-mono'

import { App } from './App'
import { applyInitialTheme } from './lib/theme'
import { prefetchAllApps } from './state/apps/queries'
import './styles/tokens.css'
import './styles/main.css'

const queryClient = new QueryClient()

if (import.meta.env.DEV) {
  window.__queryClient = queryClient
}

applyInitialTheme()
prefetchAllApps(queryClient)

render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
  document.getElementById('app')!
)
