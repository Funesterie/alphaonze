import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ground: '#F5F6F8',
        surface: '#FFFFFF',
        ink: '#14213D',
        'ink-soft': '#55607A',
        cobalt: '#1B3F8B',
        'cobalt-wash': '#E7ECF7',
        gold: '#A07C22',
        laurel: '#566B41',
        rule: '#D5DAE4',
      },
      fontFamily: {
        display: ['"Palatino Linotype"', 'Palatino', '"Iowan Old Style"', '"Book Antiqua"', 'Georgia', 'serif'],
        body: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', '"SF Mono"', '"Cascadia Mono"', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
