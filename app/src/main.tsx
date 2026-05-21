import { render } from 'preact'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { App } from './App'
import { prefetchAllApps } from './state/apps/queries'
import './styles/main.css'

const queryClient = new QueryClient()

prefetchAllApps(queryClient)

render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
  document.getElementById('app')!
)
