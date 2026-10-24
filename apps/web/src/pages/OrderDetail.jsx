import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, CopyId, ErrorBox, Json, Spinner, useSubmit } from '../components/ui.jsx';
import { get, post } from '../lib/api.js';
import { dateTime, minutes, money, title } from '../lib/format.js';
import { useAsync, useToast } from '../lib/store.jsx';

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

function Timeline({ order }) {
  const s = order.status;
  const failed = ['PAYMENT_FAILED', 'CANCELLED', 'EXPIRED', 'REFUND_PENDING'].includes(s);
  const steps = [
    { label: 'Placed', done: true },
    { label: 'Stock reserved', done: true },
    { label: failed ? title(s) : 'Paid', done: s === 'CONFIRMED' || failed, fail: failed },
    { label: 'Confirmed', done: s === 'CONFIRMED' },
  ];
  return (
    <div className="timeline">
      {steps.map((st) => (
        <div key={st.label} className={`timeline-step ${st.done ? 'done' : ''} ${st.fail ? 'fail' : ''}`}>
          {st.label}
        </div>
      ))}
    </div>
  );
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

  if (loading && !order) return <Spinner />;
  if (error && !order) return <ErrorBox error={error} onRetry={reload} />;

  const pending = order.status === 'PENDING_PAYMENT';
  return (
    <div className="stack">
      <div className="small muted">
        <Link to="/orders">My orders</Link> / {order.id.slice(0, 8)}
      </div>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="row gap-sm">
            <h1>Order</h1>
            <CopyId id={order.id} />
            <Badge status={order.status} />
          </div>
          <p>Placed {dateTime(order.createdAt)} · updated {dateTime(order.updatedAt)}</p>
        </div>
        <Button variant="secondary" onClick={reload} busy={loading}>
          Refresh
        </Button>
      </div>

      <div className="split">
        <div className="stack">
          <Card>
            <Timeline order={order} />
          </Card>

          <Card title="Items" pad={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Seller</th>
                    <th className="num">Qty</th>
                    <th className="num">Unit</th>
                    <th className="num">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link to={`/product/${i.variantId}`}>{i.variantName}</Link>
                      </td>
                      <td>{i.sellerName}</td>
                      <td className="num">{i.quantity}</td>
                      <td className="num">{money(i.unitPriceMinor)}</td>
                      <td className="num price">{money(i.unitPriceMinor * i.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={`Shipments (${order.shipments.length})`}>
            <div className="grid grid-2">
              {order.shipments.map((s, n) => (
                <div key={s.id} className="shipment stack-sm">
                  <div className="row between">
                    <strong>
                      #{n + 1} from {s.warehouseName}
                    </strong>
                    <Badge status={s.status} />
                  </div>
                  <div className="small muted">
                    {s.provider ? `${s.provider.name} · ${title(s.provider.type)}` : 'No courier assigned'}
                  </div>
                  <div className="row between small">
                    <span>Delivery fee {money(s.deliveryFeeMinor)}</span>
                    <span>ETA {minutes(s.etaMinutes)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {lastEvent && (
            <Card title="Last sandbox webhook" actions={<span className="small faint">verified HMAC path</span>}>
              <Json value={lastEvent} small />
            </Card>
          )}
        </div>

        <div className="sticky stack">
          <Card title="Payment">
            <div className="stack">
              <dl className="kv" style={{ margin: 0 }}>
                <dt>Subtotal</dt>
                <dd>{money(order.subtotalMinor)}</dd>
                <dt>Delivery</dt>
                <dd>{money(order.deliveryFeeMinor)}</dd>
                <dt className="total-row">Total</dt>
                <dd className="total-row">{money(order.totalMinor)}</dd>
                {order.payment && (
                  <>
                    <dt>Provider</dt>
                    <dd>
                      {order.payment.provider} <span className="mono small faint">{order.payment.providerPaymentId.slice(0, 12)}…</span>
                    </dd>
                    <dt>Status</dt>
                    <dd>
                      <Badge status={order.payment.status} />
                    </dd>
                  </>
                )}
              </dl>

              {pending && countdown && (
                <div className={`alert ${countdown === 'expired' ? 'alert-bad' : 'alert-warn'}`}>
                  {countdown === 'expired' ? (
                    <span>The reservation has expired. The worker will release the stock and paying now will trigger a refund.</span>
                  ) : (
                    <span>
                      Stock reserved for <strong className="mono">{countdown}</strong>. Pay before it runs out.
                    </span>
                  )}
                </div>
              )}

              <ErrorBox error={pay.error} />
              <ErrorBox error={cancel.error} />
              {pending && order.payment && (
                <>
                  <Button size="lg" className="btn-block" busy={pay.busy} onClick={() => pay.run('SUCCEEDED')}>
                    Pay {money(order.totalMinor)} (sandbox)
                  </Button>
                  <div className="row">
                    <Button variant="secondary" className="grow" disabled={pay.busy} onClick={() => pay.run('FAILED')}>
                      Simulate failure
                    </Button>
                    <Button variant="danger" className="grow" busy={cancel.busy} onClick={() => cancel.run()}>
                      Cancel order
                    </Button>
                  </div>
                </>
              )}
              {order.status === 'CONFIRMED' && <div className="alert alert-good">Paid and confirmed. Your shipments are being prepared.</div>}
              {!pending && order.payment?.status === 'SUCCEEDED' && order.status !== 'CONFIRMED' && (
                <div className="alert alert-info">Payment captured after the order closed; a refund is pending.</div>
              )}
              <p className="small faint" style={{ margin: 0 }}>
                The sandbox button stands in for a real payment page. It sends a signed webhook through the same code path a provider would use.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
