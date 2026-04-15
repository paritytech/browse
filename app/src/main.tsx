import { render } from 'preact'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { App } from './App'
import { prefetchAllApps, prefetchPcfApps } from './state/apps/queries'
import './style.css'

const queryClient = new QueryClient()

// Prefetch
prefetchPcfApps(queryClient)
prefetchAllApps(queryClient)

render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
  document.getElementById('app')!
)
