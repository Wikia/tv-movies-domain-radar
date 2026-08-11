import { useMemo, useState } from 'react'

import { formatCountdown, formatDate, formatMonth, groupByMonth } from '../lib/format'
import type { MediaType, Title } from '../types'
import { hasDemandSignal } from '../types'
import { Poster } from './Poster'
import { Empty, Score, Section } from './Primitives'

type Filter = 'all' | MediaType | 'demand'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Film' },
  { id: 'show', label: 'TV' },
  { id: 'demand', label: 'Demand signal' },
]

/** The forward calendar. Complete and chronological — this is the surface that
 * backs "don't miss anything", so it is never ranked and never truncated. */
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
    <Section
      title="Schedule"
      aside={showAll ? `${visible.length} upcoming` : `next ${horizonDays} days`}
      controls={
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter…"
          className="w-40 rounded-md border border-line bg-transparent px-2.5 py-1 text-xs outline-none placeholder:text-ink-3 focus:border-signal"
        />
      }
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              filter === option.id
                ? 'border-signal bg-signal/10 text-signal'
                : 'border-line text-ink-3 hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-3 transition-colors hover:text-ink"
        >
          {showAll ? `Next ${horizonDays}d` : 'Show all'}
        </button>
      </div>

      {visible.length === 0 ? (
        <Empty>Nothing matches those filters.</Empty>
      ) : (
        <div className="max-h-[36rem] overflow-y-auto">
          {groupByMonth(visible).map(([month, group]) => (
            <div key={month}>
              <div className="sticky top-0 flex items-baseline gap-2.5 border-b border-line bg-ground pt-5 pb-1.5">
                <b className="text-[13px] font-[650]">
                  {month === 'unknown' ? 'Undated' : formatMonth(`${month}-01`)}
                </b>
                <span className="text-xs text-ink-3">
                  {group.length} title{group.length === 1 ? '' : 's'}
                </span>
              </div>

              {group.map((title) => (
                <a
                  key={title.id}
                  href={title.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center gap-3.5 border-b border-line-soft py-2 hover:bg-raise"
                >
                  <Poster title={title} className="w-[38px] rounded-[5px]" textClass="text-[11px]" />
                  <span className="figure w-[62px] shrink-0 text-[12.5px] text-ink-2">
                    {formatDate(title.releaseDate)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm group-hover:text-signal">
                    {title.title}
                  </span>
                  <span className="hidden w-[180px] shrink-0 truncate text-xs text-ink-3 md:block">
                    {title.genres.slice(0, 3).join(', ')}
                  </span>
                  <span className="w-[34px] shrink-0 text-[10.5px] tracking-wide text-ink-3 uppercase">
                    {title.type === 'movie' ? 'Film' : 'TV'}
                  </span>
                  <Score title={title} />
                  <span className="figure hidden w-[92px] shrink-0 text-right text-xs text-ink-3 sm:block">
                    {formatCountdown(title.daysOut)}
                  </span>
                </a>
              ))}
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}
