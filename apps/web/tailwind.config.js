import animate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    container: { center: true, padding: '1.25rem', screens: { '2xl': '1280px' } },
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', '"Cascadia Code"', 'Consolas', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        gold: { DEFAULT: 'hsl(var(--gold))', foreground: 'hsl(var(--gold-foreground))' },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        info: 'hsl(var(--info))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 10px)',
      },
      boxShadow: {
        soft: '0 1px 2px hsl(var(--shadow) / 0.04), 0 4px 16px -4px hsl(var(--shadow) / 0.08)',
        lift: '0 2px 4px hsl(var(--shadow) / 0.05), 0 18px 40px -12px hsl(var(--shadow) / 0.22)',
        glow: '0 0 0 1px hsl(var(--primary) / 0.15), 0 10px 30px -10px hsl(var(--primary) / 0.45)',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        // Effects adapted from Magic UI / React Bits (see components/fx.jsx).
        marquee: { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(calc(-100% - var(--gap)))' } },
        shine: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
        'border-beam': { '100%': { offsetDistance: '100%' } },
        'shimmer-slide': { to: { transform: 'translate(calc(100cqw - 100%), 0)' } },
        'spin-around': {
          '0%': { transform: 'translateZ(0) rotate(0)' },
          '15%, 35%': { transform: 'translateZ(0) rotate(90deg)' },
          '65%, 85%': { transform: 'translateZ(0) rotate(270deg)' },
          '100%': { transform: 'translateZ(0) rotate(360deg)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        float: 'float 6s ease-in-out infinite',
        marquee: 'marquee var(--duration, 40s) linear infinite',
        shine: 'shine 4s linear infinite',
        'border-beam': 'border-beam calc(var(--duration) * 1s) infinite linear',
        'shimmer-slide': 'shimmer-slide var(--speed) ease-in-out infinite alternate',
        'spin-around': 'spin-around calc(var(--speed) * 2) infinite linear',
      },
    },
  },
  plugins: [animate],
};
