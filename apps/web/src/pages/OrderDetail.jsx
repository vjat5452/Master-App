import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, CircleDollarSign, CreditCard, Hourglass, Package, RefreshCw, Truck, Warehouse, Webhook, XCircle } from 'lucide-react';
import { ProgressStepper } from '@/components/mui/lazy';
import { Alert, Badge, Button, CopyId, ErrorBox, Json, KV, Panel, Reveal, Spinner, useSubmit } from '@/components/kit';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { get, post } from '@/lib/api';
import { dateTime, minutes, money, title } from '@/lib/format';
import { useAsync, useToast } from '@/lib/store';

const OUTCOME = {
  CONFIRMED: ['Payment succeeded; order confirmed', 'good'],
  PAYMENT_FAILED: ['Payment failed; reserved stock released', 'bad'],
  REFUND_PENDING: ['Payment arrived too late; a refund was requested', 'info'],
  ALREADY_SETTLED: ['This payment was already settled', 'info'],
  DUPLICATE_EVENT: ['Duplicate webhook event ignored', 'info'],
};

function useCountdown(iso) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!iso) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [iso]);
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'expired';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function progress(order) {
  const s = order.status;
  const failed = ['PAYMENT_FAILED', 'CANCELLED', 'EXPIRED', 'REFUND_PENDING'].includes(s);
  const steps = [
    { label: 'Placed', caption: dateTime(order.createdAt), done: true },
    { label: 'Stock reserved', done: true },
    { label: failed ? title(s) : 'Paid', done: s === 'CONFIRMED', error: failed },
    { label: 'Confirmed', done: s === 'CONFIRMED' },
  ];
  const active = s === 'CONFIRMED' ? 4 : 2;
  return { steps, active };
}

export default function OrderDetail() {
  const { orderId } = useParams();
  const toast = useToast();
  const { data: order, error, loading, reload, setData } = useAsync(() => get(`/orders/${orderId}`), [orderId]);
  const [lastEvent, setLastEvent] = useState(null);
  const countdown = useCountdown(order?.status === 'PENDING_PAYMENT' ? order.reservationExpiresAt : null);

  const pay = useSubmit(async (status) => {
    const r = await post(`/payments/sandbox/${order.payment.providerPaymentId}/simulate`, { status });
    setLastEvent(r);
    const [msg, kind] = OUTCOME[r.result.outcome] ?? [r.result.outcome, 'info'];
    toast(msg, kind);
    await reload();
  });
  const cancel = useSubmit(async () => {
    setData(await post(`/orders/${orderId}/cancel`));
    toast('Order cancelled; reserved stock released', 'info');
  });

  if (loading && !order) return <Spinner className="py-32" />;
  if (error && !order) return <ErrorBox error={error} onRetry={reload} />;

  const pending = order.status === 'PENDING_PAYMENT';
  const { steps, active } = progress(order);

  return (
    <div className="space-y-8">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/orders" className="hover:text-foreground">
          My orders
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="font-mono font-semibold text-foreground">{order.id.slice(0, 8)}</span>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Order</h1>
            <CopyId id={order.id} />
            <Badge status={order.status} dot />
          </div>
          <p className="mt-2 text-muted-foreground">
            Placed {dateTime(order.createdAt)} · updated {dateTime(order.updatedAt)}
          </p>
        </div>
        <Button variant="secondary" onClick={reload} busy={loading}>
          <RefreshCw /> Refresh
        </Button>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Reveal>
            <Card className="px-4 py-6 sm:px-8">
              <ProgressStepper steps={steps} active={active} />
            </Card>
          </Reveal>

          <Reveal delay={0.05}>
            <Panel icon={Package} title="Items" description={`${order.items.length} line${order.items.length === 1 ? '' : 's'}`} pad={false}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Seller</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit</TableHead>
                    <TableHead className="text-right">Line total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <Link to={`/product/${i.variantId}`} className="font-bold hover:text-primary">
                          {i.variantName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{i.sellerName}</TableCell>
                      <TableCell className="num text-right">{i.quantity}</TableCell>
                      <TableCell className="num text-right">{money(i.unitPriceMinor)}</TableCell>
                      <TableCell className="num text-right font-extrabold">{money(i.unitPriceMinor * i.quantity)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          </Reveal>

          <Reveal delay={0.1}>
            <Panel icon={Truck} title={`Shipments (${order.shipments.length})`} description="Each shipment leaves from its own warehouse">
              <div className="grid gap-3 sm:grid-cols-2">
                {order.shipments.map((s, n) => (
                  <div key={s.id} className="rounded-2xl border bg-muted/20 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white">
                          <Warehouse className="size-5" />
                        </span>
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground">Shipment #{n + 1}</div>
                          <div className="font-bold">{s.warehouseName}</div>
                        </div>
                      </div>
                      <Badge status={s.status} />
                    </div>
                    <div className="mt-3 text-xs text-muted-foreground">{s.provider ? `${s.provider.name} · ${title(s.provider.type)}` : 'No courier assigned'}</div>
                    <div className="mt-3 flex justify-between border-t pt-3 text-sm">
                      <span>
                        Fee <strong className="num">{money(s.deliveryFeeMinor)}</strong>
                      </span>
                      <span>
                        ETA <strong>{minutes(s.etaMinutes)}</strong>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </Reveal>

          {lastEvent && (
            <Panel icon={Webhook} title="Last sandbox webhook" description="Delivered through the verified HMAC path">
              <Json value={lastEvent} small />
            </Panel>
          )}
        </div>

        <div className="space-y-6 lg:sticky lg:top-24">
          <Card className="overflow-hidden">
            <div className="flex items-center gap-3 border-b bg-muted/30 px-6 py-4">
              <CreditCard className="size-5 text-primary" />
              <h3 className="font-bold">Payment</h3>
              {order.payment && <Badge status={order.payment.status} className="ml-auto" />}
            </div>
            <div className="space-y-5 p-6">
              <KV
                rows={[
                  ['Subtotal', money(order.subtotalMinor)],
                  ['Delivery', money(order.deliveryFeeMinor)],
                  ['Total', money(order.totalMinor), true],
                ]}
              />
              {order.payment && (
                <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2 text-xs">
                  <span className="capitalize text-muted-foreground">{order.payment.provider}</span>
                  <span className="font-mono">{order.payment.providerPaymentId.slice(0, 16)}…</span>
                </div>
              )}

              {pending && countdown && (
                <Alert tone={countdown === 'expired' ? 'bad' : 'warn'}>
                  {countdown === 'expired' ? (
                    'The reservation has expired. The worker will release the stock and paying now will trigger a refund.'
                  ) : (
                    <span className="flex items-center gap-2">
                      <Hourglass className="size-4" /> Stock reserved for <strong className="num font-mono text-base">{countdown}</strong>
                    </span>
                  )}
                </Alert>
              )}

              <ErrorBox error={pay.error} />
              <ErrorBox error={cancel.error} />
              {pending && order.payment && (
                <div className="space-y-2.5">
                  <Button size="lg" variant="gold" block busy={pay.busy} onClick={() => pay.run('SUCCEEDED')}>
                    <CircleDollarSign /> Pay {money(order.totalMinor)}
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="secondary" disabled={pay.busy} onClick={() => pay.run('FAILED')}>
                      Simulate failure
                    </Button>
                    <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" busy={cancel.busy} onClick={() => cancel.run()}>
                      <XCircle /> Cancel
                    </Button>
                  </div>
                </div>
              )}
              {order.status === 'CONFIRMED' && <Alert tone="good" title="Paid and confirmed">Your shipments are being prepared.</Alert>}
              {!pending && order.payment?.status === 'SUCCEEDED' && order.status !== 'CONFIRMED' && (
                <Alert tone="info">Payment captured after the order closed; a refund is pending.</Alert>
              )}
              <p className="text-xs text-muted-foreground">
                Sandbox payments stand in for a real payment page. Each one sends a signed webhook through the same code path a provider would use.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
