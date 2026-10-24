import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Attrs } from '../components/product.jsx';
import { ProposeVariantModal } from '../components/VariantPicker.jsx';
import { Badge, Button, Card, CopyId, Empty, ErrorBox, Field, Spinner, Tabs, useSubmit } from '../components/ui.jsx';
import { get, patch, post } from '../lib/api.js';
import { loadKnownGroups, rememberGroup, reviewQueue, searchVariants, setReviewQueue } from '../lib/catalog.js';
import { useAsync, useToast } from '../lib/store.jsx';
import { ProviderModal, ProviderTable } from './seller/Delivery.jsx';

const TABS = [
  { id: 'catalog', label: 'Catalog structure' },
  { id: 'moderation', label: 'Variant moderation' },
  { id: 'delivery', label: 'Platform couriers' },
];

export default function Admin() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'catalog';
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Platform admin</h1>
          <p>Shape the shared catalog that every seller lists against, review proposed products and run platform delivery.</p>
        </div>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === 'catalog' && <CatalogAdmin />}
      {tab === 'moderation' && <Moderation />}
      {tab === 'delivery' && <PlatformDelivery />}
    </>
  );
}

function CatalogAdmin() {
  const toast = useToast();
  const cats = useAsync(() => get('/catalog/categories', { auth: false }), []);
  const groups = useAsync(loadKnownGroups, []);
  const [cat, setCat] = useState({ name: '', slug: '', parentId: '' });
  const [grp, setGrp] = useState({ categoryId: '', name: '', description: '' });
  const [viewGroupId, setViewGroupId] = useState('');
  const [proposing, setProposing] = useState(false);

  const createCat = useSubmit(async (e) => {
    e.preventDefault();
    const c = await post('/catalog/categories', { name: cat.name, slug: cat.slug, ...(cat.parentId ? { parentId: cat.parentId } : {}) });
    toast(`Category "${c.name}" created`);
    setCat({ name: '', slug: '', parentId: '' });
    cats.reload();
  });
  const createGroup = useSubmit(async (e) => {
    e.preventDefault();
    const g = await post('/catalog/groups', { categoryId: grp.categoryId, name: grp.name, ...(grp.description.trim() ? { description: grp.description.trim() } : {}) });
    rememberGroup(g);
    toast(`Group "${g.name}" created`);
    setGrp({ categoryId: grp.categoryId, name: '', description: '' });
    setViewGroupId(g.id);
    groups.reload();
  });
  const group = useAsync(() => (viewGroupId ? get(`/catalog/groups/${viewGroupId}`, { auth: false }) : Promise.resolve(null)), [viewGroupId]);

  const items = cats.data?.items ?? [];
  const roots = items.filter((c) => !c.parentId);
  const children = (id) => items.filter((c) => c.parentId === id);
  const catName = Object.fromEntries(items.map((c) => [c.id, c.name]));

  const renderCat = (c, depth = 0) => (
    <div key={c.id}>
      <div className="row between" style={{ padding: '7px 0', paddingLeft: depth * 20, borderBottom: '1px solid var(--border)' }}>
        <span>
          {depth > 0 && <span className="faint">└ </span>}
          <strong>{c.name}</strong> <span className="small faint mono">/{c.slug}</span>
        </span>
        <CopyId id={c.id} />
      </div>
      {children(c.id).map((k) => renderCat(k, depth + 1))}
    </div>
  );

  return (
    <div className="stack">
      <div className="grid grid-2">
        <Card title={`Categories (${items.length})`}>
          <ErrorBox error={cats.error} onRetry={cats.reload} />
          {cats.loading && !cats.data && <Spinner />}
          {roots.map((c) => renderCat(c))}
          <form className="stack" style={{ marginTop: 16 }} onSubmit={createCat.run}>
            <strong>New category</strong>
            <div className="form-grid">
              <Field label="Name">
                <input
                  className="input"
                  value={cat.name}
                  onChange={(e) =>
                    setCat((c) => ({ ...c, name: e.target.value, slug: c.slugTouched ? c.slug : e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }))
                  }
                  required
                  maxLength={100}
                />
              </Field>
              <Field label="Slug">
                <input className="input mono" value={cat.slug} onChange={(e) => setCat((c) => ({ ...c, slug: e.target.value, slugTouched: true }))} pattern="[a-z0-9-]{1,100}" required />
              </Field>
            </div>
            <Field label="Parent">
              <select className="select" value={cat.parentId} onChange={(e) => setCat((c) => ({ ...c, parentId: e.target.value }))}>
                <option value="">None (top level)</option>
                {items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <ErrorBox error={createCat.error} />
            <Button type="submit" busy={createCat.busy}>
              Create category
            </Button>
          </form>
        </Card>

        <Card title="Product groups">
          <div className="stack">
            <div className="row wrap gap-sm">
              {groups.loading && <span className="small muted">Loading…</span>}
              {groups.data?.map((g) => (
                <button key={g.id} className={`chip ${viewGroupId === g.id ? 'strong' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setViewGroupId(g.id)}>
                  {g.name}
                </button>
              ))}
            </div>
            <Field label="Open a group by id">
              <input className="input mono" placeholder="group uuid" value={viewGroupId} onChange={(e) => setViewGroupId(e.target.value.trim())} />
            </Field>
            <ErrorBox error={group.error} />
            {group.data && (
              <div className="shipment stack-sm">
                <div className="row between">
                  <strong>{group.data.name}</strong>
                  <span className="small muted">in {catName[group.data.categoryId] ?? 'category'}</span>
                </div>
                {group.data.description && <div className="small muted">{group.data.description}</div>}
                {group.data.variants.length === 0 && <div className="small muted">No active variants yet.</div>}
                {group.data.variants.map((v) => (
                  <div key={v.id} className="row between small">
                    <Link to={`/product/${v.id}`}>
                      {v.brand} {v.name}
                    </Link>
                    <Attrs attributes={v.attributes} />
                  </div>
                ))}
                <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setProposing(true)}>
                  + Add a variant
                </button>
              </div>
            )}
            <div className="hr" />
            <form className="stack" onSubmit={createGroup.run}>
              <strong>New group</strong>
              <Field label="Category">
                <select className="select" value={grp.categoryId} onChange={(e) => setGrp((g) => ({ ...g, categoryId: e.target.value }))} required>
                  <option value="">Choose…</option>
                  {items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Name">
                <input className="input" value={grp.name} onChange={(e) => setGrp((g) => ({ ...g, name: e.target.value }))} required maxLength={200} />
              </Field>
              <Field label="Description">
                <input className="input" value={grp.description} onChange={(e) => setGrp((g) => ({ ...g, description: e.target.value }))} maxLength={2000} />
              </Field>
              <ErrorBox error={createGroup.error} />
              <Button type="submit" busy={createGroup.busy}>
                Create group
              </Button>
            </form>
          </div>
        </Card>
      </div>
      {proposing && (
        <ProposeVariantModal
          onClose={() => setProposing(false)}
          onDone={() => {
            setProposing(false);
            group.reload();
          }}
        />
      )}
    </div>
  );
}

function Moderation() {
  const toast = useToast();
  const [lookup, setLookup] = useState('');
  const [queue, setQueue] = useState(reviewQueue);
  const pending = useAsync(
    () => Promise.all(queue.map((id) => get(`/catalog/variants/${id}`, { auth: false }).catch(() => null))).then((l) => l.filter(Boolean)),
    [queue.join(',')],
  );
  const looked = useAsync(() => (/^[0-9a-f-]{36}$/i.test(lookup) ? get(`/catalog/variants/${lookup}`, { auth: false }) : Promise.resolve(null)), [lookup]);
  const active = useAsync(() => searchVariants(''), []);

  const setStatus = useSubmit(async (v, status) => {
    await patch(`/catalog/variants/${v.id}/status`, { status });
    toast(`${v.name} is now ${status.toLowerCase()}`);
    if (status !== 'PENDING_REVIEW') {
      const next = queue.filter((id) => id !== v.id);
      setReviewQueue(next);
      setQueue(next);
    }
    looked.reload();
    active.reload();
  });

  const Row = ({ v }) => (
    <tr>
      <td>
        <div className="small faint">{v.brand}</div>
        <div className="strong">{v.name}</div>
        <Attrs attributes={v.attributes} />
      </td>
      <td>{v.groupName ?? v.group}</td>
      <td>
        <Badge status={v.status ?? 'ACTIVE'} />
      </td>
      <td>
        <CopyId id={v.id ?? v.variantId} />
      </td>
      <td className="right nowrap">
        {(v.status ?? 'ACTIVE') !== 'ACTIVE' && (
          <Button size="sm" busy={setStatus.busy} onClick={() => setStatus.run({ ...v, id: v.id ?? v.variantId }, 'ACTIVE')}>
            Approve
          </Button>
        )}{' '}
        {(v.status ?? 'ACTIVE') !== 'ARCHIVED' && (
          <Button size="sm" variant="danger" busy={setStatus.busy} onClick={() => setStatus.run({ ...v, id: v.id ?? v.variantId }, 'ARCHIVED')}>
            Archive
          </Button>
        )}
      </td>
    </tr>
  );
  const table = (rows) => (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Variant</th>
            <th>Group</th>
            <th>Status</th>
            <th>Id</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <Row key={v.id ?? v.variantId} v={v} />
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="stack">
      <ErrorBox error={setStatus.error} />
      <Card title="Review queue" actions={<span className="small faint">proposals flagged as possible duplicates</span>} pad={false}>
        {pending.loading && !pending.data && <Spinner />}
        {pending.data?.length === 0 && (
          <Empty icon="✓" title="Nothing waiting for review">
            Proposals flagged as possible duplicates from this browser show up here. To review any other variant, look it up by id below.
          </Empty>
        )}
        {pending.data?.length > 0 && table(pending.data)}
      </Card>
      <Card title="Look up a variant">
        <Field label="Variant id">
          <input className="input mono" value={lookup} onChange={(e) => setLookup(e.target.value.trim())} placeholder="uuid" />
        </Field>
        <ErrorBox error={looked.error} />
        {looked.data && <div style={{ marginTop: 12 }}>{table([looked.data])}</div>}
      </Card>
      <Card title="Active catalog" pad={false}>
        <ErrorBox error={active.error} />
        {active.loading && !active.data && <Spinner />}
        {active.data && table(active.data)}
      </Card>
    </div>
  );
}

function PlatformDelivery() {
  const list = useAsync(() => get('/delivery/providers'), []);
  const [creating, setCreating] = useState(false);
  return (
    <Card title="Platform couriers" actions={<Button size="sm" onClick={() => setCreating(true)}>+ Add courier</Button>} pad={false}>
      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !list.data && <Spinner />}
      {list.data && <ProviderTable items={list.data.items} />}
      {creating && (
        <ProviderModal title="Add platform courier" withType onClose={() => setCreating(false)} onSubmit={(b) => post('/admin/delivery-providers', b)} onDone={list.reload} />
      )}
    </Card>
  );
}
