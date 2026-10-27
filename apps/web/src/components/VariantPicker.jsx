import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Plus, Search, X } from 'lucide-react';
import { post } from '@/lib/api';
import { loadKnownGroups, reviewQueue, searchVariants, setReviewQueue } from '@/lib/catalog';
import { attrs } from '@/lib/format';
import { useAsync } from '@/lib/store';
import { Alert, Badge, Button, ErrorBox, Field, Modal, useSubmit } from './kit.jsx';
import { Attrs, ProductArt } from './product.jsx';
import { Input, NativeSelect } from './ui/input.jsx';

/** Search the shared catalog and pick a variant: { variantId, name, brand, attributes }. */
export function VariantPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [proposing, setProposing] = useState(false);
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, loading, error } = useAsync(() => searchVariants(debounced), [debounced]);

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-accent/40 p-3">
        <ProductArt names={[value.group, value.name]} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{value.brand}</div>
          <div className="truncate font-bold">{value.name}</div>
          <div className="truncate text-xs text-muted-foreground">{attrs(value.attributes).join(' · ')}</div>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(null)} aria-label="Change product">
          <X />
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search the catalog…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        {loading && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
      <ErrorBox error={error} />
      <div className="max-h-60 overflow-auto rounded-xl border scrollbar-thin">
        {data?.length === 0 && <div className="p-4 text-center text-sm text-muted-foreground">No match.</div>}
        {data?.map((v) => (
          <button
            key={v.variantId}
            type="button"
            onClick={() => onChange(v)}
            className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left transition last:border-0 hover:bg-accent/50"
          >
            <ProductArt names={[v.group, v.name]} size="sm" className="size-9 rounded-lg [&_svg]:size-4" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                <span className="text-muted-foreground">{v.brand} </span>
                <strong>{v.name}</strong>
              </span>
              <span className="block truncate text-xs text-muted-foreground">{attrs(v.attributes).join(' · ')}</span>
            </span>
            <span className="text-[11px] text-muted-foreground">{v.group}</span>
          </button>
        ))}
      </div>
      <button type="button" className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-primary hover:underline" onClick={() => setProposing(true)}>
        <Plus className="size-3.5" /> Can't find it? Propose a new product variant
      </button>
      {proposing && (
        <ProposeVariantModal
          onClose={() => setProposing(false)}
          onDone={(v) => {
            setProposing(false);
            if (v.status === 'ACTIVE') onChange({ variantId: v.id, name: v.name, brand: v.brand, attributes: v.attributes, group: v.groupName });
          }}
        />
      )}
    </div>
  );
}

/** POST /catalog/variants: the matching rules decide existing / new / needs review. */
export function ProposeVariantModal({ onClose, onDone }) {
  const groups = useAsync(loadKnownGroups, []);
  const [form, setForm] = useState({ groupId: '', brand: '', name: '', barcode: '', attrs: [{ k: 'weight', v: '' }] });
  const [result, setResult] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = useSubmit(async (e) => {
    e.preventDefault();
    const attributes = Object.fromEntries(form.attrs.filter((a) => a.k.trim() && a.v.trim()).map((a) => [a.k.trim(), a.v.trim()]));
    const body = { groupId: form.groupId, name: form.name, attributes };
    if (form.brand.trim()) body.brand = form.brand.trim();
    if (form.barcode.trim()) body.barcode = form.barcode.trim();
    const res = await post('/catalog/variants', body);
    if (res.variant.status === 'PENDING_REVIEW') setReviewQueue([...reviewQueue(), res.variant.id]);
    setResult(res);
  });

  if (result) {
    const v = result.variant;
    const message = !result.created
      ? `Already in the catalog (matched by ${result.match === 'BARCODE' ? 'barcode' : 'normalized attributes'}). Using the existing variant.`
      : v.status === 'PENDING_REVIEW'
        ? 'Created, but it looks similar to existing products, so a platform admin must review it before offers can be listed.'
        : 'Created and active. You can list an offer for it now.';
    return (
      <Modal title="Proposal result" onClose={onClose} footer={<Button onClick={() => onDone(v)}>{v.status === 'ACTIVE' ? 'Use this variant' : 'Done'}</Button>}>
        <Alert tone={v.status === 'ACTIVE' ? 'good' : 'warn'}>{message}</Alert>
        <div className="flex items-center gap-3 rounded-xl border p-3">
          <ProductArt names={[v.groupName, v.name]} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="font-bold">
              {v.brand} {v.name}
            </div>
            <Attrs attributes={v.attributes} className="mt-1" />
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">{v.id}</div>
          </div>
          <Badge status={v.status} />
        </div>
        {result.possibleDuplicates?.length > 0 && (
          <div className="grid gap-2">
            <div className="text-sm font-bold">Possible duplicates</div>
            {result.possibleDuplicates.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <span>
                  {d.brand} {d.name}
                </span>
                <Badge kind="warn">similarity {d.score}</Badge>
              </div>
            ))}
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title="Propose a product variant"
      description="Matching rules decide whether this is an existing product, a new one, or needs review."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="propose-form" busy={submit.busy}>
            <CheckCircle2 /> Submit proposal
          </Button>
        </>
      }
    >
      <form id="propose-form" className="grid gap-4" onSubmit={submit.run}>
        <Field label="Product group" hint={groups.loading ? 'Loading groups…' : 'Groups seen in the catalog or created in this browser'}>
          <NativeSelect value={form.groupId} onChange={set('groupId')} required>
            <option value="">Choose…</option>
            {groups.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Brand">
            <Input value={form.brand} onChange={set('brand')} maxLength={100} />
          </Field>
          <Field label="Name">
            <Input value={form.name} onChange={set('name')} required maxLength={200} />
          </Field>
        </div>
        <Field label="Barcode (GTIN)" hint="8–14 digits, optional. An exact barcode match reuses the existing variant.">
          <Input value={form.barcode} onChange={set('barcode')} pattern="\d{8,14}" inputMode="numeric" />
        </Field>
        <div className="grid gap-2">
          <span className="text-[13px] font-semibold">Attributes</span>
          {form.attrs.map((a, i) => (
            <div key={i} className="flex gap-2">
              <Input
                placeholder="key (e.g. weight)"
                value={a.k}
                onChange={(e) => setForm((f) => ({ ...f, attrs: f.attrs.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)) }))}
              />
              <Input
                placeholder="value (e.g. 400 g)"
                value={a.v}
                onChange={(e) => setForm((f) => ({ ...f, attrs: f.attrs.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)) }))}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove attribute"
                onClick={() => setForm((f) => ({ ...f, attrs: f.attrs.filter((_, j) => j !== i) }))}
              >
                <X />
              </Button>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-primary hover:underline"
            onClick={() => setForm((f) => ({ ...f, attrs: [...f.attrs, { k: '', v: '' }] }))}
          >
            <Plus className="size-3.5" /> Add attribute
          </button>
        </div>
        <ErrorBox error={groups.error || submit.error} />
      </form>
    </Modal>
  );
}
