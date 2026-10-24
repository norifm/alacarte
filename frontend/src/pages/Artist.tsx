import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
    ListChecks,
    Radar,
    UserRoundCheck,
    UserRoundMinus,
    X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";

import {
    api,
    type Album,
    type Artist as ArtistT,
    type QualityPreference,
    type ReleaseScope,
} from "../api/client";
import { AlbumCard } from "../components/AlbumCard";
import { SelectDownloadsModal } from "../components/SelectDownloadsModal";
import { Card } from "../components/Card";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { QualityPicker } from "../components/QualityPicker";
import {
    ReleaseScopePicker,
    releaseScopeLabel,
} from "../components/ReleaseScopePicker";
import { StaggeredList, StaggeredItem } from "../components/StaggeredList";
import { useLibraryPresence } from "../hooks/useLibraryPresence";
import { useActivityFeed } from "../hooks/useActivityFeed";
import { useAppSettings } from "../hooks/useAppSettings";

export function ArtistPage() {
    const { t } = useTranslation();
    const { id } = useParams<{ id: string }>();
    const [artist, setArtist] = useState<ArtistT | null>(null);
    const [albums, setAlbums] = useState<Album[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [followModalOpen, setFollowModalOpen] = useState(false);
    const [following, setFollowing] = useState(false);
    const [followSubmitting, setFollowSubmitting] = useState(false);
    const [queuedCount, setQueuedCount] = useState(0);
    const [queuedSkipped, setQueuedSkipped] = useState(0);
    const [followBanner, setFollowBanner] = useState<
        null | "followed" | "unfollowed"
    >(null);
    const [unfollowModalOpen, setUnfollowModalOpen] = useState(false);
    const [followQuality, setFollowQuality] =
        useState<QualityPreference>("flac");
    const [followReleaseScope, setFollowReleaseScope] =
        useState<ReleaseScope>("everything");
    const { isAlbumInLibrary } = useLibraryPresence();
    const { followingState } = useActivityFeed();
    const appSettings = useAppSettings();

    useEffect(() => {
        if (!id) return;
        const evt = followingState[id];
        if (!evt) return;
        if (evt.unfollowed) setFollowing(false);
        else if (evt.totalReleaseCount !== undefined) setFollowing(true);
    }, [id, followingState]);

    useEffect(() => {
        if (!queuedCount && !queuedSkipped) return;
        const timer = setTimeout(() => {
            setQueuedCount(0);
            setQueuedSkipped(0);
        }, 6000);
        return () => clearTimeout(timer);
    }, [queuedCount, queuedSkipped]);

    useEffect(() => {
        if (!followBanner) return;
        const timer = setTimeout(() => setFollowBanner(null), 6000);
        return () => clearTimeout(timer);
    }, [followBanner]);

    useEffect(() => {
        if (followModalOpen && appSettings?.quality)
            setFollowQuality(appSettings.quality);
    }, [followModalOpen, appSettings?.quality]);

    useEffect(() => {
        if (!id) return;
        let cancelled = false;
        api.artist(id)
            .then((r) => {
                if (!cancelled) {
                    setArtist(r.artist);
                    setAlbums(r.albums);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err.message || t("artist.loadError"));
                }
            });
        return () => {
            cancelled = true;
        };
    }, [id]);

    useEffect(() => {
        if (!id) return;
        let cancelled = false;
        api.followedArtist(id)
            .then((r) => {
                if (!cancelled) setFollowing(Boolean(r.artist));
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [id]);

    const inLibraryAlbums = useMemo(
        () =>
            Object.fromEntries(
                albums.map((album) => [album.id, isAlbumInLibrary(album)]),
            ),
        [albums, isAlbumInLibrary],
    );

    const followArtist = async (downloadNow: boolean) => {
        if (!id) return;
        setFollowSubmitting(true);
        setError(null);
        setFollowModalOpen(false);
        try {
            const quality =
                downloadNow && appSettings?.promptForDownloadQuality
                    ? followQuality
                    : undefined;
            const result = await api.followArtist(
                id,
                downloadNow,
                quality,
                followReleaseScope,
            );
            setFollowing(Boolean(result.artist));
            setQueuedCount(downloadNow ? result.queued.length : 0);
            setFollowBanner("followed");
        } catch (err: any) {
            setError(err.message || t("artist.failedToFollow"));
        } finally {
            setFollowSubmitting(false);
        }
    };

    const unfollowArtist = async () => {
        if (!id) return;
        setFollowSubmitting(true);
        setError(null);
        setUnfollowModalOpen(false);
        try {
            await api.unfollowArtist(id);
            setFollowing(false);
            setFollowBanner("unfollowed");
        } catch (err: any) {
            setError(err.message || t("artist.failedToUnfollow"));
        } finally {
            setFollowSubmitting(false);
        }
    };

    return (
        <div className="mx-auto w-full max-w-7xl pt-4 md:pt-6 space-y-4">
            <AnimatePresence>
                {(queuedCount > 0 || queuedSkipped > 0) && (
                    <motion.div
                        key="queued-banner"
                        initial={{ opacity: 0, y: -8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.98 }}
                        transition={{
                            type: "spring",
                            stiffness: 420,
                            damping: 28,
                        }}
                        className="flex items-center justify-between gap-3 rounded-app border border-[rgba(var(--accent),0.35)] bg-[rgba(var(--accent),0.10)] px-4 py-2.5 text-sm text-white/90 backdrop-blur-[10px]"
                    >
                        <div>
                            {queuedCount > 0 && (
                                <>
                                    {t("artist.queuedAlbums", { count: queuedCount })}
                                    {queuedSkipped > 0 && <span className="text-white/60"> · </span>}
                                </>
                            )}
                            {queuedSkipped > 0 && (
                                <span className="text-white/60">
                                    {t("cloudLibrary.alreadyInLibrary", { count: queuedSkipped })}
                                </span>
                            )}
                            {queuedCount > 0 && (
                                <>
                                    {" "}
                                    <Link
                                        to="/"
                                        className="font-medium text-[rgb(var(--accent))] underline underline-offset-2 transition-colors hover:text-white"
                                    >
                                        {t("artist.openActivity")}
                                    </Link>
                                </>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setQueuedCount(0);
                                setQueuedSkipped(0);
                            }}
                            aria-label={t("artist.dismiss")}
                            className="shrink-0 inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-[rgba(var(--accent),0.25)] bg-[rgba(var(--accent),0.08)] text-white/75 transition-[background,border-color,color] duration-[250ms] ease-smooth hover:border-[rgba(var(--accent),0.45)] hover:bg-[rgba(var(--accent),0.18)] hover:text-white"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </motion.div>
                )}
                {followBanner && (
                    <motion.div
                        key="follow-banner"
                        initial={{ opacity: 0, y: -8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.98 }}
                        transition={{
                            type: "spring",
                            stiffness: 420,
                            damping: 28,
                        }}
                        className={
                            followBanner === "unfollowed"
                                ? "flex items-center justify-between gap-3 rounded-app border border-rose-300/30 bg-rose-500/10 px-4 py-2.5 text-sm text-white/90 backdrop-blur-[10px]"
                                : "flex items-center justify-between gap-3 rounded-app border border-[rgba(var(--accent),0.35)] bg-[rgba(var(--accent),0.10)] px-4 py-2.5 text-sm text-white/90 backdrop-blur-[10px]"
                        }
                    >
                        <div>
                            {followBanner === "unfollowed" ? (
                                <>
                                    <b>{artist?.name || t("artist.artistLabel")}</b>{" "}
                                    {t("artist.unfollowed")}
                                </>
                            ) : (
                                <>
                                    <b>{artist?.name || t("artist.artistLabel")}</b>{" "}
                                    {t("artist.isNowFollowed")}{" "}
                                    <Link
                                        to="/following"
                                        className="font-medium text-[rgb(var(--accent))] underline underline-offset-2 transition-colors hover:text-white"
                                    >
                                        {t("artist.openFollowing")}
                                    </Link>
                                </>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => setFollowBanner(null)}
                            aria-label={t("artist.dismiss")}
                            className="shrink-0 inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-[rgba(var(--accent),0.25)] bg-[rgba(var(--accent),0.08)] text-white/75 transition-[background,border-color,color] duration-[250ms] ease-smooth hover:border-[rgba(var(--accent),0.45)] hover:bg-[rgba(var(--accent),0.18)] hover:text-white"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
            {error && <Badge variant="bad">{error}</Badge>}
            {artist && (
                <>
                    <header>
                        <div className="text-xs uppercase tracking-wider text-white/55 mb-1">
                            {t("artist.artistLabel")}
                        </div>
                        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                            {artist.name}
                        </h1>
                        {artist.genreNames && artist.genreNames.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {artist.genreNames.slice(0, 4).map((g) => (
                                    <Badge key={g}>{g}</Badge>
                                ))}
                            </div>
                        )}
                        <div className="mt-4 flex flex-wrap gap-2">
                            {following ? (
                                <Button
                                    onClick={() => setUnfollowModalOpen(true)}
                                    disabled={followSubmitting}
                                    className="border-rose-300/30 bg-rose-500/10 text-rose-200 hover:border-rose-300/50 hover:bg-rose-500/20 hover:text-rose-100"
                                >
                                    <UserRoundMinus className="h-4 w-4" />
                                    {t("artist.unfollow")}
                                </Button>
                            ) : (
                                <Button
                                    onClick={() => setFollowModalOpen(true)}
                                    disabled={followSubmitting}
                                >
                                    <UserRoundCheck className="h-4 w-4" />
                                    {t("artist.follow")}
                                </Button>
                            )}
                            {albums.length > 0 && (
                                <Button onClick={() => setModalOpen(true)}>
                                    <ListChecks className="h-4 w-4" />
                                    {t("artist.downloadMultiple")}
                                </Button>
                            )}
                        </div>
                    </header>
                    <section>
                        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50 mb-3">
                            {t("artist.albums")}
                        </h2>
                        {albums.length === 0 ? (
                            <Card className="p-6 text-sm text-white/55">
                                {t("artist.noAlbumsFound")}
                            </Card>
                        ) : (
                            <StaggeredList className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
                                {albums.map((a) => (
                                    <StaggeredItem key={a.id}>
                                        <AlbumCard album={a} />
                                    </StaggeredItem>
                                ))}
                            </StaggeredList>
                        )}
                    </section>
                </>
            )}
            <SelectDownloadsModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                artistName={artist?.name || t("artist.artistLabel")}
                albums={albums}
                inLibraryMap={inLibraryAlbums}
                onQueued={(n, skipped) => {
                    setQueuedCount(n);
                    setQueuedSkipped(skipped);
                }}
            />
            <Modal
                open={followModalOpen}
                onClose={() => setFollowModalOpen(false)}
                label={t("artist.followArtist")}
                placement="center"
                className="!max-w-[40rem]"
            >
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[rgba(var(--accent),0.25)] bg-[rgba(var(--accent),0.12)] text-[rgb(var(--accent))]">
                            <Radar className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <div className="text-xs uppercase tracking-wider text-white/55">
                                {t("artist.followArtist")}
                            </div>
                            <h2 className="mt-1 text-lg font-semibold text-white">
                                {artist?.name || t("artist.artistLabel")}
                            </h2>
                            <p className="mt-2 text-sm text-white/60">
                                {t("artist.trackScopeForFutureReleases", {
                                    scope: releaseScopeLabel(followReleaseScope).toLowerCase(),
                                })}
                            </p>
                        </div>
                    </div>
                    <div className="mt-5">
                        <div className="mb-3">
                            <div className="text-xs uppercase tracking-wider text-white/55">
                                {t("artist.releaseScope")}
                            </div>
                            <div className="mt-1 text-sm text-white/60">
                                {t("artist.chooseWhatToWatch")}
                            </div>
                        </div>
                        <ReleaseScopePicker
                            value={followReleaseScope}
                            onChange={setFollowReleaseScope}
                        />
                    </div>
                    {appSettings?.promptForDownloadQuality && (
                        <div className="mt-5">
                            <div className="mb-3">
                                <div className="text-xs uppercase tracking-wider text-white/55">
                                    {t("artist.downloadQuality")}
                                </div>
                                <div className="mt-1 text-sm text-white/60">
                                    {t("artist.appliesIfDownloadDiscographyNow")}
                                </div>
                            </div>
                            <QualityPicker
                                value={followQuality}
                                onChange={setFollowQuality}
                            />
                        </div>
                    )}
                    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button
                            onClick={() => setFollowModalOpen(false)}
                            disabled={followSubmitting}
                            variant="ghost"
                        >
                            {t("artist.cancel")}
                        </Button>
                        <Button
                            onClick={() => followArtist(false)}
                            disabled={followSubmitting}
                        >
                            {t("artist.futureReleasesOnly")}
                        </Button>
                        <Button
                            onClick={() => followArtist(true)}
                            disabled={followSubmitting}
                        >
                            {t("artist.downloadMatchingReleases")}
                        </Button>
                    </div>
                </div>
            </Modal>
            <Modal
                open={unfollowModalOpen}
                onClose={() => setUnfollowModalOpen(false)}
                label={t("artist.unfollowArtist")}
                placement="center"
                className="!max-w-[36rem]"
            >
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-rose-300/30 bg-rose-500/10 text-rose-200">
                            <UserRoundMinus className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <div className="text-xs uppercase tracking-wider text-white/55">
                                {t("artist.unfollowArtist")}
                            </div>
                            <h2 className="mt-1 text-lg font-semibold text-white">
                                {artist?.name || t("artist.artistLabel")}
                            </h2>
                            <p className="mt-2 text-sm text-white/60">
                                {t("artist.stopWatchingConfirm")}
                            </p>
                        </div>
                    </div>
                    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button
                            onClick={() => setUnfollowModalOpen(false)}
                            disabled={followSubmitting}
                            variant="ghost"
                        >
                            {t("artist.cancel")}
                        </Button>
                        <Button
                            onClick={unfollowArtist}
                            disabled={followSubmitting}
                            className="border-rose-300/30 bg-rose-500/10 text-rose-200 hover:border-rose-300/50 hover:bg-rose-500/20 hover:text-rose-100"
                        >
                            <UserRoundMinus className="h-4 w-4" />
                            {t("artist.unfollow")}
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
