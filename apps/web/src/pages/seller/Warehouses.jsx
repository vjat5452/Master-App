import { useState } from 'react';
import { Badge, Button, Card, CopyId, Empty, ErrorBox, Field, Modal, Spinner, useSubmit } from '../../components/ui.jsx';
import { get, patch, post } from '../../lib/api.js';
import { PLACES, useAsync, useToast } from '../../lib/store.jsx';

export default function Warehouses({ companyId, canManage }) {
  const { data, error, loading, reload } = useAsync(() => get(`/companies/${companyId}/warehouses`), [companyId]);
  const [editing, setEditing] = useState(null);

  return (
    <Card
      title="Warehouses"
      actions={canManage && <Button size="sm" onClick={() => setEditing('new')}>+ Add warehouse</Button>}
      pad={false}
    >
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data?.items.length === 0 && (
        <Empty icon="🏭" title="No warehouses yet">
          A warehouse serves customers inside its service radius.
        </Empty>
      )}
      {data?.items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Location</th>
                <th className="num">Service radius</th>
                <th>Status</th>
                <th>Id</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((w) => (
                <tr key={w.id}>
                  <td>
                    <div className="strong">{w.name}</div>
                    {w.address && <div className="small muted">{w.address}</div>}
                  </td>
                  <td className="mono small">
                    <a href={`https://www.openstreetmap.org/?mlat=${w.lat}&mlon=${w.lng}#map=14/${w.lat}/${w.lng}`} target="_blank" rel="noreferrer">
                      {w.lat.toFixed(4)}, {w.lng.toFixed(4)}
                    </a>
                  </td>
                  <td className="num">{w.serviceRadiusKm} km</td>
                  <td>
                    <Badge status={w.status} />
                  </td>
                  <td>
                    <CopyId id={w.id} />
                  </td>
                  <td className="right">
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(w)}>
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
      {editing === 'new' && <CreateWarehouse companyId={companyId} onClose={() => setEditing(null)} onDone={reload} />}
      {editing && editing !== 'new' && <EditWarehouse companyId={companyId} warehouse={editing} onClose={() => setEditing(null)} onDone={reload} />}
    </Card>
  );
}

function CreateWarehouse({ companyId, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', address: '', lat: '', lng: '', serviceRadiusKm: '10' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = useSubmit(async (e) => {
    e.preventDefault();
    const w = await post(`/companies/${companyId}/warehouses`, {
      name: f.name,
      ...(f.address.trim() ? { address: f.address.trim() } : {}),
      lat: Number(f.lat),
      lng: Number(f.lng),
      serviceRadiusKm: Number(f.serviceRadiusKm),
    });
    toast(`Warehouse "${w.name}" added`);
    onDone();
    onClose();
  });
  return (
    <Modal
      title="Add warehouse"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="wh-form" busy={submit.busy}>Create</Button>
        </>
      }
    >
      <form id="wh-form" className="stack" onSubmit={submit.run}>
        <Field label="Name">
          <input className="input" value={f.name} onChange={set('name')} required maxLength={200} />
        </Field>
        <Field label="Address">
          <input className="input" value={f.address} onChange={set('address')} maxLength={500} />
        </Field>
        <div className="row wrap gap-sm">
          <span className="small muted">Quick fill:</span>
          {PLACES.map((p) => (
            <button key={p.label} type="button" className="chip" style={{ cursor: 'pointer' }} onClick={() => setF((x) => ({ ...x, lat: String(p.lat), lng: String(p.lng), name: x.name || p.label }))}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <Field label="Latitude">
            <input className="input" type="number" step="any" min={-90} max={90} value={f.lat} onChange={set('lat')} required />
          </Field>
          <Field label="Longitude">
            <input className="input" type="number" step="any" min={-180} max={180} value={f.lng} onChange={set('lng')} required />
          </Field>
          <Field label="Service radius (km)">
            <input className="input" type="number" step="0.5" min={0.5} max={100} value={f.serviceRadiusKm} onChange={set('serviceRadiusKm')} required />
          </Field>
        </div>
        <ErrorBox error={submit.error} />
      </form>
    </Modal>
  );
}

function EditWarehouse({ companyId, warehouse, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ name: warehouse.name, serviceRadiusKm: String(warehouse.serviceRadiusKm), status: warehouse.status });
  const submit = useSubmit(async (e) => {
    e.preventDefault();
    const body = {};
    if (f.name !== warehouse.name) body.name = f.name;
    if (Number(f.serviceRadiusKm) !== warehouse.serviceRadiusKm) body.serviceRadiusKm = Number(f.serviceRadiusKm);
    if (f.status !== warehouse.status) body.status = f.status;
    if (Object.keys(body).length === 0) return onClose();
    await patch(`/companies/${companyId}/warehouses/${warehouse.id}`, body);
    toast('Warehouse updated');
    onDone();
    onClose();
  });
  return (
    <Modal
      title={`Edit ${warehouse.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="wh-edit" busy={submit.busy}>Save</Button>
        </>
      }
    >
      <form id="wh-edit" className="stack" onSubmit={submit.run}>
        <Field label="Name">
          <input className="input" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} required maxLength={200} />
        </Field>
        <Field label="Service radius (km)">
          <input className="input" type="number" step="0.5" min={0.5} max={100} value={f.serviceRadiusKm} onChange={(e) => setF((x) => ({ ...x, serviceRadiusKm: e.target.value }))} required />
        </Field>
        <Field label="Status" hint="Inactive warehouses are hidden from search and checkout.">
          <div className="seg">
            {['ACTIVE', 'INACTIVE'].map((s) => (
              <button key={s} type="button" className={f.status === s ? 'on' : ''} onClick={() => setF((x) => ({ ...x, status: s }))}>
                {s === 'ACTIVE' ? 'Active' : 'Inactive'}
              </button>
            ))}
          </div>
        </Field>
        <ErrorBox error={submit.error} />
      </form>
    </Modal>
  );
}
