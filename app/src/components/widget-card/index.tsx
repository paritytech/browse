import { useState } from 'preact/hooks'

import { iconUrl } from '../../state/apps/manifest'
import { type AppEntry, displayName } from '../../state/apps/types'
import './styles.css'

interface WidgetCardProps {
  app: AppEntry
  index: number
  onClick: (label: string) => void
}

export function WidgetCard({ app, index, onClick }: WidgetCardProps) {
  const letter = app.label[0].toLowerCase()
  const delay = Math.min(index * 50, 300)
  const [iconFailed, setIconFailed] = useState(false)
  const showIcon = !!app.iconCid && !iconFailed

  return (
    <div
      class='widget-card'
      style={`animation-delay: ${delay}ms`}
      data-label={app.label}
      tabIndex={0}
      onClick={() => onClick(app.label)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(app.label)
        }
      }}
    >
      <div class='widget-card__thumb'>
        <div class='widget-card__icon'>
          {showIcon ? (
            <img
              class='widget-card__icon-img'
              src={iconUrl(app.iconCid as string)}
              alt=''
              onError={() => setIconFailed(true)}
            />
          ) : (
            <span class='widget-card__letter'>{letter}</span>
          )}
        </div>
      </div>
      <div class='widget-card__footer'>
        <span class='widget-card__name'>{displayName(app)}</span>
      </div>
    </div>
  )
}
