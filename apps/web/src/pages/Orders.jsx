import { Link, useNavigate } from 'react-router-dom';
import { Badge, Card, CopyId, Empty, ErrorBox, Spinner, Stat } from '../components/ui.jsx';
import { get } from '../lib/api.js';
import { dateTime, money } from '../lib/format.js';
import { useAsync } from '../lib/store.jsx';

export default function Orders() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(() => get('/orders'), []);
  const items = data?.items ?? [];
  const confirmed = items.filter((o) => o.status === 'CONFIRMED');
  const pending = items.filter((o) => o.status === 'PENDING_PAYMENT');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My orders</h1>
          <p>Your 50 most recent orders.</p>
        </div>
        <Link to="/" className="btn btn-secondary">
          Continue shopping
        </Link>
      </div>
      {data && items.length > 0 && (
        <div className="grid grid-3" style={{ marginBottom: 18 }}>
          <Stat label="Orders" value={items.length} />
          <Stat label="Awaiting payment" value={pending.length} sub={pending.length ? 'Stock is held for a limited time' : undefined} />
          <Stat label="Spent on confirmed orders" value={money(confirmed.reduce((s, o) => s + o.totalMinor, 0))} />
        </div>
      )}
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && items.length === 0 && (
        <Card>
          <Empty icon="📦" title="No orders yet">
            <Link to="/">Find something nearby</Link> and check out.
          </Empty>
        </Card>
      )}
      {items.length > 0 && (
        <Card pad={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Placed</th>
                  <th>Status</th>
                  <th className="num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/orders/${o.id}`)}>
                    <td>
                      <CopyId id={o.id} />
                    </td>
                    <td>{dateTime(o.createdAt)}</td>
                    <td>
                      <Badge status={o.status} />
                    </td>
                    <td className="num price">{money(o.totalMinor)}</td>
                    <td className="right">
                      <Link to={`/orders/${o.id}`} onClick={(e) => e.stopPropagation()}>
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
