import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const KEY = 'localstock.theme';
const ThemeContext = createContext(null);

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(KEY) ?? 'system';
    } catch {
      return 'system';
    }
  });
  const [osDark, setOsDark] = useState(systemDark);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setOsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved = theme === 'system' ? (osDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // per-viewer convenience only
    }
  }, [theme, resolved]);

  const value = useMemo(() => ({ theme, setTheme, resolved }), [theme, resolved]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
