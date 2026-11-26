import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** Главное действие — единственное место акцентного цвета. */
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        outline: "border border-border bg-surface text-foreground hover:bg-muted",
        /** Опасное действие: отмена задачи, выход, архив, отзыв. */
        danger: "border border-destructive/40 bg-surface text-destructive hover:bg-destructive/5",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        ghost: "text-foreground hover:bg-muted",
        link: "h-auto px-0 text-primary hover:underline",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-[13px]",
        lg: "h-11 px-5",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

/** Подсказка сочетания клавиш внутри кнопки или поля. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "hidden rounded border border-current/25 px-1.5 py-px font-mono text-[11px] font-medium leading-4 opacity-80 sm:inline-block",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export { buttonVariants };
