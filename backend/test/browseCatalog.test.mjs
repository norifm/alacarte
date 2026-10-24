import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.APPLE_GATEWAY_INTERVAL_MS = '0'
process.env.APPLE_GATEWAY_MIN_INTERVAL_MS = '0'
process.env.AMDL_CONFIG_DIR = '/nonexistent-alacarte-test'
const { loadCurator, loadRecordLabel } = await import('../lib/browseCatalog.mjs')

const realFetch = globalThis.fetch
let appleCalls = []
let routes = {}
let lastQuery = ''
let lastUrl = ''
globalThis.fetch = async (url) => {
  const u = String(url)
  if (u === 'https://music.apple.com') return new Response('<script src="/assets/index~a.js"></script>')
  if (u.endsWith('/assets/index~a.js')) return new Response('eyJhaa.eyJbbb.ccc')
  const path = new URL(u).pathname
  appleCalls.push(path)
  lastQuery = new URL(u).search
  lastUrl = u
  const body = typeof routes[path] === 'function' ? routes[path]() : routes[path]
  if (!body) return new Response('{"errors":[]}', { status: 404 })
  return Response.json(body)
}
test.after(() => {
  globalThis.fetch = realFetch
})

const album = (id, extra = {}) => ({ id, type: 'albums', attributes: { name: `A${id}`, artistName: 'X', ...extra } })

test('curator links ask for either curator type in one call', async () => {
  appleCalls = []
  routes = {
    '/v1/catalog/us': {
      data: [{
        id: '7',
        attributes: { name: 'Lost Lands', editorialNotes: { short: 'Drum &amp; Bass<br/>fest &#8212; &lt;3' } },
        relationships: { playlists: { data: [{ id: 'pl.a', type: 'playlists', attributes: { name: 'P' } }] } },
      }],
    },
  }
  const r = await loadCurator({ id: '7', storefront: 'us' })
  assert.deepEqual(appleCalls, ['/v1/catalog/us'])
  assert.match(lastQuery, /ids%5Bcurators%5D=7&ids%5Bapple-curators%5D=7/)
  assert.equal(r.curator.name, 'Lost Lands')
  assert.equal(r.curator.description, 'Drum & Bass fest \u2014 <3')
  assert.deepEqual(r.playlists.map((p) => p.id), ['pl.a'])
})

test('a curator with more playlists than the first page shows all of them', async () => {
  appleCalls = []
  const pl = (n) => ({ id: `pl.${n}`, type: 'playlists', attributes: { name: `P${n}` } })
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => pl(a + i))
  routes = {
    '/v1/catalog/us': {
      data: [{
        id: '8', type: 'apple-curators', attributes: { name: 'Hits' },
        relationships: { playlists: { data: range(0, 10), next: '/v1/catalog/us/apple-curators/8/playlists?offset=10' } },
      }],
    },
  }
  const pages = { 10: range(10, 35), 35: range(35, 41) }
  routes['/v1/catalog/us/apple-curators/8/playlists'] = () => ({ data: pages[new URL(lastUrl).searchParams.get('offset')] })
  const r = await loadCurator({ id: '8', storefront: 'us' })
  assert.equal(r.playlists.length, 41)
  assert.equal(new Set(r.playlists.map((p) => p.id)).size, 41)
  assert.equal(appleCalls.length, 3)
})

test('label pages the latest releases only when there are more', async () => {
  appleCalls = []
  routes = {
    '/v1/catalog/us/record-labels/9': {
      data: [{
        id: '9',
        attributes: { name: 'NSD' },
        views: {
          'latest-releases': { data: [{ ...album('1'), relationships: { artists: { data: [{ id: '55', attributes: { name: 'X' } }] } } }], next: '/v1/catalog/us/record-labels/9/view/latest-releases?offset=10' },
          'top-releases': { data: [album('2'), album('2'), album('3', { name: 'A2', contentRating: 'explicit' })] },
        },
      }],
    },
    '/v1/catalog/us/record-labels/9/view/latest-releases': {
      data: [album('1'), album('4')],
    },
  }
  const r = await loadRecordLabel({ id: '9', storefront: 'us', explicitFilter: 'clean' })
  assert.equal(appleCalls.length, 2)
  assert.deepEqual(r.latestReleases.map((a) => a.id), ['1', '4'])
  assert.equal(r.latestReleases[0].artistId, '55', 'label albums keep their artist link')
  assert.deepEqual(r.topReleases.map((a) => a.id), ['2'])

  appleCalls = []
  delete routes['/v1/catalog/us/record-labels/9'].data[0].views['latest-releases'].next
  await loadRecordLabel({ id: '9', storefront: 'us' })
  assert.equal(appleCalls.length, 1)
})

test('missing catalog resources are told apart from other apple errors', async () => {
  const { isMissingCatalogResource } = await import('../lib/appleErrors.mjs')
  assert.equal(isMissingCatalogResource(new Error('Apple API 404 on /v1/catalog/us/record-labels/1: ')), true)
  assert.equal(isMissingCatalogResource({ status: 404 }), true)
  assert.equal(isMissingCatalogResource(new Error('Apple API 500 on /v1/catalog/us/record-labels/1: ')), false)
})

test('a label with hundreds of releases is paged to the end', async () => {
  appleCalls = []
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => album(String(a + i)))
  routes = {
    '/v1/catalog/us/record-labels/5': {
      data: [{
        id: '5',
        attributes: { name: 'Big' },
        views: {
          'latest-releases': { data: range(0, 10), next: '/v1/catalog/us/record-labels/5/view/latest-releases?offset=10' },
          'top-releases': { data: range(0, 10), next: '/v1/catalog/us/record-labels/5/view/top-releases?offset=10' },
        },
      }],
    },
  }
  const total = 296
  routes['/v1/catalog/us/record-labels/5/view/latest-releases'] = () => {
    const off = Number(new URL(lastUrl).searchParams.get('offset'))
    return { data: range(off, Math.min(off + 100, total)) }
  }
  routes['/v1/catalog/us/record-labels/5/view/top-releases'] = () => {
    const off = Number(new URL(lastUrl).searchParams.get('offset'))
    return { data: range(off, Math.min(off + 100, 150)) }
  }
  const r = await loadRecordLabel({ id: '5', storefront: 'us', explicitFilter: 'both' })
  assert.equal(r.latestReleases.length, total)
  assert.equal(r.topReleases.length, 150)
  assert.equal(appleCalls.filter((p) => p.endsWith('latest-releases')).length, 3)
  assert.equal(appleCalls.filter((p) => p.endsWith('top-releases')).length, 2)
})

test('a label page whose later pages fail still shows the releases it has', async () => {
  appleCalls = []
  routes = {
    '/v1/catalog/us/record-labels/6': {
      data: [{
        id: '6',
        attributes: { name: 'Flaky' },
        views: {
          'latest-releases': { data: [album('1'), album('2')], next: '/v1/catalog/us/record-labels/6/view/latest-releases?offset=2' },
          'top-releases': { data: [album('3')], next: '/v1/catalog/us/record-labels/6/view/top-releases?offset=1' },
        },
      }],
    },
  }
  const r = await loadRecordLabel({ id: '6', storefront: 'us' })
  assert.deepEqual(r.latestReleases.map((a) => a.id), ['1', '2'])
  assert.deepEqual(r.topReleases.map((a) => a.id), ['3'])
})

test('pasted curator and label links keep their storefront', async () => {
  const { resolveAppleMusicLink } = await import('../routes/search.mjs')
  const { parseAppleMusicUrl } = await import('../lib/appleMusicUrl.mjs')
  appleCalls = []
  const opts = { storefront: 'us', language: 'en-US', explicitFilter: 'explicit' }
  const jp = await resolveAppleMusicLink(parseAppleMusicUrl('https://music.apple.com/jp/label/x/1571161766'), opts)
  assert.equal(jp.redirect, '/label/1571161766?storefront=jp')
  const bare = await resolveAppleMusicLink(parseAppleMusicUrl('https://music.apple.com/curator/x/1607171756'), opts)
  assert.equal(bare.redirect, '/curator/1607171756')
  assert.equal(appleCalls.length, 0)
})

test('a label album in both views is offered for download once', async () => {
  appleCalls = []
  routes = {
    '/v1/catalog/us/record-labels/4': {
      data: [{
        id: '4',
        attributes: { name: 'Twice' },
        views: {
          'latest-releases': { data: [album('c', { name: 'Same', contentRating: 'clean' }), album('n', { name: 'New' })] },
          'top-releases': { data: [album('e', { name: 'Same', contentRating: 'explicit' }), album('n', { name: 'New' })] },
        },
      }],
    },
  }
  const r = await loadRecordLabel({ id: '4', storefront: 'us', explicitFilter: 'explicit' })
  assert.deepEqual(r.latestReleases.map((a) => a.id), ['c', 'n'])
  assert.deepEqual(r.topReleases.map((a) => a.id), ['e', 'n'])
  assert.deepEqual(r.albums.map((a) => a.id).sort(), ['e', 'n'])
})

test('a page seen lately is served again without apple, a cut short one is not', async () => {
  routes = {
    '/v1/catalog/us': { data: [{ id: '3', type: 'curators', attributes: { name: 'Again' } }] },
    '/v1/catalog/us/record-labels/2': {
      data: [{ id: '2', attributes: { name: 'Cut' }, views: { 'latest-releases': { data: [album('1')], next: 'x' } } }],
    },
  }
  appleCalls = []
  await loadCurator({ id: '3', storefront: 'us' })
  const again = await loadCurator({ id: '3', storefront: 'us' })
  assert.equal(again.curator.name, 'Again')
  assert.equal(appleCalls.length, 1)
  await loadCurator({ id: '3', storefront: 'gb' }).catch(() => {})
  assert.equal(appleCalls.length, 2, 'another storefront is its own page')

  appleCalls = []
  await loadRecordLabel({ id: '2', storefront: 'us' })
  await loadRecordLabel({ id: '2', storefront: 'us' })
  assert.equal(appleCalls.filter((p) => p.endsWith('/record-labels/2')).length, 2)
})
