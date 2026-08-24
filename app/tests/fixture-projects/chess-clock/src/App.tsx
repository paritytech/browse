import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

type Side = 'white' | 'black'

interface Preset {
  label: string
  minutes: number
  increment: number
}

const PRESETS: Preset[] = [
  { label: 'Bullet', minutes: 1, increment: 0 },
  { label: 'Blitz', minutes: 3, increment: 2 },
  { label: 'Rapid', minutes: 10, increment: 0 },
  { label: 'Classical', minutes: 30, increment: 0 }
]

function formatTime(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function App() {
  const [preset, setPreset] = useState(PRESETS[1]!)
  const [remaining, setRemaining] = useState({ white: 180_000, black: 180_000 })
  const [turn, setTurn] = useState<Side | null>(null)
  const [moves, setMoves] = useState({ white: 0, black: 0 })

  const deadlineRef = useRef(0)
  const frameRef = useRef<number | null>(null)

  const flagged = remaining.white === 0 ? 'white' : remaining.black === 0 ? 'black' : null

  useEffect(() => {
    if (turn === null) return
    const side = turn
    const tick = () => {
      const left = deadlineRef.current - performance.now()
      if (left <= 0) {
        setRemaining((r) => ({ ...r, [side]: 0 }))
        setTurn(null)
        return
      }
      setRemaining((r) => ({ ...r, [side]: left }))
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [turn])

  const load = useCallback((next: Preset) => {
    setPreset(next)
    setTurn(null)
    setMoves({ white: 0, black: 0 })
    setRemaining({ white: next.minutes * 60_000, black: next.minutes * 60_000 })
  }, [])

  const reset = useCallback(() => load(preset), [load, preset])

  // Tapping a side ends that side's turn, so the clock passes to the opponent
  // and the increment is credited to the player who just moved.
  const press = useCallback(
    (side: Side) => {
      if (flagged) return
      if (turn !== null && turn !== side) return

      const opponent: Side = side === 'white' ? 'black' : 'white'
      setRemaining((r) => {
        const credited = turn === side ? r[side] + preset.increment * 1000 : r[side]
        deadlineRef.current = performance.now() + r[opponent]
        return { ...r, [side]: credited }
      })
      if (turn === side) setMoves((m) => ({ ...m, [side]: m[side] + 1 }))
      setTurn(opponent)
    },
    [flagged, turn, preset.increment]
  )

  const sideClass = (side: Side) =>
    [
      'side',
      side,
      turn === side ? 'active' : '',
      flagged === side ? 'flagged' : '',
      turn !== null && turn !== side ? 'waiting' : ''
    ]
      .filter(Boolean)
      .join(' ')

  return (
    <div class='app'>
      <button class={sideClass('black')} onClick={() => press('black')}>
        <span class='side-label'>Black</span>
        <span class='side-time'>{formatTime(remaining.black)}</span>
        <span class='side-moves'>{moves.black} moves</span>
      </button>

      <div class='middle'>
        <div class='hint'>
          {flagged
            ? `${flagged === 'white' ? 'White' : 'Black'} flagged`
            : turn === null
              ? 'Tap a clock to start'
              : `${turn === 'white' ? 'White' : 'Black'} to move`}
        </div>
        <div class='presets'>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              class={`preset${preset.label === p.label ? ' active' : ''}`}
              onClick={() => load(p)}
            >
              {p.minutes}+{p.increment}
            </button>
          ))}
        </div>
        <button class='btn-secondary' onClick={reset}>
          Reset
        </button>
      </div>

      <button class={sideClass('white')} onClick={() => press('white')}>
        <span class='side-label'>White</span>
        <span class='side-time'>{formatTime(remaining.white)}</span>
        <span class='side-moves'>{moves.white} moves</span>
      </button>
    </div>
  )
}
