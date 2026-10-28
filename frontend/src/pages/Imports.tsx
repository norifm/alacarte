import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  Clock,
  PagePlus as FileUp,
  RefreshDouble as Loader2,
  Refresh as RefreshCw,
  Xmark as X,
} from "iconoir-react";

import { api, type ImportedFile } from "../api/client";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PageTitle } from "../components/PageTitle";
import { Dots } from "../components/Dots";
import { StaggeredItem, StaggeredList } from "../components/StaggeredList";
import i18n from "../i18n";

export function ImportsPage() {
    const { t } = useTranslation();
    const [files, setFiles] = useState<ImportedFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [runningFileId, setRunningFileId] = useState<string | null>(null);
    const [removingFileId, setRemovingFileId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const reload = () => {
        setError(null);
        api.importFiles()
            .then((response) => setFiles(response.files))
            .catch((err) => setError(err.message || t("imports.errorLoad")))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        reload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const pickFiles = () => inputRef.current?.click();

    const onFilesChosen = async (
        event: React.ChangeEvent<HTMLInputElement>,
    ) => {
        // FileList is live in chromium/webkit: copy before clearing the input
        const picked = [...(event.target.files ?? [])];
        event.target.value = "";
        if (picked.length === 0) return;
        setUploading(true);
        setError(null);
        try {
            const contents = await Promise.all(
                picked.map(async (file) => ({
                    name: file.name,
                    content: await file.text(),
                })),
            );
            const response = await api.importFilesAdd(contents);
            const broken = response.files.filter((file: any) => file.error);
            if (broken.length > 0) {
                setError(
                    broken
                        .map((file: any) => `${file.name}: ${file.error}`)
                        .join(", ") || t("imports.errorAdd"),
                );
            }
            const list = await api.importFiles();
            setFiles(list.files);
        } catch (err: any) {
            setError(err.message || t("imports.errorAdd"));
        } finally {
            setUploading(false);
        }
    };

    const rerunFile = async (id: string) => {
        setRunningFileId(id);
        setError(null);
        try {
            const response = await api.importFilesRun(id);
            setFiles((items) =>
                items.map((file) => (file.id === id ? response.file : file)),
            );
        } catch (err: any) {
            setError(err.message || t("imports.errorResync"));
        } finally {
            setRunningFileId(null);
        }
    };

    const removeFile = async (id: string) => {
        const previous = files;
        setRemovingFileId(id);
        setFiles((items) => items.filter((file) => file.id !== id));
        try {
            await api.importFilesRemove(id);
        } catch (err: any) {
            setFiles(previous);
            setError(err.message || t("imports.errorRemove"));
        } finally {
            setRemovingFileId(null);
        }
    };

    const addButton = (
        <Button onClick={pickFiles} disabled={uploading} className="whitespace-nowrap">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            {uploading ? t("imports.adding") : t("imports.add")}
        </Button>
    );

    return (
        <div className="flex w-full flex-col gap-[26px]">
            {error && <Badge variant="bad">{error}</Badge>}

            <PageTitle aside={!loading && files.length > 0 && addButton}>
                {t("imports.title")}
            </PageTitle>

            <input
                ref={inputRef}
                type="file"
                multiple
                accept=".csv,.txt,.tsv,text/plain,text/csv,text/*"
                className="hidden"
                onChange={onFilesChosen}
            />

            {loading ? (
                <div className="flex justify-center py-16" aria-label={t("imports.loading")}>
                    <Dots />
                </div>
            ) : files.length === 0 ? (
                <div className="empty-note">
                    <div className="mb-3.5 grid h-16 w-16 place-items-center rounded-full bg-[var(--veil)] text-quiet">
                        <FileUp className="h-7 w-7" />
                    </div>
                    <p className="text-[15px] font-medium text-quiet">
                        {t("imports.empty")}
                    </p>
                    <div className="mt-4">{addButton}</div>
                </div>
            ) : (
                <StaggeredList className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <AnimatePresence initial={false}>
                        {files.map((file) => (
                            <StaggeredItem key={file.id}>
                                <ImportedFileCard
                                    file={file}
                                    running={runningFileId === file.id}
                                    removing={removingFileId === file.id}
                                    onRerun={() => rerunFile(file.id)}
                                    onRemove={() => removeFile(file.id)}
                                />
                            </StaggeredItem>
                        ))}
                    </AnimatePresence>
                </StaggeredList>
            )}
        </div>
    );
}

function ImportedFileCard({
    file,
    running,
    removing,
    onRerun,
    onRemove,
}: {
    file: ImportedFile;
    running: boolean;
    removing: boolean;
    onRerun: () => void;
    onRemove: () => void;
}) {
    const { t } = useTranslation();
    const counts = file.counts;
    const failedCount = counts.failed.length;
    return (
        <motion.div
            layout
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="h-full"
        >
            <Card
                hover
                className="group relative flex h-full flex-col gap-4 overflow-hidden p-4"
            >
                <div className="flex flex-1 flex-col gap-3">
                    <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center plate rounded-cover">
                            <FileUp className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div
                                className="truncate text-base font-semibold text-white"
                                title={file.name}
                            >
                                {file.name}
                            </div>
                            <div className="mt-0.5 truncate text-[13px] text-quiet">
                                {t("imports.linkCount", {
                                    count: counts.links,
                                })}
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {counts.playlists > 0 && (
                            <Badge>
                                {t("imports.countsPlaylists", {
                                    count: counts.playlists,
                                })}
                            </Badge>
                        )}
                        {counts.albums > 0 && (
                            <Badge>
                                {t("imports.countsAlbums", {
                                    count: counts.albums,
                                })}
                            </Badge>
                        )}
                        {counts.songs > 0 && (
                            <Badge>
                                {t("imports.countsSongs", {
                                    count: counts.songs,
                                })}
                            </Badge>
                        )}
                        {counts.artists > 0 && (
                            <Badge>
                                {t("imports.countsArtists", {
                                    count: counts.artists,
                                })}
                            </Badge>
                        )}
                        {counts.invalid > 0 && (
                            <Badge variant="warn">
                                {t("imports.invalid", {
                                    count: counts.invalid,
                                })}
                            </Badge>
                        )}
                    </div>
                </div>
                <div className="mt-auto flex flex-col gap-3">
                    {(counts.queued > 0 ||
                        counts.skippedExisting > 0 ||
                        failedCount > 0) && (
                        <div className="flex flex-wrap gap-1.5 text-xs">
                            {counts.queued > 0 && (
                                <span className="text-white">
                                    {t("imports.queued", {
                                        count: counts.queued,
                                    })}
                                </span>
                            )}
                            {counts.queued > 0 &&
                                counts.skippedExisting > 0 && (
                                    <span className="text-quiet">·</span>
                                )}
                            {counts.skippedExisting > 0 && (
                                <span className="text-quiet">
                                    {t("cloudLibrary.alreadyInLibrary", {
                                        count: counts.skippedExisting,
                                    })}
                                </span>
                            )}
                            {counts.queued > 0 &&
                                counts.skippedExisting > 0 &&
                                failedCount > 0 && (
                                    <span className="text-quiet">·</span>
                                )}
                            {failedCount > 0 && (
                                <span className="text-amber-300/90">
                                    {t("imports.failed", {
                                        count: failedCount,
                                    })}
                                </span>
                            )}
                        </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5 text-xs text-quiet">
                            <Clock className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">
                                {file.lastRunAt
                                    ? t("imports.lastRun", {
                                          time: formatRelativeTime(
                                              file.lastRunAt,
                                          ),
                                      })
                                    : t("imports.waitingFirstRun")}
                            </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <button
                                type="button"
                                onClick={onRerun}
                                disabled={running || removing}
                                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--plate)] px-3 text-[13px] font-medium text-[var(--plate-ink)] transition-opacity hover:opacity-85 disabled:opacity-40"
                            >
                                <RefreshCw
                                    className={
                                        running
                                            ? "h-3.5 w-3.5 animate-spin"
                                            : "h-3.5 w-3.5"
                                    }
                                />
                                {running
                                    ? t("imports.resyncing")
                                    : t("imports.resync")}
                            </button>
                            <button
                                type="button"
                                onClick={onRemove}
                                disabled={running || removing}
                                aria-label={t("imports.remove")}
                                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-quiet transition-colors hover:bg-[var(--hover)] hover:text-rose-500 disabled:opacity-40"
                            >
                                <X className="h-3.5 w-3.5" />
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
    if (diff < 60_000)
        return i18n.t("following.relativeSecondsAgo", {
            count: Math.round(diff / 1000),
        });
    if (diff < 3_600_000)
        return i18n.t("following.relativeMinutesAgo", {
            count: Math.round(diff / 60_000),
        });
    if (diff < 86_400_000)
        return i18n.t("following.relativeHoursAgo", {
            count: Math.round(diff / 60_000),
        });
    return i18n.t("following.relativeDaysAgo", {
        count: Math.round(diff / 86_400_000),
    });
}
