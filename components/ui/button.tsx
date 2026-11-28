import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Кнопки — как в шаблоне продаж 2.0: компактные, скругление 8px, одна главная на экране. */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** Главное действие экрана. */
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        /** Обычное действие: белая кнопка с рамкой. */
        outline: "border border-border bg-surface text-foreground hover:bg-muted",
        /** Опасное действие: красная рамка (отменить, в архив, выйти). */
        danger: "border border-danger/35 bg-surface text-danger hover:bg-danger/5",
        destructive: "bg-danger text-white hover:bg-danger/90",
        ghost: "text-foreground hover:bg-muted",
        link: "h-auto px-0 font-medium text-primary hover:underline",
      },
      size: {
        default: "control-h px-4",
        sm: "h-8 px-3 text-[13px]",
        lg: "control-h px-5",
        icon: "control-h w-[var(--control-h)] p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" type={asChild ? undefined : (type ?? "button")} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

/** Подсказка сочетания клавиш внутри кнопки или поля. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("hidden rounded border border-current/25 px-1.5 py-px font-mono text-[11px] font-medium opacity-80 sm:inline-block", className)}>{children}</kbd>
  );
}

/** Пилюля-переключатель (фильтры, быстрые периоды) — как в шаблоне продаж. */
export function Chip({
  selected,
  count,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & { selected?: boolean; count?: number | string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold transition-colors",
        selected ? "border-transparent bg-selected text-selected-foreground" : "border-border bg-surface text-foreground/80 hover:bg-muted",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined ? <span className="font-medium text-muted-foreground">{count}</span> : null}
    </button>
  );
}

/** Небольшая метка без точки («вы», «это устройство»). */
export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground", className)}>{children}</span>;
}

export { buttonVariants };
