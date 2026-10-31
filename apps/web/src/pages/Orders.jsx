import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Clock, IndianRupee, Package, PackageSearch, TrendingUp } from 'lucide-react';
import { AreaLine, Donut } from '@/components/mui/lazy';
import { Badge, Button, CopyId, Empty, ErrorBox, PageHeader, Panel, SkeletonRows, Stat } from '@/components/kit';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { get } from '@/lib/api';
import { dateTime, money, title } from '@/lib/format';
import { useAsync } from '@/lib/store';

const dayKey = (iso) => iso.slice(0, 10);
const dayLabel = (key) => new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export default function Orders() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(() => get('/orders'), []);
  const items = data?.items ?? [];
  const confirmed = items.filter((o) => o.status === 'CONFIRMED');
  const pending = items.filter((o) => o.status === 'PENDING_PAYMENT');

  const byDay = new Map();
  for (const o of [...confirmed].reverse()) byDay.set(dayKey(o.createdAt), (byDay.get(dayKey(o.createdAt)) ?? 0) + o.totalMinor);
  const byStatus = new Map();
  for (const o of items) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);

  return (
    <>
      <PageHeader
        eyebrow="Purchases"
        title="My orders"
        description="Your 50 most recent orders, with live payment and reservation status."
        actions={
          <Button asChild variant="secondary">
            <Link to="/">
              Continue shopping <ArrowRight />
            </Link>
          </Button>
        }
      />

      {data && items.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Stat index={0} icon={Package} label="Orders" value={items.length} sub={`${confirmed.length} confirmed`} />
          <Stat index={1} icon={Clock} tone="gold" label="Awaiting payment" value={pending.length} sub={pending.length ? 'Stock is held for a limited time' : 'Nothing pending'} />
          <Stat index={2} icon={IndianRupee} tone="blue" label="Spent (confirmed)" value={money(confirmed.reduce((s, o) => s + o.totalMinor, 0))} />
        </div>
      )}

      {data && items.length > 0 && (
        <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Panel icon={TrendingUp} title="Confirmed spend" description="Per day, from confirmed orders">
            {byDay.size > 0 ? (
              <AreaLine labels={[...byDay.keys()].map(dayLabel)} values={[...byDay.values()].map((v) => v / 100)} label="Spend" format={(v) => `₹${Math.round(v)}`} />
            ) : (
              <Empty icon={TrendingUp} title="No confirmed orders yet" className="py-10">
                Pay for an order to see your spend here.
              </Empty>
            )}
          </Panel>
          <Panel icon={PackageSearch} title="By status">
            <Donut data={[...byStatus].map(([status, value]) => ({ label: title(status), value }))} centerLabel="orders" />
          </Panel>
        </div>
      )}

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && (
        <Card>
          <SkeletonRows rows={5} />
        </Card>
      )}
      {data && items.length === 0 && (
        <Card>
          <Empty
            icon={Package}
            title="No orders yet"
            action={
              <Button asChild>
                <Link to="/">Find something nearby</Link>
              </Button>
            }
          >
            When you check out, your orders and their delivery progress show up here.
          </Empty>
        </Card>
      )}
      {items.length > 0 && (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Placed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((o) => (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => navigate(`/orders/${o.id}`)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="grid size-9 place-items-center rounded-xl bg-accent text-accent-foreground">
                        <Package className="size-4" />
                      </span>
                      <CopyId id={o.id} />
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{dateTime(o.createdAt)}</TableCell>
                  <TableCell>
                    <Badge status={o.status} dot />
                  </TableCell>
                  <TableCell className="num text-right font-extrabold">{money(o.totalMinor)}</TableCell>
                  <TableCell className="text-right">
                    <Link to={`/orders/${o.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                      View <ArrowRight className="size-3.5" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
