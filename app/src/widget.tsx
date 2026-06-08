import { render } from 'preact'

import { useEffect, useMemo, useState } from 'preact/hooks'

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'

import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import '@fontsource-variable/martian-mono'

import { CardExplore } from './components/card-explore'
import { WidgetCard } from './components/widget-card'
import { SELF_LABEL } from './lib/identity'
import { navigateToDomain } from './lib/navigate'
import { applyInitialTheme, subscribeHostTheme } from './lib/theme'
import { prefetchAllApps, useGetAllApps } from './state/apps/queries'
import { filterApps } from './state/apps/types'
import './styles/tokens.css'
import './styles/main.css'
import './styles/widget.css'

// The four dashboard presets the host can mount this widget at. The host doesn't
// tell the widget which one it picked, so we infer it from our own viewport: only
// the `horizontal` preset is two columns wide, and the single-column presets are
// told apart by height (2 / 4 / 8 grid rows).
type WidgetSize = 'small' | 'medium' | 'large' | 'horizontal'

// Product tiles shown per preset. One slot is always reserved on top of these for
// the "Explore all" tile (the 2nd / 4th / 10th / 8th position respectively).
const APP_CAP: Record<WidgetSize, number> = {
  small: 1,
  medium: 3,
  large: 9,
  horizontal: 7
}

function classifyWidgetSize(width: number, height: number): WidgetSize {
  if (width >= 500) return 'horizontal'
  if (height < 320) return 'small'
  if (height < 630) return 'medium'
  return 'large'
}

function useWidgetSize(): WidgetSize {
  const [size, setSize] = useState(() => classifyWidgetSize(window.innerWidth, window.innerHeight))

  useEffect(() => {
    const update = () => setSize(classifyWidgetSize(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return size
}

function Widget() {
  const queryClient = useQueryClient()
  const size = useWidgetSize()

  const { data: allApps = [], isFetching } = useGetAllApps(queryClient)

  useEffect(() => subscribeHostTheme(), [])

  const apps = useMemo(
    () => filterApps(allApps, '', 'all').filter((app) => app.label !== SELF_LABEL),
    [allApps]
  )

  const visible = apps.slice(0, APP_CAP[size])
  const openSpa = () => navigateToDomain(SELF_LABEL)

  // Nothing to show until the first fetch settles. This avoids a lone "Explore
  // all" tile flashing before the products arrive.
  if (isFetching && apps.length === 0) {
    return <div class='widget' />
  }

  return (
    <div class='widget'>
      <div class={`widget__grid widget__grid--${size}`}>
        {visible.map((app, i) => (
          <WidgetCard key={app.label} app={app} index={i} onClick={navigateToDomain} />
        ))}
        <CardExplore index={visible.length} onClick={openSpa} />
      </div>
    </div>
  )
}

const queryClient = new QueryClient()

applyInitialTheme()
prefetchAllApps(queryClient)

render(
  <QueryClientProvider client={queryClient}>
    <Widget />
  </QueryClientProvider>,
  document.getElementById('app')!
)
