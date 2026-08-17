import { compact } from '../lib/format'
import type { TrendingReport } from '../types'
import { Empty, Section, SignalRow, Tag } from './Primitives'

/** Fandom wikis our own audience is hot on that have NO upcoming release behind
 * them.
 *
 * Deliberately the unmapped half of the signal: titles that DID match a
 * trending wiki are already tagged in place on the schedule, so repeating them
 * here would be the same rows twice. For TV and film this list is arguably the
 * more valuable half — a back-catalog show surging on a streamer is invisible
 * to a release calendar by construction. */
export function Trending({ report }: { report: TrendingReport | null }) {
  return (
    <Section
      title="Trending on Fandom"
      aside={report ? `no release attached · ${report.unmappedTotal}` : 'no data'}
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
          {report.unmapped.map((wiki) => (
            <SignalRow
              key={wiki.domain}
              name={wiki.name}
              // fpScore, not the raw level: it's what the list is ordered by,
              // and showing the level instead made the ordering look arbitrary
              // because velocity moves the sort without being on screen.
              score={wiki.fpScore.toFixed(2)}
              percent={wiki.fpScore * 100}
              detail={`${wiki.domain} · level ${wiki.trendingScore.toFixed(2)} · ${compact(wiki.pageviews14d)} views`}
              title={`${wiki.domain} — ${wiki.pageviews14d.toLocaleString('en-US')} views over 14 days, tier ${wiki.tier}`}
              badges={
                wiki.isNew ? (
                  <Tag tone="hot">new</Tag>
                ) : wiki.velocity > 0 ? (
                  <Tag tone="muted">+{wiki.velocity.toFixed(2)}</Tag>
                ) : null
              }
            />
          ))}
          {report.week && (
            <p className="pt-2.5 text-[11px] text-ink-3">
              Week of {report.week}. The export is weekly, so this moves once a week rather than
              daily.
            </p>
          )}
        </>
      )}
    </Section>
  )
}
