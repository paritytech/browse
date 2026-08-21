import { useCallback, useEffect, useState } from 'preact/hooks'

interface Alarm {
  id: number
  hour: number
  minute: number
  enabled: boolean
}

const INITIAL: Alarm[] = [
  { id: 1, hour: 7, minute: 0, enabled: true },
  { id: 2, hour: 8, minute: 30, enabled: false }
]

function formatClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function minutesUntil(now: Date, hour: number, minute: number): number {
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const target = hour * 60 + minute
  return target > nowMinutes ? target - nowMinutes : target + 1440 - nowMinutes
}

function describeWait(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `in ${rest}m`
  if (rest === 0) return `in ${hours}h`
  return `in ${hours}h ${rest}m`
}

export function App() {
  const [alarms, setAlarms] = useState<Alarm[]>(INITIAL)
  const [now, setNow] = useState(() => new Date())
  const [hour, setHour] = useState(9)
  const [minute, setMinute] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(id)
  }, [])

  const toggle = useCallback((id: number) => {
    setAlarms((list) =>
      list.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a))
    )
  }, [])

  const remove = useCallback((id: number) => {
    setAlarms((list) => list.filter((a) => a.id !== id))
  }, [])

  const add = useCallback(() => {
    setAlarms((list) => {
      if (list.some((a) => a.hour === hour && a.minute === minute)) return list
      const id = list.reduce((max, a) => Math.max(max, a.id), 0) + 1
      return [...list, { id, hour, minute, enabled: true }].sort(
        (a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute)
      )
    })
  }, [hour, minute])

  const next = alarms
    .filter((a) => a.enabled)
    .map((a) => ({ alarm: a, wait: minutesUntil(now, a.hour, a.minute) }))
    .sort((a, b) => a.wait - b.wait)[0]

  return (
    <div class='app'>
      <div class='display'>
        <div class='label'>Alarm Clock</div>
        <div class='time'>{formatClock(now.getHours(), now.getMinutes())}</div>
        <div class='hint'>
          {next
            ? `Next alarm ${formatClock(next.alarm.hour, next.alarm.minute)}, ${describeWait(next.wait)}`
            : 'No alarms set'}
        </div>
      </div>
      <div class='rows'>
        {alarms.map((a) => (
          <div key={a.id} class={`row${a.enabled ? '' : ' off'}`}>
            <span class='row-time'>{formatClock(a.hour, a.minute)}</span>
            <button class='row-toggle' onClick={() => toggle(a.id)}>
              {a.enabled ? 'On' : 'Off'}
            </button>
            <button class='row-remove' onClick={() => remove(a.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <div class='picker'>
        <select value={String(hour)} onChange={(e) => setHour(Number(e.currentTarget.value))}>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={String(h)}>
              {String(h).padStart(2, '0')}
            </option>
          ))}
        </select>
        <span class='colon'>:</span>
        <select value={String(minute)} onChange={(e) => setMinute(Number(e.currentTarget.value))}>
          {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
            <option key={m} value={String(m)}>
              {String(m).padStart(2, '0')}
            </option>
          ))}
        </select>
      </div>
      <div class='controls'>
        <button class='btn-primary' onClick={add}>
          Add alarm
        </button>
      </div>
    </div>
  )
}
