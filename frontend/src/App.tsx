import { useCallback, useEffect, useRef, useState } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'iconoir-react'
import { AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'

import { HomePage } from './pages/Home'
import { SearchPage } from './pages/Search'
import { LibraryPage } from './pages/Library'
import { AlbumPage } from './pages/Album'
import { ArtistPage } from './pages/Artist'
import { PlaylistPage } from './pages/Playlist'
import { CuratorPage, LabelPage } from './pages/Browse'
import { StatusPage } from './pages/Status'
import { SettingsPage } from './pages/Settings'
import { FollowingPage } from './pages/Following'
import { ImportsPage } from './pages/Imports'
import { CloudLibraryPage } from './pages/CloudLibrary'
import { TopBar } from './components/TopBar'
import { PageWrapper } from './components/PageWrapper'
import { AuthScreen } from './components/AuthScreen'
import { useHealth } from './hooks/useHealth'
import { useAppSettings } from './hooks/useAppSettings'
import { applyUiLanguage } from './i18n'
import { setLook } from './lib/seasons'
import { Dots } from './components/Dots'
import { api, type AuthState, setUnauthorizedHandler } from './api/client'

type AuthLimits = {
  minPasswordLength: number
  usernameMinLength: number
  usernameMaxLength: number
}

type AuthGate =
  | { status: 'loading' }
  | ({ status: 'setup'; requiresSetupToken: boolean } & AuthLimits)
  | ({ status: 'login' } & AuthLimits)
  | { status: 'authed' }

const DEFAULT_LIMITS: AuthLimits = {
  minPasswordLength: 12,
  usernameMinLength: 2,
  usernameMaxLength: 32,
}

function limitsFromState(state: AuthState): AuthLimits {
  return {
    minPasswordLength: state.minPasswordLength ?? DEFAULT_LIMITS.minPasswordLength,
    usernameMinLength: state.usernameMinLength ?? DEFAULT_LIMITS.usernameMinLength,
    usernameMaxLength: state.usernameMaxLength ?? DEFAULT_LIMITS.usernameMaxLength,
  }
}

export default function App() {
  const { t } = useTranslation()
  const [gate, setGate] = useState<AuthGate>({ status: 'loading' })
  const [bootError, setBootError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setBootError(null)
      const state: AuthState = await api.authState()
      if (state.authDisabled || state.authed) {
        setGate({ status: 'authed' })
        return
      }
      if (!state.passwordSet) {
        setGate({
          status: 'setup',
          requiresSetupToken: Boolean(state.requiresSetupToken),
          ...limitsFromState(state),
        })
        return
      }
      // Password is set but the session cookie isn't valid — show login
      // before any authed UI gets a chance to render.
      setGate({ status: 'login', ...limitsFromState(state) })
    } catch (err) {
      setBootError(err instanceof Error ? err.message : t('app.unableToReachAuth'))
      setGate({ status: 'loading' })
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    setUnauthorizedHandler(({ needsSetup }) => {
      setGate((prev) =>
        prev.status === 'setup' || prev.status === 'login'
          ? prev
          : needsSetup
            ? { status: 'setup', requiresSetupToken: false, ...DEFAULT_LIMITS }
            : { status: 'login', ...DEFAULT_LIMITS },
      )
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  if (gate.status === 'loading') {
    return (
      <div className="fixed inset-0 flex items-center justify-center px-4">
        {bootError ? (
          <div className="w-full max-w-md p-5 text-center space-y-3">
            <p className="text-sm font-semibold text-rose-500">{t('app.couldNotLoadAuthState')}</p>
            <p className="text-xs text-quiet break-words">{bootError}</p>
            <button type="button" onClick={refresh} className="pill small quiet">
              {t('app.retry')}
            </button>
          </div>
        ) : (
          <Dots />
        )}
      </div>
    )
  }
  if (gate.status === 'setup' || gate.status === 'login') {
    return (
      <AnimatePresence mode="wait">
        <AuthScreen
          mode={gate.status}
          minPasswordLength={gate.minPasswordLength}
          usernameMinLength={gate.usernameMinLength}
          usernameMaxLength={gate.usernameMaxLength}
          requiresSetupToken={gate.status === 'setup' ? gate.requiresSetupToken : false}
          onAuthenticated={() => setGate({ status: 'authed' })}
        />
      </AnimatePresence>
    )
  }

  return <AuthedApp />
}

function AuthedApp() {
  const { health, loading } = useHealth()
  const location = useLocation()
  const navigate = useNavigate()
  const settings = useAppSettings()

  // The UI-language setting lives in backend settings (so it follows the
  // user across browsers/devices), not just localStorage — apply it to
  // i18next whenever settings load or change. 'system' means "follow the
  // browser's language", which i18next-browser-languagedetector handles.
  useEffect(() => {
    applyUiLanguage(settings?.uiLanguage)
  }, [settings?.uiLanguage])

  // The season and appearance follow the user across browsers like the language does.
  useEffect(() => {
    if (settings) setLook({ season: settings.season, appearance: settings.appearance })
  }, [settings?.season, settings?.appearance])

  const detail = DETAIL.test(location.pathname)

  // The bar is centred over the page's column, which a classic scrollbar narrows: half its width.
  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    const measure = () =>
      document.documentElement.style.setProperty('--scrollbar', `${main.offsetWidth - main.clientWidth}px`)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Each page opens at its top.
  const mainRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <>
      <TopBar health={health} loading={loading} />

      {/* The page scrolls inside here, under the chrome, as nori's does: the document itself never scrolls,
          so a phone's toolbars stay put and the dock never moves. The column is the top bar's width. */}
      <main ref={mainRef} id="main" className="fixed inset-0 isolate overflow-y-auto overscroll-contain">
        {/* The way back, as nori's desktop has it: a disc beside what the page is about, left of the column
            where there is room (over its corner where there is not). It stays where it is while a long list
            scrolls under it. */}
        {detail && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="glyph chrome fixed left-[max(8px,calc((100%-var(--scrollbar,0px)-1040px)/2-56px))] top-[max(20px,env(safe-area-inset-top))] z-20 !h-10 !w-10 md:top-[84px]"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <div
          className={`mx-auto w-full max-w-[calc(1040px+2*var(--gutter))] px-[var(--gutter)] pb-[calc(140px+env(safe-area-inset-bottom))] md:pb-12 ${
            'pt-[max(20px,env(safe-area-inset-top))] md:pt-[84px]'
          }`}
        >
          <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<PageWrapper><HomePage /></PageWrapper>} />
              <Route path="/search" element={<PageWrapper><SearchPage /></PageWrapper>} />
              <Route path="/library" element={<PageWrapper><LibraryPage /></PageWrapper>} />
              <Route path="/following" element={<PageWrapper><FollowingPage /></PageWrapper>} />
              <Route path="/imports" element={<PageWrapper><ImportsPage /></PageWrapper>} />
              <Route path="/cloud-library" element={<PageWrapper><CloudLibraryPage /></PageWrapper>} />
              <Route path="/album/:id" element={<PageWrapper><AlbumPage /></PageWrapper>} />
              <Route path="/artist/:id" element={<PageWrapper><ArtistPage /></PageWrapper>} />
              <Route path="/curator/:id" element={<PageWrapper><CuratorPage /></PageWrapper>} />
              <Route path="/label/:id" element={<PageWrapper><LabelPage /></PageWrapper>} />
              <Route path="/playlist/library/:libraryId" element={<PageWrapper><PlaylistPage /></PageWrapper>} />
              <Route path="/playlist/:id" element={<PageWrapper><PlaylistPage /></PageWrapper>} />
              <Route path="/status" element={<PageWrapper><StatusPage /></PageWrapper>} />
              <Route path="/settings" element={<PageWrapper><SettingsPage /></PageWrapper>} />
            </Routes>
          </AnimatePresence>
        </div>
      </main>
    </>
  )
}

/** Pages reached from another one, which offer a way back; the sections in the chrome do not. */
const DETAIL = /^\/(album|artist|playlist|curator|label)\//

