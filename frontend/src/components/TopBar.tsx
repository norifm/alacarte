import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Cloud,
  PagePlus as FileUp,
  HomeSimple as HomeIcon,
  AlbumList as LibraryIcon,
  Search as SearchIcon,
  Settings as Settings2,
  UserBadgeCheck as UserRoundCheck,
  Xmark as X,
} from 'iconoir-react'
import { useTranslation } from 'react-i18next'

import { HealthGlyph, HealthRow } from './HealthPill'
import type { HealthReport } from '../api/client'
import { cx } from '../lib/cx'

type Props = {
  health: HealthReport | null
  loading: boolean
}

type Tab = { to: string; end?: boolean; icon: React.ComponentType<{ className?: string }>; label: string; also?: string[] }

// The chrome, as nori's: one outlined pill floating over the page, which scrolls under it and shows
// blurred inside. On a wide window it runs along the top (the sections, the current one in the accent,
// then search, the status and Settings); on a phone it sits at the bottom, the status over the tabs in
// the same outline.
export function TopBar({ health, loading }: Props) {
  const { t } = useTranslation()


  const tabs: Tab[] = [
    { to: '/', end: true, icon: HomeIcon, label: t('nav.home') },
    { to: '/library', icon: LibraryIcon, label: t('nav.downloads') },
    { to: '/cloud-library', icon: Cloud, label: t('nav.appleMusic') },
    { to: '/imports', icon: FileUp, label: t('nav.imports') },
    { to: '/following', icon: UserRoundCheck, label: t('nav.following') },
  ]

  // The very right of the bar opens Settings, lit while it is open.
  const settings = (
    <NavLink to="/settings" className={({ isActive }) => cx('glyph quiet h-9 w-9', isActive && 'on')} aria-label={t('nav.settings')}>
      <Settings2 className="h-5 w-5" />
    </NavLink>
  )

  return (
    <>
      {/* A wide window: the bar along the top. */}
      <header className="chrome fixed left-[calc(50%-var(--scrollbar,0px)/2)] top-3 z-30 hidden h-12 w-[min(1040px,calc(100%-32px-var(--scrollbar,0px)))] -translate-x-1/2 items-center gap-0.5 rounded-full px-1.5 md:flex">
        <nav className="flex min-w-0 flex-1 items-center gap-0.5" aria-label={t('nav.browse')}>
          {tabs.map((tab, i) => (
            <span key={tab.to} className="contents">
              <NavLink
                to={tab.to}
                end={tab.end}
                aria-label={tab.label}
                className={({ isActive }) =>
                  cx(
                    'flex h-9 items-center gap-[7px] whitespace-nowrap rounded-full px-3 text-[13px] font-medium text-quiet transition-colors duration-200 hover:bg-[var(--hover)] hover:text-white',
                    isActive && '!text-accent [&>span>span:last-child]:font-semibold',
                  )
                }
              >
                <tab.icon className="h-5 w-5 shrink-0" />
                {/* Named while there is room, all of them or none; the bold name's width is kept for every
                    tab, so lighting one moves nothing. */}
                <span className="hidden lg:grid">
                  <span aria-hidden className="invisible col-start-1 row-start-1 font-semibold">{tab.label}</span>
                  <span className="col-start-1 row-start-1">{tab.label}</span>
                </span>
              </NavLink>
              {i === 0 && <span className="mx-1 h-5 w-px shrink-0 bg-[var(--hair)]" />}
            </span>
          ))}
        </nav>
        <SearchPill />
        <HealthGlyph health={health} loading={loading} />
        {settings}
      </header>

      {/* A phone: the dock at the bottom. */}
      <div className="chrome fixed inset-x-2.5 bottom-[max(6px,env(safe-area-inset-bottom))] z-30 overflow-visible rounded-tile md:hidden">
        {/* The status rides on every page, so the dock keeps one shape. */}
        <HealthRow health={health} loading={loading} />
        <hr className="mx-0 border-0 border-t border-[var(--line)]" />
        <nav className="flex h-[50px] items-center px-1.5" aria-label={t('nav.browse')}>
          {([tabs[0], { to: '/search', icon: SearchIcon, label: t('nav.search') }, ...tabs.slice(1)] as Tab[]).map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              aria-label={tab.label}
              className={({ isActive }) =>
                cx('grid h-full flex-1 place-items-center text-quiet transition-colors duration-200', isActive && '!text-accent')
              }
            >
              <tab.icon className="h-[21px] w-[21px]" />
            </NavLink>
          ))}
          <NavLink
            to="/settings"
            aria-label={t('nav.settings')}
            className={({ isActive }) =>
              cx('grid h-full flex-1 place-items-center text-quiet transition-colors duration-200', isActive && '!text-accent')
            }
          >
            <Settings2 className="h-[21px] w-[21px]" />
          </NavLink>
        </nav>
      </div>

    </>
  )
}

// The bar's search, as nori's: a capsule on the surface with a hairline edge, in the accent while it has the
// keys, when it widens into the room left of it (the tabs keep their places). What is typed is the search
// page's query; the answer shows on that page, under the bar.
function SearchPill() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const onSearch = location.pathname === '/search'
  const urlQ = onSearch ? params.get('q') ?? '' : ''
  const [q, setQ] = useState(urlQ)
  useEffect(() => setQ(urlQ), [urlQ])

  const change = (value: string) => {
    setQ(value)
    const next = new URLSearchParams(onSearch ? params : undefined)
    if (value) next.set('q', value)
    else next.delete('q')
    const query = next.toString()
    navigate(`/search${query ? `?${query}` : ''}`, { replace: onSearch })
  }

  return (
    <label
      className={cx(
        'group/search mx-1 flex h-9 w-44 shrink-0 cursor-text items-center gap-2 rounded-full border border-[var(--hair)] bg-surface px-3 text-quiet transition-[width,background-color] duration-200 ease-out hover:bg-[color-mix(in_srgb,var(--ink)_5%,var(--surface))] focus-within:w-56 focus-within:border-accent focus-within:!bg-surface lg:w-48 lg:focus-within:w-72',
      )}
    >
      <SearchIcon className={cx('h-[18px] w-[18px] shrink-0 group-focus-within/search:text-accent', onSearch && 'text-accent')} />
      <input
        type="search"
        value={q}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (q) change('')
            else e.currentTarget.blur()
          }
        }}
        placeholder={t('topbar.search')}
        aria-label={t('topbar.search')}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-quiet [&::-webkit-search-cancel-button]:hidden"
      />
      {q && (
        <button type="button" onClick={() => change('')} className="-mr-1.5 grid h-6 w-6 place-items-center rounded-full hover:text-white" aria-label={t('search.clearAriaLabel')}>
          <X className="h-4 w-4" />
        </button>
      )}
    </label>
  )
}
