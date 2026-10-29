import { useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bike,
  Boxes,
  Building2,
  CheckCircle2,
  Circle,
  IndianRupee,
  LayoutDashboard,
  PieChart,
  Plus,
  Rocket,
  Store,
  Tag,
  Upload,
  Users,
  Warehouse,
} from 'lucide-react';
import { Donut, StackedBars } from '@/components/mui/lazy';
import { Badge, Button, Empty, ErrorBox, Field, PageHeader, Panel, SkeletonRows, Spinner, Stat, Tabs, useSubmit } from '@/components/kit';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { get, post } from '@/lib/api';
import { money } from '@/lib/format';
import { useAsync, useAuth, useToast } from '@/lib/store';
import { cn } from '@/lib/utils';
import Delivery from './seller/Delivery.jsx';
import Import from './seller/Import.jsx';
import Inventory from './seller/Inventory.jsx';
import Members from './seller/Members.jsx';
import Offers from './seller/Offers.jsx';
import Warehouses from './seller/Warehouses.jsx';

export default function Seller() {
  const { companyId } = useParams();
  const companies = useAsync(() => get('/companies'), []);

  if (companies.loading && !companies.data) return <Spinner className="py-32" />;
  if (companies.error) return <ErrorBox error={companies.error} onRetry={companies.reload} />;
  const list = companies.data.items;

  if (!companyId) {
    if (list.length === 1) return <Navigate to={`/seller/${list[0].id}`} replace />;
    return <CompanyPicker companies={list} onCreated={companies.reload} />;
  }
  const company = list.find((c) => c.id === companyId);
  if (!company) return <Navigate to="/seller" replace />;
  return <Dashboard company={company} companies={list} />;
}

function CompanyPicker({ companies, onCreated }) {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        eyebrow="Seller hub"
        title="Run your stores"
        description="Warehouses, catalog offers, stock levels, delivery fleet and team, all in one place."
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Panel icon={Building2} title="Your companies" pad={companies.length > 0}>
          {companies.length === 0 ? (
            <Empty icon={Store} title="You're not part of a company yet">
              Register a company to start selling, or ask an owner to add you as staff.
            </Empty>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {companies.map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate(`/seller/${c.id}`)}
                  className="group flex items-center gap-3 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lift"
                >
                  <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-white">
                    <Store className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{c.name}</span>
                    <span className="text-xs text-muted-foreground">Your role: {c.role}</span>
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
          )}
        </Panel>
        <CreateCompany onCreated={onCreated} />
      </div>
    </>
  );
}

function CreateCompany({ onCreated }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { reload } = useAuth();
  const [name, setName] = useState('');
  const [reg, setReg] = useState('');
  const submit = useSubmit(async (e) => {
    e.preventDefault();
    const c = await post('/companies', { name, ...(reg.trim() ? { registrationNumber: reg.trim() } : {}) });
    toast(`${c.name} created. You're the owner.`);
    await Promise.all([onCreated(), reload()]);
    navigate(`/seller/${c.id}?tab=warehouses`);
  });
  return (
    <Card className="overflow-hidden">
      <div className="bg-aurora relative p-6 text-white">
        <div className="bg-grid absolute inset-0" aria-hidden />
        <Rocket className="relative size-7 text-amber-200" />
        <h3 className="relative mt-3 text-xl font-extrabold">Register a company</h3>
        <p className="relative mt-1 text-sm text-emerald-50/80">You'll be its owner and can invite your team.</p>
      </div>
      <form className="space-y-4 p-6" onSubmit={submit.run}>
        <Field label="Company name">
          <Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={200} required placeholder="Corner Store Pvt Ltd" />
        </Field>
        <Field label="Registration number" hint="Optional, e.g. GSTIN">
          <Input value={reg} onChange={(e) => setReg(e.target.value)} maxLength={100} />
        </Field>
        <ErrorBox error={submit.error} />
        <Button type="submit" busy={submit.busy} block>
          <Plus /> Create company
        </Button>
      </form>
    </Card>
  );
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'inventory', label: 'Inventory', icon: Boxes },
  { id: 'offers', label: 'Offers', icon: Tag },
  { id: 'warehouses', label: 'Warehouses', icon: Warehouse },
  { id: 'delivery', label: 'Delivery fleet', icon: Bike },
  { id: 'members', label: 'Team', icon: Users },
  { id: 'import', label: 'Import', icon: Upload },
];

function Dashboard({ company, companies }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const canManage = company.role === 'OWNER' || company.role === 'ADMIN';
  const ctx = { companyId: company.id, canManage, role: company.role };

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-lift">
            <Store className="size-7" />
          </span>
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Seller hub</div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{company.name}</h1>
              <Badge kind="info">{company.role}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{canManage ? 'You can manage everything in this company.' : 'Staff access: view everything and adjust stock.'}</p>
          </div>
        </div>
        {companies.length > 1 && (
          <Select value={company.id} onValueChange={(id) => navigate(`/seller/${id}`)}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <Tabs tabs={TABS} value={tab} onChange={(t) => setParams({ tab: t })} className="mb-8" />
      {tab === 'overview' && <Overview {...ctx} go={(t) => setParams({ tab: t })} />}
      {tab === 'inventory' && <Inventory {...ctx} />}
      {tab === 'offers' && <Offers {...ctx} />}
      {tab === 'warehouses' && <Warehouses {...ctx} />}
      {tab === 'delivery' && <Delivery {...ctx} />}
      {tab === 'members' && <Members {...ctx} />}
      {tab === 'import' && <Import {...ctx} />}
    </>
  );
}

function Overview({ companyId, go }) {
  const { data, error, loading, reload } = useAsync(async () => {
    const [w, o, i, d] = await Promise.all([
      get(`/companies/${companyId}/warehouses`),
      get(`/companies/${companyId}/offers`),
      get(`/companies/${companyId}/inventory`),
      get(`/companies/${companyId}/delivery-providers`),
    ]);
    return { warehouses: w.items, offers: o.items, inventory: i.items, fleet: d.items };
  }, [companyId]);

  if (loading && !data) {
    return (
      <Card>
        <SkeletonRows rows={6} />
      </Card>
    );
  }
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { warehouses, offers, inventory, fleet } = data;
  const onHand = inventory.reduce((s, r) => s + r.onHand, 0);
  const reserved = inventory.reduce((s, r) => s + r.reserved, 0);
  const available = onHand - reserved;
  const value = inventory.reduce((s, r) => s + r.available * (offers.find((o) => o.id === r.offerId)?.priceMinor ?? 0), 0);
  const low = inventory.filter((r) => r.available <= 5).sort((a, b) => a.available - b.available);
  const setup = [
    { done: warehouses.length > 0, label: 'Add a warehouse', tab: 'warehouses' },
    { done: offers.length > 0, label: 'List an offer for a catalog product', tab: 'offers' },
    { done: onHand > 0, label: 'Stock a warehouse', tab: 'inventory' },
    { done: fleet.length > 0, label: 'Register your own delivery fleet (optional)', tab: 'delivery' },
  ];
  const doneCount = setup.filter((s) => s.done).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat index={0} icon={Warehouse} label="Warehouses" value={warehouses.filter((w) => w.status === 'ACTIVE').length} sub={`${warehouses.length} total`} />
        <Stat index={1} icon={Tag} tone="blue" label="Active offers" value={offers.filter((o) => o.status === 'ACTIVE').length} sub={`${offers.length} total`} />
        <Stat index={2} icon={Boxes} tone="gold" label="Units on hand" value={onHand} sub={`${reserved} reserved for open orders`} />
        <Stat index={3} icon={IndianRupee} tone="rose" label="Sellable stock value" value={money(value)} sub="available × current price" />
      </div>

      {doneCount < setup.length && (
        <Panel icon={Rocket} title="Get selling" description={`${doneCount} of ${setup.length} steps complete`}>
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-amber-400 transition-all" style={{ width: `${(doneCount / setup.length) * 100}%` }} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {setup.map((s) => (
              <button
                key={s.label}
                onClick={() => go(s.tab)}
                className={cn('flex items-center gap-3 rounded-xl border p-3 text-left text-sm transition hover:bg-muted/40', s.done && 'opacity-70')}
              >
                {s.done ? <CheckCircle2 className="size-5 shrink-0 text-success" /> : <Circle className="size-5 shrink-0 text-muted-foreground" />}
                <span className={cn('flex-1 font-semibold', s.done && 'line-through')}>{s.label}</span>
                {!s.done && <ArrowRight className="size-4 text-muted-foreground" />}
              </button>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel icon={BarChart3} title="Stock by warehouse" description="Available vs reserved units">
          {warehouses.length === 0 || inventory.length === 0 ? (
            <Empty icon={BarChart3} title="No stock yet" className="py-10">
              Stock a warehouse to see it charted here.
            </Empty>
          ) : (
            <StackedBars
              categories={warehouses.map((w) => w.name)}
              series={[
                { label: 'Available', data: warehouses.map((w) => inventory.filter((r) => r.warehouseId === w.id).reduce((s, r) => s + r.available, 0)) },
                { label: 'Reserved', data: warehouses.map((w) => inventory.filter((r) => r.warehouseId === w.id).reduce((s, r) => s + r.reserved, 0)) },
              ]}
            />
          )}
        </Panel>
        <Panel icon={PieChart} title="Units on hand">
          {onHand === 0 ? (
            <Empty icon={PieChart} title="Nothing on hand" className="py-10" />
          ) : (
            <Donut
              data={[
                { label: 'Available', value: available },
                { label: 'Reserved', value: reserved },
              ]}
              centerLabel="units"
            />
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          icon={AlertTriangle}
          title="Low stock"
          description="Items with 5 or fewer units available"
          pad={false}
          actions={
            <Button size="sm" variant="ghost" onClick={() => go('inventory')}>
              Manage <ArrowRight />
            </Button>
          }
        >
          {low.length === 0 ? (
            <Empty icon={CheckCircle2} title="Everything is well stocked" className="py-10" />
          ) : (
            <ul className="divide-y">
              {low.slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-bold">{r.variantName}</div>
                    <div className="text-xs text-muted-foreground">{r.warehouseName}</div>
                  </div>
                  <Badge kind={r.available === 0 ? 'bad' : 'warn'} dot>
                    {r.available} left
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          icon={Warehouse}
          title="Warehouses"
          description={`${fleet.length} own delivery fleet${fleet.length === 1 ? '' : 's'} · platform couriers also available`}
          pad={false}
          actions={
            <Button size="sm" variant="ghost" onClick={() => go('warehouses')}>
              Manage <ArrowRight />
            </Button>
          }
        >
          {warehouses.length === 0 ? (
            <Empty icon={Warehouse} title="No warehouses yet" className="py-10" />
          ) : (
            <ul className="divide-y">
              {warehouses.map((w) => {
                const rows = inventory.filter((r) => r.warehouseId === w.id);
                return (
                  <li key={w.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <div className="truncate font-bold">{w.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {w.serviceRadiusKm} km radius · {rows.length} SKUs
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="num text-sm font-bold">{rows.reduce((s, r) => s + r.available, 0)} avail.</span>
                      <Badge status={w.status} dot />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
