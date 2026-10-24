import { useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, Empty, ErrorBox, Field, Spinner, Stat, Tabs, useSubmit } from '../components/ui.jsx';
import { get, post } from '../lib/api.js';
import { money } from '../lib/format.js';
import { useAsync, useAuth, useToast } from '../lib/store.jsx';
import Delivery from './seller/Delivery.jsx';
import Inventory from './seller/Inventory.jsx';
import Members from './seller/Members.jsx';
import Offers from './seller/Offers.jsx';
import Warehouses from './seller/Warehouses.jsx';

export default function Seller() {
  const { companyId } = useParams();
  const companies = useAsync(() => get('/companies'), []);

  if (companies.loading && !companies.data) return <Spinner />;
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
      <div className="page-head">
        <div>
          <h1>Seller hub</h1>
          <p>Run your stores: warehouses, catalog offers, stock levels, delivery fleet and team.</p>
        </div>
      </div>
      <div className="split">
        <Card title="Your companies">
          {companies.length === 0 ? (
            <Empty icon="🏪" title="You're not part of a company yet">
              Register a company to start selling, or ask an owner to add you as staff.
            </Empty>
          ) : (
            <div className="demo-users">
              {companies.map((c) => (
                <button key={c.id} className="demo-user" onClick={() => navigate(`/seller/${c.id}`)}>
                  <span style={{ fontSize: 22 }}>🏪</span>
                  <span className="grow">
                    <div className="strong">{c.name}</div>
                    <div className="small muted">Your role: {c.role}</div>
                  </span>
                  <Badge status={c.status} />
                </button>
              ))}
            </div>
          )}
        </Card>
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
    <Card title="Register a company">
      <form className="stack" onSubmit={submit.run}>
        <Field label="Company name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={200} required />
        </Field>
        <Field label="Registration number" hint="Optional, e.g. GSTIN">
          <input className="input" value={reg} onChange={(e) => setReg(e.target.value)} maxLength={100} />
        </Field>
        <ErrorBox error={submit.error} />
        <Button type="submit" busy={submit.busy}>
          Create company
        </Button>
      </form>
    </Card>
  );
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'offers', label: 'Offers' },
  { id: 'warehouses', label: 'Warehouses' },
  { id: 'delivery', label: 'Delivery fleet' },
  { id: 'members', label: 'Team' },
];

function Dashboard({ company, companies }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const canManage = company.role === 'OWNER' || company.role === 'ADMIN';
  const ctx = { companyId: company.id, canManage, role: company.role };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row gap-sm">
            <h1>{company.name}</h1>
            <Badge kind="info">{company.role}</Badge>
          </div>
          <p>{canManage ? 'You can manage everything in this company.' : 'Staff access: you can view everything and adjust stock.'}</p>
        </div>
        {companies.length > 1 && (
          <select className="select" style={{ width: 'auto' }} value={company.id} onChange={(e) => navigate(`/seller/${e.target.value}`)}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <Tabs tabs={TABS} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === 'overview' && <Overview {...ctx} go={(t) => setParams({ tab: t })} />}
      {tab === 'inventory' && <Inventory {...ctx} />}
      {tab === 'offers' && <Offers {...ctx} />}
      {tab === 'warehouses' && <Warehouses {...ctx} />}
      {tab === 'delivery' && <Delivery {...ctx} />}
      {tab === 'members' && <Members {...ctx} />}
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

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { warehouses, offers, inventory, fleet } = data;
  const onHand = inventory.reduce((s, r) => s + r.onHand, 0);
  const reserved = inventory.reduce((s, r) => s + r.reserved, 0);
  const value = inventory.reduce((s, r) => s + r.available * (offers.find((o) => o.id === r.offerId)?.priceMinor ?? 0), 0);
  const low = inventory.filter((r) => r.available <= 5).sort((a, b) => a.available - b.available);
  const setup = [
    { done: warehouses.length > 0, label: 'Add a warehouse', tab: 'warehouses' },
    { done: offers.length > 0, label: 'List an offer for a catalog product', tab: 'offers' },
    { done: onHand > 0, label: 'Stock a warehouse', tab: 'inventory' },
  ];

  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat label="Warehouses" value={warehouses.filter((w) => w.status === 'ACTIVE').length} sub={`${warehouses.length} total`} />
        <Stat label="Active offers" value={offers.filter((o) => o.status === 'ACTIVE').length} sub={`${offers.length} total`} />
        <Stat label="Units on hand" value={onHand} sub={`${reserved} reserved for open orders`} />
        <Stat label="Sellable stock value" value={money(value)} sub="available × current price" />
      </div>
      {setup.some((s) => !s.done) && (
        <Card title="Get selling">
          <div className="stack-sm">
            {setup.map((s) => (
              <div key={s.label} className="row between">
                <span>
                  {s.done ? '✅' : '⬜'} {s.label}
                </span>
                {!s.done && (
                  <Button size="sm" variant="secondary" onClick={() => go(s.tab)}>
                    Open
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
      <div className="grid grid-2">
        <Card title="Low stock" actions={<Button size="sm" variant="ghost" onClick={() => go('inventory')}>Manage →</Button>} pad={false}>
          {low.length === 0 ? (
            <Empty icon="✓" title="Every item has more than 5 units available" />
          ) : (
            <table className="table">
              <tbody>
                {low.slice(0, 6).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="strong">{r.variantName}</div>
                      <div className="small muted">{r.warehouseName}</div>
                    </td>
                    <td className="num">
                      <Badge kind={r.available === 0 ? 'bad' : 'warn'}>{r.available} left</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Warehouses" actions={<Button size="sm" variant="ghost" onClick={() => go('warehouses')}>Manage →</Button>} pad={false}>
          {warehouses.length === 0 ? (
            <Empty icon="🏭" title="No warehouses yet" />
          ) : (
            <table className="table">
              <tbody>
                {warehouses.map((w) => {
                  const rows = inventory.filter((r) => r.warehouseId === w.id);
                  return (
                    <tr key={w.id}>
                      <td>
                        <div className="strong">{w.name}</div>
                        <div className="small muted">
                          {w.serviceRadiusKm} km radius · {rows.length} SKUs
                        </div>
                      </td>
                      <td className="num">{rows.reduce((s, r) => s + r.available, 0)} avail.</td>
                      <td className="num">
                        <Badge status={w.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      <div className="small faint">
        {fleet.length} own delivery fleet{fleet.length === 1 ? '' : 's'} registered. Platform couriers are also available at checkout.
      </div>
    </div>
  );
}
