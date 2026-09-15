import { useMemo, useState } from 'preact/hooks'

/** Factor to the family's base unit, so any pair converts through it. */
const FAMILIES = {
  Length: { metre: 1, kilometre: 1000, mile: 1609.344, foot: 0.3048, inch: 0.0254 },
  Mass: { gram: 1, kilogram: 1000, pound: 453.59237, ounce: 28.349523125 },
  Volume: { litre: 1, millilitre: 0.001, gallon: 3.785411784, pint: 0.473176473 }
} as const

type Family = keyof typeof FAMILIES

export function App() {
  const [family, setFamily] = useState<Family>('Length')
  const [from, setFrom] = useState('metre')
  const [to, setTo] = useState('foot')
  const [amount, setAmount] = useState('1')

  const units = useMemo(() => Object.keys(FAMILIES[family]), [family])

  const result = useMemo(() => {
    const table = FAMILIES[family] as Record<string, number>
    const value = Number(amount)
    if (!Number.isFinite(value) || !table[from] || !table[to]) return ''
    return String(Number(((value * table[from]) / table[to]).toPrecision(8)))
  }, [family, from, to, amount])

  const pick = (next: Family) => {
    const [first, second] = Object.keys(FAMILIES[next])
    setFamily(next)
    setFrom(first)
    setTo(second ?? first)
  }

  return (
    <main class='converter'>
      <h1>Unit Converter</h1>

      <div class='families'>
        {(Object.keys(FAMILIES) as Family[]).map((name) => (
          <button
            key={name}
            class={`family${name === family ? ' family--on' : ''}`}
            onClick={() => pick(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <div class='row'>
        <input
          type='number'
          value={amount}
          onInput={(e) => setAmount((e.target as HTMLInputElement).value)}
        />
        <select value={from} onChange={(e) => setFrom((e.target as HTMLSelectElement).value)}>
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>

      <div class='result'>{result}</div>

      <div class='row'>
        <select value={to} onChange={(e) => setTo((e.target as HTMLSelectElement).value)}>
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <button
          class='swap'
          onClick={() => {
            setFrom(to)
            setTo(from)
          }}
        >
          Swap
        </button>
      </div>
    </main>
  )
}
