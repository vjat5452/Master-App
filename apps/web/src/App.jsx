import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Code2,
  Crosshair,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Monitor,
  Moon,
  Package,
  ShieldCheck,
  ShoppingBag,
  Store,
  Sun,
  UserRound,
} from 'lucide-react';
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
import { PLACES, useAuth, useCart, useDeliveryLocation, useToast } from './lib/store.jsx';
import { useTheme } from './lib/theme.jsx';
import { cn } from './lib/utils.js';
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
      <TopBar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Shop />} />
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
    </div>
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
  const { count } = useCart();
  const items = useNavItems();
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center gap-3">
        <MobileNav items={items} />
        <Logo />
        <nav className="ml-4 hidden items-center gap-1 lg:flex">
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.end}
              className={({ isActive }) =>
                cn(
                  'relative rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground',
                  isActive && 'text-foreground after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:rounded-full after:bg-primary',
                )
              }
            >
              {i.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <Health />
          <LocationButton />
          <ThemeToggle />
          <Button asChild variant="ghost" size="icon" className="relative" aria-label="Cart">
            <Link to="/cart">
              <ShoppingBag />
              {count > 0 && (
                <span className="num absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-gold px-1 text-[10px] font-extrabold text-gold-foreground ring-2 ring-background">
                  {count}
                </span>
              )}
            </Link>
          </Button>
          {user ? (
            <UserMenu />
          ) : (
            <Button asChild size="sm" className="ml-1">
              <Link to="/login">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

function Logo({ light }) {
  return (
    <Link to="/" className="group flex shrink-0 items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-800 font-black text-white shadow-glow transition-transform group-hover:rotate-[-6deg]">
        L
      </span>
      <span className={cn('text-lg font-extrabold tracking-tight', light && 'text-white')}>
        Local<span className="font-display text-xl font-normal italic text-primary">Stock</span>
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

function LocationButton() {
  const { location } = useDeliveryLocation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex max-w-[180px] items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-left shadow-sm transition hover:border-primary/40 hover:shadow-soft"
        title="Delivery location"
      >
        <MapPin className="size-4 shrink-0 text-primary" />
        <span className="hidden min-w-0 sm:block">
          <span className="block text-[10px] font-semibold uppercase leading-none tracking-wider text-muted-foreground">Deliver to</span>
          <span className="block truncate text-xs font-bold leading-tight">{location.label ?? `${location.lat}, ${location.lng}`}</span>
        </span>
      </button>
      {open && <LocationModal onClose={() => setOpen(false)} />}
    </>
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
