import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, ErrorBox, Field, Tabs, useSubmit } from '../components/ui.jsx';
import { useAuth, useToast } from '../lib/store.jsx';

const DEMO_PASSWORD = 'localstock-dev-password';
const DEMO_USERS = [
  { email: 'customer@localstock.dev', label: 'Chitra Customer', role: 'Shops, quotes, places and pays orders', icon: '🛍️', next: '/' },
  { email: 'seller.a@localstock.dev', label: 'FreshMart Noida', role: 'Seller owner: warehouses, offers, stock', icon: '🏪', next: '/seller' },
  { email: 'seller.b@localstock.dev', label: 'Daily Needs Delhi', role: 'Seller owner: warehouses, offers, stock', icon: '🏬', next: '/seller' },
  { email: 'admin@localstock.dev', label: 'Platform admin', role: 'Catalog, moderation, platform delivery', icon: '🛡️', next: '/admin' },
];

export default function Login() {
  const { login, register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const done = (user, next) => {
    toast(`Welcome, ${user?.name ?? 'back'}`);
    navigate(params.get('next') ?? next ?? '/', { replace: true });
  };

  const submit = useSubmit(async (e) => {
    e?.preventDefault();
    const user = mode === 'login' ? await login(form.email, form.password) : await register(form.name, form.email, form.password);
    done(user);
  });
  const demo = useSubmit(async (u) => done(await login(u.email, DEMO_PASSWORD), u.next));

  return (
    <div className="auth-wrap">
      <div className="stack auth-card">
        <div className="center">
          <h1>{mode === 'login' ? 'Sign in to LocalStock' : 'Create your account'}</h1>
          <p className="muted">Compare local sellers by price and delivery time.</p>
        </div>
        <Card>
          <Tabs
            tabs={[{ id: 'login', label: 'Sign in' }, { id: 'register', label: 'Register' }]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              submit.setError(null);
            }}
          />
          <form className="stack" onSubmit={submit.run}>
            {mode === 'register' && (
              <Field label="Full name">
                <input className="input" value={form.name} onChange={set('name')} required maxLength={120} autoComplete="name" />
              </Field>
            )}
            <Field label="Email">
              <input className="input" type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
            </Field>
            <Field label="Password" hint={mode === 'register' ? 'At least 10 characters' : undefined}>
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={set('password')}
                required
                minLength={mode === 'register' ? 10 : 1}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </Field>
            <ErrorBox error={submit.error} />
            <Button type="submit" size="lg" busy={submit.busy} className="btn-block">
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        </Card>

        <Card title="Demo accounts" actions={<span className="small faint">from npm run db:seed</span>}>
          <div className="demo-users">
            {DEMO_USERS.map((u) => (
              <button key={u.email} className="demo-user" onClick={() => demo.run(u)} disabled={demo.busy}>
                <span style={{ fontSize: 22 }}>{u.icon}</span>
                <span className="grow">
                  <div className="strong">{u.label}</div>
                  <div className="small muted">{u.role}</div>
                  <div className="small faint mono">{u.email}</div>
                </span>
                <span className="faint">→</span>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <ErrorBox error={demo.error} />
          </div>
        </Card>
      </div>
    </div>
  );
}
