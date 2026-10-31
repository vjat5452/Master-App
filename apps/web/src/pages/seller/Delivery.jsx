import { useState } from 'react';
import { Bike, Gauge, Plus, Timer, Truck } from 'lucide-react';
import { Badge, Button, Empty, ErrorBox, Field, Modal, Panel, SkeletonRows, useSubmit } from '@/components/kit';
import { Input, NativeSelect } from '@/components/ui/input';
import { get, post } from '@/lib/api';
import { money, title, toMinor } from '@/lib/format';
import { useAsync, useToast } from '@/lib/store';

const TYPE_TINT = {
  SELLER_FLEET: 'from-amber-400 to-orange-600',
  PLATFORM_FLEET: 'from-emerald-500 to-teal-700',
  THIRD_PARTY: 'from-sky-500 to-indigo-600',
};

export function ProviderTable({ items }) {
  return (
    <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((p) => (
        <div key={p.id} className="rounded-2xl border bg-card p-4 shadow-sm transition hover:shadow-lift">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className={`grid size-10 place-items-center rounded-xl bg-gradient-to-br text-white ${TYPE_TINT[p.type] ?? TYPE_TINT.THIRD_PARTY}`}>
                {p.type === 'SELLER_FLEET' ? <Bike className="size-5" /> : <Truck className="size-5" />}
              </span>
              <div>
                <div className="font-bold">{p.name}</div>
                <div className="text-xs text-muted-foreground">{title(p.type)}</div>
              </div>
            </div>
            <Badge status={p.status} dot />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <Metric label="Base fee" value={money(p.baseFeeMinor)} />
            <Metric label="Per km" value={money(p.perKmFeeMinor)} />
            <Metric label="Speed" value={`${p.speedKmph} km/h`} icon={Gauge} />
            <Metric label="Pickup" value={`${p.pickupMinutes} min`} icon={Timer} />
          </div>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-semibold text-muted-foreground">Reliability</span>
              <span className="num font-bold">{Math.round(p.reliability * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400" style={{ width: `${p.reliability * 100}%` }} />
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">Delivers up to {p.maxDistanceMeters / 1000} km</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, icon: Icon }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="size-3" />}
        {label}
      </div>
      <div className="num mt-0.5 text-sm font-bold">{value}</div>
    </div>
  );
}

export default function Delivery({ companyId, canManage }) {
  const own = useAsync(() => get(`/companies/${companyId}/delivery-providers`), [companyId]);
  const platform = useAsync(() => get('/delivery/providers'), []);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <Panel
        icon={Bike}
        title="Your own fleet"
        description="Your riders only carry your shipments and compete with platform couriers at checkout"
        pad={false}
        actions={
          canManage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> Register fleet
            </Button>
          )
        }
      >
        <ErrorBox error={own.error} onRetry={own.reload} />
        {own.loading && !own.data && <SkeletonRows rows={2} />}
        {own.data?.items.length === 0 && (
          <Empty icon={Bike} title="No own fleet yet">
            Register your riders to deliver your own orders. At checkout they compete with the platform couriers on price and speed.
          </Empty>
        )}
        {own.data?.items.length > 0 && <ProviderTable items={own.data.items} />}
      </Panel>
      <Panel icon={Truck} title="Platform couriers" description="Available to every seller" pad={false}>
        <ErrorBox error={platform.error} onRetry={platform.reload} />
        {platform.loading && !platform.data && <SkeletonRows rows={2} />}
        {platform.data && <ProviderTable items={platform.data.items} />}
      </Panel>
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
      description="Fees, speed and reliability feed the checkout allocation engine."
      onClose={onClose}
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="prov-form" busy={submit.busy}>
            Register
          </Button>
        </>
      }
    >
      <form id="prov-form" className="grid gap-4" onSubmit={submit.run}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" className={withType ? '' : 'sm:col-span-2'}>
            <Input value={f.name} onChange={set('name')} required maxLength={200} />
          </Field>
          {withType && (
            <Field label="Type">
              <NativeSelect value={f.type} onChange={set('type')}>
                <option value="PLATFORM_FLEET">Platform fleet</option>
                <option value="THIRD_PARTY">Third party</option>
              </NativeSelect>
            </Field>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Base fee (₹)">
            <Input type="number" min={0} step="0.01" value={f.baseFee} onChange={set('baseFee')} required />
          </Field>
          <Field label="Per km (₹)">
            <Input type="number" min={0} step="0.01" value={f.perKm} onChange={set('perKm')} required />
          </Field>
          <Field label="Speed (km/h)">
            <Input type="number" min={1} max={200} value={f.speedKmph} onChange={set('speedKmph')} required />
          </Field>
          <Field label="Pickup (min)">
            <Input type="number" min={0} max={1440} value={f.pickupMinutes} onChange={set('pickupMinutes')} required />
          </Field>
          <Field label="Reliability (%)">
            <Input type="number" min={0} max={100} value={f.reliability} onChange={set('reliability')} required />
          </Field>
          <Field label="Max distance (km)">
            <Input type="number" min={0.5} max={500} step="0.5" value={f.maxDistanceKm} onChange={set('maxDistanceKm')} required />
          </Field>
        </div>
        <ErrorBox error={submit.error} />
      </form>
    </Modal>
  );
}
