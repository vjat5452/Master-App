import { forwardRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Copy, Info, Loader2, Minus, Plus, RotateCw, XCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge as UiBadge } from '@/components/ui/badge';
import { Button as UiButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton, ToggleGroup, ToggleGroupItem } from '@/components/ui/misc';
import { Tabs as UiTabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { title, tone } from '@/lib/format';
import { cn } from '@/lib/utils';

const VARIANT = { primary: 'default', secondary: 'outline', ghost: 'ghost', danger: 'destructive', gold: 'gold', link: 'link', soft: 'secondary', glass: 'glass' };

// forwardRef so Radix triggers (menus, tooltips) can attach to it.
export const Button = forwardRef(({ variant = 'primary', size, busy, block, children, className, asChild, ...props }, ref) => {
  const common = { variant: VARIANT[variant] ?? variant, size, className: cn(block && 'w-full', className), ref };
  // Radix Slot needs exactly one child element, so a link button gets no spinner slot.
  if (asChild) return <UiButton asChild {...common} {...props}>{children}</UiButton>;
  return (
    <UiButton {...common} {...props} disabled={busy || props.disabled}>
      {busy && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </UiButton>
  );
});
Button.displayName = 'Button';

export function Badge({ status, kind, children, className, dot = false }) {
  const variant = kind ?? tone(status);
  return (
    <UiBadge variant={variant} className={className}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children ?? title(status)}
    </UiBadge>
  );
}

export function Panel({ title: heading, description, icon: Icon, actions, children, className, pad = true, bodyClassName }) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      {(heading || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {Icon && (
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
                <Icon className="size-[18px]" />
              </span>
            )}
            <div className="min-w-0">
              {heading && <h3 className="truncate text-[15px] font-bold tracking-tight">{heading}</h3>}
              {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(pad && 'p-5', bodyClassName)}>{children}</div>
    </Card>
  );
}

export function PageHeader({ eyebrow, title: heading, description, actions, className }) {
  return (
    <div className={cn('mb-8 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">{eyebrow}</div>}
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{heading}</h1>
        {description && <p className="mt-2 max-w-2xl text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={cn('grid gap-2', className)}>
      <Label asChild>
        <span>{label}</span>
      </Label>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Spinner({ label = 'Loading…', className }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground', className)}>
      <Loader2 className="size-4 animate-spin text-primary" /> {label}
    </div>
  );
}

export function SkeletonRows({ rows = 4 }) {
  return (
    <div className="grid gap-3 p-5">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function Empty({ icon: Icon = Info, title: heading, children, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-14 text-center', className)}>
      <div className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-accent to-muted text-primary shadow-soft">
        <Icon className="size-6" />
      </div>
      <div className="font-bold">{heading}</div>
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
      {action}
    </div>
  );
}

const ALERT = {
  good: ['border-success/25 bg-success/10 text-success', CheckCircle2],
  warn: ['border-warning/30 bg-warning/10 text-warning', AlertTriangle],
  bad: ['border-destructive/25 bg-destructive/10 text-destructive', XCircle],
  info: ['border-info/25 bg-info/10 text-info', Info],
};

export function Alert({ tone: t = 'info', title: heading, children, className }) {
  const [cls, Icon] = ALERT[t];
  return (
    <div role="alert" className={cn('flex gap-3 rounded-xl border p-3.5 text-sm', cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 text-foreground/90">
        {heading && <div className="font-semibold text-foreground">{heading}</div>}
        {children}
      </div>
    </div>
  );
}

/** Renders an ApiError (or any Error) with its code, validation issues and request id. */
export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  const issues = Array.isArray(error.details) ? error.details : null;
  return (
    <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/[0.06] p-4 text-sm">
      <div className="flex items-start gap-3">
        <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-foreground">{error.message}</strong>
            {error.code && <code className="rounded-md bg-destructive/10 px-1.5 py-0.5 font-mono text-[11px] text-destructive">{error.code}</code>}
          </div>
          {issues && (
            <ul className="space-y-1 text-muted-foreground">
              {issues.map((i, n) => (
                <li key={n}>
                  <code className="font-mono text-xs text-foreground">{i.path}</code> {i.message}
                </li>
              ))}
            </ul>
          )}
          {!issues && error.details && <Json value={error.details} small />}
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {error.status ? `HTTP ${error.status}` : ''}
              {error.requestId ? ` · request ${error.requestId}` : ''}
            </span>
            {onRetry && (
              <button className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" onClick={onRetry}>
                <RotateCw className="size-3" /> Try again
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Json({ value, small }) {
  return (
    <pre
      className={cn(
        'max-h-[520px] overflow-auto rounded-xl border bg-[hsl(165_30%_7%)] p-4 font-mono text-[12.5px] leading-relaxed text-emerald-100 scrollbar-thin',
        small && 'max-h-64 p-3 text-xs',
      )}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Controlled tab strip (no panels): pages render the active section themselves. */
export function Tabs({ tabs, value, onChange, className }) {
  return (
    <UiTabs value={value} onValueChange={onChange} className={className}>
      <TabsList className="max-w-full">
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.icon && <t.icon />}
            {t.label}
            {t.count != null && <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{t.count}</span>}
          </TabsTrigger>
        ))}
      </TabsList>
    </UiTabs>
  );
}

/** Single-choice segmented control; never lets the selection become empty. */
export function Segmented({ value, onChange, options, className }) {
  return (
    <ToggleGroup type="single" value={value} onValueChange={(v) => v && onChange(v)} className={className}>
      {options.map((o) => (
        <ToggleGroupItem key={o.id} value={o.id} aria-label={o.label}>
          {o.icon && <o.icon />}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function Modal({ title: heading, description, onClose, children, footer, className }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={className}>
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{heading}</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-4">{children}</div>
        {footer && <DialogFooter className="pt-2">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

const STAT_TONES = {
  emerald: 'from-emerald-500/15 to-teal-500/5 text-emerald-600 dark:text-emerald-400',
  gold: 'from-amber-400/20 to-orange-400/5 text-amber-600 dark:text-amber-400',
  blue: 'from-sky-500/15 to-indigo-500/5 text-sky-600 dark:text-sky-400',
  rose: 'from-rose-500/15 to-pink-500/5 text-rose-600 dark:text-rose-400',
};

export function Stat({ label, value, sub, icon: Icon, tone: t = 'emerald', index = 0 }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05, duration: 0.35 }}>
      <Card className="group relative overflow-hidden p-5 transition-shadow hover:shadow-lift">
        <div className={cn('pointer-events-none absolute -right-8 -top-8 size-28 rounded-full bg-gradient-to-br opacity-80 blur-2xl', STAT_TONES[t])} />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="num mt-2 text-2xl font-extrabold tracking-tight sm:text-[28px]">{value}</div>
            {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
          </div>
          {Icon && (
            <div className={cn('grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br', STAT_TONES[t])}>
              <Icon className="size-5" />
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

export function Stepper({ value, onChange, min = 0, max = 100, size = 'default' }) {
  const small = size === 'sm';
  return (
    <div className={cn('inline-flex items-center rounded-lg border bg-card shadow-sm', small ? 'h-8' : 'h-10')}>
      <button
        type="button"
        className={cn('grid h-full place-items-center rounded-l-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40', small ? 'w-7' : 'w-9')}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="Decrease"
      >
        <Minus className="size-3.5" />
      </button>
      <span className={cn('num text-center text-sm font-bold', small ? 'w-6' : 'w-8')}>{value}</span>
      <button
        type="button"
        className={cn('grid h-full place-items-center rounded-r-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40', small ? 'w-7' : 'w-9')}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="Increase"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

export function CopyId({ id }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
      title="Copy full id"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
      {copied ? 'copied' : id.slice(0, 8)}
    </button>
  );
}

export function KV({ rows, className }) {
  return (
    <dl className={cn('grid gap-2.5 text-sm', className)}>
      {rows.filter(Boolean).map(([k, v, strong]) => (
        <div key={k} className={cn('flex items-center justify-between gap-4', strong && 'border-t pt-3 text-base font-extrabold')}>
          <dt className={cn(!strong && 'text-muted-foreground')}>{k}</dt>
          <dd className="num text-right font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function useSubmit(fn) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (...args) => {
    setBusy(true);
    setError(null);
    try {
      return await fn(...args);
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error, setError };
}

export function Reveal({ children, delay = 0, className }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}
