/** Self-contained HTML dashboard generator.
 *
 * The React app in web/ is the operator's tool: it needs a server, and it
 * filters and searches. This is the SHAREABLE artifact — one file, data baked
 * in, no server, no network. It's what gets published for people who just want
 * to look, and it must survive a strict CSP: no external fonts, scripts, or
 * images beyond the poster URLs, which degrade gracefully if blocked.
 *
 * Emits two files:
 *   out/dashboard.html          — standalone page, open it in a browser
 *   out/dashboard.artifact.html — body-only fragment, for publishing as an
 *                                 Artifact (whose host supplies the skeleton)
 *
 * Visual identity is deliberately NOT the gaming radar's: that page is
 * light-first cool blue-grey with teal/amber on rounded, shadowed cards. This
 * one is a broadcast transmission log — graphite ground, one on-air red,
 * condensed uppercase headers over tabular mono, square edges, hairline rules,
 * no shadows and no cards at all.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ROOT } from './config.js'
import type { Alert, AlertReason, Change, RadarOutput, Title } from './types.js'

const REASON_LABEL: Record<AlertReason, string> = {
  'trending-and-imminent': 'trending + landing soon',
  'high-score': 'high demand',
  'newly-added': 'new on calendar',
  'date-changed': 'date moved',
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function hasDemand(title: Title): boolean {
  return title.popularityRank != null || title.trendingRank != null || title.fandomSignal != null
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'TBD'
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  })
}

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  })
}

function fmtMonth(iso: string): string {
  return new Date(`${iso}-01T00:00:00Z`)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .toUpperCase()
}

function countdown(daysOut: number | null): string {
  if (daysOut == null) return '—'
  if (daysOut < 0) return `${Math.abs(daysOut)}d ago`
  if (daysOut === 0) return 'today'
  if (daysOut === 1) return '1 day'
  if (daysOut < 45) return `${daysOut} days`
  return `${Math.round(daysOut / 30)} mo`
}

/** Score cell. A capped score is an absence of evidence, not a measurement, so
 * unbacked titles show a dash rather than a number that invites false ranking. */
function scoreCell(title: Title): string {
  if (!hasDemand(title)) return '<td class="num dim" title="No demand signal — scheduled only">—</td>'
  const tone = title.score >= 70 ? ' hot' : title.score >= 50 ? ' warm' : ''
  return `<td class="num${tone}">${title.score.toFixed(0)}</td>`
}

const CSS = `
/* Tokens. Light is the base on bare :root; dark is redefined twice — once for
   the un-stamped "system" state, once for an explicit toggle — so all three
   viewer states resolve. No color is ever defined only inside a media block. */
:root{
  --ground:#F3F2F0; --surface:#FFFFFF; --rule:#DAD7D2; --rule-soft:#E6E3DF;
  --ink:#16181A; --ink-muted:#5F6367; --ink-faint:#8B9095;
  --onair:#C42A1B; --onair-soft:rgba(196,42,27,.09);
  --signal:#2C7F92; --signal-soft:rgba(44,127,146,.10);
  --ok:#3E7A56;
  --display:"Helvetica Neue Condensed","Arial Narrow",ui-sans-serif,system-ui,sans-serif;
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --ground:#0F1113; --surface:#151719; --rule:#2A2E32; --rule-soft:#212528;
    --ink:#E8EAEC; --ink-muted:#9AA0A6; --ink-faint:#6B7075;
    --onair:#E8402F; --onair-soft:rgba(232,64,47,.12);
    --signal:#48A9BE; --signal-soft:rgba(72,169,190,.12);
    --ok:#5EA37B;
  }
}
:root[data-theme="dark"]{
  --ground:#0F1113; --surface:#151719; --rule:#2A2E32; --rule-soft:#212528;
  --ink:#E8EAEC; --ink-muted:#9AA0A6; --ink-faint:#6B7075;
  --onair:#E8402F; --onair-soft:rgba(232,64,47,.12);
  --signal:#48A9BE; --signal-soft:rgba(72,169,190,.12);
  --ok:#5EA37B;
}

*{box-sizing:border-box}
.radar{
  background:var(--ground); color:var(--ink);
  font-family:var(--sans); font-size:14px; line-height:1.5;
  padding:32px 24px 64px; margin:0;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1080px;margin:0 auto}

/* --- masthead --------------------------------------------------------- */
.mast{border-top:2px solid var(--ink);padding-top:14px;margin-bottom:28px}
.eyebrow{
  font-family:var(--display); text-transform:uppercase; letter-spacing:.16em;
  font-size:11px; color:var(--ink-muted); margin:0 0 6px;
}
.mast h1{
  font-family:var(--display); text-transform:uppercase; letter-spacing:.01em;
  font-size:clamp(30px,5vw,46px); font-weight:700; line-height:.96;
  margin:0; text-wrap:balance;
}
.stamp{font-family:var(--mono);font-size:11px;color:var(--ink-faint);margin-top:10px}
.onair{
  display:inline-flex;align-items:center;gap:6px;color:var(--onair);
  font-family:var(--display);text-transform:uppercase;letter-spacing:.14em;font-size:11px;
}
.dot{width:7px;height:7px;background:var(--onair);border-radius:50%;display:inline-block}

/* --- counts strip ----------------------------------------------------- */
.counts{
  display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
  border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);
  margin-bottom:28px;
}
.count{padding:14px 16px 14px 0;border-right:1px solid var(--rule-soft)}
.count:last-child{border-right:0}
.count b{
  display:block;font-family:var(--mono);font-size:26px;font-weight:600;
  font-variant-numeric:tabular-nums;letter-spacing:-.02em;
}
.count span{
  display:block;font-family:var(--display);text-transform:uppercase;
  letter-spacing:.12em;font-size:10px;color:var(--ink-muted);margin-top:3px;
}

/* --- sections --------------------------------------------------------- */
section{margin-bottom:36px}
.head{
  display:flex;align-items:baseline;gap:12px;
  border-bottom:1px solid var(--ink);padding-bottom:6px;margin-bottom:0;
}
.head h2{
  font-family:var(--display);text-transform:uppercase;letter-spacing:.1em;
  font-size:13px;font-weight:700;margin:0;
}
.head .note{font-size:11px;color:var(--ink-faint);margin-left:auto;font-family:var(--mono)}

/* --- tables ----------------------------------------------------------- */
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{
  font-family:var(--display);text-transform:uppercase;letter-spacing:.1em;
  font-size:10px;color:var(--ink-muted);font-weight:600;text-align:left;
  padding:8px 10px 8px 0;border-bottom:1px solid var(--rule);white-space:nowrap;
}
td{padding:9px 10px 9px 0;border-bottom:1px solid var(--rule-soft);vertical-align:top}
tbody tr:hover{background:var(--surface)}
.num{
  font-family:var(--mono);font-variant-numeric:tabular-nums;
  text-align:right;width:52px;white-space:nowrap;
}
.num.hot{color:var(--onair);font-weight:600}
.num.warm{color:var(--signal)}
.dim{color:var(--ink-faint)}
.when{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap;width:96px}
.out{font-family:var(--mono);color:var(--ink-faint);text-align:right;white-space:nowrap;width:76px}
.name{font-weight:500}
.name a{color:inherit;text-decoration:none;border-bottom:1px solid transparent}
.name a:hover,.name a:focus-visible{border-bottom-color:var(--onair);color:var(--onair)}
.meta{color:var(--ink-faint);font-size:11px;margin-top:2px}
.kind{
  font-family:var(--display);text-transform:uppercase;letter-spacing:.1em;
  font-size:10px;color:var(--ink-faint);width:42px;white-space:nowrap;
}

/* --- bulletin (alerts) ------------------------------------------------ */
.bulletin{border-left:3px solid var(--onair);padding-left:14px}
.chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}
.chip{
  font-family:var(--display);text-transform:uppercase;letter-spacing:.1em;
  font-size:9px;padding:2px 7px;border:1px solid var(--rule);color:var(--ink-muted);
}
.chip.r-high-score{color:var(--onair);border-color:var(--onair);background:var(--onair-soft)}
.chip.r-trending-and-imminent{color:var(--onair);border-color:var(--onair);background:var(--onair-soft)}
.chip.r-newly-added{color:var(--ok);border-color:var(--ok)}
.chip.r-date-changed{color:var(--signal);border-color:var(--signal);background:var(--signal-soft)}
.moved{font-family:var(--mono);font-size:11px;margin-top:3px}
.moved s{color:var(--ink-faint)}

/* --- two-up ----------------------------------------------------------- */
.cols{display:grid;grid-template-columns:1fr;gap:36px}
@media(min-width:860px){.cols{grid-template-columns:1fr 320px}}

/* --- month rule ------------------------------------------------------- */
.month{
  font-family:var(--display);text-transform:uppercase;letter-spacing:.14em;
  font-size:10px;color:var(--ink-muted);padding:14px 0 5px;
  border-bottom:1px solid var(--rule);
}
.month b{color:var(--ink);font-weight:700}

/* --- method ----------------------------------------------------------- */
.method{
  border-top:1px solid var(--rule);padding-top:16px;
  font-size:12px;color:var(--ink-muted);line-height:1.65;
}
.method h3{
  font-family:var(--display);text-transform:uppercase;letter-spacing:.12em;
  font-size:11px;color:var(--ink);margin:0 0 8px;
}
.method code{font-family:var(--mono);font-size:11px;color:var(--ink)}
.method p{margin:0 0 8px;max-width:68ch}
.warn{border-left:2px solid var(--onair);padding-left:10px;color:var(--ink)}
.empty{color:var(--ink-faint);padding:18px 0;font-size:13px}
`

function renderAlerts(alerts: Alert[]): string {
  if (alerts.length === 0) {
    return `<p class="empty">No titles meet an alert rule. On a first run this is expected — the diff baseline was just established.</p>`
  }
  const rows = alerts
    .map((alert) => {
      const t = alert.title
      const chips = alert.reasons
        .map((r) => `<span class="chip r-${r}">${esc(REASON_LABEL[r])}</span>`)
        .join('')
      const moved =
        alert.change?.kind === 'date-changed'
          ? `<div class="moved"><s>${esc(fmtDate(alert.change.from ?? null))}</s> → ${esc(fmtDate(alert.change.to ?? null))}</div>`
          : ''
      return `<tr>
        ${scoreCell(t)}
        <td class="when">${esc(fmtDate(t.releaseDate))}</td>
        <td class="name"><a href="${esc(t.url)}" target="_blank" rel="noreferrer">${esc(t.title)}</a>
          <div class="meta">${esc(t.genres.slice(0, 3).join(' · ') || '—')}</div>
          ${moved}<div class="chips">${chips}</div></td>
        <td class="kind">${t.type === 'movie' ? 'Film' : 'TV'}</td>
        <td class="out">${esc(countdown(t.daysOut))}</td>
      </tr>`
    })
    .join('')
  return `<div class="scroll"><table><thead><tr>
    <th class="num">Score</th><th>Date</th><th>Title</th><th>Type</th><th class="out">Out</th>
  </tr></thead><tbody>${rows}</tbody></table></div>`
}

function renderSchedule(titles: Title[], horizonDays: number): string {
  const inWindow = titles.filter(
    (t) => t.daysOut != null && t.daysOut >= 0 && t.daysOut <= horizonDays,
  )
  if (inWindow.length === 0) return `<p class="empty">Nothing scheduled in this window.</p>`

  const months = new Map<string, Title[]>()
  for (const title of inWindow) {
    const key = title.releaseDate?.slice(0, 7) ?? 'unknown'
    months.set(key, [...(months.get(key) ?? []), title])
  }

  return [...months.entries()]
    .map(([month, group]) => {
      const rows = group
        .map(
          (t) => `<tr>
            ${scoreCell(t)}
            <td class="when">${esc(fmtDay(t.releaseDate ?? ''))} ${esc(fmtDate(t.releaseDate))}</td>
            <td class="name"><a href="${esc(t.url)}" target="_blank" rel="noreferrer">${esc(t.title)}</a></td>
            <td class="kind">${t.type === 'movie' ? 'Film' : 'TV'}</td>
            <td class="out">${esc(countdown(t.daysOut))}</td>
          </tr>`,
        )
        .join('')
      return `<div class="month"><b>${esc(month === 'unknown' ? 'UNDATED' : fmtMonth(month))}</b> — ${group.length} title${group.length === 1 ? '' : 's'}</div>
        <div class="scroll"><table><tbody>${rows}</tbody></table></div>`
    })
    .join('')
}

function renderTrending(titles: Title[]): string {
  const top = titles.filter((t) => t.trendingRank != null).slice(0, 15)
  if (top.length === 0) return `<p class="empty">No trending data in this run.</p>`
  const rows = top
    .map(
      (t) => `<tr>
        <td class="num dim">${t.trendingRank}</td>
        <td class="name"><a href="${esc(t.url)}" target="_blank" rel="noreferrer">${esc(t.title)}</a></td>
        <td class="kind">${t.type === 'movie' ? 'Film' : 'TV'}</td>
      </tr>`,
    )
    .join('')
  return `<div class="scroll"><table><tbody>${rows}</tbody></table></div>`
}

function renderChanges(changes: Change[]): string {
  if (changes.length === 0) {
    return `<p class="empty">No changes — or this was the first run, which sets the baseline without reporting changes.</p>`
  }
  const label: Record<Change['kind'], string> = {
    new: 'Added',
    'date-changed': 'Moved',
    removed: 'Dropped',
  }
  const rows = changes
    .slice(0, 40)
    .map(
      (c) => `<tr>
        <td class="kind">${esc(label[c.kind])}</td>
        <td class="name">${esc(c.title)}
          ${c.kind === 'date-changed' ? `<div class="moved"><s>${esc(fmtDate(c.from ?? null))}</s> → ${esc(fmtDate(c.to ?? null))}</div>` : ''}
        </td>
      </tr>`,
    )
    .join('')
  return `<div class="scroll"><table><tbody>${rows}</tbody></table></div>`
}

/** The page body — shared by the standalone file and the artifact fragment. */
function renderBody(data: RadarOutput): string {
  const withDemand = data.titles.filter(hasDemand).length
  const generated = new Date(data.generatedAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return `<div class="radar"><div class="wrap">

  <header class="mast">
    <p class="eyebrow">Fandom · TV &amp; Movies domain</p>
    <h1>Release Radar</h1>
    <p class="stamp">
      <span class="onair"><span class="dot"></span>${data.counts.alerts} on watch</span>
      &nbsp;·&nbsp; generated ${esc(generated)} &nbsp;·&nbsp; source: neutron-api
    </p>
  </header>

  <div class="counts">
    <div class="count"><b>${data.counts.alerts}</b><span>Alerts</span></div>
    <div class="count"><b>${data.counts.inHorizon}</b><span>Next ${data.horizonDays} days</span></div>
    <div class="count"><b>${data.counts.upcoming}</b><span>Upcoming</span></div>
    <div class="count"><b>${withDemand}<span style="color:var(--ink-faint)">/${data.counts.upcoming}</span></b><span>Demand signal</span></div>
  </div>

  <section>
    <div class="head"><h2>Bulletin</h2><span class="note">what would have been missed</span></div>
    <div class="bulletin">${renderAlerts(data.alerts)}</div>
  </section>

  <div class="cols">
    <section>
      <div class="head"><h2>Schedule</h2><span class="note">next ${data.horizonDays} days</span></div>
      ${renderSchedule(data.titles, data.horizonDays)}
    </section>

    <div>
      <section>
        <div class="head"><h2>Trending now</h2></div>
        ${renderTrending(data.trending)}
      </section>
      <section>
        <div class="head"><h2>Since last run</h2></div>
        ${renderChanges(data.changes)}
      </section>
    </div>
  </div>

  <section class="method">
    <h3>How to read this</h3>
    <p class="warn"><b>Only ${withDemand} of ${data.counts.upcoming} upcoming titles carry a real demand signal, and no upcoming TV does</b> — the upstream popularity ranking excludes unreleased shows. Titles without one show <code>—</code> rather than a score: a capped number is an absence of evidence, not a measurement, and ranking on it would be ranking on noise.</p>
    <p>Score blends <code>fandomSignal</code> (0.40, reserved &amp; not yet wired) · <code>popularityRank</code> (0.25) · <code>trendingRank</code> (0.20) · <code>imminence</code> (0.10) · <code>criticScore</code> (0.05), re-normalized over whichever signals a title actually has, then capped by how well its best signal evidences demand.</p>
    <p><b>Bulletin</b> fires on any of: trending and landing within 30 days · score ≥ 70 · newly added to the calendar · release date moved. The last two come from diffing against the previous run — a signal the upstream API doesn't expose.</p>
    <p class="dim">Data: neutron-api (metacritic). Prototype — first-party Fandom trending is the reserved heaviest signal and is not yet connected.</p>
  </section>

</div></div>`
}

export async function build(data: RadarOutput, outDir = path.join(ROOT, 'out')): Promise<string> {
  await mkdir(outDir, { recursive: true })

  const body = renderBody(data)
  const style = `<style>${CSS}</style>`

  // Artifact fragment: no <html>/<head>/<body> — the publisher supplies those.
  const fragment = `${style}\n${body}`
  await writeFile(path.join(outDir, 'dashboard.artifact.html'), fragment)

  const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TV &amp; Movies — Release Radar</title>
${style}
<style>html,body{margin:0;padding:0;background:var(--ground)}</style>
</head>
<body>
${body}
</body>
</html>`
  const file = path.join(outDir, 'dashboard.html')
  await writeFile(file, standalone)
  return file
}
