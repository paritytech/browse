// Bubbles rising from the recommend button on confirmation.
const BUBBLES = [
  { left: 12, size: 16, rise: -34, delay: 0, dur: 900 },
  { left: 28, size: 20, rise: -42, delay: 120, dur: 1000 },
  { left: 42, size: 14, rise: -30, delay: 60, dur: 860 },
  { left: 55, size: 22, rise: -46, delay: 180, dur: 1040 },
  { left: 68, size: 16, rise: -36, delay: 90, dur: 920 },
  { left: 82, size: 13, rise: -28, delay: 220, dur: 820 },
  { left: 35, size: 12, rise: -26, delay: 260, dur: 800 },
  { left: 60, size: 12, rise: -24, delay: 300, dur: 780 },
  { left: 20, size: 11, rise: -22, delay: 160, dur: 760 },
  { left: 75, size: 11, rise: -22, delay: 200, dur: 760 }
]

export function BubbleBurst() {
  return (
    <span class='product-card__bubbles-fx' aria-hidden='true'>
      <svg width='0' height='0' class='product-card__goo-defs'>
        <defs>
          <filter id='recommend-goo' x='-30%' y='-220%' width='160%' height='340%'>
            <feGaussianBlur in='SourceGraphic' stdDeviation='5' result='blur' />
            <feColorMatrix
              in='blur'
              type='matrix'
              values='1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8'
              result='goo'
            />
            <feComposite in='SourceGraphic' in2='goo' operator='atop' />
          </filter>
        </defs>
      </svg>
      <span class='product-card__bubble-layer'>
        {BUBBLES.map((bubble, i) => (
          <span
            key={i}
            class='product-card__bubble'
            style={`left:${bubble.left}%;width:${bubble.size}px;height:${bubble.size}px;--bubble-rise:${bubble.rise}px;--bubble-dur:${bubble.dur}ms;--bubble-delay:${bubble.delay}ms`}
          />
        ))}
      </span>
    </span>
  )
}
