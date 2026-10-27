import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { get, getTokens, onTokensChange, post, setTokens } from './api.js';

function usePersisted(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // per-viewer convenience only
    }
  }, [key, value]);
  return [value, setValue];
}

/* ---------- auth ---------- */

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getTokens()));

  const reload = useCallback(async () => {
    if (!getTokens()) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const me = await get('/users/me');
      setUser(me);
      return me;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    return onTokensChange((t) => !t && setUser(null));
  }, [reload]);

  const value = useMemo(
    () => ({
      user,
      loading,
      reload,
      isAdmin: user?.platformRole === 'ADMIN',
      async login(email, password) {
        setTokens(await post('/auth/login', { email, password }, { auth: false }));
        return reload();
      },
      async register(name, email, password) {
        setTokens(await post('/auth/register', { name, email, password }, { auth: false }));
        return reload();
      },
      async logout() {
        const refreshToken = getTokens()?.refreshToken;
        if (refreshToken) await post('/auth/logout', { refreshToken }, { auth: false }).catch(() => {});
        setTokens(null);
      },
    }),
    [user, loading, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/* ---------- delivery location ---------- */

export const PLACES = [
  { label: 'India Gate', lat: 28.6129, lng: 77.2295 },
  { label: 'Connaught Place', lat: 28.6315, lng: 77.2167 },
  { label: 'Lajpat Nagar', lat: 28.5677, lng: 77.2433 },
  { label: 'Noida Sector 18', lat: 28.5708, lng: 77.3261 },
  { label: 'Noida Sector 62', lat: 28.627, lng: 77.3727 },
];

const LocationContext = createContext(null);

export function LocationProvider({ children }) {
  const [location, setLocation] = usePersisted('localstock.location', PLACES[0]);
  return <LocationContext.Provider value={{ location, setLocation }}>{children}</LocationContext.Provider>;
}

export const useDeliveryLocation = () => useContext(LocationContext);

/* ---------- cart ---------- */

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [items, setItems] = usePersisted('localstock.cart', []);

  const value = useMemo(
    () => ({
      items,
      count: items.reduce((n, i) => n + i.quantity, 0),
      add(product, quantity = 1) {
        setItems((cur) => {
          const found = cur.find((i) => i.variantId === product.variantId);
          if (found) return cur.map((i) => (i === found ? { ...i, quantity: Math.min(100, i.quantity + quantity) } : i));
          return [...cur, { ...product, quantity }];
        });
      },
      setQuantity(variantId, quantity) {
        setItems((cur) =>
          quantity <= 0 ? cur.filter((i) => i.variantId !== variantId) : cur.map((i) => (i.variantId === variantId ? { ...i, quantity: Math.min(100, quantity) } : i)),
        );
      },
      clear: () => setItems([]),
    }),
    [items, setItems],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);

/* ---------- toasts ---------- */

const TOAST = { good: toast.success, bad: toast.error, warn: toast.warning, info: toast.info };

/** Returns push(message, kind) where kind is good | bad | warn | info. Rendered by <Toaster/> in main.jsx. */
export const useToast = () => useCallback((message, kind = 'good') => (TOAST[kind] ?? toast)(message), []);

/* ---------- data loading ---------- */

/** Run an async loader on mount and whenever deps change; returns { data, error, loading, reload, setData }. */
export function useAsync(loader, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(async () => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await loader();
      if (mine === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (mine === seq.current) setState((s) => ({ ...s, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
  }, [run]);
  return { ...state, reload: run, setData: (data) => setState((s) => ({ ...s, data })) };
}
