import { useMemo, useState } from 'react'

import { REASON_LABEL, REASON_TONE, formatCountdown, formatDate, formatMonth, groupByMonth } from '../lib/format'
import type { AlertReason, MediaType, Title } from '../types'
import { hasDemandSignal } from '../types'
import { Poster } from './Poster'
import { Empty, Score, Section, Tag } from './Primitives'

/** Filters are shared with the stat tiles in App, so they live in one type. */
export type Filter = 'all' | MediaType | 'demand' | 'alerts'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'movie', label: 'Film' },
  { id: 'show', label: 'TV' },
  { id: 'demand', label: 'Demand signal' },
]

const FILTER_ASIDE: Record<Filter, string> = {
  all: 'everything landing in the window',
  alerts: 'newly added, moved, or in demand',
  movie: 'films only',
  show: 'TV only',
  demand: 'corroborated by a real demand signal',
}

export function Schedule({
  titles,
  horizonDays,
  filter,
  onFilter,
  reasons,
}: {
  titles: Title[]
  horizonDays: number
  filter: Filter
  onFilter: (filter: Filter) => void
  reasons: Map<number, AlertReason[]>
}) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [view, setView] = useState<'grid' | 'list'>('grid')

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    return titles.filter((title) => {
      // Alerts are the exception to the horizon: an alert matters regardless of
      // how far out it sits, so filtering to them shows all of them.
      if (filter !== 'alerts' && !showAll) {
        if (title.daysOut == null || title.daysOut > horizonDays) return false
      }
      if (title.daysOut != null && title.daysOut < 0) return false
      if ((filter === 'movie' || filter === 'show') && title.type !== filter) return false
      if (filter === 'demand' && !hasDemandSignal(title)) return false
      if (filter === 'alerts' && !reasons.has(title.id)) return false
      if (term && !title.title.toLowerCase().includes(term)) return false
      return true
    })
  }, [titles, filter, query, showAll, horizonDays, reasons])

  const groups = groupByMonth(visible)

  return (
    <Section
      title="Schedule"
      aside={`${visible.length} · ${FILTER_ASIDE[filter]}`}
      controls={
        <>
          <div className="flex overflow-hidden rounded-md border border-line">
            {(['grid', 'list'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                aria-pressed={view === mode}
                className={`px-2 py-1 text-[11px] capitalize transition-colors ${
                  view === mode ? 'bg-signal/10 text-signal' : 'text-ink-3 hover:text-ink'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter…"
            className="w-32 rounded-md border border-line bg-transparent px-2.5 py-1 text-[11px] outline-none placeholder:text-ink-3 focus:border-signal"
          />
        </>
      }
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onFilter(option.id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              filter === option.id
                ? 'border-signal bg-signal/10 text-signal'
                : 'border-line text-ink-3 hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
        {filter !== 'alerts' && (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="ml-auto rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-3 transition-colors hover:text-ink"
          >
            {showAll ? `Next ${horizonDays}d` : 'Show all'}
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <Empty>Nothing matches those filters.</Empty>
      ) : (
        <div className="max-h-[42rem] overflow-y-auto">
          {groups.map(([month, group]) => (
            <div key={month}>
              <div className="sticky top-0 z-10 flex items-baseline gap-2.5 border-b border-line bg-ground pt-5 pb-1.5">
                <b className="text-[13px] font-[650]">
                  {month === 'unknown' ? 'Undated' : formatMonth(`${month}-01`)}
                </b>
                <span className="text-xs text-ink-3">
                  {group.length} title{group.length === 1 ? '' : 's'}
                </span>
              </div>

              {view === 'grid' ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-5 pt-4">
                  {group.map((title) => (
                    <Card key={title.id} title={title} reasons={reasons.get(title.id)} />
                  ))}
                </div>
              ) : (
                group.map((title) => (
                  <Row key={title.id} title={title} reasons={reasons.get(title.id)} />
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function Card({ title, reasons }: { title: Title; reasons?: AlertReason[] }) {
  return (
    <a
      href={title.url}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-2 text-inherit no-underline"
    >
      <Poster title={title} className="rounded-[10px] shadow-poster" />
      <div className="text-[13px] leading-tight font-[550] text-pretty group-hover:text-signal">
        {title.title}
      </div>
      <div className="figure -mt-1 text-[11.5px] text-ink-3">
        {formatDate(title.releaseDate)} · {formatCountdown(title.daysOut)}
      </div>
      {reasons && reasons.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {reasons.map((reason) => (
            <Tag key={reason} tone={REASON_TONE[reason]}>
              {REASON_LABEL[reason]}
            </Tag>
          ))}
        </div>
      )}
    </a>
  )
}

function Row({ title, reasons }: { title: Title; reasons?: AlertReason[] }) {
  return (
    <a
      href={title.url}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-3.5 border-b border-line-soft py-2 text-inherit no-underline hover:bg-raise"
    >
      <Poster title={title} className="w-[38px] rounded-[5px]" textClass="text-[11px]" />
      <span className="figure w-[62px] shrink-0 text-[12.5px] text-ink-2">
        {formatDate(title.releaseDate)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm group-hover:text-signal">
        {title.title}
        {reasons && reasons.length > 0 && (
          <span className="ml-2 align-middle text-[10px] text-live">●</span>
        )}
      </span>
      <span className="hidden w-[168px] shrink-0 truncate text-xs text-ink-3 md:block">
        {title.genres.slice(0, 3).join(', ')}
      </span>
      <span className="w-[34px] shrink-0 text-[10.5px] tracking-wide text-ink-3 uppercase">
        {title.type === 'movie' ? 'Film' : 'TV'}
      </span>
      <Score title={title} />
      <span className="figure hidden w-[88px] shrink-0 text-right text-xs text-ink-3 sm:block">
        {formatCountdown(title.daysOut)}
      </span>
    </a>
  )
}
