import './styles.css'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Accessible label; the switch renders no visible text. */
  label: string
  disabled?: boolean
}

/** An on/off switch for a standing setting (e.g. trusting a certificate authority). */
export function Switch({ checked, onChange, label, disabled = false }: SwitchProps) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      class={`switch${checked ? ' switch--on' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled) onChange(!checked)
      }}
    >
      <span class='switch__thumb' />
    </button>
  )
}
