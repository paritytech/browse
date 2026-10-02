// Bubbles rising out of the recommend button while a recommendation is in
// flight. Built as an SVG goo layer. The gooey metaball filter is applied to
// SVG shapes inside a <g>, NOT via CSS `filter: url(#id)` on the HTML button.
// WebKit/Safari (the deploy target) silently drops a CSS filter over HTML, so
// the bubbles degrade to plain circles. A filter on SVG content renders
// everywhere.
const BUBBLES = [
  { cx: 50, r: 9, rise: -52, delay: 0, dur: 1170 },
  { cx: 42, r: 8, rise: -44, delay: 120, dur: 1080 },
  { cx: 58, r: 8, rise: -48, delay: 90, dur: 1110 },
  { cx: 36, r: 7, rise: -38, delay: 240, dur: 990 },
  { cx: 64, r: 7, rise: -40, delay: 210, dur: 1020 },
  { cx: 48, r: 6, rise: -62, delay: 330, dur: 1290 },
  { cx: 54, r: 6, rise: -58, delay: 300, dur: 1260 },
  { cx: 31, r: 5, rise: -34, delay: 450, dur: 930 },
  { cx: 69, r: 5, rise: -36, delay: 420, dur: 960 },
  { cx: 45, r: 5, rise: -70, delay: 540, dur: 1350 },
  { cx: 57, r: 5, rise: -66, delay: 510, dur: 1320 },
  { cx: 50, r: 4, rise: -78, delay: 660, dur: 1410 },
  { cx: 39, r: 4, rise: -50, delay: 600, dur: 1080 },
  { cx: 61, r: 4, rise: -52, delay: 630, dur: 1110 }
]

export function BubbleBurst({ fading = false }: { fading?: boolean }) {
  return (
    <svg
      class={`product-card__goo-svg${fading ? ' product-card__goo-svg--out' : ''}`}
      aria-hidden='true'
    >
      <defs>
        <filter id='recommend-goo' x='-40%' y='-80%' width='180%' height='260%'>
          <feGaussianBlur in='SourceGraphic' stdDeviation='3' result='blur' />
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
