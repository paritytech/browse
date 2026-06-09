import { useIconBlob } from '../../state/apps/icon'
import { type AppEntry, displayName } from '../../state/apps/types'
import { Identicon } from '../identicon'
import './styles.css'

interface WidgetCardProps {
  app: AppEntry
  index: number
  onClick: (label: string) => void
}

export function WidgetCard({ app, index, onClick }: WidgetCardProps) {
  const delay = Math.min(index * 50, 300)
  const { url: iconBlobUrl, failed: iconFailed, markFailed } = useIconBlob(app.iconCid)
  const showIcon = !!iconBlobUrl && !iconFailed

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
        {showIcon ? (
          <div class='widget-card__icon'>
            <img
              class='widget-card__icon-img'
              src={iconBlobUrl as string}
              alt=''
              onError={markFailed}
            />
          </div>
        ) : (
          <Identicon seed={app.label} size={56} />
        )}
      </div>
      <div class='widget-card__footer'>
        <span class='widget-card__name'>{displayName(app)}</span>
      </div>
    </div>
  )
}
