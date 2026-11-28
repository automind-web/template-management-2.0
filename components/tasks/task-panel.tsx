"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { prefetchCard } from "./store";

const TaskDetail = React.lazy(() => import("./task-detail"));
const Ctx = React.createContext<(id: string) => void>(() => {});

/** Keep the source page mounted: its controls, drafts, focus and all scroll containers stay intact. */
export function TaskPanelProvider({ children }: { children: React.ReactNode }) {
  const [id, setId] = React.useState<string | null>(null);
  const pathname = usePathname();
  const opener = React.useRef<HTMLElement | null>(null);
  const open = React.useCallback((taskId: string) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    prefetchCard(taskId);
    const url = new URL(window.location.href);
    url.searchParams.set("task", taskId);
    if (url.href !== window.location.href) {
      window.history.pushState({ ...window.history.state, amTaskOverlay: true }, "", url);
    }
    setId(taskId);
  }, []);
  const close = React.useCallback(() => {
    setId(null);
    if (window.history.state?.amTaskOverlay) window.history.back();
    else {
      const url = new URL(window.location.href);
      url.searchParams.delete("task");
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);
  React.useEffect(() => {
    const sync = () => setId(new URLSearchParams(window.location.search).get("task"));
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [pathname]);
  React.useEffect(() => {
    // Also covers links from statistics, chat, and future task lists.
    const click = (event: MouseEvent) => {
      if (event.button || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.defaultPrevented) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      const match = /^\/tasks\/([^/]+)$/.exec(url.pathname);
      if (url.origin !== window.location.origin || !match) return;
      event.preventDefault();
      event.stopPropagation();
      opener.current = link;
      open(decodeURIComponent(match[1]!));
      opener.current = link;
    };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, [open]);
  return (
    <Ctx.Provider value={open}>
      {children}
      <Dialog open={Boolean(id)} onOpenChange={(value) => !value && close()}>
        <DialogContent side title="Задача" onCloseAutoFocus={(event) => {
          event.preventDefault();
          opener.current?.focus({ preventScroll: true });
        }}>
          <div className="grid gap-4">
            <React.Suspense fallback={<Skeleton className="h-64 w-full" />}>
              {id ? <TaskDetail key={id} id={id} /> : null}
            </React.Suspense>
          </div>
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

export function useOpenTask() { return React.useContext(Ctx); }
