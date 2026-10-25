import { getMyStorefront } from './appleLibraryApi.mjs'
import { readAppleCreds, readSettings, writeSettings } from './settingsStore.mjs'

let inFlight = null

// Apple returns the account's real storefront at /v1/me/storefront. Catalog
// album ids only resolve inside that storefront, so a settings.storefront that
// disagrees with the account makes every download of a region-locked album fail
// with "error getting album response". Keep the two in sync automatically.
export function detectAndApplyStorefront() {
  if (inFlight) return inFlight
  inFlight = run().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function run() {
  try {
    const settings = await readSettings()
    if (!settings.autoStorefront) return { ok: false, reason: 'disabled' }

    const creds = await readAppleCreds()
    if (!creds.mediaUserToken) return { ok: false, reason: 'no-media-user-token' }

    const storefront = await getMyStorefront({
      mediaUserToken: creds.mediaUserToken,
      language: settings.language,
    })
    if (!storefront) return { ok: false, reason: 'no-storefront' }

    const changed = storefront !== settings.storefront
    if (changed) {
      await writeSettings({ storefront })
      console.log(
        `[storefront] auto-detected "${storefront}" (was "${settings.storefront}")`,
      )
    }
    return { ok: true, storefront, changed }
  } catch (err) {
    console.error('[storefront] auto-detect failed:', err.message)
    return { ok: false, reason: 'error', error: err.message }
  }
}
