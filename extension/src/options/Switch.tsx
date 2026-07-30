/**
 * Story 17 — the one boolean control (decision 3): a real switch, keyboard-
 * operable, tokens only. No native checkboxes remain on the options page.
 */
export function Switch({ checked, disabled, onChange, label }: {
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  )
}
