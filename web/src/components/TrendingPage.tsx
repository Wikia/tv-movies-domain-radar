import { formatCountdown, formatDateYear } from '../lib/format'
import type { Title } from '../types'
import { Poster } from './Poster'
import { Tag } from './Primitives'
import { SourceBadges } from './SourceBadges'

/** Everything currently trending, and what each verdict rests on.
 *
 * The schedule answers "what's coming"; this answers "what's hot", which is a
 * different question and was previously only answerable by reading a number out
 * of a sidebar. Confirmed titles lead, because two independent sources agreeing
 * is a materially stronger claim than one — that distinction is the whole reason
 * for collecting more than one source.
 */
export function TrendingPage({
  titles,
  onOpen,
  onBack,
}: {
  titles: Title[]
  onOpen: (id: number) => void
  onBack: () => void
}) {
  const trending = titles
    .filter((title) => (title.attention?.rising.length ?? 0) > 0)
    .sort((a, b) => {
      const byCount = b.attention!.rising.length - a.attention!.rising.length
      if (byCount !== 0) return byCount
      // Then by the strongest single reading, so the loudest event leads.
      const strength = (t: Title): number =>
        Math.max(...t.attention!.sources.map((s) => s.relative))
      return strength(b) - strength(a)
    })

  const confirmed = trending.filter((t) => t.attention!.confirmed)
  const anyMock = trending.some((t) => t.attention!.mock)

  return (
    <div className="mx-auto max-w-[1140px] px-7 py-10">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 cursor-pointer rounded-full border border-line px-3 py-1 text-[11px] text-ink-3 transition-colors hover:text-ink"
      >
        ← Back to the radar
      </button>

      {anyMock && (
        <div className="mb-6 rounded-lg border border-hot-2 bg-hot-2/10 px-4 py-2.5 text-[13px] text-ink-2">
          <b className="text-hot-2">Demo data.</b> Some readings behind these verdicts were
          generated, not observed — YouTube, TMDB and Google News have no history endpoint, so
          their real series are still accruing.
        </div>
      )}

      <header className="mb-7">
        <h1 className="text-[clamp(24px,3.6vw,34px)] leading-tight font-[650] tracking-tight">
          Trending now
        </h1>
        <p className="mt-1.5 text-[13px] text-ink-2">
          {trending.length} titles moving · <b className="text-ink">{confirmed.length}</b>{' '}
          confirmed by two or more independent sources.
        </p>
      </header>

      {trending.length === 0 ? (
        <p className="py-6 text-sm text-ink-3">
          Nothing is above its own normal right now. That's a quiet week, not a broken pipeline —
          and a source with too little history to judge is simply absent rather than reported as
          flat.
        </p>
      ) : (
        <div className="divide-y divide-line-soft">
          {trending.map((title) => (
            <a
              key={title.id}
              href={`/title/${title.id}`}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) return
                event.preventDefault()
                onOpen(title.id)
              }}
              className="group flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-inherit no-underline hover:bg-raise"
            >
              <Poster title={title} className="w-9 shrink-0 rounded-[3px]" textClass="text-[9px]" />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-[550] group-hover:text-accent">
                  {title.title}
                </span>
                <span className="figure text-[11px] text-ink-3">
                  {title.type === 'movie' ? 'Film' : 'TV'} ·{' '}
                  {formatDateYear(title.releaseDate)} · {formatCountdown(title.daysOut)}
                </span>
              </span>

              {title.attention!.confirmed && <Tag tone="hot">confirmed</Tag>}
              <SourceBadges attention={title.attention} />
            </a>
          ))}
        </div>
      )}

      <p className="mt-7 max-w-[74ch] text-[13px] leading-relaxed text-ink-3">
        A badge means that source has enough history to have an opinion and sees the title at least
        twice its own normal, still climbing. Dimmed badges were measured and stayed flat — worth
        showing, because a disagreement is more informative than a quiet consensus. Sources with
        too little history are absent rather than reported as flat.
      </p>
    </div>
  )
}
