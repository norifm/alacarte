import express from 'express'

import { isMissingCatalogResource, sendAppleError } from '../lib/appleErrors.mjs'
import { readSettings } from '../lib/settingsStore.mjs'
import { loadCurator, loadRecordLabel } from '../lib/browseCatalog.mjs'

function browseRoute(load, what) {
  const router = express.Router()
  router.get('/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim()
      if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'id required' })
      const settings = await readSettings()
      const storefront = String(req.query.storefront || settings.storefront || 'us')
      const result = await load({
        id,
        storefront,
        language: settings.language || 'en-US',
        explicitFilter: settings.explicitFilter || 'explicit',
      })
      if (!result) return res.status(404).json({ error: `${what} not found` })
      res.json({ ...result, storefront })
    } catch (err) {
      if (isMissingCatalogResource(err)) {
        return res.status(404).json({ error: `${what} not found` })
      }
      sendAppleError(res, err)
    }
  })
  return router
}

export const curatorRouter = browseRoute(loadCurator, 'curator')
export const labelRouter = browseRoute(loadRecordLabel, 'label')
