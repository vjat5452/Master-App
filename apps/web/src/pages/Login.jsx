import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Building2, Check, Layers, ShieldCheck, ShoppingBag, Store, Zap } from 'lucide-react';
import { Button, ErrorBox, Field, Tabs, useSubmit } from '@/components/kit';
import { Input } from '@/components/ui/input';
import { useAuth, useToast } from '@/lib/store';
import { cn } from '@/lib/utils';

const DEMO_PASSWORD = 'localstock-dev-password';
const DEMO_USERS = [
  { email: 'customer@localstock.dev', label: 'Chitra Customer', role: 'Shop, quote, order and pay', icon: ShoppingBag, tint: 'from-emerald-500 to-teal-600', next: '/' },
  { email: 'seller.a@localstock.dev', label: 'FreshMart Noida', role: 'Seller: warehouses, offers, stock', icon: Store, tint: 'from-amber-400 to-orange-600', next: '/seller' },
  { email: 'seller.b@localstock.dev', label: 'Daily Needs Delhi', role: 'Seller: warehouses, offers, stock', icon: Building2, tint: 'from-sky-500 to-indigo-600', next: '/seller' },
  { email: 'admin@localstock.dev', label: 'Platform admin', role: 'Catalog, moderation, couriers', icon: ShieldCheck, tint: 'from-rose-500 to-fuchsia-600', next: '/admin' },
];

const POINTS = [
  [Layers, 'Compare every nearby seller in one place'],
  [Zap, 'Checkout plans warehouses and couriers for you'],
  [ShieldCheck, 'Stock reserved atomically, payments verified'],
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
    <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-2">
      <aside className="bg-aurora relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="bg-grid absolute inset-0" aria-hidden />
        <div className="relative text-xs font-bold uppercase tracking-[0.2em] text-emerald-200">Local commerce, reimagined</div>
        <div className="relative max-w-md">
          <h2 className="text-5xl font-extrabold leading-[1.05] tracking-tight">
            Shop local.
            <br />
            <span className="text-gradient font-display text-[1.1em] font-normal italic">Deliver smart.</span>
          </h2>
          <p className="mt-5 text-emerald-50/80">One account to shop from every nearby seller, or to run your own stores across as many warehouses as you like.</p>
          <ul className="mt-8 space-y-3">
            {POINTS.map(([Icon, text], i) => (
              <motion.li
                key={text}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
                className="glass flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold"
              >
                <span className="grid size-8 place-items-center rounded-lg bg-white/15">
                  <Icon className="size-4" />
                </span>
                {text}
              </motion.li>
            ))}
          </ul>
        </div>
        <div className="relative text-xs text-emerald-50/60">© {new Date().getFullYear()} LocalStock</div>
      </aside>

      <div className="flex items-center justify-center px-5 py-12 sm:px-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-8">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
            <p className="mt-2 text-muted-foreground">{mode === 'login' ? 'Sign in to compare sellers and check out.' : 'It takes less than a minute.'}</p>
          </div>

          <Tabs
            tabs={[{ id: 'login', label: 'Sign in' }, { id: 'register', label: 'Register' }]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              submit.setError(null);
            }}
            className="[&>div]:w-full [&_button]:flex-1"
          />

          <form className="space-y-4" onSubmit={submit.run}>
            {mode === 'register' && (
              <Field label="Full name">
                <Input value={form.name} onChange={set('name')} required maxLength={120} autoComplete="name" placeholder="Asha Verma" />
              </Field>
            )}
            <Field label="Email">
              <Input type="email" value={form.email} onChange={set('email')} required autoComplete="email" placeholder="you@company.com" />
            </Field>
            <Field label="Password" hint={mode === 'register' ? 'At least 10 characters' : undefined}>
              <Input
                type="password"
                value={form.password}
                onChange={set('password')}
                required
                minLength={mode === 'register' ? 10 : 1}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="••••••••••"
              />
            </Field>
            <ErrorBox error={submit.error} />
            <Button type="submit" size="lg" busy={submit.busy} block>
              {mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight />
            </Button>
          </form>

          <div>
            <div className="mb-3 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or explore a demo account <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {DEMO_USERS.map((u) => (
                <button
                  key={u.email}
                  onClick={() => demo.run(u)}
                  disabled={demo.busy}
                  className="group flex items-center gap-3 rounded-2xl border bg-card p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lift disabled:opacity-60"
                >
                  <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm', u.tint)}>
                    <u.icon className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{u.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{u.role}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="size-3.5 text-primary" /> Seeded by <code className="font-mono">npm run db:seed</code>
            </p>
            <div className="mt-3">
              <ErrorBox error={demo.error} />
            </div>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Just browsing? <Link to="/" className="font-semibold text-primary hover:underline">Continue to the shop</Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
