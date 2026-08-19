import { compact, formatDateYear } from '../lib/format'
import type { SourceSignal, Title } from '../types'
import { Poster } from './Poster'
import { Tag } from './Primitives'
import { SourceBadges } from './SourceBadges'

export function TitleDetail({ title, onBack }: { title: Title; onBack: () => void }) {
  const attention = title.attention

  return (
    <div className="mx-auto max-w-[900px] px-7 py-10">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 cursor-pointer rounded-full border border-line px-3 py-1 text-[11px] text-ink-3 transition-colors hover:text-ink"
      >
        ← Back to the radar
      </button>

      <header className="mb-8 flex flex-wrap items-start gap-5">
        <Poster title={title} className="w-24 shrink-0 rounded-lg" textClass="text-2xl" />
        <div className="min-w-0">
          <h1 className="text-[clamp(22px,3.4vw,32px)] leading-tight font-[650] tracking-tight">
            {title.title}
          </h1>
          <p className="figure mt-1.5 text-xs text-ink-3">
            {title.type === 'movie' ? 'Film' : 'TV'} · {formatDateYear(title.releaseDate)}
            {title.daysOut != null && title.daysOut >= 0 && ` · in ${title.daysOut} days`}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {}
            {attention?.confirmed && (
              <Tag tone="hot">confirmed · {attention.rising.length} sources</Tag>
            )}
            {attention && !attention.confirmed && attention.rising.length > 0 && (
              <Tag tone="hot">single source</Tag>
            )}
            {title.buzz && <Tag tone="muted">buzz {title.buzz.points}</Tag>}
            <SourceBadges attention={attention} showQuiet={false} />
            {title.trend && (
              <Tag tone="muted">
                {title.trend.match === 'exact' ? 'wiki hot' : 'franchise hot'}
              </Tag>
            )}
          </div>
        </div>
      </header>

      <h2 className="section-label mb-3 border-b border-line pb-2 text-ink">
        Where it's trending
      </h2>

      {!attention ? (
        <p className="py-4 text-sm text-ink-3">
          Nothing could be measured for this title — no source had enough history. That's an
          absence of evidence, not evidence it's cold.
        </p>
      ) : (
        <>
          <div className="divide-y divide-line-soft">
            {attention.sources.map((signal) => (
              <SourceRow key={signal.source} signal={signal} />
            ))}
          </div>
          <p className="mt-5 max-w-[70ch] text-[13px] leading-relaxed text-ink-3">
            Each source is measured against <i>its own</i> recent normal, then against what titles
            the same distance from release are doing — so the ramp every title gets as it
            approaches release is already divided out.{' '}
            <b className="text-ink-2">Rising</b> means at least twice normal and still climbing
            week over week. A source is only listed once it has enough history to have an opinion.
          </p>
        </>
      )}

      {title.trend && (
        <>
          <h2 className="section-label mt-10 mb-3 border-b border-line pb-2 text-ink">
            On Fandom
          </h2>
          <p className="text-[13px] leading-relaxed text-ink-2">
            {title.trend.match === 'exact' ? (
              <>
                This title's own wiki,{' '}
                <a
                  href={`https://${title.trend.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  {title.trend.domain}
                </a>
                , is trending this week.
              </>
            ) : (
              <>
                Its franchise hub{' '}
                <a
                  href={`https://${title.trend.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  {title.trend.domain}
                </a>{' '}
                is trending — which says the franchise is drawing an audience, not necessarily
                this title.
              </>
            )}{' '}
            <span className="figure">
              {title.trend.pageviews14d.toLocaleString('en-US')} readers in 14 days, trending{' '}
              {Math.round(title.trend.trendingScore * 100)}%
              {title.trend.isNew && ' — first week in the trending list'}.
            </span>
          </p>
        </>
      )}

    </div>
  )
}

const SOURCE_LABEL: Record<SourceSignal['source'], string> = {
  wikipedia: 'Wikipedia',
  news: 'Google News',
  youtube: 'YouTube',
  tmdb: 'TMDB',
}

const METRIC_LABEL: Record<string, string> = {
  views: 'views/day',
  onTopic: 'articles/day',
  popularity: 'popularity',
}

function SourceRow({ signal }: { signal: SourceSignal }) {
  const tone =
    signal.phase === 'rising' ? 'hot' : signal.phase === 'fading' ? 'muted' : 'muted'
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
      <span className="w-28 shrink-0 text-sm font-[550]">{SOURCE_LABEL[signal.source]}</span>
      <Tag tone={tone}>{signal.phase}</Tag>
      <span className="figure text-[13px] text-ink-2">
        {compact(signal.baseline)} → {compact(signal.recent)}{' '}
        <span className="text-ink-3">{METRIC_LABEL[signal.metric] ?? signal.metric}</span>
      </span>
      <span className="figure ml-auto text-[13px]">
        <b className={signal.phase === 'rising' ? 'text-hot-2' : 'text-ink-3'}>
          {signal.relative}×
        </b>
        <span className="text-ink-3"> vs similar · {signal.momentum}× wk · {signal.days}d</span>
      </span>
    </div>
  )
}
