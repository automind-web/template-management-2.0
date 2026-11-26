"use client";

import * as React from "react";

/** Один источник сочетаний: подсказки и обработчики учитывают ОС. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

export function useSubmitShortcutLabel(): string {
  const [label, setLabel] = React.useState("Ctrl+Enter");
  React.useEffect(() => setLabel(isMac() ? "⌘+Return" : "Ctrl+Enter"), []);
  return label;
}

/**
 * Ctrl+Enter / ⌘+Return отправляет форму. Не срабатывает при составном вводе (IME)
 * и при удержании клавиши: форма сохраняется один раз. Обычный Enter в многострочном поле — новая строка.
 */
export function onSubmitShortcut(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.nativeEvent.isComposing || e.repeat) return;
  const form = (e.target as HTMLElement).closest("form");
  if (!form) return;
  e.preventDefault();
  form.requestSubmit();
}

/** «/» переводит фокус в поиск, если фокус не в поле ввода и не открыт диалог. */
export function useSlashToFocus(ref: React.RefObject<HTMLInputElement | null>) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}
