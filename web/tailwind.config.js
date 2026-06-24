/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 900: '#0B1322', 800: '#0E1726', 700: '#111B2E', 600: '#16223A', 500: '#1C2A45' },
        line: '#26344F',
        parchment: '#E8E6DF',
        muted: '#8A97AD',
        survey: '#FF6B3D',
        teal: '#3FB9A6',
        amber: '#F2B33D',
        rose: '#F2555A',
        violet: '#9B7BFF',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}
