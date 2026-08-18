import { formatDateYear } from '../lib/format'
import type { Change } from '../types'
import { Empty, Section } from './Primitives'

const META: Record<Change['kind'], { label: string; tone: string }> = {
  new: { label: 'Added', tone: 'text-up' },
  'date-changed': { label: 'Moved', tone: 'text-moved' },
  removed: { label: 'Dropped', tone: 'text-ink-3' },
}

const SCROLL = 'max-h-[18rem] overflow-y-auto pr-2 [scrollbar-gutter:stable]'

export function Changes({
  changes,
  known,
  onOpen,
}: {
  changes: Change[]

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
