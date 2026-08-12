import { useEffect, useState } from 'react'

type Choice = 'light' | 'dark' | null // null = follow the OS

const KEY = 'radar-theme'

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function read(): Choice {
  try {
    const saved = localStorage.getItem(KEY)
    return saved === 'light' || saved === 'dark' ? saved : null
  } catch {
    return null // private mode, storage disabled — fall back to the OS
  }
}

/** Explicit light/dark switch.
 *
 * Until someone chooses, the page follows the OS — so `choice` starts null and
 * the stylesheet's prefers-color-scheme block applies. Choosing stamps
 * data-theme on <html>, which wins over the media query in both directions. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>(read)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  useEffect(() => {
    const root = document.documentElement
    if (choice) root.setAttribute('data-theme', choice)
    else root.removeAttribute('data-theme')

    try {
      if (choice) localStorage.setItem(KEY, choice)
      else localStorage.removeItem(KEY)
    } catch {
      // Non-fatal: the theme still applies for this page view.
    }
  }, [choice])

  // Without this the label goes stale when the OS theme changes after load: the
  // colours follow the media query but the button keeps offering the mode you're
  // already in, so the first click appears to do nothing.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const isDark = choice ? choice === 'dark' : systemDark

  return (
    <button
      type="button"
      onClick={() => setChoice(isDark ? 'light' : 'dark')}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      className="flex items-center gap-1.5 self-stretch rounded-[10px] border border-line bg-raise px-3 text-[11px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
    >
      <span aria-hidden="true">◐</span>
      {isDark ? 'Light' : 'Dark'}
    </button>
  )
}
