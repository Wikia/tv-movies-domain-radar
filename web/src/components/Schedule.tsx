import { useMemo, useState } from 'react'

import {
  REASON_LABEL,
  REASON_TONE,
  formatCountdown,
  formatDate,
  formatMonth,
  groupByMonth,
  isCalendarChange,
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
  'lg:grid-cols-[64px_28px_1fr_40px_128px_40px_88px]'

/** The schedule's scroll box.
 *
 * `pr-3` and `scrollbar-gutter:stable` are not cosmetic: the grid's last column
 * (the countdown) is right-aligned to the container edge, and an overlay
 * scrollbar sat directly on top of it. The gutter reserves the space whether or
 * not the bar is visible, so rows don't shift when it appears.
 *
 * Height is set to sit roughly level with the rail (Buzz, Trending, the change
 * log) rather than to fill the viewport — if the two columns end far apart the
 * page has a long empty gutter down one side. */
const SCROLL = 'max-h-[62rem] overflow-y-auto pr-3 [scrollbar-gutter:stable]'

/** Band -> text colour for the inline score. Written out in full because
 * Tailwind scans for literal class names. */
const BAND_TEXT = {
  exceptional: 'text-hot-1',
  strong: 'text-hot-2',
  notable: 'text-hot-3',
  quiet: 'text-hot-4',
} as const

export function Schedule({
  titles,
  horizonDays,
  filter,
  onFilter,
  reasons,
  onOpen,
}: {
  titles: Title[]
  horizonDays: number
  filter: Filter
  onFilter: (filter: Filter) => void
  reasons: Map<number, AlertReason[]>
  onOpen: (id: number) => void
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
      // "Changed" means the CALENDAR changed. A title flagged only because its
      // wiki is trending is alerted but not changed, and would otherwise show
      // up here with no tag explaining why.
      if (filter === 'changed' && !isCalendarChange(reasons.get(title.id))) return false
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
        <div className={SCROLL}>
          <div
            className={`${COLS} sticky top-0 z-20 border-b border-line bg-ground py-1.5 text-[10px] tracking-wide text-ink-3 uppercase`}
          >
            <span>Date</span>
            <span />
            <span>Title</span>
            <span>Type</span>
            <span className="hidden lg:block">Genres</span>
            <span
              className="text-right"
              title="Buzz — Wikipedia attention vs this title's own normal. 50 is normal."
            >
              Buzz
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
                <Row
                  key={title.id}
                  title={title}
                  reasons={reasons.get(title.id)}
                  onOpen={onOpen}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function Row({
  title,
  reasons,
  onOpen,
}: {
  title: Title
  reasons?: AlertReason[]
  onOpen: (id: number) => void
}) {
  // A row now leads to the evidence rather than off to Metacritic — the
  // outbound link lives on the detail page, where there's room to label it.
  return (
    <a
      href={`/title/${title.id}`}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return
        event.preventDefault()
        onOpen(title.id)
      }}
      className={`${COLS} group border-b border-line-soft py-1.5 text-inherit no-underline hover:bg-raise`}
    >
      <span className="figure text-[12.5px] text-ink-2">{formatDate(title.releaseDate)}</span>

      <Poster title={title} className="w-7 rounded-[3px]" textClass="text-[8px]" />

      {/* The title truncates; the badges must not. They used to live inside the
          truncating span, so a long title silently ate the "new on calendar"
          tag and the buzz score — the two things the row exists to flag. */}
      <span className="flex min-w-0 items-center gap-2 text-sm group-hover:text-accent">
        <span className="truncate">{title.title}</span>
        <span className="flex shrink-0 items-center gap-1">
          {/* Reasons with a blank label render nothing — see REASON_LABEL. */}
          {(reasons ?? [])
            .filter((reason) => REASON_LABEL[reason] !== '')
            .map((reason) => (
              <Tag key={reason} tone={REASON_TONE[reason]}>
                {REASON_LABEL[reason]}
              </Tag>
            ))}

          {/* Only SPIKING titles are tagged. Tagging all ~138 measured ones
              would make the marker meaningless. */}
          {/* Buzz lives in its own column now — see below. Nothing here. */}

          {/* "franchise hot" is a weaker claim than "wiki hot" — the franchise
              hub is drawing an audience, not necessarily this title. Kept
              visually quieter so the two don't read alike. */}
          {/* How many independent sources agree. The count is the point: one
              source rising is a lead, several is an event. */}
          {title.attention && title.attention.rising.length > 0 && (
            <Tag tone="muted">
              <span title={`rising in: ${title.attention.rising.join(', ')}`}>
                {title.attention.rising.length}&times;
              </span>
            </Tag>
          )}
          {title.trend && (
            <Tag tone={title.trend.match === 'exact' ? 'hot' : 'muted'}>
              <span
                title={`${title.trend.domain} · trending ${title.trend.trendingScore.toFixed(2)}`}
              >
                {title.trend.match === 'exact' ? 'wiki hot' : 'franchise hot'}
              </span>
            </Tag>
          )}
        </span>
      </span>

      <span className="text-[10.5px] tracking-wide text-ink-3 uppercase">
        {title.type === 'movie' ? 'Film' : 'TV'}
      </span>

      <span className="hidden truncate text-xs text-ink-3 lg:block">
        {title.genres.slice(0, 2).join(', ') || '—'}
      </span>

      {/* Buzz replaced the Metascore column: most upcoming titles have no
          Metascore, so it was a column of dashes, and the buzz number is the
          thing worth scanning down. Rising titles are emphasised; measured but
          static ones stay quiet. An explicit dash means "not measured" — NOT
          "cold" — which the tooltip says outright. */}
      {title.buzz ? (
        <span
          className={`figure text-right text-xs ${
            // A 0 means measured with no surge at all. Painting it a band
            // colour implies a signal that isn't there, so zero stays neutral.
            title.buzz.points === 0 ? 'text-ink-3' : BAND_TEXT[title.buzz.band]
          } ${title.buzz.spiking ? 'font-semibold' : 'opacity-70'}`}
          title={`Buzz ${title.buzz.points}/100 · ${title.buzz.band}${
            title.buzz.spiking ? ' · rising' : ''
          } — +${title.buzz.excess} views/day over normal (${title.buzz.baseline} → ${title.buzz.recent})`}
        >
          {title.buzz.points}
        </span>
      ) : (
        <span
          className="figure text-right text-xs text-ink-3/60"
          title="No buzz signal — no Wikipedia article, or too little traffic to read. Not the same as cold."
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
