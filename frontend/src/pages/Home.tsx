import { useState } from 'react'
import {
  CheckCircle as CheckCircle2,
  WarningCircle as AlertCircle,
  RefreshDouble as Loader2,
  XmarkCircle as XCircle,
} from 'iconoir-react'
import { useTranslation } from 'react-i18next'

import { api } from '../api/client'
import { useQueue } from '../hooks/useQueue'
import { QueueItem } from '../components/QueueItem'
import { PageTitle } from '../components/PageTitle'
import { Dots } from '../components/Dots'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'

export function HomePage() {
  const { t } = useTranslation()
  const { active, recent, loading } = useQueue()
  const recentList = recent.slice(0, 50)
  const [confirmAbortAll, setConfirmAbortAll] = useState(false)
  const [abortingAll, setAbortingAll] = useState(false)

  return (
    <div className="flex w-full flex-col gap-[26px]">
      <PageTitle>{t('home.title')}</PageTitle>

      {loading ? (
        <div className="flex justify-center py-16">
          <Dots />
        </div>
      ) : (
        <div className="flex flex-col gap-[26px]">
          <section>
            <div className="mb-3 flex min-h-11 items-center justify-between gap-3">
              <h2 className="section-title !mb-0">
                <Loader2 /> {t('home.active')}
              </h2>
              {active.length > 0 && (
                <Button variant="ghost" onClick={() => setConfirmAbortAll(true)} className="!text-rose-500">
                  <XCircle />
                  {t('home.abortAll')}
                </Button>
              )}
            </div>
            {active.length === 0 ? (
              <p className="px-2 py-2 text-[15px] text-quiet">
                {t('home.noActiveDownloads')}
              </p>
            ) : (
              <div className="rows [--row-text:68px]">
                {active.map((j) => (
                  <QueueItem key={j.id} job={j} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="section-title">
              <CheckCircle2 /> {t('home.recentlyImported')}
            </h2>
            {recentList.length === 0 ? (
              <p className="flex items-center gap-2 px-2 py-2 text-[15px] text-quiet">
                <AlertCircle className="h-4 w-4" />
                {t('home.noRecentDownloads')}
              </p>
            ) : (
              <div className="rows [--row-text:68px]">
                {recentList.map((j) => (
                  <QueueItem key={j.id} job={j} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <Modal
        open={confirmAbortAll}
        onClose={() => {
          if (!abortingAll) setConfirmAbortAll(false)
        }}
        className="max-w-md p-6"
        label={t('home.confirmAbortAllLabel')}
        placement="center"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-rose-500">
            <XCircle className="h-3.5 w-3.5" />
            {t('home.abortDownloadsBadge')}
          </div>
          <h3 className="text-lg font-semibold leading-tight text-white">
            {t('home.abortConfirmTitle', { count: active.length })}
          </h3>
          <p className="text-sm text-quiet">
            {t('home.abortConfirmBody')}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmAbortAll(false)} disabled={abortingAll}>
              {t('home.cancel')}
            </Button>
            <Button
              onClick={async () => {
                setAbortingAll(true)
                try {
                  await api.cancelAll()
                  setConfirmAbortAll(false)
                } finally {
                  setAbortingAll(false)
                }
              }}
              disabled={abortingAll || active.length === 0}
              variant="ghost" className="!text-rose-500"
            >
              {abortingAll ? t('home.aborting') : t('home.abortAll')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
