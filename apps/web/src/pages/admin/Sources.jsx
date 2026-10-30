// External platforms and their sources: access state, health, recent collection runs, and
// the integration-status workflow. ACTIVE is a recorded human decision (with evidence),
// never something this page infers.
import { useState } from 'react';
import { Activity, FileText, FlaskConical, Globe, PlugZap, RefreshCw, ScrollText, Stethoscope } from 'lucide-react';
import { Badge, Button, Empty, ErrorBox, Field, Modal, Panel, SkeletonRows, useSubmit } from '@/components/kit';
import { Input, NativeSelect } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { get, patch, post } from '@/lib/api';
import { ago, title } from '@/lib/format';
import { useAsync, useToast } from '@/lib/store';
import { cn } from '@/lib/utils';

const STATUSES = ['RESEARCH_REQUIRED', 'ACCESS_REQUESTED', 'SANDBOX', 'APPROVED', 'ACTIVE', 'DISABLED'];
const HEALTH_TONE = { HEALTHY: 'good', DEGRADED: 'warn', DOWN: 'bad', NOT_CONFIGURED: 'muted', UNKNOWN: 'muted' };
const INTEGRATION_TONE = { ACTIVE: 'good', APPROVED: 'info', SANDBOX: 'info', ACCESS_REQUESTED: 'warn', RESEARCH_REQUIRED: 'muted', DISABLED: 'muted' };
const GITHUB_DOCS = 'https://github.com/vjat5452/Master-App/blob/feature/unified-external-platform-discovery/';

export default function Sources() {
  const list = useAsync(() => get('/admin/external-platforms'), []);
  const [runsFor, setRunsFor] = useState(null);
  const [statusFor, setStatusFor] = useState(null);
  const items = list.data?.items ?? [];
  const sources = items.flatMap((p) => p.sources);
  const configured = sources.filter((s) => s.configured).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Summary label="Platforms" value={items.filter((p) => !p.platform.isDemo).length} sub={`${items.filter((p) => p.platform.isDemo).length} demo`} />
        <Summary label="Sources configured" value={`${configured} of ${sources.length}`} sub="callable in this deployment" />
        <Summary label="Listings awaiting review" value={items.reduce((n, p) => n + p.openReviews, 0)} sub="see Match review" />
      </div>

      <Panel
        icon={Globe}
        title="External platforms"
        description="Only authorized access is ever used. Platforms without it stay disabled."
        pad={false}
        actions={
          <Button size="sm" variant="ghost" onClick={list.reload}>
            <RefreshCw /> Reload
          </Button>
        }
      >
        <ErrorBox error={list.error} onRetry={list.reload} />
        {list.loading && !list.data && <SkeletonRows rows={4} />}
        {list.data && items.length === 0 && <Empty icon={Globe} title="No platforms" />}
        <ul className="divide-y">
          {items.map((p) => (
            <li key={p.platform.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={cn('grid size-9 place-items-center rounded-xl text-sm font-extrabold', p.platform.isDemo ? 'bg-gold/15 text-amber-700 dark:text-gold' : 'bg-info/10 text-info')}>
                    {p.platform.isDemo ? <FlaskConical className="size-4" /> : p.platform.name[0]}
                  </span>
                  <div>
                    <div className="font-bold">{p.platform.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {p.listings} listings seen · {p.openReviews} awaiting review
                    </div>
                  </div>
                  {p.platform.isDemo && <Badge kind="gold">Demo fixture data</Badge>}
                </div>
                {p.platform.doc && (
                  <a href={`${GITHUB_DOCS}${p.platform.doc}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    <FileText className="size-3.5" /> Access research
                  </a>
                )}
              </div>
              <div className="mt-3 grid gap-2">
                {p.sources.map((s) => (
                  <SourceRow key={s.code} s={s} onRuns={() => setRunsFor(s)} onStatus={() => setStatusFor(s)} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {runsFor && <RunsModal source={runsFor} onClose={() => setRunsFor(null)} />}
      {statusFor && <StatusModal source={statusFor} onClose={() => setStatusFor(null)} onDone={list.reload} />}
    </div>
  );
}

function Summary({ label, value, sub }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-soft">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="num mt-1 text-2xl font-extrabold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function SourceRow({ s, onRuns, onStatus }) {
  const toast = useToast();
  const test = useSubmit(async () => {
    const r = await post(`/admin/external-sources/${s.code}/test-connection`);
    toast(`${s.name}: ${title(r.health)}${r.reason ? ` · ${r.reason}` : ''}`, r.health === 'HEALTHY' ? 'good' : 'info');
  });
  const h = s.health;
  return (
    <div className="grid gap-2 rounded-xl border bg-muted/20 p-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs font-bold">{s.code}</span>
          <Badge kind="muted">{title(s.accessType)}</Badge>
          <Badge kind={INTEGRATION_TONE[s.integrationStatus]}>{title(s.integrationStatus)}</Badge>
          {!s.inThisDeployment && <Badge kind="muted">not in this deployment</Badge>}
        </div>
        {s.reason ? (
          <p className="mt-1 text-[11px] text-muted-foreground">{s.reason}</p>
        ) : (
          <p className="mt-1 text-[11px] text-muted-foreground">Capabilities: {s.capabilities.length ? s.capabilities.join(', ') : 'none declared'}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <Badge kind={HEALTH_TONE[h?.status] ?? 'muted'} dot>
          {h ? title(h.status) : 'Not checked yet'}
        </Badge>
        {h?.lastSuccessAt && <span>last success {ago(h.lastSuccessAt)}</span>}
        {h?.errorRate != null && <span>{Math.round(h.errorRate * 100)}% errors</span>}
        {h?.latencyP50Ms != null && <span>{h.latencyP50Ms} ms typical</span>}
        <span>
          {s.runs24h.total} runs / 24 h{s.runs24h.failed ? `, ${s.runs24h.failed} failed` : ''}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 lg:justify-end">
        <Button size="sm" variant="secondary" busy={test.busy} onClick={test.run} disabled={!s.inThisDeployment}>
          <Stethoscope /> Test
        </Button>
        <Button size="sm" variant="ghost" onClick={onRuns}>
          <ScrollText /> Runs
        </Button>
        <Button size="sm" variant="ghost" onClick={onStatus}>
          <PlugZap /> Status
        </Button>
      </div>
      {test.error && (
        <div className="lg:col-span-3">
          <ErrorBox error={test.error} />
        </div>
      )}
    </div>
  );
}

function RunsModal({ source, onClose }) {
  const runs = useAsync(() => get(`/admin/external-sources/${source.code}/runs?limit=30`), [source.code]);
  return (
    <Modal title={`Collection runs: ${source.name}`} description="Most recent first. Error messages never contain payloads or credentials." onClose={onClose} className="max-w-3xl">
      <ErrorBox error={runs.error} onRetry={runs.reload} />
      {runs.loading && !runs.data && <SkeletonRows rows={3} />}
      {runs.data?.items.length === 0 && (
        <Empty icon={Activity} title="No runs yet" className="py-8">
          Background collection runs only for configured sources, driven by what customers compare.
        </Empty>
      )}
      {runs.data?.items.length > 0 && (
        <div className="max-h-[60vh] overflow-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Area</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Saved</TableHead>
                <TableHead className="text-right">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs">{ago(r.startedAt)}</TableCell>
                  <TableCell>
                    <Badge status={r.status} dot />
                    {r.errorCode && <div className="mt-1 font-mono text-[10px] text-destructive">{r.errorCode}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.cell ?? '—'}</TableCell>
                  <TableCell className="num text-right text-xs">
                    {r.itemsValid}/{r.itemsReceived}
                  </TableCell>
                  <TableCell className="num text-right text-xs">{r.observationsWritten}</TableCell>
                  <TableCell className="num text-right text-xs">{r.latencyMs != null ? `${r.latencyMs} ms` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Modal>
  );
}

function StatusModal({ source, onClose, onDone }) {
  const toast = useToast();
  const [status, setStatus] = useState(source.integrationStatus);
  const [note, setNote] = useState('');
  const submit = useSubmit(async (e) => {
    e.preventDefault();
    await patch(`/admin/external-sources/${source.code}/status`, { integrationStatus: status, ...(note.trim() ? { note: note.trim() } : {}) });
    toast(`${source.name} is now ${title(status)}`);
    onDone();
    onClose();
  });
  return (
    <Modal
      title={`Integration status: ${source.name}`}
      description="Record where access stands. ACTIVE needs a configured, non-demo source and a note on the acceptance tests it passed."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="source-status" busy={submit.busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="source-status" className="grid gap-4" onSubmit={submit.run}>
        <Field label="Status">
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {title(s)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Note" hint={status === 'ACTIVE' ? 'Required: which acceptance tests passed, against which genuine source.' : 'Optional, e.g. who was contacted.'}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} required={status === 'ACTIVE'} minLength={status === 'ACTIVE' ? 10 : undefined} />
        </Field>
        <ErrorBox error={submit.error} />
      </form>
    </Modal>
  );
}
