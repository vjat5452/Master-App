// Pack sizes are shown side by side because the API refuses to link two different known sizes.
import { useState } from 'react';
import { Check, FlaskConical, Link2, SearchCheck, X } from 'lucide-react';
import { VariantPicker } from '@/components/VariantPicker';
import { Badge, Button, Empty, ErrorBox, Modal, Panel, SkeletonRows, useSubmit } from '@/components/kit';
import { get, post } from '@/lib/api';
import { ago, title } from '@/lib/format';
import { useAsync, useToast } from '@/lib/store';
import { cn } from '@/lib/utils';

const sizeText = (p) => (p ? `${p.count > 1 ? `${p.count} × ` : ''}${p.quantity} ${p.unit}` : 'size unknown');
const sameSize = (a, b) => a && b && a.unit === b.unit && a.count === b.count && a.quantity === b.quantity;

export default function MappingReview() {
  const queue = useAsync(() => get('/admin/product-mapping/review-queue?limit=20'), []);
  const [linking, setLinking] = useState(null);
  const items = queue.data?.items ?? [];

  return (
    <Panel
      icon={SearchCheck}
      title="Match review"
      description={queue.data ? `${queue.data.total} external listing${queue.data.total === 1 ? '' : 's'} waiting for a decision` : 'External listings the matcher could not link with certainty'}
      pad={false}
    >
      <ErrorBox error={queue.error} onRetry={queue.reload} />
      {queue.loading && !queue.data && <SkeletonRows rows={3} />}
      {queue.data && items.length === 0 && (
        <Empty icon={Check} title="Nothing to review">
          Listings matched by barcode or by brand, size and name are linked automatically. Anything less certain lands here.
        </Empty>
      )}
      <ul className="divide-y">
        {items.map((item) => (
          <ReviewItem key={item.listing.id} item={item} onChanged={queue.reload} onLink={() => setLinking(item.listing)} />
        ))}
      </ul>
      {linking && <ManualLinkModal listing={linking} onClose={() => setLinking(null)} onDone={queue.reload} />}
    </Panel>
  );
}

function ReviewItem({ item, onChanged, onLink }) {
  const toast = useToast();
  const { listing } = item;
  const decide = useSubmit(async (mappingId, decision) => {
    await post(`/admin/product-mapping/${mappingId}/decision`, { decision });
    toast(decision === 'CONFIRM' ? 'Linked to the product' : 'Candidate rejected');
    onChanged();
  });
  return (
    <li className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge kind="info">{listing.platform.name}</Badge>
          {listing.platform.isDemo && (
            <Badge kind="gold">
              <FlaskConical /> Demo
            </Badge>
          )}
          <span className="text-[11px] text-muted-foreground">waiting {ago(item.waitingSince)}</span>
        </div>
        <div className="mt-1.5 font-bold">{listing.title}</div>
        <div className="text-xs text-muted-foreground">
          {listing.brand ?? 'No brand'} · {listing.variant ?? 'no size text'} · <strong className="text-foreground/80">{sizeText(listing.packSize)}</strong>
        </div>
        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
          {listing.externalListingId}
          {listing.gtin ? ` · GTIN ${listing.gtin}` : ''}
        </div>
        <Button size="sm" variant="ghost" className="mt-2 px-0" onClick={onLink}>
          <Link2 /> Link to a different product
        </Button>
      </div>
      <div className="grid gap-2">
        {item.candidates.map((c) => {
          const sizeOk = sameSize(listing.packSize, c.variant.packSize);
          const sizeConflict = listing.packSize && c.variant.packSize && !sizeOk;
          return (
            <div key={c.mappingId} className={cn('flex flex-wrap items-center gap-3 rounded-xl border p-3', sizeConflict && 'border-destructive/30 bg-destructive/[0.04]')}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">
                  {c.variant.brand} {c.variant.name}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  <span className={cn('font-semibold', sizeOk ? 'text-success' : sizeConflict ? 'text-destructive' : 'text-amber-700 dark:text-gold')}>
                    {sizeText(c.variant.packSize)} {sizeOk ? '(same size)' : sizeConflict ? '(different size)' : '(cannot compare size)'}
                  </span>
                  <span>
                    {title(c.method)} · {Math.round(c.confidence * 100)}%
                  </span>
                  {c.variant.barcode && <span className="font-mono">GTIN {c.variant.barcode}</span>}
                </div>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" busy={decide.busy} disabled={sizeConflict} onClick={() => decide.run(c.mappingId, 'CONFIRM')} title={sizeConflict ? 'Different pack sizes cannot be the same product' : 'Same product'}>
                  <Check /> Same product
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" busy={decide.busy} onClick={() => decide.run(c.mappingId, 'REJECT')}>
                  <X /> Not this
                </Button>
              </div>
            </div>
          );
        })}
        <ErrorBox error={decide.error} />
      </div>
    </li>
  );
}

function ManualLinkModal({ listing, onClose, onDone }) {
  const toast = useToast();
  const [variant, setVariant] = useState(null);
  const submit = useSubmit(async () => {
    await post(`/admin/product-mapping/listings/${listing.id}/manual`, { variantId: variant.variantId, note: 'linked manually from the review queue' });
    toast('Listing linked');
    onDone();
    onClose();
  });
  return (
    <Modal
      title="Link to a product"
      description={`${listing.title} (${sizeText(listing.packSize)}). Choose the LocalStock product it is. A product with a different known pack size is refused.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={submit.busy} disabled={!variant} onClick={submit.run}>
            <Link2 /> Link
          </Button>
        </>
      }
    >
      <VariantPicker value={variant} onChange={setVariant} />
      <ErrorBox error={submit.error} />
    </Modal>
  );
}
