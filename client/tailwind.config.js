/** Identité visuelle GoatHub : nuit profonde + violet électrique */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#0b0c12', 900: '#0f1017', 850: '#13141c', 800: '#171922', 750: '#1c1e29', 700: '#232634', 600: '#2c3040', 500: '#3a3f53' },
        brand: { 300: '#b4a7ff', 400: '#9a88ff', 500: '#7b5cff', 600: '#6a46f5', 700: '#5733e0' },
        fuchsia: { 500: '#c026d3' },
        ok: '#3ec97e', warn: '#f0b232', bad: '#ef4f5a',
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
      boxShadow: { glow: '0 8px 30px rgba(123, 92, 255, 0.35)', pop: '0 18px 50px rgba(0, 0, 0, 0.55)' },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'pop-in': { from: { opacity: 0, transform: 'scale(.96) translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        'slide-up': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'none' } },
        ring: { '0%,100%': { transform: 'rotate(0)' }, '20%': { transform: 'rotate(-12deg)' }, '40%': { transform: 'rotate(12deg)' }, '60%': { transform: 'rotate(-8deg)' } },
        pulse2: { '0%,100%': { boxShadow: '0 0 0 0 rgba(62,201,126,.6)' }, '50%': { boxShadow: '0 0 0 6px rgba(62,201,126,0)' } },
      },
      animation: {
        'fade-in': 'fade-in .15s ease-out', 'pop-in': 'pop-in .18s cubic-bezier(.2,.9,.3,1.2)', 'slide-up': 'slide-up .2s ease-out',
        ring: 'ring 1s ease-in-out infinite', pulse2: 'pulse2 1.6s infinite',
      },
    },
  },
  plugins: [],
};
