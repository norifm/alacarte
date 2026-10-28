import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  TaskList as ListChecks,
  Antenna as Radar,
  UserBadgeCheck as UserRoundCheck,
  UserXmark as UserRoundMinus,
  Xmark as X,
} from "iconoir-react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";

import {
    api,
    artworkUrl,
    type Album,
    type Artist as ArtistT,
    type QualityPreference,
    type ReleaseScope,
} from "../api/client";
import { AlbumCard } from "../components/AlbumCard";
import { SelectDownloadsModal } from "../components/SelectDownloadsModal";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { QualityPicker } from "../components/QualityPicker";
import {
    ReleaseScopePicker,
    releaseScopeLabel,
} from "../components/ReleaseScopePicker";
import { CoverWash } from "../components/CoverWash";
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
        <div className="w-full">
            <div className="messages">
            <AnimatePresence>
                {(queuedCount > 0 || queuedSkipped > 0) && (
                    <motion.div
                        key="queued-banner"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        className="message"
                    >
                        <div>
                            {queuedCount > 0 && (
                                <>
                                    {t("artist.queuedAlbums", { count: queuedCount })}
                                    {queuedSkipped > 0 && <span className="text-quiet"> · </span>}
                                </>
                            )}
                            {queuedSkipped > 0 && (
                                <span className="text-quiet">
                                    {t("cloudLibrary.alreadyInLibrary", { count: queuedSkipped })}
                                </span>
                            )}
                            {queuedCount > 0 && (
                                <>
                                    {" "}
                                    <Link
                                        to="/"
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
                            className="glyph h-9 w-9"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </motion.div>
                )}
                {followBanner && (
                    <motion.div
                        key="follow-banner"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        className={
                            followBanner === "unfollowed"
                                ? "message"
                                : "message"
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
                            className="glyph h-9 w-9"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
            </div>
            {error && <Badge variant="bad">{error}</Badge>}
            {artist && (
                <>
                    <CoverWash template={artist.artworkTemplate} />
                    <ArtistBanner template={artist.artworkTemplate} />
                    <header className="flex min-h-[calc(max(340px,52vh)-110px)] flex-col items-center justify-end gap-4 pb-2 text-center md:min-h-[calc(max(420px,64vh)-110px)]">
                        <div>
                            <h1 className="text-[34px] font-extrabold leading-[1.1] tracking-[-1px] md:text-[44px]">
                                {artist.name}
                            </h1>
                            {artist.genreNames && artist.genreNames.length > 0 && (
                                <div className="caption mt-2">
                                    {artist.genreNames.slice(0, 4).join(" · ")}
                                </div>
                            )}
                        </div>
                        <div className="flex w-full flex-wrap items-center justify-center gap-2.5 md:w-auto">
                            {following ? (
                                <Button
                                    onClick={() => setUnfollowModalOpen(true)}
                                    disabled={followSubmitting}
                                    className="min-h-[46px] px-5 text-[15px]"
                                >
                                    <UserRoundMinus className="text-accent" />
                                    {t("artist.unfollow")}
                                </Button>
                            ) : (
                                <Button
                                    onClick={() => setFollowModalOpen(true)}
                                    disabled={followSubmitting}
                                    className="min-h-[46px] px-5 text-[15px]"
                                >
                                    <UserRoundCheck />
                                    {t("artist.follow")}
                                </Button>
                            )}
                            {albums.length > 0 && (
                                <Button
                                    variant="primary"
                                    onClick={() => setModalOpen(true)}
                                    className="min-h-[46px] min-w-[180px] px-5 text-[15px]"
                                >
                                    <ListChecks />
                                    {t("artist.downloadMultiple")}
                                </Button>
                            )}
                        </div>
                    </header>
                    <section className="mt-[26px]">
                        <h2 className="section-title">{t("artist.albums")}</h2>
                        {albums.length === 0 ? (
                            <p className="py-10 text-center font-medium text-quiet">
                                {t("artist.noAlbumsFound")}
                            </p>
                        ) : (
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
                                {albums.map((a) => (
                                    <AlbumCard key={a.id} album={a} />
                                ))}
                            </div>
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
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center text-quiet">
                            <Radar className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-quiet">
                                {t("artist.followArtist")}
                            </div>
                            <h2 className="mt-1 text-lg font-semibold text-white">
                                {artist?.name || t("artist.artistLabel")}
                            </h2>
                            <p className="mt-2 text-sm text-quiet">
                                {t("artist.trackScopeForFutureReleases", {
                                    scope: releaseScopeLabel(followReleaseScope).toLowerCase(),
                                })}
                            </p>
                        </div>
                    </div>
                    <div className="mt-5">
                        <div className="mb-3">
                            <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-quiet">
                                {t("artist.releaseScope")}
                            </div>
                            <div className="mt-1 text-sm text-quiet">
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
                                <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-quiet">
                                    {t("artist.downloadQuality")}
                                </div>
                                <div className="mt-1 text-sm text-quiet">
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
                            variant="primary"
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
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center text-quiet">
                            <UserRoundMinus className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-quiet">
                                {t("artist.unfollowArtist")}
                            </div>
                            <h2 className="mt-1 text-lg font-semibold text-white">
                                {artist?.name || t("artist.artistLabel")}
                            </h2>
                            <p className="mt-2 text-sm text-quiet">
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
                            variant="ghost"
                            className="!text-rose-500"
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

// The artist's picture across the page's whole width, dissolving into the page's paper; it drifts up slower
// than the page as the page scrolls and fades as it goes.
function ArtistBanner({ template }: { template?: string | null }) {
    const [loaded, setLoaded] = useState(false);
    const ref = useRef<HTMLDivElement | null>(null);
    const src = artworkUrl(template, 1400);
    useEffect(() => {
        const b = ref.current;
        const page = document.getElementById("main");
        if (!b || !page) return;
        const moved = () => {
            const top = page.scrollTop;
            b.style.transform = `translateY(${(top * 0.55).toFixed(1)}px)`;
            b.style.opacity = String(1 + Math.max(-0.8, -top / b.offsetHeight));
        };
        moved();
        page.addEventListener("scroll", moved, { passive: true });
        return () => page.removeEventListener("scroll", moved);
    }, []);
    return (
        <div
            ref={ref}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[max(340px,52vh)] overflow-hidden will-change-transform md:h-[max(420px,64vh)]"
        >
            {src && (
                <img
                    src={src}
                    alt=""
                    onLoad={() => setLoaded(true)}
                    className={`absolute inset-0 h-full w-full object-cover object-[50%_30%] transition-opacity duration-[400ms] ease-out ${loaded ? "opacity-100" : "opacity-0"}`}
                />
            )}
            <div
                className="absolute inset-0"
                style={{
                    background:
                        "linear-gradient(transparent 45%, color-mix(in srgb, var(--page) 70%, transparent) 78%, var(--page))",
                }}
            />
        </div>
    );
}
