import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

interface Lap {
  lapTime: number
  totalTime: number
}

function formatTime(ms: number): string {
  const totalCs = Math.floor(ms / 10)
  const cs = totalCs % 100
  const totalSec = Math.floor(totalCs / 100)
  const sec = totalSec % 60
  const min = Math.floor(totalSec / 60)
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export function App() {
  const [running, setRunning] = useState(false)
  const [displayMs, setDisplayMs] = useState(0)
  const [laps, setLaps] = useState<Lap[]>([])

  const startTimeRef = useRef(0)
  const elapsedRef = useRef(0)
  const lapStartRef = useRef(0)
  const animFrameRef = useRef<number | null>(null)

  const getTotal = useCallback(() => {
    return elapsedRef.current + (running ? performance.now() - startTimeRef.current : 0)
  }, [running])

  useEffect(() => {
    if (!running) return
    const tick = () => {
      setDisplayMs(elapsedRef.current + (performance.now() - startTimeRef.current))
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current)
    }
  }, [running])

  const start = useCallback(() => {
    startTimeRef.current = performance.now()
    if (laps.length === 0 && elapsedRef.current === 0) lapStartRef.current = 0
    setRunning(true)
  }, [laps.length])

  const stop = useCallback(() => {
    elapsedRef.current += performance.now() - startTimeRef.current
    setRunning(false)
    setDisplayMs(elapsedRef.current)
  }, [])

  const reset = useCallback(() => {
    if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current)
    elapsedRef.current = 0
    lapStartRef.current = 0
    setLaps([])
    setRunning(false)
    setDisplayMs(0)
  }, [])

  const lap = useCallback(() => {
    const total = getTotal()
    const lapTime = total - lapStartRef.current
    setLaps((ls) => [...ls, { lapTime, totalTime: total }])
    lapStartRef.current = total
  }, [getTotal])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        running ? stop() : start()
      } else if (e.key === 'l' || e.key === 'L') {
        if (running) lap()
      } else if (e.key === 'Escape') {
        if (!running) reset()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [running, start, stop, lap, reset])

  let bestIdx = -1
  let worstIdx = -1
  if (laps.length >= 2) {
    let best = Infinity
    let worst = 0
    laps.forEach((l, i) => {
      if (l.lapTime < best) {
        best = l.lapTime
        bestIdx = i
      }
      if (l.lapTime > worst) {
        worst = l.lapTime
        worstIdx = i
      }
    })
  }

  const currentLapTime = running && laps.length > 0 ? displayMs - lapStartRef.current : 0

  const primaryLabel = running ? 'Stop' : 'Start'
  const secondaryLabel = running ? 'Lap' : 'Reset'
  const secondaryDisabled = !running && laps.length === 0 && elapsedRef.current === 0

  return (
    <div class='timer'>
      <div class='display'>
        <div class='label'>Stopwatch</div>
        <div class='time'>{formatTime(displayMs)}</div>
        <div class='lap-indicator'>
          {running && laps.length > 0
            ? `Lap ${laps.length + 1}  ${formatTime(currentLapTime)}`
            : ''}
        </div>
      </div>
      <div class='laps'>
        {laps
          .slice()
          .reverse()
          .map((l, revIdx) => {
            const i = laps.length - 1 - revIdx
            const cls = i === bestIdx ? ' best' : i === worstIdx ? ' worst' : ''
            return (
              <div key={i} class={`lap-row${cls}`}>
                <span class='lap-num'>Lap {i + 1}</span>
                <span>{formatTime(l.lapTime)}</span>
              </div>
            )
          })}
      </div>
      <div class='controls'>
        <button
          class='btn-secondary'
          disabled={secondaryDisabled}
          onClick={() => (running ? lap() : reset())}
        >
          {secondaryLabel}
        </button>
        <button
          class={`btn-primary${running ? ' running' : ''}`}
          onClick={() => (running ? stop() : start())}
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  )
}
