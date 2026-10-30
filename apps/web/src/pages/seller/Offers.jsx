import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Tag } from 'lucide-react';
import { ProductArt } from '@/components/product';
import { VariantPicker } from '@/components/VariantPicker';
import { Badge, Button, CopyId, Empty, ErrorBox, Field, Modal, Panel, Segmented, SkeletonRows, useSubmit } from '@/components/kit';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { get, patch, post } from '@/lib/api';
import { money, toMinor } from '@/lib/format';
import { useAsync, useToast } from '@/lib/store';

export default function Offers({ companyId, canManage }) {
  const { data, error, loading, reload } = useAsync(() => get(`/companies/${companyId}/offers`), [companyId]);
  const [editing, setEditing] = useState(null);

  return (
    <Panel
      icon={Tag}
      title="Offers"
      description="Your price for each shared catalog product"
      pad={false}
      actions={
        canManage && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> List a product
          </Button>
        )
      }
    >
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <SkeletonRows />}
      {data?.items.length === 0 && (
        <Empty
          icon={Tag}
          title="No offers yet"
          action={
            canManage && (
              <Button onClick={() => setEditing('new')}>
                <Plus /> List your first product
              </Button>
            )
          }
        >
          An offer is your price for a shared catalog product. Stock it in a warehouse to start selling.
        </Empty>
      )}
      {data?.items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Your SKU</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">MRP</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Id</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <ProductArt names={[o.variantName]} src={o.imageUrl} size="sm" />
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{o.brand}</div>
                      <Link to={`/product/${o.variantId}`} className="font-bold hover:text-primary">
                        {o.variantName}
                      </Link>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-xs">{o.sellerSku}</span>
                </TableCell>
                <TableCell className="num text-right text-base font-extrabold">{money(o.priceMinor)}</TableCell>
                <TableCell className="num text-right text-sm text-muted-foreground">{o.mrpMinor != null ? money(o.mrpMinor) : '—'}</TableCell>
                <TableCell>
                  <Badge status={o.status} dot />
                </TableCell>
                <TableCell>
                  <CopyId id={o.id} />
                </TableCell>
                <TableCell className="text-right">
                  {canManage && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(o)}>
                      <Pencil /> Edit
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {editing === 'new' && <CreateOffer companyId={companyId} onClose={() => setEditing(null)} onDone={reload} />}
      {editing && editing !== 'new' && <EditOffer companyId={companyId} offer={editing} onClose={() => setEditing(null)} onDone={reload} />}
    </Panel>
  );
}

function CreateOffer({ companyId, onClose, onDone }) {
  const toast = useToast();
  const [variant, setVariant] = useState(null);
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [mrp, setMrp] = useState('');
  const submit = useSubmit(async (e) => {
    e.preventDefault();
    const o = await post(`/companies/${companyId}/offers`, {
      variantId: variant.variantId,
      sellerSku: sku,
      priceMinor: toMinor(price),
      ...(mrp.trim() ? { mrpMinor: toMinor(mrp) } : {}),
    });
    toast(`Listed ${o.variantName} at ${money(o.priceMinor)}`);
    onDone();
    onClose();
  });
  return (
    <Modal
      title="List a product"
      description="Pick a product from the shared catalog and set your SKU and price."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="offer-form" busy={submit.busy} disabled={!variant}>
            Create offer
          </Button>
        </>
      }
    >
      <form id="offer-form" className="grid gap-4" onSubmit={submit.run}>
        <Field label="Catalog product">
          <VariantPicker value={variant} onChange={setVariant} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your SKU">
            <Input value={sku} onChange={(e) => setSku(e.target.value)} required maxLength={100} />
          </Field>
          <Field label="Price (₹)">
            <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </Field>
        </div>
        <Field label="MRP (₹)" hint="Optional. Your price may not be above the MRP.">
          <Input type="number" min={0} step="0.01" value={mrp} onChange={(e) => setMrp(e.target.value)} />
        </Field>
        <ErrorBox error={submit.error} />
      </form>
    </Modal>
  );
}

function EditOffer({ companyId, offer, onClose, onDone }) {
  const toast = useToast();
  const [price, setPrice] = useState(String(offer.priceMinor / 100));
  const [mrp, setMrp] = useState(offer.mrpMinor != null ? String(offer.mrpMinor / 100) : '');
  const [status, setStatus] = useState(offer.status);
  const submit = useSubmit(async (e) => {
    e.preventDefault();
    const body = {};
    if (toMinor(price) !== offer.priceMinor) body.priceMinor = toMinor(price);
    // Empty clears the MRP.
    const nextMrp = mrp.trim() ? toMinor(mrp) : null;
    if (nextMrp !== (offer.mrpMinor ?? null)) body.mrpMinor = nextMrp;
    if (status !== offer.status) body.status = status;
    if (!Object.keys(body).length) return onClose();
    await patch(`/companies/${companyId}/offers/${offer.id}`, body);
    toast('Offer updated. Search results refresh shortly.');
    onDone();
    onClose();
  });
  return (
    <Modal
      title={`Edit offer: ${offer.variantName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="offer-edit" busy={submit.busy}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="offer-edit" className="grid gap-4" onSubmit={submit.run}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Price (₹)">
            <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </Field>
          <Field label="MRP (₹)" hint="Leave empty for no MRP">
            <Input type="number" min={0} step="0.01" value={mrp} onChange={(e) => setMrp(e.target.value)} />
          </Field>
        </div>
        <Field label="Status" hint="Paused offers are hidden from customers. Archived offers are retired.">
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              { id: 'ACTIVE', label: 'Active' },
              { id: 'PAUSED', label: 'Paused' },
              { id: 'ARCHIVED', label: 'Archived' },
            ]}
            className="w-fit"
          />
        </Field>
        <ErrorBox error={submit.error} />
      </form>
    </Modal>
  );
}
