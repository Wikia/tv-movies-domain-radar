import { useCallback, useEffect, useMemo, useState } from 'react'

import { Buzz } from './components/Buzz'
import { Changes } from './components/Changes'
import { Tile } from './components/Primitives'
import { TitleDetail } from './components/TitleDetail'
import { TrendingPage } from './components/TrendingPage'
import { Trending } from './components/Trending'
import { Schedule, type Filter } from './components/Schedule'
import { ThemeToggle } from './components/ThemeToggle'
import { formatTimestamp } from './lib/format'
import type { AlertReason, RadarOutput } from './types'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string; hint?: string }
  | { status: 'ready'; data: RadarOutput }

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [filter, setFilter] = useState<Filter>('all')
  // Real URLs rather than a modal, so a trending title can be linked to and
  // reloaded. The server already serves the app for any unmatched path.
  const [route, setRoute] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPop = (): void => setRoute(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((path: string) => {
    window.history.pushState({}, '', path)
    setRoute(path)
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const response = await fetch('/api/radar')
        const body = await response.json()
        if (cancelled) return

        if (!response.ok) {
          setState({
            status: 'error',
            message: body?.error ?? `Request failed (${response.status})`,
            hint: body?.hint,
          })
          return
        }
        setState({ status: 'ready', data: body as RadarOutput })
      } catch (error) {
        if (cancelled) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not reach the radar server.',
          hint: 'Is the server running? `npm run serve`',
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const data = state.status === 'ready' ? state.data : null

  /** Change reasons keyed by title id — lets the schedule tag and filter to
   * changed titles without a second section duplicating the same rows. */
  const reasons = useMemo(() => {
    const map = new Map<number, AlertReason[]>()
    for (const alert of data?.alerts ?? []) map.set(alert.title.id, alert.reasons)
    return map
  }, [data])

  if (state.status === 'loading') return <Centered>Loading radar…</Centered>

  if (state.status === 'error') {
    return (
      <Centered>
        <p className="font-medium text-accent">{state.message}</p>
        {state.hint && <p className="mt-2 text-sm text-ink-2">{state.hint}</p>}
      </Centered>
    )
  }

  if (!data) return null

  if (route === '/trending') {
    return (
      <TrendingPage
        titles={data.titles}
        onOpen={(id) => navigate(`/title/${id}`)}
        onBack={() => navigate('/')}
      />
    )
  }

  const detailId = /^\/title\/(\d+)$/.exec(route)?.[1]
  if (detailId) {
    const title = data.titles.find((t) => String(t.id) === detailId)
    if (title) return <TitleDetail title={title} onBack={() => navigate('/')} />
  }

  /** Clicking an active tile clears it, so a tile is a toggle, not a trap. */
  const toggle = (next: Filter) => setFilter((current) => (current === next ? 'all' : next))

  return (
    <div className="mx-auto max-w-[1140px] px-7 py-10">
      <header className="mb-9 flex flex-wrap items-end gap-5">
        <div>
          <p className="mb-1.5 text-[13px] text-ink-2">Fandom · TV &amp; Movies domain</p>
          <h1 className="text-[clamp(28px,4.4vw,40px)] leading-[1.05] font-[650] tracking-tight text-balance">
            Release Radar
          </h1>
          <p className="figure mt-1.5 text-[11.5px] text-ink-3">
            generated {formatTimestamp(data.generatedAt)} · source: neutron-api
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-stretch gap-2.5">
          <Tile label={`Next ${data.horizonDays} days`} value={data.counts.inHorizon} />
          <Tile label="Upcoming" value={data.counts.upcoming} />
          <Tile
            label="Changed"
            value={data.counts.alerts}
            active={filter === 'changed'}
            onClick={() => toggle('changed')}
          />
          {/* The count and the page that lists them are the same idea, so
              clicking the number to see them is the obvious gesture. */}
          {data.buzz && (
            <Tile label="Trending" value={data.buzz.spiking} onClick={() => navigate('/trending')} />
          )}
          {data.trending && <Tile label="Wikis trending" value={data.trending.wikis} />}
          <ThemeToggle />
        </div>
      </header>

      <div className="grid items-start gap-11 lg:grid-cols-[1fr_340px]">
        <Schedule
          titles={data.titles}
          horizonDays={data.horizonDays}
          filter={filter}
          onFilter={setFilter}
          reasons={reasons}
          onOpen={(id) => navigate(`/title/${id}`)}
        />
        {/* Buzz sits ABOVE the change log: the log runs to dozens of rows on a
            busy day (mostly "dropped", which is audit trail rather than news)
            and pushed the signal panel below the fold. */}
        <div className="flex flex-col gap-11">
          <Buzz
            titles={data.titles}
            coverage={data.buzz}
            total={data.counts.upcoming}
            onOpen={(id) => navigate(`/title/${id}`)}
          />
          <Trending report={data.trending} />
          <Changes
            changes={data.changes}
            known={new Set(data.titles.map((t) => t.id))}
            onOpen={(id) => navigate(`/title/${id}`)}
          />
        </div>
      </div>

      <section className="mt-12 border-t border-line pt-5 text-[13px] leading-relaxed text-ink-2">
        <h2 className="section-label mb-2.5 text-ink">How to read this</h2>
        <p>
          The full forward calendar of film and TV releases from the Metacritic catalog, in date
          order. <b className="text-ink">Changed</b> titles are ones added to the calendar or moved
          since the previous run — that comes from diffing against our own stored snapshot, and it's
          a signal the upstream API doesn't expose.
        </p>
        <p className="mt-2.5">
          <b className="text-ink">Buzz</b> scores the <i>size of the surge</i> in Wikipedia
          pageviews — daily views beyond what a title the same
          distance from release would be getting anyway — so a big name sitting at its normal level
          scores nothing. The scale is anchored on a real event:{' '}
          <b className="text-ink">100 = The Odyssey's peak of 1.2M views/day</b>. For calibration,
          Superman (2025) would score 93, Avatar: Fire and Ash 90, Wicked: For Good 82. An ordinary
          trailer drop lands in the 40s–60s, so a week with nothing in red is the scale working,
          not a fault. The ramp runs <span className="text-hot-4">quiet</span> →{' '}
          <span className="text-hot-3">notable</span> → <span className="text-hot-2">strong</span> →{' '}
          <span className="text-hot-1">exceptional</span>, and the score is always shown beside the
          colour. <b className="text-ink">Rising</b> means at least twice normal <i>and still
          climbing week over week</i>; <b className="text-ink">fading</b> means still elevated, but
          the event has passed.
        </p>
        <p className="mt-2.5">
          <b className="text-ink">Trending on Fandom</b> is our own weekly wiki traffic
          {data.trending?.week ? ` (week of ${data.trending.week})` : ''}. A{' '}
          <b className="text-ink">wiki hot</b> tag means the title's own wiki is trending;{' '}
          <b className="text-ink">franchise hot</b> means its franchise hub is — which says the
          franchise is drawing an audience, not this title. The side panel lists trending wikis
          with <i>no</i> upcoming release behind them, which is where a back-catalogue surge shows
          up.
        </p>
        <p className="mt-2.5">
          The <b className="text-ink">Buzz</b> column replaced the Metascore: almost nothing has a
          Metascore before release, so it was a column of dashes. A dash there now means{' '}
          <i>not measured</i> — no Wikipedia article, or too little traffic to read — which is not
          the same as cold.
        </p>
        <p className="mt-2.5 text-ink-3">
          The schedule is ordered by date and nothing here ranks titles by demand — both signals are
          attached as labelled evidence, and a title with no tag has <i>no signal</i> rather than a
          cold one.
        </p>
      </section>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <div>{children}</div>
    </div>
  )
}
