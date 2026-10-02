import { expect, test } from 'bun:test'

import { resolveHostTheme } from './theme-resolve'

const custom = (value: string, variant: 'Light' | 'Dark') => ({
  name: { tag: 'Custom' as const, value },
  variant
})
const preset = (variant: 'Light' | 'Dark') => ({
  name: { tag: 'Default' as const, value: undefined },
  variant
})

// The host sends `name` (theme family) and `variant` (Light/Dark) as two
// independent axes. `resolveHostTheme` must honour BOTH — the previous version
// dropped `variant` whenever a Custom family was present, so dark never applied
// to tokyo/lisbon/malta.

test('berlin (Default) maps to berlinDay/berlinNight by variant', () => {
  expect(resolveHostTheme(preset('Light'))).toBe('berlinDay')
  expect(resolveHostTheme(preset('Dark'))).toBe('berlinNight')
})

test('custom families keep their name AND respect the dark variant', () => {
  expect(resolveHostTheme(custom('tokyo', 'Light'))).toBe('tokyoDay')
  expect(resolveHostTheme(custom('tokyo', 'Dark'))).toBe('tokyoNight')
  expect(resolveHostTheme(custom('lisbon', 'Light'))).toBe('lisbonDay')
  expect(resolveHostTheme(custom('lisbon', 'Dark'))).toBe('lisbonNight')
  expect(resolveHostTheme(custom('malta', 'Light'))).toBe('maltaDay')
  expect(resolveHostTheme(custom('malta', 'Dark'))).toBe('maltaNight')
})

test('unknown families fall back to berlin, still honouring variant', () => {
  expect(resolveHostTheme(custom('atlantis', 'Light'))).toBe('berlinDay')
  expect(resolveHostTheme(custom('atlantis', 'Dark'))).toBe('berlinNight')
})
