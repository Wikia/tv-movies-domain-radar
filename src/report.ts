// What happened on a run, in a shape something else can act on. The pipeline
// degrades rather than fails, so without this "degraded" and "fine" look
// identical from outside.
export type Status = 'ok' | 'degraded' | 'failed' | 'skipped'

interface Step {
  name: string
  status: Status
  detail: string
}

// A title spiking hard enough to be worth naming in the Slack message. Only the
// genuinely notable ones — see BUZZ.trendingAlert — so an ordinary day carries
// none and the section is dropped entirely.
export interface Highlight {
  title: string
  points: number
  band: string
  rising: number
}

export interface RunReport {
  startedAt: string
  finishedAt: string
  seconds: number
  today: string
  published: boolean
  status: Status
  steps: Step[]
  warnings: string[]
  counts: Record<string, number>
  highlights: Highlight[]
}

export class Run {
  private readonly started = Date.now()
  private readonly startedAt = new Date().toISOString()
  // Set as the run learns them, so the failure path can still report.
  today = ''
  published = false
  readonly steps: Step[] = []
  readonly warnings: string[] = []
  readonly counts: Record<string, number> = {}
  readonly highlights: Highlight[] = []

  step(name: string, status: Status, detail: string): void {
    this.steps.push({ name, status, detail })
  }

  highlight(h: Highlight): void {
    this.highlights.push(h)
  }

  warn(message: string): void {
    this.warnings.push(message)
  }

  count(key: string, value: number): void {
    this.counts[key] = value
  }

  // Failed wakes someone; degraded is worth saying but not an alarm; skipped is
  // configuration, not a fault.
  get status(): Status {
    if (this.steps.some((s) => s.status === 'failed')) return 'failed'
    if (this.steps.some((s) => s.status === 'degraded') || this.warnings.length > 0) {
      return 'degraded'
    }
    return 'ok'
  }

  finish(): RunReport {
    const finishedAt = new Date().toISOString()
    return {
      startedAt: this.startedAt,
      finishedAt,
      seconds: Math.round((Date.now() - this.started) / 100) / 10,
      today: this.today,
      published: this.published,
      status: this.status,
      steps: this.steps,
      warnings: this.warnings,
      counts: this.counts,
      highlights: this.highlights,
    }
  }
}

// One line per step that isn't ok, plus the verdict.
export function summarise(report: RunReport): string {
  const lines = [`[run] ${report.status} in ${report.seconds}s`]
  for (const step of report.steps) {
    if (step.status !== 'ok') lines.push(`  ${step.status.padEnd(8)} ${step.name}: ${step.detail}`)
  }
  for (const warning of report.warnings) lines.push(`  warning  ${warning}`)
  return lines.join('\n')
}
