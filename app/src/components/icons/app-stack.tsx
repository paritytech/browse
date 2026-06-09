/**
 * Decorative cluster of overlapping app icons.
 *
 * Hand-built SVG recreation of the brand illustration. Swap in the exact asset
 * here if one is available. Colours are intentionally fixed (not theme tokens)
 * because the illustration is a constant brand mark across light and dark.
 */
export const APP_STACK = (
  <svg width='112' height='96' viewBox='0 0 140 120' fill='none' aria-hidden='true'>
    {/* Orange tile, node graph (back-left) */}
    <g transform='rotate(-12 52 40)'>
      <rect x='30' y='18' width='44' height='44' rx='13' fill='#F6C887' />
      <circle cx='52' cy='31' r='3' fill='#C0801F' />
      <circle cx='43' cy='48' r='3' fill='#C0801F' />
      <circle cx='61' cy='47' r='3' fill='#C0801F' />
      <path d='M52 31 43 48M52 31 61 47' stroke='#C0801F' stroke-width='1.6' />
    </g>

    {/* Blue tile, hexagon (back-right) */}
    <g transform='rotate(12 90 38)'>
      <rect x='68' y='16' width='44' height='44' rx='13' fill='#A9C2EE' />
      <polygon
        points='90,27 99.5,32.5 99.5,43.5 90,49 80.5,43.5 80.5,32.5'
        stroke='#3F66B6'
        stroke-width='1.8'
        fill='none'
        stroke-linejoin='round'
      />
    </g>

    {/* Periwinkle tile, centre dot (middle) */}
    <g transform='rotate(-4 70 64)'>
      <rect x='48' y='42' width='44' height='44' rx='13' fill='#8DA4C6' />
      <rect x='63' y='57' width='14' height='14' rx='4' fill='#EAF0FA' />
    </g>

    {/* Black tile, target (front-left) */}
    <g transform='rotate(-10 44 72)'>
      <rect x='22' y='50' width='44' height='44' rx='13' fill='#1A1A1E' />
      <circle cx='44' cy='72' r='15' stroke='#FFFFFF' stroke-width='2' fill='none' />
      <circle cx='44' cy='72' r='8' stroke='#FFFFFF' stroke-width='2' fill='none' />
      <circle cx='44' cy='72' r='2.5' fill='#FFFFFF' />
    </g>

    {/* Lavender tile, flower (front-right) */}
    <g transform='rotate(14 98 74)'>
      <rect x='76' y='52' width='44' height='44' rx='13' fill='#C7B6E6' />
      <circle cx='98' cy='74' r='3' fill='#FFFFFF' />
      <circle cx='107' cy='74' r='3' fill='#FFFFFF' />
      <circle cx='102.5' cy='81.8' r='3' fill='#FFFFFF' />
      <circle cx='93.5' cy='81.8' r='3' fill='#FFFFFF' />
      <circle cx='89' cy='74' r='3' fill='#FFFFFF' />
      <circle cx='93.5' cy='66.2' r='3' fill='#FFFFFF' />
      <circle cx='102.5' cy='66.2' r='3' fill='#FFFFFF' />
    </g>
  </svg>
)
