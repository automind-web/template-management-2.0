import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("skeleton block rounded-2xl", className)} />;
}

/** Заготовка страницы на время загрузки. */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid gap-3" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}
