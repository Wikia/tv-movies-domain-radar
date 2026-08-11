import { useState } from 'react'

import type { Title } from '../types'

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter((word) => /[a-z0-9]/i.test(word))
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

/** Poster art with a typographic stand-in.
 *
 * ~17% of titles have no art, and a cached thumbnail can 404 if the cache was
 * cleared between a run and a page load, so the fallback handles both the
 * missing-URL and failed-load cases. Art is an enhancement; the row must read
 * fine without it. */
export function Poster({
  title,
  className = '',
  textClass = 'text-2xl',
}: {
  title: Title
  className?: string
  textClass?: string
}) {
  const [failed, setFailed] = useState(false)
  const show = title.poster && !failed

  return (
    <div
      className={`relative aspect-[2/3] shrink-0 overflow-hidden border border-line bg-raise ${className}`}
    >
      {show ? (
        <img
          src={title.poster ?? ''}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className={`flex size-full items-center justify-center font-semibold tracking-wide text-ink-3 ${textClass}`}
        >
          {initials(title.title)}
        </span>
      )}
    </div>
  )
}
