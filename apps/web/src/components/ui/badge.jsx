import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide transition-colors [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        good: 'border-success/20 bg-success/10 text-success',
        warn: 'border-warning/25 bg-warning/10 text-warning',
        bad: 'border-destructive/20 bg-destructive/10 text-destructive',
        info: 'border-info/20 bg-info/10 text-info',
        muted: 'border-border bg-muted text-muted-foreground',
        gold: 'border-gold/30 bg-gold/15 text-amber-700 dark:text-gold',
        outline: 'text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
