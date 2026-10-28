import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Xmark as X,
  TaskList as ListChecks,
  CompactDisc as Disc3,
  MusicNote as Music2,
  CompactDisc as AlbumIcon,
} from 'iconoir-react'
import { useTranslation } from 'react-i18next'

import { api, artworkUrl, type Album, type QualityPreference } from '../api/client'
import { stripYear } from '../lib/format'
import { cx } from '../lib/cx'
import { useAppSettings } from '../hooks/useAppSettings'
import { Modal } from './Modal'
import { Badge } from './Badge'
import { Button } from './Button'
import { QualityPicker } from './QualityPicker'

type Kind = 'LP' | 'EP' | 'Single'
const ALL_KINDS: Kind[] = ['LP', 'EP', 'Single']

function kindOf(a: Album): Kind {
  const tc = a.trackCount ?? 0
  if (a.isSingle || tc <= 3) return 'Single'
  if (tc <= 6) return 'EP'
  return 'LP'
}

type Props = {
  open: boolean
  onClose: () => void
  artistName: string
  albums: Album[]
  inLibraryMap?: Record<string, boolean>
  onQueued?: (queued: number, skippedExisting: number) => void
}

export function SelectDownloadsModal({
  open,
  onClose,
  artistName,
  albums,
  inLibraryMap = {},
  onQueued,
}: Props) {
  const { t } = useTranslation()
  const appSettings = useAppSettings()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedQuality, setSelectedQuality] = useState<QualityPreference>('flac')
  const [kinds, setKinds] = useState<Kind[]>(ALL_KINDS)
  const [deselectActive, setDeselectActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [displayOrder, setDisplayOrder] = useState<string[]>([])

  useEffect(() => {
    if (open) {
      setSelected(new Set(albums.filter((a) => !inLibraryMap[a.id]).map((a) => a.id)))
      setKinds(ALL_KINDS)
      setDeselectActive(false)
      setDisplayOrder(albums.map((a) => a.id))
      setSelectedQuality(appSettings?.quality || 'flac')
    }
  }, [open, albums, inLibraryMap, appSettings?.quality])

  const lpIds = useMemo(
    () => albums.filter((a) => kindOf(a) === 'LP').map((a) => a.id),
    [albums],
  )
  const epIds = useMemo(
    () => albums.filter((a) => kindOf(a) === 'EP').map((a) => a.id),
    [albums],
  )
  const singleIds = useMemo(
    () => albums.filter((a) => kindOf(a) === 'Single').map((a) => a.id),
    [albums],
  )
  const kindSet = useMemo(() => new Set(kinds), [kinds])
  const allKindsSelected = kinds.length === ALL_KINDS.length

  const reorderFromSelection = (nextSelected: Set<string>) => {
    const picked: string[] = []
    const rest: string[] = []
    for (const a of albums) {
      if (nextSelected.has(a.id)) picked.push(a.id)
      else rest.push(a.id)
    }
    setDisplayOrder([...picked, ...rest])
  }

  const applyKinds = (nextKinds: Kind[]) => {
    setKinds(nextKinds)
    setDeselectActive(false)
    const allowedKinds = new Set(nextKinds)
    const ids = albums
      .filter((a) => allowedKinds.has(kindOf(a)) && !inLibraryMap[a.id])
      .map((a) => a.id)
    const nextSelected = new Set(ids)
    setSelected(nextSelected)
    reorderFromSelection(nextSelected)
  }

  const selectAll = () => applyKinds(ALL_KINDS)
  const deselectAll = () => {
    setSelected(new Set())
    setKinds([])
    setDeselectActive(true)
    setDisplayOrder(albums.map((a) => a.id))
  }

  const toggleKind = (kind: Kind) => {
    const isAll = kinds.length === ALL_KINDS.length
    let nextKinds: Kind[]
    if (isAll) {
      nextKinds = [kind]
    } else if (kindSet.has(kind)) {
      nextKinds = kinds.filter((k) => k !== kind)
      if (nextKinds.length === 0) nextKinds = ALL_KINDS
    } else {
      nextKinds = [...kinds, kind]
    }
    applyKinds(nextKinds)
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size > 0) setDeselectActive(false)
      return next
    })
  }

  const submit = async () => {
    if (selected.size === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const ids = albums
        .filter((a) => selected.has(a.id) && !inLibraryMap[a.id])
        .map((a) => a.id)
      const quality = appSettings?.promptForDownloadQuality ? selectedQuality : undefined
      // one request for the whole selection: the backend skips albums that
      // are already in the library instead of aborting the queue on them
      const res = await api.enqueueBulk(ids, quality)
      if (res.queued > 0 || res.skippedExisting > 0) {
        onQueued?.(res.queued, res.skippedExisting)
        onClose()
      } else {
        setError(res.errors[0]?.error || t('selectDownloadsModal.failedToQueueDownloads'))
      }
    } catch (err: any) {
      setError(err?.message || t('selectDownloadsModal.failedToQueueDownloads'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      label={t('selectDownloadsModal.queueAlbumsFrom', { artistName })}
      placement="center"
      className="!max-w-[44rem] max-h-[calc(100dvh-4rem)] overflow-hidden flex flex-col"
    >
      <header className="shrink-0 flex items-start justify-between gap-4 p-5 border-b border-[var(--line)]">
        <div className="min-w-0">
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-quiet mb-1">{t('selectDownloadsModal.queueAlbumsLabel')}</div>
          <h2 className="truncate text-lg font-semibold md:text-xl">{artistName}</h2>
          <div className="mt-1 text-sm text-quiet">
            {t('selectDownloadsModal.selectedCount', { selected: selected.size, total: albums.length })}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('selectDownloadsModal.close')}
          className="glyph quiet -mr-2 -mt-2 h-10 w-10"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div
        className="shrink-0 px-5 py-3 flex flex-wrap gap-2 border-b border-[var(--line)]"
        role="group"
        aria-label={t('selectDownloadsModal.filterAlbumTypes')}
      >
        <FilterPill label={t('selectDownloadsModal.selectAll')} icon={ListChecks} active={allKindsSelected && !deselectActive} onClick={selectAll} count={albums.length} />
        <FilterPill label={t('selectDownloadsModal.lps')} icon={AlbumIcon} active={!allKindsSelected && kindSet.has('LP')} onClick={() => toggleKind('LP')} count={lpIds.length} />
        <FilterPill label={t('selectDownloadsModal.eps')} icon={Disc3} active={!allKindsSelected && kindSet.has('EP')} onClick={() => toggleKind('EP')} count={epIds.length} />
        <FilterPill label={t('selectDownloadsModal.singles')} icon={Music2} active={!allKindsSelected && kindSet.has('Single')} onClick={() => toggleKind('Single')} count={singleIds.length} />
        <FilterPill label={t('selectDownloadsModal.deselectAll')} icon={X} active={deselectActive} onClick={deselectAll} count={0} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {albums.length === 0 ? (
          <div className="p-8 text-center text-quiet text-sm">{t('selectDownloadsModal.noAlbumsToQueue')}</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {displayOrder.map((id) => {
              const a = albums.find((x) => x.id === id)
              if (!a) return null
              return (
                <AlbumRow
                  key={a.id}
                  album={a}
                  checked={selected.has(a.id)}
                  blocked={Boolean(inLibraryMap[a.id])}
                  onToggle={() => toggle(a.id)}
                />
              )
            })}
          </ul>
        )}
      </div>

      {error && (
        <div className="px-5 pb-2">
          <Badge variant="bad">{error}</Badge>
        </div>
      )}

      {appSettings?.promptForDownloadQuality && (
        <div className="shrink-0 border-t border-[var(--line)] px-5 py-4">
          <div className="mb-3">
            <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-quiet">{t('selectDownloadsModal.downloadQualityLabel')}</div>
            <div className="mt-1 text-sm text-quiet">
              {t('selectDownloadsModal.appliesToEveryAlbum')}
            </div>
          </div>
          <QualityPicker value={selectedQuality} onChange={setSelectedQuality} />
        </div>
      )}

      <footer className="shrink-0 p-4 flex items-center justify-end gap-2 border-t border-[var(--line)]">
        <Button variant="ghost" onClick={onClose} disabled={submitting}>{t('selectDownloadsModal.cancel')}</Button>
        <Button variant="primary" onClick={submit} disabled={submitting || selected.size === 0}>
          <ListChecks className="h-4 w-4" />
          {submitting
            ? t('selectDownloadsModal.queuingButton')
            : t('selectDownloadsModal.queueButton', { count: selected.size })}
        </Button>
      </footer>
    </Modal>
  )
}

function FilterPill({
  label,
  icon: Icon,
  active,
  onClick,
  count,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  onClick: () => void
  count: number
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'chip select-none',
        active && 'on',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {count > 0 && <span className="text-quiet text-[11px] font-normal">{count}</span>}
    </button>
  )
}

function AlbumRow({
  album,
  checked,
  blocked,
  onToggle,
}: {
  album: Album
  checked: boolean
  blocked: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const art = artworkUrl(album.artworkTemplate, 100)
  const kind = kindOf(album)
  const KindIcon = kind === 'Single' ? Music2 : kind === 'EP' ? Disc3 : AlbumIcon
  return (
    <motion.li layout transition={{ type: 'spring', stiffness: 420, damping: 34 }}>
      <div className="flex items-center gap-3 rounded-card px-3 py-2 transition-colors hover:bg-[var(--hover)]">
        <input
          type="checkbox"
          className="disabled:cursor-not-allowed disabled:opacity-60"
          checked={checked}
          disabled={blocked}
          onChange={onToggle}
          aria-label={t('selectDownloadsModal.selectAlbum', { name: album.name })}
        />
        <Link to={`/album/${album.id}`} className="plate block h-10 w-10 shrink-0 overflow-hidden rounded-cover">
          {art && <img src={art} alt="" className="h-full w-full object-cover" />}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px]">
            <Link to={`/album/${album.id}`} className="hover:text-white transition-colors">
              {stripYear(album.name)}
            </Link>
          </div>
          <div className="truncate text-[13px] text-quiet">
            {album.year ? `${album.year} · ` : ''}
            {album.trackCount ? t('selectDownloadsModal.trackCount', { count: album.trackCount }) : ''}
          </div>
        </div>
        <Badge className="shrink-0">
          <KindIcon className="h-3 w-3" />
          {kind}
        </Badge>
        {blocked && <Badge className="shrink-0">{t('selectDownloadsModal.inLibrary')}</Badge>}
      </div>
    </motion.li>
  )
}
