import { useMemo, useState } from 'react'

import {
  REASON_LABEL,
  REASON_TONE,
  formatCountdown,
  formatDate,
  formatMonth,
  groupByMonth,
} from '../lib/format'
import type { AlertReason, MediaType, Title } from '../types'
import { Poster } from './Poster'
import { Empty, Section, Tag } from './Primitives'

/** Filters are shared with the stat tiles in App, so they live in one type. */
export type Filter = 'all' | MediaType | 'changed'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'changed', label: 'Changed' },
  { id: 'movie', label: 'Film' },
  { id: 'show', label: 'TV' },
]

const FILTER_ASIDE: Record<Filter, string> = {
  all: 'everything landing in the window',
  changed: 'added or moved since the last run',
  movie: 'films only',
  show: 'TV only',
}

/** One column template shared by the header and every row — the only way the
 * two stay aligned. Genres and countdown drop out on narrow screens. */
const COLS =
  'grid grid-cols-[64px_28px_1fr_40px_40px] items-center gap-x-3 ' +
  'sm:grid-cols-[64px_28px_1fr_40px_40px_88px] ' +
  'lg:grid-cols-[64px_28px_1fr_40px_160px_40px_88px]'

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
      // Changed titles are the exception to the horizon: one matters however
      // far out it sits.
      if (filter !== 'changed' && !showAll) {
        if (title.daysOut == null || title.daysOut > horizonDays) return false
      }
      if (title.daysOut != null && title.daysOut < 0) return false
      if ((filter === 'movie' || filter === 'show') && title.type !== filter) return false
      if (filter === 'changed' && !reasons.has(title.id)) return false
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
          className="w-36 rounded-md border border-line bg-transparent px-2.5 py-1 text-[11px] outline-none placeholder:text-ink-3 focus:border-accent"
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
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-line text-ink-3 hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
        {filter !== 'changed' && (
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
            <span className="text-right" title="Metascore — usually absent before release">
              MC
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

function Row({ title, reasons }: { title: Title; reasons?: AlertReason[] }) {
  return (
    <a
      href={title.url}
      target="_blank"
      rel="noreferrer"
      className={`${COLS} group border-b border-line-soft py-1.5 text-inherit no-underline hover:bg-raise`}
    >
      <span className="figure text-[12.5px] text-ink-2">{formatDate(title.releaseDate)}</span>

      <Poster title={title} className="w-7 rounded-[3px]" textClass="text-[8px]" />

      <span className="min-w-0 truncate text-sm group-hover:text-accent">
        {title.title}
        {reasons && reasons.length > 0 && (
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

      {/* Most titles have no Metascore before release. An explicit dash says
          "not rated yet" instead of leaving a hole that reads as a bug. */}
      {title.criticScore != null ? (
        <span className="figure text-right text-xs text-ink-2">{title.criticScore}</span>
      ) : (
        <span
          className="figure text-right text-xs text-ink-3/60"
          title="No Metascore yet — normal before release"
        >
          —
        </span>
      )}

      <span className="figure hidden text-right text-xs text-ink-3 sm:block">
        {formatCountdown(title.daysOut)}
      </span>
    </a>
  )
}
