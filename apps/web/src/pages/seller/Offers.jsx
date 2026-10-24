import { useState } from 'react';
import { Link } from 'react-router-dom';
import { VariantPicker } from '../../components/VariantPicker.jsx';
import { Badge, Button, Card, CopyId, Empty, ErrorBox, Field, Modal, Spinner, useSubmit } from '../../components/ui.jsx';
import { get, patch, post } from '../../lib/api.js';
import { money, toMinor } from '../../lib/format.js';
import { useAsync, useToast } from '../../lib/store.jsx';

export default function Offers({ companyId, canManage }) {
  const { data, error, loading, reload } = useAsync(() => get(`/companies/${companyId}/offers`), [companyId]);
  const [editing, setEditing] = useState(null);

  return (
    <Card title="Offers" actions={canManage && <Button size="sm" onClick={() => setEditing('new')}>+ List a product</Button>} pad={false}>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data?.items.length === 0 && (
        <Empty icon="🏷️" title="No offers yet">
          An offer is your price for a shared catalog product. Stock it in a warehouse to start selling.
        </Empty>
      )}
      {data?.items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Your SKU</th>
                <th className="num">Price</th>
                <th>Status</th>
                <th>Id</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.id}>
                  <td>
                    <div className="small faint">{o.brand}</div>
                    <Link to={`/product/${o.variantId}`} className="strong">
                      {o.variantName}
                    </Link>
                  </td>
                  <td className="mono small">{o.sellerSku}</td>
                  <td className="num price">{money(o.priceMinor)}</td>
                  <td>
                    <Badge status={o.status} />
                  </td>
                  <td>
                    <CopyId id={o.id} />
                  </td>
                  <td className="right">
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(o)}>
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing === 'new' && <CreateOffer companyId={companyId} onClose={() => setEditing(null)} onDone={reload} />}
      {editing && editing !== 'new' && <EditOffer companyId={companyId} offer={editing} onClose={() => setEditing(null)} onDone={reload} />}
    </Card>
  );
}

function CreateOffer({ companyId, onClose, onDone }) {
  const toast = useToast();
  const [variant, setVariant] = useState(null);
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const submit = useSubmit(async (e) => {
    e.preventDefault();
    const o = await post(`/companies/${companyId}/offers`, { variantId: variant.variantId, sellerSku: sku, priceMinor: toMinor(price) });
    toast(`Listed ${o.variantName} at ${money(o.priceMinor)}`);
    onDone();
    onClose();
  });
  return (
    <Modal
      title="List a product"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="offer-form" busy={submit.busy} disabled={!variant}>Create offer</Button>
        </>
      }
    >
      <form id="offer-form" className="stack" onSubmit={submit.run}>
        <Field label="Catalog product">
          <VariantPicker value={variant} onChange={setVariant} />
        </Field>
        <div className="form-grid">
          <Field label="Your SKU">
            <input className="input" value={sku} onChange={(e) => setSku(e.target.value)} required maxLength={100} />
          </Field>
          <Field label="Price (₹)">
            <input className="input" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </Field>
        </div>
        <ErrorBox error={submit.error} />
      </form>
    </Modal>
  );
}

function EditOffer({ companyId, offer, onClose, onDone }) {
  const toast = useToast();
  const [price, setPrice] = useState(String(offer.priceMinor / 100));
  const [status, setStatus] = useState(offer.status);
  const submit = useSubmit(async (e) => {
    e.preventDefault();
    const body = {};
    if (toMinor(price) !== offer.priceMinor) body.priceMinor = toMinor(price);
    if (status !== offer.status) body.status = status;
    if (!Object.keys(body).length) return onClose();
    await patch(`/companies/${companyId}/offers/${offer.id}`, body);
    toast('Offer updated. Search results refresh shortly.');
    onDone();
    onClose();
  });
  return (
    <Modal
      title={`Edit offer: ${offer.variantName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="offer-edit" busy={submit.busy}>Save</Button>
        </>
      }
    >
      <form id="offer-edit" className="stack" onSubmit={submit.run}>
        <Field label="Price (₹)">
          <input className="input" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
        </Field>
        <Field label="Status" hint="Paused offers are hidden from customers. Archived offers are retired.">
          <div className="seg">
            {['ACTIVE', 'PAUSED', 'ARCHIVED'].map((s) => (
              <button key={s} type="button" className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
                {s[0] + s.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </Field>
        <ErrorBox error={submit.error} />
      </form>
    </Modal>
  );
}
