// Imports are all-or-nothing: any error means nothing is saved.
import { useState } from 'react';
import { Download, FileCheck2, FileUp, Upload, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Empty, ErrorBox, Panel, useSubmit } from '@/components/kit';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { get, post } from '@/lib/api';
import { money } from '@/lib/format';
import { useAsync, useToast } from '@/lib/store';
import { cn } from '@/lib/utils';

const TEMPLATE = 'sku,barcode,price,mrp,warehouse,quantity\nMY-SKU-1,8901262150064,54,56,Main store,24\n';
const OFFER_TONE = { CREATE: 'good', UPDATE: 'info', UNCHANGED: 'muted' };

const sendCsv = (companyId, csv, dryRun) =>
  post(`/companies/${companyId}/catalogue-imports?dryRun=${dryRun}`, csv, { headers: { 'Content-Type': 'text/csv' } });

export default function Import({ companyId, canManage }) {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const warehouses = useAsync(() => get(`/companies/${companyId}/warehouses`), [companyId]);

  const check = useSubmit(async () => setPreview(await sendCsv(companyId, csv, true)));
  const apply = useSubmit(async () => {
    const r = await sendCsv(companyId, csv, false);
    const s = r.summary;
    toast(`Imported: ${s.offersCreated} new, ${s.offersUpdated} updated offers, ${s.stockChanged} stock levels set`);
    setPreview(null);
    setCsv('');
    setFileName('');
  });

  const load = (text, name = '') => {
    setCsv(text);
    setFileName(name);
    setPreview(null);
    check.setError(null);
    apply.setError(null);
  };

  if (!canManage) {
    return (
      <Panel icon={Upload} title="Import">
        <Empty icon={Upload} title="Owners and admins only">Ask an owner or admin of this company to import catalogue files.</Empty>
      </Panel>
    );
  }

  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;
  const names = warehouses.data?.items.map((w) => w.name) ?? [];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Panel
        icon={Upload}
        title="Import offers and stock"
        description="Check the file first. Importing applies every row, or none if any row has a problem."
        actions={
          <Button asChild size="sm" variant="ghost">
            <a href={template} download="localstock-import-template.csv">
              <Download /> Template
            </a>
          </Button>
        }
      >
        <div className="grid gap-4">
          <label
            className={cn('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition hover:border-primary/40 hover:bg-accent/30', fileName && 'border-primary/40 bg-accent/30')}
            onDragOver={(e) => e.preventDefault()}
            onDrop={async (e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) load(await f.text(), f.name);
            }}
          >
            <FileUp className="size-6 text-primary" />
            <span className="text-sm font-bold">{fileName || 'Choose a CSV file or drop it here'}</span>
            <span className="text-xs text-muted-foreground">Up to 2,000 rows, 1 MB</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) load(await f.text(), f.name);
                e.target.value = '';
              }}
            />
          </label>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-muted-foreground">…or paste CSV text</summary>
            <textarea
              value={csv}
              onChange={(e) => load(e.target.value)}
              rows={6}
              spellCheck={false}
              className="mt-2 w-full rounded-xl border bg-background p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={TEMPLATE}
            />
          </details>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" busy={check.busy} disabled={!csv.trim()} onClick={check.run}>
              <FileCheck2 /> Check file
            </Button>
            <Button busy={apply.busy} disabled={!preview?.valid} onClick={apply.run}>
              <Upload /> Import {preview?.valid ? `${preview.summary.rows} rows` : ''}
            </Button>
          </div>
          <ErrorBox error={check.error} />
          <ErrorBox error={apply.error} />
          {preview && <Preview preview={preview} />}
        </div>
      </Panel>

      <Panel title="File format" description="One row per product, and optionally its stock in one store">
        <dl className="grid gap-2 text-sm">
          {[
            ['sku', 'Your SKU (required)'],
            ['barcode or variant_id', 'Which catalogue product. It must already be in the catalogue.'],
            ['price', 'Selling price in rupees, e.g. 45.50 (required)'],
            ['mrp', 'Optional. Blank keeps the current MRP. Price may not exceed it.'],
            ['warehouse', 'Store name or id (needed with quantity)'],
            ['quantity', 'Units on hand: replaces the count, never below what is reserved for orders'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="font-mono text-xs font-bold">{k}</dt>
              <dd className="text-xs text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>
        {names.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Your stores: {names.map((n) => <code key={n} className="mr-1 rounded bg-muted px-1">{n}</code>)}
          </p>
        )}
      </Panel>
    </div>
  );
}

function Preview({ preview }) {
  if (!preview.valid) {
    return (
      <div className="grid gap-3">
        <Alert tone="bad" title={`${preview.errors.length} problem${preview.errors.length === 1 ? '' : 's'} found. Nothing will be imported until they are fixed.`} />
        <div className="max-h-80 overflow-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead>Column</TableHead>
                <TableHead>Problem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.errors.map((e, i) => (
                <TableRow key={i}>
                  <TableCell className="num">{e.line}</TableCell>
                  <TableCell className="font-mono text-xs">{e.column ?? '—'}</TableCell>
                  <TableCell className="text-sm">
                    <XCircle className="mr-1 inline size-3.5 text-destructive" />
                    {e.message}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }
  const s = preview.summary;
  return (
    <div className="grid gap-3">
      <Alert tone="good" title="The file is valid. Nothing has been saved yet.">
        {s.offersCreated} new offers, {s.offersUpdated} updated, {s.offersUnchanged} unchanged · {s.stockChanged} stock levels to set, {s.stockUnchanged} unchanged
      </Alert>
      <div className="max-h-96 overflow-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Line</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Offer</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead>Stock</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.rows.map((r) => (
              <TableRow key={r.line}>
                <TableCell className="num">{r.line}</TableCell>
                <TableCell>
                  <div className="text-sm font-bold">{r.product}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{r.sku}</div>
                </TableCell>
                <TableCell>
                  <Badge kind={OFFER_TONE[r.offer]}>{r.offer.toLowerCase()}</Badge>
                </TableCell>
                <TableCell className="num whitespace-nowrap text-right">
                  {money(r.priceMinor)}
                  {r.mrpMinor != null && <div className="text-[11px] text-muted-foreground">MRP {money(r.mrpMinor)}</div>}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {r.stock ? (
                    <>
                      <span className="text-muted-foreground">{r.stock.warehouse}:</span> {r.stock.action === 'SET' ? `${r.stock.from} → ${r.stock.to}` : `${r.stock.to} (unchanged)`}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
