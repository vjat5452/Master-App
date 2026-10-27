// Material UI is used for a few rich widgets (charts, stepper, slider). It is only imported by
// lazily loaded modules, so the storefront's first paint never waits for it.
import { useMemo } from 'react';
import { createTheme, StyledEngineProvider, ThemeProvider } from '@mui/material/styles';
import { useTheme } from '@/lib/theme';

// Neighbouring series must read as different at a glance: emerald, amber, indigo, then extras.
export const CHART_COLORS = ['#10b981', '#f59e0b', '#6366f1', '#0d9488', '#ec4899', '#84cc16'];

export function MuiScope({ children }) {
  const { resolved } = useTheme();
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: resolved,
          primary: { main: resolved === 'dark' ? '#28c385' : '#0c6447' },
          warning: { main: '#f49d0c' },
          error: { main: resolved === 'dark' ? '#ef6b6b' : '#d32f2f' },
          background: { default: 'transparent', paper: resolved === 'dark' ? '#101a17' : '#ffffff' },
        },
        shape: { borderRadius: 12 },
        typography: { fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', fontWeightBold: 700 },
      }),
    [resolved],
  );
  // injectFirst puts MUI's styles before Tailwind's so utility classes can still override them.
  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </StyledEngineProvider>
  );
}
