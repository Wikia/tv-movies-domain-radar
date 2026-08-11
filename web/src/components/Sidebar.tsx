import { formatDate } from '../lib/format'
import type { Change, Title } from '../types'
import { Empty, Panel, TypeBadge } from './Primitives'

/** What's gaining traction now. Mostly already-released catalog titles — that's
 * the nature of the upstream signal, not a bug. */
export function Trending({ titles }: { titles: Title[] }) {
  const top = titles.filter((t) => t.trendingRank != null).slice(0, 15)

  return (
    <Panel title="Trending now" subtitle="hourly upstream">
      {top.length === 0 ? (
        <Empty>No trending data in this run.</Empty>
      ) : (
        <ol className="divide-y divide-rule-soft">
          {top.map((title) => (
            <li key={`${title.type}-${title.id}`} className="flex items-center gap-3 py-2">
              <span className="figure w-5 shrink-0 text-right text-[11px] text-faint">
                {title.trendingRank}
              </span>
              <a
                href={title.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate border-b border-transparent text-[13px] hover:border-onair hover:text-onair"
              >
                {title.title}
              </a>
              <TypeBadge type={title.type} />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

const CHANGE_LABEL: Record<Change['kind'], string> = {
  new: 'Added',
  'date-changed': 'Moved',
  removed: 'Dropped',
}

const CHANGE_STYLE: Record<Change['kind'], string> = {
  new: 'text-ok',
  'date-changed': 'text-signal',
  removed: 'text-faint',
}

/** Everything that shifted since the previous run, including the quiet ones
 * that don't rise to an alert — the audit trail behind the bulletin. */
export function Changes({ changes }: { changes: Change[] }) {
  return (
    <Panel title="Since last run" subtitle={`${changes.length} change${changes.length === 1 ? '' : 's'}`}>
      {changes.length === 0 ? (
        <Empty>
          No changes — or this was the first run, which sets the baseline without reporting
          changes.
        </Empty>
      ) : (
        <ul className="max-h-80 divide-y divide-rule-soft overflow-y-auto">
          {changes.map((change) => (
            <li key={`${change.kind}-${change.id}`} className="py-2">
              <div className="flex items-center gap-2.5">
                <span className={`eyebrow w-12 shrink-0 ${CHANGE_STYLE[change.kind]}`}>
                  {CHANGE_LABEL[change.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{change.title}</span>
                <TypeBadge type={change.type} />
              </div>
              {change.kind === 'date-changed' && (
                <div className="figure mt-0.5 pl-14 text-[11px] text-faint">
                  <s>{formatDate(change.from ?? null)}</s> → {formatDate(change.to ?? null)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
