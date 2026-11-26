"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

type Toast = { id: number; tone: "success" | "danger"; text: string };
const Ctx = React.createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

/** Короткие сообщения об успехе и ошибках в углу экрана. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const push = React.useCallback((text: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list.slice(-2), { id, tone, text }]);
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 md:items-end md:pr-6">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "danger" ? "alert" : "status"}
            className={cn(
              "am-pop pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-xl border bg-surface px-4 py-3 text-[15px] font-medium shadow-lg",
              t.tone === "danger" ? "border-destructive/30" : "border-success/25",
            )}
          >
            {t.tone === "danger" ? <XCircle className="size-5 shrink-0 text-destructive" /> : <CheckCircle2 className="size-5 shrink-0 text-success" />}
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return React.useContext(Ctx);
}
