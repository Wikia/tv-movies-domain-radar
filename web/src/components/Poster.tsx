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
  const src = title.poster ?? title.image

  return (
    <div
      className={`relative aspect-[2/3] shrink-0 overflow-hidden border border-line bg-raise ${className}`}
    >
      {src && !failed ? (
        <img
          src={src}
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
