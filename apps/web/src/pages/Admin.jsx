import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Archive, Check, FolderTree, Globe, Layers, Plus, ScanSearch, SearchCheck, ShieldCheck, Truck } from 'lucide-react';
import { Attrs, ProductArt } from '@/components/product';
import { ProposeVariantModal } from '@/components/VariantPicker';
import { Badge, Button, CopyId, Empty, ErrorBox, Field, PageHeader, Panel, SkeletonRows, Tabs, useSubmit } from '@/components/kit';
import { Input, NativeSelect } from '@/components/ui/input';
import { Separator } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { get, patch, post } from '@/lib/api';
import { loadKnownGroups, rememberGroup, searchVariants } from '@/lib/catalog';
import { useAsync, useToast } from '@/lib/store';
import { cn } from '@/lib/utils';
import MappingReview from './admin/MappingReview.jsx';
import Sources from './admin/Sources.jsx';
import { ProviderModal, ProviderTable } from './seller/Delivery.jsx';

const TABS = [
  { id: 'catalog', label: 'Catalog structure', icon: FolderTree },
  { id: 'moderation', label: 'Variant moderation', icon: ScanSearch },
  { id: 'sources', label: 'External sources', icon: Globe },
  { id: 'matching', label: 'Match review', icon: SearchCheck },
  { id: 'delivery', label: 'Platform couriers', icon: Truck },
];

export default function Admin() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'catalog';
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" /> Platform admin
          </span>
        }
        title="Admin console"
        description="Shape the shared catalog every seller lists against, review proposed products and run platform delivery."
      />
      <Tabs tabs={TABS} value={tab} onChange={(t) => setParams({ tab: t })} className="mb-8" />
      {tab === 'catalog' && <CatalogAdmin />}
      {tab === 'moderation' && <Moderation />}
      {tab === 'sources' && <Sources />}
      {tab === 'matching' && <MappingReview />}
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
      <div className="flex items-center justify-between gap-2 border-b py-2.5" style={{ paddingLeft: depth * 22 }}>
        <span className="flex items-center gap-2">
          <span className={cn('size-2 rounded-full', depth === 0 ? 'bg-primary' : 'bg-gold')} />
          <strong className="text-sm">{c.name}</strong>
          <span className="font-mono text-[11px] text-muted-foreground">/{c.slug}</span>
        </span>
        <CopyId id={c.id} />
      </div>
      {children(c.id).map((k) => renderCat(k, depth + 1))}
    </div>
  );

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <Panel icon={FolderTree} title="Categories" description={`${items.length} in the taxonomy`}>
        <ErrorBox error={cats.error} onRetry={cats.reload} />
        {cats.loading && !cats.data && <SkeletonRows rows={3} />}
        <div>{roots.map((c) => renderCat(c))}</div>
        <form className="mt-6 grid gap-4 rounded-2xl border bg-muted/30 p-4" onSubmit={createCat.run}>
          <div className="text-sm font-bold">New category</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input
                value={cat.name}
                onChange={(e) =>
                  setCat((c) => ({ ...c, name: e.target.value, slug: c.slugTouched ? c.slug : e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }))
                }
                required
                maxLength={100}
              />
            </Field>
            <Field label="Slug">
              <Input className="font-mono" value={cat.slug} onChange={(e) => setCat((c) => ({ ...c, slug: e.target.value, slugTouched: true }))} pattern="[a-z0-9-]{1,100}" required />
            </Field>
          </div>
          <Field label="Parent">
            <NativeSelect value={cat.parentId} onChange={(e) => setCat((c) => ({ ...c, parentId: e.target.value }))}>
              <option value="">None (top level)</option>
              {items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <ErrorBox error={createCat.error} />
          <Button type="submit" busy={createCat.busy} className="w-fit">
            <Plus /> Create category
          </Button>
        </form>
      </Panel>

      <Panel icon={Layers} title="Product groups" description="Families of related variants">
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {groups.loading && <span className="text-sm text-muted-foreground">Loading…</span>}
            {groups.data?.map((g) => (
              <button
                key={g.id}
                onClick={() => setViewGroupId(g.id)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-semibold transition hover:border-primary/40',
                  viewGroupId === g.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card',
                )}
              >
                {g.name}
              </button>
            ))}
          </div>
          <Field label="Open a group by id">
            <Input className="font-mono" placeholder="group uuid" value={viewGroupId} onChange={(e) => setViewGroupId(e.target.value.trim())} />
          </Field>
          <ErrorBox error={group.error} />
          {group.data && (
            <div className="grid gap-3 rounded-2xl border p-4">
              <div className="flex items-center justify-between gap-2">
                <strong>{group.data.name}</strong>
                <Badge kind="muted">in {catName[group.data.categoryId] ?? 'category'}</Badge>
              </div>
              {group.data.description && <div className="text-sm text-muted-foreground">{group.data.description}</div>}
              {group.data.variants.length === 0 && <div className="text-sm text-muted-foreground">No active variants yet.</div>}
              {group.data.variants.map((v) => (
                <Link key={v.id} to={`/product/${v.id}`} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-muted/50">
                  <ProductArt names={[v.groupName, v.name]} src={v.imageUrl} size="sm" className="size-9 rounded-lg [&_svg]:size-4" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {v.brand} {v.name}
                  </span>
                  <Attrs attributes={v.attributes} />
                </Link>
              ))}
              <Button variant="secondary" size="sm" className="w-fit" onClick={() => setProposing(true)}>
                <Plus /> Add a variant
              </Button>
            </div>
          )}
          <Separator />
          <form className="grid gap-4" onSubmit={createGroup.run}>
            <div className="text-sm font-bold">New group</div>
            <Field label="Category">
              <NativeSelect value={grp.categoryId} onChange={(e) => setGrp((g) => ({ ...g, categoryId: e.target.value }))} required>
                <option value="">Choose…</option>
                {items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Name">
              <Input value={grp.name} onChange={(e) => setGrp((g) => ({ ...g, name: e.target.value }))} required maxLength={200} />
            </Field>
            <Field label="Description">
              <Input value={grp.description} onChange={(e) => setGrp((g) => ({ ...g, description: e.target.value }))} maxLength={2000} />
            </Field>
            <ErrorBox error={createGroup.error} />
            <Button type="submit" busy={createGroup.busy} className="w-fit">
              <Plus /> Create group
            </Button>
          </form>
        </div>
      </Panel>
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
  const pending = useAsync(
    () => get('/admin/catalog/variants/review-queue?limit=50').then((r) => r.items.map((v) => ({ ...v, status: 'PENDING_REVIEW' }))),
    [],
  );
  const looked = useAsync(() => (/^[0-9a-f-]{36}$/i.test(lookup) ? get(`/catalog/variants/${lookup}`, { auth: false }) : Promise.resolve(null)), [lookup]);
  const active = useAsync(() => searchVariants(''), []);

  const setStatus = useSubmit(async (v, status) => {
    await patch(`/catalog/variants/${v.id}/status`, { status });
    toast(`${v.name} is now ${status.toLowerCase()}`);
    pending.reload();
    looked.reload();
    active.reload();
  });

  const table = (rows) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Variant</TableHead>
          <TableHead>Group</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Id</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((v) => {
          const id = v.id ?? v.variantId;
          const status = v.status ?? 'ACTIVE';
          return (
            <TableRow key={id}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <ProductArt names={[v.groupName ?? v.group, v.name]} src={v.imageUrl} size="sm" className="size-10 rounded-xl [&_svg]:size-5" />
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{v.brand}</div>
                    <div className="font-bold">{v.name}</div>
                    <Attrs attributes={v.attributes} className="mt-1" />
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">{v.groupName ?? v.group}</TableCell>
              <TableCell>
                <Badge status={status} dot />
              </TableCell>
              <TableCell>
                <CopyId id={id} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-right">
                {status !== 'ACTIVE' && (
                  <Button size="sm" busy={setStatus.busy} onClick={() => setStatus.run({ ...v, id }, 'ACTIVE')}>
                    <Check /> Approve
                  </Button>
                )}{' '}
                {status !== 'ARCHIVED' && (
                  <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" busy={setStatus.busy} onClick={() => setStatus.run({ ...v, id }, 'ARCHIVED')}>
                    <Archive /> Archive
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-6">
      <ErrorBox error={setStatus.error} />
      <Panel icon={ScanSearch} title="Review queue" description="Proposals flagged as possible duplicates" pad={false}>
        {pending.loading && !pending.data && <SkeletonRows rows={2} />}
        {pending.data?.length === 0 && (
          <Empty icon={Check} title="Nothing waiting for review">
            Seller proposals flagged as possible duplicates show up here. To review any other variant, look it up by id below.
          </Empty>
        )}
        {pending.data?.length > 0 && table(pending.data)}
      </Panel>
      <Panel icon={ScanSearch} title="Look up a variant">
        <Field label="Variant id">
          <Input className="font-mono" value={lookup} onChange={(e) => setLookup(e.target.value.trim())} placeholder="uuid" />
        </Field>
        <ErrorBox error={looked.error} />
        {looked.data && <div className="mt-4 overflow-hidden rounded-xl border">{table([looked.data])}</div>}
      </Panel>
      <Panel icon={Layers} title="Active catalog" description={active.data ? `${active.data.length} variants` : undefined} pad={false}>
        <ErrorBox error={active.error} />
        {active.loading && !active.data && <SkeletonRows />}
        {active.data && table(active.data)}
      </Panel>
    </div>
  );
}

function PlatformDelivery() {
  const list = useAsync(() => get('/delivery/providers'), []);
  const [creating, setCreating] = useState(false);
  return (
    <Panel
      icon={Truck}
      title="Platform couriers"
      description="Available to every seller at checkout"
      pad={false}
      actions={
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> Add courier
        </Button>
      }
    >
      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !list.data && <SkeletonRows rows={2} />}
      {list.data && <ProviderTable items={list.data.items} />}
      {creating && (
        <ProviderModal title="Add platform courier" withType onClose={() => setCreating(false)} onSubmit={(b) => post('/admin/delivery-providers', b)} onDone={list.reload} />
      )}
    </Panel>
  );
}
