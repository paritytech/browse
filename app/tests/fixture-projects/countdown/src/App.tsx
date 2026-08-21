import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

const PRESETS = [60, 300, 600, 1800]

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const sec = totalSec % 60
  const min = Math.floor(totalSec / 60) % 60
  const hr = Math.floor(totalSec / 3600)
  const mmss = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return hr > 0 ? `${hr}:${mmss}` : mmss
}

export function App() {
  const [durationMs, setDurationMs] = useState(300_000)
  const [remainingMs, setRemainingMs] = useState(300_000)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)

  const deadlineRef = useRef(0)
  const animFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (!running) return
    const tick = () => {
      const left = deadlineRef.current - performance.now()
      if (left <= 0) {
        setRemainingMs(0)
        setRunning(false)
        setDone(true)
        return
      }
      setRemainingMs(left)
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current)
    }
  }, [running])

  const start = useCallback(() => {
    if (remainingMs <= 0) return
    deadlineRef.current = performance.now() + remainingMs
    setDone(false)
    setRunning(true)
  }, [remainingMs])

  const pause = useCallback(() => {
    setRemainingMs(Math.max(0, deadlineRef.current - performance.now()))
    setRunning(false)
  }, [])

  const reset = useCallback(() => {
    setRunning(false)
    setDone(false)
    setRemainingMs(durationMs)
  }, [durationMs])

  const choose = useCallback((seconds: number) => {
    setRunning(false)
    setDone(false)
    setDurationMs(seconds * 1000)
    setRemainingMs(seconds * 1000)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        running ? pause() : start()
      } else if (e.key === 'Escape') {
        reset()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [running, start, pause, reset])

  const progress = durationMs === 0 ? 0 : 1 - remainingMs / durationMs

  return (
    <div class='app'>
      <div class='display'>
        <div class='label'>Countdown Timer</div>
        <div class={`time${done ? ' done' : ''}`}>{formatTime(remainingMs)}</div>
        <div class='hint'>{done ? "Time's up" : running ? 'Counting down' : 'Paused'}</div>
      </div>
      <div class='track'>
        <div class='fill' style={{ width: `${Math.min(100, progress * 100)}%` }} />
      </div>
      <div class='presets'>
        {PRESETS.map((seconds) => (
          <button
            key={seconds}
            class={`preset${durationMs === seconds * 1000 ? ' active' : ''}`}
            onClick={() => choose(seconds)}
          >
            {formatTime(seconds * 1000)}
          </button>
        ))}
      </div>
      <div class='controls'>
        <button class='btn-secondary' disabled={remainingMs === durationMs} onClick={reset}>
          Reset
        </button>
        <button
          class={`btn-primary${running ? ' running' : ''}`}
          disabled={remainingMs === 0}
          onClick={() => (running ? pause() : start())}
        >
          {running ? 'Pause' : 'Start'}
        </button>
      </div>
    </div>
  )
}
