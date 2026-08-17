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
      aside={report ? `${report.unmappedTotal} unattached` : 'no data'}
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
          {/* One-line standfirst: enough to say what the list is without eating
              the space the list itself needs in a narrow rail. */}
          <p className="mb-2.5 text-xs leading-relaxed text-ink-3">
            Wikis our audience is reading heavily that have{' '}
            <b className="text-ink-2">no upcoming release</b> — where a back-catalogue surge shows
            up.
          </p>

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
                detail={
                  <>
                    {wiki.pageviews14d.toLocaleString('en-US')} readers in 14 days
                    <br />
                    {trend}
                  </>
                }
                title={`${wiki.domain} — traffic tier ${wiki.tier}`}
                badges={
                  wiki.isNew ? (
                    <Tag tone="hot">1st week</Tag>
                  ) : wiki.velocity >= 0.1 ? (
                    <Tag tone="hot">climbing</Tag>
                  ) : null
                }
              />
            )
          })}
        </>
      )}
    </Section>
  )
}
