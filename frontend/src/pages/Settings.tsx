import { useEffect, useRef, useState, useCallback } from 'react'
import {
  WarningCircle as AlertCircle,
  NavArrowDown as ChevronDown,
  NavArrowUp as ChevronUp,
  Copy,
  Lock,
  Key,
  Globe,
  Folder as FolderOpen,
  PlaylistPlus as ListPlus,
  QuoteMessage as MicVocal,
  Server as Plug,
  AntennaSignal,
  Antenna as Radar,
  ShieldCheck,
  Label as Tags,
  User as UserIcon,
  Community as Users,
  Tools as Wrench,
  Palette,
} from 'iconoir-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'

import {
  api,
  type AppleStatus,
  type ArtistBackfillStatus,
  type LyricsBackfillStatus,
  type PublicSettings,
  type TagBackfillStatus,
} from '../api/client'
import { setAppSettingsCache } from '../hooks/useAppSettings'
import { useEventStream } from '../hooks/useEventStream'
import i18n, { SUPPORTED_LANGUAGES, LANGUAGE_NATIVE_LABELS } from '../i18n'

import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Modal } from '../components/Modal'
import { ProgressBar } from '../components/ProgressBar'
import { StaggeredList, StaggeredItem } from '../components/StaggeredList'
import { LanguageChipInput, type LanguageOption } from '../components/LanguageChipInput'
import { cx } from '../lib/cx'
import { calendarNow, seasonTiles, setLook } from '../lib/seasons'
import { useLook } from '../hooks/useSeasons'
import { PageTitle } from '../components/PageTitle'
import { SeasonMark } from '../components/SeasonMark'

// Must match backend/lib/metadataLanguage.mjs's LANGUAGE_CATALOG.
const ACCEPTED_LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: 'Chinese (Simplified) · 中文' },
  { code: 'zh-hant', label: 'Chinese (Traditional) · 中文（繁體）' },
  { code: 'ja', label: 'Japanese · 日本語' },
  { code: 'ko', label: 'Korean · 한국어' },
  { code: 'es', label: 'Spanish · Español' },
  { code: 'fr', label: 'French · Français' },
]

const NAMING_LANGUAGE_MODE_OPTIONS: Array<{
  value: PublicSettings['namingLanguageMode']
  labelKey: string
}> = [
  { value: 'display', labelKey: 'settings.namingModeDisplay' },
  { value: 'original-if-accepted', labelKey: 'settings.namingModeOriginalIfAccepted' },
  { value: 'dual', labelKey: 'settings.namingModeDual' },
]

const QUALITY_OPTIONS: Array<{ value: PublicSettings['quality']; labelKey: string }> = [
  { value: 'flac', labelKey: 'settings.qualityFlac' },
  { value: 'alac', labelKey: 'settings.qualityAlac' },
  { value: 'atmos', labelKey: 'settings.qualityAtmos' },
  { value: 'aac', labelKey: 'settings.qualityAac' },
]

const AUTO_DOWNLOAD_FREQUENCY_OPTIONS: Array<{
  value: PublicSettings['autoDownloadCheckFrequency']
  labelKey: string
}> = [
  { value: 'auto', labelKey: 'settings.frequencyAuto' },
  { value: '1h', labelKey: 'settings.frequencyHourly' },
  { value: '6h', labelKey: 'settings.frequency6h' },
  { value: '12h', labelKey: 'settings.frequency12h' },
  { value: 'daily', labelKey: 'settings.frequencyDaily' },
  { value: 'weekly', labelKey: 'settings.frequencyWeekly' },
]

export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [storefronts, setStorefronts] = useState<Array<{ id: string; name: string }>>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const flashTimeoutRef = useRef<number | null>(null)

  const reload = () =>
    api
      .settings()
      .then((s) => {
        setSettings(s)
        setAppSettingsCache(s)
      })
      .catch(() => { })
  useEffect(() => {
    reload()
  }, [])

  const uiLang = i18n.resolvedLanguage || 'en'
  useEffect(() => {
    api
      .storefronts(uiLang)
      .then((r) => setStorefronts(r.storefronts))
      .catch(() => { })
  }, [uiLang])

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) {
        window.clearTimeout(flashTimeoutRef.current)
      }
    }
  }, [])

  const update = async (patch: Partial<PublicSettings>) => {
    if (!settings) return
    setSettings({ ...settings, ...patch } as PublicSettings)
    try {
      const next = await api.saveSettings(patch)
      setSettings(next)
      setAppSettingsCache(next)
      flash('Saved')
    } catch (err: any) {
      flash(`Error: ${err.message}`, true)
    }
  }

  const flash = (msg: string, _err = false) => {
    if (flashTimeoutRef.current) {
      window.clearTimeout(flashTimeoutRef.current)
    }
    setMessage(msg)
    flashTimeoutRef.current = window.setTimeout(() => {
      setMessage(null)
      flashTimeoutRef.current = null
    }, 2500)
  }

  if (!settings) {
    return null
  }

  return (
    <>
      <AnimatePresence>
        {message && (
          <motion.div
            key="settings-flash"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="messages"
          >
            <div className="message min-h-10 !pr-[18px]">{message}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <StaggeredList className="flex w-full flex-col gap-[26px]">
        <PageTitle>{t('nav.settings')}</PageTitle>

        <StaggeredItem>
          <AppearanceSection settings={settings} update={update} />
        </StaggeredItem>
        <StaggeredItem>
          <SettingsCard icon={<Lock className="h-4 w-4" />} title={t('settings.cardAppleCredentials')}>
            <AppleCredsForm
              settings={settings}
              onChange={reload}
              disabled={saving}
              setSaving={setSaving}
            />
          </SettingsCard>
        </StaggeredItem>

        <StaggeredItem>
          <SettingsCard icon={<Key className="h-4 w-4" />} title={t('settings.cardMediaUserToken')}>
            <MediaUserTokenForm settings={settings} onChange={reload} />
          </SettingsCard>
        </StaggeredItem>

        <StaggeredItem>
          <SettingsCard icon={<Globe className="h-4 w-4" />} title={t('settings.cardCatalog')}>
            <div className="space-y-4">
              <label className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-3">
                <span className="text-[15px] md:w-40">{t('settings.language')}</span>
                <select
                  value={settings.uiLanguage}
                  onChange={(e) => update({ uiLanguage: e.target.value as PublicSettings['uiLanguage'] })}
                  className="w-full rounded-card bg-[var(--field)] px-4 py-3 pr-10 text-white outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)] md:flex-1"
                >
                  <option value="system">
                    {t('settings.followSystemDefault')}
                  </option>
                  {SUPPORTED_LANGUAGES.map((code) => (
                    <option key={code} value={code}>
                      {LANGUAGE_NATIVE_LABELS[code]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-3">
                <span className="text-[15px] md:w-40">{t('settings.storefront')}</span>
                <select
                  value={settings.storefront}
                  onChange={(e) => update({ storefront: e.target.value })}
                  className="w-full rounded-card bg-[var(--field)] px-4 py-3 pr-10 text-white outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)] md:flex-1"
                >
                  {!storefronts.some((s) => s.id === settings.storefront) && (
                    <option value={settings.storefront}>
                      {settings.storefront.toUpperCase()}
                    </option>
                  )}
                  {storefronts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.id.toUpperCase()})
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-4 has-[:disabled]:cursor-not-allowed">
                <div>
                  <div className="text-[15px]">{t('settings.autoStorefront')}</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoStorefront}
                  onChange={(e) => update({ autoStorefront: e.target.checked })}
                  className="switch"
                />
              </label>
              <label className="flex flex-col gap-1.5 md:flex-row md:items-start md:gap-3">
                <span className="text-[15px] md:w-40 md:pt-2">
                  {t('settings.contentRating')}
                </span>
                <div className="md:flex-1">
                  <select
                    value={settings.explicitFilter}
                    onChange={(e) =>
                      update({
                        explicitFilter: e.target
                          .value as PublicSettings['explicitFilter'],
                      })
                    }
                    className="w-full rounded-card bg-[var(--field)] px-4 py-3 pr-10 text-white outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]"
                  >
                    <option value="explicit">
                      {t('settings.preferExplicit')}
                    </option>
                    <option value="clean">
                      {t('settings.preferClean')}
                    </option>
                    <option value="both">
                      {t('settings.showBoth')}
                    </option>
                  </select>

                </div>
              </label>
            </div>
          </SettingsCard>
        </StaggeredItem>

        <StaggeredItem>
          <SettingsCard icon={<FolderOpen className="h-4 w-4" />} title={t('settings.libraryOutput')}>
            <div className="space-y-4">
              <label className="flex flex-col gap-1.5 md:flex-row md:items-start md:gap-3">
                <span className="text-[15px] md:w-40 md:pt-2">{t('settings.quality')}</span>
                <div className="md:flex-1">
                  <select
                    value={settings.quality}
                    onChange={(e) =>
                      update({ quality: e.target.value as PublicSettings['quality'] })
                    }
                    className="w-full rounded-card bg-[var(--field)] px-4 py-3 pr-10 text-white outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]"
                  >
                    {QUALITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-4 has-[:disabled]:cursor-not-allowed">
                <div>
                  <div className="text-[15px]">{t('settings.askQualityBeforeManual')}</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.promptForDownloadQuality}
                  onChange={(e) => update({ promptForDownloadQuality: e.target.checked })}
                  className="switch"
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-4 has-[:disabled]:cursor-not-allowed">
                <div>
                  <div className="text-[15px]">{t('settings.stagingInsideLibrary')}</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.stagingInsideMusicLibrary}
                  onChange={(e) => update({ stagingInsideMusicLibrary: e.target.checked })}
                  className="switch"
                />
              </label>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="text-[15px]">{t('settings.namingConvention')}</div>
                  <select
                    value={settings.namingConvention ?? 'apple'}
                    onChange={(e) => update({ namingConvention: e.target.value as 'apple' | 'qobuz' })}
                    className="mt-2 w-full rounded-card bg-[var(--field)] px-4 py-3 pr-10 text-white outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]"
                  >
                    <option value="apple">{t('settings.namingApple')}</option>
                    <option value="qobuz">{t('settings.qobuzCompatible')}</option>
                  </select>
                </div>
              </div>
              <label className="flex cursor-pointer items-center justify-between gap-4 has-[:disabled]:cursor-not-allowed">
                <div>
                  <div
                    className={`text-[15px] ${settings.hasMediaUserToken ? '' : 'text-quiet'}`}
                  >
                    {t('settings.downloadLyrics')}
                  </div>

                </div>
                <input
                  type="checkbox"
                  checked={settings.downloadLyrics}
                  onChange={(e) => update({ downloadLyrics: e.target.checked })}
                  className="switch"
                  disabled={!settings.hasMediaUserToken}
                />
              </label>
              <label className="flex flex-col gap-1.5 md:flex-row md:items-start md:gap-3">
                <span className="text-[15px] md:w-40 md:pt-2">{t('settings.lyricsFormat')}</span>
                <div className="md:flex-1">
                  <select
                    id="lyrics-format-select"
                    value={settings.lyricsFormat}
                    disabled={!settings.downloadLyrics}
                    onChange={(e) =>
                      update({ lyricsFormat: e.target.value as PublicSettings['lyricsFormat'] })
                    }
                    className="w-full rounded-card bg-[var(--field)] px-4 py-3 pr-10 text-white outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="lrc">{t('settings.lyricsFormatLrc')}</option>
                    <option value="ttml">{t('settings.lyricsFormatTtml')}</option>
                    <option value="both">{t('settings.lyricsFormatBoth')}</option>
                  </select>

                </div>
              </label>
              <label className="flex flex-col gap-1.5 md:flex-row md:items-start md:gap-3">
                <span className="text-[15px] md:w-40 md:pt-2">{t('settings.lyricsType')}</span>
                <div className="md:flex-1">
                  <select
                    id="lyrics-type-select"
                    value={settings.lyricsType}
                    disabled={!settings.downloadLyrics}
                    onChange={(e) =>
                      update({ lyricsType: e.target.value as PublicSettings['lyricsType'] })
                    }
                    className="w-full rounded-card bg-[var(--field)] px-4 py-3 pr-10 text-white outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="lyrics">{t('settings.lyricsTypeLyrics')}</option>
                    <option value="lyrics-with-translation">{t('settings.lyricsTypeWithTranslation')}</option>
                  </select>

                </div>
              </label>
              <label className="flex flex-col gap-1.5 md:flex-row md:items-start md:gap-3">
                <span className="text-[15px] md:w-40 md:pt-2">
                  {t('settings.coverSize')}
                </span>
                <div className="md:flex-1">
                  <select
                    value={settings.coverSize}
                    onChange={(e) => update({ coverSize: e.target.value })}
                    className="w-full rounded-card bg-[var(--field)] px-4 py-3 pr-10 text-white outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]"
                  >
                    <option value="1400x1400">{t('settings.coverSize1400')}</option>
                    <option value="2000x2000">{t('settings.coverSize2000')}</option>
                    <option value="3000x3000">{t('settings.coverSize3000')}</option>
                    <option value="5000x5000">{t('settings.coverSize5000')}</option>
                  </select>

                </div>
              </label>

              <label className="flex flex-col gap-1.5 md:flex-row md:items-start md:gap-3">
                <span className="text-[15px] md:w-40 md:pt-2">
                  {t('settings.namingLanguageMode')}
                </span>
                <div className="md:flex-1">
                  <select
                    value={settings.namingLanguageMode}
                    onChange={(e) =>
                      update({
                        namingLanguageMode: e.target.value as PublicSettings['namingLanguageMode'],
                      })
                    }
                    className="w-full rounded-card bg-[var(--field)] px-4 py-3 pr-10 text-white outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]"
                  >
                    {NAMING_LANGUAGE_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                  {settings.namingLanguageMode !== 'display' && (
                    <div className="mt-1.5 text-[13px] text-quiet">
                      {t(`${NAMING_LANGUAGE_MODE_OPTIONS.find((o) => o.value === settings.namingLanguageMode)?.labelKey}Help`)}
                    </div>
                  )}
                </div>
              </label>

              <div className="border-t border-[var(--line)] pt-4">
                <div className="text-sm text-white/70">{t('settings.acceptedLanguages')}</div>
                <div className="mt-2">
                  <LanguageChipInput
                    value={settings.acceptedLanguages}
                    onChange={(next) => update({ acceptedLanguages: next })}
                    options={ACCEPTED_LANGUAGE_OPTIONS}
                    placeholder={t('settings.acceptedLanguagesPlaceholder')}
                    emptyHint={t('settings.acceptedLanguagesEmpty')}
                  />
                </div>
              </div>
            </div>
          </SettingsCard>
        </StaggeredItem>

        <StaggeredItem>
          <SettingsCard icon={<ListPlus className="h-4 w-4" />} title={t('settings.cardOtherVersions')}>
            <div className="space-y-4">
              <label className="flex cursor-pointer items-center justify-between gap-4 has-[:disabled]:cursor-not-allowed">
                <div>
                  <div className="text-[15px]">
                    {t('settings.showOtherVersionOptions')}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.versionOptionsEnabled}
                  onChange={(e) =>
                    update({ versionOptionsEnabled: e.target.checked })
                  }
                  className="switch"
                />
              </label>
              {settings.versionOptionsEnabled && (
                <div
                  className="flex flex-wrap items-center gap-2 pt-1"
                  role="group"
                  aria-label={t('settings.versionsToOffer')}
                >
                  <span className="mr-1 text-[13px] text-quiet">{t('settings.offer')}</span>
                  {(['lossless', 'atmos', 'aac'] as const).map((group) => {
                    const on = settings.versionOptions.includes(group)
                    return (
                      <button
                        key={group}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          const next = on
                            ? settings.versionOptions.filter((g) => g !== group)
                            : [...settings.versionOptions, group]
                          update({ versionOptions: next })
                        }}
                        className={'chip' + (on ? ' on' : '')}
                      >
                        {group === 'lossless'
                          ? t('settings.versionLossless')
                          : group === 'atmos'
                            ? t('settings.versionAtmos')
                            : t('settings.versionAac')}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </SettingsCard>
        </StaggeredItem>

        <StaggeredItem>
          <SettingsCard icon={<Radar className="h-4 w-4" />} title={t('settings.cardAutoDownloads')}>
            <div className="space-y-4">
              <label className="flex cursor-pointer items-center justify-between gap-4 has-[:disabled]:cursor-not-allowed">
                <div>
                  <div className="text-[15px]">{t('settings.enableAutoDownloads')}</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoDownloadsEnabled}
                  onChange={(e) => update({ autoDownloadsEnabled: e.target.checked })}
                  className="switch"
                />
              </label>
              <label className="flex flex-col gap-1.5 md:flex-row md:items-start md:gap-3">
                <span className="text-[15px] md:w-40 md:pt-2">{t('settings.checkFrequency')}</span>
                <div className="md:flex-1">
                  <select
                    value={settings.autoDownloadCheckFrequency}
                    onChange={(e) =>
                      update({
                        autoDownloadCheckFrequency:
                          e.target.value as PublicSettings['autoDownloadCheckFrequency'],
                      })
                    }
                    className="w-full rounded-card bg-[var(--field)] px-4 py-3 pr-10 text-white outline-none focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]"
                  >
                    {AUTO_DOWNLOAD_FREQUENCY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            </div>
          </SettingsCard>
        </StaggeredItem>

        <StaggeredItem>
          <SettingsCard icon={<AntennaSignal className="h-4 w-4" />} title={t('settings.cardAppleApi')}>
            <AppleStatusCard flash={flash} />
          </SettingsCard>
        </StaggeredItem>

        <StaggeredItem>
          <SettingsCard icon={<Wrench className="h-4 w-4" />} title={t('settings.cardLibraryMaintenance')}>
            <div className="space-y-5">
              <TagBackfillCard flash={flash} />
              <div className="border-t border-[var(--line)] pt-5">
                <LyricsBackfillCard flash={flash} />
              </div>
              <div className="border-t border-[var(--line)] pt-5">
                <ArtistBackfillCard flash={flash} />
              </div>
            </div>
          </SettingsCard>
        </StaggeredItem>

        <StaggeredItem>
          <SettingsCard icon={<ShieldCheck className="h-4 w-4" />} title={t('settings.cardAccount')}>
            <AccountSection onFlash={flash} />
          </SettingsCard>
        </StaggeredItem>

        <StaggeredItem>
          <SettingsCard icon={<Plug className="h-4 w-4" />} title={t('settings.cardIntegrations')}>
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="text-sm font-semibold text-white/80">Navidrome</div>
                <NavidromeForm settings={settings} onChange={reload} onFlash={flash} />
              </div>
              <div className="border-t border-[var(--line)]" />
              <div className="space-y-3">
                <div className="text-sm font-semibold text-white/80">octo-fiesta</div>
                <OctoIntegrationForm settings={settings} onChange={reload} onFlash={flash} />
              </div>
            </div>
          </SettingsCard>
        </StaggeredItem>

        <StaggeredItem>
          <footer className="pb-1 pt-1 text-center text-xs text-quiet">
            {t('settings.builtBy')}{' '}
            <a
              href="https://github.com/sosjalapeno"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              sosjalapeno
            </a>
          </footer>
        </StaggeredItem>
      </StaggeredList>
    </>
  )
}

// The look, as nori's Appearance has it: the four season tiles (each its season's paper with its kanji in
// its accent and its name under it, the one worn ringed in that accent; picking one stops following the
// calendar), Follow the calendar, then System, Day, Night or Midnight.
function AppearanceSection({
  settings,
  update,
}: {
  settings: PublicSettings
  update: (patch: Partial<PublicSettings>) => void
}) {
  const { t, i18n } = useTranslation()
  const look = useLook()
  const now = calendarNow()
  const following = settings.season === 'follow'
  const worn = following ? now.season : settings.season
  const set = (patch: Partial<Pick<PublicSettings, 'season' | 'appearance'>>) => {
    setLook(patch)
    update(patch)
  }
  const nextDate = new Date(2001, now.nextMonth - 1, now.nextDay).toLocaleDateString(i18n.language, {
    day: 'numeric',
    month: 'long',
  })
  return (
    <section>
      <h2 className="group-label !mt-0 flex items-center gap-2 [&_svg]:h-3.5 [&_svg]:w-3.5">
        <Palette />
        {t('settings.appearance')}
      </h2>
      <div className="mb-2.5 flex gap-2.5" role="radiogroup" aria-label={t('settings.season')}>
        {seasonTiles().map((tile) => {
          const on = worn === tile.season
          return (
            <button
              key={tile.season}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => (!on || following) && set({ season: tile.season })}
              className={cx('flex min-w-0 flex-1 flex-col items-center gap-1.5 text-quiet', on && '!text-white')}
            >
              <span
                className="grid h-[72px] self-stretch place-items-center rounded-tile"
                style={{
                  background: tile.page,
                  color: tile.accent,
                  boxShadow: `inset 0 0 0 ${on ? '2px' : 'var(--hairline)'} ${on ? tile.accent : 'var(--hair)'}`,
                }}
              >
                <SeasonMark season={tile.season} className="h-8 w-8" />
              </span>
              <span className="max-w-full truncate text-xs font-medium">{t(`settings.seasons.${tile.season}`)}</span>
            </button>
          )
        })}
      </div>
      <div className="grouped">
        <label className="group-row cursor-pointer justify-between">
          <span className="flex min-w-0 flex-col">
            <span className="text-[15px]">{t('settings.seasonFollow')}</span>
            {following && (
              <span className="text-[13px] text-quiet">
                {t('settings.seasonNext', {
                  season: t(`settings.seasons.${now.season}`),
                  next: t(`settings.seasons.${now.next}`),
                  date: nextDate,
                })}
              </span>
            )}
          </span>
          <input
            type="checkbox"
            className="switch"
            checked={following}
            onChange={(e) => set({ season: e.target.checked ? 'follow' : now.season })}
          />
        </label>
        <div className="group-row flex-col !items-stretch gap-2.5 py-3">
          <span className="text-[15px]">{t('settings.theme')}</span>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t('settings.theme')}>
            {(['system', 'day', 'night', 'midnight'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={look.appearance === id}
                className={cx('chip', look.appearance === id && 'on')}
                onClick={() => look.appearance !== id && set({ appearance: id })}
              >
                {t(`settings.appearances.${id}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function SettingsCard({
  title,
  icon,
  children,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="group-label !mt-0 flex items-center gap-2 [&_svg]:h-3.5 [&_svg]:w-3.5">
        {icon}
        {title}
      </h2>
      <div className="grouped px-3.5 py-3.5">{children}</div>
    </section>
  )
}

type LoginPhase =
  | 'idle'
  | 'preparing'
  | 'checking-network'
  | 'creating'
  | 'signing-in'
  | '2fa-required'
  | 'verifying-2fa'
  | 'starting-main'
  | 'ready'
  | 'failed'

function phaseLabel(p: LoginPhase): string {
  switch (p) {
    case 'preparing': return i18n.t('settings.phasePreparing')
    case 'checking-network': return i18n.t('settings.phaseCheckingNetwork')
    case 'creating': return i18n.t('settings.phaseCreating')
    case 'signing-in': return i18n.t('settings.phaseSigningIn')
    case '2fa-required': return i18n.t('settings.phaseTwoFaRequired')
    case 'verifying-2fa': return i18n.t('settings.phaseVerifyingTwoFa')
    case 'starting-main': return i18n.t('settings.phaseStartingMain')
    case 'ready': return i18n.t('settings.phaseReady')
    case 'failed': return i18n.t('settings.phaseFailed')
    default: return ''
  }
}

function AppleCredsForm({
  settings, onChange, disabled, setSaving,
}: {
  settings: PublicSettings
  onChange: () => void
  disabled: boolean
  setSaving: (b: boolean) => void
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phase, setPhase] = useState<LoginPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [failureTail, setFailureTail] = useState<string[]>([])
  const [showFailureTail, setShowFailureTail] = useState(false)
  const [showTwoFa, setShowTwoFa] = useState(false)

  useEventStream((type, data) => {
    if (type !== 'wrapper.login') return
    if (!data?.phase) return
    setPhase(data.phase as LoginPhase)
    if (data.phase === '2fa-required') {
      setShowTwoFa(true)
    } else if (data.phase === 'ready' || data.phase === 'failed' || data.phase === 'verifying-2fa') {
      setShowTwoFa(false)
    }
    if (data.phase === 'failed') {
      setError(data.error || t('settings.phaseFailed'))
      setFailureTail(Array.isArray(data.tail) ? data.tail.map(String) : [])
      setShowFailureTail(false)
      setSaving(false)
    }
    if (data.phase === 'ready') {
      setError(null)
      setFailureTail([])
      setShowFailureTail(false)
      setSaving(false)
      onChange()
    }
  })

  const busy = phase !== 'idle' && phase !== 'ready' && phase !== 'failed'

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setError(null)
    setFailureTail([])
    setShowFailureTail(false)
    setPhase('preparing')
    setSaving(true)
    try {
      const r = await api.saveAppleCreds(email, password, true)
      if (!r.loginStarted) {
        setError(r.loginError || t('settings.couldNotStartSignIn'))
        setPhase('failed')
        setSaving(false)
        return
      }
      onChange()
    } catch (err: any) {
      setError(err?.message || t('settings.failed'))
      setPhase('failed')
      setSaving(false)
    }
  }

  const clear = async () => {
    await api.clearAppleCreds()
    setPhase('idle')
    setError(null)
    onChange()
  }

  const retryLogin = async () => {
    setError(null)
    setPhase('preparing')
    setSaving(true)
    try {
      await api.runAppleLogin()
    } catch (err: any) {
      setError(err?.message || t('settings.failed'))
      setPhase('failed')
      setSaving(false)
    }
  }

  const cancel = async () => {
    try {
      await api.cancelAppleLogin()
    } finally {
      setPhase('idle')
      setShowTwoFa(false)
      setSaving(false)
    }
  }

  useEffect(() => {
    if (phase === 'ready') {
      setEmail('')
      setPassword('')
    }
  }, [phase])

  const hardBlocked = Boolean(settings.hardBlockReason)

  return (
    <>
      <form className="space-y-3" onSubmit={save}>
        {hardBlocked && (
          <div className="rounded-tile border border-rose-400/40 bg-rose-500/[0.08] p-4 space-y-2">
            <div className="flex items-center gap-2 text-rose-300 font-semibold">
              <AlertCircle className="h-4 w-4" />
              {t('settings.appleAccountLocked')}
            </div>
            <div className="text-sm text-white/80">{settings.hardBlockReason}</div>
            <ol className="text-sm text-white/70 list-decimal pl-5 space-y-1">
              <li>
                {t('settings.resetPasswordAt')}{' '}
                <a href="https://iforgot.apple.com" target="_blank" rel="noopener noreferrer" className="underline">iforgot.apple.com</a>.
              </li>
              <li>{t('settings.signInOnTrustedDevice')}</li>
              <li>{t('settings.waitThenClear', { clear: t('settings.clear') })}</li>
            </ol>
            <p className="text-xs text-quiet">
              {t('settings.lockoutWarning')}
            </p>
          </div>
        )}

        {settings.hasAppleCreds ? (
          <div className="text-sm text-white/70">
            {t('settings.current')} <span className="text-white">{settings.appleEmailMasked}</span>
          </div>
        ) : (
          <div className="text-sm text-quiet">
            {t('settings.noAppleCredsStored')}
          </div>
        )}
        <div className="grid gap-2 md:grid-cols-2">
          <Input type="email" placeholder={t('settings.appleIdEmail')} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
          <Input type="password" placeholder={t('settings.password')} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
        </div>
        <div className="flex gap-2 flex-wrap min-h-[40px]">
          <AnimatePresence initial={false} mode="popLayout">
            {(busy || (email && password && !hardBlocked) || !settings.hasAppleCreds) && (
              <motion.div
                key="save"
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
                <Button
                  type="submit"
                  disabled={disabled || busy || !email || !password || hardBlocked}
                  title={hardBlocked ? t('settings.clearLockoutFirst') : t('settings.saveCredentials')}
                >
                  {busy ? t('settings.signingIn') : t('settings.saveAndSignIn')}
                </Button>
              </motion.div>
            )}
            {settings.hasAppleCreds && !busy && (
              <motion.div
                key="creds-actions"
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="flex gap-2"
              >
                {!hardBlocked && <Button onClick={retryLogin}>{t('settings.reRunSignIn')}</Button>}
                <Button onClick={clear}>{t('settings.clear')}</Button>
              </motion.div>
            )}
            {busy && (
              <motion.div
                key="cancel"
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
                <Button onClick={cancel}>{t('settings.cancel')}</Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {error && (
          <Badge variant="bad" className="max-w-full">
            <span className="truncate">{error}</span>
          </Badge>
        )}
        {error && (
          <div className="-mt-1 ml-0.5 text-xs text-quiet">
            <a
              href="https://github.com/sosjalapeno/alacarte#sign-in-troubleshooting"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {t('settings.troubleshooting')}
            </a>
          </div>
        )}
        {phase === 'failed' && failureTail.length > 0 && (
          <div className="space-y-2 rounded-tile border-hair bg-white/[0.02] p-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowFailureTail((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs text-white/70 hover:text-white"
              >
                {showFailureTail ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {t('settings.showWrapperLog')}
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(failureTail.join('\n'))
                  } catch { }
                }}
                className="inline-flex items-center gap-1.5 text-xs text-quiet hover:text-white"
              >
                <Copy className="h-3.5 w-3.5" />
                {t('settings.copy')}
              </button>
            </div>
            {showFailureTail && (
              <pre className="max-h-52 overflow-auto rounded-tile border-hair bg-[var(--field)] px-3 py-2 text-[11px] leading-5 text-white/80 font-mono whitespace-pre-wrap break-words">
                {/* Backend already redacts Apple email/password to [redacted-email]/[redacted-password]. */}
                {failureTail.join('\n')}
              </pre>
            )}
          </div>
        )}
        {!error && phase !== 'idle' && phase !== 'failed' && (
          <Badge variant={phase === 'ready' ? 'ok' : 'accent'} className="max-w-full">
            <span className="truncate">{phaseLabel(phase)}</span>
          </Badge>
        )}

      </form>
      {showTwoFa && (
        <TwoFaModal onClose={() => setShowTwoFa(false)} onCancel={cancel} />
      )}
    </>
  )
}

function TwoFaModal({ onClose, onCancel }: { onClose: () => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleaned = code.replace(/\D/g, '')
    if (cleaned.length !== 6) {
      setErr(t('settings.enterSixDigitCode'))
      return
    }
    setErr(null)
    setSubmitting(true)
    try {
      await api.submitAppleTwoFa(cleaned)
      onClose()
    } catch (e: any) {
      setErr(e?.message || t('settings.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={true} onClose={onCancel} className="max-w-sm p-6" label={t('settings.twoFactorCode')}>
      <h3 className="text-lg font-semibold mb-1">{t('settings.twoFactorCode')}</h3>
      <p className="text-sm text-quiet mb-4">
        {t('settings.twoFactorCodeHelp')}
      </p>
      <form onSubmit={submit} className="space-y-3">
        <Input
          ref={inputRef}
          inputMode="numeric"
          pattern="\d*"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="••••••"
          className="tracking-[0.5em] text-center text-xl"
          value={code}
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
          }
          disabled={submitting}
        />
        {err && (
          <Badge variant="bad" className="max-w-full">
            <span className="truncate">{err}</span>
          </Badge>
        )}
        <div className="flex gap-2 justify-end">
          <Button onClick={onCancel} disabled={submitting}>{t('settings.cancelSignIn')}</Button>
          <Button type="submit" disabled={submitting || code.replace(/\D/g, '').length !== 6}>
            {submitting ? t('settings.verifying') : t('settings.verify')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function MediaUserTokenForm({ settings, onChange }: { settings: PublicSettings; onChange: () => void }) {
  const { t } = useTranslation()
  const [token, setToken] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    try {
      await api.saveMediaUserToken(token)
      setToken('')
      setMsg(t('settings.saved'))
      onChange()
    } catch (err: any) {
      setMsg(t('settings.errorPrefix', { message: err.message }))
    }
  }
  const clear = async () => {
    await api.clearMediaUserToken()
    setMsg(t('settings.cleared'))
    onChange()
  }

  return (
    <form className="space-y-3" onSubmit={save}>
      <div className="text-sm text-quiet">
        {t('settings.mediaTokenHelpPre')}{' '}
        <a href="https://music.apple.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">music.apple.com</a>
        {t('settings.mediaTokenHelpPost')}
      </div>
      {settings.hasMediaUserToken && (
        <div className="text-sm text-emerald-400">{t('settings.currentlyStored')}</div>
      )}
      <Input type="password" placeholder={t('settings.pasteMediaToken')} value={token} onChange={(e) => setToken(e.target.value)} />
      <div className="flex gap-2 flex-wrap min-h-[40px]">
        <AnimatePresence initial={false} mode="popLayout">
          {token && (
            <motion.div
              key="save"
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              <Button type="submit">{t('settings.saveToken')}</Button>
            </motion.div>
          )}
          {settings.hasMediaUserToken && (
            <motion.div
              key="clear"
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              <Button onClick={clear}>{t('settings.clear')}</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {msg && <div className="text-xs text-quiet">{msg}</div>}
    </form>
  )
}

function NavidromeForm({ settings, onChange, onFlash }: { settings: PublicSettings; onChange: () => void; onFlash: (msg: string, err?: boolean) => void }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(settings.navidromeEnabled ?? false)
  const [url, setUrl] = useState(settings.navidromeUrl || 'http://navidrome:4533')
  const [user, setUser] = useState(settings.navidromeUser || '')
  const [password, setPassword] = useState('')

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const patch: any = { navidromeEnabled: enabled, navidromeUrl: url, navidromeUser: user }
      if (password) {
        patch.navidromePassword = password
      }
      await api.saveSettings(patch)
      onFlash(t('settings.saved'))
      setPassword('')
      onChange()
    } catch (err: any) {
      onFlash(t('settings.errorPrefix', { message: err.message }), true)
    }
  }

  return (
    <form className="space-y-4" onSubmit={save}>
      <label className="flex cursor-pointer items-center justify-between gap-4 has-[:disabled]:cursor-not-allowed">
        <div>
          <div className="text-[15px]">{t('settings.enableNavidromeScan')}</div>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="switch"
        />
      </label>

      {enabled && (
        <div className="space-y-3 pt-2">
          {settings.hasNavidromeCreds ? (
            <div className="text-sm text-white/70">
              {t('settings.current')} <span className="text-white">{settings.navidromeUser}</span>
            </div>
          ) : (
            <div className="text-sm text-quiet">
              {t('settings.noNavidromeCredsStored')}
            </div>
          )}
          <Input
            type="url"
            placeholder={t('settings.navidromeUrl')}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="grid gap-2 md:grid-cols-2">
            <Input
              type="text"
              placeholder={t('settings.username')}
              autoComplete="username"
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
            <Input
              type="password"
              placeholder={t('settings.password')}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex gap-2 flex-wrap min-h-[40px]">
        <Button type="submit">{t('settings.saveNavidromeSettings')}</Button>
      </div>
    </form>
  )
}

const OCTO_FIESTA_URL = 'https://github.com/filipton/octo-fiesta'

function OctoIntegrationForm({ settings, onChange, onFlash }: { settings: PublicSettings; onChange: () => void; onFlash: (msg: string, err?: boolean) => void }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(settings.octoIntegrationEnabled ?? false)
  const [token, setToken] = useState<string | null>(null)
  const [shown, setShown] = useState(false)
  const alacarteUrl = window.location.origin

  const toggle = async (next: boolean) => {
    try {
      await api.saveSettings({ octoIntegrationEnabled: next })
      setEnabled(next)
      setToken(null)
      setShown(false)
      onChange()
      onFlash(next ? t('settings.octoIntegrationOn') : t('settings.octoIntegrationOff'))
    } catch (err: any) {
      onFlash(t('settings.errorPrefix', { message: err.message }), true)
    }
  }

  const loadToken = async () => token ?? (await api.octoIntegrationToken()).token

  const reveal = async () => {
    try {
      if (!shown) setToken(await loadToken())
      setShown(!shown)
    } catch (err: any) {
      onFlash(t('settings.errorPrefix', { message: err.message }), true)
    }
  }

  const copy = async () => {
    try {
      const tok = await loadToken()
      setToken(tok)
      if (!tok) return
      try {
        await navigator.clipboard.writeText(tok)
        onFlash(t('settings.tokenCopied'))
      } catch {
        // clipboard needs https or localhost
        onFlash(t('settings.copyBlocked'), true)
      }
    } catch (err: any) {
      onFlash(t('settings.errorPrefix', { message: err.message }), true)
    }
  }

  const regenerate = async () => {
    try {
      const r = await api.regenerateOctoIntegrationToken()
      setToken(r.token)
      setShown(true)
      onFlash(t('settings.newTokenRegenerated'))
    } catch (err: any) {
      onFlash(t('settings.errorPrefix', { message: err.message }), true)
    }
  }

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-center justify-between gap-4 has-[:disabled]:cursor-not-allowed">
        <div>
          <div className="text-[15px]">{t('settings.letOctoFiestaUseAlacarte')}</div>
          <div className="text-xs text-quiet mt-0.5">
            <a href={OCTO_FIESTA_URL} target="_blank" rel="noreferrer" className="underline hover:text-white">
              {t('settings.octoFiestaLinkText')}
            </a>{' '}
            {t('settings.octoFiestaDescription')}
          </div>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggle(e.target.checked)}
          className="switch"
        />
      </label>

      {enabled && (
        <div className="space-y-3 pt-2">
          <div className="text-xs text-quiet">
            {t('settings.octoFiestaSetupHint')}
          </div>
          <pre className="overflow-x-auto rounded-card border-hair bg-[var(--field)] p-3 text-xs text-white/80 select-all">
{`AppleMusic__AlacarteUrl=${alacarteUrl}
AppleMusic__ApiToken=${shown && token ? token : '••••••••••••••••'}`}
          </pre>
          <div className="flex gap-2 flex-wrap">
            <Button type="button" variant="ghost" onClick={reveal}>{shown ? t('settings.hideToken') : t('settings.showToken')}</Button>
            <Button type="button" variant="ghost" onClick={copy}>{t('settings.copyToken')}</Button>
            <Button type="button" variant="ghost" onClick={regenerate}>{t('settings.regenerateToken')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}

const PASSWORD_MIN = 12
const USERNAME_MIN = 2
const USERNAME_MAX = 32
const USERNAME_REGEX = /^[a-zA-Z0-9._-]+$/

function AccountSection({ onFlash }: { onFlash: (msg: string, err?: boolean) => void }) {
  const { t } = useTranslation()
  const [username, setUsername] = useState<string | null>(null)
  const [showRevoke, setShowRevoke] = useState(false)
  const [revokePassword, setRevokePassword] = useState('')
  const [revoking, setRevoking] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await api.authLogout()
    } catch {
      // ignore — reload regardless so the auth gate shows
    }
    window.location.reload()
  }

  useEffect(() => {
    api
      .authState()
      .then((s) => setUsername(s.username))
      .catch(() => { })
  }, [])

  return (
    <motion.div
      layout
      transition={{ layout: { type: 'spring', stiffness: 380, damping: 32 } }}
      className="space-y-6"
    >
      {username && (
        <div className="flex items-center gap-3 rounded-tile border-hair bg-white/[0.025] px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
            <UserIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-quiet">{t('settings.signedInAs')}</div>
            <div className="text-sm font-medium text-white truncate">{username}</div>
          </div>
        </div>
      )}

      <ChangeUsernameForm
        currentUsername={username}
        onUpdated={(name) => {
          setUsername(name)
          onFlash(t('settings.usernameUpdated'))
        }}
      />

      <div className="border-t border-[var(--line)]" />

      <ChangePasswordForm onUpdated={() => onFlash(t('settings.passwordUpdated'))} />

      <div className="border-t border-[var(--line)]" />

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setConfirmSignOut(true)}>{t('nav.signOut')}</Button>
          <Button
            onClick={() => {
              setShowRevoke((v) => !v)
              setRevokeError(null)
            }}
          >
            {t('settings.signOutOnAllDevices')}
          </Button>
        </div>
        {showRevoke && (
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!revokePassword || revoking) return
              setRevoking(true)
              setRevokeError(null)
              try {
                await api.authRevokeAll(revokePassword)
                setRevokePassword('')
                setShowRevoke(false)
                onFlash(t('settings.signedOutOnAllOtherDevices'))
              } catch (err: any) {
                setRevokeError(err?.message || t('settings.failedToRevokeSessions'))
              } finally {
                setRevoking(false)
              }
            }}
            className="space-y-2"
          >
            <Input
              type="password"
              placeholder={t('settings.currentPassword')}
              value={revokePassword}
              onChange={(e) => {
                setRevokePassword(e.target.value)
                if (revokeError) setRevokeError(null)
              }}
              autoComplete="current-password"
              disabled={revoking}
            />
            {revokeError && <div className="text-xs text-rose-300">{revokeError}</div>}
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={revoking || !revokePassword}>
                {revoking ? t('settings.revoking') : t('settings.confirmSignOutEverywhere')}
              </Button>
              <Button
                onClick={() => {
                  setShowRevoke(false)
                  setRevokePassword('')
                  setRevokeError(null)
                }}
                disabled={revoking}
              >
                {t('settings.cancel')}
              </Button>
            </div>
          </form>
        )}
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
            <Button onClick={signOut} disabled={signingOut} variant="ghost" className="!text-rose-500">
              {signingOut ? 'Signing out…' : t('nav.signOut')}
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  )
}

function ChangeUsernameForm({
  currentUsername,
  onUpdated,
}: {
  currentUsername: string | null
  onUpdated: (newUsername: string) => void
}) {
  const { t } = useTranslation()
  const [next, setNext] = useState('')
  const [pw, setPw] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const trimmed = next.trim()
  const tooShort = trimmed.length > 0 && trimmed.length < USERNAME_MIN
  const tooLong = trimmed.length > USERNAME_MAX
  const badChars = trimmed.length > 0 && !USERNAME_REGEX.test(trimmed)
  const sameAsCurrent = currentUsername != null && trimmed === currentUsername
  const valid =
    trimmed.length >= USERNAME_MIN && trimmed.length <= USERNAME_MAX && !badChars && !sameAsCurrent
  const canSubmit = !submitting && valid && pw.length > 0

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setErr(null)
    setSubmitting(true)
    try {
      const res = await api.authChangeUsername(pw, trimmed)
      setNext('')
      setPw('')
      onUpdated(res.username)
    } catch (e: any) {
      setErr(e?.message || t('settings.failedToChangeUsername'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="text-sm font-medium text-white/85">{t('settings.changeUsername')}</div>
      <div className="grid gap-3 md:grid-cols-2">
        <Input
          type="text"
          placeholder={t('settings.newUsername')}
          value={next}
          onChange={(e) => {
            setNext(e.target.value)
            if (err) setErr(null)
          }}
          autoComplete="username"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          disabled={submitting}
          className={cx(
            (tooShort || tooLong || badChars) &&
            'border-rose-400/50 focus:border-rose-400/70',
          )}
        />
        <Input
          type="password"
          placeholder={t('settings.currentPassword')}
          value={pw}
          onChange={(e) => {
            setPw(e.target.value)
            if (err) setErr(null)
          }}
          autoComplete="current-password"
          disabled={submitting}
        />
      </div>
      <HintSlot
        hint={
          err
            ? { tone: 'error', text: err }
            : badChars
              ? { tone: 'warn', text: t('settings.usernameBadChars') }
              : tooShort
                ? { tone: 'warn', text: t('settings.usernameTooShort', { min: USERNAME_MIN }) }
                : tooLong
                  ? { tone: 'warn', text: t('settings.usernameTooLong', { max: USERNAME_MAX }) }
                  : sameAsCurrent
                    ? { tone: 'dim', text: t('settings.pickDifferentUsername') }
                    : null
        }
      />
      <div>
        <Button
          type="submit"
          className={cx(!canSubmit && 'opacity-50 cursor-not-allowed pointer-events-none')}
          disabled={!canSubmit}
        >
          {submitting ? t('settings.saving') : t('settings.changeUsername')}
        </Button>
      </div>
    </form>
  )
}

function ChangePasswordForm({ onUpdated }: { onUpdated: () => void }) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const tooShort = next.length > 0 && next.length < PASSWORD_MIN
  const mismatch = confirm.length > 0 && confirm !== next
  const canSubmit =
    !submitting &&
    current.length > 0 &&
    next.length >= PASSWORD_MIN &&
    confirm === next

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setErr(null)
    setSubmitting(true)
    try {
      await api.authChangePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      onUpdated()
    } catch (e: any) {
      setErr(e?.message || t('settings.failedToChangePassword'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="text-sm font-medium text-white/85">{t('settings.changePassword')}</div>
      <div className="grid gap-3 md:grid-cols-3">
        <Input
          type="password"
          placeholder={t('settings.currentPassword')}
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value)
            if (err) setErr(null)
          }}
          autoComplete="current-password"
          disabled={submitting}
        />
        <Input
          type="password"
          placeholder={t('settings.newPassword')}
          value={next}
          onChange={(e) => {
            setNext(e.target.value)
            if (err) setErr(null)
          }}
          autoComplete="new-password"
          disabled={submitting}
          className={cx(
            tooShort &&
            'border-rose-400/50 focus:border-rose-400/70',
          )}
        />
        <Input
          type="password"
          placeholder={t('settings.confirmNewPassword')}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          disabled={submitting}
          className={cx(
            mismatch &&
            'border-rose-400/50 focus:border-rose-400/70',
          )}
        />
      </div>
      <HintSlot
        hint={
          err
            ? { tone: 'error', text: err }
            : tooShort
              ? { tone: 'warn', text: t('settings.passwordTooShort', { min: PASSWORD_MIN }) }
              : mismatch
                ? { tone: 'warn', text: t('settings.passwordsDontMatch') }
                : null
        }
      />
      <div>
        <Button
          type="submit"
          className={cx(!canSubmit && 'opacity-50 cursor-not-allowed pointer-events-none')}
          disabled={!canSubmit}
        >
          {submitting ? t('settings.saving') : t('settings.changePassword')}
        </Button>
      </div>
    </form>
  )
}

type HintTone = 'dim' | 'warn' | 'error'

const HINT_TONE: Record<HintTone, string> = {
  dim: 'text-quiet',
  warn: 'text-amber-300/85',
  error: 'text-rose-300',
}

function HintSlot({ hint }: { hint: { tone: HintTone; text: string } | null }) {
  return (
    <AnimatePresence initial={false}>
      {hint && (
        <motion.div
          key="hint-slot"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          style={{ overflow: 'hidden' }}
        >
          <div className={cx('pt-1 text-xs', HINT_TONE[hint.tone])}>{hint.text}</div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

type BackfillStatusBase = {
  running: boolean
  phase?: 'idle' | 'scanning' | 'matching' | 'waiting' | 'done'
  scanned: number
  total: number
  albumsDone?: number
  albumsTotal?: number
  appleCalls?: number
  waitingUntil?: number | null
  current: string | null
  finishedAt: number | null
  stopRequested: boolean
}

// "12 min" / "40 s" for a wait that ends at `until` (epoch ms).
function useWaitLabel(until: number | null | undefined) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!until) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [until])
  if (!until) return null
  const seconds = Math.max(0, Math.round((until - now) / 1000))
  return seconds >= 90
    ? t('settings.timeMinutes', { count: Math.round(seconds / 60) })
    : t('settings.timeSeconds', { count: seconds })
}

function BackfillCard<S extends BackfillStatusBase>({
  flash,
  icon: Icon,
  title,
  description,
  actionLabel,
  confirmTitle,
  startedMessage,
  load,
  start: startRun,
  stop: stopRun,
  badges,
}: {
  flash: (msg: string) => void
  icon: typeof Tags
  title: string
  description: string
  actionLabel: string
  confirmTitle: string
  startedMessage: string
  load: () => Promise<S>
  start: () => Promise<S>
  stop: () => Promise<unknown>
  badges: (status: S, finished: boolean) => React.ReactNode
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<S | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    load().then(setStatus).catch(() => {})
  }, [load])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!status?.running) return
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [status?.running, refresh])

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await startRun())
      setConfirmOpen(false)
      flash(startedMessage)
    } catch (err: any) {
      setError(err?.message || t('settings.failedToStartBackfill'))
      setConfirmOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true)
    try {
      await stopRun()
    } catch {}
    setBusy(false)
    refresh()
  }

  const running = Boolean(status?.running)
  const waitLabel = useWaitLabel(running ? status?.waitingUntil : null)
  const pct =
    status && status.total > 0
      ? Math.min(100, Math.round((status.scanned / status.total) * 100))
      : 0

  return (
    <section>
      <div className="space-y-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Icon className="h-4 w-4 text-quiet" />
            {title}
          </div>
          <div className="mt-1 text-[13px] text-quiet">{description}</div>
        </div>

        {running && (
          <div className="space-y-2">
            <ProgressBar
              value={status!.phase === 'scanning' ? 0 : pct}
              label={
                status!.phase === 'scanning'
                  ? t('settings.backfillScanning', { count: status!.total })
                  : t('settings.backfillProgress', { pct, scanned: status!.scanned, total: status!.total })
              }
            />
            {status!.waitingUntil && (
              <div className="text-xs text-amber-200/80">
                {t('settings.backfillWaitingApple', { time: waitLabel })}
              </div>
            )}
            {!!status!.albumsTotal && (
              <div className="text-xs text-quiet">
                {t('settings.backfillAlbums', {
                  done: status!.albumsDone ?? 0,
                  total: status!.albumsTotal,
                  calls: status!.appleCalls ?? 0,
                })}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">{badges(status!, false)}</div>
            {status!.current && (
              <div
                className="truncate text-xs text-quiet"
                title={status!.current}
              >
                {status!.current}
              </div>
            )}
            {status!.stopRequested && (
              <div className="text-xs text-quiet">
                {t('settings.stoppingAfterCurrentFile')}
              </div>
            )}
          </div>
        )}

        {!running && status?.finishedAt && (
          <div className="flex flex-wrap items-center gap-1.5">{badges(status, true)}</div>
        )}

        {error && <Badge variant="bad">{error}</Badge>}

        <div>
          {running ? (
            <Button
              onClick={stop}
              disabled={busy || status!.stopRequested}
              variant="ghost" className="!text-rose-500"
            >
              {status!.stopRequested ? t('settings.stopping') : t('settings.stopBackfill')}
            </Button>
          ) : (
            <Button onClick={() => setConfirmOpen(true)}>
              <Icon className="h-4 w-4" />
              {actionLabel}
            </Button>
          )}
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        label={actionLabel}
        placement="center"
        className="!max-w-[36rem]"
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center text-quiet">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-quiet">
                {actionLabel}
              </div>
              <h2 className="mt-1 text-lg font-semibold text-white">
                {confirmTitle}
              </h2>
            </div>
          </div>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              onClick={() => setConfirmOpen(false)}
              disabled={busy}
              variant="ghost"
            >
              {t('settings.cancel')}
            </Button>
            <Button onClick={start} disabled={busy}>
              <Icon className="h-4 w-4" />
              {busy ? t('settings.starting') : t('settings.startBackfill')}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  )
}

function AppleStatusCard({ flash }: { flash: (msg: string, err?: boolean) => void }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<AppleStatus | null>(null)
  const [form, setForm] = useState<{ interval: string; min: string; adaptive: boolean; pace: boolean; cooldown: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    () =>
      api
        .appleStatus()
        .then((s) => {
          setStatus(s)
          setForm(
            (prev) =>
              prev ?? {
                interval: String(s.config.intervalMs / 1000),
                min: String(s.config.minIntervalMs / 1000),
                adaptive: s.config.adaptive,
                pace: s.config.paceIntegration,
                cooldown: String(s.config.cooldownMinutes),
              },
          )
        })
        .catch(() => {}),
    [],
  )

  useEffect(() => {
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [load])

  if (!status || !form) return null

  const minutes = Math.max(1, Math.round(status.cooldownSeconds / 60))
  const wait =
    status.cooldownSeconds >= 90
      ? t('settings.timeMinutes', { count: minutes })
      : t('settings.timeSeconds', { count: status.cooldownSeconds })

  const save = async (next: typeof form, reread = false) => {
    setBusy(true)
    try {
      await api.saveSettings({
        appleGatewayIntervalMs: Math.round(Number(next.interval) * 1000) || null,
        appleGatewayMinIntervalMs: Math.round(Number(next.min) * 1000) || null,
        appleGatewayAdaptive: next.adaptive,
        appleGatewayPaceIntegration: next.pace,
        appleGatewayCooldownMinutes: Math.round(Number(next.cooldown)) || null,
      })
      if (reread) setForm(null)
      await load()
      flash(t('settings.saved'))
    } catch (err: any) {
      flash(t('settings.errorPrefix', { message: err.message }), true)
    } finally {
      setBusy(false)
    }
  }

  const change = (patch: Partial<typeof form>) => {
    const next = { ...form, ...patch }
    setForm(next)
    save(next)
  }

  const saveNumbers = () => {
    const c = status.config
    const same =
      Math.round(Number(form.interval) * 1000) === c.intervalMs &&
      Math.round(Number(form.min) * 1000) === c.minIntervalMs &&
      Math.round(Number(form.cooldown)) === c.cooldownMinutes
    if (!same) save(form, true)
  }

  const numberProps = {
    onBlur: saveNumbers,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') e.currentTarget.blur()
    },
  }

  const toggle = async (on: boolean) => {
    setBusy(true)
    try {
      await api.saveSettings({ appleGatewayEnabled: on })
      await load()
      flash(t('settings.saved'))
    } catch (err: any) {
      flash(t('settings.errorPrefix', { message: err.message }), true)
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      setStatus(await api.resetApplePace())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label className="flex cursor-pointer items-center justify-between gap-4 has-[:disabled]:cursor-not-allowed">
        <div>
          <div className="text-[15px]">{t('settings.appleLimitLabel')}</div>
        </div>
        <input
          type="checkbox"
          checked={status.config.enabled}
          disabled={busy}
          onChange={(e) => toggle(e.target.checked)}
          className="switch"
        />
      </label>
      <AnimatePresence initial={false}>
        {status.config.enabled && (
          <motion.div
            key="apple-limit"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="space-y-4 pt-4">
            <div className="space-y-2.5">
              <Badge variant={status.state === 'ok' ? 'ok' : status.state === 'cooldown' ? 'bad' : 'warn'}>
                {status.state === 'cooldown'
                  ? t('settings.appleStatusCooldown', { time: wait })
                  : status.state === 'probing'
                    ? t('settings.appleStatusProbing')
                    : t('settings.appleStatusOk')}
              </Badge>
              <div className="text-[13px] text-quiet">
                {t('settings.applePace', { seconds: (status.intervalMs / 1000).toFixed(1) })}
              </div>
              <div className="text-[13px] text-quiet">{t('settings.appleQueued', status.queued)}</div>
              {status.rateLimited24h > 0 && (
                <div className="text-[13px] text-amber-200/80">
                  {t('settings.appleRateLimited24h', { count: status.rateLimited24h })}
                </div>
              )}
              {status.learnedFloorMs > 0 && (
                <div className="flex flex-wrap items-center gap-3 text-[13px] text-quiet">
                  <span>{t('settings.appleLearnedFloor', { seconds: (status.learnedFloorMs / 1000).toFixed(1) })}</span>
                  <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
                    {t('settings.appleResetLearned')}
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1 text-sm text-white/70">
                  <span>{t('settings.appleIntervalLabel')}</span>
                  <Input type="number" min="0.1" max="30" step="0.1" value={form.interval}
                    onChange={(e) => setForm({ ...form, interval: e.target.value })} {...numberProps} />
                </label>
                <label className="space-y-1 text-sm text-white/70">
                  <span>{t('settings.appleMinIntervalLabel')}</span>
                  <Input type="number" min="0.1" max="30" step="0.1" value={form.min}
                    onChange={(e) => setForm({ ...form, min: e.target.value })} {...numberProps} />
                </label>
                <label className="space-y-1 text-sm text-white/70">
                  <span>{t('settings.appleCooldownLabel')}</span>
                  <Input type="number" min="1" max="240" step="1" value={form.cooldown}
                    onChange={(e) => setForm({ ...form, cooldown: e.target.value })} {...numberProps} />
                </label>
              </div>
              <label className="flex cursor-pointer items-center justify-between gap-4 has-[:disabled]:cursor-not-allowed">
                <span className="text-sm text-white/70">{t('settings.appleAdaptiveLabel')}</span>
                <input
                  type="checkbox"
                  checked={form.adaptive}
                  onChange={(e) => change({ adaptive: e.target.checked })}
                  className="switch"
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-4 has-[:disabled]:cursor-not-allowed">
                <span className="text-sm text-white/70">{t('settings.appleLimitIntegrationLabel')}</span>
                <input
                  type="checkbox"
                  checked={form.pace}
                  onChange={(e) => change({ pace: e.target.checked })}
                  className="switch"
                />
              </label>
            </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function TagBackfillCard({ flash }: { flash: (msg: string) => void }) {
  const { t } = useTranslation()
  return (
    <BackfillCard<TagBackfillStatus>
      flash={flash}
      icon={Tags}
      title={t('settings.cardLibraryTags')}
      description={t('settings.libraryTagsDescription')}
      actionLabel={t('settings.backfillLibraryTags')}
      confirmTitle={t('settings.scanLibraryForMissingTags')}
      startedMessage={t('settings.tagBackfillStarted')}
      load={api.tagBackfillStatus}
      start={() => api.startTagBackfill(false)}
      stop={api.stopTagBackfill}
      badges={(s, finished) => (
        <>
          <Badge variant="ok">
            {finished
              ? t('settings.lastRunStamped', { count: s.stamped })
              : t('settings.stampedCount', { count: s.stamped })}
          </Badge>
          <Badge>{t('settings.alreadyTaggedCount', { count: s.skipped })}</Badge>
          <Badge variant="warn">{t('settings.unmatchedCount', { count: s.noMatch })}</Badge>
          {s.failed > 0 && <Badge variant="bad">{t('settings.failedCount', { count: s.failed })}</Badge>}
        </>
      )}
    />
  )
}

function LyricsBackfillCard({ flash }: { flash: (msg: string) => void }) {
  const { t } = useTranslation()
  return (
    <BackfillCard<LyricsBackfillStatus>
      flash={flash}
      icon={MicVocal}
      title={t('settings.cardLyrics')}
      description={t('settings.lyricsBackfillDescription')}
      actionLabel={t('settings.backfillLyrics')}
      confirmTitle={t('settings.scanLibraryForMissingLyrics')}
      startedMessage={t('settings.lyricsBackfillStarted')}
      load={api.lyricsBackfillStatus}
      start={api.startLyricsBackfill}
      stop={api.stopLyricsBackfill}
      badges={(s, finished) => (
        <>
          <Badge variant="ok">
            {finished
              ? t('settings.lastRunLyricsAdded', { count: s.added })
              : t('settings.lyricsAddedCount', { count: s.added })}
          </Badge>
          {!!s.converted && <Badge variant="ok">{t('settings.lyricsConvertedCount', { count: s.converted })}</Badge>}
          <Badge>{t('settings.alreadyHaveLyricsCount', { count: s.skipped })}</Badge>
          <Badge>{t('settings.noAppleLyricsCount', { count: s.noLyrics })}</Badge>
          <Badge variant="warn">{t('settings.unmatchedCount', { count: s.noMatch })}</Badge>
          {s.failed > 0 && <Badge variant="bad">{t('settings.failedCount', { count: s.failed })}</Badge>}
        </>
      )}
    />
  )
}

function ArtistBackfillCard({ flash }: { flash: (msg: string) => void }) {
  const { t } = useTranslation()
  return (
    <BackfillCard<ArtistBackfillStatus>
      flash={flash}
      icon={Users}
      title={t('settings.cardArtistCredits')}
      description={t('settings.artistBackfillDescription')}
      actionLabel={t('settings.backfillArtists')}
      confirmTitle={t('settings.scanLibraryForArtistCredits')}
      startedMessage={t('settings.artistBackfillStarted')}
      load={api.artistBackfillStatus}
      start={api.startArtistBackfill}
      stop={api.stopArtistBackfill}
      badges={(s, finished) => (
        <>
          <Badge variant="ok">
            {finished
              ? t('settings.lastRunArtistsUpdated', { count: s.updated })
              : t('settings.artistsUpdatedCount', { count: s.updated })}
          </Badge>
          <Badge>{t('settings.alreadyCorrectCount', { count: s.skipped })}</Badge>
          <Badge variant="warn">{t('settings.unmatchedCount', { count: s.noMatch })}</Badge>
          {s.failed > 0 && <Badge variant="bad">{t('settings.failedCount', { count: s.failed })}</Badge>}
        </>
      )}
    />
  )
}
