import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { QualityPreference } from '../api/client'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { QualityPicker } from '../components/QualityPicker'
import { useAppSettings } from './useAppSettings'

type PendingPrompt = {
  resolve: (value: QualityPreference | false) => void
}

export function useDownloadQualityPrompt() {
  const { t } = useTranslation()
  const settings = useAppSettings()
  const [selected, setSelected] = useState<QualityPreference>('flac')
  const [pending, setPending] = useState<PendingPrompt | null>(null)

  useEffect(() => {
    if (settings?.quality) setSelected(settings.quality)
  }, [settings?.quality])

  const chooseDownloadQuality = async (): Promise<QualityPreference | undefined | false> => {
    if (!settings?.promptForDownloadQuality) return undefined
    setSelected(settings.quality)
    return new Promise((resolve) => {
      setPending({ resolve })
    })
  }

  const close = () => {
    pending?.resolve(false)
    setPending(null)
  }

  const confirm = () => {
    pending?.resolve(selected)
    setPending(null)
  }

  const qualityPrompt = (
    <Modal
      open={pending !== null}
      onClose={close}
      placement="center"
      label={t('downloadQualityPrompt.chooseDownloadQuality')}
      className="!max-w-[30rem]"
    >
      <div className="p-6">
        <div>
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-quiet">{t('downloadQualityPrompt.chooseDownloadQuality')}</div>
          <h2 className="mt-1 text-lg font-semibold text-white">{t('downloadQualityPrompt.chooseQuality')}</h2>
          <p className="mt-2 text-sm text-quiet">
            {t('downloadQualityPrompt.appliesToThisDownloadOnly')}
          </p>
        </div>
        <QualityPicker value={selected} onChange={setSelected} className="mt-5" />
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={close} variant="ghost">
            {t('downloadQualityPrompt.cancel')}
          </Button>
          <Button onClick={confirm}>
            {t('downloadQualityPrompt.queueDownload')}
          </Button>
        </div>
      </div>
    </Modal>
  )

  return { chooseDownloadQuality, qualityPrompt }
}
