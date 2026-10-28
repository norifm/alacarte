import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Search as SearchIcon,
  Xmark as X,
  CompactDisc as Disc3,
  User as UserRound,
  MusicNote as Music2,
  TaskList as ListChecks,
  Playlist as ListMusic,
} from 'iconoir-react'

import { api, artworkUrl, type Album, type Artist, type Song, type Playlist } from '../api/client'
import { AlbumCard } from '../components/AlbumCard'
import { PlaylistCard } from '../components/PlaylistCard'
import { Badge } from '../components/Badge'
import { PageTitle } from '../components/PageTitle'
import { DownloadButton } from '../components/DownloadButton'
import { ResolvedMediaLink } from '../components/ResolvedMediaLink'
import { StaggeredList, StaggeredItem } from '../components/StaggeredList'
import { useDownloadQualityPrompt } from '../hooks/useDownloadQualityPrompt'
import { useLibraryPresence } from '../hooks/useLibraryPresence'
import { useQueue } from '../hooks/useQueue'
import { useTouchMode } from '../hooks/useTouchMode'
import { stripYear } from '../lib/format'
import { cx } from '../lib/cx'

type Results = {
  albums: Album[]
  artists: Artist[]
  songs: Song[]
  playlists: Playlist[]
}

const EMPTY: Results = { albums: [], artists: [], songs: [], playlists: [] }

type Category = 'albums' | 'artists' | 'songs' | 'playlists'
const ALL_CATS: Category[] = ['albums', 'artists', 'songs', 'playlists']
const resultCache = new Map<string, Results>()

function parseCats(param: string | null): Category[] {
  if (!param) return ALL_CATS
  const parts = param
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is Category => ALL_CATS.includes(s as Category))
  return parts.length ? parts : ALL_CATS
}

export function SearchPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const urlQ = params.get('q') ?? ''
  const cats = useMemo(() => parseCats(params.get('cats')), [params])
  const catSet = useMemo(() => new Set(cats), [cats])

  // The query is the address's: the top bar's search pill writes it, and on a phone the field here does.
  const q = urlQ
  const setQ = (value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set('q', value)
        else next.delete('q')
        return next
      },
      { replace: true },
    )
  const [results, setResults] = useState<Results>(
    () => resultCache.get(urlQ.trim()) ?? EMPTY,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const trimmed = useMemo(() => q.trim(), [q])


  useEffect(() => {
    if (!trimmed) {
      setResults(EMPTY)
      setError(null)
      return
    }
    const cached = resultCache.get(trimmed)
    if (cached) setResults(cached)

    const ctl = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const r = await api.search(trimmed)
        if (ctl.signal.aborted) return
        if (r.redirect) {
          navigate(r.redirect, { replace: true })
          return
        }
        const next = {
          albums: r.albums,
          artists: r.artists,
          songs: r.songs,
          playlists: r.playlists ?? [],
        }
        resultCache.set(trimmed, next)
        setResults(next)
      } catch (err: any) {
        if (!ctl.signal.aborted) setError(err?.message || t('search.searchFailed'))
      } finally {
        if (!ctl.signal.aborted) setLoading(false)
      }
    }, cached ? 0 : 300)
    return () => {
      ctl.abort()
      clearTimeout(timer)
    }
  }, [trimmed, navigate])

  useEffect(() => {
    if (!matchMedia('(min-width: 768px)').matches) inputRef.current?.focus()
  }, [])

  const allCatsSelected = cats.length === ALL_CATS.length

  const selectAllCats = () => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('cats')
        return next
      },
      { replace: true },
    )
  }

  const toggleCat = (c: Category) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        const isAll = cats.length === ALL_CATS.length
        let newCats: Category[]
        if (isAll) {
          newCats = [c]
        } else if (catSet.has(c)) {
          newCats = cats.filter((x) => x !== c)
          if (newCats.length === 0) newCats = ALL_CATS
        } else {
          newCats = [...cats, c]
        }
        const ordered = ALL_CATS.filter((x) => newCats.includes(x))
        if (ordered.length === ALL_CATS.length) next.delete('cats')
        else next.set('cats', ordered.join(','))
        return next
      },
      { replace: true },
    )
  }

  return (
    <div className="flex w-full flex-col gap-[26px]">
      <PageTitle>{t('nav.search')}</PageTitle>
      <label className="field flex items-center gap-2 !px-3.5 text-quiet md:hidden">
        <SearchIcon className="h-[19px] w-[19px] shrink-0" />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search.searchPlaceholder')}
          className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-quiet [&::-webkit-search-cancel-button]:hidden"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            className="glyph quiet -mr-2 h-9 w-9"
            aria-label={t('search.clearAriaLabel')}
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        )}
      </label>

      {error && <Badge variant="bad">{error}</Badge>}

      {!trimmed && (
        <div className="empty-note font-medium text-quiet">
          <SearchIcon className="mb-3.5 box-content h-7 w-7 rounded-full bg-[var(--veil)] p-[18px]" />
          {t('search.emptyStateHint')}
        </div>
      )}

      {trimmed && (
        <>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('search.filterResultsAriaLabel')}>
            <CatPill label={t('search.showAll')} icon={ListChecks} active={allCatsSelected} onClick={selectAllCats} />
            <CatPill label={t('search.albums')} icon={Disc3} active={!allCatsSelected && catSet.has('albums')} onClick={() => toggleCat('albums')} count={results.albums.length} />
            <CatPill label={t('search.artists')} icon={UserRound} active={!allCatsSelected && catSet.has('artists')} onClick={() => toggleCat('artists')} count={results.artists.length} />
            <CatPill label={t('search.songs')} icon={Music2} active={!allCatsSelected && catSet.has('songs')} onClick={() => toggleCat('songs')} count={results.songs.length} />
            <CatPill label={t('search.playlists')} icon={ListMusic} active={!allCatsSelected && catSet.has('playlists')} onClick={() => toggleCat('playlists')} count={results.playlists.length} />
          </div>

          {catSet.has('albums') && (
            <Section title={loading ? t('search.albumsSearching') : t('search.albums')} empty={results.albums.length === 0 && !loading}>
              <StaggeredList className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
                {results.albums.map((a) => (
                  <StaggeredItem key={a.id}>
                    <AlbumCard album={a} />
                  </StaggeredItem>
                ))}
              </StaggeredList>
            </Section>
          )}

          {catSet.has('artists') && (
            <Section title={t('search.artists')} empty={results.artists.length === 0}>
              <StaggeredList className="flex flex-wrap gap-2">
                {results.artists.map((a) => (
                  <StaggeredItem key={a.id}>
                    <Link to={`/artist/${a.id}`} className="chip on hover:bg-[color-mix(in_srgb,var(--ink)_4%,var(--surface))]">
                      {a.name}
                    </Link>
                  </StaggeredItem>
                ))}
              </StaggeredList>
            </Section>
          )}

          {catSet.has('songs') && (
            <Section title={t('search.songs')} empty={results.songs.length === 0}>
              <StaggeredList className="rows [--row-text:60px]">
                {results.songs
                  .slice(0, cats.length === 1 ? 50 : 10)
                  .map((s) => (
                    <StaggeredItem key={s.id}>
                      <SongRow song={s} />
                    </StaggeredItem>
                  ))}
              </StaggeredList>
            </Section>
          )}

          {catSet.has('playlists') && (
            <Section title={loading ? t('search.playlistsSearching') : t('search.playlists')} empty={results.playlists.length === 0 && !loading}>
              <StaggeredList className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
                {results.playlists.map((p) => (
                  <StaggeredItem key={p.id}>
                    <PlaylistCard playlist={p} />
                  </StaggeredItem>
                ))}
              </StaggeredList>
            </Section>
          )}
        </>
      )}
    </div>
  )
}

function CatPill({
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
  count?: number
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx('chip select-none', active && 'on')}
    >
      <Icon className="h-4 w-4" />
      {label}
      {typeof count === 'number' && count > 0 && (
        <span className="text-[12px] font-normal text-quiet tabular-nums">{count}</span>
      )}
    </button>
  )
}

function Section({ title, children, empty }: { title: string; empty?: boolean; children: React.ReactNode }) {
  if (empty) return null
  return (
    <section>
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  )
}

function SongRow({ song }: { song: Song }) {
  const { t } = useTranslation()
  const { jobs } = useQueue()
  const { chooseDownloadQuality, qualityPrompt } = useDownloadQualityPrompt()
  const {
    ready,
    isSongInLibrary,
    isAlbumInLibrary,
    verifySongPresence,
    verifyAlbumPresence,
  } = useLibraryPresence()
  const touchMode = useTouchMode()
  const matching = useMemo(() => {
    if (!song.id) return null
    const active = jobs.find(
      (j) => j.kind === 'song' && j.songId === song.id && (j.status === 'queued' || j.status === 'running'),
    )
    if (active) return active
    return jobs.find((j) => j.kind === 'song' && j.songId === song.id) || null
  }, [jobs, song.id])

  const canDownload = Boolean(song.albumId)
  const albumLookup = song.albumName
    ? { id: song.albumId || '', artistName: song.artistName, name: song.albumName }
    : null
  const alreadyInLibrary =
    isSongInLibrary(song) || (albumLookup ? isAlbumInLibrary(albumLookup) : false)

  return (
    <div className="group relative flex min-h-[60px] items-center gap-3 py-2 pl-2 pr-1 transition-colors hover:bg-[var(--hover)]">
      <div className="plate relative h-10 w-10 shrink-0 overflow-hidden rounded-cover">
        {song.albumId ? (
          <Link to={`/album/${song.albumId}`}>
            {song.artworkTemplate && (
              <img src={artworkUrl(song.artworkTemplate, 100) || undefined} alt="" className="h-full w-full object-cover" />
            )}
          </Link>
        ) : (
          song.artworkTemplate && (
            <img src={artworkUrl(song.artworkTemplate, 100) || undefined} alt="" className="h-full w-full object-cover" />
          )
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base leading-[21px]">
          {song.albumId ? (
            <Link to={`/album/${song.albumId}`} className="hover:text-white transition-colors">{song.name}</Link>
          ) : (
            song.name
          )}
        </div>
        <div className="truncate text-[13px] text-quiet">
          <ResolvedMediaLink
            kind="artist"
            artistId={song.artistId}
            artistName={song.artistName}
            className="hover:text-white transition-colors"
          >
            {song.artistName}
          </ResolvedMediaLink>
          {song.albumName ? (
            <>
              {' · '}
              <ResolvedMediaLink
                kind="album"
                artistName={song.artistName}
                artistId={song.artistId}
                albumId={song.albumId}
                albumName={song.albumName}
                className="hover:text-white transition-colors"
              >
                {stripYear(song.albumName)}
              </ResolvedMediaLink>
            </>
          ) : null}
        </div>
      </div>
      {canDownload && (
        <div className="shrink-0 pr-1 flex items-center justify-center">
          <DownloadButton
            size="sm"
            job={matching}
            onStart={async () => {
              if (!song.albumId) return false
              if (!ready) {
                if (await verifySongPresence(song)) return false
                if (albumLookup && (await verifyAlbumPresence(albumLookup))) return false
              }
              try {
                const quality = await chooseDownloadQuality()
                if (quality === false) return false
                await api.enqueueSong(song.id, song.albumId, undefined, quality)
                return true
              } catch (err: any) {
                if (/already in library/i.test(String(err?.message || ''))) {
                  await verifySongPresence(song)
                  if (albumLookup) await verifyAlbumPresence(albumLookup)
                  return false
                }
                throw err
              }
            }}
            ariaLabel={t('search.downloadAriaLabel', { name: song.name })}
            blocked={alreadyInLibrary}
            className={cx(
              touchMode
                ? 'opacity-100'
                : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 md:pointer-events-none md:group-hover:pointer-events-auto md:focus-within:pointer-events-auto transition-opacity duration-200',
            )}
          />
          {qualityPrompt}
        </div>
      )}
    </div>
  )
}
