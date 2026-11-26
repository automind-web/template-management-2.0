import { cn } from "@/lib/utils";

const PALETTE = ["#2f5bea", "#0e9f6e", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#dc2626", "#4f46e5"];

/** Аватар с инициалами: цвет постоянный для имени. */
export function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("") || "?";
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: PALETTE[hash % PALETTE.length] }}
    >
      {initials}
    </span>
  );
}
