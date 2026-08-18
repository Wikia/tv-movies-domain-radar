import { formatDateYear } from '../lib/format'
import type { Change } from '../types'
import { Empty, Section } from './Primitives'

const META: Record<Change['kind'], { label: string; tone: string }> = {
  new: { label: 'Added', tone: 'text-up' },
  'date-changed': { label: 'Moved', tone: 'text-moved' },
  removed: { label: 'Dropped', tone: 'text-ink-3' },
}

/** Capped shorter than the schedule's box so the sidebar ends near it: most of
 * this list is "dropped", which is audit trail rather than news, and letting 40
 * rows run full height left a long empty gutter beside the schedule. */
const SCROLL = 'max-h-[18rem] overflow-y-auto pr-2 [scrollbar-gutter:stable]'

/** Everything that shifted since the previous run, including the quiet ones
 * that don't raise an alert — the audit trail behind the Changed filter. */
export function Changes({
  changes,
  known,
  onOpen,
}: {
  changes: Change[]
  /** Title ids still on the calendar. A 'dropped' change has no title left to
   * open, so those stay plain text rather than becoming a dead link. */
  known: Set<number>
  onOpen: (id: number) => void
}) {
  return (
    <Section title="Since last run" aside={`${changes.length}`}>
      {changes.length === 0 ? (
        <Empty>
          Nothing was added or moved since the previous day's snapshot. (With no earlier day on
          record, a run establishes the baseline and reports nothing.)
        </Empty>
      ) : (
        <div className={SCROLL}>
          {changes.map((change) => {
            const meta = META[change.kind]
            return (
              <div
                key={`${change.kind}-${change.id}`}
                className="border-b border-line-soft py-1.5 text-[13px]"
              >
                <span className={`mr-1.5 text-[10px] tracking-wide uppercase ${meta.tone}`}>
                  {meta.label}
                </span>
                {known.has(change.id) ? (
                  <a
                    href={`/title/${change.id}`}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey) return
                      event.preventDefault()
                      onOpen(change.id)
                    }}
                    className="text-inherit no-underline hover:text-accent"
                  >
                    {change.title}
                  </a>
                ) : (
                  change.title
                )}
                {change.kind === 'date-changed' && (
                  <div className="figure text-[11px] text-ink-3">
                    <s className="opacity-70">{formatDateYear(change.from ?? null)}</s> →{' '}
                    {formatDateYear(change.to ?? null)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}
