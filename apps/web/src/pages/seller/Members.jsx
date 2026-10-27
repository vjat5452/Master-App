import { useState } from 'react';
import { Crown, ShieldCheck, UserPlus, Users, Wrench } from 'lucide-react';
import { Badge, Button, ErrorBox, Field, Panel, Segmented, SkeletonRows, useSubmit } from '@/components/kit';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/misc';
import { get, post } from '@/lib/api';
import { useAsync, useAuth, useToast } from '@/lib/store';

const ROLE = {
  OWNER: { help: 'Full control', kind: 'gold', icon: Crown },
  ADMIN: { help: 'Manages warehouses, offers, fleet and team', kind: 'info', icon: ShieldCheck },
  STAFF: { help: 'Views everything, adjusts stock', kind: 'muted', icon: Wrench },
};

export default function Members({ companyId, canManage }) {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => get(`/companies/${companyId}/members`), [companyId]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('STAFF');
  const add = useSubmit(async (e) => {
    e.preventDefault();
    const m = await post(`/companies/${companyId}/members`, { email, role });
    toast(`${m.name} added as ${m.role.toLowerCase()}`);
    setEmail('');
    reload();
  });

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Panel icon={Users} title="Team" description={data ? `${data.items.length} member${data.items.length === 1 ? '' : 's'}` : undefined} pad={false}>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data && <SkeletonRows rows={3} />}
        {data && (
          <ul className="divide-y">
            {data.items.map((m) => {
              const r = ROLE[m.role] ?? ROLE.STAFF;
              return (
                <li key={m.userId} className="flex items-center gap-4 px-5 py-4">
                  <Avatar className="size-10">
                    <AvatarFallback>{m.name[0]?.toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">
                      {m.name} {m.userId === user?.id && <span className="text-xs font-medium text-muted-foreground">(you)</span>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                  </div>
                  <div className="text-right">
                    <Badge kind={r.kind}>
                      <r.icon /> {m.role}
                    </Badge>
                    <div className="mt-1 hidden text-[11px] text-muted-foreground sm:block">{r.help}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {canManage ? (
        <Panel icon={UserPlus} title="Add a teammate" description="They must already have a LocalStock account">
          <form className="grid gap-4" onSubmit={add.run}>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="teammate@company.com" />
            </Field>
            <Field label="Role" hint={ROLE[role].help}>
              <Segmented
                value={role}
                onChange={setRole}
                options={[
                  { id: 'STAFF', label: 'Staff', icon: Wrench },
                  { id: 'ADMIN', label: 'Admin', icon: ShieldCheck },
                ]}
                className="w-fit"
              />
            </Field>
            <ErrorBox error={add.error} />
            <Button type="submit" busy={add.busy} block>
              <UserPlus /> Add member
            </Button>
          </form>
        </Panel>
      ) : (
        <Panel>
          <p className="text-sm text-muted-foreground">Only owners and admins can add teammates.</p>
        </Panel>
      )}
    </div>
  );
}
