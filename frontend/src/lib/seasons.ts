// Nori Seasons: four palettes from the old Japanese calendar, each a paper and a night with one accent
// and one second voice (`on`, a switch that is on). Following the calendar, a season blends in over the
// week before and after its first day; south of the equator the calendar is half a year round. A page
// about one cover wears the season's paper dyed with the cover's color. Ported from nori's look crate
// (crates/look/src/theme.rs) so both apps wear the same colors on the same day.

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type SeasonSetting = 'follow' | Season
export type Appearance = 'system' | 'day' | 'night' | 'midnight'

export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']

type Rgb = [number, number, number]
type Palette = { page: Rgb; surface: Rgb; ink: Rgb; accent: Rgb; on: Rgb }

const hex = (h: string): Rgb => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb
const p = (page: string, surface: string, ink: string, accent: string, on: string): Palette => ({
  page: hex(page),
  surface: hex(surface),
  ink: hex(ink),
  accent: hex(accent),
  on: hex(on),
})

// Spring (春霞, haze): usu-ai paper, imayō cherry red, asagi water. Summer (紫陽花): shiro-fuji rain grey,
// ajisai hydrangea, koke moss. Autumn (柿): kinari, kaki persimmon, chitose-midori pine. Winter (雪):
// yuki-shiro snow, ai indigo, ginnezumi grey.
const PALETTES: Record<Season, [Palette, Palette]> = {
  spring: [p('F3F2F6', 'FDFDFE', '26262A', 'B14C66', '2C7F8F'), p('101015', '1B1B20', 'ECEBEF', 'E9A0B1', '6FC3D1')],
  summer: [p('EFF1F7', 'FDFDFE', '202229', '4B5BB0', '4F7F3A'), p('0A0C14', '15171F', 'E8EAF0', '9AA6EE', '8FBF74')],
  autumn: [p('F6F0E6', 'FFFDF8', '241D16', 'B64D1D', '36563C'), p('110E0A', '1C1813', 'F3EDE3', 'E8743B', '7FA27F')],
  winter: [p('F2F4F6', 'FDFDFE', '212326', '2E5C8A', '6B7077'), p('0B0D11', '16181C', 'EBEDEF', '7FB0E0', '9A9FA6')],
}

/** The day of a 365-day year each season starts on: risshun, rikka, risshū and rittō. */
const STARTS: Record<Season, number> = { spring: 34, summer: 124, autumn: 218, winter: 310 }
const BLEND_DAYS = 14
const MONTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const BLACK: Rgb = [0, 0, 0]
const WHITE: Rgb = [255, 255, 255]

// ---- color maths (sRGB per channel, as nori's Compose maths) ----

function blend(a: Rgb, b: Rgb, t: number): Rgb {
  return a.map((v, i) => Math.round(Math.min(255, Math.max(0, v + (b[i] - v) * t)))) as Rgb
}

/** `ink` at `share` over `bg`. */
const veil = (ink: Rgb, share: number, bg: Rgb) => blend(bg, ink, share)

const lin = (v: number) => {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = (c: Rgb) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
function contrast(a: Rgb, b: Rgb) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [(h * 60 + 360) % 360, s, l]
}

function fromHsl([h, s, l]: [number, number, number]): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v + m)) * 255)) as Rgb
}

/** Oklab chroma. */
function chroma([r, g, b]: Rgb) {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return Math.hypot(A, Bb)
}

// ---- the calendar ----

function dayOfYear(month: number, day: number) {
  const m = Math.min(12, Math.max(1, month)) - 1
  return MONTHS.slice(0, m).reduce((a, n) => a + n, 0) + Math.min(MONTHS[m], Math.max(1, day)) - 1
}

function dateOf(day: number): [number, number] {
  let left = day % 365
  for (let i = 0; i < 12; i++) {
    if (left < MONTHS[i]) return [i + 1, left + 1]
    left -= MONTHS[i]
  }
  return [12, 31]
}

const SOUTH = [
  'Australia/', 'Antarctica/', 'Pacific/Auckland', 'Pacific/Chatham', 'Pacific/Fiji', 'Pacific/Tongatapu', 'Pacific/Apia',
  'Pacific/Noumea', 'Pacific/Efate', 'Pacific/Port_Moresby', 'Pacific/Tahiti', 'Pacific/Rarotonga', 'Pacific/Easter',
  'America/Argentina/', 'America/Buenos_Aires', 'America/Santiago', 'America/Punta_Arenas', 'America/Montevideo',
  'America/Asuncion', 'America/Sao_Paulo', 'America/Rio_Branco', 'America/Porto_Velho', 'America/Cuiaba',
  'America/Campo_Grande', 'America/Maceio', 'America/Recife', 'America/Bahia', 'America/Araguaina', 'America/Lima',
  'America/La_Paz', 'Africa/Johannesburg', 'Africa/Maputo', 'Africa/Harare', 'Africa/Lusaka', 'Africa/Windhoek',
  'Africa/Gaborone', 'Africa/Maseru', 'Africa/Mbabane', 'Africa/Blantyre', 'Africa/Lubumbashi', 'Africa/Luanda',
  'Africa/Dar_es_Salaam', 'Indian/Antananarivo', 'Indian/Mauritius', 'Indian/Reunion', 'Asia/Jakarta', 'Asia/Makassar',
  'Asia/Jayapura', 'Asia/Dili', 'Asia/Pontianak', 'Atlantic/Stanley', 'Atlantic/South_Georgia', 'Atlantic/St_Helena',
  'Pacific/Norfolk', 'Pacific/Pitcairn', 'Pacific/Gambier', 'Pacific/Marquesas', 'Pacific/Pago_Pago', 'Pacific/Guadalcanal',
  'Pacific/Wallis', 'Pacific/Funafuti', 'Pacific/Galapagos', 'Indian/Kerguelen', 'Indian/Mayotte', 'Indian/Comoro',
  'Indian/Chagos', 'America/Manaus', 'America/Belem', 'America/Fortaleza', 'America/Noronha', 'America/Santarem',
  'America/Guayaquil', 'Africa/Kinshasa', 'Africa/Brazzaville', 'Africa/Kigali', 'Africa/Bujumbura', 'Africa/Nairobi',
]

function today() {
  const now = new Date()
  let zone = ''
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    /* no zone: the north's calendar */
  }
  return { month: now.getMonth() + 1, day: now.getDate(), south: SOUTH.some((s) => zone.startsWith(s)) }
}

/** The calendar's season on a date, and the next one with the month and day it starts on. */
export function seasonNow(month: number, day: number, south: boolean) {
  const shift = south ? 182 : 0
  const at = (dayOfYear(month, day) + shift) % 365
  const season = [...SEASONS].reverse().find((s) => at >= STARTS[s]) ?? 'winter'
  const next = SEASONS[(SEASONS.indexOf(season) + 1) % 4]
  const [nextMonth, nextDay] = dateOf(STARTS[next] + 365 - shift)
  return { season, next, nextMonth, nextDay }
}

function mixed(a: Palette, b: Palette, t: number): Palette {
  return {
    page: blend(a.page, b.page, t),
    surface: blend(a.surface, b.surface, t),
    ink: blend(a.ink, b.ink, t),
    accent: blend(a.accent, b.accent, t),
    on: blend(a.on, b.on, t),
  }
}

function palette(season: SeasonSetting, dark: boolean, midnight: boolean): Palette {
  const of = (s: Season) => {
    const pl = PALETTES[s][dark ? 1 : 0]
    return dark && midnight ? { ...pl, page: BLACK, surface: blend(pl.surface, BLACK, 0.35) } : pl
  }
  if (season !== 'follow') return of(season)
  const { month, day, south } = today()
  const at = (dayOfYear(month, day) + (south ? 182 : 0)) % 365
  for (const s of SEASONS) {
    const since = (at + 365 + BLEND_DAYS / 2 - STARTS[s]) % 365
    const t = (since + 1) / BLEND_DAYS
    if (since < BLEND_DAYS && t < 1) return mixed(of(SEASONS[(SEASONS.indexOf(s) + 3) % 4]), of(s), t)
  }
  return of(seasonNow(month, day, south).season)
}

// ---- a cover's page ----

const QUIET = 0.65
const DARK_PAGE = 0.4

/** `color` stepped in its own hue until it reads as text on `page`, trying the other way next, else `fallback`. */
function textEitherWay(color: Rgb, page: Rgb, fallback: Rgb): Rgb {
  if (contrast(color, page) >= 4.5) return color
  const own = chroma(color)
  const step = (up: boolean) => {
    const hsl = toHsl(color)
    for (let i = 0; i < 8; i++) {
      hsl[2] = up ? Math.min(0.92, hsl[2] + 0.07) : Math.max(0.15, hsl[2] - 0.07)
      hsl[1] = Math.min(1, hsl[1] * 1.05)
      let c = fromHsl(hsl)
      const reached = chroma(c)
      if (reached > own) c = fromHsl([hsl[0], (hsl[1] * own) / reached, hsl[2]])
      if (contrast(c, page) >= 4.5) return c
    }
    return null
  }
  const light = luminance(page) < DARK_PAGE
  return step(light) ?? step(!light) ?? fallback
}

/** The season's paper dyed with a cover's color: a page about one cover wears it. Ink and accent stay the
 *  season's, moved only where they would not read on it. */
function dyedPalette(cover: Rgb, light: Palette, dark: Palette, darkTheme: boolean): Palette {
  const deep = darkTheme || luminance(cover) < 0.18
  const season = deep ? dark : light
  const [h, s] = toHsl(cover)
  const own = Math.min(1, Math.max(0, (chroma(cover) - 0.006) / 0.01))
  const toned: [number, number, number] = deep ? [h, Math.min(s * own, 0.45), 0.11] : [h, Math.min(0.5, Math.max(0.2 * own, s * own)), 0.86]
  const page = blend(season.page, fromHsl(toned), 0.6)
  const reads = (ink: Rgb) => contrast(ink, page) >= 9 && contrast(veil(ink, QUIET, page), page) >= 4.5
  const ink = reads(season.ink) ? season.ink : luminance(page) < 0.3 ? hex('F5F3F0') : hex('141210')
  const accent = textEitherWay(luminance(page) < DARK_PAGE ? dark.accent : light.accent, page, ink)
  return { page, surface: blend(page, season.surface, 0.5), ink, accent, on: season.on }
}

// ---- wearing it ----

const css = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** The CSS custom properties of a palette: its five roles and the shares of ink made from them. */
function vars(pl: Palette, dark: boolean): Record<string, string> {
  return {
    '--page': css(pl.page),
    '--surface': css(pl.surface),
    '--ink': css(pl.ink),
    '--ink2': css(veil(pl.ink, QUIET, pl.page)),
    '--hair': css(veil(pl.ink, 0.14, pl.page)),
    '--outline': css(veil(pl.ink, 0.36, pl.page)),
    '--accent': css(pl.accent),
    '--on': css(pl.on),
    '--on-accent': contrast(WHITE, pl.accent) >= 3 ? '#ffffff' : '#0d0d0d',
    '--error': dark ? '#f2b8b5' : '#b3261e',
    '--warn': dark ? '#e3b25f' : '#8a5300',
  }
}

export type Look = { season: SeasonSetting; appearance: Appearance }

const KEY = 'alacarte-look'
const NAMES = ['--page', '--surface', '--ink', '--ink2', '--hair', '--outline', '--accent', '--on', '--on-accent', '--error', '--warn']

let look: Look = { season: 'follow', appearance: 'system' }
let tint: string | null = null
let release: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
const isDark = (l: Look) => l.appearance === 'night' || l.appearance === 'midnight' || (l.appearance === 'system' && systemDark())

function wear(v: Record<string, string>, fade: boolean) {
  const root = document.documentElement
  root.classList.toggle('tinting', fade)
  for (const name of NAMES) root.style.setProperty(name, v[name])
  root.style.colorScheme = isDark(look) ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', v['--page'])
}

function current(): Record<string, string> {
  const dark = isDark(look)
  const midnight = look.appearance === 'midnight'
  if (tint && !midnight) {
    const light = palette(look.season, false, false)
    const night = palette(look.season, true, false)
    const dyed = dyedPalette(hex(tint), light, night, dark)
    return vars(dyed, luminance(dyed.page) < DARK_PAGE)
  }
  return vars(palette(look.season, dark, midnight), dark)
}

function apply(fade: boolean) {
  const v = current()
  wear(v, fade)
  try {
    // The colors last worn, for the first paint of the next visit (index.html reads them).
    if (!tint) localStorage.setItem(KEY, JSON.stringify({ look, vars: v }))
  } catch {
    /* private window */
  }
  listeners.forEach((l) => l())
}

/** Wears the colors from last time and keeps them current: when the page comes back into view and when
 *  the system's color scheme changes; never on a timer. */
export function startSeasons() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (saved?.look) look = saved.look
  } catch {
    /* nothing saved */
  }
  apply(false)
  document.addEventListener('visibilitychange', () => !document.hidden && apply(false))
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => apply(false))
}

/** The look chosen in settings. */
export function setLook(next: Partial<Look>) {
  const merged = { season: next.season ?? look.season, appearance: next.appearance ?? look.appearance }
  if (merged.season === look.season && merged.appearance === look.appearance) return
  look = merged
  apply(false)
}

export function getLook(): Look {
  return look
}

/** A page about one cover lends the page and the chrome its color (Apple's `bgColor`, `rrggbb`) while
 *  it is open; null gives the season's paper back. The colors cross-fade. */
export function setCoverTint(color: string | null | undefined) {
  if (release) clearTimeout(release)
  release = null
  const next = color && /^[0-9a-f]{6}$/i.test(color) ? color : null
  if (next === tint) return
  tint = next
  apply(true)
}

/** The page about a cover closed: the season's paper comes back unless the next page brings a cover of
 *  its own, so going from one album to another fades once. */
export function releaseCoverTint() {
  if (release) clearTimeout(release)
  release = setTimeout(() => setCoverTint(null), 260)
}

/** The four seasons' tiles in the appearance worn: each one's paper and accent. */
export function seasonTiles() {
  const dark = isDark(look)
  return SEASONS.map((s) => {
    const pl = PALETTES[s][dark ? 1 : 0]
    return { season: s, page: css(look.appearance === 'midnight' ? BLACK : pl.page), accent: css(pl.accent) }
  })
}

/** The calendar's season today and the next one. */
export function calendarNow() {
  const { month, day, south } = today()
  return seasonNow(month, day, south)
}

export function subscribeSeasons(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
