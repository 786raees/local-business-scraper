/**
 * Story 17 — the section card: one eyebrow title, one job. The page is four
 * of these (Connection · Dialer · Recording · Danger zone); nothing renders
 * outside a card, so additions land in a section instead of appended rows.
 */
export function OptionsCard({ title, description, danger, children }: {
  title: string
  description?: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <section className={`card${danger ? ' card-danger' : ''}`}>
      <div className="hint">{title}</div>
      {description && <p className="card-desc">{description}</p>}
      {children}
    </section>
  )
}
