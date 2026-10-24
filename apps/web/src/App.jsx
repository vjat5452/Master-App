import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Button, Field, Modal, Spinner } from './components/ui.jsx';
import { rawRequest } from './lib/api.js';
import { PLACES, useAuth, useCart, useDeliveryLocation, useToast } from './lib/store.jsx';
import Admin from './pages/Admin.jsx';
import Cart from './pages/Cart.jsx';
import Explorer from './pages/Explorer.jsx';
import Login from './pages/Login.jsx';
import OrderDetail from './pages/OrderDetail.jsx';
import Orders from './pages/Orders.jsx';
import Product from './pages/Product.jsx';
import Seller from './pages/Seller.jsx';
import Shop from './pages/Shop.jsx';
import Account from './pages/Account.jsx';

export default function App() {
  return (
    <div className="shell">
      <TopBar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Shop />} />
          <Route path="/product/:variantId" element={<Product />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/login" element={<Login />} />
          <Route path="/orders" element={<RequireAuth><Orders /></RequireAuth>} />
          <Route path="/orders/:orderId" element={<RequireAuth><OrderDetail /></RequireAuth>} />
          <Route path="/seller" element={<RequireAuth><Seller /></RequireAuth>} />
          <Route path="/seller/:companyId" element={<RequireAuth><Seller /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
          <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
          <Route path="/explorer" element={<Explorer />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="footer">
        <div className="footer-inner">
          <span>LocalStock · multi-vendor, multi-warehouse commerce</span>
          <span>
            API <code>/api/v1</code> via dev proxy · <Link to="/explorer">API explorer</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

function RequireAuth({ children, admin }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (admin && !isAdmin) return <Navigate to="/" replace />;
  return children;
}

function TopBar() {
  const { user, isAdmin } = useAuth();
  const { count } = useCart();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="logo">
          <span className="logo-mark">L</span> LocalStock
        </Link>
        <nav className="nav">
          <NavLink to="/" end>Shop</NavLink>
          {user && <NavLink to="/orders">My orders</NavLink>}
          {user && <NavLink to="/seller">Seller hub</NavLink>}
          {isAdmin && <NavLink to="/admin">Admin</NavLink>}
          <NavLink to="/explorer">API explorer</NavLink>
        </nav>
        <div className="topbar-right">
          <Health />
          <LocationButton />
          <Link to="/cart" className="btn btn-ghost cart-btn" aria-label="Cart">
            🛒 {count > 0 && <span className="cart-count">{count}</span>}
          </Link>
          {user ? <UserMenu /> : <Link className="btn btn-primary btn-sm" to="/login">Sign in</Link>}
        </div>
      </div>
    </header>
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
      ? `API ready · Postgres ${state.checks?.postgres?.latencyMs} ms · Redis ${state.checks?.redis?.latencyMs} ms`
      : `API ${state.status}`
    : 'Checking API…';
  return (
    <Link to="/explorer" title={tip} className="row gap-sm small muted" style={{ textDecoration: 'none' }}>
      <span className={`dot ${state ? (ok ? 'dot-good' : 'dot-bad') : 'dot-wait'}`} />
      <span className="nowrap">{state ? (ok ? 'API online' : 'API offline') : 'API…'}</span>
    </Link>
  );
}

function LocationButton() {
  const { location } = useDeliveryLocation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="loc-btn" onClick={() => setOpen(true)} title="Delivery location">
        📍 <span>{location.label ?? `${location.lat}, ${location.lng}`}</span>
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
    <Modal title="Delivery location" onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>
        Search, quotes and orders only use warehouses whose service area covers this point. The demo sellers are in Delhi and Noida.
      </p>
      <div className="grid grid-2">
        {PLACES.map((p) => (
          <button key={p.label} className={`demo-user ${p.label === location.label ? 'on' : ''}`} onClick={() => choose(p)}>
            <span>📍</span>
            <span className="grow">
              <div className="strong">{p.label}</div>
              <div className="small faint mono">
                {p.lat}, {p.lng}
              </div>
            </span>
          </button>
        ))}
      </div>
      <Button variant="secondary" onClick={useMine} busy={locating}>
        Use my current location
      </Button>
      <div className="hr" />
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Field label="Latitude" className="grow">
          <input className="input" value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Longitude" className="grow">
          <input className="input" value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" />
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
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="menu" ref={ref}>
      <button className="avatar" onClick={() => setOpen((o) => !o)} aria-label="Account menu">
        {user.name?.[0]?.toUpperCase() ?? '?'}
      </button>
      {open && (
        <div className="menu-pop" onClick={() => setOpen(false)}>
          <div style={{ padding: '8px 10px' }}>
            <div className="strong">{user.name}</div>
            <div className="small muted">{user.email}</div>
            {user.platformRole === 'ADMIN' && <div className="small" style={{ color: 'var(--brand)' }}>Platform admin</div>}
          </div>
          <div className="hr" />
          <Link to="/account">Account & sessions</Link>
          <Link to="/orders">My orders</Link>
          <Link to="/seller">Seller hub</Link>
          <div className="hr" />
          <button
            onClick={async () => {
              await logout();
              toast('Signed out', 'info');
              navigate('/');
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
