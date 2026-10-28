import { useEffect, useState, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  CheckCircle as CheckCircle2,
  Clock,
  Playlist as ListMusic,
  Refresh as RefreshCw,
  UserBadgeCheck as UserRoundCheck,
  Xmark as X,
  RefreshDouble as Loader2,
  Download,
  WarningTriangle as AlertTriangle,
} from "iconoir-react";

import {
    api,
    artworkUrl,
    type FollowedArtist,
    type FollowedPlaylist,
    type Job,
    type QualityPreference,
    type ReleaseScope,
} from "../api/client";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PageTitle } from "../components/PageTitle";
import { StaggeredItem, StaggeredList } from "../components/StaggeredList";
import {
    useActivityFeed,
    type FollowingArtistState,
    type PlaylistFollowingState,
} from "../hooks/useActivityFeed";
import { useDownloadQualityPrompt } from "../hooks/useDownloadQualityPrompt";
import { ReleaseScopePicker } from "../components/ReleaseScopePicker";
import { cx } from "../lib/cx";
import i18n from "../i18n";

type FollowTab = "artists" | "playlists";

function isFollowTab(value: string | null): value is FollowTab {
    return value === "artists" || value === "playlists";
}

export function FollowingPage() {
    const { t } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get("tab");
    const activeTab: FollowTab = isFollowTab(tabParam) ? tabParam : "artists";
    const setActiveTab = (tab: FollowTab) => {
        const next = new URLSearchParams(searchParams);
        if (tab === "artists") next.delete("tab");
        else next.set("tab", tab);
        setSearchParams(next, { replace: true });
    };

    const { jobs, followingState, playlistFollowingState } = useActivityFeed();
    const { chooseDownloadQuality, qualityPrompt } = useDownloadQualityPrompt();
    const [artists, setArtists] = useState<FollowedArtist[]>([]);
    const [playlists, setPlaylists] = useState<FollowedPlaylist[]>([]);
    const [loading, setLoading] = useState(true);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [queuedCount, setQueuedCount] = useState(0);
    const [updatingScopeId, setUpdatingScopeId] = useState<string | null>(null);
    const [syncingPlaylistId, setSyncingPlaylistId] = useState<string | null>(
        null,
    );
    const activeJobsTotal = jobs.filter(
        (j) => j.status === "queued" || j.status === "running",
    ).length;
    const activePlaylistJobCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const j of jobs) {
            if (
                j.followedPlaylistId &&
                (j.status === "queued" || j.status === "running")
            ) {
                counts[j.followedPlaylistId] =
                    (counts[j.followedPlaylistId] || 0) + 1;
            }
        }
        return counts;
    }, [jobs]);
    const anyArtistMissing = artists.some((a) => {
        const live = followingState[a.id];
        const missing =
            typeof live?.missingReleaseCount === "number"
                ? live.missingReleaseCount
                : a.missingReleaseCount;
        return (a.totalReleaseCount || 0) > 0 && missing > 0;
    });
    const showBulkButton = anyArtistMissing || activeJobsTotal > 0;

    const reload = () => {
        setLoading(true);
        setError(null);
        Promise.all([api.following(), api.playlistFollowing()])
            .then(([artistResponse, playlistResponse]) => {
                setArtists(artistResponse.artists);
                setPlaylists(playlistResponse.playlists);
            })
            .catch((err) =>
                setError(err.message || t("following.errorLoad")),
            )
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        reload();
    }, []);

    const unfollow = async (id: string) => {
        const previous = artists;
        setArtists((items) => items.filter((artist) => artist.id !== id));
        try {
            await api.unfollowArtist(id);
        } catch (err: any) {
            setArtists(previous);
            setError(err.message || t("following.errorUnfollowArtist"));
        }
    };

    const unfollowPlaylist = async (id: string) => {
        const previous = playlists;
        setPlaylists((items) => items.filter((playlist) => playlist.id !== id));
        try {
            await api.unfollowPlaylist(id);
        } catch (err: any) {
            setPlaylists(previous);
            setError(err.message || t("following.errorUnfollowPlaylist"));
        }
    };

    const syncPlaylist = async (id: string) => {
        setSyncingPlaylistId(id);
        setError(null);
        try {
            const result = await api.syncFollowedPlaylistNow(id);
            if (!result.ok) {
                setError(t("following.errorPlaylistSyncFailed"));
                return;
            }
            if (result.playlist) {
                setPlaylists((items) =>
                    items.map((playlist) =>
                        playlist.id === id ? result.playlist! : playlist,
                    ),
                );
            }
            if (result.queued > 0) {
                setQueuedCount((count) => count + result.queued);
                window.setTimeout(
                    () => setQueuedCount((count) => Math.max(0, count - result.queued)),
                    8000,
                );
            }
        } catch (err: any) {
            setError(err.message || t("following.errorSyncPlaylist"));
        } finally {
            setSyncingPlaylistId(null);
        }
    };

    const downloadPlaylistMissing = async (
        id: string,
        quality?: QualityPreference,
    ) => {
        setSyncingPlaylistId(id);
        setError(null);
        try {
            const result = await api.downloadPlaylistMissing(id, quality);
            if (result.playlist) {
                setPlaylists((items) =>
                    items.map((playlist) =>
                        playlist.id === id ? result.playlist! : playlist,
                    ),
                );
            }
            if (result.queued > 0) {
                setQueuedCount((count) => count + result.queued);
                window.setTimeout(
                    () => setQueuedCount((count) => Math.max(0, count - result.queued)),
                    8000,
                );
            }
        } catch (err: any) {
            setError(err.message || t("following.errorDownloadMissingTracks"));
        } finally {
            setSyncingPlaylistId(null);
        }
    };

    const updateScope = async (id: string, releaseScope: ReleaseScope) => {
        const previous = artists;
        setUpdatingScopeId(id);
        setError(null);
        setArtists((items) =>
            items.map((artist) =>
                artist.id === id ? { ...artist, releaseScope } : artist,
            ),
        );
        try {
            const response = await api.updateFollowedArtist(id, {
                releaseScope,
            });
            if (response.artist) {
                setArtists((items) =>
                    items.map((artist) =>
                        artist.id === id ? response.artist! : artist,
                    ),
                );
            }
        } catch (err: any) {
            setArtists(previous);
            setError(err.message || t("following.errorUpdateReleaseScope"));
        } finally {
            setUpdatingScopeId(null);
        }
    };

    const runCheck = async () => {
        setChecking(true);
        setError(null);
        try {
            await Promise.all([
                api.runFollowingCheck(),
                api.runPlaylistSync().catch(() => null),
            ]);
            reload();
        } catch (err: any) {
            setError(err.message || t("following.errorCheckNewMusic"));
        } finally {
            setChecking(false);
        }
    };

    return (
        <div className="flex w-full flex-col gap-[26px]">
            <div className="messages">
            <AnimatePresence>
                {queuedCount > 0 && (
                    <motion.div
                        key="queued-banner"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        className="message"
                    >
                        <div>
                            {t("following.queuedPrefix")} <b>{queuedCount}</b>{" "}
                            {t("following.queuedItem", { count: queuedCount })}.{" "}
                            <Link
                                to="/"
                            >
                                {t("following.openActivity")}
                            </Link>
                        </div>
                        <button
                            type="button"
                            onClick={() => setQueuedCount(0)}
                            aria-label={t("following.dismiss")}
                            className="glyph h-9 w-9"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
            </div>

            <PageTitle
                sub={
                    <div
                        className="flex flex-wrap gap-1"
                        role="group"
                        aria-label={t("following.sectionAriaLabel")}
                    >
                        <FollowTabPill
                            label={t("following.tabArtists")}
                            icon={UserRoundCheck}
                            active={activeTab === "artists"}
                            onClick={() => setActiveTab("artists")}
                            count={artists.length}
                        />
                        <FollowTabPill
                            label={t("following.tabPlaylists")}
                            icon={ListMusic}
                            active={activeTab === "playlists"}
                            onClick={() => setActiveTab("playlists")}
                            count={playlists.length}
                        />
                    </div>
                }
                aside={
                    <>
                    <Button
                        onClick={runCheck}
                        disabled={checking || loading}
                        className="whitespace-nowrap"
                    >
                        <RefreshCw
                            className={
                                checking ? "h-4 w-4 animate-spin" : "h-4 w-4"
                            }
                        />
                        {checking ? t("following.checking") : t("following.checkNow")}
                    </Button>
                    {showBulkButton && activeTab === "artists" && (
                        <Button
                            disabled={
                                checking || loading || activeJobsTotal > 0
                            }
                            active={activeJobsTotal > 0}
                            onClick={() => {
                                void (async () => {
                                    const quality =
                                        await chooseDownloadQuality();
                                    if (quality === false) return;
                                    api.downloadMissingReleases(quality)
                                        .then((res) =>
                                            setQueuedCount(res.queued),
                                        )
                                        .catch((err: any) =>
                                            setError(
                                                err.message ||
                                                    t("following.errorDownloadMissingReleases"),
                                            ),
                                        );
                                })();
                            }}
                            className="whitespace-nowrap"
                        >
                            {activeJobsTotal > 0 ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    {t("following.downloading")}
                                </>
                            ) : (
                                <>
                                    <Download className="h-4 w-4" />
                                    {t("following.downloadMissing")}
                                </>
                            )}
                        </Button>
                    )}
                    </>
                }
            >
                {t("following.title")}
            </PageTitle>

            {error && <Badge variant="bad">{error}</Badge>}

            {loading ? (
                <p className="px-2 py-2 text-[15px] text-quiet">
                    {activeTab === "artists"
                        ? t("following.loadingArtists")
                        : t("following.loadingPlaylists")}
                </p>
            ) : activeTab === "artists" ? (
                artists.length === 0 ? (
                    <EmptyState
                        icon={<UserRoundCheck className="h-5 w-5" />}
                        title={t("following.emptyArtistsTitle")}
                        body={t("following.emptyArtistsBody")}
                        linkLabel={t("following.emptyArtistsLink")}
                    />
                ) : (
                    <StaggeredList className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <AnimatePresence initial={false}>
                            {artists.map((artist) => (
                                <StaggeredItem key={artist.id}>
                                    <ArtistFollowCard
                                        artist={artist}
                                        jobs={jobs}
                                        liveState={followingState[artist.id]}
                                        onUnfollow={() => unfollow(artist.id)}
                                        onScopeChange={(scope) =>
                                            updateScope(artist.id, scope)
                                        }
                                        updatingScope={
                                            updatingScopeId === artist.id
                                        }
                                    />
                                </StaggeredItem>
                            ))}
                        </AnimatePresence>
                    </StaggeredList>
                )
            ) : playlists.length === 0 ? (
                <EmptyState
                    icon={<ListMusic className="h-5 w-5" />}
                    title={t("following.emptyPlaylistsTitle")}
                    body={t("following.emptyPlaylistsBody")}
                    linkLabel={t("following.emptyPlaylistsLink")}
                    linkHref="/cloud-library?tab=playlists"
                />
            ) : (
                <StaggeredList className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <AnimatePresence initial={false}>
                        {playlists.map((playlist) => (
                            <StaggeredItem key={playlist.id}>
                                <PlaylistFollowCard
                                    playlist={playlist}
                                    liveState={playlistFollowingState[playlist.id]}
                                    activeJobCount={
                                        activePlaylistJobCounts[playlist.id] || 0
                                    }
                                    syncing={syncingPlaylistId === playlist.id}
                                    onSync={() => syncPlaylist(playlist.id)}
                                    onDownloadMissing={(quality) =>
                                        downloadPlaylistMissing(
                                            playlist.id,
                                            quality,
                                        )
                                    }
                                    onUnfollow={() =>
                                        unfollowPlaylist(playlist.id)
                                    }
                                />
                            </StaggeredItem>
                        ))}
                    </AnimatePresence>
                </StaggeredList>
            )}
            {qualityPrompt}
        </div>
    );
}

function FollowTabPill({
    label,
    icon: Icon,
    active,
    onClick,
    count,
}: {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    active: boolean;
    onClick: () => void;
    count: number;
}) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={cx(
                "chip select-none",
                active && "on",
            )}
        >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {count > 0 && (
                <span className="text-quiet text-[11px] font-normal">
                    {count}
                </span>
            )}
        </button>
    );
}

function EmptyState({
    icon,
    title,
    body,
    linkLabel,
    linkHref = "/search",
}: {
    icon: React.ReactNode;
    title: string;
    body: string;
    linkLabel: string;
    linkHref?: string;
}) {
    return (
        <div className="empty-note">
            <div className="flex max-w-md flex-col items-center gap-2">
                <div className="mb-2 grid h-16 w-16 place-items-center rounded-full bg-[var(--veil)] text-quiet [&_svg]:h-7 [&_svg]:w-7">
                    {icon}
                </div>
                <h2 className="text-[19px] font-semibold tracking-[-0.2px] text-white">{title}</h2>
                <p className="text-sm text-quiet">{body}</p>
                <Link
                    to={linkHref}
                    className="pill small quiet"
                >
                    {linkLabel}
                </Link>
            </div>
        </div>
    );
}

function PlaylistFollowCard({
    playlist,
    liveState,
    activeJobCount,
    syncing,
    onSync,
    onDownloadMissing,
    onUnfollow,
}: {
    playlist: FollowedPlaylist;
    liveState?: PlaylistFollowingState;
    activeJobCount: number;
    syncing: boolean;
    onSync: () => void;
    onDownloadMissing: (quality?: QualityPreference) => void;
    onUnfollow: () => void;
}) {
    const { t } = useTranslation();
    const { chooseDownloadQuality, qualityPrompt } = useDownloadQualityPrompt();
    const href = playlist.libraryId
        ? `/playlist/library/${playlist.libraryId}`
        : `/playlist/${playlist.catalogId}`;
    const total =
        typeof liveState?.totalTrackCount === "number"
            ? liveState.totalTrackCount
            : playlist.totalTrackCount;
    const missing =
        typeof liveState?.missingTrackCount === "number"
            ? liveState.missingTrackCount
            : playlist.missingTrackCount;
    const undownloadable =
        typeof liveState?.undownloadableTrackCount === "number"
            ? liveState.undownloadableTrackCount
            : playlist.undownloadableTrackCount;
    const lastError = playlist.lastError;
    const complete = missing === 0 && total > 0;
    const art = artworkUrl(playlist.artworkTemplate, 300);

    return (
        <motion.div
            layout
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="h-full"
        >
            <Card
                hover
                className="group relative flex h-full flex-col overflow-hidden p-4"
            >
                <div className="flex flex-1 flex-col gap-4">
                    <div className="flex items-start gap-4">
                        <Link
                            to={href}
                            className="h-20 w-20 shrink-0 overflow-hidden plate rounded-card"
                        >
                            {art ? (
                                <img
                                    src={art}
                                    alt=""
                                    className="h-full w-full object-cover"
                                />
                            ) : (
                                <div className="flex h-full w-full items-center justify-center text-quiet">
                                    <ListMusic className="h-7 w-7" />
                                </div>
                            )}
                        </Link>
                        <div className="min-w-0 flex-1">
                            <Link
                                to={href}
                                className="line-clamp-2 text-base font-semibold leading-tight text-white"
                            >
                                {playlist.name}
                            </Link>
                            <div className="mt-0.5 truncate text-[13px] text-quiet">
                                {playlist.curatorName}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {complete ? (
                                    <Badge variant="ok">
                                        <CheckCircle2 className="h-3 w-3" />
                                        {t("following.allTracksSaved")}
                                    </Badge>
                                ) : (
                                    total > 0 && (
                                        <Badge variant="warn">
                                            {t("following.notInLibrary", { count: missing })}
                                        </Badge>
                                    )
                                )}
                                {total > 0 && (
                                    <Badge>{t("following.trackCount", { count: total })}</Badge>
                                )}
                                {undownloadable > 0 && (
                                    <Badge variant="muted">
                                        {t("following.notOnAppleMusic", { count: undownloadable })}
                                    </Badge>
                                )}
                            </div>
                            {lastError && (
                                <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-300/90">
                                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    <span className="min-w-0">{lastError}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="mt-auto flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0 text-xs text-quiet">
                            <div className="flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5" />
                                {playlist.lastCheckedAt
                                    ? t("following.syncedAt", {
                                          time: formatRelativeTime(playlist.lastCheckedAt),
                                      })
                                    : t("following.waitingFirstSync")}
                            </div>
                            {activeJobCount > 0 && (
                                <div className="mt-1 text-white">
                                    {t("following.tracksDownloading", { count: activeJobCount })}
                                </div>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center justify-start gap-2 lg:shrink-0 lg:justify-end">
                            {missing > 0 && activeJobCount === 0 && (
                                <button
                                    type="button"
                                    onClick={async () => {
                                        try {
                                            const quality =
                                                await chooseDownloadQuality();
                                            if (quality === false) return;
                                            onDownloadMissing(quality);
                                        } catch (err) {
                                            console.error(err);
                                        }
                                    }}
                                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--plate)] px-3 text-[13px] font-medium text-[var(--plate-ink)] transition-opacity hover:opacity-85 disabled:opacity-40"
                                >
                                    <Download className="h-3.5 w-3.5" />
                                    {t("following.downloadMissing")}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={onSync}
                                disabled={syncing}
                                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--plate)] px-3 text-[13px] font-medium text-[var(--plate-ink)] transition-opacity hover:opacity-85 disabled:opacity-40"
                            >
                                <RefreshCw
                                    className={
                                        syncing
                                            ? "h-3.5 w-3.5 animate-spin"
                                            : "h-3.5 w-3.5"
                                    }
                                />
                                {t("following.syncNow")}
                            </button>
                            {qualityPrompt}
                            <button
                                type="button"
                                onClick={onUnfollow}
                                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-quiet transition-colors hover:bg-[var(--hover)] hover:text-rose-500 disabled:opacity-40"
                            >
                                <X className="h-3.5 w-3.5" />
                                {t("following.unfollow")}
                            </button>
                        </div>
                    </div>
                </div>
            </Card>
        </motion.div>
    );
}

function ArtistFollowCard({
    artist,
    jobs,
    liveState,
    onUnfollow,
    onScopeChange,
    updatingScope,
}: {
    artist: FollowedArtist;
    jobs: Job[];
    liveState?: FollowingArtistState;
    onUnfollow: () => void;
    onScopeChange: (scope: ReleaseScope) => void;
    updatingScope: boolean;
}) {
    const { t } = useTranslation();
    const { chooseDownloadQuality, qualityPrompt } = useDownloadQualityPrompt();
    const artistJobs = useMemo(() => {
        const map = new Map<string, Job>();
        for (const j of jobs) {
            if (j.artistId === artist.id && j.kind === "album" && j.albumId) {
                map.set(j.albumId, j);
            }
        }
        return Array.from(map.values());
    }, [jobs, artist.id]);

    const activeJobs = artistJobs.filter(
        (j) => j.status === "queued" || j.status === "running",
    );
    const finishedJobs = artistJobs.filter(
        (j) => j.status === "done" || j.status === "failed",
    );
    const totalJobs = activeJobs.length + finishedJobs.length;
    const isDownloading = activeJobs.length > 0;
    const progressPercent =
        totalJobs > 0 ? (finishedJobs.length / totalJobs) * 100 : 0;

    const displayMissingCount = Math.max(
        0,
        typeof liveState?.missingReleaseCount === "number"
            ? liveState.missingReleaseCount
            : artist.missingReleaseCount,
    );
    const totalCount = liveState?.totalReleaseCount ?? artist.totalReleaseCount;
    const releaseScope =
        liveState?.releaseScope || artist.releaseScope || "everything";
    const isFullyDownloaded = totalCount > 0 && displayMissingCount === 0;

    const art = artworkUrl(artist.artworkTemplate, 300);
    return (
        <motion.div
            layout
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="h-full"
        >
            <Card
                hover
                className="group relative flex h-full flex-col overflow-hidden p-4"
            >
                <div className="flex flex-1 flex-col gap-4">
                    <div className="flex items-start gap-4">
                        <Link
                            to={`/artist/${artist.id}`}
                            className="h-20 w-20 shrink-0 overflow-hidden plate rounded-full"
                        >
                            {art ? (
                                <img
                                    src={art}
                                    alt=""
                                    className="h-full w-full object-cover"
                                />
                            ) : (
                                <div className="flex h-full w-full items-center justify-center text-quiet">
                                    <UserRoundCheck className="h-7 w-7" />
                                </div>
                            )}
                        </Link>
                        <div className="min-w-0 flex-1">
                            <Link
                                to={`/artist/${artist.id}`}
                                className="line-clamp-2 text-base font-semibold leading-tight text-white"
                            >
                                {artist.name}
                            </Link>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {isFullyDownloaded ? (
                                    <Badge variant="ok">
                                        <CheckCircle2 className="h-3 w-3" />
                                        {t("following.complete")}
                                    </Badge>
                                ) : (
                                    <Badge variant="warn">
                                        {t("following.missingCount", { count: displayMissingCount })}
                                    </Badge>
                                )}
                                <Badge>{t("following.releaseCount", { count: totalCount })}</Badge>
                            </div>
                            <div className="mt-3">
                                <ReleaseScopePicker
                                    value={releaseScope}
                                    onChange={onScopeChange}
                                    compact
                                    disabled={updatingScope}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="mt-auto flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0 text-xs text-quiet">
                            <div className="flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5" />
                                {artist.lastCheckedAt
                                    ? t("following.checkedAt", {
                                          time: formatRelativeTime(artist.lastCheckedAt),
                                      })
                                    : t("following.waitingFirstCheck")}
                            </div>
                            {artist.latestReleaseDate && (
                                <div
                                    className="mt-1 truncate"
                                    title={t("following.latestRelease", {
                                        date: artist.latestReleaseDate,
                                    })}
                                >
                                    {t("following.latestRelease", { date: artist.latestReleaseDate })}
                                </div>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center justify-start gap-2 lg:shrink-0 lg:justify-end">
                            {isDownloading ? (
                                <div className="inline-flex h-9 shrink-0 items-center gap-2 px-1 text-[13px] font-medium text-quiet tabular-nums">
                                    <div className="w-16">
                                        <div className="relative h-1 w-full overflow-hidden rounded-full bg-[var(--seek-track)]">
                                            <div
                                                className="absolute inset-y-0 left-0 rounded-full bg-[var(--ink)] transition-[width] duration-300 ease-snappy"
                                                style={{
                                                    width: `${progressPercent}%`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <span>
                                        {finishedJobs.length}/{totalJobs}
                                    </span>
                                </div>
                            ) : displayMissingCount > 0 ? (
                                <button
                                    type="button"
                                    onClick={async () => {
                                        try {
                                            const quality =
                                                await chooseDownloadQuality();
                                            if (quality === false) return;
                                            await api.downloadArtistMissingReleases(
                                                artist.id,
                                                quality,
                                            );
                                        } catch (err) {
                                            console.error(err);
                                        }
                                    }}
                                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--plate)] px-3 text-[13px] font-medium text-[var(--plate-ink)] transition-opacity hover:opacity-85 disabled:opacity-40"
                                >
                                    {t("following.downloadMissing")}
                                </button>
                            ) : null}
                            {qualityPrompt}
                            <button
                                type="button"
                                onClick={onUnfollow}
                                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-quiet transition-colors hover:bg-[var(--hover)] hover:text-rose-500 disabled:opacity-40"
                            >
                                <X className="h-3.5 w-3.5" />
                                {t("following.unfollow")}
                            </button>
                        </div>
                    </div>
                </div>
            </Card>
        </motion.div>
    );
}

function formatRelativeTime(ts: number) {
    const diff = Date.now() - ts;
    if (diff < 10_000) return i18n.t("following.relativeJustNow");
    if (diff < 60_000) return i18n.t("following.relativeSecondsAgo", { count: Math.round(diff / 1000) });
    if (diff < 3_600_000) return i18n.t("following.relativeMinutesAgo", { count: Math.round(diff / 60_000) });
    if (diff < 86_400_000) return i18n.t("following.relativeHoursAgo", { count: Math.round(diff / 3_600_000) });
    return i18n.t("following.relativeDaysAgo", { count: Math.round(diff / 86_400_000) });
}
