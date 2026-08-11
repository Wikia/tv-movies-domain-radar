import { useMemo, useState } from 'react'

import { REASON_LABEL, REASON_TONE, formatCountdown, formatDate, formatMonth, groupByMonth } from '../lib/format'
import type { AlertReason, MediaType, Title } from '../types'
import { hasDemandSignal } from '../types'
import { Poster } from './Poster'
import { Empty, Section, Tag } from './Primitives'

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

/** One column template shared by the header and every row — the only way the
 * two stay aligned. Genres and countdown drop out on narrow screens; the
 * signal columns never do, since they're the point of the table. */
const COLS =
  'grid grid-cols-[64px_28px_1fr_40px_44px_44px] items-center gap-x-3 ' +
  'sm:grid-cols-[64px_28px_1fr_40px_44px_44px_84px] ' +
  'lg:grid-cols-[64px_28px_1fr_40px_150px_44px_44px_84px]'

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

  return (
    <Section
      title="Schedule"
      aside={`${visible.length} · ${FILTER_ASIDE[filter]}`}
      controls={
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter…"
          className="w-36 rounded-md border border-line bg-transparent px-2.5 py-1 text-[11px] outline-none placeholder:text-ink-3 focus:border-signal"
        />
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
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
          <div
            className={`${COLS} sticky top-0 z-20 border-b border-line bg-ground py-1.5 text-[10px] tracking-wide text-ink-3 uppercase`}
          >
            <span>Date</span>
            <span />
            <span>Title</span>
            <span>Type</span>
            <span className="hidden lg:block">Genres</span>
            <span className="text-right" title="Blended demand score (0–100)">
              Score
            </span>
            <span className="text-right" title="Rank in the current trending list">
              Trend
            </span>
            <span className="hidden text-right sm:block">Out</span>
          </div>

          {groupByMonth(visible).map(([month, group]) => (
            <div key={month}>
              <div className="flex items-baseline gap-2.5 border-b border-line pt-4 pb-1.5">
                <b className="text-[13px] font-[650]">
                  {month === 'unknown' ? 'Undated' : formatMonth(`${month}-01`)}
                </b>
                <span className="text-xs text-ink-3">
                  {group.length} title{group.length === 1 ? '' : 's'}
                </span>
              </div>

              {group.map((title) => (
                <Row key={title.id} title={title} reasons={reasons.get(title.id)} />
              ))}
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

/** Empty cells render an explicit dash rather than collapsing, so a missing
 * score reads as "we have no evidence" instead of looking like a layout bug. */
function Missing({ hint }: { hint: string }) {
  return (
    <span className="figure text-right text-xs text-ink-3/60" title={hint}>
      —
    </span>
  )
}

function Row({ title, reasons }: { title: Title; reasons?: AlertReason[] }) {
  const alerted = reasons && reasons.length > 0

  return (
    <a
      href={title.url}
      target="_blank"
      rel="noreferrer"
      className={`${COLS} group border-b border-line-soft py-1.5 text-inherit no-underline hover:bg-raise`}
    >
      <span className="figure text-[12.5px] text-ink-2">{formatDate(title.releaseDate)}</span>

      <Poster title={title} className="w-7 rounded-[3px]" textClass="text-[8px]" />

      <span className="min-w-0 truncate text-sm group-hover:text-signal">
        {title.title}
        {alerted && (
          <span className="ml-2 inline-flex gap-1 align-middle">
            {reasons.map((reason) => (
              <Tag key={reason} tone={REASON_TONE[reason]}>
                {REASON_LABEL[reason]}
              </Tag>
            ))}
          </span>
        )}
      </span>

      <span className="text-[10.5px] tracking-wide text-ink-3 uppercase">
        {title.type === 'movie' ? 'Film' : 'TV'}
      </span>

      <span className="hidden truncate text-xs text-ink-3 lg:block">
        {title.genres.slice(0, 2).join(', ') || '—'}
      </span>

      {hasDemandSignal(title) ? (
        <span
          className={`figure text-right text-xs ${
            title.score >= 70 ? 'font-semibold text-signal' : 'text-ink-2'
          }`}
          title="Blended demand score (0–100)"
        >
          {title.score.toFixed(0)}
        </span>
      ) : (
        <Missing hint="No demand signal — scheduled only. Any score would be an artefact of the release date." />
      )}

      {title.trendingRank != null ? (
        <span className="figure text-right text-xs text-live" title="Rank in the trending list">
          #{title.trendingRank}
        </span>
      ) : (
        <Missing hint="Not in the current trending list" />
      )}

      <span className="figure hidden text-right text-xs text-ink-3 sm:block">
        {formatCountdown(title.daysOut)}
      </span>
    </a>
  )
}
