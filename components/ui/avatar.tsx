import { cn } from "@/lib/utils";

/** Аватар с инициалами — как в шаблоне продаж: фирменный градиент. */
export function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const parts = name.trim().split(/\s+/);
  const initials = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cn("inline-grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-primary/70 font-bold text-primary-foreground", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }}
    >
      {initials}
    </span>
  );
}
