import { useState } from 'react';
import { ExternalLink, MapPin, Pencil, Plus, Radar, Warehouse } from 'lucide-react';
import { Badge, Button, CopyId, Empty, ErrorBox, Field, Modal, Panel, Segmented, SkeletonRows, useSubmit } from '@/components/kit';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { get, patch, post } from '@/lib/api';
import { PLACES, useAsync, useToast } from '@/lib/store';

export default function Warehouses({ companyId, canManage }) {
  const { data, error, loading, reload } = useAsync(() => get(`/companies/${companyId}/warehouses`), [companyId]);
  const [editing, setEditing] = useState(null);

  return (
    <Panel
      icon={Warehouse}
      title="Warehouses"
      description="Each warehouse serves customers inside its service radius"
      pad={false}
      actions={
        canManage && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> Add warehouse
          </Button>
        )
      }
    >
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <SkeletonRows />}
      {data?.items.length === 0 && (
        <Empty
          icon={Warehouse}
          title="No warehouses yet"
          action={
            canManage && (
              <Button onClick={() => setEditing('new')}>
                <Plus /> Add your first warehouse
              </Button>
            )
          }
        >
          A warehouse serves customers inside its service radius.
        </Empty>
      )}
      {data?.items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">Service radius</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Id</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((w) => (
              <TableRow key={w.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-xl bg-accent text-accent-foreground">
                      <Warehouse className="size-4" />
                    </span>
                    <div>
                      <div className="font-bold">{w.name}</div>
                      {w.address && <div className="text-xs text-muted-foreground">{w.address}</div>}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${w.lat}&mlon=${w.lng}#map=14/${w.lat}/${w.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                  >
                    <MapPin className="size-3" />
                    {w.lat.toFixed(4)}, {w.lng.toFixed(4)}
                    <ExternalLink className="size-3" />
                  </a>
                </TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
                    <Radar className="size-3 text-primary" /> {w.serviceRadiusKm} km
                  </span>
                </TableCell>
                <TableCell>
                  <Badge status={w.status} dot />
                </TableCell>
                <TableCell>
                  <CopyId id={w.id} />
                </TableCell>
                <TableCell className="text-right">
                  {canManage && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(w)}>
                      <Pencil /> Edit
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {editing === 'new' && <CreateWarehouse companyId={companyId} onClose={() => setEditing(null)} onDone={reload} />}
      {editing && editing !== 'new' && <EditWarehouse companyId={companyId} warehouse={editing} onClose={() => setEditing(null)} onDone={reload} />}
    </Panel>
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
      description="Customers inside the service radius will see this warehouse's stock."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="wh-form" busy={submit.busy}>
            Create warehouse
          </Button>
        </>
      }
    >
      <form id="wh-form" className="grid gap-4" onSubmit={submit.run}>
        <Field label="Name">
          <Input value={f.name} onChange={set('name')} required maxLength={200} />
        </Field>
        <Field label="Address">
          <Input value={f.address} onChange={set('address')} maxLength={500} />
        </Field>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Quick fill:</span>
          {PLACES.map((p) => (
            <button
              key={p.label}
              type="button"
              className="rounded-full border bg-muted/50 px-2.5 py-0.5 text-[11px] font-semibold transition hover:border-primary/40 hover:bg-accent"
              onClick={() => setF((x) => ({ ...x, lat: String(p.lat), lng: String(p.lng), name: x.name || p.label }))}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Latitude">
            <Input type="number" step="any" min={-90} max={90} value={f.lat} onChange={set('lat')} required />
          </Field>
          <Field label="Longitude">
            <Input type="number" step="any" min={-180} max={180} value={f.lng} onChange={set('lng')} required />
          </Field>
          <Field label="Radius (km)">
            <Input type="number" step="0.5" min={0.5} max={100} value={f.serviceRadiusKm} onChange={set('serviceRadiusKm')} required />
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
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="wh-edit" busy={submit.busy}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="wh-edit" className="grid gap-4" onSubmit={submit.run}>
        <Field label="Name">
          <Input value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} required maxLength={200} />
        </Field>
        <Field label="Service radius (km)">
          <Input
            type="number"
            step="0.5"
            min={0.5}
            max={100}
            value={f.serviceRadiusKm}
            onChange={(e) => setF((x) => ({ ...x, serviceRadiusKm: e.target.value }))}
            required
          />
        </Field>
        <Field label="Status" hint="Inactive warehouses are hidden from search and checkout.">
          <Segmented
            value={f.status}
            onChange={(status) => setF((x) => ({ ...x, status }))}
            options={[
              { id: 'ACTIVE', label: 'Active' },
              { id: 'INACTIVE', label: 'Inactive' },
            ]}
            className="w-fit"
          />
        </Field>
        <ErrorBox error={submit.error} />
      </form>
    </Modal>
  );
}
