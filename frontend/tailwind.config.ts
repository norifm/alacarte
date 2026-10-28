import type { Config } from 'tailwindcss'

// Every color is one of the season's roles (src/lib/seasons.ts), or a share of one: `white/60` is the ink
// at 60 % over whatever it sits on, so the same classes read on a paper and on a night.
const share = (role: string) => `color-mix(in srgb, var(${role}) calc(<alpha-value> * 100%), transparent)`
const all = (role: string) =>
  Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [n, share(role)]))

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        white: share('--ink'),
        ink: share('--ink'),
        quiet: share('--ink2'),
        page: share('--page'),
        surface: share('--surface'),
        hair: share('--hair'),
        outline: share('--outline'),
        accent: share('--accent'),
        on: share('--on'),
        'on-accent': share('--on-accent'),
        rose: all('--error'),
        red: all('--error'),
        emerald: all('--on'),
        green: all('--on'),
        amber: all('--warn'),
        yellow: all('--warn'),
        sky: all('--ink'),
        zinc: all('--surface'),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'Arial', 'sans-serif'],
        display: ['Literata', 'Georgia', '"Iowan Old Style"', 'serif'],
      },
      borderRadius: {
        app: 'var(--r-tile)',
        cover: 'var(--r-cover)',
        card: 'var(--r-card)',
        tile: 'var(--r-tile)',
        sheet: 'var(--r-sheet)',
      },
      borderWidth: {
        hair: 'var(--hairline)',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.16, 1, 0.3, 1)',
        snappy: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config
