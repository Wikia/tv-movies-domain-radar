import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ranked } from './buzz.js'
import { ROOT } from './config.js'
import { posterDataUri } from './posters.js'
import type {
  Alert,
  AlertReason,
  Buzz,
  Change,
  RadarOutput,
  SignalSource,
  Title,
  TrendingReport,
} from './types.js'

const INLINE_BUDGET = 7_000_000

// Shared by the renderer and the inline script: a stale selector once hid every
// row and shipped a blank page. build() throws if it renders none.
const ROW_CLASS = 'row'

const REASON_LABEL: Record<AlertReason, string> = {
  'newly-added': 'new on calendar',
  'date-changed': 'date moved',

  'wiki-trending': '',
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'TBD'
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** Dates in a CHANGE must carry the year: without it a slip from 2026-05-01 to
 * 2027-05-01 renders as "May 1 → May 1", i.e. as no change at all. Schedule rows
 * don't need it — their month heading carries the year. */
function fmtDateYear(iso: string | null): string {
  if (!iso) return 'TBD'
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
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

/** Poster tile, or a typographic stand-in when there's no art.
 *
 * The art is painted by a per-title CSS class rather than an inline `<img>`, so
 * each data URI is written into the page exactly once no matter how many places
 * show that poster. Inlining per element instead would have doubled a 7 MB page
 * the moment the detail view started showing art too. */
function poster(title: Title, hasArt: boolean, extraClass = ''): string {
  if (hasArt) return `<div class="art a${title.id} ${extraClass}" aria-hidden="true"></div>`
  return `<div class="art noart ${extraClass}" aria-hidden="true"><span>${esc(initials(title.title))}</span></div>`
}

/** One rule per title, carrying that title's inlined poster. */
function artCSS(art: Art): string {
  return [...art].map(([id, src]) => `.art.a${id}{background-image:url("${src}")}`).join('\n')
}

/** Tokens live on `.radar`, NOT :root, so the theme toggle owns them.
 *
 * An artifact is embedded in a host page that stamps its own theme on the root
 * element; scoping to our container means our toggle can't fight it, and the
 * page still follows the viewer's OS setting until they choose otherwise.
 * Light is the base, dark is redefined twice: once for the un-chosen "system"
 * state, once for an explicit choice. */
const CSS = `
.radar{
  color-scheme:light;
  --ground:#FAFAF9; --raise:#FFFFFF; --line:#E4E2DE; --line-soft:#EFEDEA;
  --ink:#1A1917; --ink-2:#57534E; --ink-3:#8C8681;
  --accent:#B45309; --accent-bg:rgba(180,83,9,.10);
  --up:#15803D; --moved:#1D4ED8; --moved-bg:rgba(29,78,216,.09);
  /* CVD-validated on both surfaces — re-run validate_palette.js before changing. */
  --hot-1:#b4232a; --hot-1-bg:rgba(180,35,42,.10);  --hot-2:#e2622a; --hot-2-bg:rgba(226,98,42,.12);  --hot-3:#eda100; --hot-3-bg:rgba(237,161,0,.14);  --hot-4:#008300; --hot-4-bg:rgba(0,131,0,.10);  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){
  .radar:not([data-mode="light"]){
    color-scheme:dark;
    --ground:#0C0C0D; --raise:#161617; --line:#2A2A2C; --line-soft:#202022;
    --ink:#F5F4F2; --ink-2:#A8A29E; --ink-3:#78716C;
    --accent:#FBBF24; --accent-bg:rgba(245,158,11,.14);
    --up:#4ADE80; --moved:#93B4FF; --moved-bg:rgba(147,180,255,.13);
    --hot-1:#ef4444; --hot-1-bg:rgba(239,68,68,.16);
    --hot-2:#fb923c; --hot-2-bg:rgba(251,146,60,.16);
    --hot-3:#fde047; --hot-3-bg:rgba(253,224,71,.16);
    --hot-4:#4ade80; --hot-4-bg:rgba(74,222,128,.14);
  }
}
.radar[data-mode="dark"]{
  color-scheme:dark;
  --ground:#0C0C0D; --raise:#161617; --line:#2A2A2C; --line-soft:#202022;
  --ink:#F5F4F2; --ink-2:#A8A29E; --ink-3:#78716C;
  --accent:#FBBF24; --accent-bg:rgba(245,158,11,.14);
  --up:#4ADE80; --moved:#93B4FF; --moved-bg:rgba(147,180,255,.13);
  --hot-1:#ef4444; --hot-1-bg:rgba(239,68,68,.16);
  --hot-2:#fb923c; --hot-2-bg:rgba(251,146,60,.16);
  --hot-3:#fde047; --hot-3-bg:rgba(253,224,71,.16);
  --hot-4:#4ade80; --hot-4-bg:rgba(74,222,128,.14);
}

.radar *{box-sizing:border-box}
.radar{
  background:var(--ground);color:var(--ink);font-family:var(--sans);
  font-size:15px;line-height:1.55;margin:0;padding:40px 28px 72px;
  min-height:100vh;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1140px;margin:0 auto}
.radar a{color:inherit}

.top{display:flex;flex-wrap:wrap;align-items:flex-end;gap:20px;margin-bottom:32px}
.top h1{font-size:clamp(28px,4.4vw,40px);font-weight:650;letter-spacing:-.025em;margin:0;line-height:1.05;text-wrap:balance}
.kicker{font-size:13px;color:var(--ink-2);margin:0 0 6px}
.stamp{font-family:var(--mono);font-size:11.5px;color:var(--ink-3);margin:6px 0 0}
.tiles{display:flex;flex-wrap:wrap;gap:10px;margin-left:auto;align-items:center}
.tile{background:var(--raise);border:1px solid var(--line);border-radius:10px;padding:10px 16px;min-width:104px}
.tile b{display:block;font-size:24px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.15}
.tile span{display:block;font-size:11px;color:var(--ink-3);margin-top:1px}

#theme{
  font:inherit;font-size:11px;cursor:pointer;padding:8px 12px;border-radius:10px;
  border:1px solid var(--line);background:var(--raise);color:var(--ink-2);
  display:inline-flex;align-items:center;gap:6px;align-self:stretch;
}
#theme:hover{color:var(--ink);border-color:var(--ink-3)}
#theme:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.radar h2{font-size:13px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2);margin:0}
.shead{
  display:flex;align-items:center;gap:12px;height:32px;
  margin:0 0 14px;padding-bottom:8px;border-bottom:1px solid var(--line);
}
.shead .aside{font-size:12px;color:var(--ink-3);margin-left:auto}
.radar section{margin-bottom:40px}

.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px}
button.chip{
  font:inherit;font-size:11px;cursor:pointer;padding:4px 10px;border-radius:20px;
  border:1px solid var(--line);background:transparent;color:var(--ink-3);
  transition:color .15s,border-color .15s,background .15s;
}
button.chip:hover{color:var(--ink)}
button.chip[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-bg);color:var(--accent)}
button.chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.radar [hidden]{display:none !important}

.rowhead,.row{
  display:grid;align-items:center;column-gap:12px;
  grid-template-columns:64px 28px 1fr 40px 40px;
}
@media(min-width:640px){.rowhead,.row{grid-template-columns:64px 28px 1fr 40px 40px 88px}}
@media(min-width:1024px){.rowhead,.row{grid-template-columns:64px 28px 1fr 40px 128px 40px 88px}}
@media(max-width:1023px){.cg{display:none}}
@media(max-width:639px){.co{display:none}}

.rowhead{
  position:sticky;top:0;z-index:20;background:var(--ground);
  border-bottom:1px solid var(--line);padding:6px 0;
  font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3);
}
.row{padding:6px 0;border-bottom:1px solid var(--line-soft);text-decoration:none}
.row:hover{background:var(--raise)}
.r{text-align:right}
.when{font-family:var(--mono);font-size:12.5px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.art.thumb{width:28px;border-radius:3px}
.art.thumb span{font-size:8px}
.row .t{min-width:0;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row:hover .t{color:var(--accent)}
.row .k{font-size:10.5px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em}
.row .g{font-size:12px;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .o{font-family:var(--mono);font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.hs.faint{opacity:.65;font-weight:400}
.hs.zero{color:var(--ink-3)}
.none{font-family:var(--mono);font-size:12px;color:var(--ink-3);opacity:.55}
.tags{display:inline-flex;gap:4px;margin-left:8px;vertical-align:middle}
.tag{font-size:10px;padding:1px 6px;border-radius:20px;border:1px solid var(--line);color:var(--ink-3);white-space:nowrap}
.tag.up{color:var(--up);border-color:var(--up)}
.tag.moved{color:var(--moved);border-color:var(--moved);background:var(--moved-bg)}
.movedate{font-family:var(--mono);font-size:11px;color:var(--ink-3)}
.movedate s{opacity:.7}

.art{
  position:relative;aspect-ratio:2/3;border-radius:10px;overflow:hidden;
  background:var(--raise) center/cover no-repeat;border:1px solid var(--line);
}
.noart{display:flex;align-items:center;justify-content:center}
.noart span{font-size:26px;font-weight:600;color:var(--ink-3)}

.month{
  display:flex;align-items:baseline;gap:10px;margin:16px 0 0;
  padding-bottom:6px;border-bottom:1px solid var(--line);
}
.month b{font-size:13px;font-weight:650}
.month span{font-size:12px;color:var(--ink-3)}

.cols{display:grid;grid-template-columns:1fr;gap:44px;align-items:start}
@media(min-width:900px){.cols{grid-template-columns:1fr 340px}}
.chg{padding:7px 0;border-bottom:1px solid var(--line-soft);font-size:13px}
.chg .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin-right:7px}
.chg .lbl.new{color:var(--up)}
.chg .lbl.mv{color:var(--moved)}
.chg .lbl.rm{color:var(--ink-3)}

.wiki{padding:11px 0;border-bottom:1px solid var(--line-soft);font-size:13px}
.wiki .wtop{display:flex;align-items:baseline;gap:8px}
.wiki .wn{font-size:14.5px;font-weight:600;line-height:1.3;min-width:0;overflow-wrap:anywhere}
.wiki .ws{margin-left:auto;font-family:var(--mono);font-size:13px;font-weight:600;color:var(--accent);font-variant-numeric:tabular-nums}
.wiki .wd{font-family:var(--mono);font-size:11px;line-height:1.5;color:var(--ink-3);margin-top:2px}
.railnote{font-size:12px;line-height:1.5;color:var(--ink-3);margin:0 0 10px}
.detail{border:1px solid var(--line);border-radius:12px;background:var(--raise);padding:16px 18px;margin:0 0 12px}
.dhead{display:flex;flex-wrap:wrap;align-items:flex-start;gap:20px;margin:0 0 26px}
.art.dart{width:96px;flex:none;border-radius:10px}
.art.dart span{font-size:30px}
.dmain{min-width:0}
.dmain h1{font-size:clamp(22px,3.4vw,32px);font-weight:650;letter-spacing:-.02em;margin:0;line-height:1.15}
.dbadges{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:12px}
.dbadges .tag.quiet{opacity:.45}
.dbadges .tag i{font-style:normal;font-family:var(--mono)}
#details h3{font-size:13px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;
  color:var(--ink-2);margin:26px 0 10px;padding-bottom:8px;border-bottom:1px solid var(--line)}
.dmeta{font-family:var(--mono);font-size:12px;color:var(--ink-3);margin:6px 0 0}
.closed{display:inline-block;font-size:11px;color:var(--ink-3);text-decoration:none;
  border:1px solid var(--line);border-radius:20px;padding:5px 12px;margin:0 0 22px}
.closed:hover{color:var(--accent)}
.srow{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;padding:11px 0;font-size:13px;border-bottom:1px solid var(--line-soft)}
.srow.quiet{opacity:.5}
.sname{width:112px;flex:none;font-weight:600;font-size:14px}
.sval{font-family:var(--mono);font-size:12px;color:var(--ink-2)}
.sval i{color:var(--ink-3);font-style:normal}
.srel{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--ink-3)}
.srel b{color:var(--hot-2)}
.snote{font-size:13px;line-height:1.65;color:var(--ink-2);margin:14px 0 0;max-width:74ch}
.snote a{color:var(--accent)}
@supports selector(:has(*)){
  #details{display:none}
  .wrap:has(.detail:target) .mainview{display:none}
  .wrap:has(.detail:target) #details{display:block}
  #details .detail{display:none}
  #details .detail:target{display:block;border:0;background:transparent;padding:0}
}
.jump{text-decoration:none}
.jump:hover{color:var(--accent);text-decoration:underline}
.jump{text-decoration:none}
.jump:hover{color:var(--accent);text-decoration:underline}

.bar{height:3px;border-radius:2px;background:var(--line);margin-top:5px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--accent)}
.tag.hot{color:var(--accent);border-color:var(--accent);background:var(--accent-bg)}
.tag.fr{color:var(--ink-3)}
.tag.b1,.ws.b1,.hs.b1{color:var(--hot-1)}
.tag.b1{border-color:var(--hot-1);background:var(--hot-1-bg)}
.tag.b2,.ws.b2,.hs.b2{color:var(--hot-2)}
.tag.b2{border-color:var(--hot-2);background:var(--hot-2-bg)}
.tag.b3,.ws.b3,.hs.b3{color:var(--hot-3)}
.tag.b3{border-color:var(--hot-3);background:var(--hot-3-bg)}
.tag.b4,.ws.b4,.hs.b4{color:var(--hot-4)}
.tag.b4{border-color:var(--hot-4);background:var(--hot-4-bg)}
.bar i.b1{background:var(--hot-1)}
.bar i.b2{background:var(--hot-2)}
.bar i.b3{background:var(--hot-3)}
.bar i.b4{background:var(--hot-4)}
.hs{font-family:var(--mono);font-size:12px;font-variant-numeric:tabular-nums;font-weight:600}

.method{border-top:1px solid var(--line);padding-top:20px;font-size:13px;color:var(--ink-2);line-height:1.65}
.method h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink);margin:0 0 10px}
.method p{margin:0 0 10px}
.method code{font-family:var(--mono);font-size:12px;color:var(--ink)}
.empty{color:var(--ink-3);padding:14px 0}
`

type Art = Map<number, string>

/** Which titles the schedule renders. Used by the renderer AND by the
 * blank-page assertion in build(), so the two can never disagree — the
 * assertion previously counted every upcoming title and so fired on a
 * legitimately empty window (e.g. --horizon 7 in a quiet week).
 *
 * Changed titles are exempt from the horizon: one matters however far out. */
function inSchedule(title: Title, horizonDays: number, alerted: Set<number>): boolean {
  return (
    title.daysOut != null &&
    title.daysOut >= 0 &&
    (title.daysOut <= horizonDays || alerted.has(title.id))
  )
}

/** The schedule is the page's single list of titles. Changed titles are tagged
 * in place and reachable through the Alerts filter — no separate section
 * duplicating the same rows. */
function renderSchedule(titles: Title[], horizonDays: number, art: Art, alerts: Alert[]): string {
  const alerted = new Map(alerts.map((a) => [a.title.id, a]))
  const alertedIds = new Set(alerted.keys())
  const inWindow = titles.filter((t) => inSchedule(t, horizonDays, alertedIds))
  if (inWindow.length === 0) return `<p class="empty">Nothing scheduled in this window.</p>`

  const months = new Map<string, Title[]>()
  for (const title of inWindow) {
    const key = title.releaseDate?.slice(0, 7) ?? 'unknown'
    months.set(key, [...(months.get(key) ?? []), title])
  }

  const header = `<div class="rowhead">
    <span>Date</span><span></span><span>Title</span><span>Type</span>
    <span class="cg">Genres</span>
    <span class="r" title="Buzz — Wikipedia attention vs this title's own normal. 50 is normal.">Buzz</span>
    <span class="co r">Out</span>
  </div>`

  const body = [...months.entries()]
    .map(([month, group]) => {
      const rows = group
        .map((t) => {
          const alert = alerted.get(t.id)
          const tags = (alert?.reasons ?? [])
            .filter((reason) => REASON_LABEL[reason] !== '')
            .map(
              (reason) =>
                `<span class="tag ${reason === 'newly-added' ? 'up' : 'moved'}">${esc(REASON_LABEL[reason])}</span>`,
            )
            .join('')
          // A franchise-level tie says the franchise hub is hot, not this
          // title — label it as such rather than letting it read as a
          // title-level signal.
          const wiki = t.trend
            ? `<span class="tag ${t.trend.match === 'exact' ? 'hot' : 'fr'}" title="${esc(
                `${t.trend.domain} · trending ${t.trend.trendingScore.toFixed(2)}`,
              )}">${t.trend.match === 'exact' ? 'wiki hot' : 'franchise hot'}</span>`
            : ''
          // How many independent sources agree. Neutral, never a heat colour —
          // the ramp owns red-to-green for magnitude, and agreement is a
          // different dimension; one colour meaning two things dilutes both.
          const agree =
            t.attention && t.attention.rising.length > 1
              ? `<span class="tag" title="${esc(
                  `rising in: ${t.attention.rising.join(', ')}`,
                )}">${t.attention.rising.length}&times;</span>`
              : ''
          // Buzz replaced the Metascore column: most upcoming titles have no
          // Metascore, so it was a column of dashes, and the buzz number is the
          // thing worth scanning down. A dash means "not measured", NOT "cold".
          // A 0 means measured with no surge at all. Painting it a band colour
          // implies a signal that isn't there, so zero stays neutral.
          const buzzTone = t.buzz && t.buzz.points > 0 ? BAND_CLASS[t.buzz.band] : 'zero'
          const buzzCell = t.buzz
            ? `<span class="r hs ${buzzTone}${t.buzz.spiking ? '' : ' faint'}" title="${esc(
                `Buzz ${t.buzz.points}/100 · ${BAND_LABEL[t.buzz.band]}${
                  t.buzz.spiking ? ' · rising' : ''
                } — +${t.buzz.excess} views/day over normal (${t.buzz.baseline} → ${t.buzz.recent})`,
              )}">${t.buzz.points}</span>`
            : `<span class="r none" title="No buzz signal — no Wikipedia article, or too little traffic to read. Not the same as cold.">—</span>`

          return `<a class="${ROW_CLASS}" href="${esc(titleHref(t))}"
              data-type="${t.type}" data-alert="${alert ? 1 : 0}">
            <span class="when">${esc(fmtDate(t.releaseDate))}</span>
            ${poster(t, art.has(t.id), 'thumb')}
            <span class="t">${esc(t.title)}${
              tags || wiki || agree ? `<span class="tags">${tags}${agree}${wiki}</span>` : ''
            }</span>
            <span class="k">${t.type === 'movie' ? 'Film' : 'TV'}</span>
            <span class="cg g">${esc(t.genres.slice(0, 2).join(', ')) || '—'}</span>
            ${buzzCell}
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

const SOURCE_LABEL: Record<SignalSource, string> = {
  wikipedia: 'Wikipedia',
  youtube: 'YouTube',
  news: 'Google News',
  tmdb: 'TMDB',
}

const METRIC_LABEL: Record<string, string> = {
  views: 'views/day',
  onTopic: 'articles/day',
  popularity: 'popularity',
}

const SOURCE_ORDER: SignalSource[] = ['wikipedia', 'youtube', 'news', 'tmdb']

function anchorId(title: Title): string {
  return `t${title.id}`
}

function renderDetails(titles: Title[], art: Art): string {
  return titles
    .map((t) => {
      const attention = t.attention
      const bySource = new Map((attention?.sources ?? []).map((sig) => [sig.source, sig]))
      const rows = SOURCE_ORDER.filter((source) => bySource.has(source))
        .map((source) => {
          const sig = bySource.get(source)!
          const hot = sig.phase === 'rising'
          return `<div class="srow${hot ? '' : ' quiet'}">
            <span class="sname">${SOURCE_LABEL[source]}</span>
            <span class="tag ${hot ? 'hot' : ''}">${sig.phase}</span>
            <span class="sval">${compact(sig.baseline)} &rarr; ${compact(sig.recent)} <i>${
              METRIC_LABEL[sig.metric] ?? esc(sig.metric)
            }</i></span>
            <span class="srel"><b>${sig.relative}&times;</b> vs similar · ${sig.momentum}&times; wk · ${sig.days}d</span>
          </div>`
        })
        .join('')

      const badges = [
        attention?.confirmed
          ? `<span class="tag hot">confirmed · ${attention.rising.length} sources</span>`
          : attention && attention.rising.length > 0
            ? `<span class="tag hot">single source</span>`
            : '',
        t.buzz ? `<span class="tag">buzz ${t.buzz.points}</span>` : '',
        t.trend
          ? `<span class="tag">${t.trend.match === 'exact' ? 'wiki hot' : 'franchise hot'}</span>`
          : '',

        SOURCE_ORDER.filter((source) => bySource.has(source))
          .map((source) => {
            const sig = bySource.get(source)!
            const rising = sig.phase === 'rising'
            return `<span class="tag ${rising ? 'hot' : 'quiet'}">${SOURCE_LABEL[source]}${
              rising ? ` <i>${sig.relative}&times;</i>` : ''
            }</span>`
          })
          .join('') || '<span class="dmeta">no movement</span>',
      ].join('')

      const fandom = t.trend
        ? `<h3>On Fandom</h3>
           <p class="snote">${
             t.trend.match === 'exact'
               ? `This title's own wiki, <a href="https://${esc(t.trend.domain)}" target="_blank" rel="noreferrer">${esc(t.trend.domain)}</a>, is trending this week.`
               : `Its franchise hub <a href="https://${esc(t.trend.domain)}" target="_blank" rel="noreferrer">${esc(t.trend.domain)}</a> is trending — which says the franchise is drawing an audience, not necessarily this title.`
           } ${t.trend.pageviews14d.toLocaleString('en-US')} readers in 14 days, trending ${Math.round(t.trend.trendingScore * 100)}%${t.trend.isNew ? ' — first week in the trending list' : ''}.</p>`
        : ''

      return `<div class="detail" id="${anchorId(t)}">
        <p><a class="closed" href="#">&larr; Back to the radar</a></p>
        <div class="dhead">
          ${poster(t, art.has(t.id), 'dart')}
          <div class="dmain">
            <h1>${esc(t.title)}</h1>
            <p class="dmeta">${t.type === 'movie' ? 'Film' : 'TV'} · ${esc(fmtDateYear(t.releaseDate))}${
              t.daysOut != null && t.daysOut >= 0 ? ` · in ${t.daysOut} days` : ''
            }</p>
            <div class="dbadges">${badges}</div>
          </div>
        </div>

        <h3>Where it's trending</h3>
        ${
          rows ||
          `<p class="snote">Nothing could be measured — no source had enough history. That is an absence of evidence, not evidence it is cold.</p>`
        }
        ${
          rows
            ? `<p class="snote">Each source is measured against <i>its own</i> recent normal, then against what titles the same distance from release are doing — so the ramp every title gets as it approaches release is already divided out. <b>Rising</b> means at least twice normal and still climbing week over week. A source is only listed once it has enough history to have an opinion.</p>`
            : ''
        }
        ${fandom}
        <p class="snote"><a href="https://www.fandom.com/search?query=${encodeURIComponent(t.title)}" target="_blank" rel="noreferrer">Search Fandom for this title &rarr;</a></p>
      </div>`
    })
    .join('')
}

/** Where a title links to: its own detail block, further down the page.
 *
 * Deliberately never Metacritic. The outbound links (the Fandom wiki, a Fandom
 * search) live inside the detail block, where there is room to label them.
 */
function titleHref(title: Title): string {
  return `#${anchorId(title)}`
}

/** Heat band -> css class and human name. Four steps so a 34 and a 60 don't
 * land on the same colour, which is what happened when there were only two. */
const BAND_CLASS: Record<Buzz['band'], string> = {
  exceptional: 'b1',
  strong: 'b2',
  notable: 'b3',
  quiet: 'b4',
}
const BAND_LABEL: Record<Buzz['band'], string> = {
  exceptional: 'exceptional',
  strong: 'strong',
  notable: 'notable',
  quiet: 'quiet',
}

/** 151556 -> "151.6k". The side column is 300px wide and full thousands
 * separators pushed the domain line into an ellipsis, hiding the number the
 * line exists to show. */
function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n)
}

/** The buzz panel: titles whose Wikipedia attention has broken away from their
 * own normal. Ordered by points, which is the only ordering in this tool that
 * ranks titles against each other — and it ranks them on *movement*, not fame,
 * which is what keeps it out of the territory of the deleted demand score. */
function renderBuzz(titles: Title[], coverage: RadarOutput['buzz']): string {
  if (!coverage) return `<p class="empty">No attention data for this run.</p>`
  const top = ranked(titles, 12)
  if (top.length === 0) {
    return `<p class="empty">Nothing measurable yet — ${coverage.resolved} of these titles have a Wikipedia article.</p>`
  }
  return top
    .map((t) => {
      const b = t.buzz
      // A fading title is still elevated but its event has passed, so it gets a
      // quiet label rather than the same badge as a live one.
      const flag =
        b.phase === 'rising'
          ? `<span class="tag hot">rising</span>`
          : b.phase === 'fading'
            ? `<span class="tag fr">fading</span>`
            : ''
      // Band colour is always accompanied by the band's NAME. Amber is sub-3:1
      // on the light ground, and colour alone excludes colourblind readers.
      const cls = BAND_CLASS[b.band]
      const bandTag = `<span class="tag ${cls}">${BAND_LABEL[b.band]}</span>`
      return `<div class="wiki">
        <div class="wtop"><span class="wn"><a class="jump" href="${esc(titleHref(t))}">${esc(t.title)}</a></span>${bandTag}${flag}
        <span class="ws ${cls}">${b.points}</span></div>
        <div class="wd">+${compact(b.excess)}/day over normal · ${compact(b.baseline)} → ${compact(b.recent)} · ${b.momentum}× wk${
          t.attention && t.attention.rising.length > 1
            ? `<br>rising in ${esc(t.attention.rising.join(', '))}`
            : ''
        }</div>
        <div class="bar"><i class="${cls}" style="width:${b.points}%"></i></div>
      </div>`
    })
    .join('')
}

/** The first-party panel: wikis our audience is hot on that have no upcoming
 * release behind them. Deliberately the *unmapped* list — the matched ones are
 * already tagged in place on the schedule, and repeating them here would just
 * be the same rows twice. */
function renderTrending(report: TrendingReport | null): string {
  if (!report) {
    return `<p class="empty">No first-party export for this run — so no wiki signal. That is missing input, not a quiet week.</p>`
  }
  if (report.unmapped.length === 0) {
    return `<p class="empty">Every trending wiki this week ties to an upcoming release.</p>`
  }
  // Everything here is written as a sentence a person can act on. The earlier
  // version printed "0.83 · level 0.85 · +0.69", which is the raw export's
  // vocabulary and means nothing to a reader — three unlabelled decimals that
  // all look like the same kind of number and aren't.
  return report.unmapped
    .map((w) => {
      const heat = Math.round(w.fpScore * 100)
      const now = Math.round(w.trendingScore * 100)
      const badge = w.isNew
        ? `<span class="tag hot">1st week trending</span>`
        : w.velocity >= 0.1
          ? `<span class="tag hot">climbing</span>`
          : ''
      const trendSentence = w.isNew
        ? `first week in the trending list`
        : w.priorScore != null
          ? `${Math.round(w.priorScore * 100)}% &rarr; ${now}% this week`
          : `${now}% this week`
      return `<div class="wiki">
        <div class="wtop"><span class="wn">${esc(w.name)}</span>${badge}
        <span class="ws">${heat}</span></div>
        <div class="wd">${esc(w.pageviews14d.toLocaleString('en-US'))} readers in 14 days<br>${trendSentence}</div>
        <div class="bar"><i style="width:${heat}%"></i></div>
      </div>`
    })
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
    .slice(0, 40)
    .map((change) => {
      const [cls, label] = meta[change.kind]
      const detail =
        change.kind === 'date-changed'
          ? `<div class="movedate"><s>${esc(fmtDateYear(change.from ?? null))}</s> → ${esc(fmtDateYear(change.to ?? null))}</div>`
          : ''
      return `<div class="chg"><span class="lbl ${cls}">${label}</span>${esc(change.title)}${detail}</div>`
    })
    .join('')
}

/** Theme toggle + schedule filters. The static page has no framework, so this
 * is a few lines of inline JS. Both are enhancements: the page is complete and
 * readable with no JS at all. */
const SCRIPT = `
(function(){
  var radar=document.querySelector('.radar');
  var btn=document.getElementById('theme');
  if(radar&&btn){
    var label=btn.querySelector('span');
    var mq=window.matchMedia('(prefers-color-scheme: dark)');
    var choice=null;
    try{choice=localStorage.getItem('radar-theme')}catch(e){}
    if(choice!=='light'&&choice!=='dark')choice=null;

    function paint(){
      [radar,document.documentElement].forEach(function(el){
        if(choice){el.setAttribute('data-mode',choice)}else{el.removeAttribute('data-mode')}
      });
      var dark = choice ? choice==='dark' : mq.matches;
      label.textContent = dark ? 'Light' : 'Dark';
      btn.setAttribute('aria-label','Switch to '+(dark?'light':'dark')+' theme');
    }
    paint();

    var onSystemChange=function(){ if(!choice) paint() };
    if(mq.addEventListener){mq.addEventListener('change',onSystemChange)}
    else if(mq.addListener){mq.addListener(onSystemChange)}

    btn.addEventListener('click',function(){
      var dark = choice ? choice==='dark' : mq.matches;
      choice = dark ? 'light' : 'dark';
      try{localStorage.setItem('radar-theme',choice)}catch(e){}
      paint();
    });
  }

  var root=document.getElementById('sched');
  if(!root)return;
  var chips=root.querySelectorAll('[data-filter]');
  var items=root.querySelectorAll('.${ROW_CLASS}');
  var groups=root.querySelectorAll('.mgroup');

  if(!items.length)return;
  function apply(f){
    items.forEach(function(c){
      var ok = f==='all' || (f==='alerts' && c.dataset.alert==='1') || (f===c.dataset.type);
      c.hidden = !ok;
    });
    groups.forEach(function(g){
      var shown=g.querySelectorAll('.${ROW_CLASS}:not([hidden])').length;
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

/** Collect inlined art until the byte budget runs out; alerts first, then
 * whatever lands soonest. */
async function collectArt(data: RadarOutput): Promise<Art> {
  const order = [
    ...data.alerts.map((a) => a.title),
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
  const generated = new Date(data.generatedAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return `<div class="radar"><div class="wrap">
  <div class="mainview">

  <header class="top">
    <div>
      <p class="kicker">Fandom · TV &amp; Movies domain</p>
      <h1>Release Radar</h1>
      <p class="stamp">generated ${esc(generated)} · source: neutron-api</p>
    </div>
    <div class="tiles">
      <div class="tile"><b>${data.counts.inHorizon}</b><span>Next ${data.horizonDays} days</span></div>
      <div class="tile"><b>${data.counts.upcoming}</b><span>Upcoming</span></div>
      <div class="tile"><b>${data.counts.alerts}</b><span>Changed</span></div>
      ${data.buzz ? `<div class="tile"><b>${data.buzz.spiking}</b><span>Spiking</span></div>` : ''}
      ${
        data.trending
          ? `<div class="tile"><b>${data.trending.wikis}</b><span>Wikis trending</span></div>`
          : ''
      }
      <button id="theme" type="button" aria-label="Switch theme">◐ <span>Dark</span></button>
    </div>
  </header>

  <div class="cols">
    <section id="sched">
      <div class="shead"><h2>Schedule</h2><span class="aside">next ${data.horizonDays} days</span></div>
      <div class="chips">
        <button class="chip" data-filter="all" aria-pressed="true">All</button>
        <button class="chip" data-filter="alerts" aria-pressed="false">Changed</button>
        <button class="chip" data-filter="movie" aria-pressed="false">Film</button>
        <button class="chip" data-filter="show" aria-pressed="false">TV</button>
      </div>
      ${renderSchedule(data.titles, data.horizonDays, art, data.alerts)}
    </section>

    <div>
      <section>
        <div class="shead"><h2>Buzz</h2><span class="aside">${
          data.buzz ? `${data.buzz.spiking} rising · ${data.buzz.scored} measured` : 'no data'
        }</span></div>
        ${renderBuzz(data.titles, data.buzz)}
      </section>

      <section>
        <div class="shead"><h2>Trending on Fandom</h2><span class="aside">${
          data.trending ? `${data.trending.unmappedTotal} unattached` : 'no data'
        }</span></div>
        <p class="railnote">Wikis our audience is reading heavily that have <b>no upcoming release</b> — where a back-catalogue surge shows up.</p>
        ${renderTrending(data.trending)}
      </section>

      <section>
        <div class="shead"><h2>Since last run</h2><span class="aside">${data.changes.length}</span></div>
        ${renderChanges(data.changes)}
      </section>
    </div>
  </div>

  <section class="method">
    <h3>How to read this</h3>
    <p>The full forward calendar of film and TV releases from the Metacritic catalog, in date order. <b>Changed</b> titles are ones added to the calendar or moved since the previous run — that comes from diffing against our own stored snapshot, and it is a signal the upstream API doesn't expose.</p>
    <p><b>Trending on Fandom</b> is our own weekly wiki traffic${
      data.trending?.week ? ` (week of ${esc(data.trending.week)})` : ''
    } — it moves once a week, not daily. On a schedule row, <b>wiki hot</b> means the title's own wiki is trending, while <b>franchise hot</b> means its franchise hub is: that says the franchise is drawing an audience, not this specific title.</p>
    <p><b>Buzz</b> scores the <i>size of the surge</i> in Wikipedia pageviews — daily views beyond what a title this close to release would be getting anyway, so a big name sitting at its normal level scores nothing. The scale is anchored on a real event: <b>100 = The Odyssey's peak of 1.2M views/day</b>. For calibration, Superman (2025) would score 93, Avatar: Fire and Ash 90, Wicked: For Good 82. An ordinary trailer drop lands in the 40s–60s, so a week with nothing in red is the scale working, not a fault. The ramp runs <span class="tag b4">quiet</span> <span class="tag b3">notable</span> <span class="tag b2">strong</span> <span class="tag b1">exceptional</span>, and the score is always shown beside the colour. <b>Rising</b> means at least twice normal <i>and still climbing week over week</i>; <b>fading</b> means still elevated but the event has passed.${
      data.buzz
        ? ` Measured for ${data.buzz.scored} of ${data.counts.upcoming} titles — the rest have no article or too little traffic to read, which is <i>no signal</i> rather than a cold one.`
        : ''
    }</p>
    <p>The <b>Buzz</b> column replaced the Metascore: almost nothing has a Metascore before release, so it was a column of dashes. A dash there now means <i>not measured</i> — no Wikipedia article, or too little traffic to read — which is not the same as cold.</p>
    <p style="color:var(--ink-3)">Data: neutron-api (metacritic) and Fandom's internal trending export. The schedule is ordered by date and nothing here ranks titles by demand — the wiki signal is attached as labelled evidence, and a title with no tag has no signal rather than a cold one.</p>
  </section>

  </div><!-- /mainview -->

  <section id="details">
    ${renderDetails(data.titles, art)}
  </section>

</div></div>`
}

export async function build(data: RadarOutput, outDir = path.join(ROOT, 'out')): Promise<string> {
  await mkdir(outDir, { recursive: true })

  const art = await collectArt(data)
  const body = renderBody(data, art)
  const style = `<style>${CSS}\n${artCSS(art)}</style>`

  // Fail loudly rather than shipping a page that renders blank. The filter
  // script hides any month group containing no visible rows, so if the rows it
  // queries don't exist the whole schedule disappears — and a silently empty
  // page looks identical to "the pipeline found nothing".
  const rowCount = (body.match(new RegExp(`class="${ROW_CLASS}"`, 'g')) ?? []).length
  const alertedIds = new Set(data.alerts.map((a) => a.title.id))
  const expected = data.titles.filter((t) => inSchedule(t, data.horizonDays, alertedIds)).length
  if (expected > 0 && rowCount === 0) {
    throw new Error(
      `artifact: rendered 0 .${ROW_CLASS} elements for ${expected} upcoming titles — ` +
        `the filter script would blank the page`,
    )
  }

  const script = `<script>${SCRIPT}</script>`

  // Artifact fragment: no <html>/<head>/<body> — the publisher supplies those.
  await writeFile(path.join(outDir, 'dashboard.artifact.html'), `${style}\n${body}\n${script}`)

  const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TV &amp; Movies — Release Radar</title>
${style}
<style>html,body{margin:0;padding:0;background:#FAFAF9}
@media (prefers-color-scheme:dark){html:not([data-mode="light"]),html:not([data-mode="light"]) body{background:#0C0C0D}}
html[data-mode="dark"],html[data-mode="dark"] body{background:#0C0C0D}
html[data-mode="light"],html[data-mode="light"] body{background:#FAFAF9}</style>
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
