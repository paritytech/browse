interface IdenticonProps {
  seed: string
  size?: number
}

// djb2 hash. Fast, deterministic, 32-bit.
function hashSeed(seed: string): number {
  let h = 5381
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) + h + seed.charCodeAt(i)
    h = h | 0
  }
  return h >>> 0
}

const JEWELS = [
  'amethyst',
  'opal',
  'turquoise',
  'onyx',
  'pearl',
  'emerald',
  'topaz',
  'ruby',
  'sapphire',
  'garnet'
] as const

/**
 * Generative identicon for product thumbs.
 *
 * A 5×5 horizontally-mirrored grid seeded by the app label: 15 bits of the
 * hash fill the left three columns; columns 4 and 5 mirror columns 1 and 2.
 * Cell colour is one of 10 design-system jewel tones (`--avatar-bg-*`), also
 * seeded by the hash.
 */
export function Identicon({ seed, size = 64 }: IdenticonProps) {
  const hash = hashSeed(seed)
  const cellSize = size / 5
  const jewel = JEWELS[hash % JEWELS.length]
  const fill = `var(--avatar-bg-${jewel})`

  const cells: boolean[][] = []
  for (let r = 0; r < 5; r++) {
    const a = ((hash >>> (r * 3)) & 1) === 1
    const b = ((hash >>> (r * 3 + 1)) & 1) === 1
    const c = ((hash >>> (r * 3 + 2)) & 1) === 1
    cells.push([a, b, c, b, a])
  }

  let minR = 5
  let maxR = -1
  for (let r = 0; r < 5; r++) {
    if (cells[r].some(Boolean)) {
      if (r < minR) minR = r
      maxR = r
    }
  }
  const rowSpan = maxR - minR + 1
  const offsetY = maxR < 0 ? 0 : ((5 - rowSpan) / 2 - minR) * cellSize

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role='img' aria-hidden='true'>
      <g transform={`translate(0 ${offsetY})`}>
        {cells.flatMap((row, r) =>
          row.map((on, c) =>
            on ? (
              <rect
                key={`${r}-${c}`}
                x={c * cellSize}
                y={r * cellSize}
                width={cellSize}
                height={cellSize}
                fill={fill}
              />
            ) : null
          )
        )}
      </g>
    </svg>
  )
}
