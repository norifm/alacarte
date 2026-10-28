import { useEffect, useState } from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import { Drag as GripVertical, Pause, Play } from 'iconoir-react'
import { useTranslation } from 'react-i18next'

import { api, type Job } from '../api/client'
import { useQueue } from '../hooks/useQueue'
import { QueueItem } from '../components/QueueItem'
import { Card } from '../components/Card'
import { Button } from '../components/Button'

function QueuedRow({ job, isFirst, onMoveTop, onDragEnd }: {
  job: Job
  isFirst: boolean
  onMoveTop: () => void
  onDragEnd: () => void
}) {
  const { t } = useTranslation()
  const controls = useDragControls()
  return (
    <Reorder.Item value={job.id} dragListener={false} dragControls={controls} onDragEnd={onDragEnd} className="bg-surface">
      <QueueItem
        job={job}
        onMoveTop={isFirst ? undefined : onMoveTop}
        dragHandle={
          <button
            type="button"
            aria-label={t('queueItem.dragToReorder')}
            onPointerDown={(e) => controls.start(e)}
            className="shrink-0 h-10 w-6 flex items-center justify-center text-quiet hover:text-white/70 cursor-grab active:cursor-grabbing touch-none"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        }
      />
    </Reorder.Item>
  )
}

export function QueuePage() {
  const { t } = useTranslation()
  const { active, recent, paused } = useQueue()
  const running = active.filter((j) => j.status === 'running')
  const queued = active.filter((j) => j.status === 'queued')
  const byId = new Map(queued.map((j) => [j.id, j]))

  // Local order while dragging; snaps back to the server order otherwise.
  const serverOrder = queued.map((j) => j.id).join('\n')
  const [order, setOrder] = useState<string[]>(queued.map((j) => j.id))
  useEffect(() => {
    setOrder(serverOrder ? serverOrder.split('\n') : [])
  }, [serverOrder])

  const commit = (ids: string[]) => {
    setOrder(ids)
    api.reorderQueue(ids).catch(() => setOrder(serverOrder ? serverOrder.split('\n') : []))
  }

  const togglePause = () => {
    ;(paused ? api.resumeQueue() : api.pauseQueue()).catch(() => {})
  }

  return (
    <div className="flex w-full flex-col gap-[26px]">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="section-title !mb-0">
            {t('queue.activeCount', { count: active.length })}
          </h2>
          <Button variant="ghost" onClick={togglePause}>
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? t('queue.resume') : t('queue.pause')}
          </Button>
        </div>
        {paused && (
          <Card className="mb-2 p-4 text-sm text-amber-500">{t('queue.pausedNotice')}</Card>
        )}
        {active.length === 0 ? (
          <p className="px-2 py-2 text-[15px] text-quiet">{t('queue.nothingActive')}</p>
        ) : (
          <div className="rows [--row-text:68px]">
            {running.map((j) => (
              <QueueItem key={j.id} job={j} />
            ))}
            <Reorder.Group axis="y" values={order} onReorder={setOrder} className="rows [--row-text:74px]">
              {order
                .filter((id) => byId.has(id))
                .map((id, i) => (
                  <QueuedRow
                    key={id}
                    job={byId.get(id)!}
                    isFirst={i === 0}
                    onMoveTop={() => commit([id, ...order.filter((x) => x !== id)])}
                    onDragEnd={() => commit(order)}
                  />
                ))}
            </Reorder.Group>
          </div>
        )}
      </section>
      <section>
        <h2 className="section-title">
          {t('queue.historyCount', { count: recent.length })}
        </h2>
        {recent.length === 0 ? (
          <p className="px-2 py-2 text-[15px] text-quiet">
            {t('queue.noCompletedDownloads')}
          </p>
        ) : (
          <div className="rows [--row-text:68px]">
            {recent.slice(0, 50).map((j) => (
              <QueueItem key={j.id} job={j} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
