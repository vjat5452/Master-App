import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App.jsx';
import { TooltipProvider } from './components/ui/tooltip.jsx';
import { beforeSend, beforeSendVital } from './lib/url-privacy.js';
import { AuthProvider, CartProvider, LocationProvider } from './lib/store.jsx';
import { ThemeProvider, useTheme } from './lib/theme.jsx';
import './index.css';

// Ad blockers often block these packages. Loading them lazily means a blocked file only
// turns off the measurement instead of leaving the whole page blank.
const optional = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })).catch(() => ({ default: () => null })));
const Analytics = optional(() => import('@vercel/analytics/react'), 'Analytics');
const SpeedInsights = optional(() => import('@vercel/speed-insights/react'), 'SpeedInsights');

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="bottom-right" richColors closeButton toastOptions={{ className: 'font-sans' }} />;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <TooltipProvider delayDuration={200}>
          <AuthProvider>
            <LocationProvider>
              <CartProvider>
                <App />
              </CartProvider>
            </LocationProvider>
          </AuthProvider>
        </TooltipProvider>
      </BrowserRouter>
      <ThemedToaster />
      <Suspense fallback={null}>
        <Analytics beforeSend={beforeSend} />
        <SpeedInsights beforeSend={beforeSendVital} />
      </Suspense>
    </ThemeProvider>
  </React.StrictMode>,
);
