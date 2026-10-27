import { useState } from 'react';
import { Boxes, Minus, Plus, SlidersHorizontal } from 'lucide-react';
import { Badge, Button, Empty, ErrorBox, Field, Modal, Panel, SkeletonRows, useSubmit } from '@/components/kit';
import { Input, NativeSelect } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { get, post, qs } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAsync, useToast } from '@/lib/store';
import { cn } from '@/lib/utils';

const REASONS = [
  ['RESTOCK', 'Restock'],
  ['CORRECTION', 'Stock count correction'],
  ['DAMAGE', 'Damaged / expired'],
  ['RETURN', 'Customer return'],
];
const ALL = 'all';

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
    <Panel
      icon={Boxes}
      title="Stock by warehouse"
      description="On hand, reserved for open orders, and available to sell"
      pad={false}
      actions={
        <>
          <Select value={warehouseId || ALL} onValueChange={(v) => setWarehouseId(v === ALL ? '' : v)}>
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All warehouses</SelectItem>
              {refs.data?.warehouses.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setAdjusting({})} disabled={!refs.data?.warehouses.length || !refs.data?.offers.length}>
            <SlidersHorizontal /> Adjust stock
          </Button>
        </>
      }
    >
      <ErrorBox error={inv.error || refs.error} onRetry={inv.reload} />
      {inv.loading && !inv.data && <SkeletonRows />}
      {inv.data && rows.length === 0 && (
        <Empty icon={Boxes} title="No stock recorded">
          {refs.data?.offers.length ? 'Use “Adjust stock” to restock an offer in a warehouse.' : 'Create an offer first, then stock it here.'}
        </Empty>
      )}
      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Reserved</TableHead>
              <TableHead className="w-48">Available</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const pct = r.onHand ? (r.available / r.onHand) * 100 : 0;
              const level = r.available === 0 ? 'bad' : r.available <= 5 ? 'warn' : 'good';
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-bold">{r.variantName}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{r.sellerSku}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.warehouseName}</TableCell>
                  <TableCell className="num text-right font-semibold">{r.onHand}</TableCell>
                  <TableCell className="num text-right text-muted-foreground">{r.reserved}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full', level === 'good' ? 'bg-success' : level === 'warn' ? 'bg-warning' : 'bg-destructive')}
                          style={{ width: `${Math.max(pct, r.available ? 4 : 0)}%` }}
                        />
                      </div>
                      <Badge kind={level}>{r.available}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {dateTime(r.updatedAt)} · v{r.version}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAdjusting({ warehouseId: r.warehouseId, offerId: r.offerId, delta: 10, reason: 'RESTOCK', row: r })}
                    >
                      <Plus /> Restock
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAdjusting({ warehouseId: r.warehouseId, offerId: r.offerId, delta: -1, reason: 'CORRECTION', row: r })}
                    >
                      <Minus /> Remove
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {adjusting && refs.data && <AdjustModal companyId={companyId} initial={adjusting} refs={refs.data} onClose={() => setAdjusting(null)} onDone={inv.reload} />}
    </Panel>
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
      description="Every adjustment is recorded in the audit log and the movement ledger."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="adj-form" busy={submit.busy} disabled={!delta} variant={delta < 0 ? 'danger' : 'primary'}>
            {delta > 0 ? `Add ${delta} units` : delta < 0 ? `Remove ${-delta} units` : 'Apply'}
          </Button>
        </>
      }
    >
      <form id="adj-form" className="grid gap-4" onSubmit={submit.run}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Warehouse">
            <NativeSelect value={f.warehouseId} onChange={set('warehouseId')} required>
              {refs.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Offer">
            <NativeSelect value={f.offerId} onChange={set('offerId')} required>
              {refs.offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.variantName} ({o.sellerSku})
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Change in units" hint="Positive adds stock, negative removes it">
            <Input type="number" step={1} value={f.delta} onChange={set('delta')} required />
          </Field>
          <Field label="Reason">
            <NativeSelect value={f.reason} onChange={set('reason')}>
              {REASONS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field label="Note">
          <Input value={f.note} onChange={set('note')} maxLength={500} placeholder="Optional, e.g. delivery from supplier #4411" />
        </Field>
        {initial.row && (
          <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            Currently <strong className="text-foreground">{initial.row.onHand}</strong> on hand and <strong className="text-foreground">{initial.row.reserved}</strong> reserved. Stock can't go
            below what is reserved for open orders.
          </div>
        )}
        <ErrorBox error={submit.error} />
      </form>
    </Modal>
  );
}
