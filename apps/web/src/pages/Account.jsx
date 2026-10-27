import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, KeyRound, LogOut, RefreshCw, Store } from 'lucide-react';
import { Badge, Button, CopyId, ErrorBox, KV, PageHeader, Panel, useSubmit } from '@/components/kit';
import { Avatar, AvatarFallback } from '@/components/ui/misc';
import { getTokens, onTokensChange, post, setTokens } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAuth, useToast } from '@/lib/store';

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
  const ttl = claims ? claims.exp - claims.iat : 1;

  const refresh = useSubmit(async () => {
    setTokens(await post('/auth/refresh', { refreshToken: getTokens().refreshToken }, { auth: false }));
    await reload();
    toast('Tokens rotated: new access token and new refresh token issued');
  });

  return (
    <>
      <PageHeader eyebrow="Settings" title="Account" description="Your profile, company memberships and current session." />

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Panel>
          <div className="flex flex-col items-center text-center">
            <Avatar className="size-20 shadow-glow">
              <AvatarFallback className="text-3xl">{user.name?.[0]?.toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="mt-4 text-xl font-extrabold">{user.name}</div>
            <div className="text-sm text-muted-foreground">{user.email}</div>
            <Badge kind={user.platformRole === 'ADMIN' ? 'gold' : 'muted'} className="mt-3">
              {user.platformRole === 'ADMIN' ? 'Platform admin' : 'Member'}
            </Badge>
          </div>
          <div className="mt-6 border-t pt-5">
            <KV rows={[['User id', <CopyId id={user.id} />], ['Companies', user.memberships.length]]} />
          </div>
        </Panel>

        <div className="space-y-6">
          <Panel icon={Store} title="Company memberships" description="Stores you can manage or work in">
            {user.memberships.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4">
                <span className="text-sm text-muted-foreground">You're not part of a company yet.</span>
                <Button asChild size="sm">
                  <Link to="/seller">
                    Start selling <ArrowRight />
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {user.memberships.map((m) => (
                  <Link
                    key={m.companyId}
                    to={`/seller/${m.companyId}`}
                    className="group flex items-center gap-3 rounded-xl border p-3 transition hover:border-primary/30 hover:bg-accent/40"
                  >
                    <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-white">
                      <Store className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-bold">{m.companyName}</span>
                    <Badge kind="info">{m.role}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel icon={KeyRound} title="Session" description="Access tokens refresh automatically">
            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-semibold">Access token</span>
                  <Badge kind={left > 120 ? 'good' : left > 0 ? 'warn' : 'bad'}>{left > 0 ? `${Math.floor(left / 60)}m ${left % 60}s left` : 'expired'}</Badge>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-1000" style={{ width: `${Math.min(100, (left / ttl) * 100)}%` }} />
                </div>
              </div>
              <KV
                rows={[
                  ['Expires', claims ? dateTime(new Date(claims.exp * 1000).toISOString()) : '—'],
                  ['Issuer', <span className="font-mono text-xs">{claims?.iss}</span>],
                  ['Refresh token', <span className="font-mono text-xs">{tokens?.refreshToken.slice(0, 10)}…</span>],
                ]}
              />
              <p className="text-xs text-muted-foreground">Refresh tokens rotate on every use, and reusing an old one signs out every session.</p>
              <ErrorBox error={refresh.error} />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" busy={refresh.busy} onClick={() => refresh.run()}>
                  <RefreshCw /> Rotate tokens now
                </Button>
                <Button
                  variant="danger"
                  onClick={async () => {
                    await logout();
                    toast('Signed out; refresh token revoked', 'info');
                    navigate('/');
                  }}
                >
                  <LogOut /> Sign out
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
