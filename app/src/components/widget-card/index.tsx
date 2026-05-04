import './styles.css'

interface WidgetCardProps {
  label: string
  index: number
  onClick: (label: string) => void
}

export function WidgetCard({ label, index, onClick }: WidgetCardProps) {
  const letter = label[0].toLowerCase()
  const delay = Math.min(index * 50, 300)

  return (
    <div
      class='widget-card'
      style={`animation-delay: ${delay}ms`}
      data-label={label}
      tabIndex={0}
      onClick={() => onClick(label)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(label)
        }
      }}
    >
      <div class='widget-card__thumb'>
        <div class='widget-card__icon'>
          <span class='widget-card__letter'>{letter}</span>
        </div>
      </div>
      <div class='widget-card__footer'>
        <span class='widget-card__brand' />
        <span class='widget-card__name'>{label}</span>
      </div>
    </div>
  )
}
