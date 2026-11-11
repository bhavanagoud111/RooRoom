import type { Config } from 'tailwindcss';

// RooRoom design tokens. Every page reads colours from here, so the palette lives in one place.
//   roo  = brand accent (blue, #2563EB at 600), used sparingly for actions and the active state
//   ink  = text (primary #111827, secondary #64748B)
//   line = borders (#E2E8F0), paper = app background (#F8FAFC)
//   gold = warning (#D97706), plus Tailwind's emerald/red for success/error
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        roo: {
          50: '#EFF6FF', 100: '#DBEAFE', 200: '#BFDBFE', 300: '#93C5FD', 400: '#60A5FA',
          500: '#2563EB', 600: '#2563EB', 700: '#1D4ED8', 800: '#1E40AF', 900: '#1E3A8A',
        },
        gold: { 50: '#FFFBEB', 100: '#FEF3C7', 300: '#FCD34D', 400: '#F59E0B', 500: '#D97706', 700: '#B45309' },
        ink: { DEFAULT: '#111827', soft: '#334155', mute: '#64748B' },
        line: '#E2E8F0',
        paper: '#F8FAFC',
        success: '#16A34A',
        warning: '#D97706',
        danger: '#DC2626',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,.04)',
        lift: '0 4px 12px rgba(15,23,42,.08)',
      },
      borderRadius: { '2xl': '12px', xl: '10px' },
    },
  },
  plugins: [],
} satisfies Config;
