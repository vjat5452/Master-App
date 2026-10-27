import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App.jsx';
import { TooltipProvider } from './components/ui/tooltip.jsx';
import { AuthProvider, CartProvider, LocationProvider } from './lib/store.jsx';
import { ThemeProvider, useTheme } from './lib/theme.jsx';
import './index.css';

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
    </ThemeProvider>
  </React.StrictMode>,
);
