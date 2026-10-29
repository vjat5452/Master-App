import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  Code2,
  Crosshair,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Monitor,
  Moon,
  Package,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Store,
  Sun,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import { NumberTicker, RotatingText } from './components/fx.jsx';
import { Button, Field, Modal, Spinner } from './components/kit.jsx';
import { Input } from './components/ui/input.jsx';
import { Avatar, AvatarFallback, Separator } from './components/ui/misc.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu.jsx';
import { Tooltip, TooltipContent, TooltipTrigger } from './components/ui/tooltip.jsx';
import { rawRequest } from './lib/api.js';
import { searchCatalog } from './lib/categories.js';
import { price } from './lib/format.js';
import { PLACES, useAuth, useCart, useDeliveryLocation, useToast } from './lib/store.jsx';
import { useTheme } from './lib/theme.jsx';
import { cn } from './lib/utils.js';
import Browse from './pages/Browse.jsx';
import Cart from './pages/Cart.jsx';
import Login from './pages/Login.jsx';
import Product from './pages/Product.jsx';
import Shop from './pages/Shop.jsx';

// Shopper pages ship in the main bundle; back-office pages load on first visit.
const Account = lazy(() => import('./pages/Account.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const Explorer = lazy(() => import('./pages/Explorer.jsx'));
const OrderDetail = lazy(() => import('./pages/OrderDetail.jsx'));
const Orders = lazy(() => import('./pages/Orders.jsx'));
const Seller = lazy(() => import('./pages/Seller.jsx'));

const Contained = ({ children }) => (
  <div className="container py-8 sm:py-12">
    <Suspense fallback={<Spinner className="py-32" />}>{children}</Suspense>
  </div>
);

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return (
    <div className="flex min-h-screen flex-col">
      <DemoNotice />
      <TopBar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Shop />} />
          <Route path="/search" element={<Browse />} />
          <Route path="/c/:slug" element={<Browse />} />
          <Route path="/login" element={<Login />} />
          <Route path="/product/:variantId" element={<Contained><Product /></Contained>} />
          <Route path="/cart" element={<Contained><Cart /></Contained>} />
          <Route path="/orders" element={<RequireAuth><Contained><Orders /></Contained></RequireAuth>} />
          <Route path="/orders/:orderId" element={<RequireAuth><Contained><OrderDetail /></Contained></RequireAuth>} />
          <Route path="/seller" element={<RequireAuth><Contained><Seller /></Contained></RequireAuth>} />
          <Route path="/seller/:companyId" element={<RequireAuth><Contained><Seller /></Contained></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth admin><Contained><Admin /></Contained></RequireAuth>} />
          <Route path="/account" element={<RequireAuth><Contained><Account /></Contained></RequireAuth>} />
          <Route path="/explorer" element={<Contained><Explorer /></Contained>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {pathname !== '/login' && <Footer />}
      <CartBar />
    </div>
  );
}

// Outside production builds (or when VITE_DEMO_NOTICE=on), say plainly that the data is not
// real. VITE_DEMO_NOTICE=off hides it, e.g. for a production deployment with real sellers.
const SHOW_DEMO_NOTICE =
  import.meta.env.VITE_DEMO_NOTICE === 'on' || (import.meta.env.VITE_DEMO_NOTICE !== 'off' && import.meta.env.MODE !== 'production');
const DEMO_NOTICE_KEY = 'localstock.demoNoticeDismissed';

function DemoNotice() {
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(DEMO_NOTICE_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (!SHOW_DEMO_NOTICE || hidden) return null;
  return (
    <div role="note" className="bg-gold/15 text-[12px] text-amber-900 dark:text-gold">
      <div className="container flex items-center gap-2 py-1.5">
        <FlaskConical className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          <strong>Demo environment.</strong> Sellers, prices and stock are generated test data, and "Demo Quick-Commerce" results are fixture data. Nothing here is a real offer.
        </span>
        <button
          className="shrink-0 rounded p-0.5 hover:bg-gold/20"
          aria-label="Hide demo notice"
          onClick={() => {
            try {
              sessionStorage.setItem(DEMO_NOTICE_KEY, '1');
            } catch {
              // storage unavailable: hidden for this page view only
            }
            setHidden(true);
          }}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

const SHOPPER_PATHS = /^\/($|search|c\/|product\/)/;

/** Floating "View cart" bar on shopping pages, like a quick-commerce app. */
function CartBar() {
  const { count, items } = useCart();
  const { pathname } = useLocation();
  const total = items.reduce((n, i) => n + (i.priceHintMinor ?? 0) * i.quantity, 0);
  const show = count > 0 && SHOPPER_PATHS.test(pathname);
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 90, opacity: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 260 }}
          className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4"
        >
          <Link
            to="/cart"
            className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-primary px-4 py-3 text-primary-foreground shadow-2xl shadow-primary/30 ring-1 ring-black/5 transition hover:brightness-110"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-white/15">
              <ShoppingCart className="size-5" />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-sm font-extrabold">
                {count} item{count === 1 ? '' : 's'}
              </span>
              <span className="block text-xs font-semibold opacity-85">
                <NumberTicker value={total} format={price} /> · prices confirmed at checkout
              </span>
            </span>
            <span className="inline-flex items-center gap-0.5 text-sm font-extrabold">
              View cart <ChevronRight className="size-4" />
            </span>
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RequireAuth({ children, admin }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner className="py-32" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (admin && !isAdmin) return <Navigate to="/" replace />;
  return children;
}

function useNavItems() {
  const { user, isAdmin } = useAuth();
  return [
    { to: '/', label: 'Shop', icon: ShoppingBag, end: true },
    user && { to: '/orders', label: 'Orders', icon: Package },
    user && { to: '/seller', label: 'Seller hub', icon: Store },
    isAdmin && { to: '/admin', label: 'Admin', icon: ShieldCheck },
    { to: '/explorer', label: 'API', icon: Code2 },
  ].filter(Boolean);
}

function TopBar() {
  const { user } = useAuth();
  const items = useNavItems();
  return (
    <header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur-xl supports-[backdrop-filter]:bg-card/75">
      <div className="container flex h-[72px] items-center gap-3 lg:gap-5">
        <MobileNav items={items} />
        <Logo />
        <span className="hidden h-10 w-px bg-border md:block" />
        <DeliveryEta />
        <SearchBar className="hidden flex-1 md:flex" />
        <div className="ml-auto flex items-center gap-1 sm:gap-1.5 md:ml-0">
          <Health />
          <nav className="hidden items-center xl:flex">
            {items
              .filter((i) => i.to !== '/')
              .map((i) => (
                <Tooltip key={i.to}>
                  <TooltipTrigger asChild>
                    <Button asChild variant="ghost" size="icon" aria-label={i.label}>
                      <Link to={i.to}>
                        <i.icon />
                      </Link>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{i.label}</TooltipContent>
                </Tooltip>
              ))}
          </nav>
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          {user ? (
            <UserMenu />
          ) : (
            <Button asChild variant="ghost" className="px-2 font-bold sm:px-4">
              <Link to="/login">
                <UserRound className="sm:hidden" />
                <span className="hidden sm:inline">Login</span>
              </Link>
            </Button>
          )}
          <CartButton />
        </div>
      </div>
      <div className="container pb-3 md:hidden">
        <SearchBar />
      </div>
    </header>
  );
}

function CartButton() {
  const { count, items } = useCart();
  const total = items.reduce((n, i) => n + (i.priceHintMinor ?? 0) * i.quantity, 0);
  return (
    <Link
      to="/cart"
      aria-label="Cart"
      className={cn(
        'ml-1 flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-extrabold shadow-sm transition active:scale-[0.97]',
        count ? 'bg-primary text-primary-foreground hover:brightness-110' : 'bg-muted text-muted-foreground hover:text-foreground',
      )}
    >
      <ShoppingCart className="size-5" />
      {count ? (
        <span className="hidden flex-col leading-none sm:flex">
          <span className="text-[11px] font-bold opacity-90">
            {count} item{count === 1 ? '' : 's'}
          </span>
          <NumberTicker value={total} format={price} className="mt-0.5" />
        </span>
      ) : (
        <span className="hidden sm:inline">My Cart</span>
      )}
      {count > 0 && <span className="num grid min-w-5 place-items-center rounded-full bg-gold px-1 text-[10px] text-gold-foreground sm:hidden">{count}</span>}
    </Link>
  );
}

// Fastest delivery estimate to the chosen point, from the first page of the catalog.
const etaCache = new Map();
function useFastestEta(location) {
  const key = `${location.lat},${location.lng}`;
  const [eta, setEta] = useState(etaCache.get(key));
  useEffect(() => {
    let alive = true;
    if (etaCache.has(key)) return setEta(etaCache.get(key));
    searchCatalog({ limit: 30, location, sort: 'fastest' })
      .then((r) => {
        const all = r.items.flatMap((i) => i.offers.map((o) => o.estimatedDeliveryMinutes)).filter((m) => m != null);
        const best = all.length ? Math.min(...all) : null;
        etaCache.set(key, best);
        if (alive) setEta(best);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, location]);
  return eta;
}

function DeliveryEta() {
  const { location } = useDeliveryLocation();
  const eta = useFastestEta(location);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="group min-w-0 shrink-0 text-left" title="Change delivery location">
        <span className="flex items-center gap-1 text-[15px] font-black leading-tight tracking-tight sm:text-base">
          <Zap className="size-4 fill-gold text-gold" />
          {eta === undefined ? 'Finding riders…' : eta === null ? 'Not serviceable yet' : `Delivery in ${eta} minutes`}
        </span>
        <span className="flex max-w-[210px] items-center gap-0.5 truncate text-xs font-medium text-muted-foreground group-hover:text-foreground">
          <MapPin className="size-3 shrink-0" />
          <span className="truncate">{location.label ?? `${location.lat}, ${location.lng}`}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </span>
      </button>
      {open && <LocationModal onClose={() => setOpen(false)} />}
    </>
  );
}

const SEARCH_HINTS = ['"milk"', '"maggi"', '"chips"', '"atta"', '"chocolate"', '"paneer"', '"coffee"', '"ghee"'];

/** Header search: debounced live results on /search, rotating placeholder when empty. */
function SearchBar({ className }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const current = pathname === '/search' ? params.get('q') ?? '' : '';
  const [draft, setDraft] = useState(current);
  const inputRef = useRef(null);
  const timer = useRef();

  useEffect(() => {
    setDraft(current);
  }, [current]);

  const go = (term, replace) => {
    clearTimeout(timer.current);
    navigate(`/search?q=${encodeURIComponent(term.trim())}`, { replace });
  };

  return (
    <form
      role="search"
      className={cn('relative flex h-12 items-center gap-2 rounded-xl border bg-muted/60 px-3.5 transition focus-within:border-primary/50 focus-within:bg-card focus-within:ring-4 focus-within:ring-primary/10', className)}
      onSubmit={(e) => {
        e.preventDefault();
        go(draft, pathname === '/search');
      }}
    >
      <Search className="size-[18px] shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          setDraft(v);
          clearTimeout(timer.current);
          if (v.trim().length >= 2) timer.current = setTimeout(() => go(v, pathname === '/search'), 350);
        }}
        aria-label="Search products"
        className="peer h-full min-w-0 flex-1 bg-transparent text-[15px] font-medium focus:outline-none"
      />
      {!draft && (
        <span className="pointer-events-none absolute left-11 flex items-center gap-1 text-[15px] text-muted-foreground">
          Search <RotatingText words={SEARCH_HINTS} className="font-semibold text-foreground/70" />
        </span>
      )}
      {draft && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft('');
            inputRef.current?.focus();
          }}
          className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </form>
  );
}

function Logo({ light }) {
  return (
    <Link to="/" className="group flex shrink-0 items-center gap-2">
      <span className="relative grid size-10 place-items-center rounded-xl bg-gold font-black text-gold-foreground shadow-sm transition-transform group-hover:rotate-[-6deg]">
        <span className="text-lg leading-none">L</span>
        <Zap className="absolute -bottom-1 -right-1 size-4 rounded-full bg-primary p-0.5 text-white" />
      </span>
      <span className={cn('hidden text-xl font-black tracking-tight sm:block', light && 'text-white')}>
        local<span className="text-primary">stock</span>
      </span>
    </Link>
  );
}

function MobileNav({ items }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Menu">
          <Menu />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {items.map((i) => (
          <DropdownMenuItem key={i.to} asChild>
            <Link to={i.to}>
              <i.icon /> {i.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Health() {
  const [state, setState] = useState(null);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const r = await rawRequest('GET', '/health/ready', { auth: false });
        if (alive) setState(r.ok ? r.data : { status: 'down', ...r.data });
      } catch {
        if (alive) setState({ status: 'unreachable' });
      }
    };
    check();
    const t = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const ok = state?.status === 'ready';
  const tip = state
    ? ok
      ? `All systems operational · Postgres ${state.checks?.postgres?.latencyMs} ms · Redis ${state.checks?.redis?.latencyMs} ms`
      : `API ${state.status}`
    : 'Checking API…';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link to="/explorer" className="hidden items-center gap-2 rounded-full border bg-card px-2.5 py-1 text-[11px] font-semibold text-muted-foreground shadow-sm xl:flex">
          <span className="relative flex size-2">
            {ok && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />}
            <span className={cn('relative inline-flex size-2 rounded-full', state ? (ok ? 'bg-success' : 'bg-destructive') : 'bg-muted-foreground')} />
          </span>
          {state ? (ok ? 'Live' : 'Offline') : '…'}
        </Link>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

function ThemeToggle() {
  const { theme, setTheme, resolved } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Theme">
          {resolved === 'dark' ? <Moon /> : <Sun />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun className="text-muted-foreground" /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="text-muted-foreground" /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="text-muted-foreground" /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LocationModal({ onClose }) {
  const { location, setLocation } = useDeliveryLocation();
  const toast = useToast();
  const [lat, setLat] = useState(String(location.lat));
  const [lng, setLng] = useState(String(location.lng));
  const [locating, setLocating] = useState(false);

  const choose = (place) => {
    setLocation(place);
    toast(`Delivering to ${place.label}`, 'info');
    onClose();
  };
  const useMine = () => {
    if (!navigator.geolocation) return toast('Geolocation is not available in this browser', 'bad');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        choose({ label: 'My location', lat: Number(p.coords.latitude.toFixed(5)), lng: Number(p.coords.longitude.toFixed(5)) });
      },
      () => {
        setLocating(false);
        toast('Could not read your location', 'bad');
      },
    );
  };
  const custom = Number(lat) >= -90 && Number(lat) <= 90 && Number(lng) >= -180 && Number(lng) <= 180 && lat !== '' && lng !== '';

  return (
    <Modal
      title="Where should we deliver?"
      description="Search, quotes and orders only use warehouses whose service area covers this point. The demo sellers are in Delhi and Noida."
      onClose={onClose}
      className="max-w-xl"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {PLACES.map((p) => {
          const on = p.label === location.label;
          return (
            <button
              key={p.label}
              onClick={() => choose(p)}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3 text-left transition hover:border-primary/40 hover:bg-accent/50',
                on && 'border-primary/50 bg-accent ring-2 ring-primary/15',
              )}
            >
              <span className={cn('grid size-9 place-items-center rounded-lg', on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                <MapPin className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">{p.label}</span>
                <span className="block font-mono text-[11px] text-muted-foreground">
                  {p.lat}, {p.lng}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <Button variant="secondary" onClick={useMine} busy={locating}>
        <Crosshair /> Use my current location
      </Button>
      <Separator />
      <div className="flex items-end gap-2">
        <Field label="Latitude" className="flex-1">
          <Input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Longitude" className="flex-1">
          <Input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" />
        </Field>
        <Button disabled={!custom} onClick={() => choose({ label: `${Number(lat).toFixed(3)}, ${Number(lng).toFixed(3)}`, lat: Number(lat), lng: Number(lng) })}>
          Set
        </Button>
      </div>
    </Modal>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="ml-1 rounded-full ring-offset-2 ring-offset-background transition hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
          <Avatar>
            <AvatarFallback>{user.name?.[0]?.toUpperCase() ?? '?'}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <div className="font-bold">{user.name}</div>
          <div className="truncate text-xs font-normal text-muted-foreground">{user.email}</div>
          {user.platformRole === 'ADMIN' && (
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-gold">
              <ShieldCheck className="size-3" /> Platform admin
            </div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account">
            <UserRound /> Account & sessions
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/orders">
            <Package /> My orders
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/seller">
            <LayoutDashboard /> Seller hub
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive [&_svg]:text-destructive"
          onSelect={async () => {
            await logout();
            toast('Signed out', 'info');
            navigate('/');
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Footer() {
  const cols = [
    ['Shop', [['/', 'Browse products'], ['/cart', 'Cart & checkout'], ['/orders', 'Track orders']]],
    ['Sell', [['/seller', 'Seller hub'], ['/seller', 'Warehouses & stock'], ['/seller', 'Delivery fleet']]],
    ['Platform', [['/explorer', 'API explorer'], ['/admin', 'Admin console'], ['/account', 'Account']]],
  ];
  return (
    <footer className="mt-16 border-t bg-card/50">
      <div className="container grid gap-10 py-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-4 text-sm text-muted-foreground">
            Every local seller, one checkout. LocalStock compares nearby warehouses on price, stock and delivery time, then fulfils your whole cart in a single order.
          </p>
        </div>
        {cols.map(([heading, links]) => (
          <div key={heading}>
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{heading}</div>
            <ul className="mt-4 space-y-2.5 text-sm">
              {links.map(([to, label]) => (
                <li key={label}>
                  <Link to={to} className="text-foreground/80 transition hover:text-primary">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t">
        <div className="container flex flex-wrap items-center justify-between gap-3 py-5 text-xs text-muted-foreground">
          <span>
            © {new Date().getFullYear()} LocalStock · Product images from{' '}
            <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-primary hover:underline">
              Open Food Facts
            </a>{' '}
            contributors (CC BY-SA)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-primary" /> Atomic stock reservations · Idempotent checkout · Signed payments
          </span>
        </div>
      </div>
    </footer>
  );
}
