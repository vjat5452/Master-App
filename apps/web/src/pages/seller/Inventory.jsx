import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Field, Modal, Spinner, useSubmit } from '../../components/ui.jsx';
import { get, post, qs } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';
import { useAsync, useToast } from '../../lib/store.jsx';

const REASONS = [
  ['RESTOCK', 'Restock'],
  ['CORRECTION', 'Stock count correction'],
  ['DAMAGE', 'Damaged / expired'],
  ['RETURN', 'Customer return'],
];

export default function Inventory({ companyId }) {
  const [warehouseId, setWarehouseId] = useState('');
  const refs = useAsync(async () => {
    const [w, o] = await Promise.all([get(`/companies/${companyId}/warehouses`), get(`/companies/${companyId}/offers`)]);
    return { warehouses: w.items, offers: o.items };
  }, [companyId]);
  const inv = useAsync(() => get(`/companies/${companyId}/inventory${qs({ warehouseId })}`), [companyId, warehouseId]);
  const [adjusting, setAdjusting] = useState(null);

  const rows = inv.data?.items ?? [];
  return (
    <Card
      title="Stock by warehouse"
      actions={
        <>
          <select className="select" style={{ width: 'auto' }} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">All warehouses</option>
            {refs.data?.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={() => setAdjusting({})} disabled={!refs.data?.warehouses.length || !refs.data?.offers.length}>
            + Adjust stock
          </Button>
        </>
      }
      pad={false}
    >
      <ErrorBox error={inv.error || refs.error} onRetry={inv.reload} />
      {inv.loading && !inv.data && <Spinner />}
      {inv.data && rows.length === 0 && (
        <Empty icon="📦" title="No stock recorded">
          {refs.data?.offers.length ? 'Use “Adjust stock” to restock an offer in a warehouse.' : 'Create an offer first, then stock it here.'}
        </Empty>
      )}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Warehouse</th>
                <th className="num">On hand</th>
                <th className="num">Reserved</th>
                <th className="num">Available</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="strong">{r.variantName}</div>
                    <div className="small faint mono">{r.sellerSku}</div>
                  </td>
                  <td>{r.warehouseName}</td>
                  <td className="num">{r.onHand}</td>
                  <td className="num">{r.reserved}</td>
                  <td className="num">
                    <Badge kind={r.available === 0 ? 'bad' : r.available <= 5 ? 'warn' : 'good'}>{r.available}</Badge>
                  </td>
                  <td className="small muted nowrap">
                    {dateTime(r.updatedAt)} · v{r.version}
                  </td>
                  <td className="right nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setAdjusting({ warehouseId: r.warehouseId, offerId: r.offerId, delta: 10, reason: 'RESTOCK', row: r })}>
                      + Restock
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAdjusting({ warehouseId: r.warehouseId, offerId: r.offerId, delta: -1, reason: 'CORRECTION', row: r })}>
                      − Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adjusting && refs.data && (
        <AdjustModal companyId={companyId} initial={adjusting} refs={refs.data} onClose={() => setAdjusting(null)} onDone={inv.reload} />
      )}
    </Card>
  );
}

function AdjustModal({ companyId, initial, refs, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({
    warehouseId: initial.warehouseId ?? refs.warehouses[0]?.id ?? '',
    offerId: initial.offerId ?? refs.offers[0]?.id ?? '',
    delta: String(initial.delta ?? 10),
    reason: initial.reason ?? 'RESTOCK',
    note: '',
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = useSubmit(async (e) => {
    e.preventDefault();
    const r = await post(`/companies/${companyId}/inventory/adjustments`, {
      warehouseId: f.warehouseId,
      offerId: f.offerId,
      delta: Number(f.delta),
      reason: f.reason,
      ...(f.note.trim() ? { note: f.note.trim() } : {}),
    });
    toast(`${r.variantName ?? 'Stock'} at ${r.warehouseName ?? 'warehouse'}: ${r.onHand} on hand, ${r.available} available`);
    onDone();
    onClose();
  });
  const delta = Number(f.delta);
  return (
    <Modal
      title="Adjust stock"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="adj-form" busy={submit.busy} disabled={!delta}>
            {delta > 0 ? `Add ${delta}` : delta < 0 ? `Remove ${-delta}` : 'Apply'}
          </Button>
        </>
      }
    >
      <form id="adj-form" className="stack" onSubmit={submit.run}>
        <div className="form-grid">
          <Field label="Warehouse">
            <select className="select" value={f.warehouseId} onChange={set('warehouseId')} required>
              {refs.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Offer">
            <select className="select" value={f.offerId} onChange={set('offerId')} required>
              {refs.offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.variantName} ({o.sellerSku})
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Change in units" hint="Positive adds stock, negative removes it">
            <input className="input" type="number" step={1} value={f.delta} onChange={set('delta')} required />
          </Field>
          <Field label="Reason">
            <select className="select" value={f.reason} onChange={set('reason')}>
              {REASONS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Note" hint="Saved in the audit log and the movement ledger">
          <input className="input" value={f.note} onChange={set('note')} maxLength={500} />
        </Field>
        {initial.row && (
          <div className="small muted">
            Currently {initial.row.onHand} on hand, {initial.row.reserved} reserved. Stock can't go below what is reserved for open orders.
          </div>
        )}
        <ErrorBox error={submit.error} />
      </form>
    </Modal>
  );
}
