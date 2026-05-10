import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: {
          950: '#0a0a0b',
          900: '#111114',
          800: '#1a1a1f',
          700: '#26262e',
          600: '#3a3a45',
          400: '#7c7c8a',
          200: '#c5c5d0',
          100: '#e8e8ee',
        },
        accent: {
          DEFAULT: '#ff7a45',
          dim: '#cc5f33',
        },
      },
    },
  },
  plugins: [],
};

export default config;
