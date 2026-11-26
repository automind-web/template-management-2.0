"use client";

import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { hotkeyList, isMac } from "@/lib/hotkeys";
import { t } from "@/lib/i18n";

/** Подсказка по клавишам: «?» вне поля ввода. Строится из того же списка, что и обработчики. */
export function HotkeysHelp() {
  const [open, setOpen] = React.useState(false);
  const [mac, setMac] = React.useState(false);
  React.useEffect(() => {
    setMac(isMac());
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]") || document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title={t("hotkeys.title")}>
        <table className="w-full text-sm">
          <tbody>
            {hotkeyList(mac).map((h) => (
              <tr key={h.action} className="border-b border-border last:border-0">
                <td className="py-2 pr-3">
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">{h.keys}</kbd>
                </td>
                <td className="py-2 pr-3 font-medium">{t(h.action)}</td>
                <td className="py-2 text-muted-foreground">{t(h.where)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}
