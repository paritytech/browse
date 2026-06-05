import { createThemeProvider, type ThemeMode } from '@novasamatech/host-api-wrapper'

const KNOWN_THEMES = new Set(['berlinNight', 'berlinDay', 'lisbon', 'malta', 'tokyo'])

/**
 * Map the host's theme payload to one of our `data-theme` attribute values.
 */
export function resolveHostTheme(theme: ThemeMode): string {
  if (theme.name.tag === 'Custom' && KNOWN_THEMES.has(theme.name.value)) {
    return theme.name.value
  }
  return theme.variant === 'Light' ? 'berlinDay' : 'berlinNight'
}

/**
 * Lock in an explicit theme before first paint so the first render uses the
 * right tokens. A `?theme=` URL override wins. Otherwise the OS choice
 * applies. The host's theme provider overrides this once it pushes its
 * preference.
 */
export function applyInitialTheme(): void {
  const override = new URLSearchParams(window.location.search).get('theme')
  document.documentElement.dataset.theme =
    override ??
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'berlinNight' : 'berlinDay')
}

/**
 * Subscribe to the host theme and reflect it on `<html data-theme>`. A
 * `?theme=` URL override wins and skips the subscription. Returns an
 * unsubscribe function.
 */
export function subscribeHostTheme(): () => void {
  const override = new URLSearchParams(window.location.search).get('theme')
  if (override) {
    document.documentElement.dataset.theme = override
    return () => {}
  }
  const provider = createThemeProvider()
  const sub = provider.subscribeTheme((theme) => {
    document.documentElement.dataset.theme = resolveHostTheme(theme)
  })
  return () => sub.unsubscribe()
}
