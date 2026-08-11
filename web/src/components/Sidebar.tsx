import { formatDate } from '../lib/format'
import type { Change, Title } from '../types'
import { Poster } from './Poster'
import { Empty, Section } from './Primitives'

/** What's gaining traction now. Mostly already-released catalog titles — that's
 * the nature of the upstream signal, not a bug. */
export function Trending({ titles }: { titles: Title[] }) {
  const top = titles.filter((t) => t.trendingRank != null).slice(0, 12)

  return (
    <Section title="Trending now" aside="hourly upstream">
      {top.length === 0 ? (
        <Empty>No trending data in this run.</Empty>
      ) : (
        <div>
          {top.map((title) => (
            <a
              key={`${title.type}-${title.id}`}
              href={title.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-3 border-b border-line-soft py-1.5"
            >
              <span className="figure w-4 shrink-0 text-right text-[11px] text-ink-3">
                {title.trendingRank}
              </span>
              <Poster title={title} className="w-[30px] rounded-[4px]" textClass="text-[9px]" />
              <span className="min-w-0 flex-1 truncate text-[13px] group-hover:text-signal">
                {title.title}
              </span>
            </a>
          ))}
        </div>
      )}
    </Section>
  )
}

const CHANGE_META: Record<Change['kind'], { label: string; tone: string }> = {
  new: { label: 'Added', tone: 'text-up' },
  'date-changed': { label: 'Moved', tone: 'text-signal' },
  removed: { label: 'Dropped', tone: 'text-ink-3' },
}

/** Everything that shifted since the previous run, including the quiet ones
 * that don't rise to an alert — the audit trail behind the bulletin. */
export function Changes({ changes }: { changes: Change[] }) {
  return (
    <Section title="Since last run" aside={`${changes.length} change${changes.length === 1 ? '' : 's'}`}>
      {changes.length === 0 ? (
        <Empty>
          No changes — or this was the first run, which sets the baseline without reporting changes.
        </Empty>
      ) : (
        <div className="max-h-80 overflow-y-auto">
          {changes.map((change) => {
            const meta = CHANGE_META[change.kind]
            return (
              <div key={`${change.kind}-${change.id}`} className="border-b border-line-soft py-1.5 text-[13px]">
                <span className={`mr-1.5 text-[10px] tracking-wide uppercase ${meta.tone}`}>
                  {meta.label}
                </span>
                {change.title}
                {change.kind === 'date-changed' && (
                  <div className="figure text-[11px] text-ink-3">
                    <s className="opacity-70">{formatDate(change.from ?? null)}</s> →{' '}
                    {formatDate(change.to ?? null)}
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
