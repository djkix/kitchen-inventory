import { cn } from '../../lib/cn';

/** Squelette de chargement : préféré aux roues (section 14). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('anim-pulse rounded-lg bg-raised', className)} />;
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 px-4" aria-busy aria-label="Chargement">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-card bg-surface p-3">
          <Skeleton className="size-12 shrink-0 rounded-xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="size-11 rounded-xl" />
        </div>
      ))}
    </div>
  );
}
