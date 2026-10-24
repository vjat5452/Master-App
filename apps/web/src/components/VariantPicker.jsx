import { useEffect, useState } from 'react';
import { post } from '../lib/api.js';
import { loadKnownGroups, reviewQueue, searchVariants, setReviewQueue } from '../lib/catalog.js';
import { attrs } from '../lib/format.js';
import { useAsync } from '../lib/store.jsx';
import { Attrs } from './product.jsx';
import { Badge, Button, ErrorBox, Field, Modal, useSubmit } from './ui.jsx';

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
      <div className="shipment row between">
        <div>
          <div className="small faint">{value.brand}</div>
          <strong>{value.name}</strong> <span className="small muted">{attrs(value.attributes).join(' · ')}</span>
        </div>
        <button className="link" type="button" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="stack-sm">
      <input className="input" placeholder="Search the catalog…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ErrorBox error={error} />
      <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        {loading && !data && <div className="small muted" style={{ padding: 10 }}>Searching…</div>}
        {data?.length === 0 && <div className="small muted" style={{ padding: 10 }}>No match.</div>}
        {data?.map((v) => (
          <button key={v.variantId} type="button" className="endpoint" onClick={() => onChange(v)}>
            <span className="grow">
              <span className="small faint">{v.brand} </span>
              <strong>{v.name}</strong> <span className="small muted">{attrs(v.attributes).join(' · ')}</span>
            </span>
            <span className="small faint">{v.group}</span>
          </button>
        ))}
      </div>
      <button className="link small" type="button" onClick={() => setProposing(true)} style={{ alignSelf: 'flex-start' }}>
        Can't find it? Propose a new product variant →
      </button>
      {proposing && (
        <ProposeVariantModal
          onClose={() => setProposing(false)}
          onDone={(v) => {
            setProposing(false);
            if (v.status === 'ACTIVE') onChange({ variantId: v.id, name: v.name, brand: v.brand, attributes: v.attributes });
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
      <Modal title="Variant proposal result" onClose={onClose} footer={<Button onClick={() => onDone(v)}>{v.status === 'ACTIVE' ? 'Use this variant' : 'Done'}</Button>}>
        <div className={`alert ${v.status === 'ACTIVE' ? 'alert-good' : 'alert-warn'}`}>{message}</div>
        <div className="shipment stack-sm">
          <div className="row between">
            <strong>
              {v.brand} {v.name}
            </strong>
            <Badge status={v.status} />
          </div>
          <Attrs attributes={v.attributes} />
          <div className="small muted mono">{v.id}</div>
        </div>
        {result.possibleDuplicates?.length > 0 && (
          <div className="stack-sm">
            <strong className="small">Possible duplicates</strong>
            {result.possibleDuplicates.map((d) => (
              <div key={d.id} className="row between small">
                <span>
                  {d.brand} {d.name}
                </span>
                <span className="faint">similarity {d.score}</span>
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
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="propose-form" busy={submit.busy}>
            Submit proposal
          </Button>
        </>
      }
    >
      <form id="propose-form" className="stack" onSubmit={submit.run}>
        <Field label="Product group" hint={groups.loading ? 'Loading groups…' : 'Groups seen in the catalog or created in this browser'}>
          <select className="select" value={form.groupId} onChange={set('groupId')} required>
            <option value="">Choose…</option>
            {groups.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Brand">
            <input className="input" value={form.brand} onChange={set('brand')} maxLength={100} />
          </Field>
          <Field label="Name">
            <input className="input" value={form.name} onChange={set('name')} required maxLength={200} />
          </Field>
        </div>
        <Field label="Barcode (GTIN)" hint="8–14 digits, optional. An exact barcode match reuses the existing variant.">
          <input className="input" value={form.barcode} onChange={set('barcode')} pattern="\d{8,14}" inputMode="numeric" />
        </Field>
        <div className="stack-sm">
          <span className="field-label">Attributes</span>
          {form.attrs.map((a, i) => (
            <div key={i} className="row">
              <input
                className="input"
                placeholder="key (e.g. weight)"
                value={a.k}
                onChange={(e) => setForm((f) => ({ ...f, attrs: f.attrs.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)) }))}
              />
              <input
                className="input"
                placeholder="value (e.g. 400 g)"
                value={a.v}
                onChange={(e) => setForm((f) => ({ ...f, attrs: f.attrs.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)) }))}
              />
              <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setForm((f) => ({ ...f, attrs: f.attrs.filter((_, j) => j !== i) }))}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setForm((f) => ({ ...f, attrs: [...f.attrs, { k: '', v: '' }] }))}>
            + Add attribute
          </button>
        </div>
        <ErrorBox error={groups.error || submit.error} />
      </form>
    </Modal>
  );
}
