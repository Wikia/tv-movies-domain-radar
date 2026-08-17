import type { TrendingReport } from '../types'
import { Empty, Section, SignalRow, Tag } from './Primitives'

/** Fandom wikis our own audience is reading heavily this week that have NO
 * upcoming release behind them.
 *
 * Deliberately the unmapped half of the signal: titles that DID match a
 * trending wiki are already tagged in place on the schedule, so repeating them
 * here would be the same rows twice. For TV and film this list is arguably the
 * more valuable half — a back-catalogue show surging on a streamer is invisible
 * to a release calendar by construction.
 *
 * Everything is phrased as a sentence. The earlier version printed
 * "0.83 · level 0.85 · +0.69" — the raw export's vocabulary, three unlabelled
 * decimals that look like the same kind of number and aren't.
 */
export function Trending({ report }: { report: TrendingReport | null }) {
  return (
    <Section
      title="Trending on Fandom"
      aside={report ? `${report.unmappedTotal} wikis with no release attached` : 'no data'}
    >
      {!report ? (
        <Empty>
          No first-party export for this run, so no wiki signal. That's missing input, not a quiet
          week.
        </Empty>
      ) : report.unmapped.length === 0 ? (
        <Empty>Every trending wiki this week ties to an upcoming release.</Empty>
      ) : (
        <>
          <p className="mb-3.5 max-w-[80ch] text-[13px] leading-relaxed text-ink-2">
            Fandom wikis our own audience is reading heavily this week that have{' '}
            <b className="text-ink">no upcoming release</b> on the calendar — usually a
            back-catalogue show or film finding a new audience, which a release calendar can't see.
            The number is a 0–100 heat score combining how hot the wiki is with how fast it climbed.
            {report.week && ` Week of ${report.week}; the export moves weekly, not daily.`}
          </p>

          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
            {report.unmapped.map((wiki) => {
              const now = Math.round(wiki.trendingScore * 100)
              const trend = wiki.isNew
                ? 'first week in the trending list'
                : wiki.priorScore != null
                  ? `${Math.round(wiki.priorScore * 100)}% → ${now}% this week`
                  : `${now}% this week`
              return (
                <SignalRow
                  key={wiki.domain}
                  name={wiki.name}
                  score={String(Math.round(wiki.fpScore * 100))}
                  percent={wiki.fpScore * 100}
                  detail={`${wiki.pageviews14d.toLocaleString('en-US')} readers in 14 days · ${trend}`}
                  title={`${wiki.domain} — traffic tier ${wiki.tier}`}
                  badges={
                    wiki.isNew ? (
                      <Tag tone="hot">1st week trending</Tag>
                    ) : wiki.velocity >= 0.1 ? (
                      <Tag tone="hot">climbing</Tag>
                    ) : null
                  }
                />
              )
            })}
          </div>
        </>
      )}
    </Section>
  )
}
