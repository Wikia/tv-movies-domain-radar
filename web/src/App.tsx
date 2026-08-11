import { useEffect, useState } from 'react'

import { Alerts } from './components/Alerts'
import { StatTile } from './components/Primitives'
import { Schedule } from './components/Schedule'
import { Changes, Trending } from './components/Sidebar'
import { formatTimestamp } from './lib/format'
import type { RadarOutput } from './types'
import { hasDemandSignal } from './types'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string; hint?: string }
  | { status: 'ready'; data: RadarOutput }

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })

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

  if (state.status === 'loading') {
    return <Centered>Loading radar…</Centered>
  }

  if (state.status === 'error') {
    return (
      <Centered>
        <p className="font-medium text-hot">{state.message}</p>
        {state.hint && <p className="mt-2 text-sm text-muted">{state.hint}</p>}
      </Centered>
    )
  }

  const { data } = state
  const withDemand = data.titles.filter(hasDemandSignal).length

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">TV &amp; Movies Radar</h1>
          <p className="mt-1 text-sm text-muted">
            Upcoming releases and what's gaining traction · generated{' '}
            {formatTimestamp(data.generatedAt)}
          </p>
        </div>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Alerts" value={data.counts.alerts} hint="meet an alert rule" />
        <StatTile
          label={`Next ${data.horizonDays}d`}
          value={data.counts.inHorizon}
          hint="titles landing"
        />
        <StatTile label="Upcoming" value={data.counts.upcoming} hint="on the full calendar" />
        <StatTile
          label="Demand signal"
          value={`${withDemand}/${data.counts.upcoming}`}
          hint="rest are schedule-only"
        />
      </div>

      {/* Coverage is thin enough that stating it in the UI is honest rather than
          apologetic — a low score means "no corroboration", not "unwanted". */}
      <p className="mb-6 rounded-lg border border-border bg-panel px-4 py-3 text-xs text-muted">
        <strong className="font-semibold text-ink">Reading the scores:</strong> only{' '}
        {withDemand} of {data.counts.upcoming} upcoming titles carry a real demand signal, and no
        upcoming TV does — the upstream popularity ranking excludes unreleased shows. Titles
        without one show “—” instead of a score, because a capped number would invite ranking on
        noise.
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Alerts alerts={data.alerts} />
          <Schedule titles={data.titles} horizonDays={data.horizonDays} />
        </div>
        <aside className="flex flex-col gap-6">
          <Trending titles={data.trending} />
          <Changes changes={data.changes} />
        </aside>
      </div>
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
