/** Self-contained HTML dashboard generator.
 *
 * The React app in web/ is the operator's tool: it needs a server, and it
 * filters and searches. This is the SHAREABLE artifact — one file, data baked
 * in, no server, no network.
 *
 * Emits two files:
 *   out/dashboard.html          — standalone page, open it in a browser
 *   out/dashboard.artifact.html — body-only fragment, for publishing as an
 *                                 Artifact (whose host supplies the skeleton)
 *
 * Poster art is INLINED as data URIs, because the Artifact CSP blocks every
 * external host — a remote <img> would silently show nothing. Inlining is
 * budgeted (INLINE_BUDGET) so the page stays well under the 16 MB cap; titles
 * past the budget fall back to an initials tile, same as titles with no art.
 *
 * Design: poster-led. Film and TV are visual, and the catalog hands us the
 * artwork, so the art carries the page and the chrome stays quiet — near-black
 * ground, one warm signal colour, generous grid. Deliberately unlike the gaming
 * radar's cool blue-grey card dashboard.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ROOT } from './config.js'
import { posterDataUri } from './posters.js'
import type { Alert, AlertReason, Change, RadarOutput, Title } from './types.js'

/** Keep the published page comfortably inside the 16 MB artifact cap. */
const INLINE_BUDGET = 7_000_000

const REASON_LABEL: Record<AlertReason, string> = {
  'trending-and-imminent': 'trending · landing soon',
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
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function fmtMonth(iso: string): string {
  return new Date(`${iso}-01T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function countdown(daysOut: number | null): string {
  if (daysOut == null) return ''
  if (daysOut < 0) return `${Math.abs(daysOut)}d ago`
  if (daysOut === 0) return 'today'
  if (daysOut === 1) return 'tomorrow'
  if (daysOut < 45) return `in ${daysOut} days`
  return `in ${Math.round(daysOut / 30)} months`
}

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter((word) => /[a-z0-9]/i.test(word))
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

/** Poster tile, or a typographic stand-in when there's no art. */
function poster(title: Title, src: string | null, extraClass = ''): string {
  if (src) {
    return `<div class="art ${extraClass}"><img src="${src}" alt="" loading="lazy" decoding="async"></div>`
  }
  return `<div class="art noart ${extraClass}" aria-hidden="true"><span>${esc(initials(title.title))}</span></div>`
}

const CSS = `
:root{
  --ground:#FAFAF9; --raise:#FFFFFF; --line:#E4E2DE; --line-soft:#EFEDEA;
  --ink:#1A1917; --ink-2:#57534E; --ink-3:#8C8681;
  --signal:#B45309; --signal-ink:#B45309; --signal-bg:rgba(180,83,9,.10);
  --live:#BE123C; --live-bg:rgba(190,18,60,.09);
  --up:#15803D;
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --shadow:0 1px 2px rgba(0,0,0,.07),0 6px 18px rgba(0,0,0,.06);
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --ground:#0C0C0D; --raise:#161617; --line:#2A2A2C; --line-soft:#202022;
    --ink:#F5F4F2; --ink-2:#A8A29E; --ink-3:#78716C;
    --signal:#F59E0B; --signal-ink:#FBBF24; --signal-bg:rgba(245,158,11,.14);
    --live:#FB7185; --live-bg:rgba(251,113,133,.13);
    --up:#4ADE80;
    --shadow:0 1px 2px rgba(0,0,0,.5),0 8px 24px rgba(0,0,0,.45);
  }
}
:root[data-theme="dark"]{
  --ground:#0C0C0D; --raise:#161617; --line:#2A2A2C; --line-soft:#202022;
  --ink:#F5F4F2; --ink-2:#A8A29E; --ink-3:#78716C;
  --signal:#F59E0B; --signal-ink:#FBBF24; --signal-bg:rgba(245,158,11,.14);
  --live:#FB7185; --live-bg:rgba(251,113,133,.13);
  --up:#4ADE80;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 8px 24px rgba(0,0,0,.45);
}

*{box-sizing:border-box}
.radar{
  background:var(--ground);color:var(--ink);font-family:var(--sans);
  font-size:15px;line-height:1.55;margin:0;padding:40px 28px 72px;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1140px;margin:0 auto}
a{color:inherit}

/* --- header ----------------------------------------------------------- */
.top{display:flex;flex-wrap:wrap;align-items:flex-end;gap:20px;margin-bottom:32px}
.top h1{font-size:clamp(28px,4.4vw,40px);font-weight:650;letter-spacing:-.025em;margin:0;line-height:1.05;text-wrap:balance}
.kicker{font-size:13px;color:var(--ink-2);margin:0 0 6px;letter-spacing:.02em}
.stamp{font-family:var(--mono);font-size:11.5px;color:var(--ink-3);margin:6px 0 0}
.live{display:inline-flex;align-items:center;gap:6px;color:var(--live);font-weight:600}
.pulse{width:7px;height:7px;border-radius:50%;background:var(--live);display:inline-block}

.tiles{display:flex;flex-wrap:wrap;gap:10px;margin-left:auto}
.tile{background:var(--raise);border:1px solid var(--line);border-radius:10px;padding:10px 16px;min-width:104px}
.tile b{display:block;font-size:24px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.15}
.tile span{display:block;font-size:11px;color:var(--ink-3);margin-top:1px}

/* --- section headings --------------------------------------------------
   The fixed header height is load-bearing: it's what keeps the schedule and
   the sidebar starting on the same line despite different content. */
h2{font-size:13px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2);margin:0}
.shead{
  display:flex;align-items:center;gap:12px;height:32px;
  margin:0 0 14px;padding-bottom:8px;border-bottom:1px solid var(--line);
}
.shead .aside{font-size:12px;color:var(--ink-3);margin-left:auto}
section{margin-bottom:40px}

/* --- filter chips ------------------------------------------------------- */
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px}
button.chip{
  font:inherit;font-size:11px;cursor:pointer;padding:4px 10px;border-radius:20px;
  border:1px solid var(--line);background:transparent;color:var(--ink-3);
  transition:color .15s,border-color .15s,background .15s;
}
button.chip:hover{color:var(--ink)}
button.chip[aria-pressed="true"]{border-color:var(--signal);background:var(--signal-bg);color:var(--signal-ink)}
button.chip:focus-visible{outline:2px solid var(--signal);outline-offset:2px}
[hidden]{display:none !important}

/* --- schedule rows -----------------------------------------------------
   One column template shared by the header and every row — the only way the
   two stay aligned. Genres and countdown drop out on narrow screens; the
   signal columns never do, since they are the reason to look. */
.rowhead,.row{
  display:grid;align-items:center;column-gap:12px;
  grid-template-columns:64px 28px 1fr 40px 44px 44px;
}
@media(min-width:640px){
  .rowhead,.row{grid-template-columns:64px 28px 1fr 40px 44px 44px 84px}
}
@media(min-width:1024px){
  .rowhead,.row{grid-template-columns:64px 28px 1fr 40px 150px 44px 44px 84px}
}
@media(max-width:1023px){.cg{display:none}}
@media(max-width:639px){.co{display:none}}

.rowhead{
  position:sticky;top:0;z-index:20;background:var(--ground);
  border-bottom:1px solid var(--line);padding:6px 0;
  font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3);
}
.row{
  padding:6px 0;border-bottom:1px solid var(--line-soft);text-decoration:none;
}
.row:hover{background:var(--raise)}
.r{text-align:right}
.when{font-family:var(--mono);font-size:12.5px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.art.thumb{width:28px;border-radius:3px;box-shadow:none}
.art.thumb span{font-size:8px}
.row .t{min-width:0;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row:hover .t{color:var(--signal-ink)}
.row .k{font-size:10.5px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em}
.row .g{font-size:12px;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .o{font-family:var(--mono);font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.score{font-family:var(--mono);font-size:12px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.score.hi{color:var(--signal-ink);font-weight:600}
.trend{font-family:var(--mono);font-size:12px;color:var(--live);font-variant-numeric:tabular-nums}
.none{font-family:var(--mono);font-size:12px;color:var(--ink-3);opacity:.6}
.tags{display:inline-flex;gap:4px;margin-left:8px;vertical-align:middle}
.tag{font-size:10px;padding:1px 6px;border-radius:20px;border:1px solid var(--line);color:var(--ink-3);white-space:nowrap}
.tag.live{color:var(--live);border-color:var(--live);background:var(--live-bg)}
.tag.warn{color:var(--signal-ink);border-color:var(--signal);background:var(--signal-bg)}
.tag.up{color:var(--up);border-color:var(--up)}
.moved{font-family:var(--mono);font-size:11px;color:var(--ink-3)}
.moved s{opacity:.7}

/* poster tile, still used small in rows and the trending list */
.art{
  position:relative;aspect-ratio:2/3;border-radius:10px;overflow:hidden;
  background:var(--raise);border:1px solid var(--line);
}
.art img{width:100%;height:100%;object-fit:cover;display:block}
.noart{display:flex;align-items:center;justify-content:center}
.noart span{font-size:26px;font-weight:600;color:var(--ink-3);letter-spacing:.04em}

.month{
  display:flex;align-items:baseline;gap:10px;margin:16px 0 0;
  padding-bottom:6px;border-bottom:1px solid var(--line);
}
.month b{font-size:13px;font-weight:650}
.month span{font-size:12px;color:var(--ink-3)}

/* --- side lists -------------------------------------------------------- */
.cols{display:grid;grid-template-columns:1fr;gap:44px;align-items:start}
@media(min-width:900px){.cols{grid-template-columns:1fr 300px}}
.side{display:flex;flex-direction:column}
.mini{display:flex;align-items:center;gap:11px;padding:7px 0;border-bottom:1px solid var(--line-soft);text-decoration:none}
.mini .art{width:30px;flex:0 0 30px;border-radius:4px;box-shadow:none}
.mini .n{font-family:var(--mono);font-size:11px;color:var(--ink-3);width:16px;flex:0 0 16px;text-align:right}
.mini .t{flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mini:hover .t{color:var(--signal-ink)}
.chg{padding:7px 0;border-bottom:1px solid var(--line-soft);font-size:13px}
.chg .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin-right:7px}
.chg .lbl.new{color:var(--up)}
.chg .lbl.mv{color:var(--signal-ink)}
.chg .lbl.rm{color:var(--ink-3)}

/* --- method ------------------------------------------------------------ */
.method{border-top:1px solid var(--line);padding-top:20px;font-size:13px;color:var(--ink-2);line-height:1.65}
.method h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink);margin:0 0 10px}
.method p{margin:0 0 10px;max-width:74ch}
.method code{font-family:var(--mono);font-size:12px;color:var(--ink)}
.callout{border-left:3px solid var(--signal);background:var(--signal-bg);padding:10px 14px;border-radius:0 8px 8px 0;color:var(--ink)}
.empty{color:var(--ink-3);padding:14px 0}
`

type Art = Map<number, string>

function scoreCell(title: Title): string {
  if (!hasDemand(title)) {
    return `<span class="score" title="No demand signal — scheduled only">—</span>`
  }
  return `<span class="score${title.score >= 70 ? ' hi' : ''}">${title.score.toFixed(0)}</span>`
}

/** The schedule is the page's single list of titles — there is no separate
 * alerts section duplicating the same rows. Alerted titles are tagged in place
 * and reachable through the Alerts filter.
 *
 * Laid out as columns rather than cards: the signal columns (score, trend) are
 * the reason to look, and they only read as a set when they line up. Empty
 * cells render an explicit dash instead of collapsing, so a missing score reads
 * as "no evidence" rather than as a layout bug. */
function renderSchedule(
  titles: Title[],
  horizonDays: number,
  art: Art,
  alerts: Alert[],
): string {
  const reasons = new Map(alerts.map((a) => [a.title.id, a]))

  // Alerts are the exception to the horizon: one matters however far out it is.
  const inWindow = titles.filter(
    (t) =>
      t.daysOut != null &&
      t.daysOut >= 0 &&
      (t.daysOut <= horizonDays || reasons.has(t.id)),
  )
  if (inWindow.length === 0) return `<p class="empty">Nothing scheduled in this window.</p>`

  const months = new Map<string, Title[]>()
  for (const title of inWindow) {
    const key = title.releaseDate?.slice(0, 7) ?? 'unknown'
    months.set(key, [...(months.get(key) ?? []), title])
  }

  const header = `<div class="rowhead">
    <span>Date</span><span></span><span>Title</span><span>Type</span>
    <span class="cg">Genres</span>
    <span class="r">Score</span><span class="r">Trend</span><span class="co r">Out</span>
  </div>`

  const body = [...months.entries()]
    .map(([month, group]) => {
      const rows = group
        .map((t) => {
          const alert = reasons.get(t.id)
          const tags = (alert?.reasons ?? [])
            .map((reason) => {
              const cls =
                reason === 'newly-added' ? 'up' : reason === 'date-changed' ? 'warn' : 'live'
              return `<span class="tag ${cls}">${esc(REASON_LABEL[reason])}</span>`
            })
            .join('')
          const score = hasDemand(t)
            ? `<span class="r score${t.score >= 70 ? ' hi' : ''}">${t.score.toFixed(0)}</span>`
            : `<span class="r none" title="No demand signal — scheduled only">—</span>`
          const trend =
            t.trendingRank != null
              ? `<span class="r trend">#${t.trendingRank}</span>`
              : `<span class="r none" title="Not in the current trending list">—</span>`

          return `<a class="row" href="${esc(t.url)}" target="_blank" rel="noreferrer"
              data-type="${t.type}" data-alert="${alert ? 1 : 0}" data-demand="${hasDemand(t) ? 1 : 0}">
            <span class="when">${esc(fmtDate(t.releaseDate))}</span>
            ${poster(t, art.get(t.id) ?? null, 'thumb')}
            <span class="t">${esc(t.title)}${tags ? `<span class="tags">${tags}</span>` : ''}</span>
            <span class="k">${t.type === 'movie' ? 'Film' : 'TV'}</span>
            <span class="cg g">${esc(t.genres.slice(0, 2).join(', ')) || '—'}</span>
            ${score}${trend}
            <span class="co r o">${esc(countdown(t.daysOut))}</span>
          </a>`
        })
        .join('')
      return `<div class="mgroup" data-count="${group.length}">
        <div class="month"><b>${esc(month === 'unknown' ? 'Undated' : fmtMonth(month))}</b>
        <span class="mcount">${group.length} title${group.length === 1 ? '' : 's'}</span></div>
        ${rows}</div>`
    })
    .join('')

  return header + body
}

/** Filter chips. The static page has no framework, so this is a few lines of
 * inline JS toggling a data attribute — no dependency, no network. */
const FILTER_SCRIPT = `
(function(){
  var root=document.getElementById('sched');
  if(!root)return;
  var chips=root.querySelectorAll('[data-filter]');
  var cards=root.querySelectorAll('.card');
  var groups=root.querySelectorAll('.mgroup');
  function apply(f){
    cards.forEach(function(c){
      var ok = f==='all'
        || (f==='alerts' && c.dataset.alert==='1')
        || (f==='demand' && c.dataset.demand==='1')
        || (f===c.dataset.type);
      c.hidden = !ok;
    });
    groups.forEach(function(g){
      var shown=g.querySelectorAll('.card:not([hidden])').length;
      g.hidden = shown===0;
      var n=g.querySelector('.mcount');
      if(n) n.textContent = shown + (shown===1?' title':' titles');
    });
    chips.forEach(function(b){ b.setAttribute('aria-pressed', String(b.dataset.filter===f)); });
  }
  chips.forEach(function(b){ b.addEventListener('click',function(){ apply(b.dataset.filter); }); });
  apply('all');
})();
`

function renderTrending(titles: Title[], art: Art): string {
  const top = titles.filter((t) => t.trendingRank != null).slice(0, 12)
  if (top.length === 0) return `<p class="empty">No trending data in this run.</p>`
  return top
    .map(
      (t) => `<a class="mini" href="${esc(t.url)}" target="_blank" rel="noreferrer">
        <span class="n">${t.trendingRank}</span>
        ${poster(t, art.get(t.id) ?? null)}
        <span class="t">${esc(t.title)}</span>
      </a>`,
    )
    .join('')
}

function renderChanges(changes: Change[]): string {
  if (changes.length === 0) {
    return `<p class="empty">No changes — or this was the first run, which sets the baseline without reporting changes.</p>`
  }
  const meta: Record<Change['kind'], [string, string]> = {
    new: ['new', 'Added'],
    'date-changed': ['mv', 'Moved'],
    removed: ['rm', 'Dropped'],
  }
  return changes
    .slice(0, 30)
    .map((change) => {
      const [cls, label] = meta[change.kind]
      const detail =
        change.kind === 'date-changed'
          ? `<div class="moved"><s>${esc(fmtDate(change.from ?? null))}</s> → ${esc(fmtDate(change.to ?? null))}</div>`
          : ''
      return `<div class="chg"><span class="lbl ${cls}">${label}</span>${esc(change.title)}${detail}</div>`
    })
    .join('')
}

/** Collect inlined art for everything on the page, newest-priority first, until
 * the byte budget runs out. Titles past it fall back to initials tiles. */
async function collectArt(data: RadarOutput): Promise<Art> {
  const order = [
    ...data.alerts.map((a) => a.title),
    ...data.trending,
    ...data.titles.filter((t) => t.daysOut != null && t.daysOut >= 0),
  ]

  const art: Art = new Map()
  let used = 0
  for (const title of order) {
    if (art.has(title.id)) continue
    const uri = await posterDataUri(title.id)
    if (!uri) continue
    if (used + uri.length > INLINE_BUDGET) break
    art.set(title.id, uri)
    used += uri.length
  }
  return art
}

function renderBody(data: RadarOutput, art: Art): string {
  const withDemand = data.titles.filter(hasDemand).length
  const generated = new Date(data.generatedAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return `<div class="radar"><div class="wrap">

  <header class="top">
    <div>
      <p class="kicker">Fandom · TV &amp; Movies domain</p>
      <h1>Release Radar</h1>
      <p class="stamp">
        <span class="live"><span class="pulse"></span>${data.counts.alerts} on watch</span>
        · generated ${esc(generated)} · source: neutron-api
      </p>
    </div>
    <div class="tiles">
      <div class="tile"><b>${data.counts.alerts}</b><span>Alerts</span></div>
      <div class="tile"><b>${data.counts.inHorizon}</b><span>Next ${data.horizonDays} days</span></div>
      <div class="tile"><b>${data.counts.upcoming}</b><span>Upcoming</span></div>
      <div class="tile"><b>${withDemand}</b><span>With demand signal</span></div>
    </div>
  </header>

  <div class="cols">
    <section id="sched">
      <div class="shead"><h2>Schedule</h2><span class="aside">next ${data.horizonDays} days</span></div>
      <div class="chips">
        <button class="chip" data-filter="all" aria-pressed="true">All</button>
        <button class="chip" data-filter="alerts" aria-pressed="false">Alerts</button>
        <button class="chip" data-filter="movie" aria-pressed="false">Film</button>
        <button class="chip" data-filter="show" aria-pressed="false">TV</button>
        <button class="chip" data-filter="demand" aria-pressed="false">Demand signal</button>
      </div>
      ${renderSchedule(data.titles, data.horizonDays, art, data.alerts)}
    </section>

    <div class="side">
      <section>
        <div class="shead"><h2>Trending now</h2></div>
        ${renderTrending(data.trending, art)}
      </section>
      <section>
        <div class="shead"><h2>Since last run</h2></div>
        ${renderChanges(data.changes)}
      </section>
    </div>
  </div>

  <section class="method">
    <h3>How to read this</h3>
    <p class="callout"><b>Only ${withDemand} of ${data.counts.upcoming} upcoming titles carry a real demand signal, and no upcoming TV does</b> — the upstream popularity ranking excludes unreleased shows. Titles without one show <code>—</code> rather than a score: a capped number is an absence of evidence, not a measurement, and ranking on it would be ranking on noise.</p>
    <p>Score blends <code>fandomSignal</code> (0.40, reserved &amp; not yet wired) · <code>popularityRank</code> (0.25) · <code>trendingRank</code> (0.20) · <code>imminence</code> (0.10) · <code>criticScore</code> (0.05), re-normalized over whichever signals a title actually has, then capped by how well its best signal evidences demand.</p>
    <p>The <b>bulletin</b> fires on any of: trending and landing within 30 days · score ≥ 70 · newly added to the calendar · release date moved. The last two come from diffing against the previous run — a signal the upstream API doesn't expose.</p>
    <p style="color:var(--ink-3)">Data: neutron-api (metacritic). Prototype — first-party Fandom trending is the reserved heaviest signal and is not yet connected.</p>
  </section>

</div></div>`
}

export async function build(data: RadarOutput, outDir = path.join(ROOT, 'out')): Promise<string> {
  await mkdir(outDir, { recursive: true })

  const art = await collectArt(data)
  const body = renderBody(data, art)
  const style = `<style>${CSS}</style>`

  const script = `<script>${FILTER_SCRIPT}</script>`

  // Artifact fragment: no <html>/<head>/<body> — the publisher supplies those.
  await writeFile(path.join(outDir, 'dashboard.artifact.html'), `${style}\n${body}\n${script}`)

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
${script}
</body>
</html>`
  const file = path.join(outDir, 'dashboard.html')
  await writeFile(file, standalone)
  return file
}
