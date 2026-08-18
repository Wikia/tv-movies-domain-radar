import type { TrendingReport } from '../types'
import { Empty, Section, SignalRow, Tag } from './Primitives'

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
                href={`https://${wiki.domain}`}
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
