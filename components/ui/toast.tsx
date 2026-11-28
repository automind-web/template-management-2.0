"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Toast = { id: number; tone: "success" | "danger"; text: string };
const Ctx = React.createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

/** Короткое сообщение внизу экрана, как в шаблоне продаж; читается экранным диктором. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = React.useState<Toast | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const push = React.useCallback((text: string, tone: Toast["tone"] = "success") => {
    setToast({ id: Date.now(), tone, text });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), tone === "danger" ? 7000 : 3500);
  }, []);
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-h)+12px)] z-[60] flex justify-center px-4 md:bottom-4">
        {toast ? (
          <div
            key={toast.id}
            className={cn(
              "card-in pointer-events-auto max-w-xl rounded-xl px-4 py-3 text-sm font-semibold shadow-xl break-anywhere",
              toast.tone === "danger" ? "bg-danger text-white" : "bg-foreground text-background",
            )}
          >
            {toast.text}
          </div>
        ) : null}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return React.useContext(Ctx);
}
