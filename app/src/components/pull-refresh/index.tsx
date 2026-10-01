import { type RefObject } from 'preact'

import './styles.css'

const TICKS = [0, 1, 2, 3, 4, 5, 6, 7]

/** The iOS-style tick spinner that `usePullRefresh` drives above the content. */
export function PullRefreshIndicator({
  indicatorRef
}: {
  indicatorRef: RefObject<HTMLDivElement>
}) {
  return (
    <div class='pull-refresh' ref={indicatorRef} aria-hidden='true'>
      <div class='pull-refresh__spinner'>
        {TICKS.map((tick) => (
          <span key={tick} class='pull-refresh__tick' style={`--tick: ${tick}`} />
        ))}
      </div>
    </div>
  )
}
