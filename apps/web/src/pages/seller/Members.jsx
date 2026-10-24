import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Spinner, useSubmit } from '../../components/ui.jsx';
import { get, post } from '../../lib/api.js';
import { useAsync, useAuth, useToast } from '../../lib/store.jsx';

const ROLE_HELP = {
  OWNER: 'Full control',
  ADMIN: 'Manages warehouses, offers, fleet and team',
  STAFF: 'Views everything, adjusts stock',
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
    <div className="split">
      <Card title="Team" pad={false}>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data && <Spinner />}
        {data && (
          <table className="table">
            <tbody>
              {data.items.map((m) => (
                <tr key={m.userId}>
                  <td style={{ width: 44 }}>
                    <span className="avatar" style={{ cursor: 'default' }}>
                      {m.name[0]?.toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <div className="strong">
                      {m.name} {m.userId === user?.id && <span className="small faint">(you)</span>}
                    </div>
                    <div className="small muted">{m.email}</div>
                  </td>
                  <td className="right">
                    <Badge kind={m.role === 'OWNER' ? 'good' : m.role === 'ADMIN' ? 'info' : 'muted'}>{m.role}</Badge>
                    <div className="small faint">{ROLE_HELP[m.role]}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {canManage ? (
        <Card title="Add a teammate">
          <form className="stack" onSubmit={add.run}>
            <Field label="Email" hint="They must already have a LocalStock account">
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Role">
              <div className="seg">
                {['STAFF', 'ADMIN'].map((r) => (
                  <button key={r} type="button" className={role === r ? 'on' : ''} onClick={() => setRole(r)}>
                    {r === 'STAFF' ? 'Staff' : 'Admin'}
                  </button>
                ))}
              </div>
            </Field>
            <div className="small muted">{ROLE_HELP[role]}</div>
            <ErrorBox error={add.error} />
            <Button type="submit" busy={add.busy}>
              Add member
            </Button>
          </form>
        </Card>
      ) : (
        <Card>
          <p className="muted" style={{ margin: 0 }}>Only owners and admins can add teammates.</p>
        </Card>
      )}
    </div>
  );
}
