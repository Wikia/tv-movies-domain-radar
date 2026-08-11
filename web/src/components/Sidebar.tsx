import { formatDate } from '../lib/format'
import type { Change, Title } from '../types'
import { Empty, Panel, TypeBadge } from './Primitives'

/** What's gaining traction right now. Mostly already-released catalog titles —
 * that's the nature of the upstream signal, not a bug. */
export function Trending({ titles }: { titles: Title[] }) {
  const top = titles.filter((t) => t.trendingRank != null).slice(0, 15)

  return (
    <Panel title="Trending now" subtitle="Current engagement, refreshed hourly upstream">
      {top.length === 0 ? (
        <Empty>No trending data in this run.</Empty>
      ) : (
        <ol className="divide-y divide-border">
          {top.map((title) => (
            <li key={`${title.type}-${title.id}`} className="flex items-center gap-3 px-5 py-2.5">
              <span className="w-5 shrink-0 text-xs font-semibold text-muted tabular-nums">
                {title.trendingRank}
              </span>
              <a
                href={title.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-sm hover:text-accent hover:underline"
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
  new: 'added',
  'date-changed': 'moved',
  removed: 'dropped off',
}

const CHANGE_STYLE: Record<Change['kind'], string> = {
  new: 'text-calm',
  'date-changed': 'text-cool',
  removed: 'text-muted',
}

/** Everything that shifted since the previous run — including the quiet ones
 * that don't rise to an alert. This is the audit trail behind the alerts. */
export function Changes({ changes }: { changes: Change[] }) {
  return (
    <Panel title="Since last run" subtitle={`${changes.length} change${changes.length === 1 ? '' : 's'}`}>
      {changes.length === 0 ? (
        <Empty>
          No changes — or this was the first run, which sets the baseline without reporting
          changes.
        </Empty>
      ) : (
        <ul className="max-h-80 divide-y divide-border overflow-y-auto">
          {changes.map((change) => (
            <li key={`${change.kind}-${change.id}`} className="px-5 py-2.5">
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-semibold uppercase ${CHANGE_STYLE[change.kind]}`}>
                  {CHANGE_LABEL[change.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{change.title}</span>
                <TypeBadge type={change.type} />
              </div>
              {change.kind === 'date-changed' && (
                <div className="mt-0.5 text-xs text-muted">
                  <span className="line-through">{formatDate(change.from ?? null)}</span> →{' '}
                  {formatDate(change.to ?? null)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
