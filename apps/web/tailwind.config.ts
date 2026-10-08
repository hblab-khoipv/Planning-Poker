import type { Config } from 'tailwindcss';

/** Every token is defined once in `src/app/globals.css`; this only names them for utilities. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        surface: { DEFAULT: token('surface'), 2: token('surface-2') },
        line: { DEFAULT: token('line'), strong: token('line-strong') },
        ink: { DEFAULT: token('ink'), muted: token('ink-muted'), subtle: token('ink-subtle') },
        brand: { DEFAULT: token('brand'), strong: token('brand-strong'), ink: token('brand-ink') },
        'on-brand': token('on-brand'),
        'on-warn': token('on-warn'),
        ok: { DEFAULT: token('ok'), ink: token('ok-ink') },
        warn: { DEFAULT: token('warn'), ink: token('warn-ink') },
        danger: { DEFAULT: token('danger'), ink: token('danger-ink') },
        'card-face': { DEFAULT: token('card-face'), ink: token('card-face-ink') },
        felt: { DEFAULT: token('table-felt'), ink: token('table-felt-ink') },
      },
    },
  },
  plugins: [],
};

export default config;
