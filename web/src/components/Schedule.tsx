import { useMemo, useState } from 'react'

import { formatCountdown, formatDate, formatMonth, formatWeekday, groupByMonth } from '../lib/format'
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

/** The forward calendar as a ruled log, grouped by month. Complete and
 * chronological — this is the surface that backs "don't miss anything", so it
 * is never ranked and never truncated. */
export function Schedule({ titles, horizonDays }: { titles: Title[]; horizonDays: number }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    return titles.filter((title) => {
      if (!showAll && (title.daysOut == null || title.daysOut > horizonDays)) return false
      if (title.daysOut != null && title.daysOut < 0) return false
      if ((filter === 'movie' || filter === 'show') && title.type !== filter) return false
      if (filter === 'demand' && !hasDemandSignal(title)) return false
      if (term && !title.title.toLowerCase().includes(term)) return false
      return true
    })
  }, [titles, filter, query, showAll, horizonDays])

  return (
    <Panel
      title="Schedule"
      subtitle={`${visible.length} ${showAll ? 'upcoming' : `in next ${horizonDays}d`}`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-rule-soft py-2.5">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={`eyebrow border px-2 py-1 transition-colors ${
              filter === option.id
                ? 'border-onair bg-onair/10 text-onair'
                : 'border-rule text-muted hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="eyebrow border border-rule px-2 py-1 text-muted transition-colors hover:text-ink"
        >
          {showAll ? `Next ${horizonDays}d` : 'Show all'}
        </button>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter…"
          className="ml-auto w-40 border border-rule bg-transparent px-2 py-1 text-xs outline-none placeholder:text-faint focus:border-onair"
        />
      </div>

      {visible.length === 0 ? (
        <Empty>Nothing matches those filters.</Empty>
      ) : (
        <div className="max-h-[34rem] overflow-y-auto">
          {groupByMonth(visible).map(([month, group]) => (
            <div key={month}>
              <h3 className="eyebrow sticky top-0 border-b border-rule bg-ground py-2 text-muted">
                <span className="text-ink">
                  {month === 'unknown' ? 'Undated' : formatMonth(`${month}-01`)}
                </span>
                {` — ${group.length} title${group.length === 1 ? '' : 's'}`}
              </h3>
              <ul className="divide-y divide-rule-soft">
                {group.map((title) => (
                  <li key={title.id} className="flex items-center gap-4 py-2">
                    <ScoreBadge title={title} />
                    <span className="figure w-24 shrink-0 text-[12px] text-muted">
                      {formatWeekday(title.releaseDate)} {formatDate(title.releaseDate)}
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
                    <span className="figure w-16 shrink-0 text-right text-[11px] text-faint">
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
