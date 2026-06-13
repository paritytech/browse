// Bubbles rising out of the recommend button while a recommendation is in
// flight. Built as an SVG goo layer — the gooey metaball filter is applied to
// SVG shapes inside a <g>, NOT via CSS `filter: url(#id)` on the HTML button.
// WebKit/Safari (the deploy target) silently drops a CSS filter over HTML and
// the bubbles degrade to plain circles; a filter on SVG content renders
// everywhere.
const BUBBLES = [
  { cx: 12, r: 8, rise: -34, delay: 0, dur: 900 },
  { cx: 28, r: 10, rise: -42, delay: 120, dur: 1000 },
  { cx: 42, r: 7, rise: -30, delay: 60, dur: 860 },
  { cx: 55, r: 11, rise: -46, delay: 180, dur: 1040 },
  { cx: 68, r: 8, rise: -36, delay: 90, dur: 920 },
  { cx: 82, r: 6.5, rise: -28, delay: 220, dur: 820 },
  { cx: 35, r: 6, rise: -26, delay: 260, dur: 800 },
  { cx: 60, r: 6, rise: -24, delay: 300, dur: 780 },
  { cx: 20, r: 5.5, rise: -22, delay: 160, dur: 760 },
  { cx: 75, r: 5.5, rise: -22, delay: 200, dur: 760 }
]

export function BubbleBurst() {
  return (
    <svg class='product-card__goo-svg' aria-hidden='true'>
      <defs>
        <filter id='recommend-goo' x='-20%' y='-20%' width='140%' height='140%'>
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
      <g class='product-card__goo-group' filter='url(#recommend-goo)'>
        {/* A flat lip overlapping the button's top edge so the bubbles have a
            base to merge with. */}
        <rect class='product-card__goo-lip' x='6%' y='44' width='88%' height='22' />
        {BUBBLES.map((bubble, i) => (
          <circle
            key={i}
            class='product-card__bubble'
            cx={`${bubble.cx}%`}
            cy='46'
            r={bubble.r}
            style={`--bubble-rise:${bubble.rise}px;--bubble-dur:${bubble.dur}ms;--bubble-delay:${bubble.delay}ms`}
          />
        ))}
      </g>
    </svg>
  )
}
