import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Field, Modal, Spinner, useSubmit } from '../../components/ui.jsx';
import { get, post } from '../../lib/api.js';
import { money, title, toMinor } from '../../lib/format.js';
import { useAsync, useToast } from '../../lib/store.jsx';

export function ProviderTable({ items }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th className="num">Base fee</th>
            <th className="num">Per km</th>
            <th className="num">Speed</th>
            <th className="num">Pickup</th>
            <th className="num">Reliability</th>
            <th className="num">Max distance</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id}>
              <td className="strong">{p.name}</td>
              <td>{title(p.type)}</td>
              <td className="num">{money(p.baseFeeMinor)}</td>
              <td className="num">{money(p.perKmFeeMinor)}</td>
              <td className="num">{p.speedKmph} km/h</td>
              <td className="num">{p.pickupMinutes} min</td>
              <td className="num">{Math.round(p.reliability * 100)}%</td>
              <td className="num">{p.maxDistanceMeters / 1000} km</td>
              <td>
                <Badge status={p.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Delivery({ companyId, canManage }) {
  const own = useAsync(() => get(`/companies/${companyId}/delivery-providers`), [companyId]);
  const platform = useAsync(() => get('/delivery/providers'), []);
  const [creating, setCreating] = useState(false);

  return (
    <div className="stack">
      <Card title="Your own fleet" actions={canManage && <Button size="sm" onClick={() => setCreating(true)}>+ Register fleet</Button>} pad={false}>
        <ErrorBox error={own.error} onRetry={own.reload} />
        {own.loading && !own.data && <Spinner />}
        {own.data?.items.length === 0 && (
          <Empty icon="🛵" title="No own fleet">
            Your riders only carry your shipments. At checkout they compete with the platform couriers.
          </Empty>
        )}
        {own.data?.items.length > 0 && <ProviderTable items={own.data.items} />}
      </Card>
      <Card title="Platform couriers" actions={<span className="small faint">available to every seller</span>} pad={false}>
        <ErrorBox error={platform.error} onRetry={platform.reload} />
        {platform.loading && !platform.data && <Spinner />}
        {platform.data && <ProviderTable items={platform.data.items} />}
      </Card>
      {creating && (
        <ProviderModal
          title="Register your delivery fleet"
          onClose={() => setCreating(false)}
          onSubmit={(body) => post(`/companies/${companyId}/delivery-providers`, body)}
          onDone={own.reload}
        />
      )}
    </div>
  );
}

export function ProviderModal({ title: heading, onClose, onSubmit, onDone, withType }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', type: 'THIRD_PARTY', baseFee: '25', perKm: '6', speedKmph: '25', pickupMinutes: '10', reliability: '90', maxDistanceKm: '15' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = useSubmit(async (e) => {
    e.preventDefault();
    const p = await onSubmit({
      name: f.name,
      ...(withType ? { type: f.type } : {}),
      baseFeeMinor: toMinor(f.baseFee),
      perKmFeeMinor: toMinor(f.perKm),
      speedKmph: Number(f.speedKmph),
      pickupMinutes: Number(f.pickupMinutes),
      reliability: Number(f.reliability) / 100,
      maxDistanceKm: Number(f.maxDistanceKm),
    });
    toast(`${p.name} registered`);
    onDone();
    onClose();
  });
  return (
    <Modal
      title={heading}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="prov-form" busy={submit.busy}>Register</Button>
        </>
      }
    >
      <form id="prov-form" className="stack" onSubmit={submit.run}>
        <div className="form-grid">
          <Field label="Name">
            <input className="input" value={f.name} onChange={set('name')} required maxLength={200} />
          </Field>
          {withType && (
            <Field label="Type">
              <select className="select" value={f.type} onChange={set('type')}>
                <option value="PLATFORM_FLEET">Platform fleet</option>
                <option value="THIRD_PARTY">Third party</option>
              </select>
            </Field>
          )}
        </div>
        <div className="form-grid">
          <Field label="Base fee (₹)">
            <input className="input" type="number" min={0} step="0.01" value={f.baseFee} onChange={set('baseFee')} required />
          </Field>
          <Field label="Per km (₹)">
            <input className="input" type="number" min={0} step="0.01" value={f.perKm} onChange={set('perKm')} required />
          </Field>
          <Field label="Speed (km/h)">
            <input className="input" type="number" min={1} max={200} value={f.speedKmph} onChange={set('speedKmph')} required />
          </Field>
          <Field label="Pickup time (min)">
            <input className="input" type="number" min={0} max={1440} value={f.pickupMinutes} onChange={set('pickupMinutes')} required />
          </Field>
          <Field label="Reliability (%)">
            <input className="input" type="number" min={0} max={100} value={f.reliability} onChange={set('reliability')} required />
          </Field>
          <Field label="Max distance (km)">
            <input className="input" type="number" min={0.5} max={500} step="0.5" value={f.maxDistanceKm} onChange={set('maxDistanceKm')} required />
          </Field>
        </div>
        <ErrorBox error={submit.error} />
      </form>
    </Modal>
  );
}
