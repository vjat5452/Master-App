import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, CopyId, ErrorBox, useSubmit } from '../components/ui.jsx';
import { getTokens, onTokensChange, post, setTokens } from '../lib/api.js';
import { dateTime } from '../lib/format.js';
import { useAuth, useToast } from '../lib/store.jsx';

function decode(jwt) {
  try {
    return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

export default function Account() {
  const { user, reload, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [tokens, setLocal] = useState(getTokens());
  const [now, setNow] = useState(Date.now());
  useEffect(() => onTokensChange(setLocal), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const claims = tokens ? decode(tokens.accessToken) : null;
  const left = claims ? Math.max(0, Math.round(claims.exp - now / 1000)) : 0;

  const refresh = useSubmit(async () => {
    setTokens(await post('/auth/refresh', { refreshToken: getTokens().refreshToken }, { auth: false }));
    await reload();
    toast('Tokens rotated: new access token and new refresh token issued');
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Account</h1>
          <p>Your profile, company memberships and current session.</p>
        </div>
      </div>
      <div className="grid grid-2">
        <Card title="Profile">
          <dl className="kv" style={{ margin: 0 }}>
            <dt>Name</dt>
            <dd>{user.name}</dd>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Platform role</dt>
            <dd>
              <Badge kind={user.platformRole === 'ADMIN' ? 'good' : 'muted'}>{user.platformRole}</Badge>
            </dd>
            <dt>User id</dt>
            <dd>
              <CopyId id={user.id} />
            </dd>
          </dl>
        </Card>
        <Card title="Company memberships">
          {user.memberships.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              None yet. <Link to="/seller">Register a company</Link> to start selling.
            </p>
          ) : (
            <div className="stack-sm">
              {user.memberships.map((m) => (
                <Link key={m.companyId} to={`/seller/${m.companyId}`} className="demo-user" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <span>🏪</span>
                  <span className="grow strong">{m.companyName}</span>
                  <Badge kind="info">{m.role}</Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>
        <Card title="Session">
          <div className="stack">
            <dl className="kv" style={{ margin: 0 }}>
              <dt>Access token expires</dt>
              <dd>
                {claims ? dateTime(new Date(claims.exp * 1000).toISOString()) : '—'}{' '}
                <Badge kind={left > 120 ? 'good' : left > 0 ? 'warn' : 'bad'}>{left > 0 ? `${Math.floor(left / 60)}m ${left % 60}s left` : 'expired'}</Badge>
              </dd>
              <dt>Issuer</dt>
              <dd className="mono small">{claims?.iss}</dd>
              <dt>Refresh token</dt>
              <dd className="mono small">{tokens?.refreshToken.slice(0, 10)}…</dd>
            </dl>
            <p className="small muted" style={{ margin: 0 }}>
              Expired access tokens are refreshed automatically. Refresh tokens rotate on every use, and reusing an old one signs out every session.
            </p>
            <ErrorBox error={refresh.error} />
            <div className="row">
              <Button variant="secondary" busy={refresh.busy} onClick={() => refresh.run()}>
                Rotate tokens now
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  await logout();
                  toast('Signed out; refresh token revoked', 'info');
                  navigate('/');
                }}
              >
                Sign out
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
