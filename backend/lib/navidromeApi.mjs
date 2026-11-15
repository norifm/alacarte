import crypto from 'node:crypto'
import { readNavidromeCreds } from './settingsStore.mjs'

export async function triggerNavidromeScan({ fullScan = false } = {}) {
  const creds = await readNavidromeCreds()
  if (!creds.enabled || !creds.url || !creds.user || !creds.password) {
    return
  }

  try {
    const salt = crypto.randomBytes(6).toString('hex')
    const token = crypto.createHash('md5').update(creds.password + salt).digest('hex')
    
    // Relative to the configured URL so a Navidrome served under a path
    // (https://host/navidrome) keeps it.
    const base = creds.url.endsWith('/') ? creds.url : `${creds.url}/`
    const url = new URL('rest/startScan', base)
    url.searchParams.set('u', creds.user)
    url.searchParams.set('t', token)
    url.searchParams.set('s', salt)
    url.searchParams.set('v', '1.16.1')
    url.searchParams.set('c', 'alacarte')
    url.searchParams.set('f', 'json')
    if (fullScan) url.searchParams.set('fullScan', 'true')

    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      console.error(`Navidrome API error: ${response.status} ${response.statusText}`)
      return
    }

    const data = await response.json()
    if (data['subsonic-response'] && data['subsonic-response'].status === 'failed') {
      console.error('Navidrome API failed:', data['subsonic-response'].error)
    } else {
      console.log('Successfully triggered Navidrome scan.')
    }
  } catch (err) {
    console.error('Failed to trigger Navidrome scan:', err.message)
  }
}

function subsonicUrl(creds, endpoint) {
  const salt = crypto.randomBytes(6).toString('hex')
  const token = crypto.createHash('md5').update(creds.password + salt).digest('hex')
  const base = creds.url.endsWith('/') ? creds.url : `${creds.url}/`
  const url = new URL(`rest/${endpoint}`, base)
  url.searchParams.set('u', creds.user)
  url.searchParams.set('t', token)
  url.searchParams.set('s', salt)
  url.searchParams.set('v', '1.16.1')
  url.searchParams.set('c', 'alacarte')
  url.searchParams.set('f', 'json')
  return url
}

// "0.54.5 (a1b2c3)" -> [0, 54, 5]
export function parseServerVersion(value) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(value || ''))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null
}

// Before 0.55 Navidrome keys tracks by path, so a moved file comes back as
// a new track without its plays and stars. A build that does not report a
// parseable version (a develop hash) is unknown, not "new enough to be safe".
export function navidromeMoveRisk(version) {
  const v = parseServerVersion(version)
  return {
    losesPlays: Boolean(v && v[0] === 0 && v[1] < 55),
    versionUnknown: !v,
  }
}

export function losesPlaysOnMove(version) {
  return navidromeMoveRisk(version).losesPlays
}

/**
 * The connected Navidrome's version from the Subsonic ping:
 * { connected, version } with version null when it did not say. Never throws.
 */
export async function getNavidromeVersion({ fetchImpl = fetch } = {}) {
  const creds = await readNavidromeCreds()
  if (!creds.enabled || !creds.url || !creds.user || !creds.password) return { connected: false, version: null }
  try {
    const response = await fetchImpl(subsonicUrl(creds, 'ping').toString(), { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return { connected: false, version: null }
    const body = (await response.json())?.['subsonic-response']
    if (!body || body.status !== 'ok') return { connected: false, version: null }
    return { connected: true, version: body.serverVersion || null }
  } catch {
    return { connected: false, version: null }
  }
}
