import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { TaskList as ListChecks, Xmark as X } from "iconoir-react";
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
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { StaggeredList, StaggeredItem } from "../components/StaggeredList";
import { useLibraryPresence } from "../hooks/useLibraryPresence";
import { CoverWash } from "../components/CoverWash";

const GRID =
    "grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]";

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

// A curator's or label's head: a page about one image, so the page wears its colors and its wash.
function Header({ kind, item, children }: { kind: string; item: BrowseHeader; children?: React.ReactNode }) {
    return (
        <header className="pb-1 pt-6">
            <CoverWash template={item.artworkTemplate} />
            <div className="caption mb-1">{kind}</div>
            <h1 className="text-[31px] leading-10 md:text-[34px] md:leading-[42px]">
                {item.name}
            </h1>
            {item.description && (
                <p className="mt-2 line-clamp-3 max-w-3xl text-[15px] text-quiet">
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
            <h2 className="section-title">{title}</h2>
            {empty ? (
                <p className="px-2 py-2 text-[15px] text-quiet">{emptyText}</p>
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
        <div className="flex w-full flex-col gap-[26px]">
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
        <div className="flex w-full flex-col gap-[26px]">
            <div className="messages">
            <AnimatePresence>
                {(queuedStats.queued > 0 || queuedStats.skippedExisting > 0) && (
                    <motion.div
                        key="queued-banner"
                        initial={{ opacity: 0, y: -8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.98 }}
                        transition={{ type: "spring", stiffness: 420, damping: 28 }}
                        className="message"
                    >
                        <div>
                            {queuedStats.queued > 0 && (
                                <>
                                    {t("artist.queuedAlbums", { count: queuedStats.queued })}
                                    {queuedStats.skippedExisting > 0 && <span className="text-quiet"> · </span>}
                                </>
                            )}
                            {queuedStats.skippedExisting > 0 && (
                                <span className="text-quiet">
                                    {t("cloudLibrary.alreadyInLibrary", { count: queuedStats.skippedExisting })}
                                </span>
                            )}
                            {queuedStats.queued > 0 && (
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
                            onClick={() => setQueuedStats({ queued: 0, skippedExisting: 0 })}
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
            {data && (
                <>
                    <Header kind={t("browse.labelLabel")} item={data.label}>
                        {albums.length > 0 && (
                            <div className="mt-4 flex flex-wrap gap-2">
                                <Button variant="primary" onClick={() => setModalOpen(true)} className="min-h-[46px] px-5 text-[15px]">
                                    <ListChecks />
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
