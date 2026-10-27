import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export const Table = forwardRef(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-x-auto scrollbar-thin">
    <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
  </div>
));
Table.displayName = 'Table';

export const TableHeader = forwardRef(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('bg-muted/40 [&_tr]:border-b', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = forwardRef(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

export const TableRow = forwardRef(({ className, ...props }, ref) => (
  <tr ref={ref} className={cn('border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted', className)} {...props} />
));
TableRow.displayName = 'TableRow';

export const TableHead = forwardRef(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn('h-10 whitespace-nowrap px-4 text-left align-middle text-[11px] font-bold uppercase tracking-wider text-muted-foreground', className)}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

export const TableCell = forwardRef(({ className, ...props }, ref) => (
  <td ref={ref} className={cn('px-4 py-3 align-middle', className)} {...props} />
));
TableCell.displayName = 'TableCell';
