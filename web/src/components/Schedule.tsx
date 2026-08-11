import { useMemo, useState } from 'react'

import { formatCountdown, formatDate, formatMonth, groupByMonth } from '../lib/format'
import type { MediaType, Title } from '../types'
import { hasDemandSignal } from '../types'
import { Empty, Panel, ScoreBadge, TypeBadge } from './Primitives'

type Filter = 'all' | MediaType | 'demand'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Film' },
  { id: 'show', label: 'TV' },
  { id: 'demand', label: 'With demand signal' },
]

/** The forward calendar, grouped by month. This is the "don't miss anything"
 * surface: complete and chronological, not ranked. */
export function Schedule({ titles, horizonDays }: { titles: Title[]; horizonDays: number }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    return titles.filter((title) => {
      if (!showAll && (title.daysOut == null || title.daysOut > horizonDays)) return false
      if (title.daysOut != null && title.daysOut < 0) return false
      if (filter === 'movie' || filter === 'show') {
        if (title.type !== filter) return false
      }
      if (filter === 'demand' && !hasDemandSignal(title)) return false
      if (term && !title.title.toLowerCase().includes(term)) return false
      return true
    })
  }, [titles, filter, query, showAll, horizonDays])

  const months = groupByMonth(visible)

  return (
    <Panel
      title="Schedule"
      subtitle={`${visible.length} title${visible.length === 1 ? '' : 's'} ${
        showAll ? 'upcoming' : `in the next ${horizonDays} days`
      }`}
      action={
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          {showAll ? `Next ${horizonDays}d` : 'Show all'}
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              filter === option.id
                ? 'border-accent/40 bg-accent/15 text-accent'
                : 'border-border text-muted hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by title…"
          className="ml-auto w-48 rounded-md border border-border bg-transparent px-2.5 py-1 text-xs outline-none placeholder:text-muted focus:border-accent/50"
        />
      </div>

      {visible.length === 0 ? (
        <Empty>Nothing matches those filters.</Empty>
      ) : (
        <div className="max-h-[32rem] overflow-y-auto">
          {months.map(([month, group]) => (
            <div key={month}>
              <h3 className="sticky top-0 border-b border-border bg-panel px-5 py-2 text-xs font-semibold tracking-wide text-muted uppercase">
                {month === 'unknown' ? 'Undated' : formatMonth(`${month}-01`)}
                <span className="ml-2 font-normal normal-case">({group.length})</span>
              </h3>
              <ul className="divide-y divide-border">
                {group.map((title) => (
                  <li key={title.id} className="flex items-center gap-4 px-5 py-2.5">
                    <span className="w-24 shrink-0 text-xs text-muted tabular-nums">
                      {formatDate(title.releaseDate)}
                    </span>
                    <ScoreBadge title={title} />
                    <a
                      href={title.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate text-sm hover:text-accent hover:underline"
                    >
                      {title.title}
                    </a>
                    <TypeBadge type={title.type} />
                    <span className="w-20 shrink-0 text-right text-xs text-muted">
                      {formatCountdown(title.daysOut)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
