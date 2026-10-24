import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ListChecks, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";

import {
    api,
    type Album,
    type BrowseHeader,
    type Playlist,
} from "../api/client";
import { AlbumCard } from "../components/AlbumCard";
import { PlaylistCard } from "../components/PlaylistCard";
import { SelectDownloadsModal } from "../components/SelectDownloadsModal";
import { Card } from "../components/Card";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { StaggeredList, StaggeredItem } from "../components/StaggeredList";
import { useLibraryPresence } from "../hooks/useLibraryPresence";

const GRID =
    "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4";

function useBrowse<T>(
    id: string | undefined,
    load: (id: string, storefront: string | null) => Promise<T>,
) {
    const { t } = useTranslation();
    const storefront = useSearchParams()[0].get("storefront");
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (!id) return;
        let cancelled = false;
        setData(null);
        setError(null);
        load(id, storefront)
            .then((r) => {
                if (!cancelled) setData(r);
            })
            .catch((err) => {
                if (!cancelled) setError(err.message || t("artist.loadError"));
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, storefront]);
    return { data, error };
}

function Header({ kind, item, children }: { kind: string; item: BrowseHeader; children?: React.ReactNode }) {
    return (
        <header>
            <div className="text-xs uppercase tracking-wider text-white/55 mb-1">
                {kind}
            </div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                {item.name}
            </h1>
            {item.description && (
                <p className="mt-2 max-w-3xl text-sm text-white/50 line-clamp-3">
                    {item.description}
                </p>
            )}
            {children}
        </header>
    );
}

function Section({ title, empty, emptyText, children }: { title: string; empty: boolean; emptyText: string; children: React.ReactNode }) {
    return (
        <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50 mb-3">
                {title}
            </h2>
            {empty ? (
                <Card className="p-6 text-sm text-white/55">{emptyText}</Card>
            ) : (
                children
            )}
        </section>
    );
}

export function CuratorPage() {
    const { t } = useTranslation();
    const { id } = useParams<{ id: string }>();
    const { data, error } = useBrowse(id, api.curator);
    return (
        <div className="mx-auto w-full max-w-7xl pt-4 md:pt-6 space-y-4">
            {error && <Badge variant="bad">{error}</Badge>}
            {data && (
                <>
                    <Header kind={t("browse.curatorLabel")} item={data.curator} />
                    <Section
                        title={t("search.playlists")}
                        empty={data.playlists.length === 0}
                        emptyText={t("library.noPlaylistsFound")}
                    >
                        <StaggeredList className={GRID}>
                            {data.playlists.map((p: Playlist) => (
                                <StaggeredItem key={p.id}>
                                    <PlaylistCard playlist={p} />
                                </StaggeredItem>
                            ))}
                        </StaggeredList>
                    </Section>
                </>
            )}
        </div>
    );
}

export function LabelPage() {
    const { t } = useTranslation();
    const { id } = useParams<{ id: string }>();
    const { data, error } = useBrowse(id, api.label);
    const [modalOpen, setModalOpen] = useState(false);
    const [queuedStats, setQueuedStats] = useState({ queued: 0, skippedExisting: 0 });
    const { isAlbumInLibrary } = useLibraryPresence();

    useEffect(() => {
        if (!queuedStats.queued && !queuedStats.skippedExisting) return;
        const timer = setTimeout(
            () => setQueuedStats({ queued: 0, skippedExisting: 0 }),
            6000,
        );
        return () => clearTimeout(timer);
    }, [queuedStats]);

    const albums = useMemo(() => data?.albums || [], [data]);

    const inLibraryAlbums = useMemo(
        () => Object.fromEntries(albums.map((a) => [a.id, isAlbumInLibrary(a)])),
        [albums, isAlbumInLibrary],
    );

    const grid = (list: Album[]) => (
        <StaggeredList className={GRID}>
            {list.map((a) => (
                <StaggeredItem key={a.id}>
                    <AlbumCard album={a} />
                </StaggeredItem>
            ))}
        </StaggeredList>
    );

    return (
        <div className="mx-auto w-full max-w-7xl pt-4 md:pt-6 space-y-4">
            <AnimatePresence>
                {(queuedStats.queued > 0 || queuedStats.skippedExisting > 0) && (
                    <motion.div
                        key="queued-banner"
                        initial={{ opacity: 0, y: -8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.98 }}
                        transition={{ type: "spring", stiffness: 420, damping: 28 }}
                        className="flex items-center justify-between gap-3 rounded-app border border-[rgba(var(--accent),0.35)] bg-[rgba(var(--accent),0.10)] px-4 py-2.5 text-sm text-white/90 backdrop-blur-[10px]"
                    >
                        <div>
                            {queuedStats.queued > 0 && (
                                <>
                                    {t("artist.queuedAlbums", { count: queuedStats.queued })}
                                    {queuedStats.skippedExisting > 0 && <span className="text-white/60"> · </span>}
                                </>
                            )}
                            {queuedStats.skippedExisting > 0 && (
                                <span className="text-white/60">
                                    {t("cloudLibrary.alreadyInLibrary", { count: queuedStats.skippedExisting })}
                                </span>
                            )}
                            {queuedStats.queued > 0 && (
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
                            onClick={() => setQueuedStats({ queued: 0, skippedExisting: 0 })}
                            aria-label={t("artist.dismiss")}
                            className="shrink-0 inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-[rgba(var(--accent),0.25)] bg-[rgba(var(--accent),0.08)] text-white/75 transition-[background,border-color,color] duration-[250ms] ease-smooth hover:border-[rgba(var(--accent),0.45)] hover:bg-[rgba(var(--accent),0.18)] hover:text-white"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
            {error && <Badge variant="bad">{error}</Badge>}
            {data && (
                <>
                    <Header kind={t("browse.labelLabel")} item={data.label}>
                        {albums.length > 0 && (
                            <div className="mt-4 flex flex-wrap gap-2">
                                <Button onClick={() => setModalOpen(true)}>
                                    <ListChecks className="h-4 w-4" />
                                    {t("artist.downloadMultiple")}
                                </Button>
                            </div>
                        )}
                    </Header>
                    <Section
                        title={t("browse.latestReleases")}
                        empty={data.latestReleases.length === 0}
                        emptyText={t("artist.noAlbumsFound")}
                    >
                        {grid(data.latestReleases)}
                    </Section>
                    {data.topReleases.length > 0 && (
                        <Section
                            title={t("browse.topReleases")}
                            empty={false}
                            emptyText=""
                        >
                            {grid(data.topReleases)}
                        </Section>
                    )}
                </>
            )}
            <SelectDownloadsModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                artistName={data?.label.name || t("browse.labelLabel")}
                albums={albums}
                inLibraryMap={inLibraryAlbums}
                onQueued={(queued, skippedExisting) =>
                    setQueuedStats({ queued, skippedExisting })
                }
            />
        </div>
    );
}
