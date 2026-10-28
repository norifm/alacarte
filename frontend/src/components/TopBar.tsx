import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowLeft,
  Cloud,
  FileUp,
  Home as HomeIcon,
  Library as LibraryIcon,
  LogOut,
  Search as SearchIcon,
  Settings2,
  UserRoundCheck,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { HealthPill, getHealthPillTarget, getHealthPillAriaLabel } from './HealthPill'
import { Button } from './Button'
import { Modal } from './Modal'
import { api, type HealthReport } from '../api/client'
import { cx } from '../lib/cx'

const ROOT_ROUTES = new Set(['/', '/library'])

type Props = {
  health: HealthReport | null
  loading: boolean
}

type Tab = { to: string; end?: boolean; icon: React.ComponentType<{ className?: string }>; label: string; also?: string[] }

// The chrome, as nori's: one outlined pill floating over the page, which scrolls under it and shows
// blurred inside. On a wide window it runs along the top (the sections, the current one in the accent,
// then search, the status and the menu); on a phone it sits at the bottom, the status over the tabs in
// the same outline.
export function TopBar({ health, loading }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const wide = useWide()
  const atRoot = ROOT_ROUTES.has(location.pathname)
  const showHealth = location.pathname !== '/settings' && location.pathname !== '/status'

  const tabs: Tab[] = [
    { to: '/', end: true, icon: HomeIcon, label: t('nav.home') },
    { to: '/library', icon: LibraryIcon, label: t('nav.downloads') },
    { to: '/cloud-library', icon: Cloud, label: t('nav.appleMusic') },
    { to: '/imports', icon: FileUp, label: t('nav.imports') },
    { to: '/following', icon: UserRoundCheck, label: t('nav.following') },
  ]

  useEffect(() => setMenuOpen(false), [location.pathname])

  const confirmAndSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await api.authLogout()
    } catch {
      // ignore — reload regardless so the auth gate shows
    }
    window.location.reload()
  }

  const back = !atRoot && (
    <button type="button" onClick={() => navigate(-1)} className="glyph h-9 w-9" aria-label="Back">
      <ArrowLeft className="h-5 w-5" />
    </button>
  )

  const menu = (
    <NavMenu
      open={menuOpen}
      onOpenChange={setMenuOpen}
      onSignOut={() => {
        setMenuOpen(false)
        setConfirmSignOut(true)
      }}
    />
  )

  return (
    <>
      {/* A wide window: the bar along the top. */}
      <header className="chrome fixed left-1/2 top-3 z-30 hidden h-12 w-[min(1040px,calc(100%-32px))] -translate-x-1/2 items-center gap-0.5 rounded-full px-1.5 md:flex">
        {back}
        <nav className="flex min-w-0 flex-1 items-center gap-0.5" aria-label={t('nav.browse')}>
          {tabs.map((tab, i) => (
            <span key={tab.to} className="contents">
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cx(
                    'group flex h-9 items-center gap-[7px] whitespace-nowrap rounded-full px-3 text-[13px] font-medium text-quiet transition-colors duration-200 hover:bg-[var(--hover)] hover:text-white',
                    isActive && '!text-accent font-semibold is-on',
                  )
                }
              >
                <tab.icon className="h-5 w-5 shrink-0" />
                <span className="hidden lg:inline group-[.is-on]:inline">{tab.label}</span>
              </NavLink>
              {i === 0 && <span className="mx-1 h-5 w-px shrink-0 bg-[var(--hair)]" />}
            </span>
          ))}
        </nav>
        <NavLink
          to="/search"
          className={({ isActive }) => cx('glyph quiet h-9 w-9', isActive && 'on')}
          aria-label={t('topbar.search')}
        >
          <SearchIcon className="h-5 w-5" />
        </NavLink>
        <Link
          to={getHealthPillTarget(health)}
          aria-label={getHealthPillAriaLabel(health)}
          className="group ml-0.5 inline-flex"
        >
          <HealthPill health={health} loading={loading} variant="shell" />
        </Link>
        <div className="relative">{wide && menu}</div>
      </header>

      {/* A phone: a way back over the page, and the dock at the bottom. */}
      {!atRoot && (
        <div className="chrome fixed left-3 top-[max(12px,env(safe-area-inset-top))] z-30 rounded-full md:hidden">
          {back}
        </div>
      )}
      <div className="chrome fixed inset-x-2.5 bottom-[max(6px,env(safe-area-inset-bottom))] z-30 overflow-visible rounded-tile md:hidden">
        {showHealth && (
          <>
            <Link
              to={getHealthPillTarget(health)}
              aria-label={getHealthPillAriaLabel(health)}
              className="group flex justify-center px-2 pt-1.5"
            >
              <HealthPill health={health} loading={loading} variant="shell" />
            </Link>
            <hr className="mx-0 mt-1.5 border-0 border-t border-[var(--line)]" />
          </>
        )}
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
          <div className="relative grid h-full flex-1 place-items-center">{!wide && menu}</div>
        </nav>
      </div>

      <Modal
        open={confirmSignOut}
        onClose={() => !signingOut && setConfirmSignOut(false)}
        placement="center"
        label="Confirm sign out"
        className="!max-w-[24rem]"
      >
        <div className="p-6">
          <h2 className="text-base font-semibold text-white">{t('nav.confirmSignOut')}</h2>
          <div className="mt-6 flex justify-end gap-1">
            <Button onClick={() => setConfirmSignOut(false)} disabled={signingOut} variant="ghost">
              {t('nav.cancel')}
            </Button>
            <Button onClick={confirmAndSignOut} disabled={signingOut} variant="ghost" className="!text-rose-500">
              {signingOut ? 'Signing out…' : t('nav.signOut')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function useWide() {
  const query = '(min-width: 768px)'
  const [wide, setWide] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const m = matchMedia(query)
    const changed = () => setWide(m.matches)
    m.addEventListener('change', changed)
    return () => m.removeEventListener('change', changed)
  }, [])
  return wide
}

// The menu behind the settings glyph: Status, Settings and Sign out, a popover on the surface.
function NavMenu({
  open,
  onOpenChange,
  onSignOut,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSignOut: () => void
}) {
  const { t } = useTranslation()
  const location = useLocation()
  const ref = useRef<HTMLDivElement | null>(null)
  const lit = open || location.pathname === '/settings' || location.pathname === '/status'

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOpenChange(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false)
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [open, onOpenChange])

  return (
    <div ref={ref} className="contents">
      <button
        type="button"
        className={cx('glyph quiet h-9 w-9', lit && 'on')}
        aria-label={t('nav.settings')}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <Settings2 className="h-5 w-5" />
      </button>
      {open && (
        <div className="popover absolute bottom-[calc(100%+14px)] right-0 z-40 w-60 md:bottom-auto md:top-[calc(100%+12px)]" role="menu">
          <Link to="/status" className="popover-item" role="menuitem">
            <Activity />
            <span className="flex-1 truncate">{t('nav.status')}</span>
          </Link>
          <Link to="/settings" className="popover-item" role="menuitem">
            <Settings2 />
            <span className="flex-1 truncate">{t('nav.settings')}</span>
          </Link>
          <button type="button" className="popover-item" role="menuitem" onClick={onSignOut}>
            <LogOut />
            <span className="flex-1 truncate">{t('nav.signOut')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
