import { render } from 'preact'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import '@fontsource-variable/martian-mono'

import { App } from './App'
import { prefetchAllApps } from './state/apps/queries'
import './styles/tokens.css'
import './styles/main.css'

const queryClient = new QueryClient()

// Lock in an explicit theme before first paint so React renders with the
// right tokens. The host's `createThemeProvider` overrides this once it
// pushes its preference. Standalone runs keep the OS choice.
document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches
  ? 'berlinNight'
  : 'berlinDay'

prefetchAllApps(queryClient)

render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
  document.getElementById('app')!
)
